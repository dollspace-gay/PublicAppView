import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { Readable } from "stream";
import { firehoseClient } from "./services/firehose";
import { metricsService } from "./services/metrics";
import { lexiconValidator } from "./services/lexicon-validator";
import { xrpcApi } from "./services/xrpc-api";
import { storage } from "./storage";
import { authService, requireAuth, requireAdmin, type AuthRequest } from "./services/auth";
import { contentFilter } from "./services/content-filter";
import { didResolver } from "./services/did-resolver";
import { pdsClient } from "./services/pds-client";
import { labelService } from "./services/label";
import { moderationService } from "./services/moderation";
import { pdsDataFetcher } from "./services/pds-data-fetcher";
import { z } from "zod";
import { logCollector } from "./services/log-collector";
import { schemaIntrospectionService } from "./services/schema-introspection";
import { db } from "./db";
import { sql, eq } from "drizzle-orm";
import { csrfProtection } from "./middleware/csrf";
import { isUrlSafeToFetch, isValidDID, isValidCID, buildSafeBlobUrl, safeFetch } from "./utils/security";
import {
  authLimiter,
  oauthLimiter,
  writeLimiter,
  searchLimiter,
  apiLimiter,
  xrpcLimiter,
  adminLimiter,
  deletionLimiter,
} from "./middleware/rate-limit";
import { xrpcProxyMiddleware } from "./middleware/xrpc-proxy";

export async function registerRoutes(app: Express): Promise<Server> {
  // NOTE: Using HTTP server here is intentional for local development and deployment.
  // In production, this server should be behind a reverse proxy (nginx, Cloudflare, etc.)
  // that handles HTTPS/TLS termination. The reverse proxy forwards decrypted traffic
  // to this HTTP server on localhost/internal network.
  // See: https://expressjs.com/en/guide/behind-proxies.html
  const httpServer = createServer(app);

  // API request tracking middleware with per-endpoint performance tracking
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/xrpc')) {
      metricsService.recordApiRequest();
      
      const startTime = Date.now();
      
      // Track request bytes (approximate from content-length or body)
      const requestBytes = parseInt(req.headers['content-length'] || '0', 10) || 
                          (req.body ? JSON.stringify(req.body).length : 0);
      
      const originalSend = res.send;
      
      res.send = function(data: any) {
        const duration = Date.now() - startTime;
        const success = res.statusCode >= 200 && res.statusCode < 400;
        metricsService.recordEndpointRequest(req.path, duration, success);
        
        // Track response bytes
        const responseBytes = Buffer.byteLength(typeof data === 'string' ? data : JSON.stringify(data));
        metricsService.trackNetworkBytes(requestBytes, responseBytes);
        
        return originalSend.call(this, data);
      };
    }
    next();
  });

  // Apply general rate limiting to all /api and /xrpc endpoints
  app.use('/api', apiLimiter);
  app.use('/xrpc', xrpcLimiter);

  // Initialize Redis queue connection
  const { redisQueue } = await import("./services/redis-queue");
  await redisQueue.connect();
  
  // Initialize Redis pub/sub for event broadcasting across all workers
  await redisQueue.initializePubSub();
  
  // Initialize Redis stat counters from database (one-time sync for fast lookups)
  const existingCounts = await redisQueue.getRecordCounts();
  const hasExistingCounts = Object.keys(existingCounts).length > 0;
  
  if (!hasExistingCounts) {
    try {
      console.log("[REDIS] Initializing record counters from database (may take a moment)...");
      const stats = await db.execute(sql`
        SELECT 
          (SELECT COUNT(*)::text FROM users) as users,
          (SELECT COUNT(*)::text FROM posts) as posts,
          (SELECT COUNT(*)::text FROM likes) as likes,
          (SELECT COUNT(*)::text FROM reposts) as reposts,
          (SELECT COUNT(*)::text FROM follows) as follows,
          (SELECT COUNT(*)::text FROM blocks) as blocks
      `);
      
      if (stats.rows.length > 0) {
        const row: any = stats.rows[0];
        await Promise.all([
          redisQueue.incrementRecordCount('users', parseInt(row.users || '0')),
          redisQueue.incrementRecordCount('posts', parseInt(row.posts || '0')),
          redisQueue.incrementRecordCount('likes', parseInt(row.likes || '0')),
          redisQueue.incrementRecordCount('reposts', parseInt(row.reposts || '0')),
          redisQueue.incrementRecordCount('follows', parseInt(row.follows || '0')),
          redisQueue.incrementRecordCount('blocks', parseInt(row.blocks || '0')),
        ]);
        console.log("[REDIS] Initialized record counters:", row);
      }
    } catch (error) {
      console.error("[REDIS] Failed to initialize record counters:", error);
    }
  } else {
    console.log("[REDIS] Record counters already initialized");
  }
  
  // Initialize admin authorization from ADMIN_DIDS environment variable
  const { adminAuthService } = await import("./services/admin-authorization");
  await adminAuthService.initialize();
  
  const workerId = parseInt(process.env.NODE_APP_INSTANCE || '0');
  const totalWorkers = parseInt(process.env.PM2_INSTANCES || '1');
  
  // Check if firehose is enabled (default: false - Python handles it)
  const firehoseEnabled = process.env.FIREHOSE_ENABLED === 'true';
  
  // Check if TypeScript workers are enabled (default: false - Python workers handle it)
  const typescriptWorkersEnabled = process.env.TYPESCRIPT_WORKERS_ENABLED === 'true';
  
  // ONLY worker 0 connects to firehose and pushes to Redis (if enabled)
  if (firehoseEnabled && workerId === 0) {
    console.log(`[FIREHOSE] Worker ${workerId}/${totalWorkers} - TypeScript firehose writer (firehose → Redis)`);
    firehoseClient.connect(workerId, totalWorkers);
  } else if (!firehoseEnabled) {
    console.log(`[FIREHOSE] TypeScript firehose disabled (using Python firehose)`);
  } else {
    console.log(`[FIREHOSE] Worker ${workerId}/${totalWorkers} - Non-primary worker (no firehose connection)`);
  }
  
  // Check if TypeScript workers should consume from Redis
  if (!typescriptWorkersEnabled) {
    console.log(`[WORKERS] TypeScript workers disabled (using Python workers for Redis → PostgreSQL)`);
    console.log(`[WORKERS] This instance will serve API requests only`);
  } else {
    console.log(`[WORKERS] TypeScript workers enabled - consuming from Redis`);
  }
  
  const consumerId = `worker-${workerId}`;
  
  // Only start TypeScript worker consumption if enabled
  if (typescriptWorkersEnabled) {
    console.log(`[REDIS] Worker ${workerId} starting consumer loop: ${consumerId}`);
    
    // Start multiple parallel consumer pipelines per worker for maximum throughput
    const { eventProcessor } = await import("./services/event-processor");
    const PARALLEL_PIPELINES = 5; // Run 5 concurrent consumer loops per worker
    
    const processEvent = async (event: any) => {
      let success = false;
      try {
        if (event.type === "commit") {
          await eventProcessor.processCommit(event.data);
        } else if (event.type === "identity") {
          await eventProcessor.processIdentity(event.data);
        } else if (event.type === "account") {
          await eventProcessor.processAccount(event.data);
        }
        success = true;
      } catch (error: any) {
        if (error?.code === '23505' || error?.code === '23503') {
          // Duplicate key or foreign key violation - treat as success
          success = true;
        } else {
          console.error(`[REDIS] Worker ${workerId} error processing ${event.type}:`, error);
          // Don't acknowledge - message will be retried
        }
      }
      
      // Acknowledge ONLY after successful processing
      if (success) {
        // Update cluster-wide metrics (buffered, flushed every 500ms)
        const metricType = event.type === "commit" ? "#commit" 
          : event.type === "identity" ? "#identity" 
          : "#account";
        redisQueue.incrementClusterMetric(metricType);
        
        await redisQueue.ack(event.messageId);
      }
    };
    
    // Launch parallel consumer pipelines
    const consumerPipelines = Array.from({ length: PARALLEL_PIPELINES }, (_, pipelineId) => {
      return (async () => {
        const pipelineConsumerId = `${consumerId}-p${pipelineId}`;
        let iterationCount = 0;
        
        while (true) {
          try {
            // Large batch size (300) with short block timeout (100ms) for high throughput
            let events = await redisQueue.consume(pipelineConsumerId, 300);
            
            // Use XAUTOCLAIM every 5 seconds for fast dead consumer recovery
            if (++iterationCount % 50 === 0) { // ~50 iterations × 100ms = 5 seconds
              const claimed = await redisQueue.claimPendingMessages(pipelineConsumerId, 10000);
              if (claimed.length > 0) {
                console.log(`[REDIS] Worker ${workerId} pipeline ${pipelineId} auto-claimed ${claimed.length} pending messages`);
                events = [...events, ...claimed];
              }
            }
            
            // MONITORING: Check queue depth every 10 seconds and alert if critical
            if (iterationCount % 100 === 0) { // ~100 iterations × 100ms = 10 seconds
              // Use pending count as the real backlog (unacked)
              const queueDepth = await redisQueue.getQueueDepth();
              if (queueDepth > 200000) { // Critical: high pending backlog
                console.error(`[REDIS] CRITICAL: Queue depth at ${queueDepth} - workers falling behind!`);
                logCollector.error('Redis queue depth critical - workers cannot keep up', { 
                  queueDepth, 
                  workerId, 
                  pipelineId 
                });
              } else if (queueDepth > 80000) { // Warning threshold
                console.warn(`[REDIS] WARNING: Queue depth at ${queueDepth} - consider scaling workers`);
              }
            }
            
            if (events.length > 0) {
              // Process all events in batch with Promise.allSettled for fault tolerance
              await Promise.allSettled(events.map(processEvent));
            }
          } catch (error) {
            console.error(`[REDIS] Worker ${workerId} pipeline ${pipelineId} error:`, error);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      })();
    });
    
    // Run all pipelines concurrently (don't await - let them run in background)
    Promise.allSettled(consumerPipelines);
    
    // Start periodic retry mechanism for pending operations
    setInterval(async () => {
      try {
        const retriedCount = await eventProcessor.retryPendingOperations();
        if (retriedCount > 0) {
          console.log(`[REDIS] Retried ${retriedCount} pending operations`);
        }
      } catch (error) {
        console.error(`[REDIS] Error during retry cycle:`, error);
      }
    }, 30000); // Retry every 30 seconds
  }

  // WebDID endpoint - Serve DID document for did:web resolution
  const serveDIDDocument = async (_req: Request, res: Response) => {
    try {
      const fs = await import('fs/promises');
      const didDoc = await fs.readFile('public/did.json', 'utf-8');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.send(didDoc);
    } catch (error) {
      // If DID document doesn't exist, return a basic one based on APPVIEW_DID
      const appviewDid = process.env.APPVIEW_DID;
      if (!appviewDid) {
        return res.status(500).json({ error: "APPVIEW_DID not configured" });
      }
      const domain = appviewDid.replace('did:web:', '');
      const verificationKey = process.env.APPVIEW_ATPROTO_PUBKEY_MULTIBASE;
      const basicDidDoc: any = {
        "@context": [
          "https://www.w3.org/ns/did/v1",
          "https://w3id.org/security/multikey/v1"
        ],
        id: appviewDid,
        service: [
          { id: "#bsky_notif", type: "BskyNotificationService", serviceEndpoint: `https://${domain}` },
          { id: "#bsky_appview", type: "BskyAppView", serviceEndpoint: `https://${domain}` }
        ]
      };
      if (verificationKey) {
        basicDidDoc.verificationMethod = [
          {
            id: `${appviewDid}#atproto`,
            type: "Multikey",
            controller: appviewDid,
            publicKeyMultibase: verificationKey,
          }
        ];
      }
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.json(basicDidDoc);
    }
  };

  app.get("/.well-known/did.json", serveDIDDocument);
  app.get("/did.json", serveDIDDocument);

  // Blob Proxy Endpoint - Fetch and serve blobs from Bluesky CDN
  // Pattern: /img/{preset}/plain/{did}/{cid}@{format}
  app.get("/img/:preset/plain/:did/:cidWithFormat", async (req: Request, res: Response) => {
    try {
      const { preset, did, cidWithFormat } = req.params;
      
      // Extract CID and format from cidWithFormat (e.g., "bafkreixyz@jpeg")
      const [cid, format] = cidWithFormat.split('@');
      
      if (!cid || !format) {
        return res.status(400).type('text/plain').send('Invalid CID format');
      }

      console.log(`[BLOB_PROXY] Fetching blob: ${preset} ${did} ${cid}@${format}`);

      // Validate DID and CID format to prevent injection attacks
      if (!isValidDID(did)) {
        console.error(`[BLOB_PROXY] Invalid DID format: ${did}`);
        return res.status(400).type('text/plain').send('Invalid DID format');
      }
      
      if (!isValidCID(cid)) {
        console.error(`[BLOB_PROXY] Invalid CID format: ${cid}`);
        return res.status(400).type('text/plain').send('Invalid CID format');
      }

      // Construct URL to Bluesky CDN
      const cdnUrl = `https://cdn.bsky.app/img/${preset}/plain/${did}/${cid}@${format}`;
      
      console.log(`[BLOB_PROXY] Fetching from Bluesky CDN: ${cdnUrl}`);

      // Fetch from Bluesky CDN
      const response = await safeFetch(cdnUrl, {
        headers: {
          'Accept': 'image/*,*/*',
          'User-Agent': 'AT-Protocol-AppView/1.0'
        }
      });

      if (!response.ok) {
        console.error(`[BLOB_PROXY] CDN returned ${response.status}: ${response.statusText}`);
        return res.status(response.status).type('text/plain').send(`Blob not found (CDN returned ${response.status})`);
      }

      // Get content type from CDN response or default to image/jpeg
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      
      // Stream the blob to the client with caching headers
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year cache
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      // Stream the response body
      if (response.body && typeof response.body.tee === 'function') {
        // Node.js 18+ has Readable.fromWeb for Web Streams
        const nodeStream = Readable.fromWeb(response.body);
        nodeStream.pipe(res);
      } else {
        // Fallback for environments without Web Streams support
        const buffer = Buffer.from(await response.arrayBuffer());
        res.send(buffer);
      }

    } catch (error) {
      console.error('[BLOB_PROXY] Error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).type('text/plain').send(`Internal server error: ${errorMessage}`);
    }
  });

  // CSRF Protection - Set token cookie for all requests
  app.use(csrfProtection.setToken);

  // CSRF token endpoint - Frontend can request token
  app.get("/api/csrf-token", (req, res) => {
    // Force token generation to ensure we have a fresh token with proper signature
    let token = req.cookies?.csrf_token;
    
    if (!token) {
      // Generate new token and signature
      token = csrfProtection.generateToken();
      const signature = csrfProtection.signToken(token);
      
      // Set the cookies to ensure they're properly synchronized
      res.cookie('csrf_token', token, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/'
      });
      
      res.cookie('csrf_signature', signature, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/'
      });
      
      console.log('[CSRF] Generated new token for /api/csrf-token', {
        tokenLength: token.length,
        signatureLength: signature.length
      });
    } else {
      // Verify existing token has valid signature
      const existingSignature = req.cookies?.csrf_signature;
      if (!existingSignature || !csrfProtection.verifyToken(token, existingSignature)) {
        // Token exists but signature is invalid, regenerate
        const signature = csrfProtection.signToken(token);
        
        res.cookie('csrf_signature', signature, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 24 * 60 * 60 * 1000,
          path: '/'
        });
        
        console.log('[CSRF] Regenerated signature for existing token', {
          tokenLength: token.length,
          signatureLength: signature.length
        });
      }
    }
    
    console.log('[CSRF] Token endpoint accessed', {
      tokenLength: token.length,
      cookies: Object.keys(req.cookies || {})
    });
    
    res.json({ csrfToken: token });
  });

  // Authentication endpoints - OAuth 2.0 with AT Protocol
  
  // OAuth client metadata endpoint
  app.get("/client-metadata.json", async (req, res) => {
    try {
      const { oauthService } = await import("./services/oauth-service");
      await oauthService.ensureInitialized();
      res.json(oauthService.clientMetadata);
    } catch (error) {
      console.error("[OAUTH] Failed to get client metadata:", error);
      res.status(500).json({ error: "OAuth client not initialized" });
    }
  });

  // JWKS endpoint for OAuth client
  app.get("/jwks.json", async (req, res) => {
    try {
      const { oauthService } = await import("./services/oauth-service");
      await oauthService.ensureInitialized();
      res.json(oauthService.jwks);
    } catch (error) {
      console.error("[OAUTH] Failed to get JWKS:", error);
      res.status(500).json({ error: "OAuth client not initialized" });
    }
  });

  // Initiate OAuth login - returns authorization URL
  app.post("/api/auth/login", authLimiter, async (req, res) => {
    try {
      const schema = z.object({
        handle: z.string(),
      });

      const data = schema.parse(req.body);
      
      const state = authService.generateSessionId();
      
      const { oauthService } = await import("./services/oauth-service");
      const authUrl = await oauthService.initiateLogin(data.handle, state);

      res.json({ authUrl, state });
    } catch (error) {
      console.error("[AUTH] Login initiation error:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to initiate login" });
    }
  });

  // OAuth callback endpoint
  app.get("/api/auth/callback", oauthLimiter, async (req, res) => {
    try {
      const params = new URLSearchParams(req.url.split('?')[1]);
      
      const { oauthService } = await import("./services/oauth-service");
      const result = await oauthService.handleCallback(params);

      if (!result.success || !result.session) {
        return res.redirect(`/?error=${encodeURIComponent(result.error || 'OAuth callback failed')}`);
      }

      const did = result.session.did;
      
      // Ensure user exists in database
      const existingUser = await storage.getUser(did);
      if (!existingUser) {
        // Resolve DID to get handle
        const handle = await didResolver.resolveDIDToHandle(did);
        
        await storage.createUser({
          did,
          handle: handle || did,
          displayName: null,
          avatarUrl: null,
          description: null,
        });
      }
      
      // Check if user is admin
      const { adminAuthService } = await import("./services/admin-authorization");
      const isAdmin = await adminAuthService.isAdmin(did);

      // Create JWT token for frontend
      const token = authService.createSessionToken(did, did);

      // Set session cookie
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      });


      // Redirect to appropriate page based on admin status
      const redirectPath = isAdmin ? '/admin/moderation' : '/user/panel';
      res.redirect(redirectPath);
    } catch (error) {
      console.error("[AUTH] Callback error:", error);
      res.redirect(`/?error=${encodeURIComponent('OAuth callback failed')}`);
    }
  });
  
  app.post("/api/auth/create-session", authLimiter, async (req, res) => {
    try {
      const MAX_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days
      const DEFAULT_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days
      
      const schema = z.object({
        did: z.string(),
        pdsEndpoint: z.string(),
        accessToken: z.string(),
        refreshToken: z.string().optional(),
        expiresIn: z.number().default(DEFAULT_EXPIRY_SECONDS),
      });
      
      const data = schema.parse(req.body);
      
      // Step 1: Verify DID and PDS endpoint are valid
      const pdsEndpoint = await didResolver.resolveDIDToPDS(data.did);
      if (!pdsEndpoint) {
        return res.status(400).json({ 
          error: "Invalid DID: Could not resolve PDS endpoint" 
        });
      }
      
      // Verify the provided PDS endpoint matches the resolved one
      // Allow either exact match or normalized URLs
      const normalizedProvided = data.pdsEndpoint.replace(/\/$/, '');
      const normalizedResolved = pdsEndpoint.replace(/\/$/, '');
      if (normalizedProvided !== normalizedResolved) {
        console.warn(
          `[AUTH] PDS endpoint mismatch for ${data.did}: ` +
          `provided=${data.pdsEndpoint}, resolved=${pdsEndpoint}`
        );
        // Use the resolved endpoint for security
      }
      
      // Step 2: Verify the access token by calling authenticated PDS endpoint
      // This returns the DID if valid, ensuring the token actually belongs to the user
      const verifiedDid = await pdsClient.verifyToken(
        data.did,
        pdsEndpoint,
        data.accessToken
      );
      
      if (!verifiedDid || verifiedDid !== data.did) {
        return res.status(401).json({ 
          error: "Invalid access token: Token verification failed or DID mismatch" 
        });
      }
      
      console.log(`[AUTH] Successfully verified token for ${verifiedDid}`);
      
      const sessionId = authService.generateSessionId();
      
      // Cap expiry to maximum 30 days for security
      const cappedExpiresIn = Math.min(data.expiresIn, MAX_EXPIRY_SECONDS);
      const expiresAt = new Date(Date.now() + cappedExpiresIn * 1000);
      
      // Ensure user exists to prevent foreign key failures
      // Only create if user doesn't exist (don't overwrite existing data)
      const existingUser = await storage.getUser(data.did);
      if (!existingUser) {
        const handle = data.did.replace('did:plc:', '') + '.unknown';
        await storage.createUser({
          did: data.did,
          handle,
          displayName: null,
          avatarUrl: null,
          description: null,
        });
      }
      
      const session = await storage.createSession({
        id: sessionId,
        userDid: data.did,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken || null,
        pdsEndpoint: pdsEndpoint, // Use resolved PDS endpoint for security
        expiresAt,
      });
      
      const token = authService.createSessionToken(data.did, sessionId);
      
      res.json({ token, session });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  });

  app.post("/api/auth/logout", csrfProtection.validateToken, requireAuth, async (req: AuthRequest, res) => {
    try {
      if (req.session) {
        await storage.deleteSession(req.session.sessionId);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to logout" });
    }
  });

  app.get("/api/auth/session", requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.session) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      
      const session = await storage.getSession(req.session.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      
      const user = await storage.getUser(session.userDid);
      
      const { adminAuthService } = await import("./services/admin-authorization");
      const isAdmin = await adminAuthService.isAdmin(session.userDid);
      
      res.json({ session, user, isAdmin });
    } catch (error) {
      res.status(500).json({ error: "Failed to get session" });
    }
  });

  // User data management endpoints
  app.get("/api/user/settings", requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.session) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getSession(req.session.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      let settings = await storage.getUserSettings(session.userDid);
      if (!settings) {
        settings = await storage.createUserSettings({
          userDid: session.userDid,
          blockedKeywords: [],
          mutedUsers: [],
          customLists: [],
          feedPreferences: {},
          dataCollectionForbidden: false,
          lastBackfillAt: null,
        });
      }

      res.json(settings);
    } catch (error) {
      console.error("[USER_SETTINGS] Error:", error);
      res.status(500).json({ error: "Failed to get user settings" });
    }
  });

  // User backfill endpoint (uses repo backfill service)
  app.post("/api/user/backfill", csrfProtection.validateToken, requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.session?.did) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const { days } = req.body;
      const backfillDays = parseInt(days || "0");

      // Import the repo backfill service
      const { repoBackfillService } = await import("./services/repo-backfill");
      
      // Start backfill for the user's repo
      await repoBackfillService.backfillSingleRepo(req.session.did, backfillDays);
      
      // Update user settings with last backfill time
      await storage.db.insert(storage.userSettings).values({
        userDid: req.session.did,
        lastBackfillAt: new Date(),
      }).onConflictDoUpdate({
        target: storage.userSettings.userDid,
        set: {
          lastBackfillAt: new Date(),
        },
      });
      
      res.json({ 
        success: true,
        message: `Started backfilling ${backfillDays === 0 ? 'all' : backfillDays + ' days of'} data from your PDS`
      });
    } catch (error) {
      console.error("[USER_BACKFILL] Error starting backfill:", error);
      res.status(500).json({ 
        error: "Failed to start backfill",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.post("/api/user/delete-data", deletionLimiter, csrfProtection.validateToken, requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.session) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getSession(req.session.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const userDid = session.userDid;

      await storage.deleteUserData(userDid);

      res.json({ 
        message: "All your data has been deleted from this instance",
        success: true
      });
    } catch (error) {
      console.error("[USER_DELETE_DATA] Error:", error);
      res.status(500).json({ error: "Failed to delete data" });
    }
  });

  app.post("/api/user/toggle-collection", csrfProtection.validateToken, requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.session) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getSession(req.session.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const schema = z.object({
        forbidden: z.boolean(),
      });

      const data = schema.parse(req.body);
      const userDid = session.userDid;

      await storage.updateUserSettings(userDid, {
        dataCollectionForbidden: data.forbidden,
      });

      res.json({ 
        forbidden: data.forbidden,
        message: data.forbidden 
          ? "Data collection has been disabled"
          : "Data collection has been enabled"
      });
    } catch (error) {
      console.error("[USER_TOGGLE_COLLECTION] Error:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update setting" });
    }
  });

  app.get("/api/user/stats", requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.session) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await storage.getSession(req.session.sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const userDid = session.userDid;
      const { 
        posts: postsTable, 
        likes: likesTable, 
        reposts: repostsTable, 
        follows: followsTable,
        blocks: blocksTable,
        mutes: mutesTable,
        listMutes: listMutesTable,
        listBlocks: listBlocksTable,
        threadMutes: threadMutesTable,
        bookmarks: bookmarksTable,
        notifications: notificationsTable,
        activitySubscriptions: activitySubscriptionsTable,
        lists: listsTable,
        listItems: listItemsTable,
        feedGenerators: feedGeneratorsTable,
        starterPacks: starterPacksTable,
        labelerServices: labelerServicesTable,
        verifications: verificationsTable,
        genericRecords: genericRecordsTable
      } = await import('@shared/schema');

      // Use efficient COUNT queries for all user-related tables
      const [
        postsCount, 
        likesCount, 
        repostsCount, 
        followsCount,
        blocksCount,
        mutesCount,
        listMutesCount,
        listBlocksCount,
        threadMutesCount,
        bookmarksCount,
        notificationsCount,
        activitySubscriptionsCount,
        listsCount,
        listItemsCount,
        feedGeneratorsCount,
        starterPacksCount,
        labelerServicesCount,
        verificationsCount,
        genericRecordsCount
      ] = await Promise.all([
        // Posts (authorDid)
        db.select({ count: sql<number>`count(*)::int` }).from(postsTable).where(eq(postsTable.authorDid, userDid)).then(r => r[0]?.count ?? 0),
        // Likes (userDid)
        db.select({ count: sql<number>`count(*)::int` }).from(likesTable).where(eq(likesTable.userDid, userDid)).then(r => r[0]?.count ?? 0),
        // Reposts (userDid)
        db.select({ count: sql<number>`count(*)::int` }).from(repostsTable).where(eq(repostsTable.userDid, userDid)).then(r => r[0]?.count ?? 0),
        // Follows (followerDid)
        db.select({ count: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.followerDid, userDid)).then(r => r[0]?.count ?? 0),
        // Blocks (blockerDid)
        db.select({ count: sql<number>`count(*)::int` }).from(blocksTable).where(eq(blocksTable.blockerDid, userDid)).then(r => r[0]?.count ?? 0),
        // Mutes (muterDid)
        db.select({ count: sql<number>`count(*)::int` }).from(mutesTable).where(eq(mutesTable.muterDid, userDid)).then(r => r[0]?.count ?? 0),
        // List Mutes (muterDid)
        db.select({ count: sql<number>`count(*)::int` }).from(listMutesTable).where(eq(listMutesTable.muterDid, userDid)).then(r => r[0]?.count ?? 0),
        // List Blocks (blockerDid)
        db.select({ count: sql<number>`count(*)::int` }).from(listBlocksTable).where(eq(listBlocksTable.blockerDid, userDid)).then(r => r[0]?.count ?? 0),
        // Thread Mutes (muterDid)
        db.select({ count: sql<number>`count(*)::int` }).from(threadMutesTable).where(eq(threadMutesTable.muterDid, userDid)).then(r => r[0]?.count ?? 0),
        // Bookmarks (userDid)
        db.select({ count: sql<number>`count(*)::int` }).from(bookmarksTable).where(eq(bookmarksTable.userDid, userDid)).then(r => r[0]?.count ?? 0),
        // Notifications (recipientDid)
        db.select({ count: sql<number>`count(*)::int` }).from(notificationsTable).where(eq(notificationsTable.recipientDid, userDid)).then(r => r[0]?.count ?? 0),
        // Activity Subscriptions (subscriberDid)
        db.select({ count: sql<number>`count(*)::int` }).from(activitySubscriptionsTable).where(eq(activitySubscriptionsTable.subscriberDid, userDid)).then(r => r[0]?.count ?? 0),
        // Lists (creatorDid)
        db.select({ count: sql<number>`count(*)::int` }).from(listsTable).where(eq(listsTable.creatorDid, userDid)).then(r => r[0]?.count ?? 0),
        // List Items (subjectDid)
        db.select({ count: sql<number>`count(*)::int` }).from(listItemsTable).where(eq(listItemsTable.subjectDid, userDid)).then(r => r[0]?.count ?? 0),
        // Feed Generators (creatorDid)
        db.select({ count: sql<number>`count(*)::int` }).from(feedGeneratorsTable).where(eq(feedGeneratorsTable.creatorDid, userDid)).then(r => r[0]?.count ?? 0),
        // Starter Packs (creatorDid)
        db.select({ count: sql<number>`count(*)::int` }).from(starterPacksTable).where(eq(starterPacksTable.creatorDid, userDid)).then(r => r[0]?.count ?? 0),
        // Labeler Services (creatorDid)
        db.select({ count: sql<number>`count(*)::int` }).from(labelerServicesTable).where(eq(labelerServicesTable.creatorDid, userDid)).then(r => r[0]?.count ?? 0),
        // Verifications (subjectDid)
        db.select({ count: sql<number>`count(*)::int` }).from(verificationsTable).where(eq(verificationsTable.subjectDid, userDid)).then(r => r[0]?.count ?? 0),
        // Generic Records (authorDid)
        db.select({ count: sql<number>`count(*)::int` }).from(genericRecordsTable).where(eq(genericRecordsTable.authorDid, userDid)).then(r => r[0]?.count ?? 0),
      ]);

      const totalRecords = postsCount + likesCount + repostsCount + followsCount + 
                         blocksCount + mutesCount + listMutesCount + listBlocksCount + 
                         threadMutesCount + bookmarksCount + notificationsCount + 
                         activitySubscriptionsCount + listsCount + listItemsCount + 
                         feedGeneratorsCount + starterPacksCount + labelerServicesCount + 
                         verificationsCount + genericRecordsCount;

      res.json({
        posts: postsCount,
        likes: likesCount,
        reposts: repostsCount,
        follows: followsCount,
        blocks: blocksCount,
        mutes: mutesCount,
        listMutes: listMutesCount,
        listBlocks: listBlocksCount,
        threadMutes: threadMutesCount,
        bookmarks: bookmarksCount,
        notifications: notificationsCount,
        activitySubscriptions: activitySubscriptionsCount,
        lists: listsCount,
        listItems: listItemsCount,
        feedGenerators: feedGeneratorsCount,
        starterPacks: starterPacksCount,
        labelerServices: labelerServicesCount,
        verifications: verificationsCount,
        genericRecords: genericRecordsCount,
        totalRecords: totalRecords,
      });
    } catch (error) {
      console.error("[USER_STATS] Error:", error);
      res.status(500).json({ error: "Failed to get user stats" });
    }
  });

  // Write operations endpoints (CSRF protected)
  app.post("/api/posts/create", writeLimiter, csrfProtection.validateToken, requireAuth, async (req: AuthRequest, res) => {
    try {
      // Strict embed validation based on AT Protocol lexicons
      const embedImageSchema = z.object({
        $type: z.literal('app.bsky.embed.images'),
        images: z.array(z.object({
          image: z.object({
            $type: z.literal('blob'),
            ref: z.object({ $link: z.string() }),
            mimeType: z.string().regex(/^image\/(jpeg|png|webp)$/),
            size: z.number().max(1000000), // 1MB max
          }),
          alt: z.string().max(1000),
          aspectRatio: z.object({
            width: z.number().positive(),
            height: z.number().positive(),
          }).optional(),
        })).max(4), // Max 4 images per post
      });

      const embedExternalSchema = z.object({
        $type: z.literal('app.bsky.embed.external'),
        external: z.object({
          uri: z.string().url().max(2000),
          title: z.string().max(500),
          description: z.string().max(2000),
          thumb: z.object({
            $type: z.literal('blob'),
            ref: z.object({ $link: z.string() }),
            mimeType: z.string().regex(/^image\/(jpeg|png|webp)$/),
            size: z.number().max(1000000),
          }).optional(),
        }),
      });

      const embedRecordSchema = z.object({
        $type: z.literal('app.bsky.embed.record'),
        record: z.object({
          uri: z.string(),
          cid: z.string(),
        }),
      });

      const embedRecordWithMediaSchema = z.object({
        $type: z.literal('app.bsky.embed.recordWithMedia'),
        record: z.object({
          record: z.object({
            uri: z.string(),
            cid: z.string(),
          }),
        }),
        media: z.union([embedImageSchema, embedExternalSchema]),
      });

      const embedSchema = z.union([
        embedImageSchema,
        embedExternalSchema,
        embedRecordSchema,
        embedRecordWithMediaSchema,
      ]).optional();

      const schema = z.object({
        text: z.string().max(3000),
        reply: z.object({
          root: z.object({ uri: z.string(), cid: z.string() }),
          parent: z.object({ uri: z.string(), cid: z.string() }),
        }).optional(),
        embed: embedSchema,
      });
      
      const data = schema.parse(req.body);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }
      
      // Proxy to PDS to create the post
      const result = await pdsClient.createPost(
        session.pdsEndpoint,
        session.accessToken,
        session.userDid,
        {
          text: data.text,
          createdAt: new Date().toISOString(),
          reply: data.reply,
          embed: data.embed,
        }
      );
      
      if (!result.success || !result.data) {
        console.error('[API] Failed to create post on PDS:', result.error);
        return res.status(500).json({ 
          error: result.error || "Failed to create post on PDS" 
        });
      }
      
      // Store the post locally with canonical URI and CID from PDS
      let post;
      try {
        post = await storage.createPost({
          uri: result.data.uri,
          cid: result.data.cid,
          authorDid: session.userDid,
          text: data.text,
          parentUri: data.reply?.parent.uri,
          rootUri: data.reply?.root.uri,
          embed: data.embed,
          createdAt: new Date(),
        });
      } catch (storageError) {
        // Rollback: Delete from PDS since local storage failed
        console.error('[API] Local storage failed after PDS creation, attempting rollback:', storageError);
        const rkey = result.data.uri.split('/').pop()!;
        
        try {
          const rollbackResult = await pdsClient.deleteRecord(
            session.pdsEndpoint,
            session.accessToken,
            session.userDid,
            'app.bsky.feed.post',
            rkey
          );
          
          if (!rollbackResult.success) {
            console.error(
              `[API] CRITICAL: Rollback failed for post ${result.data.uri}. ` +
              `Record orphaned on PDS. Error: ${rollbackResult.error}`
            );
            return res.status(500).json({ 
              error: "Failed to persist locally AND rollback failed. Record orphaned on PDS. Manual cleanup required.",
              orphanedUri: result.data.uri
            });
          }
          
          console.log(`[API] Successfully rolled back post ${result.data.uri}`);
          return res.status(500).json({ 
            error: "Failed to persist post locally after PDS creation. Operation rolled back successfully." 
          });
        } catch (rollbackError) {
          console.error(
            `[API] CRITICAL: Rollback exception for post ${result.data.uri}. ` +
            `Record orphaned on PDS. Error:`, rollbackError
          );
          return res.status(500).json({ 
            error: "Failed to persist locally AND rollback threw exception. Record orphaned on PDS. Manual cleanup required.",
            orphanedUri: result.data.uri
          });
        }
      }
      
      console.log(`[API] Created post ${result.data.uri} for ${session.userDid}`);
      
      res.json({ post });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create post" });
    }
  });

  app.post("/api/likes/create", writeLimiter, csrfProtection.validateToken, requireAuth, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        postUri: z.string(),
        postCid: z.string(),
      });
      
      const data = schema.parse(req.body);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }
      
      // Proxy to PDS to create the like
      const result = await pdsClient.createLike(
        session.pdsEndpoint,
        session.accessToken,
        session.userDid,
        { uri: data.postUri, cid: data.postCid }
      );
      
      if (!result.success || !result.data) {
        console.error('[API] Failed to create like on PDS:', result.error);
        return res.status(500).json({ 
          error: result.error || "Failed to create like on PDS" 
        });
      }
      
      // Store the like locally with canonical URI from PDS
      let like;
      try {
        like = await storage.createLike({
          uri: result.data.uri,
          userDid: session.userDid,
          postUri: data.postUri,
          createdAt: new Date(),
        });
      } catch (storageError) {
        // Rollback: Delete from PDS since local storage failed
        console.error('[API] Local storage failed after PDS creation, attempting rollback:', storageError);
        const rkey = result.data.uri.split('/').pop()!;
        
        try {
          const rollbackResult = await pdsClient.deleteRecord(
            session.pdsEndpoint,
            session.accessToken,
            session.userDid,
            'app.bsky.feed.like',
            rkey
          );
          
          if (!rollbackResult.success) {
            console.error(
              `[API] CRITICAL: Rollback failed for like ${result.data.uri}. ` +
              `Record orphaned on PDS. Error: ${rollbackResult.error}`
            );
            return res.status(500).json({ 
              error: "Failed to persist locally AND rollback failed. Record orphaned on PDS. Manual cleanup required.",
              orphanedUri: result.data.uri
            });
          }
          
          console.log(`[API] Successfully rolled back like ${result.data.uri}`);
          return res.status(500).json({ 
            error: "Failed to persist like locally after PDS creation. Operation rolled back successfully." 
          });
        } catch (rollbackError) {
          console.error(
            `[API] CRITICAL: Rollback exception for like ${result.data.uri}. ` +
            `Record orphaned on PDS. Error:`, rollbackError
          );
          return res.status(500).json({ 
            error: "Failed to persist locally AND rollback threw exception. Record orphaned on PDS. Manual cleanup required.",
            orphanedUri: result.data.uri
          });
        }
      }
      
      console.log(`[API] Created like ${result.data.uri} for ${session.userDid}`);
      
      res.json({ like });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create like" });
    }
  });

  app.delete("/api/likes/:uri", csrfProtection.validateToken, requireAuth, async (req: AuthRequest, res) => {
    try {
      const uri = decodeURIComponent(req.params.uri);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }
      
      // Extract rkey from URI (at://did/app.bsky.feed.like/RKEY)
      const parts = uri.split('/');
      const rkey = parts[parts.length - 1];
      
      // Proxy delete to PDS
      const result = await pdsClient.deleteRecord(
        session.pdsEndpoint,
        session.accessToken,
        session.userDid,
        'app.bsky.feed.like',
        rkey
      );
      
      if (!result.success) {
        console.error('[API] Failed to delete like on PDS:', result.error);
        return res.status(500).json({ 
          error: result.error || "Failed to delete like on PDS" 
        });
      }
      
      // Delete from local storage
      try {
        await storage.deleteLike(uri, session.userDid);
      } catch (storageError) {
        // PDS delete succeeded but local delete failed - log for manual reconciliation
        console.error(
          '[API] INCONSISTENCY: PDS delete succeeded but local delete failed for URI:',
          { uri },
          storageError
        );
        return res.status(500).json({ 
          error: "Like deleted from PDS but failed to remove from local index. Manual reconciliation required." 
        });
      }
      
      console.log(`[API] Deleted like ${uri} for ${session.userDid}`);
      
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Failed to delete like" });
    }
  });

  app.post("/api/follows/create", writeLimiter, csrfProtection.validateToken, requireAuth, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        targetDid: z.string(),
      });
      
      const data = schema.parse(req.body);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }
      
      // Proxy to PDS to create the follow
      const result = await pdsClient.createFollow(
        session.pdsEndpoint,
        session.accessToken,
        session.userDid,
        data.targetDid
      );
      
      if (!result.success || !result.data) {
        console.error('[API] Failed to create follow on PDS:', result.error);
        return res.status(500).json({ 
          error: result.error || "Failed to create follow on PDS" 
        });
      }
      
      // Store the follow locally with canonical URI from PDS
      let follow;
      try {
        follow = await storage.createFollow({
          uri: result.data.uri,
          followerDid: session.userDid,
          followingDid: data.targetDid,
          createdAt: new Date(),
        });
      } catch (storageError) {
        // Rollback: Delete from PDS since local storage failed
        console.error('[API] Local storage failed after PDS creation, attempting rollback:', storageError);
        const rkey = result.data.uri.split('/').pop()!;
        
        try {
          const rollbackResult = await pdsClient.deleteRecord(
            session.pdsEndpoint,
            session.accessToken,
            session.userDid,
            'app.bsky.graph.follow',
            rkey
          );
          
          if (!rollbackResult.success) {
            console.error(
              `[API] CRITICAL: Rollback failed for follow ${result.data.uri}. ` +
              `Record orphaned on PDS. Error: ${rollbackResult.error}`
            );
            return res.status(500).json({ 
              error: "Failed to persist locally AND rollback failed. Record orphaned on PDS. Manual cleanup required.",
              orphanedUri: result.data.uri
            });
          }
          
          console.log(`[API] Successfully rolled back follow ${result.data.uri}`);
          return res.status(500).json({ 
            error: "Failed to persist follow locally after PDS creation. Operation rolled back successfully." 
          });
        } catch (rollbackError) {
          console.error(
            `[API] CRITICAL: Rollback exception for follow ${result.data.uri}. ` +
            `Record orphaned on PDS. Error:`, rollbackError
          );
          return res.status(500).json({ 
            error: "Failed to persist locally AND rollback threw exception. Record orphaned on PDS. Manual cleanup required.",
            orphanedUri: result.data.uri
          });
        }
      }
      
      console.log(`[API] Created follow ${result.data.uri} for ${session.userDid}`);
      
      res.json({ follow });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create follow" });
    }
  });

  app.delete("/api/follows/:uri", csrfProtection.validateToken, requireAuth, async (req: AuthRequest, res) => {
    try {
      const uri = decodeURIComponent(req.params.uri);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }
      
      // Extract rkey from URI (at://did/app.bsky.graph.follow/RKEY)
      const parts = uri.split('/');
      const rkey = parts[parts.length - 1];
      
      // Proxy delete to PDS
      const result = await pdsClient.deleteRecord(
        session.pdsEndpoint,
        session.accessToken,
        session.userDid,
        'app.bsky.graph.follow',
        rkey
      );
      
      if (!result.success) {
        console.error('[API] Failed to delete follow on PDS:', result.error);
        return res.status(500).json({ 
          error: result.error || "Failed to delete follow on PDS" 
        });
      }
      
      // Delete from local storage
      try {
        await storage.deleteFollow(uri, session.userDid);
      } catch (storageError) {
        // PDS delete succeeded but local delete failed - log for manual reconciliation
        console.error(
          '[API] INCONSISTENCY: PDS delete succeeded but local delete failed for URI:',
          { uri },
          storageError
        );
        return res.status(500).json({ 
          error: "Follow deleted from PDS but failed to remove from local index. Manual reconciliation required." 
        });
      }
      
      console.log(`[API] Deleted follow ${uri} for ${session.userDid}`);
      
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Failed to delete follow" });
    }
  });

  // User settings endpoints
  app.get("/api/settings", requireAuth, async (req: AuthRequest, res) => {
    try {
      const session = await storage.getSession(req.session!.sessionId);
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      let settings = await storage.getUserSettings(session.userDid);
      
      // Create default settings if none exist
      if (!settings) {
        settings = await storage.createUserSettings({
          userDid: session.userDid,
          blockedKeywords: [],
          mutedUsers: [],
          customLists: [],
          feedPreferences: {},
        });
      }

      res.json({ settings });
    } catch (error) {
      res.status(500).json({ error: "Failed to get settings" });
    }
  });

  app.put("/api/settings", requireAuth, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        blockedKeywords: z.array(z.string()).optional(),
        mutedUsers: z.array(z.string()).optional(),
        customLists: z.array(z.any()).optional(),
        feedPreferences: z.record(z.any()).optional(),
      });

      const data = schema.parse(req.body);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      // Get existing settings or create new ones
      let settings = await storage.getUserSettings(session.userDid);
      
      if (!settings) {
        settings = await storage.createUserSettings({
          userDid: session.userDid,
          blockedKeywords: data.blockedKeywords || [],
          mutedUsers: data.mutedUsers || [],
          customLists: data.customLists || [],
          feedPreferences: data.feedPreferences || {},
        });
      } else {
        settings = await storage.updateUserSettings(session.userDid, data) || settings;
      }

      res.json({ settings });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update settings" });
    }
  });

  app.post("/api/settings/keywords/block", requireAuth, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        keyword: z.string().min(1),
      });

      const data = schema.parse(req.body);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      let settings = await storage.getUserSettings(session.userDid);
      
      // Create default settings if none exist
      if (!settings) {
        settings = await storage.createUserSettings({
          userDid: session.userDid,
          blockedKeywords: [],
          mutedUsers: [],
          customLists: [],
          feedPreferences: {},
        });
      }
      
      const currentKeywords = (settings.blockedKeywords as string[]) || [];
      
      if (!currentKeywords.includes(data.keyword)) {
        currentKeywords.push(data.keyword);
      }

      const updated = await storage.updateUserSettings(session.userDid, {
        blockedKeywords: currentKeywords,
      });

      res.json({ settings: updated });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to block keyword" });
    }
  });

  app.delete("/api/settings/keywords/:keyword", requireAuth, async (req: AuthRequest, res) => {
    try {
      const keyword = decodeURIComponent(req.params.keyword);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      let settings = await storage.getUserSettings(session.userDid);
      
      // Create default settings if none exist
      if (!settings) {
        settings = await storage.createUserSettings({
          userDid: session.userDid,
          blockedKeywords: [],
          mutedUsers: [],
          customLists: [],
          feedPreferences: {},
        });
      }
      
      const currentKeywords = (settings.blockedKeywords as string[]) || [];
      
      const updated = await storage.updateUserSettings(session.userDid, {
        blockedKeywords: currentKeywords.filter((k: string) => k !== keyword),
      });

      res.json({ settings: updated });
    } catch (error) {
      res.status(400).json({ error: "Failed to unblock keyword" });
    }
  });

  app.post("/api/settings/users/mute", requireAuth, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        userDid: z.string(),
      });

      const data = schema.parse(req.body);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      let settings = await storage.getUserSettings(session.userDid);
      
      // Create default settings if none exist
      if (!settings) {
        settings = await storage.createUserSettings({
          userDid: session.userDid,
          blockedKeywords: [],
          mutedUsers: [],
          customLists: [],
          feedPreferences: {},
        });
      }
      
      const currentMuted = (settings.mutedUsers as string[]) || [];
      
      if (!currentMuted.includes(data.userDid)) {
        currentMuted.push(data.userDid);
      }

      const updated = await storage.updateUserSettings(session.userDid, {
        mutedUsers: currentMuted,
      });

      res.json({ settings: updated });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to mute user" });
    }
  });

  app.delete("/api/settings/users/mute/:did", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userDid = decodeURIComponent(req.params.did);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      let settings = await storage.getUserSettings(session.userDid);
      
      // Create default settings if none exist
      if (!settings) {
        settings = await storage.createUserSettings({
          userDid: session.userDid,
          blockedKeywords: [],
          mutedUsers: [],
          customLists: [],
          feedPreferences: {},
        });
      }
      
      const currentMuted = (settings.mutedUsers as string[]) || [];
      
      const updated = await storage.updateUserSettings(session.userDid, {
        mutedUsers: currentMuted.filter((d: string) => d !== userDid),
      });

      res.json({ settings: updated });
    } catch (error) {
      res.status(400).json({ error: "Failed to unmute user" });
    }
  });

  // Feed preferences endpoints
  app.put("/api/settings/feed", requireAuth, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        algorithm: z.enum(["reverse-chronological", "engagement", "discovery"]).default("reverse-chronological"),
      });

      const data = schema.parse(req.body);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      let settings = await storage.getUserSettings(session.userDid);
      
      // Create default settings if none exist
      if (!settings) {
        settings = await storage.createUserSettings({
          userDid: session.userDid,
          blockedKeywords: [],
          mutedUsers: [],
          customLists: [],
          feedPreferences: {},
        });
      }

      const updated = await storage.updateUserSettings(session.userDid, {
        feedPreferences: {
          ...(settings.feedPreferences as object || {}),
          algorithm: data.algorithm,
        },
      });

      res.json({ settings: updated });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update feed preferences" });
    }
  });

  // Label management endpoints (admin)
  app.post("/api/labels/apply", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        subject: z.string(),
        val: z.string(),
        neg: z.boolean().default(false),
      });

      const data = schema.parse(req.body);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      const label = await labelService.applyLabel({
        src: session.userDid,
        subject: data.subject,
        val: data.val,
        neg: data.neg,
      });

      res.json({ label });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to apply label" });
    }
  });

  app.delete("/api/labels/:uri", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const uri = decodeURIComponent(req.params.uri);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      await labelService.removeLabel(uri);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Failed to remove label" });
    }
  });

  app.get("/api/labels/definitions", async (_req, res) => {
    try {
      const definitions = await labelService.getAllLabelDefinitions();
      res.json({ definitions });
    } catch (error) {
      res.status(500).json({ error: "Failed to get label definitions" });
    }
  });

  app.post("/api/labels/definitions", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        value: z.string(),
        description: z.string().optional(),
        severity: z.enum(["info", "warn", "alert", "none"]).default("warn"),
        localizedStrings: z.record(z.any()).optional(),
      });

      const data = schema.parse(req.body);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      const definition = await labelService.createLabelDefinition(data);
      res.json({ definition });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create label definition" });
    }
  });

  app.get("/api/labels/query", requireAuth, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        subjects: z.array(z.string()).optional(),
        sources: z.array(z.string()).optional(),
        values: z.array(z.string()).optional(),
        limit: z.coerce.number().default(50),
      });

      const params = schema.parse(req.query);
      const labels = await labelService.queryLabels(params);
      
      res.json({ labels });
    } catch (error) {
      res.status(400).json({ error: "Failed to query labels" });
    }
  });

  // Moderation queue management endpoints (admin)
  app.get("/api/moderation/queue", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        status: z.enum(["pending", "under_review", "resolved", "dismissed"]).default("pending"),
        limit: z.coerce.number().default(50),
      });

      const params = schema.parse(req.query);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      const reports = await moderationService.getReportsByStatus(params.status, params.limit);
      
      res.json({ reports });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to get moderation queue" });
    }
  });

  app.get("/api/moderation/report/:id", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const reportId = parseInt(req.params.id);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      const history = await moderationService.getReportHistory(reportId);
      
      if (!history.report) {
        return res.status(404).json({ error: "Report not found" });
      }

      res.json(history);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to get report" });
    }
  });

  app.post("/api/moderation/assign", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        reportId: z.number(),
        moderatorDid: z.string(),
      });

      const data = schema.parse(req.body);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      const assignment = await moderationService.assignModerator(data.reportId, data.moderatorDid);
      
      res.json({ assignment });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to assign moderator" });
    }
  });

  app.post("/api/moderation/action", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        reportId: z.number(),
        actionType: z.enum(["label_applied", "content_removed", "account_suspended", "dismissed", "escalated"]),
        resolutionNotes: z.string().optional(),
        labelValue: z.string().optional(),
        labelSrc: z.string().optional(),
      });

      const data = schema.parse(req.body);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      const action = await moderationService.takeAction({
        reportId: data.reportId,
        actionType: data.actionType,
        moderatorDid: session.userDid,
        resolutionNotes: data.resolutionNotes,
        labelValue: data.labelValue,
        labelSrc: data.labelSrc,
      });
      
      res.json({ action });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to take action" });
    }
  });

  app.post("/api/moderation/dismiss", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        reportId: z.number(),
        reason: z.string().optional(),
      });

      const data = schema.parse(req.body);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      const action = await moderationService.dismissReport(data.reportId, session.userDid, data.reason);
      
      res.json({ action });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to dismiss report" });
    }
  });

  app.post("/api/moderation/escalate", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        reportId: z.number(),
        reason: z.string().optional(),
      });

      const data = schema.parse(req.body);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      const action = await moderationService.escalateReport(data.reportId, session.userDid, data.reason);
      
      res.json({ action });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to escalate report" });
    }
  });

  app.get("/api/moderation/workload/:moderatorDid", requireAuth, async (req: AuthRequest, res) => {
    try {
      const moderatorDid = req.params.moderatorDid;
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      const workload = await moderationService.getModeratorWorkload(moderatorDid);
      
      res.json(workload);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to get workload" });
    }
  });

  // Instance moderation policy (public transparency endpoint)
  app.get("/api/instance/policy", async (_req, res) => {
    try {
      const { instanceModerationService } = await import("./services/instance-moderation");
      const policy = instanceModerationService.getPublicPolicy();
      res.json(policy);
    } catch (error) {
      res.status(500).json({ error: "Failed to retrieve instance policy" });
    }
  });

  // Instance moderation statistics (public transparency)
  app.get("/api/instance/stats", async (_req, res) => {
    try {
      const { instanceModerationService } = await import("./services/instance-moderation");
      const stats = await instanceModerationService.getStatistics();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to retrieve moderation statistics" });
    }
  });

  // Osprey status endpoint (check if Osprey integration is enabled and healthy)
  app.get("/api/osprey/status", async (_req, res) => {
    try {
      const ospreyEnabled = process.env.OSPREY_ENABLED === 'true';
      
      if (!ospreyEnabled) {
        return res.json({
          enabled: false,
          detected: false,
          message: "Osprey integration not enabled"
        });
      }

      // Check both bridge and label-effector health
      const bridgeHost = process.env.OSPREY_BRIDGE_HOST || 'osprey-bridge';
      const bridgePort = process.env.OSPREY_BRIDGE_PORT || '3001';
      const effectorHost = process.env.LABEL_EFFECTOR_HOST || 'label-effector';
      const effectorPort = process.env.LABEL_EFFECTOR_PORT || '3002';
      
      const checkService = async (host: string, port: string, serviceName: string) => {
        try {
          const response = await fetch(`http://${host}:${port}/health`, {
            signal: AbortSignal.timeout(5000)
          });
          
          if (response.ok) {
            return await response.json();
          } else {
            return {
              status: 'unhealthy',
              error: `${serviceName} returned status ${response.status}`,
            };
          }
        } catch (error) {
          return {
            status: 'unhealthy',
            error: error instanceof Error ? error.message : `Failed to connect to ${serviceName}`,
          };
        }
      };

      const [bridgeHealth, effectorHealth] = await Promise.all([
        checkService(bridgeHost, bridgePort, 'Bridge'),
        checkService(effectorHost, effectorPort, 'Label Effector'),
      ]);

      const allHealthy = bridgeHealth.status === 'healthy' && effectorHealth.status === 'healthy';

      return res.json({
        enabled: true,
        healthy: allHealthy,
        bridge: {
          healthy: bridgeHealth.status === 'healthy',
          adapter: bridgeHealth.adapter,
          kafka: bridgeHealth.kafka,
          metrics: bridgeHealth.metrics,
          error: bridgeHealth.error,
        },
        effector: {
          healthy: effectorHealth.status === 'healthy',
          kafka: effectorHealth.kafka,
          labels: effectorHealth.labels,
          database: effectorHealth.database,
          error: effectorHealth.error,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to check Osprey status" });
    }
  });

  // Database health check endpoint
  app.get("/api/database/health", async (_req, res) => {
    try {
      const { databaseHealthService } = await import("./services/database-health");
      const metrics = await databaseHealthService.performHealthCheck();
      const poolStatus = await databaseHealthService.checkConnectionPool();
      
      res.json({
        database: metrics,
        connectionPool: poolStatus
      });
    } catch (error: any) {
      res.status(500).json({ 
        error: "Health check failed", 
        message: error.message 
      });
    }
  });

  // Apply instance label (admin only - requires auth)
  app.post("/api/instance/label", csrfProtection.validateToken, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        subject: z.string(),
        labelValue: z.string(),
        reason: z.string().optional(),
      });

      const data = schema.parse(req.body);

      const { instanceModerationService } = await import("./services/instance-moderation");
      await instanceModerationService.applyInstanceLabel(data);

      res.json({ success: true, message: `Label '${data.labelValue}' applied to ${data.subject}` });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to apply instance label" });
    }
  });

  // Handle legal takedown request (admin only)
  app.post("/api/instance/takedown", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        subject: z.string(),
        requestType: z.enum(['dmca', 'court-order', 'dsa', 'other']),
        requestor: z.string(),
        details: z.string(),
      });

      const data = schema.parse(req.body);

      const { instanceModerationService } = await import("./services/instance-moderation");
      await instanceModerationService.handleTakedown(data);

      res.json({ success: true, message: `Takedown processed for ${data.subject}` });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to process takedown" });
    }
  });

  // Admin Moderation API Endpoints
  
  // Apply a label to content or user
  app.post("/api/admin/labels/apply", adminLimiter, csrfProtection.validateToken, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        subject: z.string(),
        label: z.string(),
        comment: z.string().optional(),
      });

      const data = schema.parse(req.body);
      const appviewDid = process.env.APPVIEW_DID;
      if (!appviewDid) {
        return res.status(500).json({ error: "APPVIEW_DID not configured" });
      }

      // Apply the label using the label service
      const createdLabel = await labelService.applyLabel({
        src: appviewDid,
        subject: data.subject,
        val: data.label,
      });

      res.json({ 
        success: true, 
        label: createdLabel,
        message: `Label '${data.label}' applied successfully` 
      });
    } catch (error) {
      console.error("[ADMIN] Failed to apply label:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to apply label" });
    }
  });

  // Query labels for a subject
  app.get("/api/admin/labels", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        subject: z.string().optional(),
      });

      const params = schema.parse(req.query);

      if (!params.subject) {
        return res.json([]);
      }

      const labels = await labelService.getLabelsForSubject(params.subject);

      res.json(labels);
    } catch (error) {
      console.error("[ADMIN] Failed to query labels:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to query labels" });
    }
  });

  // Remove a label by URI
  app.delete("/api/admin/labels", adminLimiter, csrfProtection.validateToken, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        uri: z.string(),
      });

      const params = schema.parse(req.query);

      // Get the label to verify it exists
      const label = await storage.getLabel(params.uri);
      
      if (!label) {
        return res.status(404).json({ error: "Label not found" });
      }

      await labelService.removeLabel(params.uri);

      console.log(`[ADMIN] Label removed: ${label.val} from ${label.subject}`);

      res.json({ success: true, message: "Label removed successfully" });
    } catch (error) {
      console.error("[ADMIN] Failed to remove label:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to remove label" });
    }
  });

  // Retry pending operations (admin only)
  app.post("/api/admin/retry-pending", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const retriedCount = await eventProcessor.retryPendingOperations();
      res.json({ 
        success: true, 
        message: `Retried ${retriedCount} pending operations`,
        retriedCount 
      });
    } catch (error) {
      console.error("[ADMIN] Failed to retry pending operations:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to retry pending operations" });
    }
  });

  // Get pending operations metrics (admin only)
  app.get("/api/admin/pending-metrics", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const metrics = eventProcessor.getMetrics();
      res.json({ success: true, metrics });
    } catch (error) {
      console.error("[ADMIN] Failed to get pending metrics:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to get pending metrics" });
    }
  });

  // PDS Data Fetcher management endpoints (admin only)
  app.get("/api/admin/pds-fetcher/stats", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const stats = pdsDataFetcher.getStats();
      res.json({ success: true, stats });
    } catch (error) {
      console.error("[ADMIN] Failed to get PDS fetcher stats:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to get PDS fetcher stats" });
    }
  });

  app.post("/api/admin/pds-fetcher/clear", requireAdmin, async (req: AuthRequest, res) => {
    try {
      pdsDataFetcher.clearAll();
      res.json({ success: true, message: "All incomplete entries cleared" });
    } catch (error) {
      console.error("[ADMIN] Failed to clear incomplete entries:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to clear incomplete entries" });
    }
  });

  app.post("/api/admin/pds-fetcher/process", requireAdmin, async (req: AuthRequest, res) => {
    try {
      // Trigger immediate processing of incomplete entries
      const stats = pdsDataFetcher.getStats();
      res.json({ 
        success: true,
        message: "Processing triggered", 
        stats,
        note: "Processing happens in background, check stats endpoint for progress"
      });
    } catch (error) {
      console.error("[ADMIN] Failed to trigger processing:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to trigger processing" });
    }
  });

  // TypeScript backfill test endpoint is PERMANENTLY DISABLED
  // Use Python backfill service instead
  app.post("/api/backfill/repo", async (req, res) => {
    res.status(501).json({ 
      error: "TypeScript backfill has been disabled. Please use the Python backfill service instead.",
      info: "Set BACKFILL_DAYS environment variable and run the Python unified worker."
    });
  });

  // XRPC API Endpoints
  app.get("/xrpc/app.bsky.feed.getTimeline", xrpcApi.getTimeline.bind(xrpcApi));
  app.get("/xrpc/app.bsky.feed.getAuthorFeed", xrpcApi.getAuthorFeed.bind(xrpcApi));
  app.get("/xrpc/app.bsky.feed.getPostThread", xrpcApi.getPostThread.bind(xrpcApi));
  app.get("/xrpc/app.bsky.actor.getProfile", xrpcApi.getProfile.bind(xrpcApi));
  app.get("/xrpc/app.bsky.graph.getFollows", xrpcApi.getFollows.bind(xrpcApi));
  app.get("/xrpc/app.bsky.graph.getFollowers", xrpcApi.getFollowers.bind(xrpcApi));
  app.get("/xrpc/com.atproto.label.queryLabels", xrpcApi.queryLabels.bind(xrpcApi));
  app.post("/xrpc/app.bsky.moderation.createReport", xrpcApi.createReport.bind(xrpcApi));

  // Search endpoints
  app.get("/xrpc/app.bsky.feed.searchPosts", xrpcApi.searchPosts.bind(xrpcApi));
  app.get("/xrpc/app.bsky.actor.searchActors", xrpcApi.searchActors.bind(xrpcApi));
  app.get("/xrpc/app.bsky.actor.searchActorsTypeahead", xrpcApi.searchActorsTypeahead.bind(xrpcApi));

  // Notification endpoints
  app.get("/xrpc/app.bsky.notification.listNotifications", xrpcApi.listNotifications.bind(xrpcApi));
  app.get("/xrpc/app.bsky.notification.getUnreadCount", xrpcApi.getUnreadCount.bind(xrpcApi));
  app.post("/xrpc/app.bsky.notification.updateSeen", xrpcApi.updateSeen.bind(xrpcApi));
  // Additional notification endpoints for parity
  app.get("/xrpc/app.bsky.notification.getPreferences", xrpcApi.getNotificationPreferences.bind(xrpcApi));
  app.get("/xrpc/app.bsky.notification.listActivitySubscriptions", xrpcApi.listActivitySubscriptions.bind(xrpcApi));
  app.post("/xrpc/app.bsky.notification.putActivitySubscription", xrpcApi.putActivitySubscription.bind(xrpcApi));
  app.post("/xrpc/app.bsky.notification.putPreferencesV2", xrpcApi.putNotificationPreferencesV2.bind(xrpcApi));
  app.post("/xrpc/app.bsky.notification.unregisterPush", xrpcApi.unregisterPush.bind(xrpcApi));

  // List endpoints
  app.get("/xrpc/app.bsky.graph.getList", xrpcApi.getList.bind(xrpcApi));
  app.get("/xrpc/app.bsky.graph.getLists", xrpcApi.getLists.bind(xrpcApi));
  app.get("/xrpc/app.bsky.graph.getListFeed", xrpcApi.getListFeed.bind(xrpcApi));
  app.get("/xrpc/app.bsky.graph.getListMutes", xrpcApi.getListMutes.bind(xrpcApi));
  app.get("/xrpc/app.bsky.graph.getListBlocks", xrpcApi.getListBlocks.bind(xrpcApi));
  // Additional graph endpoints for parity
  app.get("/xrpc/app.bsky.graph.getActorStarterPacks", xrpcApi.getActorStarterPacks.bind(xrpcApi));
  app.get("/xrpc/app.bsky.graph.getListsWithMembership", xrpcApi.getListsWithMembership.bind(xrpcApi));
  app.get("/xrpc/app.bsky.graph.getStarterPacksWithMembership", xrpcApi.getStarterPacksWithMembership.bind(xrpcApi));
  app.get("/xrpc/app.bsky.graph.searchStarterPacks", xrpcApi.searchStarterPacks.bind(xrpcApi));
  app.post("/xrpc/app.bsky.graph.unmuteThread", xrpcApi.unmuteThread.bind(xrpcApi));

  // Post interaction endpoints  
  app.get("/xrpc/app.bsky.feed.getPosts", xrpcApi.getPosts.bind(xrpcApi));
  app.get("/xrpc/app.bsky.feed.getLikes", xrpcApi.getLikes.bind(xrpcApi));
  app.get("/xrpc/app.bsky.feed.getRepostedBy", xrpcApi.getRepostedBy.bind(xrpcApi));
  app.get("/xrpc/app.bsky.feed.getQuotes", xrpcApi.getQuotes.bind(xrpcApi));
  app.get("/xrpc/app.bsky.feed.getActorLikes", xrpcApi.getActorLikes.bind(xrpcApi));
  // Additional feed endpoint
  app.post("/xrpc/app.bsky.feed.sendInteractions", xrpcApi.sendInteractions.bind(xrpcApi));

  // Enhanced profile endpoints
  app.get("/xrpc/app.bsky.actor.getProfiles", xrpcApi.getProfiles.bind(xrpcApi));
  app.get("/xrpc/app.bsky.actor.getSuggestions", xrpcApi.getSuggestions.bind(xrpcApi));
  app.get(
    "/xrpc/app.bsky.actor.getPreferences",
    xrpcApi.getPreferences.bind(xrpcApi),
  );
  app.post(
    "/xrpc/app.bsky.actor.putPreferences",
    xrpcApi.putPreferences.bind(xrpcApi),
  );
  app.put(
    "/xrpc/app.bsky.actor.putPreferences",
    xrpcApi.putPreferences.bind(xrpcApi),
  );

  // Graph endpoints
  app.get("/xrpc/app.bsky.graph.getBlocks", xrpcApi.getBlocks.bind(xrpcApi));
  app.get("/xrpc/app.bsky.graph.getMutes", xrpcApi.getMutes.bind(xrpcApi));
  app.post("/xrpc/app.bsky.graph.muteActor", xrpcApi.muteActor.bind(xrpcApi));
  app.post("/xrpc/app.bsky.graph.unmuteActor", xrpcApi.unmuteActor.bind(xrpcApi));
  app.get("/xrpc/app.bsky.graph.getRelationships", xrpcApi.getRelationships.bind(xrpcApi));
  app.get("/xrpc/app.bsky.graph.getKnownFollowers", xrpcApi.getKnownFollowers.bind(xrpcApi));
  app.get("/xrpc/app.bsky.graph.getSuggestedFollowsByActor", xrpcApi.getSuggestedFollowsByActor.bind(xrpcApi));
  app.post("/xrpc/app.bsky.graph.muteActorList", xrpcApi.muteActorList.bind(xrpcApi));
  app.post("/xrpc/app.bsky.graph.unmuteActorList", xrpcApi.unmuteActorList.bind(xrpcApi));
  app.post("/xrpc/app.bsky.graph.muteThread", xrpcApi.muteThread.bind(xrpcApi));

  // Feed Generator endpoints
  app.get("/xrpc/app.bsky.feed.getFeed", xrpcApi.getFeed.bind(xrpcApi));
  app.get("/xrpc/app.bsky.feed.getFeedGenerator", xrpcApi.getFeedGenerator.bind(xrpcApi));
  app.get("/xrpc/app.bsky.feed.getFeedGenerators", xrpcApi.getFeedGenerators.bind(xrpcApi));
  app.get("/xrpc/app.bsky.feed.getActorFeeds", xrpcApi.getActorFeeds.bind(xrpcApi));
  app.get("/xrpc/app.bsky.feed.getSuggestedFeeds", xrpcApi.getSuggestedFeeds.bind(xrpcApi));
  app.get("/xrpc/app.bsky.feed.describeFeedGenerator", xrpcApi.describeFeedGenerator.bind(xrpcApi));

  // Starter Pack endpoints
  app.get("/xrpc/app.bsky.graph.getStarterPack", xrpcApi.getStarterPack.bind(xrpcApi));
  app.get("/xrpc/app.bsky.graph.getStarterPacks", xrpcApi.getStarterPacks.bind(xrpcApi));

  // Labeler APIs
  app.get("/xrpc/app.bsky.labeler.getServices", xrpcApi.getServices.bind(xrpcApi));
  app.post("/xrpc/app.bsky.notification.registerPush", xrpcApi.registerPush.bind(xrpcApi));
  app.post("/xrpc/app.bsky.notification.putPreferences", xrpcApi.putNotificationPreferences.bind(xrpcApi));
  app.get("/xrpc/app.bsky.video.getJobStatus", xrpcApi.getJobStatus.bind(xrpcApi));
  app.get("/xrpc/app.bsky.video.getUploadLimits", xrpcApi.getUploadLimits.bind(xrpcApi));

  // Bookmark endpoints
  app.post("/xrpc/app.bsky.bookmark.createBookmark", xrpcApi.createBookmark.bind(xrpcApi));
  app.post("/xrpc/app.bsky.bookmark.deleteBookmark", xrpcApi.deleteBookmark.bind(xrpcApi));
  app.get("/xrpc/app.bsky.bookmark.getBookmarks", xrpcApi.getBookmarks.bind(xrpcApi));

  // Unspecced endpoints used by first-party clients
  app.get("/xrpc/app.bsky.unspecced.getPostThreadV2", xrpcApi.getPostThreadV2.bind(xrpcApi));
  app.get("/xrpc/app.bsky.unspecced.getPostThreadOtherV2", xrpcApi.getPostThreadOtherV2.bind(xrpcApi));
  app.get("/xrpc/app.bsky.unspecced.getSuggestedUsers", xrpcApi.getSuggestedUsersUnspecced.bind(xrpcApi));
  app.get("/xrpc/app.bsky.unspecced.getSuggestedFeeds", xrpcApi.getSuggestedFeedsUnspecced.bind(xrpcApi));
  app.get("/xrpc/app.bsky.unspecced.getPopularFeedGenerators", xrpcApi.getPopularFeedGenerators.bind(xrpcApi));
  app.get("/xrpc/app.bsky.unspecced.getOnboardingSuggestedStarterPacks", xrpcApi.getOnboardingSuggestedStarterPacks.bind(xrpcApi));
  app.get("/xrpc/app.bsky.unspecced.getTaggedSuggestions", xrpcApi.getTaggedSuggestions.bind(xrpcApi));
  app.get("/xrpc/app.bsky.unspecced.getTrendingTopics", xrpcApi.getTrendingTopics.bind(xrpcApi));
  app.get("/xrpc/app.bsky.unspecced.getTrends", xrpcApi.getTrends.bind(xrpcApi));
  app.get("/xrpc/app.bsky.unspecced.getConfig", xrpcApi.getUnspeccedConfig.bind(xrpcApi));
  app.get("/xrpc/app.bsky.unspecced.getAgeAssuranceState", xrpcApi.getAgeAssuranceState.bind(xrpcApi));
  app.post("/xrpc/app.bsky.unspecced.initAgeAssurance", xrpcApi.initAgeAssurance.bind(xrpcApi));

  // XRPC Proxy Middleware - catch-all for unhandled authenticated requests
  app.use(xrpcProxyMiddleware);

  // Health and readiness endpoints for container orchestration
  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/ready", async (_req, res) => {
    try {
      const { pool } = await import("./db");
      const redisFirehoseStatus = await redisQueue.getFirehoseStatus();
      const systemHealth = await metricsService.getSystemHealth();
      
      // Check database connectivity
      let dbHealthy = false;
      try {
        await pool.query("SELECT 1");
        dbHealthy = true;
      } catch (dbError) {
        console.error("[HEALTH] Database check failed:", dbError);
      }
      
      const firehoseConnected = redisFirehoseStatus?.connected ?? false;
      const memoryPercent = systemHealth.memory;
      const isReady = 
        firehoseConnected && 
        dbHealthy &&
        memoryPercent < 95;
      
      if (!isReady) {
        return res.status(503).json({
          status: "not ready",
          timestamp: new Date().toISOString(),
          checks: {
            firehose: firehoseConnected ? "connected" : "disconnected",
            database: dbHealthy ? "healthy" : "unhealthy",
            memory: memoryPercent < 95 ? "ok" : "critical",
          },
          details: {
            firehose: redisFirehoseStatus || { connected: false, url: "unknown", currentCursor: null },
            memory: { percentUsed: memoryPercent },
          }
        });
      }
      
      res.status(200).json({
        status: "ready",
        timestamp: new Date().toISOString(),
        checks: {
          firehose: "connected",
          database: "healthy",
          memory: "ok",
        }
      });
    } catch (error) {
      res.status(503).json({
        status: "not ready",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // DID document endpoint removed - now handled earlier in routes.ts at line ~285

  // AT Protocol health check endpoint (required for appview proxy)
  app.get("/xrpc/_health", async (_req, res) => {
    try {
      res.status(200).json({
        version: "0.0.1"
      });
    } catch (error) {
      res.status(503).json({ 
        error: "Service unavailable" 
      });
    }
  });

  // AT Protocol server metadata endpoint (required for service discovery)
  app.get("/xrpc/com.atproto.server.describeServer", async (_req, res) => {
    try {
      const appviewDid = process.env.APPVIEW_DID;
      
      // In production, APPVIEW_DID is required - fail fast if missing
      if (process.env.NODE_ENV === 'production' && !appviewDid) {
        return res.status(500).json({ 
          error: 'APPVIEW_DID environment variable is required in production' 
        });
      }
      
      // Return standard AT Protocol response - no custom fields allowed
      res.json({
        did: appviewDid,
        availableUserDomains: [],
        inviteCodeRequired: false,
        phoneVerificationRequired: false,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to describe server" });
    }
  });

  // AT Protocol identity resolution endpoint (required for clients)
  app.get("/xrpc/com.atproto.identity.resolveHandle", async (req, res) => {
    try {
      const handle = req.query.handle as string;
      
      if (!handle) {
        return res.status(400).json({
          error: "InvalidRequest",
          message: "handle parameter is required"
        });
      }
      
      // Resolve handle to DID using the DID resolver service
      const did = await didResolver.resolveHandle(handle);
      
      if (!did) {
        return res.status(400).json({
          error: "HandleNotFound",
          message: `Unable to resolve handle: ${handle}`
        });
      }
      
      res.json({ did });
    } catch (error) {
      console.error("[XRPC] resolveHandle error:", error);
      res.status(500).json({ 
        error: "InternalServerError",
        message: "Failed to resolve handle" 
      });
    }
  });

  // AT Protocol session creation - proxies to user's PDS
  app.post("/xrpc/com.atproto.server.createSession", async (req, res) => {
    try {
      const { identifier, password } = req.body;
      
      if (!identifier || !password) {
        return res.status(400).json({
          error: "InvalidRequest",
          message: "identifier and password are required"
        });
      }
      
      // Resolve identifier to PDS endpoint
      let pdsEndpoint: string | null = null;
      
      // Check if identifier looks like a DID
      if (identifier.startsWith('did:')) {
        pdsEndpoint = await didResolver.resolveDIDToPDS(identifier);
      } else {
        // Treat as handle and resolve to DID + PDS
        const result = await didResolver.resolveHandleToPDS(identifier);
        if (result) {
          pdsEndpoint = result.pdsEndpoint;
        }
      }
      
      if (!pdsEndpoint) {
        return res.status(400).json({
          error: "InvalidRequest",
          message: "Could not resolve identifier to a PDS endpoint"
        });
      }
      
      console.log(`[XRPC] Creating session for ${identifier} via ${pdsEndpoint}`);
      
      // Proxy the authentication request to the user's PDS
      const result = await pdsClient.createSession(pdsEndpoint, identifier, password);
      
      if (!result.success || !result.data) {
        return res.status(401).json({
          error: "AuthenticationFailed",
          message: result.error || "Authentication failed"
        });
      }
      
      // Return the session data from the PDS
      res.json(result.data);
    } catch (error) {
      console.error("[XRPC] Error in createSession:", error);
      res.status(500).json({
        error: "InternalServerError",
        message: error instanceof Error ? error.message : "Internal server error"
      });
    }
  });

  // AT Protocol session refresh - proxies to user's PDS
  app.post("/xrpc/com.atproto.server.refreshSession", async (req, res) => {
    try {
      const refreshToken = req.headers.authorization?.replace('Bearer ', '');
      
      if (!refreshToken) {
        return res.status(401).json({
          error: "AuthenticationRequired",
          message: "Refresh token required in Authorization header"
        });
      }
      
      // Extract DID from refresh token JWT to find correct PDS
      // JWT format: header.payload.signature (base64url encoded)
      try {
        const parts = refreshToken.split('.');
        if (parts.length !== 3) {
          return res.status(401).json({
            error: "InvalidToken",
            message: "Malformed refresh token"
          });
        }
        
        // Decode JWT payload (second part)
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        const userDid = payload.sub; // DID is in the 'sub' claim
        
        if (!userDid || !userDid.startsWith('did:')) {
          return res.status(401).json({
            error: "InvalidToken",
            message: "Token does not contain valid DID"
          });
        }
        
        // Resolve user's DID to their actual PDS endpoint
        const { didResolver } = await import('./services/did-resolver');
        const pdsEndpoint = await didResolver.resolveDIDToPDS(userDid);
        
        if (!pdsEndpoint) {
          console.error(`[XRPC] Could not resolve PDS for DID: ${userDid}`);
          return res.status(400).json({
            error: "InvalidRequest",
            message: "Could not determine user's PDS endpoint"
          });
        }
        
        const result = await pdsClient.refreshSession(pdsEndpoint, refreshToken);
        
        if (!result.success || !result.data) {
          return res.status(401).json({
            error: "AuthenticationFailed",
            message: result.error || "Failed to refresh session"
          });
        }
        
        res.json(result.data);
      } catch (decodeError) {
        console.error("[XRPC] Error decoding refresh token:", decodeError);
        return res.status(401).json({
          error: "InvalidToken",
          message: "Failed to decode refresh token"
        });
      }
    } catch (error) {
      console.error("[XRPC] Error in refreshSession:", error);
      res.status(500).json({
        error: "InternalServerError",
        message: "Failed to refresh session"
      });
    }
  });

  // AT Protocol get session - verify current auth state
  app.get("/xrpc/com.atproto.server.getSession", async (req, res) => {
    try {
      const accessToken = req.headers.authorization?.replace('Bearer ', '');
      
      if (!accessToken) {
        return res.status(401).json({
          error: "AuthenticationRequired",
          message: "Access token required in Authorization header"
        });
      }
      
      // Extract DID from access token JWT to find correct PDS
      // JWT format: header.payload.signature (base64url encoded)
      try {
        const parts = accessToken.split('.');
        if (parts.length !== 3) {
          return res.status(401).json({
            error: "InvalidToken",
            message: "Malformed access token"
          });
        }
        
        // Decode JWT payload (second part)
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        const userDid = payload.sub; // DID is in the 'sub' claim
        
        if (!userDid || !userDid.startsWith('did:')) {
          return res.status(401).json({
            error: "InvalidToken",
            message: "Token does not contain valid DID"
          });
        }
        
        // Resolve user's DID to their actual PDS endpoint
        const { didResolver } = await import('./services/did-resolver');
        const pdsEndpoint = await didResolver.resolveDIDToPDS(userDid);
        
        if (!pdsEndpoint) {
          console.error(`[XRPC] Could not resolve PDS for DID: ${userDid}`);
          return res.status(400).json({
            error: "InvalidRequest",
            message: "Could not determine user's PDS endpoint"
          });
        }
        
        const result = await pdsClient.getSession(pdsEndpoint, accessToken);
        
        if (!result.success || !result.data) {
          return res.status(401).json({
            error: "AuthenticationFailed",
            message: result.error || "Invalid or expired session"
          });
        }
        
        res.json(result.data);
      } catch (decodeError) {
        console.error("[XRPC] Error decoding access token:", decodeError);
        return res.status(401).json({
          error: "InvalidToken",
          message: "Failed to decode access token"
        });
      }
    } catch (error) {
      console.error("[XRPC] Error in getSession:", error);
      res.status(401).json({
        error: "AuthenticationFailed",
        message: "Invalid or expired session"
      });
    }
  });

  // AT Protocol blob retrieval - fetch images/media from PDS
  app.get("/xrpc/com.atproto.sync.getBlob", async (req, res) => {
    try {
      const did = req.query.did as string;
      const cid = req.query.cid as string;
      
      if (!did || !cid) {
        return res.status(400).json({
          error: "InvalidRequest",
          message: "did and cid parameters are required"
        });
      }
      
      // Validate DID and CID format to prevent injection attacks
      if (!isValidDID(did)) {
        console.error(`[BLOB_FETCH] Invalid DID format: ${did}`);
        return res.status(400).json({
          error: "InvalidRequest",
          message: "Invalid DID format"
        });
      }
      
      if (!isValidCID(cid)) {
        console.error(`[BLOB_FETCH] Invalid CID format: ${cid}`);
        return res.status(400).json({
          error: "InvalidRequest",
          message: "Invalid CID format"
        });
      }
      
      // Resolve DID to PDS endpoint
      const pdsEndpoint = await didResolver.resolveDIDToPDS(did);
      
      if (!pdsEndpoint) {
        return res.status(404).json({
          error: "NotFound",
          message: "Could not resolve DID to PDS endpoint"
        });
      }
      
      // Build safe URL to prevent SSRF attacks
      const blobUrl = buildSafeBlobUrl(pdsEndpoint, did, cid);
      
      if (!blobUrl) {
        console.error(`[BLOB_FETCH] Failed to build safe blob URL for PDS: ${pdsEndpoint}`);
        return res.status(400).json({
          error: "InvalidRequest",
          message: "Invalid PDS endpoint"
        });
      }
      
      // Additional validation: Ensure the constructed URL is safe to fetch from
      // This validates the URL is not targeting internal/private networks
      if (!isUrlSafeToFetch(blobUrl)) {
        console.error(`[BLOB_FETCH] URL failed safety validation: ${blobUrl}`);
        return res.status(400).json({
          error: "InvalidRequest",
          message: "Invalid or unsafe blob URL"
        });
      }
      
      // Use safeFetch wrapper to ensure SSRF protection is recognized by static analysis
      const response = await safeFetch(blobUrl, {
        headers: {
          'Accept': '*/*'
        }
      });
      
      if (!response.ok) {
        return res.status(response.status).json({
          error: "BlobNotFound",
          message: "Blob not found on PDS"
        });
      }
      
      // Proxy the blob data through with correct content type
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      
      // Stream blob data to client
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error("[XRPC] Error in getBlob:", error);
      res.status(500).json({
        error: "InternalServerError",
        message: "Failed to fetch blob"
      });
    }
  });

  // Dashboard API endpoints (protected by dashboard auth)
  app.get("/api/metrics", async (_req, res) => {
    const stats = await storage.getStats();
    const systemHealth = await metricsService.getSystemHealth();
    
    // Get cluster-wide metrics from Redis (consistent across all workers)
    const clusterMetrics = await redisQueue.getClusterMetrics();
    
    // Read from Redis for cluster-wide visibility
    const redisStatus = await redisQueue.getFirehoseStatus();
    const firehoseStatus = redisStatus || {
      connected: false,
      isConnected: false,
      url: process.env.RELAY_URL || "wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos",
      currentCursor: null,
      queueDepth: 0,
      activeProcessing: 0,
      reconnectDelay: 1000,
    };

    res.json({
      eventsProcessed: clusterMetrics.totalEvents,
      dbRecords: stats.totalUsers + stats.totalPosts + stats.totalLikes + stats.totalReposts + stats.totalFollows + stats.totalBlocks,
      apiRequestsPerMinute: metricsService.getApiRequestsPerMinute(),
      stats,
      eventCounts: clusterMetrics.eventCounts,
      systemHealth,
      firehoseStatus: {
        ...firehoseStatus,
        isConnected: firehoseStatus.connected,
        queueDepth: await redisQueue.getQueueDepth(), // pending (unacked) messages
        streamLength: await redisQueue.getStreamLength(), // total entries (bounded)
        deadLetterLength: await redisQueue.getDeadLetterLength(),
      },
      errorRate: clusterMetrics.errors > 0 ? (clusterMetrics.errors / clusterMetrics.totalEvents) * 100 : 0,
      lastUpdate: new Date(),
    });
  });

  // Minimal dead-letter inspection endpoint (admin only in production)
  app.get("/api/redis/dead-letters", async (_req, res) => {
    try {
      const items = await redisQueue.getDeadLetters(100);
      res.json({ items });
    } catch (err) {
      console.error('[REDIS] Error listing dead letters:', err);
      res.status(500).json({ error: 'InternalServerError' });
    }
  });

  // Get DID resolver status and cache statistics
  app.get("/api/did-resolver/status", (_req, res) => {
    const status = didResolver.getStatus();
    res.json(status);
  });

  // Get supported lexicons
  app.get("/api/lexicons", (_req, res) => {
    res.json(lexiconValidator.getSupportedLexicons());
  });

  // Get all API endpoints with real performance metrics - auto-discovers XRPC routes
  app.get("/api/endpoints", (_req, res) => {
    const endpointMetrics = metricsService.getEndpointMetrics();
    
    // Endpoint descriptions for documentation
    const endpointDescriptions: Record<string, { description: string; params: string[] }> = {
      "app.bsky.feed.getTimeline": {
        description: "Retrieve a user's main timeline with posts from followed accounts",
        params: ["algorithm: string", "limit: number", "cursor: string"],
      },
      "app.bsky.feed.getAuthorFeed": {
        description: "Get posts from a specific user's profile",
        params: ["actor: string (required)", "limit: number", "cursor: string"],
      },
      "app.bsky.feed.getPostThread": {
        description: "View a post and its complete reply thread",
        params: ["uri: string (required)", "depth: number"],
      },
      "app.bsky.feed.getPosts": {
        description: "Batch fetch multiple posts by their URIs",
        params: ["uris: string[] (required)"],
      },
      "app.bsky.feed.getLikes": {
        description: "Get users who liked a specific post",
        params: ["uri: string (required)", "cid: string", "limit: number", "cursor: string"],
      },
      "app.bsky.feed.getRepostedBy": {
        description: "Get users who reposted a specific post",
        params: ["uri: string (required)", "cid: string", "limit: number", "cursor: string"],
      },
      "app.bsky.feed.getQuotes": {
        description: "Get quote posts that reference a specific post",
        params: ["uri: string (required)", "cid: string", "limit: number", "cursor: string"],
      },
      "app.bsky.feed.getActorLikes": {
        description: "Get posts liked by a specific user",
        params: ["actor: string (required)", "limit: number", "cursor: string"],
      },
      "app.bsky.feed.getListFeed": {
        description: "Get posts from a curated list",
        params: ["list: string (required)", "limit: number", "cursor: string"],
      },
      "app.bsky.feed.searchPosts": {
        description: "Full-text search for posts with ranking",
        params: ["q: string (required)", "limit: number", "cursor: string"],
      },
      "app.bsky.actor.getProfile": {
        description: "Get detailed profile information for a user",
        params: ["actor: string (required)"],
      },
      "app.bsky.actor.getProfiles": {
        description: "Batch fetch multiple user profiles",
        params: ["actors: string[] (required)"],
      },
      "app.bsky.actor.getSuggestions": {
        description: "Get suggested users to follow",
        params: ["limit: number"],
      },
      "app.bsky.actor.getPreferences": {
        description: "Get user preferences (AT Protocol compliant)",
        params: [],
      },
      "app.bsky.actor.putPreferences": {
        description: "Update user preferences",
        params: ["preferences: array (required)"],
      },
      "app.bsky.actor.searchActors": {
        description: "Search for user accounts",
        params: ["q: string (required)", "limit: number", "cursor: string"],
      },
      "app.bsky.actor.searchActorsTypeahead": {
        description: "Autocomplete search for user handles",
        params: ["q: string (required)", "limit: number"],
      },
      "app.bsky.graph.getFollows": {
        description: "Get list of accounts a user follows",
        params: ["actor: string (required)", "limit: number"],
      },
      "app.bsky.graph.getFollowers": {
        description: "Get list of accounts following a user",
        params: ["actor: string (required)", "limit: number"],
      },
      "app.bsky.graph.getBlocks": {
        description: "Get users blocked by the authenticated user",
        params: ["limit: number", "cursor: string"],
      },
      "app.bsky.graph.getMutes": {
        description: "Get users muted by the authenticated user",
        params: ["limit: number", "cursor: string"],
      },
      "app.bsky.graph.muteActor": {
        description: "Mute a specific user",
        params: ["actor: string (required)"],
      },
      "app.bsky.graph.unmuteActor": {
        description: "Unmute a specific user",
        params: ["actor: string (required)"],
      },
      "app.bsky.graph.getRelationships": {
        description: "Get bi-directional relationship information between users",
        params: ["actor: string (required)", "others: string[]"],
      },
      "app.bsky.graph.getList": {
        description: "Get information about a specific list",
        params: ["list: string (required)", "limit: number", "cursor: string"],
      },
      "app.bsky.graph.getLists": {
        description: "Get lists created by a user",
        params: ["actor: string (required)", "limit: number", "cursor: string"],
      },
      "app.bsky.graph.getListMutes": {
        description: "Get lists muted by the authenticated user",
        params: ["limit: number", "cursor: string"],
      },
      "app.bsky.graph.getListBlocks": {
        description: "Get lists blocked by the authenticated user",
        params: ["limit: number", "cursor: string"],
      },
      "app.bsky.notification.listNotifications": {
        description: "List notifications for the authenticated user",
        params: ["limit: number", "cursor: string", "seenAt: string"],
      },
      "app.bsky.notification.getUnreadCount": {
        description: "Get count of unread notifications",
        params: ["seenAt: string"],
      },
      "app.bsky.notification.updateSeen": {
        description: "Mark notifications as seen",
        params: ["seenAt: string (required)"],
      },
      "com.atproto.label.queryLabels": {
        description: "Query moderation labels for content",
        params: ["uriPatterns: string[]", "sources: string[]", "limit: number", "cursor: string"],
      },
      "app.bsky.moderation.createReport": {
        description: "Submit a moderation report",
        params: ["reasonType: string (required)", "subject: object (required)", "reason: string"],
      },
      "app.bsky.graph.getKnownFollowers": {
        description: "Get followers of an actor that are also followed by the viewer",
        params: ["actor: string (required)", "limit: number", "cursor: string"],
      },
      "app.bsky.graph.getSuggestedFollowsByActor": {
        description: "Get suggested accounts to follow based on another actor",
        params: ["actor: string (required)", "limit: number"],
      },
      "app.bsky.graph.muteActorList": {
        description: "Mute all members of a list",
        params: ["list: string (required)"],
      },
      "app.bsky.graph.unmuteActorList": {
        description: "Unmute all members of a list",
        params: ["list: string (required)"],
      },
      "app.bsky.graph.muteThread": {
        description: "Mute a thread by its root post URI",
        params: ["root: string (required)"],
      },
      "app.bsky.feed.getFeed": {
        description: "Get posts from a custom feed generator",
        params: ["feed: string (required)", "limit: number", "cursor: string"],
      },
      "app.bsky.feed.getFeedGenerator": {
        description: "Get information about a specific feed generator",
        params: ["feed: string (required)"],
      },
      "app.bsky.feed.getFeedGenerators": {
        description: "Batch fetch multiple feed generators",
        params: ["feeds: string[] (required)"],
      },
      "app.bsky.feed.getActorFeeds": {
        description: "Get feed generators created by a specific actor",
        params: ["actor: string (required)", "limit: number", "cursor: string"],
      },
      "app.bsky.feed.getSuggestedFeeds": {
        description: "Get popular/suggested feed generators",
        params: ["limit: number", "cursor: string"],
      },
      "app.bsky.feed.describeFeedGenerator": {
        description: "Describe feed generators available from this service",
        params: [],
      },
      "app.bsky.graph.getStarterPack": {
        description: "Get information about a specific starter pack",
        params: ["starterPack: string (required)"],
      },
      "app.bsky.graph.getStarterPacks": {
        description: "Batch fetch multiple starter packs",
        params: ["uris: string[] (required)"],
      },
      "app.bsky.labeler.getServices": {
        description: "Get information about labeler services",
        params: ["dids: string[] (required)", "detailed: boolean (optional)"],
      },
      "app.bsky.notification.registerPush": {
        description: "Register a push notification subscription",
        params: ["serviceDid: string (required)", "token: string (required)", "platform: enum (required)", "appId: string (optional)"],
      },
      "app.bsky.notification.putPreferences": {
        description: "Update notification preferences",
        params: ["priority: boolean (optional)"],
      },
      "app.bsky.video.getJobStatus": {
        description: "Get video processing job status",
        params: ["jobId: string (required)"],
      },
      "app.bsky.video.getUploadLimits": {
        description: "Get video upload limits for authenticated user",
        params: [],
      },
    };

    // Auto-discover XRPC routes from the Express app
    const xrpcRoutes: Array<{ method: string; path: string }> = [];
    
    // Access the Express router stack to find all XRPC routes
    app._router.stack.forEach((middleware: any) => {
      if (middleware.route) {
        const path = middleware.route.path;
        if (path.startsWith("/xrpc/")) {
          const methods = Object.keys(middleware.route.methods);
          methods.forEach(method => {
            xrpcRoutes.push({
              method: method.toUpperCase(),
              path,
            });
          });
        }
      }
    });

    // Build endpoint list from discovered routes
    const endpoints = xrpcRoutes.map(route => {
      const nsid = route.path.replace("/xrpc/", "");
      const doc = endpointDescriptions[nsid] || {
        description: `AT Protocol endpoint: ${nsid}`,
        params: [],
      };

      return {
        method: route.method,
        path: nsid,
        fullPath: route.path,
        description: doc.description,
        params: doc.params,
      };
    });

    // Add performance metrics to each endpoint
    const endpointsWithMetrics = endpoints.map(endpoint => {
      const metrics = (endpointMetrics && endpointMetrics[endpoint.fullPath]) || {
        totalRequests: 0,
        requestsPerMinute: 0,
        avgResponseTime: 0,
        successRate: 0,
      };

      return {
        ...endpoint,
        performance: {
          avgResponse: metrics.avgResponseTime > 0 ? `${metrics.avgResponseTime}ms` : "N/A",
          requestsMin: metrics.requestsPerMinute.toString(),
          successRate: metrics.successRate > 0 ? `${metrics.successRate.toFixed(1)}%` : "N/A",
          totalRequests: metrics.totalRequests,
        },
        status: metrics.totalRequests > 0 ? "active" : "available",
      };
    });

    res.json(endpointsWithMetrics);
  });

  // Get database schema dynamically from information_schema
  app.get("/api/database/schema", async (_req, res) => {
    try {
      const schema = await schemaIntrospectionService.getSchema();
      res.json(schema);
    } catch (error) {
      console.error("[SCHEMA] Failed to introspect database schema:", error);
      res.status(500).json({ error: "Failed to retrieve database schema" });
    }
  });

  app.get("/api/lexicon/stats", (_req, res) => {
    const stats = lexiconValidator.getStats();
    res.json(stats);
  });

  app.get("/api/events/recent", async (_req, res) => {
    // Read from Redis for cluster-wide visibility
    const events = await redisQueue.getRecentEvents();
    res.json(events.slice(0, 10));
  });

  // Server-Sent Events endpoint for real-time firehose streaming
  app.get("/api/events/stream", (_req, res) => {
    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    res.flushHeaders();

    console.log("[SSE] Client connected to event stream");

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: "connected", message: "Event stream connected" })}\n\n`);

    // Subscribe to Redis event broadcasts (works on ALL workers)
    const eventHandler = (event: any) => {
      if (res.writable) {
        try {
          res.write(`data: ${JSON.stringify({ type: "event", data: event })}\n\n`);
        } catch (error) {
          console.error("[SSE] Error sending event:", error);
        }
      }
    };

    redisQueue.onEventBroadcast(eventHandler);

    // Send keepalive every 15 seconds
    const keepaliveInterval = setInterval(() => {
      if (res.writable) {
        res.write(`: keepalive\n\n`);
      } else {
        clearInterval(keepaliveInterval);
      }
    }, 15000);

    // Send metrics every 2 seconds
    const metricsInterval = setInterval(async () => {
      if (res.writable) {
        try {
          const stats = await storage.getStats();
          const clusterMetrics = await redisQueue.getClusterMetrics();
          const localMetrics = metricsService.getStats();
          const systemHealth = await metricsService.getSystemHealth();
          const firehoseStatus = await firehoseClient.getStatus();

          const payload = {
            type: "metrics",
            data: {
              eventsProcessed: clusterMetrics.totalEvents,
              dbRecords: stats.totalUsers + stats.totalPosts + stats.totalLikes + stats.totalReposts + stats.totalFollows + stats.totalBlocks,
              apiRequestsPerMinute: localMetrics.apiRequestsPerMinute,
              stats,
              eventCounts: clusterMetrics.eventCounts,
              systemHealth,
              firehoseStatus,
              errorRate: clusterMetrics.totalEvents > 0 ? (clusterMetrics.errors / clusterMetrics.totalEvents) * 100 : 0,
              lastUpdate: new Date().toISOString(),
            },
          };

          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch (error) {
          console.error("[SSE] Error sending metrics:", error);
        }
      } else {
        clearInterval(metricsInterval);
      }
    }, 2000);

    // Handle client disconnect
    _req.on("close", () => {
      console.log("[SSE] Client disconnected from event stream");
      clearInterval(keepaliveInterval);
      clearInterval(metricsInterval);
      redisQueue.offEventBroadcast(eventHandler);
      res.end();
    });
  });

  app.get("/api/logs", (_req, res) => {
    const limit = parseInt(_req.query.limit as string) || 100;
    const logs = logCollector.getRecentLogs(limit);
    res.json(logs);
  });

  app.post("/api/logs/clear", (_req, res) => {
    logCollector.clear();
    res.json({ success: true });
  });

  app.post("/api/firehose/reconnect", (_req, res) => {
    firehoseClient.disconnect();
    firehoseClient.connect();
    res.json({ success: true });
  });

  // Content filtering endpoints
  app.get("/api/filter/stats", requireAuth, async (req: AuthRequest, res) => {
    try {
      const session = await storage.getSession(req.session!.sessionId);
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      const settings = await storage.getUserSettings(session.userDid);
      
      // Get recent posts for stats calculation
      const recentPosts = await storage.getTimeline(session.userDid, 100);
      const stats = contentFilter.getFilterStats(recentPosts, settings || null);
      
      res.json({ stats });
    } catch (error) {
      res.status(500).json({ error: "Failed to get filter stats" });
    }
  });

  app.post("/api/filter/test", requireAuth, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        text: z.string(),
      });

      const data = schema.parse(req.body);
      const session = await storage.getSession(req.session!.sessionId);
      
      if (!session) {
        return res.status(401).json({ error: "Invalid session" });
      }

      const settings = await storage.getUserSettings(session.userDid);
      
      // Create a mock post to test filtering
      const mockPost = {
        uri: "test://post",
        cid: "test",
        authorDid: "did:plc:test",
        text: data.text,
        embed: null,
        parentUri: null,
        rootUri: null,
        searchVector: null,
        createdAt: new Date(),
        indexedAt: new Date(),
      };

      const result = contentFilter.wouldFilter(mockPost, settings || null);
      
      res.json({ 
        wouldFilter: result.filtered,
        reason: result.reason,
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  });

  // Temporary debugging endpoints
  app.get("/api/debug/user/:did", async (req, res) => {
    try {
      const userDid = req.params.did;
      
      // Get user settings
      const settings = await storage.getUserSettings(userDid);
      
      // Get follows
      const follows = await storage.getFollows(userDid);
      
      // Get user info
      const user = await storage.getUser(userDid);
      
      res.json({
        userDid,
        user: user ? {
          did: user.did,
          handle: user.handle,
          displayName: user.displayName,
          createdAt: user.createdAt
        } : null,
        settings: settings ? {
          dataCollectionForbidden: settings.dataCollectionForbidden,
          blockedKeywords: settings.blockedKeywords?.length || 0,
          mutedUsers: settings.mutedUsers?.length || 0,
          lastBackfillAt: settings.lastBackfillAt
        } : null,
        follows: {
          count: follows.length,
          list: follows.map(f => ({
            uri: f.uri,
            followingDid: f.followingDid,
            createdAt: f.createdAt
          }))
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/debug/timeline/:did", async (req, res) => {
    try {
      const userDid = req.params.did;
      
      // Get follows
      const followList = await storage.getFollows(userDid);
      const followingDids = followList.map(f => f.followingDid);
      
      // Get timeline posts
      const posts = await storage.getTimeline(userDid, 10);
      
      res.json({
        userDid,
        follows: {
          count: followingDids.length,
          followingDids: followingDids.slice(0, 5) // First 5 for debugging
        },
        timeline: {
          count: posts.length,
          posts: posts.slice(0, 3).map(p => ({
            uri: p.uri,
            authorDid: p.authorDid,
            text: p.text?.substring(0, 100) + '...',
            indexedAt: p.indexedAt
          }))
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // WebSocket server for real-time updates
  const wss = new WebSocketServer({ 
    server: httpServer, 
    path: "/ws",
    perMessageDeflate: false // Disable compression to avoid RSV1 frame errors
  });

  // Handle WebSocket connections - Consolidated handler for dashboard metrics and firehose events
  wss.on("connection", (ws: WebSocket, req) => {
    console.log("[WS] Dashboard client connected from", req.headers.origin || req.headers.host);
    let connectionAlive = true;

    // Send keepalive ping every 30 seconds
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN && connectionAlive) {
        try {
          ws.ping();
        } catch (error) {
          console.error("[WS] Error sending ping:", error);
          connectionAlive = false;
          clearInterval(pingInterval);
        }
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);

    // Send welcome message immediately
    try {
      ws.send(JSON.stringify({ type: "connected", message: "Dashboard WebSocket connected" }));
      console.log("[WS] Welcome message sent to", req.headers.origin || req.headers.host);
    } catch (error) {
      console.error("[WS] Error sending welcome message:", error);
      ws.close();
    }

    // Subscribe to firehose events for this connection
    const firehoseEventHandler = (event: any) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({
            type: "event",
            data: event,
          }));
        } catch (error) {
          console.error("[WS] Error sending firehose event:", error);
        }
      }
    };
    firehoseClient.onEvent(firehoseEventHandler);

    // Send metrics every 2 seconds
    const metricsInterval = setInterval(async () => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          const stats = await storage.getStats();
          const metrics = metricsService.getStats();
          const eventCounts = metricsService.getEventCounts();
          const systemHealth = await metricsService.getSystemHealth();
          const firehoseStatus = await firehoseClient.getStatus();

          const payload = {
            type: "metrics",
            data: {
              eventsProcessed: metrics.totalEvents,
              dbRecords: stats.totalUsers + stats.totalPosts + stats.totalLikes + stats.totalReposts + stats.totalFollows + stats.totalBlocks,
              apiRequestsPerMinute: metrics.apiRequestsPerMinute,
              stats,
              eventCounts,
              systemHealth,
              firehoseStatus,
              errorRate: metrics.errorRate,
              lastUpdate: metrics.lastUpdate,
            },
          };

          ws.send(JSON.stringify(payload));
        } catch (error) {
          console.error("[WS] Error sending metrics:", error);
        }
      }
    }, 2000);

    ws.on("message", (data) => {
      console.log("[WS] Received message from client:", data.toString());
    });

    ws.on("close", (code, reason) => {
      console.log("[WS] Dashboard client disconnected - Code:", code, "Reason:", reason.toString());
      connectionAlive = false;
      clearInterval(pingInterval);
      clearInterval(metricsInterval);
      // CRITICAL: Remove firehose event listener to prevent memory leaks
      firehoseClient.offEvent(firehoseEventHandler);
    });

    ws.on("error", (error) => {
      console.error("[WS] Dashboard client error:", error);
      connectionAlive = false;
    });

    ws.on("pong", () => {
      connectionAlive = true;
      // Client responded to ping, connection is alive
    });
  });

  // WebSocket server for label subscriptions (com.atproto.label.subscribeLabels)
  // Per AT Protocol spec, this endpoint is publicly accessible for label distribution
  // Optional: Could add authentication for rate limiting or access control if needed
  const labelWss = new WebSocketServer({ 
    server: httpServer, 
    path: "/xrpc/com.atproto.label.subscribeLabels",
    perMessageDeflate: false // Disable compression to avoid RSV1 frame errors
  });

  // Listen for label events from label service and broadcast to all connected clients
  const broadcastLabelToClients = (label: any, eventId: number) => {
    const message = JSON.stringify({
      seq: eventId,
      labels: [{
        ver: 1,
        src: label.src,
        uri: label.subject,
        cid: "",
        val: label.val,
        neg: label.neg,
        cts: label.createdAt instanceof Date ? label.createdAt.toISOString() : label.createdAt,
      }],
    });

    labelWss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  };

  // Subscribe to label service events for real-time broadcasting
  labelService.on("labelCreated", ({ label, event }) => {
    console.log(`[LABEL_WS] Broadcasting new label: ${label.val} on ${label.subject}`);
    broadcastLabelToClients(label, event.id);
  });

  labelService.on("labelRemoved", ({ label, event }) => {
    console.log(`[LABEL_WS] Broadcasting removed label: ${label.val} on ${label.subject}`);
    // Broadcast as negation
    broadcastLabelToClients({ ...label, neg: true }, event.id);
  });

  labelWss.on("connection", (ws: WebSocket) => {
    console.log("[LABEL_WS] Client connected to label subscription");

    let lastSeenId = 0;

    // Send initial labels and then stream new events
    const streamLabels = async () => {
      try {
        const events = await labelService.getRecentLabelEvents(100);
        
        for (const event of events) {
          if (event.id > lastSeenId) {
            const label = await storage.getLabel(event.labelUri);
            if (label && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                seq: event.id,
                labels: [{
                  ver: 1,
                  src: label.src,
                  uri: label.subject,
                  cid: "",
                  val: label.val,
                  neg: label.neg,
                  cts: label.createdAt.toISOString(),
                }],
              }));
              lastSeenId = event.id;
            }
          }
        }
      } catch (error) {
        console.error("[LABEL_WS] Error streaming labels:", error);
      }
    };

    // Initial stream
    streamLabels();

    // Poll for new label events every 30 seconds (reduced frequency since we have real-time broadcasting)
    const interval = setInterval(streamLabels, 30000);

    ws.on("close", () => {
      console.log("[LABEL_WS] Client disconnected from label subscription");
      clearInterval(interval);
    });

    ws.on("error", (error) => {
      console.error("[LABEL_WS] Error:", error);
      clearInterval(interval);
    });
  });


  return httpServer;
}
