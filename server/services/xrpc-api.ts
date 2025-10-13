import type { Request, Response } from "express";
import { storage } from "../storage";
import { authService, validateAndRefreshSession } from "./auth";
import { contentFilter } from "./content-filter";
import { feedAlgorithm } from "./feed-algorithm";
import { feedGeneratorClient } from "./feed-generator-client";
import { pdsClient } from "./pds-client";
import { labelService } from "./label";
import { moderationService } from "./moderation";
import { searchService } from "./search";
import { lazyDataLoader } from "./lazy-data-loader";
import { isUrlSafeToFetch } from "../utils/security";
import { z } from "zod";
import type { UserSettings } from "@shared/schema";
import { Hydrator } from "./hydration";
import { Views } from "./views";
import { enhancedHydrator } from "./hydration/index";

// Query schemas
const getTimelineSchema = z.object({
  algorithm: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getAuthorFeedSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
  filter: z.enum(['posts_with_replies', 'posts_no_replies', 'posts_with_media', 'posts_and_author_threads', 'posts_with_video']).default('posts_with_replies'),
  includePins: z.coerce.boolean().default(false),
});

const getPostThreadSchema = z.object({
  uri: z.string(),
  depth: z.coerce.number().min(0).max(10).default(6),
});

const getProfileSchema = z.object({
  actor: z.string(),
});

const getFollowsSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(100),
});

const queryLabelsSchema = z.object({
  uriPatterns: z.union([z.string(), z.array(z.string())]).transform(val => 
    typeof val === 'string' ? [val] : val
  ).optional(),
  sources: z.union([z.string(), z.array(z.string())]).transform(val => 
    typeof val === 'string' ? [val] : val
  ).optional(),
  limit: z.coerce.number().min(1).max(250).default(50),
  cursor: z.coerce.number().optional(),
});

const createReportSchema = z.object({
  reasonType: z.string().transform(val => {
    // Strip AT Protocol prefix if present (e.g., "com.atproto.moderation.defs#reasonSpam" -> "spam")
    const match = val.match(/^com\.atproto\.moderation\.defs#reason(.+)$/);
    return match ? match[1].toLowerCase() : val;
  }).pipe(z.enum(["spam", "violation", "misleading", "sexual", "rude", "other"])),
  reason: z.string().optional(),
  subject: z.object({
    $type: z.string(),
    uri: z.string().optional(),
    did: z.string().optional(),
    cid: z.string().optional(),
  }),
});

const searchPostsSchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

const searchActorsSchema = z.object({
  q: z.string().optional(),
  term: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
}).refine(data => data.q || data.term, {
  message: "Either 'q' or 'term' parameter is required"
});

const searchActorsTypeaheadSchema = z.object({
  q: z.string().optional(),
  term: z.string().optional(),
  limit: z.coerce.number().min(1).max(10).default(10),
}).refine(data => data.q || data.term, {
  message: "Either 'q' or 'term' parameter is required"
});

const listNotificationsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
  seenAt: z.string().optional(),
});

const updateSeenSchema = z.object({
  seenAt: z.string(),
});

const getListSchema = z.object({
  list: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getListsSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getListFeedSchema = z.object({
  list: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getPostsSchema = z.object({
  uris: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (Array.isArray(val) ? val : [val]))
    .pipe(
      z
        .array(z.string())
        .min(1, 'uris parameter cannot be empty')
        .max(25, 'Maximum 25 uris allowed'),
    ),
});

const getLikesSchema = z.object({
  uri: z.string(),
  cid: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getRepostedBySchema = z.object({
  uri: z.string(),
  cid: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getQuotesSchema = z.object({
  uri: z.string(),
  cid: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(50),
  cursor: z.string().optional(),
});

const getActorLikesSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getProfilesSchema = z.object({
  actors: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (Array.isArray(val) ? val : [val]))
    .pipe(
      z
        .array(z.string())
        .min(1, 'actors parameter cannot be empty')
        .max(25, 'Maximum 25 actors allowed'),
    ),
});

const getSuggestionsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getMutesSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const muteActorSchema = z.object({
  actor: z.string(),
});

const getBlocksSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getRelationshipsSchema = z.object({
  actor: z.string(),
  others: z.union([z.string(), z.array(z.string())]).transform(val => 
    typeof val === 'string' ? [val] : val
  ).optional(),
});

const getListMutesSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getListBlocksSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getKnownFollowersSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getSuggestedFollowsByActorSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(25),
});

const muteActorListSchema = z.object({
  list: z.string(),
});

const unmuteActorListSchema = z.object({
  list: z.string(),
});

const muteThreadSchema = z.object({
  root: z.string(), // URI of the thread root post
});

const getFeedSchema = z.object({
  feed: z.string(), // AT URI of feed generator
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getFeedGeneratorSchema = z.object({
  feed: z.string(),
});

const getFeedGeneratorsSchema = z.object({
  feeds: z.union([z.string(), z.array(z.string())]).transform(val => 
    typeof val === 'string' ? [val] : val
  ),
});

const getActorFeedsSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getSuggestedFeedsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getPopularFeedGeneratorsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
  query: z.string().optional(),
});

const describeFeedGeneratorSchema = z.object({
  // No required params
});

const getStarterPackSchema = z.object({
  starterPack: z.string(),
});

const getStarterPacksSchema = z.object({
  uris: z.union([z.string(), z.array(z.string())]).transform(val => 
    typeof val === 'string' ? [val] : val
  ),
});

const getLabelerServicesSchema = z.object({
  dids: z.union([z.string(), z.array(z.string())]).transform(val => 
    typeof val === 'string' ? [val] : val
  ),
  detailed: z.coerce.boolean().default(false).optional(),
});

const registerPushSchema = z.object({
  serviceDid: z.string(),
  token: z.string(),
  platform: z.enum(['ios', 'android', 'web']),
  appId: z.string().optional(),
});

const putNotificationPreferencesSchema = z.object({
  priority: z.boolean().optional(),
});

const getJobStatusSchema = z.object({
  jobId: z.string(),
});

const getUploadLimitsSchema = z.object({
  // No required params - authenticated endpoint
});

// Additional schemas for parity with upstream
const getNotificationPreferencesSchema = z.object({});
const listActivitySubscriptionsSchema = z.object({});
const putActivitySubscriptionSchema = z.object({
  subject: z.string().optional(),
  notifications: z.boolean().optional(),
});
const putNotificationPreferencesV2Schema = z.object({
  priority: z.boolean().optional(),
});
const unregisterPushSchema = z.object({
  token: z.string(),
});

// Actor preferences schemas - proper validation like Bluesky
const putActorPreferencesSchema = z.object({
  preferences: z.array(z.object({
    $type: z.string().min(1, "Preference must have a $type"),
    // Allow any additional properties for flexibility
  }).passthrough()).default([]),
});


const getActorStarterPacksSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
const getListsWithMembershipSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
const getStarterPacksWithMembershipSchema = z.object({
  actor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
const searchStarterPacksSchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

const sendInteractionsSchema = z.object({
  interactions: z
    .array(
      z.object({
        $type: z.string().optional(),
        subject: z.any().optional(),
        event: z.string().optional(),
        createdAt: z.string().optional(),
      }),
    )
    .default([]),
});

// Unspecced compatibility schemas (minimal)
const getPostThreadV2Schema = z.object({
  anchor: z.string(),
  depth: z.coerce.number().min(0).max(50).default(6),
  prioritizeFollowedUsers: z.coerce.boolean().optional(),
  sort: z.string().optional(),
  branchStartDepth: z.coerce.number().optional(),
  branchEndDepth: z.coerce.number().optional(),
});
const getPostThreadOtherV2Schema = z.object({
  anchor: z.string(),
  depth: z.coerce.number().min(0).max(50).default(3),
});
const suggestedUsersUnspeccedSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
const unspeccedNoParamsSchema = z.object({});

export class XRPCApi {
  // Preferences cache: DID -> { preferences: any[], timestamp: number }
  private preferencesCache = new Map<string, { preferences: any[]; timestamp: number }>();
  private readonly PREFERENCES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  
  // Handle resolution cache: handle -> { did: string, timestamp: number }
  private handleResolutionCache = new Map<string, { did: string; timestamp: number }>();
  private readonly HANDLE_RESOLUTION_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  constructor() {
    // Clear expired cache entries every minute
    setInterval(() => {
      this.cleanExpiredPreferencesCache();
      this.cleanExpiredHandleResolutionCache();
    }, 60 * 1000);
  }

  /**
   * Check if preferences cache entry is expired
   */
  private isPreferencesCacheExpired(cached: { preferences: any[]; timestamp: number }): boolean {
    return Date.now() - cached.timestamp > this.PREFERENCES_CACHE_TTL;
  }

  /**
   * Clean expired entries from preferences cache
   */
  private cleanExpiredPreferencesCache(): void {
    const now = Date.now();
    const expiredDids: string[] = [];
    
    this.preferencesCache.forEach((cached, did) => {
      if (now - cached.timestamp > this.PREFERENCES_CACHE_TTL) {
        expiredDids.push(did);
      }
    });
    
    expiredDids.forEach(did => {
      this.preferencesCache.delete(did);
    });
  }

  /**
   * Check if handle resolution cache entry is expired
   */
  private isHandleResolutionCacheExpired(cached: { did: string; timestamp: number }): boolean {
    return Date.now() - cached.timestamp > this.HANDLE_RESOLUTION_CACHE_TTL;
  }

  /**
   * Clean expired entries from handle resolution cache
   */
  private cleanExpiredHandleResolutionCache(): void {
    const now = Date.now();
    const expiredHandles: string[] = [];
    
    this.handleResolutionCache.forEach((cached, handle) => {
      if (now - cached.timestamp > this.HANDLE_RESOLUTION_CACHE_TTL) {
        expiredHandles.push(handle);
      }
    });
    
    expiredHandles.forEach(handle => {
      this.handleResolutionCache.delete(handle);
    });
  }

  /**
   * Get user session for PDS communication by DID
   */
  private async getUserSessionForDid(userDid: string): Promise<any> {
    // Get all sessions for the user
    const sessions = await storage.getUserSessions(userDid);
    for (const session of sessions) {
      // Validate and refresh session if needed
      const validatedSession = await validateAndRefreshSession(session.id);
      if (validatedSession) {
        return validatedSession;
      }
    }
    return null;
  }

  /**
   * Invalidate preferences cache for a specific user
   */
  public invalidatePreferencesCache(userDid: string): void {
    this.preferencesCache.delete(userDid);
    console.log(`[PREFERENCES] Cache invalidated for ${userDid}`);
  }

  private async getUserPdsEndpoint(userDid: string): Promise<string | null> {
    try {
      // Resolve DID document to find PDS endpoint
      const didDoc = await this.resolveDidDocument(userDid);
      if (!didDoc) return null;

      // Look for PDS endpoint in service endpoints
      const services = didDoc.service || [];
      const pdsService = services.find((service: any) => 
        service.type === 'AtprotoPersonalDataServer' || 
        service.id === '#atproto_pds'
      );

      if (pdsService && pdsService.serviceEndpoint) {
        const endpoint = pdsService.serviceEndpoint;
        
        // SECURITY: Validate PDS endpoint to prevent SSRF attacks
        // Malicious DID documents could point to internal services
        if (!isUrlSafeToFetch(endpoint)) {
          console.error(`[XRPC] SECURITY: Blocked unsafe PDS endpoint for ${userDid}: ${endpoint}`);
          return null;
        }
        
        return endpoint;
      }

      // Fallback: try to construct PDS URL from handle if available
      const user = await storage.getUser(userDid);
      if (user?.handle) {
        // For now, assume bsky.social PDS for handles ending in .bsky.social
        if (user.handle.endsWith('.bsky.social')) {
          return 'https://bsky.social';
        }
        // For other handles, try to construct PDS URL
        // This is a simplified approach - in production you'd need more sophisticated PDS discovery
        return `https://${user.handle.split('.').slice(-2).join('.')}`;
      }

      return null;
    } catch (error) {
      console.error(`[PREFERENCES] Error resolving PDS endpoint for ${userDid}:`, error);
      return null;
    }
  }

  private async resolveDidDocument(did: string): Promise<any | null> {
    try {
      // Simple DID resolution - in production you'd use a proper DID resolver
      const response = await fetch(`https://plc.directory/${did}`);
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (error) {
      console.error(`[PREFERENCES] Error resolving DID document for ${did}:`, error);
      return null;
    }
  }

  /**
   * Extract authenticated user DID from request
   * Returns null if no valid authentication token is present
   * Supports both local session tokens and AT Protocol access tokens
   */
  private async getAuthenticatedDid(req: Request): Promise<string | null> {
    try {
      const token = authService.extractToken(req);
      if (!token) {
        console.log(`[AUTH] No token found in request to ${req.path}`);
        return null;
      }
      
      const payload = await authService.verifyToken(token);
      if (!payload?.did) {
        console.log(`[AUTH] Token payload missing DID for ${req.path}`);
        return null;
      }
      // Enforce minimal audience/method checks if present
      // Skip for app password tokens (they're pre-validated by PDS)
      try {
        const anyPayload: any = payload;
        const appviewDid = process.env.APPVIEW_DID;
        if (!appviewDid) {
          return res.status(500).json({ error: "APPVIEW_DID not configured" });
        }
        const nsid = req.path.startsWith('/xrpc/') ? req.path.slice('/xrpc/'.length) : undefined;
        
        // Skip aud check for app password tokens (scope=com.atproto.appPassPrivileged)
        const isAppPassword = anyPayload.scope === 'com.atproto.appPassPrivileged';
        if (!isAppPassword && anyPayload.aud) {
          // Accept both base AppView DID and service-specific DID (with #bsky_appview fragment)
          const isBaseAppViewDid = anyPayload.aud === appviewDid;
          const isServiceAppViewDid = anyPayload.aud === `${appviewDid}#bsky_appview`;
          
          if (!isBaseAppViewDid && !isServiceAppViewDid) {
            console.warn(`[AUTH] aud mismatch. expected=${appviewDid} or ${appviewDid}#bsky_appview got=${anyPayload.aud}`);
            return null;
          }
        }
        if (anyPayload.lxm && nsid && anyPayload.lxm !== nsid) {
          console.warn(`[AUTH] lxm mismatch. expected=${nsid} got=${anyPayload.lxm}`);
          return null;
        }
      } catch {}

      return payload.did;
    } catch (error) {
      // Token verification failed (malformed, expired, etc.)
      console.error('[AUTH] Token verification failed for path:', { path: req.path }, error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Require authentication and return user DID
   * Sends 401 error response if not authenticated
   */
  private async requireAuthDid(req: Request, res: Response): Promise<string | null> {
    const did = await this.getAuthenticatedDid(req);
    if (!did) {
      console.log(`[AUTH] Authentication required but missing for ${req.path}`);
      res.status(401).json({ 
        error: "AuthMissing", 
        message: "Authentication Required" 
      });
      return null;
    }
    return did;
  }

  private _handleError(res: Response, error: unknown, context: string) {
    console.error(`[XRPC] Error in ${context}:`, error);
    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ error: 'InvalidRequest', message: error.errors });
    }
    // A simple check for a custom not found error or similar
    if (error instanceof Error && error.message.includes('NotFound')) {
      return res.status(404).json({ error: 'NotFound', message: error.message });
    }
    res
      .status(500)
      .json({ error: 'InternalServerError', message: 'An internal error occurred' });
  }

  private async _resolveActor(
    res: Response,
    actor: string,
  ): Promise<string | null> {
    if (actor.startsWith('did:')) {
      // A small optimization would be to check if the user exists in the DB.
      // But for now, subsequent queries will fail, which is acceptable.
      return actor;
    }
    
    const handle = actor.toLowerCase();
    
    // Check cache first
    const cached = this.handleResolutionCache.get(handle);
    if (cached && !this.isHandleResolutionCacheExpired(cached)) {
      console.log(`[RESOLVE_ACTOR] Cache hit for handle: ${actor} -> ${cached.did}`);
      return cached.did;
    }
    
    console.log(`[RESOLVE_ACTOR] Looking up handle: ${actor}`);
    const user = await storage.getUserByHandle(handle);
    if (!user) {
      console.log(`[RESOLVE_ACTOR] User not found in database: ${actor}`);
      res.status(404).json({ error: 'NotFound', message: 'Actor not found' });
      return null;
    }
    
    // Cache the result
    this.handleResolutionCache.set(handle, {
      did: user.did,
      timestamp: Date.now()
    });
    
    console.log(`[RESOLVE_ACTOR] Found user: ${actor} -> ${user.did}`);
    return user.did;
  }

  private cidFromBlobJson(json: any): string {
    if (json instanceof Object && json.ref) {
      return json.ref.toString();
    }
    // Handle the fact that parseRecordBytes() produces raw json rather than lexicon values
    if (json && json['$type'] === 'blob') {
      return (json['ref']?.['$link'] ?? '') as string;
    }
    return (json?.['cid'] ?? '') as string;
  }

  private transformBlobToCdnUrl(blobCid: string, userDid: string, format: 'avatar' | 'banner' | 'feed_thumbnail' | 'feed_fullsize' = 'feed_fullsize'): string | undefined {
    // Check for falsy values and the literal string "undefined"
    if (!blobCid || blobCid === 'undefined') return undefined;
    
    // Follow Bluesky AppView pattern: config.cdnUrl || `${config.publicUrl}/img`
    // IMG_URI_ENDPOINT is our cdnUrl (custom CDN endpoint)
    // PUBLIC_URL is our publicUrl (base URL of the application)
    const endpoint = process.env.IMG_URI_ENDPOINT || 
                     (process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/img` : null) ||
                     (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/img` : null) ||
                     (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}/img` : null);
    
    if (!endpoint) {
      console.error('[CDN_TRANSFORM] No PUBLIC_URL or IMG_URI_ENDPOINT configured - image URLs will fail AT Protocol validation');
      return undefined;
    }
    
    const cdnUrl = `${endpoint}/${format}/plain/${userDid}/${blobCid}@jpeg`;
    console.log(`[CDN_TRANSFORM] ${blobCid} -> ${cdnUrl}`);
    return cdnUrl;
  }
  
  // Transform a plain CID string (as stored in database) to CDN URL - same logic but clearer name
  private directCidToCdnUrl(cid: string, userDid: string, format: 'avatar' | 'banner' | 'feed_thumbnail' | 'feed_fullsize' = 'feed_fullsize'): string | undefined {
    return this.transformBlobToCdnUrl(cid, userDid, format);
  }

  // Helper to conditionally include avatar field only if URL is valid
  private maybeAvatar(avatarCid: string | null | undefined, did: string): { avatar: string } | {} {
    if (!avatarCid) return {};
    const url = this.transformBlobToCdnUrl(avatarCid, did, 'avatar');
    return url ? { avatar: url } : {};
  }

  // Helper to conditionally include banner field only if URL is valid
  private maybeBanner(bannerCid: string | null | undefined, did: string): { banner: string } | {} {
    if (!bannerCid) return {};
    const url = this.transformBlobToCdnUrl(bannerCid, did, 'banner');
    return url ? { banner: url } : {};
  }

  private createAuthorViewerState(authorDid: string, listMutes: Map<string, any>, listBlocks: Map<string, any>, listData?: Map<string, any>): any {
    const listMute = listMutes.get(authorDid);
    const listBlock = listBlocks.get(authorDid);
    
    return {
      $type: 'app.bsky.actor.defs#viewerState',
      muted: !!listMute,
      mutedByList: listMute ? {
        $type: 'app.bsky.graph.defs#listViewBasic',
        uri: listMute.listUri,
        name: listData?.get(listMute.listUri)?.name || listMute.listUri,
        purpose: listData?.get(listMute.listUri)?.purpose || 'app.bsky.graph.defs#modlist',
      } : undefined,
      blockedBy: false,
      blocking: undefined,
      blockingByList: listBlock ? {
        $type: 'app.bsky.graph.defs#listViewBasic',
        uri: listBlock.listUri,
        name: listData?.get(listBlock.listUri)?.name || listBlock.listUri,
        purpose: listData?.get(listBlock.listUri)?.purpose || 'app.bsky.graph.defs#modlist',
      } : undefined,
      following: undefined,
      followedBy: undefined,
      knownFollowers: undefined,
      activitySubscription: undefined,
    };
  }

  private async serializePostsEnhanced(posts: any[], viewerDid?: string) {
    const startTime = performance.now();
    
    if (posts.length === 0) {
      return [];
    }

    const postUris = posts.map((p) => p.uri);
    
    const state = await enhancedHydrator.hydratePosts(postUris, viewerDid);
    
    const hydrationTime = performance.now() - startTime;
    console.log(`[ENHANCED_HYDRATION] Hydrated ${postUris.length} posts in ${hydrationTime.toFixed(2)}ms`);

    const serializedPosts = posts.map((post) => {
      const hydratedPost = state.posts.get(post.uri);
      const author = state.actors.get(post.authorDid);
      const aggregation = state.aggregations.get(post.uri);
      const viewerState = state.viewerStates.get(post.uri);
      const actorViewerState = state.actorViewerStates.get(post.authorDid);
      const labels = state.labels.get(post.uri) || [];
      const authorLabels = state.labels.get(post.authorDid) || [];
      const hydratedEmbed = state.embeds.get(post.uri);

      // Author must have a valid handle at this point
      // Filter out DIDs (did:plc:xxx or did:web:xxx) and temporary handles (xxx.invalid) which are not valid handles
      if (!author?.handle || typeof author.handle !== 'string' || author.handle.trim() === '' || 
          author.handle.startsWith('did:') || author.handle.endsWith('.invalid')) {
        console.warn(`[XRPC] Skipping post ${post.uri} - invalid author handle (got: ${author?.handle || 'undefined'})`);
        return null;
      }
      
      const authorHandle = author.handle;

      const record: any = {
        $type: 'app.bsky.feed.post',
        text: hydratedPost?.text || post.text,
        createdAt: hydratedPost?.createdAt || post.createdAt.toISOString(),
      };

      if (hydratedPost?.embed || post.embed) {
        const embedData = hydratedPost?.embed || post.embed;
        if (embedData && typeof embedData === 'object' && embedData.$type) {
          let transformedEmbed = { ...embedData };
          
          if (embedData.$type === 'app.bsky.embed.images') {
            transformedEmbed.images = embedData.images?.map((img: any) => ({
              ...img,
              image: {
                ...img.image,
                ref: {
                  ...img.image.ref,
                  link: this.transformBlobToCdnUrl(img.image.ref.$link, post.authorDid, 'feed_fullsize')
                }
              }
            }));
          } else if (embedData.$type === 'app.bsky.embed.external' && embedData.external?.thumb?.ref?.$link) {
            transformedEmbed.external = {
              ...embedData.external,
              thumb: {
                ...embedData.external.thumb,
                ref: {
                  ...embedData.external.thumb.ref,
                  link: this.transformBlobToCdnUrl(embedData.external.thumb.ref.$link, post.authorDid, 'feed_thumbnail')
                }
              }
            };
          }
          
          record.embed = transformedEmbed;
        }
      }
      if (hydratedPost?.facets || post.facets) record.facets = hydratedPost?.facets || post.facets;
      if (hydratedPost?.reply) record.reply = hydratedPost.reply;

      const avatarUrl = author?.avatarUrl;
      const avatarCdn = avatarUrl 
        ? (avatarUrl.startsWith('http') ? avatarUrl : this.transformBlobToCdnUrl(avatarUrl, author.did, 'avatar'))
        : undefined;

      const postView: any = {
        $type: 'app.bsky.feed.defs#postView',
        uri: post.uri,
        cid: post.cid,
        author: {
          $type: 'app.bsky.actor.defs#profileViewBasic',
          did: post.authorDid,
          handle: authorHandle,
          displayName: author?.displayName ?? authorHandle,
          pronouns: author?.pronouns,
          ...(avatarCdn && { avatar: avatarCdn }),
          viewer: actorViewerState || {},
          labels: authorLabels,
          createdAt: author?.createdAt?.toISOString(),
        },
        record,
        replyCount: aggregation?.replyCount || 0,
        repostCount: aggregation?.repostCount || 0,
        likeCount: aggregation?.likeCount || 0,
        bookmarkCount: aggregation?.bookmarkCount || 0,
        quoteCount: aggregation?.quoteCount || 0,
        indexedAt: hydratedPost?.indexedAt || post.indexedAt.toISOString(),
        labels: labels,
        viewer: viewerState ? { 
          $type: 'app.bsky.feed.defs#viewerState',
          like: viewerState.likeUri || undefined, 
          repost: viewerState.repostUri || undefined,
          bookmarked: viewerState.bookmarked || false,
          threadMuted: viewerState.threadMuted || false,
          replyDisabled: viewerState.replyDisabled || false,
          embeddingDisabled: viewerState.embeddingDisabled || false,
          pinned: viewerState.pinned || false,
        } : {},
      };

      if (hydratedEmbed) {
        postView.embed = hydratedEmbed;
      }

      return postView;
    });

    // Filter out null entries (posts from authors without valid handles)
    return serializedPosts.filter(post => post !== null);
  }

  private async serializePosts(posts: any[], viewerDid?: string) {
    const useEnhancedHydration = process.env.ENHANCED_HYDRATION_ENABLED === 'true';
    
    if (useEnhancedHydration) {
      return this.serializePostsEnhanced(posts, viewerDid);
    }

    if (posts.length === 0) {
      return [];
    }

    const authorDids = Array.from(new Set(posts.map((p) => p.authorDid)));
    const postUris = posts.map((p) => p.uri);

    const [authors, likeUris, repostUris, aggregations, viewerStates, labels, authorLabels, listMutes, listBlocks, threadContexts] = await Promise.all([
      storage.getUsers(authorDids),
      viewerDid ? storage.getLikeUris(viewerDid, postUris) : new Map(),
      viewerDid ? storage.getRepostUris(viewerDid, postUris) : new Map(),
      storage.getPostAggregations(postUris),
      viewerDid ? storage.getPostViewerStates(postUris, viewerDid) : new Map(),
      labelService.getActiveLabelsForSubjects(postUris),
      labelService.getActiveLabelsForSubjects(authorDids),
      viewerDid ? storage.getListMutesForUsers(viewerDid, authorDids) : new Map(),
      viewerDid ? storage.getListBlocksForUsers(viewerDid, authorDids) : new Map(),
      storage.getThreadContexts(postUris),
    ]);

    // Check for missing authors (posts exist but authors don't)
    if (authors.length !== authorDids.length) {
      const foundDids = new Set(authors.map(a => a.did));
      const missingDids = authorDids.filter(did => !foundDids.has(did));
      console.warn(`[XRPC] serializePosts: ${missingDids.length} authors missing from database:`, missingDids);
      
      // Try to fetch missing authors on-demand
      console.log(`[XRPC] Attempting to fetch ${missingDids.length} missing authors...`);
      const fetchPromises = missingDids.map(did => 
        lazyDataLoader.ensureUserProfile(did).catch(err => {
          console.error(`[XRPC] Failed to fetch profile for ${did}:`, err);
        })
      );
      
      // Wait for all fetches to complete (with timeout)
      await Promise.race([
        Promise.all(fetchPromises),
        new Promise(resolve => setTimeout(resolve, 5000)) // 5 second timeout
      ]);
      
      // Re-fetch authors after lazy loading
      const refetchedAuthors = await storage.getUsers(missingDids);
      authors.push(...refetchedAuthors);
      console.log(`[XRPC] Successfully fetched ${refetchedAuthors.length}/${missingDids.length} missing authors`);
      
      if (refetchedAuthors.length < missingDids.length) {
        const stillMissingDids = missingDids.filter(did => 
          !refetchedAuthors.some(a => a.did === did)
        );
        console.warn(`[XRPC] Still missing ${stillMissingDids.length} authors after lazy load:`, stillMissingDids);
      }
    }

    // Fetch counts for each author
    const authorCounts = new Map<string, { lists: number; feedgens: number; starterPacks: number; isLabeler: boolean }>();
    await Promise.all(authorDids.map(async (authorDid) => {
      const [userLists, userFeedgens, userStarterPacks, labelerServices] = await Promise.all([
        storage.getUserLists(authorDid),
        storage.getActorFeeds(authorDid),
        storage.getStarterPacksByCreator(authorDid),
        storage.getLabelerServicesByCreator(authorDid)
      ]);
      
      authorCounts.set(authorDid, {
        lists: userLists.length,
        feedgens: userFeedgens.generators.length,
        starterPacks: userStarterPacks.starterPacks.length,
        isLabeler: labelerServices.length > 0
      });
    }));

    // Collect all unique list URIs from mutes and blocks
    const listUris = new Set<string>();
    listMutes.forEach((mute) => listUris.add(mute.listUri));
    listBlocks.forEach((block) => listUris.add(block.listUri));
    
    // Fetch list data for all unique list URIs
    const listData = new Map<string, any>();
    if (listUris.size > 0) {
      const lists = await Promise.all(
        Array.from(listUris).map(uri => storage.getList(uri))
      );
      lists.forEach((list, index) => {
        if (list) {
          listData.set(Array.from(listUris)[index], list);
        }
      });
    }

    const authorsByDid = new Map(authors.map((a) => [a.did, a]));

    // Batch-fetch parent and root posts for reply hydration
    const replyParentUris = new Set<string>();
    const replyRootUris = new Set<string>();
    posts.forEach((post) => {
      if (post.parentUri) {
        replyParentUris.add(post.parentUri);
        replyRootUris.add(post.rootUri || post.parentUri);
      }
    });

    const replyPosts = await storage.getPosts(
      Array.from(replyParentUris).concat(Array.from(replyRootUris)),
    );
    const replyPostsByUri = new Map(replyPosts.map((p) => [p.uri, p]));

    return posts.map((post) => {
      const author = authorsByDid.get(post.authorDid);
      const likeUri = likeUris.get(post.uri);
      const repostUri = repostUris.get(post.uri);
      const aggregation = aggregations.get(post.uri);
      const viewerState = viewerStates.get(post.uri);

      // Ensure author handle is always present and valid
      // Author must have a valid handle at this point
      // Filter out DIDs (did:plc:xxx or did:web:xxx) and temporary handles (xxx.invalid) which are not valid handles
      if (!author?.handle || typeof author.handle !== 'string' || author.handle.trim() === '' || 
          author.handle.startsWith('did:') || author.handle.endsWith('.invalid')) {
        console.warn(`[XRPC] Skipping post ${post.uri} - invalid author handle (got: ${author?.handle || 'undefined'})`);
        return null;
      }
      
      const authorHandle = author.handle;

      let reply = undefined;
      if (post.parentUri) {
        const parentPost = replyPostsByUri.get(post.parentUri);
        const rootUri = post.rootUri || post.parentUri;
        const rootPost = replyPostsByUri.get(rootUri);

        if (parentPost && rootPost) {
          reply = {
            $type: 'app.bsky.feed.defs#replyRef',
            root: { 
              $type: 'com.atproto.repo.strongRef',
              uri: rootUri, 
              cid: rootPost.cid 
            },
            parent: { 
              $type: 'com.atproto.repo.strongRef',
              uri: post.parentUri, 
              cid: parentPost.cid 
            },
          };
        }
      }

      const record: any = {
        $type: 'app.bsky.feed.post',
        text: post.text,
        createdAt: post.createdAt.toISOString(),
      };

      if (post.embed) {
        // Ensure embed has proper $type field and is an object
        if (post.embed && typeof post.embed === 'object' && post.embed.$type) {
          // Transform blob references to CDN URLs
          let transformedEmbed = { ...post.embed };
          
          if (post.embed.$type === 'app.bsky.embed.images') {
            // Handle image embeds
            transformedEmbed.images = post.embed.images?.map((img: any) => ({
              ...img,
              image: {
                ...img.image,
                ref: {
                  ...img.image.ref,
                  link: this.transformBlobToCdnUrl(img.image.ref.$link, post.authorDid, 'feed_fullsize')
                }
              }
            }));
          } else if (post.embed.$type === 'app.bsky.embed.external' && post.embed.external?.thumb?.ref?.$link) {
            // Handle external embeds with thumbnails
            transformedEmbed.external = {
              ...post.embed.external,
              thumb: {
                ...post.embed.external.thumb,
                ref: {
                  ...post.embed.external.thumb.ref,
                  link: this.transformBlobToCdnUrl(post.embed.external.thumb.ref.$link, post.authorDid, 'feed_thumbnail')
                }
              }
            };
          }
          
          record.embed = transformedEmbed;
        } else {
          console.warn(`[SERIALIZE_POSTS] Invalid embed for post ${post.uri}:`, post.embed);
          // Don't include invalid embeds
        }
      }
      if (post.facets) record.facets = post.facets;
      if (reply) record.reply = reply;

      return {
        $type: 'app.bsky.feed.defs#postView',
        uri: post.uri,
        cid: post.cid,
        author: (() => {
          const avatarUrl = author?.avatarUrl ? this.transformBlobToCdnUrl(author.avatarUrl, author.did, 'avatar') : undefined;
          return {
            $type: 'app.bsky.actor.defs#profileViewBasic',
            did: post.authorDid,
            handle: authorHandle,
            displayName: author?.displayName ?? authorHandle,
            pronouns: author?.pronouns,
            ...(avatarUrl && { avatar: avatarUrl }),
            associated: {
            $type: 'app.bsky.actor.defs#profileAssociated',
            lists: authorCounts.get(post.authorDid)?.lists || 0,
            feedgens: authorCounts.get(post.authorDid)?.feedgens || 0,
            starterPacks: authorCounts.get(post.authorDid)?.starterPacks || 0,
            labeler: authorCounts.get(post.authorDid)?.isLabeler || false,
            chat: undefined, // TODO: Implement chat settings when chat functionality is added
            activitySubscription: undefined, // TODO: Implement activity subscription
          },
            viewer: this.createAuthorViewerState(post.authorDid, listMutes, listBlocks, listData),
            labels: authorLabels.get(post.authorDid) || [],
            createdAt: author?.createdAt?.toISOString(),
            verification: undefined, // TODO: Implement verification state when verification functionality is added
            status: undefined, // TODO: Implement status view
          };
        })(),
        record,
        replyCount: aggregation?.replyCount || 0,
        repostCount: aggregation?.repostCount || 0,
        likeCount: aggregation?.likeCount || 0,
        bookmarkCount: aggregation?.bookmarkCount || 0,
        quoteCount: aggregation?.quoteCount || 0,
        indexedAt: post.indexedAt.toISOString(),
        labels: labels.get(post.uri) || [],
        viewer: viewerState ? { 
          $type: 'app.bsky.feed.defs#viewerState',
          like: viewerState.likeUri || undefined, 
          repost: viewerState.repostUri || undefined,
          bookmarked: viewerState.bookmarked || false,
          threadMuted: viewerState.threadMuted || false,
          replyDisabled: viewerState.replyDisabled || false,
          embeddingDisabled: viewerState.embeddingDisabled || false,
          pinned: viewerState.pinned || false,
        } : {},
      };
    }).filter(post => post !== null);
  }

  async getTimeline(req: Request, res: Response) {
    try {
      const params = getTimelineSchema.parse(req.query);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      // Extract access token for PDS requests
      const token = authService.extractToken(req);
      
      // Lazy load: Ensure user's follows are in the database
      if (token) {
        await lazyDataLoader.ensureUserFollows(userDid, token);
      }

      // Debug: Check user's follows and total posts in database
      const followList = await storage.getFollows(userDid);
      const totalPosts = await storage.getStats();
      
      console.log(`[TIMELINE_DEBUG] User ${userDid} has ${followList.length} follows, ${totalPosts.totalPosts} total posts in DB`);

      // Lazy load: Ensure we have recent posts for followed users
      if (followList.length > 0) {
        const followedDids = followList.map(f => f.followingDid);
        // Don't await - let it run in background after we return response
        lazyDataLoader.ensureRecentPostsForUsers(followedDids, userDid).catch(error => {
          console.error('[TIMELINE] Background post fetch failed:', error);
        });
      }

      let posts = await storage.getTimeline(userDid, params.limit, params.cursor);
      
      console.log(`[TIMELINE_DEBUG] Retrieved ${posts.length} posts for timeline`);

      const settings = await storage.getUserSettings(userDid);
      if (settings) {
        posts = contentFilter.filterPosts(posts, settings);
      }

      let algorithmParam = params.algorithm;
      if (!algorithmParam && settings?.feedPreferences) {
        const prefs = settings.feedPreferences as { algorithm?: string };
        algorithmParam = prefs.algorithm;
      }
      const algorithm = feedAlgorithm.parseAlgorithm(algorithmParam);
      const rankedPosts = await feedAlgorithm.applyAlgorithm(posts, algorithm);

      const oldestPost =
        posts.length > 0
          ? posts.reduce((oldest, post) =>
              post.indexedAt < oldest.indexedAt ? post : oldest,
            )
          : null;

      const serializedPosts = await this.serializePosts(rankedPosts, userDid);

      // Filter out any null entries
      const validPosts = serializedPosts.filter(post => post !== null);
      
      res.json({
        cursor: oldestPost ? oldestPost.indexedAt.toISOString() : undefined,
        feed: validPosts.map((post) => ({ post })),
      });
    } catch (error) {
      this._handleError(res, error, 'getTimeline');
    }
  }

  async getAuthorFeed(req: Request, res: Response) {
    try {
      const params = getAuthorFeedSchema.parse(req.query);

      const authorDid = await this._resolveActor(res, params.actor);
      if (!authorDid) return;

      const viewerDid = await this.getAuthenticatedDid(req);

      // Lazy load: Ensure author's profile and posts exist
      await lazyDataLoader.ensureUserProfile(authorDid);
      await lazyDataLoader.ensureRecentPostsForUsers([authorDid], viewerDid || authorDid);

      // Get the author's profile to check for pinned posts
      const author = await storage.getUser(authorDid);
      if (!author) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      // Check for blocking relationships
      if (viewerDid) {
        const blocks = await storage.getBlocksBetweenUsers(viewerDid, [authorDid]);
        if (blocks.length > 0) {
          return res.status(400).json({ 
            error: `Requester has blocked actor: ${authorDid}`,
            name: 'BlockedActor'
          });
        }

        const blockedBy = await storage.getBlocksBetweenUsers(authorDid, [viewerDid]);
        if (blockedBy.length > 0) {
          return res.status(400).json({ 
            error: `Requester is blocked by actor: ${authorDid}`,
            name: 'BlockedByActor'
          });
        }
      }

      // Get feed items using the new feed system
      const feedResult = await storage.getAuthorFeed(
        authorDid,
        params.limit,
        params.cursor,
        params.filter
      );

      let items = feedResult.items;

      // Handle pinned posts
      if (params.includePins && author.pinnedPost && !params.cursor) {
        const pinnedPost = author.pinnedPost as { uri: string; cid: string };
        const pinnedItem = {
          post: {
            uri: pinnedPost.uri,
            cid: pinnedPost.cid,
          },
          authorPinned: true,
        };

        // Remove any existing pinned post from the feed and add it to the top
        items = items.filter((item) => item.post.uri !== pinnedItem.post.uri);
        items.unshift(pinnedItem);
      }

      // Extract post URIs for hydration
      const postUris = items.map(item => item.post.uri);

      // Fetch posts from storage for serialization
      const posts = await storage.getPosts(postUris);
      
      // Fetch reposts and reposter profiles for reason construction
      const repostUris = items
        .filter(item => item.repost)
        .map(item => item.repost!.uri);
      
      const reposts = await Promise.all(
        repostUris.map(uri => storage.getRepost(uri))
      );
      const repostsByUri = new Map(
        reposts.filter(Boolean).map(r => [r!.uri, r!])
      );

      // Get all reposter DIDs for profile fetching
      const reposterDids = Array.from(repostsByUri.values()).map(r => r.repostedByDid);
      const reposters = await Promise.all(
        reposterDids.map(did => storage.getUser(did))
      );
      const repostersByDid = new Map(
        reposters.filter(Boolean).map(u => [u!.did, u!])
      );

      // Apply content filtering if viewer is authenticated
      let filteredPosts = posts;
      if (viewerDid) {
        const settings = await storage.getUserSettings(viewerDid);
        if (settings) {
          filteredPosts = contentFilter.filterPosts(posts, settings);
        }
      }

      // Serialize posts with enhanced hydration (when flag is enabled)
      const serializedPosts = await this.serializePosts(filteredPosts, viewerDid);
      const postsByUri = new Map(serializedPosts.map(p => [p.uri, p]));

      // Build feed with reposts and pinned posts
      const feed = items
        .map(item => {
          const post = postsByUri.get(item.post.uri);
          if (!post) return null;

          let reason: any = undefined;

          // Handle pinned post reason
          if (item.authorPinned) {
            reason = {
              $type: 'app.bsky.feed.defs#reasonPin',
            };
          }
          // Handle repost reason
          else if (item.repost) {
            const repost = repostsByUri.get(item.repost.uri);
            const reposter = repost ? repostersByDid.get(repost.repostedByDid) : null;
            
            if (repost && reposter) {
              reason = {
                $type: 'app.bsky.feed.defs#reasonRepost',
                by: {
                  $type: 'app.bsky.actor.defs#profileViewBasic',
                  did: reposter.did,
                  handle: reposter.handle,
                  displayName: reposter.displayName,
                  ...this.maybeAvatar(reposter.avatarUrl, reposter.did),
                },
                indexedAt: repost.indexedAt.toISOString(),
              };
            }
          }

          return {
            post,
            ...(reason && { reason }),
          };
        })
        .filter(Boolean);

      res.json({
        cursor: feedResult.cursor,
        feed,
      });
    } catch (error) {
      this._handleError(res, error, 'getAuthorFeed');
    }
  }

  async getPostThread(req: Request, res: Response) {
    try {
      const params = getPostThreadSchema.parse(req.query);

      const allThreadPosts = await storage.getPostThread(params.uri);

      if (allThreadPosts.length === 0) {
        return res.status(404).json({ error: 'Post not found' });
      }

      const viewerDid = await this.getAuthenticatedDid(req);

      const rootPost = allThreadPosts[0];
      let replies = allThreadPosts.slice(1);

      if (viewerDid) {
        const settings = await storage.getUserSettings(viewerDid);
        if (settings) {
          replies = contentFilter.filterPosts(replies, settings);
        }
      }

      const postsToSerialize = [rootPost, ...replies];
      const serializedPosts = await this.serializePosts(
        postsToSerialize,
        viewerDid || undefined,
      );
      const serializedPostsByUri = new Map(
        serializedPosts.map((p) => [p.uri, p]),
      );

      const threadPost = serializedPostsByUri.get(rootPost.uri);
      if (!threadPost) {
        return res
          .status(500)
          .json({ error: 'Failed to serialize root post of thread' });
      }

      const threadReplies = replies
        .map((reply) => serializedPostsByUri.get(reply.uri))
        .filter(Boolean) as any[];

      const threadView: any = {
        $type: 'app.bsky.feed.defs#threadViewPost',
        post: threadPost,
        replies: threadReplies.map((reply) => ({
          $type: 'app.bsky.feed.defs#threadViewPost',
          post: reply,
        })),
      };

      res.json({
        thread: threadView,
      });
    } catch (error) {
      this._handleError(res, error, 'getPostThread');
    }
  }

  async getProfile(req: Request, res: Response) {
    try {
      const params = getProfileSchema.parse(req.query);
      const profiles = await this._getProfiles([params.actor], req);
      if (profiles.length === 0) {
        return res.status(404).json({ error: 'Profile not found' });
      }
      res.json(profiles[0]);
    } catch (error) {
      this._handleError(res, error, 'getProfile');
    }
  }

  async getProfiles(req: Request, res: Response) {
    try {
      // Handle the case where clients send 'actors[]' instead of 'actors'
      if (req.query['actors[]'] && !req.query.actors) {
        req.query.actors = req.query['actors[]'];
      }

      const params = getProfilesSchema.parse(req.query);
      const profiles = await this._getProfiles(params.actors, req);
      res.json({ profiles });
    } catch (error) {
      this._handleError(res, error, 'getProfiles');
    }
  }

  private async _getProfiles(actors: string[], req: Request) {
    const viewerDid = await this.getAuthenticatedDid(req);

    const dids = await Promise.all(
      actors.map(async (actor) => {
        if (actor.startsWith('did:')) {
          // Lazy load: Ensure profile exists
          await lazyDataLoader.ensureUserProfile(actor);
          return actor;
        }
        
        const handle = actor.toLowerCase();
        
        // Check cache first
        const cached = this.handleResolutionCache.get(handle);
        if (cached && !this.isHandleResolutionCacheExpired(cached)) {
          // Lazy load: Ensure profile exists
          await lazyDataLoader.ensureUserProfile(cached.did);
          return cached.did;
        }
        
        const user = await storage.getUserByHandle(handle);
        if (user) {
          // Cache the result
          this.handleResolutionCache.set(handle, {
            did: user.did,
            timestamp: Date.now()
          });
          // Lazy load: Ensure profile exists
          await lazyDataLoader.ensureUserProfile(user.did);
          return user.did;
        }
        
        // User not in database - try to resolve from network and fetch profile
        const { didResolver } = await import("./did-resolver");
        const did = await didResolver.resolveHandle(handle);
        if (did) {
          // Cache the result
          this.handleResolutionCache.set(handle, {
            did,
            timestamp: Date.now()
          });
          // Lazy load: Ensure profile exists
          await lazyDataLoader.ensureUserProfile(did);
          return did;
        }
        
        return undefined;
      }),
    );
    const uniqueDids = Array.from(new Set(dids.filter(Boolean))) as string[];

    if (uniqueDids.length === 0) {
      return [];
    }

    const [
      users,
      followersCounts,
      followingCounts,
      postsCounts,
      listCounts,
      feedgenCounts,
      allLabels,
      relationships,
      mutingLists,
      knownFollowersResults,
    ] = await Promise.all([
      storage.getUsers(uniqueDids),
      storage.getUsersFollowerCounts(uniqueDids),
      storage.getUsersFollowingCounts(uniqueDids),
      storage.getUsersPostCounts(uniqueDids),
      storage.getUsersListCounts(uniqueDids),
      storage.getUsersFeedGeneratorCounts(uniqueDids),
      storage.getLabelsForSubjects(uniqueDids),
      viewerDid
        ? storage.getRelationships(viewerDid, uniqueDids)
        : Promise.resolve(new Map()),
      viewerDid
        ? storage.findMutingListsForUsers(viewerDid, uniqueDids)
        : Promise.resolve(new Map()),
      viewerDid
        ? Promise.all(
            uniqueDids.map((did) =>
              storage.getKnownFollowers(did, viewerDid, 5),
            ),
          )
        : Promise.resolve(
            uniqueDids.map(() => ({ followers: [], count: 0 })),
          ),
    ]);

    // Fetch starter pack counts and labeler statuses for each user
    const starterPackCounts = new Map<string, number>();
    const labelerStatuses = new Map<string, boolean>();
    
    await Promise.all(uniqueDids.map(async (did) => {
      const [starterPacks, labelerServices] = await Promise.all([
        storage.getStarterPacksByCreator(did),
        storage.getLabelerServicesByCreator(did)
      ]);
      
      starterPackCounts.set(did, starterPacks.starterPacks.length);
      labelerStatuses.set(did, labelerServices.length > 0);
    }));

    const userMap = new Map(users.map((u) => [u.did, u]));
    const labelsBySubject = new Map<string, any[]>();
    allLabels.forEach((label) => {
      if (!labelsBySubject.has(label.subject)) {
        labelsBySubject.set(label.subject, []);
      }
      labelsBySubject.get(label.subject)!.push(label);
    });

    const pinnedPostUris = users
      .map((u) => (u.profileRecord as any)?.pinnedPost?.uri)
      .filter(Boolean);
    const pinnedPosts = await storage.getPosts(pinnedPostUris);
    const pinnedPostCidByUri = new Map<string, string>(
      pinnedPosts.map((p) => [p.uri, p.cid]),
    );

    const profiles = uniqueDids
      .map((did, i) => {
        const user = userMap.get(did);
        if (!user) return null;

        const profileRecord = user.profileRecord as any;
        const pinnedPostUri = profileRecord?.pinnedPost?.uri;
        const pinnedPostCid = pinnedPostUri
          ? pinnedPostCidByUri.get(pinnedPostUri)
          : undefined;

        const viewerState = viewerDid ? relationships.get(did) : null;
        const mutingList = viewerDid ? mutingLists.get(did) : null;
        const knownFollowersResult = viewerDid
          ? knownFollowersResults[i]
          : { followers: [], count: 0 };

        const viewer: any = {
          knownFollowers: {
            count: knownFollowersResult.count,
            followers: knownFollowersResult.followers
              .filter(f => f.handle) // Skip followers without valid handles
              .map((f) => {
                const follower: any = {
                  did: f.did,
                  handle: f.handle,
                };
                // Only include displayName if it exists (AT Protocol requires string or omit, not null)
                if (f.displayName) follower.displayName = f.displayName;
                // Only include avatar if it exists (avatarUrl is a CID string from database)
                if (f.avatarUrl) {
                  follower.avatar = f.avatarUrl.startsWith('http')
                    ? f.avatarUrl
                    : this.directCidToCdnUrl(f.avatarUrl, f.did, 'avatar');
                }
                return follower;
              }),
          },
        };

        if (viewerState) {
          viewer.muted = !!viewerState.muting || !!mutingList;
          if (mutingList) {
            viewer.mutedByList = {
              $type: 'app.bsky.graph.defs#listViewBasic',
              uri: mutingList.uri,
              name: mutingList.name,
              purpose: mutingList.purpose,
            };
          }
          viewer.blockedBy = viewerState.blockedBy;
          viewer.blocking = viewerState.blocking || undefined;
          viewer.following = viewerState.following || undefined;
          viewer.followedBy = viewerState.followedBy || undefined;
        }

        const profileView: any = {
          $type: 'app.bsky.actor.defs#profileViewDetailed',
          did: user.did,
          handle: user.handle,
          displayName: user.displayName || user.handle, // Fallback to handle if displayName is null/undefined
          ...(user.description && { description: user.description }),
          ...this.maybeAvatar(user.avatarUrl, user.did),
          ...this.maybeBanner(user.bannerUrl, user.did),
          followersCount: followersCounts.get(did) || 0,
          followsCount: followingCounts.get(did) || 0,
          postsCount: postsCounts.get(did) || 0,
          indexedAt: user.indexedAt.toISOString(),
          viewer,
          labels: (labelsBySubject.get(did) || []).map((l: any) => ({
            src: l.src,
            uri: l.uri,
            val: l.val,
            neg: l.neg,
            cts: l.createdAt.toISOString(),
          })),
          associated: {
            $type: 'app.bsky.actor.defs#profileAssociated',
            lists: listCounts.get(did) || 0,
            feedgens: feedgenCounts.get(did) || 0,
            starterPacks: starterPackCounts.get(did) || 0,
            labeler: labelerStatuses.get(did) || false,
            chat: undefined, // TODO: Implement chat settings when chat functionality is added
            activitySubscription: undefined, // TODO: Implement activity subscription when activity subscription functionality is added
          },
        };
        if (pinnedPostUri && pinnedPostCid) {
          profileView.pinnedPost = { uri: pinnedPostUri, cid: pinnedPostCid };
        }
        return profileView;
      })
      .filter(Boolean);

    return profiles;
  }

  async getPreferences(req: Request, res: Response) {
    try {
      // Get authenticated user DID using OAuth token verification
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      // Check cache first
      const cached = this.preferencesCache.get(userDid);
      if (cached && !this.isPreferencesCacheExpired(cached)) {
        console.log(`[PREFERENCES] Cache hit for ${userDid}`);
        return res.json({ preferences: cached.preferences });
      }

      // Cache miss - fetch from user's PDS
      console.log(`[PREFERENCES] Cache miss for ${userDid}, fetching from PDS`);
      
      try {
        // Get user's PDS endpoint from DID document
        const pdsEndpoint = await this.getUserPdsEndpoint(userDid);
        if (!pdsEndpoint) {
          console.log(`[PREFERENCES] No PDS endpoint found for ${userDid}, returning empty preferences`);
          return res.json({ preferences: [] });
        }

        // Forward request to user's PDS
        const pdsResponse = await fetch(`${pdsEndpoint}/xrpc/app.bsky.actor.getPreferences`, {
          headers: {
            'Authorization': req.headers.authorization || '',
            'Content-Type': 'application/json'
          }
        });

        if (pdsResponse.ok) {
          const pdsData = await pdsResponse.json();
          
          // Cache the response
          this.preferencesCache.set(userDid, {
            preferences: pdsData.preferences || [],
            timestamp: Date.now()
          });
          
          console.log(`[PREFERENCES] Retrieved ${pdsData.preferences?.length || 0} preferences from PDS for ${userDid}`);
          return res.json({ preferences: pdsData.preferences || [] });
        } else {
          console.warn(`[PREFERENCES] PDS request failed for ${userDid}:`, pdsResponse.status);
          return res.json({ preferences: [] });
        }
      } catch (pdsError) {
        console.error(`[PREFERENCES] Error fetching from PDS for ${userDid}:`, pdsError);
        return res.json({ preferences: [] });
      }
    } catch (error) {
      this._handleError(res, error, 'getPreferences');
    }
  }

  async putPreferences(req: Request, res: Response) {
    try {
      // Get authenticated user DID using OAuth token verification
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      // Parse the preferences from request body
      const body = putActorPreferencesSchema.parse(req.body);
      
      try {
        // Get user's PDS endpoint from DID document
        const pdsEndpoint = await this.getUserPdsEndpoint(userDid);
        if (!pdsEndpoint) {
          return res.status(400).json({ 
            error: 'InvalidRequest', 
            message: 'No PDS endpoint found for user' 
          });
        }

        // Forward request to user's PDS (let PDS handle validation)
        const pdsResponse = await fetch(`${pdsEndpoint}/xrpc/app.bsky.actor.putPreferences`, {
          method: 'POST',
          headers: {
            'Authorization': req.headers.authorization || '',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (pdsResponse.ok) {
          // Invalidate cache after successful update
          this.invalidatePreferencesCache(userDid);
          
          console.log(`[PREFERENCES] Updated preferences via PDS for ${userDid}`);
          
          // Return success response (no body, like Bluesky)
          return res.status(200).end();
        } else {
          const errorText = await pdsResponse.text();
          console.error(`[PREFERENCES] PDS request failed for ${userDid}:`, pdsResponse.status, errorText);
          return res.status(pdsResponse.status).send(errorText);
        }
      } catch (pdsError) {
        console.error(`[PREFERENCES] Error updating preferences via PDS for ${userDid}:`, pdsError);
        return res.status(500).json({ 
          error: 'InternalServerError', 
          message: 'Failed to update preferences' 
        });
      }
    } catch (error) {
      this._handleError(res, error, 'putPreferences');
    }
  }

  async getFollows(req: Request, res: Response) {
    try {
      const params = getFollowsSchema.parse(req.query);

      const actorDid = await this._resolveActor(res, params.actor);
      if (!actorDid) return;

      const follows = await storage.getFollows(actorDid, params.limit);
      const followDids = follows.map((f) => f.followingDid);
      const followUsers = await storage.getUsers(followDids);
      const userMap = new Map(followUsers.map((u) => [u.did, u]));

      const viewerDid = await this.getAuthenticatedDid(req);
      const relationships = viewerDid
        ? await storage.getRelationships(viewerDid, followDids)
        : new Map();

      // Get the actor's handle for the subject
      const actor = await storage.getUser(actorDid);
      res.json({
        subject: { 
          $type: 'app.bsky.actor.defs#profileView',
          did: actorDid,
          handle: actor?.handle || actorDid,
          displayName: actor?.displayName || actor?.handle || actorDid,
          ...this.maybeAvatar(actor?.avatarUrl, actor?.did),
          indexedAt: actor?.indexedAt?.toISOString(),
          viewer: {
            muted: false,
            blockedBy: false,
            blocking: undefined,
            following: undefined,
            followedBy: undefined,
          },
        },
        follows: follows
          .map((f) => {
            const user = userMap.get(f.followingDid);
            if (!user) return null; // Should not happen

            const viewerState = viewerDid
              ? relationships.get(f.followingDid)
              : null;
            const viewer = {
              muted: viewerState ? !!viewerState.muting : false,
              blockedBy: viewerState?.blockedBy || false,
              blocking: viewerState?.blocking || undefined,
              following: viewerState?.following || undefined,
              followedBy: viewerState?.followedBy || undefined,
            };

            return {
              $type: 'app.bsky.actor.defs#profileView',
              did: user.did,
              handle: user.handle,
              displayName: user.displayName || user.handle, // Fallback to handle if displayName is null/undefined
              ...this.maybeAvatar(user.avatarUrl, user.did),
              indexedAt: user.indexedAt.toISOString(),
              viewer: viewer,
            };
          })
          .filter(Boolean),
      });
    } catch (error) {
      this._handleError(res, error, 'getFollows');
    }
  }

  async getFollowers(req: Request, res: Response) {
    try {
      const params = getFollowsSchema.parse(req.query);

      const actorDid = await this._resolveActor(res, params.actor);
      if (!actorDid) return;

      const followers = await storage.getFollowers(actorDid, params.limit);
      const followerDids = followers.map((f) => f.followerDid);
      const followerUsers = await storage.getUsers(followerDids);
      const userMap = new Map(followerUsers.map((u) => [u.did, u]));

      const viewerDid = await this.getAuthenticatedDid(req);
      const relationships = viewerDid
        ? await storage.getRelationships(viewerDid, followerDids)
        : new Map();

      // Get the actor's handle for the subject
      const actor = await storage.getUser(actorDid);
      res.json({
        subject: { 
          $type: 'app.bsky.actor.defs#profileView',
          did: actorDid,
          handle: actor?.handle || actorDid,
          displayName: actor?.displayName || actor?.handle || actorDid,
          ...this.maybeAvatar(actor?.avatarUrl, actor?.did),
          indexedAt: actor?.indexedAt?.toISOString(),
          viewer: {
            muted: false,
            blockedBy: false,
            blocking: undefined,
            following: undefined,
            followedBy: undefined,
          },
        },
        followers: followers
          .map((f) => {
            const user = userMap.get(f.followerDid);
            if (!user) return null;

            const viewerState = viewerDid
              ? relationships.get(f.followerDid)
              : null;
            const viewer = {
              muted: viewerState ? !!viewerState.muting : false,
              blockedBy: viewerState?.blockedBy || false,
              blocking: viewerState?.blocking || undefined,
              following: viewerState?.following || undefined,
              followedBy: viewerState?.followedBy || undefined,
            };

            return {
              $type: 'app.bsky.actor.defs#profileView',
              did: user.did,
              handle: user.handle,
              displayName: user.displayName || user.handle, // Fallback to handle if displayName is null/undefined
              ...this.maybeAvatar(user.avatarUrl, user.did),
              indexedAt: user.indexedAt.toISOString(),
              viewer: viewer,
            };
          })
          .filter(Boolean),
      });
    } catch (error) {
      this._handleError(res, error, 'getFollowers');
    }
  }

  async getSuggestions(req: Request, res: Response) {
    try {
      const params = getSuggestionsSchema.parse(req.query);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const users = await storage.getSuggestedUsers(userDid, params.limit);

      res.json({
        actors: users.map((user) => ({
          did: user.did,
          handle: user.handle,
          displayName: user.displayName || user.handle, // Fallback to handle if displayName is null/undefined
          ...(user.description && { description: user.description }),
          ...this.maybeAvatar(user.avatarUrl, user.did),
        })),
      });
    } catch (error) {
      this._handleError(res, error, 'getSuggestions');
    }
  }

  async getBlocks(req: Request, res: Response) {
    try {
      const params = getBlocksSchema.parse(req.query);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const { blocks, cursor } = await storage.getBlocks(
        userDid,
        params.limit,
        params.cursor,
      );
      const blockedDids = blocks.map((b) => b.blockedDid);
      const blockedUsers = await storage.getUsers(blockedDids);
      const userMap = new Map(blockedUsers.map((u) => [u.did, u]));

      res.json({
        cursor,
        blocks: blocks
          .map((b) => {
            const user = userMap.get(b.blockedDid);
            if (!user) return null;
            return {
              did: user.did,
              handle: user.handle,
              displayName: user.displayName || user.handle, // Fallback to handle if displayName is null/undefined
              ...this.maybeAvatar(user.avatarUrl, user.did),
              viewer: {
                blocking: b.uri,
                muted: false, // You can't block someone you don't mute
              },
            };
          })
          .filter(Boolean),
      });
    } catch (error) {
      this._handleError(res, error, 'getBlocks');
    }
  }

  async getMutes(req: Request, res: Response) {
    try {
      const params = getMutesSchema.parse(req.query);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const { mutes, cursor } = await storage.getMutes(
        userDid,
        params.limit,
        params.cursor,
      );
      const mutedDids = mutes.map((m) => m.mutedDid);
      const mutedUsers = await storage.getUsers(mutedDids);
      const userMap = new Map(mutedUsers.map((u) => [u.did, u]));

      res.json({
        cursor,
        mutes: mutes
          .map((m) => {
            const user = userMap.get(m.mutedDid);
            if (!user) return null;
            return {
              did: user.did,
              handle: user.handle,
              displayName: user.displayName || user.handle, // Fallback to handle if displayName is null/undefined
              ...this.maybeAvatar(user.avatarUrl, user.did),
              viewer: {
                muted: true,
              },
            };
          })
          .filter(Boolean),
      });
    } catch (error) {
      this._handleError(res, error, 'getMutes');
    }
  }

  async muteActor(req: Request, res: Response) {
    try {
      const params = muteActorSchema.parse(req.body);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const mutedDid = await this._resolveActor(res, params.actor);
      if (!mutedDid) return;

      await storage.createMute({
        uri: `at://${userDid}/app.bsky.graph.mute/${Date.now()}`,
        muterDid: userDid,
        mutedDid,
        createdAt: new Date(),
      });

      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'muteActor');
    }
  }

  async unmuteActor(req: Request, res: Response) {
    try {
      const params = muteActorSchema.parse(req.body);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const mutedDid = await this._resolveActor(res, params.actor);
      if (!mutedDid) return;

      const { mutes } = await storage.getMutes(userDid, 1000);
      const mute = mutes.find((m) => m.mutedDid === mutedDid);

      if (mute) {
        await storage.deleteMute(mute.uri);
      }

      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'unmuteActor');
    }
  }

  async getRelationships(req: Request, res: Response) {
    try {
      const params = getRelationshipsSchema.parse(req.query);

      const actorDid = await this._resolveActor(res, params.actor);
      if (!actorDid) return;

      const targetDids = params.others || [];
      const relationships = await storage.getRelationships(actorDid, targetDids);

      res.json({
        actor: actorDid,
        relationships: Array.from(relationships.entries()).map(([did, rel]) => ({
          $type: 'app.bsky.graph.defs#relationship',
          did,
          following: rel.following || undefined,
          followedBy: rel.followedBy || undefined,
          blocking: rel.blocking || undefined,
          blockedBy: rel.blockedBy || undefined,
          muted: rel.muting || undefined,
        })),
      });
    } catch (error) {
      this._handleError(res, error, 'getRelationships');
    }
  }

  async getListMutes(req: Request, res: Response) {
    try {
      const params = getListMutesSchema.parse(req.query);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const { mutes, cursor } = await storage.getListMutes(
        userDid,
        params.limit,
        params.cursor,
      );

      res.json({
        cursor,
        lists: await Promise.all(
          mutes.map(async (listMute) => {
            const list = await storage.getList(listMute.listUri);
            return list
              ? {
                  uri: list.uri,
                  name: list.name,
                  purpose: list.purpose,
                }
              : null;
          }),
        ),
      });
    } catch (error) {
      this._handleError(res, error, 'getListMutes');
    }
  }

  async getListBlocks(req: Request, res: Response) {
    try {
      const params = getListBlocksSchema.parse(req.query);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const { blocks, cursor } = await storage.getListBlocks(
        userDid,
        params.limit,
        params.cursor,
      );

      res.json({
        cursor,
        lists: await Promise.all(
          blocks.map(async (listBlock) => {
            const list = await storage.getList(listBlock.listUri);
            return list
              ? {
                  uri: list.uri,
                  name: list.name,
                  purpose: list.purpose,
                }
              : null;
          }),
        ),
      });
    } catch (error) {
      this._handleError(res, error, 'getListBlocks');
    }
  }

  async getKnownFollowers(req: Request, res: Response) {
    try {
      const params = getKnownFollowersSchema.parse(req.query);

      const viewerDid = await this.requireAuthDid(req, res);
      if (!viewerDid) return;

      const actorDid = await this._resolveActor(res, params.actor);
      if (!actorDid) return;

      const { followers, cursor } = await storage.getKnownFollowers(
        actorDid,
        viewerDid,
        params.limit,
        params.cursor,
      );

      // Get the actor's handle for the subject
      const actor = await storage.getUser(actorDid);
      res.json({
        subject: {
          $type: 'app.bsky.actor.defs#profileView',
          did: actorDid,
          handle: actor?.handle || params.actor,
          displayName: actor?.displayName || actor?.handle || params.actor,
          ...this.maybeAvatar(actor?.avatarUrl, actor?.did),
          indexedAt: actor?.indexedAt?.toISOString(),
          viewer: {
            muted: false,
            blockedBy: false,
            blocking: undefined,
            following: undefined,
            followedBy: undefined,
          },
        },
        cursor,
        followers: followers.map((user) => ({
          $type: 'app.bsky.actor.defs#profileView',
          did: user.did,
          handle: user.handle,
          displayName: user.displayName || user.handle, // Fallback to handle if displayName is null/undefined
          ...this.maybeAvatar(user.avatarUrl, user.did),
          indexedAt: user.indexedAt?.toISOString(),
          viewer: {
            muted: false,
            blockedBy: false,
            blocking: undefined,
            following: undefined,
            followedBy: undefined,
          },
        })),
      });
    } catch (error) {
      this._handleError(res, error, 'getKnownFollowers');
    }
  }

  async getSuggestedFollowsByActor(req: Request, res: Response) {
    try {
      const params = getSuggestedFollowsByActorSchema.parse(req.query);

      const actorDid = await this._resolveActor(res, params.actor);
      if (!actorDid) return;

      const suggestions = await storage.getSuggestedFollowsByActor(
        actorDid,
        params.limit,
      );

      res.json({
        suggestions: suggestions.map((user) => ({
          did: user.did,
          handle: user.handle,
          displayName: user.displayName || user.handle, // Fallback to handle if displayName is null/undefined
          ...(user.description && { description: user.description }),
          ...this.maybeAvatar(user.avatarUrl, user.did),
        })),
      });
    } catch (error) {
      this._handleError(res, error, 'getSuggestedFollowsByActor');
    }
  }

  async muteActorList(req: Request, res: Response) {
    try {
      const params = muteActorListSchema.parse(req.body);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      // Verify list exists
      const list = await storage.getList(params.list);
      if (!list) {
        return res.status(404).json({ error: 'List not found' });
      }

      await storage.createListMute({
        uri: `at://${userDid}/app.bsky.graph.listMute/${Date.now()}`,
        muterDid: userDid,
        listUri: params.list,
        createdAt: new Date(),
      });

      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'muteActorList');
    }
  }

  async unmuteActorList(req: Request, res: Response) {
    try {
      const params = unmuteActorListSchema.parse(req.body);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const { mutes } = await storage.getListMutes(userDid, 1000);
      const mute = mutes.find((m) => m.listUri === params.list);

      if (mute) {
        await storage.deleteListMute(mute.uri);
      }

      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'unmuteActorList');
    }
  }

  // app.bsky.graph.muteThread
  async muteThread(req: Request, res: Response) {
    try {
      const params = muteThreadSchema.parse(req.body);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      // Verify thread root post exists
      const rootPost = await storage.getPost(params.root);
      if (!rootPost) {
        return res.status(404).json({ error: 'Thread root post not found' });
      }

      // Create thread mute
      await storage.createThreadMute({
        uri: `at://${userDid}/app.bsky.graph.threadMute/${Date.now()}`,
        muterDid: userDid,
        threadRootUri: params.root,
        createdAt: new Date(),
      });

      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'muteThread');
    }
  }

  // Feed Generator endpoints

  // app.bsky.feed.getFeed
  async getFeed(req: Request, res: Response) {
    try {
      const params = getFeedSchema.parse(req.query);

      // Get feed generator info
      const feedGen = await storage.getFeedGenerator(params.feed);
      if (!feedGen) {
        return res.status(404).json({ error: 'Feed generator not found' });
      }

      console.log(
        `[XRPC] Getting feed from generator: ${feedGen.displayName} (${feedGen.did})`,
      );

      // Call external feed generator service to get skeleton
      // Then hydrate with full post data from our database
      const { feed: hydratedFeed, cursor } = await feedGeneratorClient.getFeed(
        feedGen.did,
        {
          feed: params.feed,
          limit: params.limit,
          cursor: params.cursor,
        },
        {
          viewerAuthorization: req.headers['authorization'] as string | undefined,
        },
      );

      console.log(
        `[XRPC] Hydrated ${hydratedFeed.length} posts from feed generator`,
      );

      // Ensure all author profiles are loaded before building the feed
      const authorDids = [...new Set(hydratedFeed.map(item => item.post.authorDid))];
      await Promise.all(
        authorDids.map(authorDid => lazyDataLoader.ensureUserProfile(authorDid))
      );

      // Build post views with author information
      const feed = await Promise.all(
        hydratedFeed.map(async ({ post, reason }) => {
          const author = await storage.getUser(post.authorDid);
          
          // Skip posts from authors without valid handles
          if (!author || !author.handle) {
            console.warn(`[XRPC] Skipping post ${post.uri} - author ${post.authorDid} has no handle`);
            return null;
          }

          const postView: any = {
            uri: post.uri,
            cid: post.cid,
            author: {
              $type: 'app.bsky.actor.defs#profileViewBasic',
              did: post.authorDid,
              handle: author.handle,
              displayName: author.displayName ?? author.handle,
              pronouns: author?.pronouns,
              ...this.maybeAvatar(author?.avatarUrl, author?.did),
              associated: {
                $type: 'app.bsky.actor.defs#profileAssociated',
                lists: 0,
                feedgens: 0,
                starterPacks: 0,
                labeler: false,
                chat: undefined,
                activitySubscription: undefined,
              },
              viewer: undefined,
              labels: [],
              createdAt: author?.createdAt?.toISOString(),
              verification: undefined,
              status: undefined,
            },
            record: {
              text: post.text,
              createdAt: post.createdAt.toISOString(),
            },
            replyCount: 0,
            repostCount: 0,
            likeCount: 0,
            indexedAt: post.indexedAt.toISOString(),
          };

          const feedView: any = { post: postView };

          // Include reason if present (e.g., repost context)
          if (reason) {
            feedView.reason = reason;
          }

          return feedView;
        }),
      );

      // Filter out null entries (posts from authors without handles)
      const validFeed = feed.filter(item => item !== null);

      res.json({ feed: validFeed, cursor });
    } catch (error) {
      // If feed generator is unavailable, provide a helpful error
      if (
        error instanceof Error &&
        error.message.includes('Could not resolve')
      ) {
        return res.status(502).json({
          error: 'Feed generator service unavailable',
          message: 'The feed generator service endpoint could not be reached',
        });
      }
      this._handleError(res, error, 'getFeed');
    }
  }

  async getFeedGenerator(req: Request, res: Response) {
    try {
      const params = getFeedGeneratorSchema.parse(req.query);

      const generator = await storage.getFeedGenerator(params.feed);
      if (!generator) {
        return res.status(404).json({ error: 'Feed generator not found' });
      }

      // Ensure creator profile is loaded
      await lazyDataLoader.ensureUserProfile(generator.creatorDid);
      const creator = await storage.getUser(generator.creatorDid);
      
      if (!creator || !creator.handle) {
        return res.status(500).json({ 
          error: 'Feed generator creator profile not available',
          message: 'Unable to load creator information'
        });
      }

      const creatorView: any = {
        did: generator.creatorDid,
        handle: creator.handle,
        ...this.maybeAvatar(creator?.avatarUrl, creator?.did),
      };
      if (creator?.displayName) creatorView.displayName = creator.displayName;

      const view: any = {
        uri: generator.uri,
        cid: generator.cid,
        did: generator.did,
        creator: creatorView,
        displayName: generator.displayName,
        likeCount: generator.likeCount,
        indexedAt: generator.indexedAt.toISOString(),
        ...this.maybeAvatar(generator.avatarUrl, generator.creatorDid),
      };
      if (generator.description) view.description = generator.description;

      res.json({
        view,
        isOnline: true,
        isValid: true,
      });
    } catch (error) {
      this._handleError(res, error, 'getFeedGenerator');
    }
  }

  async getFeedGenerators(req: Request, res: Response) {
    try {
      const params = getFeedGeneratorsSchema.parse(req.query);

      const generators = await storage.getFeedGenerators(params.feeds);

      // Ensure all creator profiles are loaded
      const creatorDids = [...new Set(generators.map(g => g.creatorDid))];
      await Promise.all(
        creatorDids.map(did => lazyDataLoader.ensureUserProfile(did))
      );

      const views = await Promise.all(
        generators.map(async (generator) => {
          const creator = await storage.getUser(generator.creatorDid);
          
          // Skip generators from creators without valid handles
          if (!creator || !creator.handle) {
            console.warn(`[XRPC] Skipping feed generator ${generator.uri} - creator ${generator.creatorDid} has no handle`);
            return null;
          }

          const creatorView: any = {
            did: generator.creatorDid,
            handle: creator.handle,
          };
          if (creator?.displayName)
            creatorView.displayName = creator.displayName;
          if (creator?.avatarUrl) creatorView.avatar = this.transformBlobToCdnUrl(creator.avatarUrl, creator.did, 'avatar');

          const view: any = {
            uri: generator.uri,
            cid: generator.cid,
            did: generator.did,
            creator: creatorView,
            displayName: generator.displayName,
            likeCount: generator.likeCount,
            indexedAt: generator.indexedAt.toISOString(),
          };
          if (generator.description) view.description = generator.description;
          if (generator.avatarUrl) view.avatar = this.transformBlobToCdnUrl(generator.avatarUrl, generator.creatorDid, 'avatar');

          return view;
        }),
      );

      // Filter out null entries (generators from creators without valid handles)
      const validViews = views.filter(view => view !== null);

      res.json({ feeds: validViews });
    } catch (error) {
      this._handleError(res, error, 'getFeedGenerators');
    }
  }

  async getActorFeeds(req: Request, res: Response) {
    try {
      const params = getActorFeedsSchema.parse(req.query);

      const actorDid = await this._resolveActor(res, params.actor);
      if (!actorDid) return;

      const { generators, cursor } = await storage.getActorFeeds(
        actorDid,
        params.limit,
        params.cursor,
      );

      // Ensure all creator profiles are loaded
      const creatorDids = [...new Set(generators.map(g => g.creatorDid))];
      await Promise.all(
        creatorDids.map(did => lazyDataLoader.ensureUserProfile(did))
      );

      const feeds = await Promise.all(
        generators.map(async (generator) => {
          const creator = await storage.getUser(generator.creatorDid);
          
          // Skip generators from creators without valid handles
          if (!creator || !creator.handle) {
            console.warn(`[XRPC] Skipping feed generator ${generator.uri} - creator ${generator.creatorDid} has no handle`);
            return null;
          }

          const creatorView: any = {
            did: generator.creatorDid,
            handle: creator.handle,
          };
          if (creator?.displayName)
            creatorView.displayName = creator.displayName;
          if (creator?.avatarUrl) creatorView.avatar = this.transformBlobToCdnUrl(creator.avatarUrl, creator.did, 'avatar');

          const view: any = {
            uri: generator.uri,
            cid: generator.cid,
            did: generator.did,
            creator: creatorView,
            displayName: generator.displayName,
            likeCount: generator.likeCount,
            indexedAt: generator.indexedAt.toISOString(),
          };
          if (generator.description) view.description = generator.description;
          if (generator.avatarUrl) view.avatar = this.transformBlobToCdnUrl(generator.avatarUrl, generator.creatorDid, 'avatar');

          return view;
        }),
      );

      res.json({ cursor, feeds });
    } catch (error) {
      this._handleError(res, error, 'getActorFeeds');
    }
  }

  async getSuggestedFeeds(req: Request, res: Response) {
    try {
      const params = getSuggestedFeedsSchema.parse(req.query);

      const { generators, cursor } = await storage.getSuggestedFeeds(
        params.limit,
        params.cursor,
      );

      // Ensure all creator profiles are loaded
      const creatorDids = [...new Set(generators.map(g => g.creatorDid))];
      await Promise.all(
        creatorDids.map(did => lazyDataLoader.ensureUserProfile(did))
      );

      const feeds = await Promise.all(
        generators.map(async (generator) => {
          const creator = await storage.getUser(generator.creatorDid);
          
          // Skip generators from creators without valid handles
          if (!creator || !creator.handle) {
            console.warn(`[XRPC] Skipping feed generator ${generator.uri} - creator ${generator.creatorDid} has no handle`);
            return null;
          }

          const creatorView: any = {
            did: generator.creatorDid,
            handle: creator.handle,
          };
          if (creator?.displayName)
            creatorView.displayName = creator.displayName;
          if (creator?.avatarUrl) creatorView.avatar = this.transformBlobToCdnUrl(creator.avatarUrl, creator.did, 'avatar');

          const view: any = {
            uri: generator.uri,
            cid: generator.cid,
            did: generator.did,
            creator: creatorView,
            displayName: generator.displayName,
            likeCount: generator.likeCount,
            indexedAt: generator.indexedAt.toISOString(),
          };
          if (generator.description) view.description = generator.description;
          if (generator.avatarUrl) view.avatar = this.transformBlobToCdnUrl(generator.avatarUrl, generator.creatorDid, 'avatar');

          return view;
        }),
      );

      // Filter out null entries (generators from creators without valid handles)
      const validFeeds = feeds.filter(feed => feed !== null);

      res.json({ cursor, feeds: validFeeds });
    } catch (error) {
      this._handleError(res, error, 'getSuggestedFeeds');
    }
  }

  async describeFeedGenerator(req: Request, res: Response) {
    try {
      describeFeedGeneratorSchema.parse(req.query);

      const appviewDid = process.env.APPVIEW_DID;
      if (!appviewDid) {
        return res.status(500).json({ error: "APPVIEW_DID not configured" });
      }
      
      res.json({
        did: appviewDid,
        feeds: [
          {
            uri: `at://${appviewDid}/app.bsky.feed.generator/reverse-chron`,
          },
        ],
      });
    } catch (error) {
      this._handleError(res, error, 'describeFeedGenerator');
    }
  }

  async getPopularFeedGenerators(req: Request, res: Response) {
    try {
      const params = getPopularFeedGeneratorsSchema.parse(req.query);

      let generators: any[];
      let cursor: string | undefined;

      // If query is provided, search for feed generators by name/description
      // Otherwise, return suggested feeds (popular by default)
      if (params.query && params.query.trim()) {
        const searchResults = await storage.searchFeedGeneratorsByName(
          params.query.trim(),
          params.limit,
          params.cursor
        );
        generators = searchResults.feedGenerators;
        cursor = searchResults.cursor;
      } else {
        const suggestedResults = await storage.getSuggestedFeeds(
          params.limit,
          params.cursor,
        );
        generators = suggestedResults.generators;
        cursor = suggestedResults.cursor;
      }

      // Ensure all creator profiles are loaded
      const creatorDids = [...new Set(generators.map(g => g.creatorDid))];
      await Promise.all(
        creatorDids.map(did => lazyDataLoader.ensureUserProfile(did))
      );

      const feeds = await Promise.all(
        generators.map(async (generator) => {
          const creator = await storage.getUser(generator.creatorDid);
          
          // Skip generators from creators without valid handles
          if (!creator || !creator.handle) {
            console.warn(`[XRPC] Skipping feed generator ${generator.uri} - creator ${generator.creatorDid} has no handle`);
            return null;
          }

          const creatorView: any = {
            did: generator.creatorDid,
            handle: creator.handle,
          };
          if (creator?.displayName)
            creatorView.displayName = creator.displayName;
          if (creator?.avatarUrl) creatorView.avatar = this.transformBlobToCdnUrl(creator.avatarUrl, creator.did, 'avatar');

          const view: any = {
            uri: generator.uri,
            cid: generator.cid,
            did: generator.did,
            creator: creatorView,
            displayName: generator.displayName,
            likeCount: generator.likeCount,
            indexedAt: generator.indexedAt.toISOString(),
          };
          if (generator.description) view.description = generator.description;
          if (generator.avatarUrl) view.avatar = this.transformBlobToCdnUrl(generator.avatarUrl, generator.creatorDid, 'avatar');

          return view;
        }),
      );

      // Filter out null entries (generators from creators without valid handles)
      const validFeeds = feeds.filter(feed => feed !== null);

      res.json({ cursor, feeds: validFeeds });
    } catch (error) {
      this._handleError(res, error, 'getPopularFeedGenerators');
    }
  }

  // Starter Pack endpoints
  async getStarterPack(req: Request, res: Response) {
    try {
      const params = getStarterPackSchema.parse(req.query);

      const pack = await storage.getStarterPack(params.starterPack);
      if (!pack) {
        return res.status(404).json({ error: 'Starter pack not found' });
      }

      // Ensure creator profile is loaded
      await lazyDataLoader.ensureUserProfile(pack.creatorDid);
      const creator = await storage.getUser(pack.creatorDid);
      
      if (!creator || !creator.handle) {
        return res.status(500).json({ 
          error: 'Starter pack creator profile not available',
          message: 'Unable to load creator information'
        });
      }
      
      let list = null;
      if (pack.listUri) {
        list = await storage.getList(pack.listUri);
      }

      const creatorView: any = {
        did: pack.creatorDid,
        handle: creator.handle,
      };
      if (creator?.displayName) creatorView.displayName = creator.displayName;
      if (creator?.avatarUrl) creatorView.avatar = this.transformBlobToCdnUrl(creator.avatarUrl, creator.did, 'avatar');

      const record: any = {
        name: pack.name,
        list: pack.listUri,
        feeds: pack.feeds,
        createdAt: pack.createdAt.toISOString(),
      };
      if (pack.description) record.description = pack.description;

      const starterPackView: any = {
        uri: pack.uri,
        cid: pack.cid,
        record,
        creator: creatorView,
        indexedAt: pack.indexedAt.toISOString(),
      };

      if (list) {
        starterPackView.list = {
          uri: list.uri,
          cid: list.cid,
          name: list.name,
          purpose: list.purpose,
        };
      }

      res.json({ starterPack: starterPackView });
    } catch (error) {
      this._handleError(res, error, 'getStarterPack');
    }
  }

  async getStarterPacks(req: Request, res: Response) {
    try {
      const params = getStarterPacksSchema.parse(req.query);

      const packs = await storage.getStarterPacks(params.uris);

      // Ensure all creator profiles are loaded
      const creatorDids = [...new Set(packs.map(p => p.creatorDid))];
      await Promise.all(
        creatorDids.map(did => lazyDataLoader.ensureUserProfile(did))
      );

      const views = await Promise.all(
        packs.map(async (pack) => {
          const creator = await storage.getUser(pack.creatorDid);
          
          // Skip packs from creators without valid handles
          if (!creator?.handle) {
            console.warn(`[XRPC] Skipping starter pack ${pack.uri} - creator ${pack.creatorDid} has no handle`);
            return null;
          }
          
          let list = null;
          if (pack.listUri) {
            list = await storage.getList(pack.listUri);
          }

          const creatorView: any = {
            did: pack.creatorDid,
            handle: creator.handle,
          };
          if (creator?.displayName)
            creatorView.displayName = creator.displayName;
          if (creator?.avatarUrl) creatorView.avatar = this.transformBlobToCdnUrl(creator.avatarUrl, creator.did, 'avatar');

          const record: any = {
            name: pack.name,
            list: pack.listUri,
            feeds: pack.feeds,
            createdAt: pack.createdAt.toISOString(),
          };
          if (pack.description) record.description = pack.description;

          const view: any = {
            uri: pack.uri,
            cid: pack.cid,
            record,
            creator: creatorView,
            indexedAt: pack.indexedAt.toISOString(),
          };

          if (list) {
            view.list = {
              uri: list.uri,
              cid: list.cid,
              name: list.name,
              purpose: list.purpose,
            };
          }

          return view;
        }),
      );

      // Filter out null entries (packs from creators without valid handles)
      const validViews = views.filter(view => view !== null);

      res.json({ starterPacks: validViews });
    } catch (error) {
      this._handleError(res, error, 'getStarterPacks');
    }
  }

  async getServices(req: Request, res: Response) {
    try {
      const params = getLabelerServicesSchema.parse(req.query);

      // Get all labeler services for the requested DIDs
      const allServices = await Promise.all(
        params.dids.map(async (did: string) => {
          const services = await storage.getLabelerServicesByCreator(did);
          return services;
        }),
      );

      // Flatten array of arrays
      const services = allServices.flat();

      // Ensure all creator profiles are loaded
      const creatorDids = [...new Set(services.map(s => s.creatorDid))];
      await Promise.all(
        creatorDids.map(did => lazyDataLoader.ensureUserProfile(did))
      );

      const views = await Promise.all(
        services.map(async (service) => {
          const creator = await storage.getUser(service.creatorDid);
          
          // Skip services from creators without valid handles
          if (!creator || !creator.handle) {
            console.warn(`[XRPC] Skipping labeler service ${service.uri} - creator ${service.creatorDid} has no handle`);
            return null;
          }

          const creatorView: any = {
            did: service.creatorDid,
            handle: creator.handle,
          };
          if (creator?.displayName)
            creatorView.displayName = creator.displayName;
          if (creator?.avatarUrl) creatorView.avatar = this.transformBlobToCdnUrl(creator.avatarUrl, creator.did, 'avatar');

          const view: any = {
            uri: service.uri,
            cid: service.cid,
            creator: creatorView,
            likeCount: service.likeCount,
            indexedAt: service.indexedAt.toISOString(),
          };

          // Add policies
          if (service.policies) {
            view.policies = service.policies;
          }

          // Get labels applied to this labeler service
          const labels = await storage.getLabelsForSubject(service.uri);
          if (labels.length > 0) {
            view.labels = labels.map((label) => {
              const labelView: any = {
                src: label.src,
                uri: label.subject,
                val: label.val,
                cts: label.createdAt.toISOString(),
              };
              if (label.neg) labelView.neg = true;
              return labelView;
            });
          }

          return view;
        }),
      );

      // Filter out null entries (services from creators without valid handles)
      const validViews = views.filter(view => view !== null);

      res.json({ views: validViews });
    } catch (error) {
      this._handleError(res, error, 'getServices');
    }
  }

  // app.bsky.notification.registerPush
  async registerPush(req: Request, res: Response) {
    try {
      const params = registerPushSchema.parse(req.body);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      // Create or update push subscription
      const subscription = await storage.createPushSubscription({
        userDid,
        platform: params.platform,
        token: params.token,
        appId: params.appId,
      });

      res.json({
        id: subscription.id,
        platform: subscription.platform,
        createdAt: subscription.createdAt.toISOString(),
      });
    } catch (error) {
      this._handleError(res, error, 'registerPush');
    }
  }

  // app.bsky.notification.putPreferences
  async putNotificationPreferences(req: Request, res: Response) {
    try {
      const params = putNotificationPreferencesSchema.parse(req.body);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      // Get existing preferences or create new ones if they don't exist
      let prefs = await storage.getUserPreferences(userDid);
      if (!prefs) {
        prefs = await storage.createUserPreferences({
          userDid,
          notificationPriority:
            params.priority !== undefined ? params.priority : false,
        });
      } else {
        // Update notification preferences
        prefs = await storage.updateUserPreferences(userDid, {
          notificationPriority:
            params.priority !== undefined
              ? params.priority
              : prefs.notificationPriority,
        });
      }

      res.json({
        priority: prefs?.notificationPriority ?? false,
      });
    } catch (error) {
      this._handleError(res, error, 'putNotificationPreferences');
    }
  }

  // app.bsky.video.getJobStatus
  async getJobStatus(req: Request, res: Response) {
    try {
      const params = getJobStatusSchema.parse(req.query);

      // Get video job
      const job = await storage.getVideoJob(params.jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      // Build response
      const response: any = {
        jobId: job.jobId,
        did: job.userDid,
        state: job.state,
        progress: job.progress,
      };

      // Add optional fields
      if (job.blobRef) {
        response.blob = job.blobRef;
      }

      if (job.error) {
        response.error = job.error;
      }

      res.json({ jobStatus: response });
    } catch (error) {
      this._handleError(res, error, 'getJobStatus');
    }
  }

  // app.bsky.video.getUploadLimits
  async getUploadLimits(req: Request, res: Response) {
    try {
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const DAILY_VIDEO_LIMIT = Number(process.env.VIDEO_DAILY_LIMIT || 10);
      const DAILY_BYTES_LIMIT = Number(process.env.VIDEO_DAILY_BYTES || 100 * 1024 * 1024);
      const todayJobs = await storage.getUserVideoJobs(userDid, 1000);
      const today = new Date(); today.setHours(0,0,0,0);
      const usedVideos = todayJobs.filter(j => j.createdAt >= today).length;
      const canUpload = usedVideos < DAILY_VIDEO_LIMIT;
      res.json({
        canUpload,
        remainingDailyVideos: Math.max(0, DAILY_VIDEO_LIMIT - usedVideos),
        remainingDailyBytes: DAILY_BYTES_LIMIT, // Without blob accounting, expose cap
        message: canUpload ? undefined : 'Daily upload limit reached',
        error: undefined,
      });
    } catch (error) {
      this._handleError(res, error, 'getUploadLimits');
    }
  }

  // Notification parity endpoints
  async getNotificationPreferences(req: Request, res: Response) {
    try {
      getNotificationPreferencesSchema.parse(req.query);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const prefs = await storage.getUserPreferences(userDid);
      res.json({ preferences: [{ $type: 'app.bsky.notification.defs#preferences', priority: !!prefs?.notificationPriority }] });
    } catch (error) {
      this._handleError(res, error, 'getNotificationPreferences');
    }
  }

  async listActivitySubscriptions(req: Request, res: Response) {
    try {
      listActivitySubscriptionsSchema.parse(req.query);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const subs = await storage.getUserPushSubscriptions(userDid);
      res.json({ subscriptions: subs.map(s => ({
        id: s.id,
        platform: s.platform,
        appId: s.appId,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })) });
    } catch (error) {
      this._handleError(res, error, 'listActivitySubscriptions');
    }
  }

  async putActivitySubscription(req: Request, res: Response) {
    try {
      const body = putActivitySubscriptionSchema.parse(req.body);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      // Upsert a synthetic web subscription for parity
      await storage.createPushSubscription({
        userDid,
        platform: 'web',
        token: `activity-${userDid}`,
        endpoint: undefined,
        keys: undefined,
        appId: body.subject || undefined,
      } as any);
      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'putActivitySubscription');
    }
  }

  async putNotificationPreferencesV2(req: Request, res: Response) {
    try {
      const params = putNotificationPreferencesV2Schema.parse(req.body);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      let prefs = await storage.getUserPreferences(userDid);
      if (!prefs) {
        prefs = await storage.createUserPreferences({
          userDid,
          notificationPriority: !!params.priority,
        } as any);
      } else {
        prefs = await storage.updateUserPreferences(userDid, {
          notificationPriority: params.priority ?? prefs.notificationPriority,
        });
      }
      res.json({ preferences: [{ $type: 'app.bsky.notification.defs#preferences', priority: !!prefs?.notificationPriority }] });
    } catch (error) {
      this._handleError(res, error, 'putNotificationPreferencesV2');
    }
  }

  async unregisterPush(req: Request, res: Response) {
    try {
      const params = unregisterPushSchema.parse(req.body);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      await storage.deletePushSubscriptionByToken(params.token);
      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'unregisterPush');
    }
  }

  // Feed interactions parity
  async sendInteractions(req: Request, res: Response) {
    try {
      const body = sendInteractionsSchema.parse(req.body);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      // Record basic metrics; future: persist interactions for ranking signals
      const { metricsService } = await import('./metrics');
      for (const _ of body.interactions) {
        metricsService.recordApiRequest();
      }
      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'sendInteractions');
    }
  }

  // Graph parity endpoints
  async getActorStarterPacks(req: Request, res: Response) {
    try {
      const params = getActorStarterPacksSchema.parse(req.query);
      const did = await this._resolveActor(res, params.actor);
      if (!did) return;
      const { starterPacks, cursor } = await storage.getStarterPacksByCreator(did, params.limit, params.cursor);
      res.json({ cursor, starterPacks: starterPacks.map(p => ({ uri: p.uri, cid: p.cid, record: { name: p.name, list: p.listUri, feeds: p.feeds, createdAt: p.createdAt.toISOString() } })), feeds: [] });
    } catch (error) {
      this._handleError(res, error, 'getActorStarterPacks');
    }
  }

  async getListsWithMembership(req: Request, res: Response) {
    try {
      const params = getListsWithMembershipSchema.parse(req.query);
      const did = await this._resolveActor(res, params.actor);
      if (!did) return;
      const lists = await storage.getUserLists(did, params.limit);
      res.json({ cursor: undefined, lists: lists.map((l) => ({ uri: l.uri, cid: l.cid, name: l.name, purpose: l.purpose })) });
    } catch (error) {
      this._handleError(res, error, 'getListsWithMembership');
    }
  }

  async getStarterPacksWithMembership(req: Request, res: Response) {
    try {
      const params = getStarterPacksWithMembershipSchema.parse(req.query);
      const did = params.actor ? await this._resolveActor(res, params.actor) : null;
      const { starterPacks, cursor } = did ? await storage.getStarterPacksByCreator(did, params.limit, params.cursor) : await storage.listStarterPacks(params.limit, params.cursor);
      res.json({ cursor, starterPacks: starterPacks.map(p => ({ uri: p.uri, cid: p.cid })) });
    } catch (error) {
      this._handleError(res, error, 'getStarterPacksWithMembership');
    }
  }

  async searchStarterPacks(req: Request, res: Response) {
    try {
      const params = searchStarterPacksSchema.parse(req.query);
      const { starterPacks, cursor } = await storage.searchStarterPacksByName(params.q, params.limit, params.cursor);
      res.json({ cursor, starterPacks: starterPacks.map(p => ({ uri: p.uri, cid: p.cid })) });
    } catch (error) {
      this._handleError(res, error, 'searchStarterPacks');
    }
  }

  async unmuteThread(req: Request, res: Response) {
    try {
      const body = muteThreadSchema.parse(req.body);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const { mutes } = await storage.getThreadMutes(userDid, 1000);
      const existing = mutes.find((m) => m.threadRootUri === body.root);
      if (existing) {
        await storage.deleteThreadMute(existing.uri);
      }
      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'unmuteThread');
    }
  }

  // Bookmark endpoints – minimal stubs
  async createBookmark(req: Request, res: Response) {
    try {
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const body = req.body as any;
      const postUri: string | undefined = body?.subject?.uri || body?.postUri;
      const postCid: string | undefined = body?.subject?.cid || body?.postCid;
      if (!postUri) {
        return res.status(400).json({ error: 'InvalidRequest', message: 'subject.uri is required' });
      }

      const rkey = `bmk_${Date.now()}`;
      const uri = `at://${userDid}/app.bsky.bookmark.bookmark/${rkey}`;

      // Ensure post exists locally; if not, try to fetch via PDS data fetcher
      const post = await storage.getPost(postUri);
      if (!post) {
        try {
          const { pdsDataFetcher } = await import('../services/pds-data-fetcher');
          pdsDataFetcher.markIncomplete('post', userDid, postUri);
        } catch {}
      }
      await storage.createBookmark({ uri, userDid, postUri, createdAt: new Date() });

      res.json({ uri, cid: postCid });
    } catch (error) {
      this._handleError(res, error, 'createBookmark');
    }
  }

  async deleteBookmark(req: Request, res: Response) {
    try {
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const body = req.body as any;
      const uri: string | undefined = body?.uri;
      if (!uri) {
        return res.status(400).json({ error: 'InvalidRequest', message: 'uri is required' });
      }
      await storage.deleteBookmark(uri);
      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'deleteBookmark');
    }
  }

  async getBookmarks(req: Request, res: Response) {
    try {
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const limit = Math.min(100, Number(req.query.limit) || 50);
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const { bookmarks, cursor: nextCursor } = await storage.getBookmarks(userDid, limit, cursor);
      const postUris = bookmarks.map(b => b.postUri);
      const viewerDid = await this.getAuthenticatedDid(req) || undefined;
      const posts = await storage.getPosts(postUris);
      const serialized = await this.serializePosts(posts, viewerDid);
      const byUri = new Map(serialized.map(p => [p.uri, p]));
      res.json({
        cursor: nextCursor,
        bookmarks: bookmarks.map(b => ({
          uri: b.uri,
          createdAt: b.createdAt.toISOString(),
          post: byUri.get(b.postUri),
        })).filter(b => !!b.post),
      });
    } catch (error) {
      this._handleError(res, error, 'getBookmarks');
    }
  }

  // Unspecced minimal responses
  async getPostThreadV2(req: Request, res: Response) {
    try {
      const params = getPostThreadV2Schema.parse(req.query);
      const posts = await storage.getPostThread(params.anchor);
      const viewerDid = await this.getAuthenticatedDid(req);
      const serialized = await this.serializePosts(posts, viewerDid || undefined);
      res.json({ hasOtherReplies: false, thread: serialized.length ? { $type: 'app.bsky.unspecced.defs#threadItemPost', post: serialized[0] } : null, threadgate: null });
    } catch (error) {
      this._handleError(res, error, 'getPostThreadV2');
    }
  }

  async getPostThreadOtherV2(req: Request, res: Response) {
    try {
      const _ = getPostThreadOtherV2Schema.parse(req.query);
      res.json({ hasOtherReplies: false, items: [] });
    } catch (error) {
      this._handleError(res, error, 'getPostThreadOtherV2');
    }
  }

  async getSuggestedUsersUnspecced(req: Request, res: Response) {
    try {
      const params = suggestedUsersUnspeccedSchema.parse(req.query);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const users = await storage.getSuggestedUsers(userDid, params.limit);
      res.json({ users: users.map((u) => ({ did: u.did, handle: u.handle, displayName: u.displayName, ...this.maybeAvatar(u.avatarUrl, u.did) })) });
    } catch (error) {
      this._handleError(res, error, 'getSuggestedUsersUnspecced');
    }
  }

  async getSuggestedFeedsUnspecced(req: Request, res: Response) {
    try {
      const _ = unspeccedNoParamsSchema.parse(req.query);
      const { generators } = await storage.getSuggestedFeeds(10);
      res.json({ feeds: generators.map((g) => g.uri) });
    } catch (error) {
      this._handleError(res, error, 'getSuggestedFeedsUnspecced');
    }
  }

  async getOnboardingSuggestedStarterPacks(req: Request, res: Response) {
    try {
      const _ = unspeccedNoParamsSchema.parse(req.query);
      // Return recent starter packs as onboarding suggestions
      const { starterPacks } = await storage.listStarterPacks(10);
      res.json({ starterPacks: starterPacks.map(p => ({ uri: p.uri, cid: p.cid, createdAt: p.createdAt.toISOString() })) });
    } catch (error) {
      this._handleError(res, error, 'getOnboardingSuggestedStarterPacks');
    }
  }

  async getTaggedSuggestions(req: Request, res: Response) {
    try {
      const _ = unspeccedNoParamsSchema.parse(req.query);
      // Return recent users as generic suggestions
      const users = await storage.getSuggestedUsers(undefined, 25);
      res.json({ suggestions: users.map(u => ({ did: u.did, handle: u.handle, displayName: u.displayName, ...this.maybeAvatar(u.avatarUrl, u.did) })) });
    } catch (error) {
      this._handleError(res, error, 'getTaggedSuggestions');
    }
  }

  async getTrendingTopics(req: Request, res: Response) {
    try {
      const _ = unspeccedNoParamsSchema.parse(req.query);
      // Placeholder: compute trending by most reposted authors' handles
      const stats = await storage.getStats();
      res.json({ topics: stats.totalPosts > 0 ? ["#bluesky", "#atproto"] : [] });
    } catch (error) {
      this._handleError(res, error, 'getTrendingTopics');
    }
  }

  async getTrends(req: Request, res: Response) {
    try {
      const _ = unspeccedNoParamsSchema.parse(req.query);
      res.json({ trends: [{ topic: "#bluesky", count: 0 }] });
    } catch (error) {
      this._handleError(res, error, 'getTrends');
    }
  }

  async getUnspeccedConfig(req: Request, res: Response) {
    try {
      // Get country code from request headers or IP
      // Default to US for self-hosted instances
      const countryCode = req.headers['cf-ipcountry'] || 
                          req.headers['x-country-code'] || 
                          process.env.DEFAULT_COUNTRY_CODE || 
                          'US';
      
      const regionCode = req.headers['cf-region-code'] || 
                         req.headers['x-region-code'] || 
                         process.env.DEFAULT_REGION_CODE || 
                         '';

      // For self-hosted instances, disable age restrictions unless explicitly configured
      const isAgeBlockedGeo = process.env.AGE_BLOCKED_GEOS?.split(',')?.includes(countryCode.toString()) || false;
      const isAgeRestrictedGeo = process.env.AGE_RESTRICTED_GEOS?.split(',')?.includes(countryCode.toString()) || false;

      res.json({ 
        liveNowConfig: { enabled: false },
        countryCode: countryCode.toString().substring(0, 2),
        regionCode: regionCode ? regionCode.toString() : undefined,
        isAgeBlockedGeo,
        isAgeRestrictedGeo,
      });
    } catch (error) {
      this._handleError(res, error, 'getUnspeccedConfig');
    }
  }

  async getAgeAssuranceState(req: Request, res: Response) {
    try {
      res.json({ state: 'unknown' });
    } catch (error) {
      this._handleError(res, error, 'getAgeAssuranceState');
    }
  }

  async initAgeAssurance(req: Request, res: Response) {
    try {
      res.json({ ok: true });
    } catch (error) {
      this._handleError(res, error, 'initAgeAssurance');
    }
  }

  // Previously stubbed endpoints completed for parity
  async queryLabels(req: Request, res: Response) {
    try {
      const params = queryLabelsSchema.parse(req.query);
      const subjects = params.uriPatterns ?? [];
      if (subjects.some((u) => u.includes('*'))) {
        return res
          .status(400)
          .json({ error: 'InvalidRequest', message: 'wildcards not supported' });
      }
      const sources = params.sources ?? [];
      if (sources.length === 0) {
        return res
          .status(400)
          .json({ error: 'InvalidRequest', message: 'source dids are required' });
      }
      const labels = await storage.getLabelsForSubjects(subjects);
      const filtered = labels.filter((l) => sources.includes(l.src));
      res.json({ cursor: undefined, labels: filtered });
    } catch (error) {
      this._handleError(res, error, 'queryLabels');
    }
  }
  async createReport(req: Request, res: Response) {
    try {
      const params = createReportSchema.parse(req.body);
      const reporterDid = (await this.getAuthenticatedDid(req)) ||
        (req as any).user?.did ||
        'did:unknown:anonymous';
      const report = await storage.createModerationReport({
        reporterDid,
        reasonType: params.reasonType,
        reason: params.reason || null,
        subject: params.subject.uri || params.subject.did || params.subject.cid || 'unknown',
        createdAt: new Date(),
        status: 'open',
      } as any);
      res.json({ id: report.id, success: true });
    } catch (error) {
      this._handleError(res, error, 'createReport');
    }
  }
  async searchPosts(req: Request, res: Response) {
    try {
      const params = searchPostsSchema.parse(req.query);
      const viewerDid = await this.getAuthenticatedDid(req);
      const { posts, cursor } = await searchService.searchPosts(
        params.q,
        params.limit,
        params.cursor,
        viewerDid || undefined,
      );
      const serialized = await this.serializePosts(posts as any, viewerDid || undefined);
      res.json({ posts: serialized, cursor });
    } catch (error) {
      this._handleError(res, error, 'searchPosts');
    }
  }
  async searchActors(req: Request, res: Response) {
    try {
      const params = searchActorsSchema.parse(req.query);
      const term = (params.q || params.term)!;
      const { actors, cursor } = await searchService.searchActors(
        term,
        params.limit,
        params.cursor,
      );
      const dids = actors.map((a) => a.did);
      const users = await storage.getUsers(dids);
      const userMap = new Map(users.map((u) => [u.did, u]));
      const results = actors
        .map((a) => {
          const u = userMap.get(a.did);
          if (!u) return null;
          return {
            did: u.did,
            handle: u.handle,
            displayName: u.displayName,
            ...this.maybeAvatar(u.avatarUrl, u.did),
          };
        })
        .filter(Boolean);
      res.json({ actors: results, cursor });
    } catch (error) {
      this._handleError(res, error, 'searchActors');
    }
  }
  async searchActorsTypeahead(req: Request, res: Response) {
    try {
      const params = searchActorsTypeaheadSchema.parse(req.query);
      const results = await searchService.searchActorsTypeahead(
        (params.q || params.term)!,
        params.limit,
      );
      res.json({ actors: results });
    } catch (error) {
      this._handleError(res, error, 'searchActorsTypeahead');
    }
  }
  async listNotifications(req: Request, res: Response) {
    try {
      const params = listNotificationsSchema.parse(req.query);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const notificationsList = await storage.getNotifications(
        userDid,
        params.limit,
        params.cursor,
      );

      const authorDids = Array.from(
        new Set(notificationsList.map((n) => n.authorDid)),
      );
      
      // Ensure all author profiles are loaded
      await Promise.all(
        authorDids.map(authorDid => lazyDataLoader.ensureUserProfile(authorDid))
      );
      
      const authors = await storage.getUsers(authorDids);
      const authorMap = new Map(authors.map((a) => [a.did, a]));

      const items = await Promise.all(notificationsList.map(async (n) => {
        const author = authorMap.get(n.authorDid);
        
        // Skip notifications from authors without valid handles
        if (!author || !author.handle) {
          console.warn(`[XRPC] Skipping notification from ${n.authorDid} - no valid handle`);
          return null;
        }
        
        // Validate that the notification subject still exists
        let reasonSubject = n.reasonSubject;
        let record = { $type: 'app.bsky.notification.defs#recordDeleted' };
        
        if (reasonSubject) {
          try {
            // For post-related notifications, check if the post still exists
            if (n.reason === 'like' || n.reason === 'repost' || n.reason === 'reply' || n.reason === 'quote') {
              const post = await storage.getPost(reasonSubject);
              if (!post) {
                // Post was deleted, filter out this notification
                return null;
              }
              record = {
                $type: 'app.bsky.feed.post',
                text: post.text,
                createdAt: post.createdAt.toISOString(),
              };
              if (post.embed) record.embed = post.embed;
              if (post.facets) record.facets = post.facets;
            }
          } catch (error) {
            console.warn('[NOTIFICATIONS] Failed to fetch record for subject:', { reasonSubject }, error);
            // If we can't fetch the record, filter out this notification
            return null;
          }
        } else {
          // For notifications without a reasonSubject (like follows), create a fallback
          reasonSubject = `at://${n.authorDid}/app.bsky.graph.follow/${n.indexedAt.getTime()}`;
        }
        
        // Create proper AT URI based on notification reason
        let notificationUri = reasonSubject;
        if (!notificationUri) {
          // For follow notifications, create a follow record URI
          if (n.reason === 'follow') {
            notificationUri = `at://${n.authorDid}/app.bsky.graph.follow/${n.indexedAt.getTime()}`;
          } else {
            // Fallback for other cases
            notificationUri = `at://${n.authorDid}/app.bsky.feed.post/unknown`;
          }
        }

        // Use the actual CID from the database if available, otherwise generate a placeholder
        const notificationCid = n.cid || `bafkrei${Buffer.from(`${n.uri}-${n.indexedAt.getTime()}`).toString('base64url').slice(0, 44)}`;

        const view: any = {
          $type: 'app.bsky.notification.listNotifications#notification',
          uri: notificationUri,
          cid: notificationCid,
          isRead: n.isRead,
          indexedAt: n.indexedAt.toISOString(),
          reason: n.reason,
          reasonSubject: reasonSubject, // Always a string now
          record: record || { $type: 'app.bsky.notification.defs#recordDeleted' },
          author: {
            $type: 'app.bsky.actor.defs#profileViewBasic',
            did: author.did,
            handle: author.handle,
            displayName: author.displayName ?? author.handle,
            pronouns: author.pronouns,
            ...this.maybeAvatar(author.avatarUrl, author.did),
            associated: {
              $type: 'app.bsky.actor.defs#profileAssociated',
              lists: 0,
              feedgens: 0,
              starterPacks: 0,
              labeler: false,
              chat: undefined,
              activitySubscription: undefined,
            },
            viewer: {
              $type: 'app.bsky.actor.defs#viewerState',
              muted: false,
              mutedByList: undefined,
              blockedBy: false,
              blocking: undefined,
              blockingByList: undefined,
              following: undefined,
              followedBy: undefined,
              knownFollowers: undefined,
              activitySubscription: undefined,
            },
            labels: [],
            createdAt: author.createdAt?.toISOString(),
            verification: undefined,
            status: undefined,
          },
        };
        return view;
      }));

      // Filter out null items (deleted content)
      const validItems = items.filter(item => item !== null);

      const cursor = notificationsList.length
        ? notificationsList[notificationsList.length - 1].indexedAt.toISOString()
        : undefined;

      res.json({ notifications: validItems, cursor });
    } catch (error) {
      this._handleError(res, error, 'listNotifications');
    }
  }
  async getUnreadCount(req: Request, res: Response) {
    try {
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const count = await storage.getUnreadNotificationCount(userDid);
      res.json({ count });
    } catch (error) {
      this._handleError(res, error, 'getUnreadCount');
    }
  }
  async updateSeen(req: Request, res: Response) {
    try {
      const params = updateSeenSchema.parse(req.body);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      await storage.markNotificationsAsRead(
        userDid,
        params.seenAt ? new Date(params.seenAt) : undefined,
      );
      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'updateSeen');
    }
  }
  async getList(req: Request, res: Response) {
    try {
      const params = getListSchema.parse(req.query);
      const list = await storage.getList(params.list);
      if (!list)
        return res
          .status(404)
          .json({ error: 'NotFound', message: 'List not found' });
      res.json({
        list: {
          uri: list.uri,
          cid: list.cid,
          name: list.name,
          purpose: list.purpose,
          createdAt: list.createdAt.toISOString(),
          indexedAt: list.indexedAt.toISOString(),
        },
      });
    } catch (error) {
      this._handleError(res, error, 'getList');
    }
  }
  async getLists(req: Request, res: Response) {
    try {
      const params = getListsSchema.parse(req.query);
      const did = await this._resolveActor(res, params.actor);
      if (!did) return;
      const lists = await storage.getUserLists(did, params.limit);
      res.json({
        lists: lists.map((l) => ({
          uri: l.uri,
          cid: l.cid,
          name: l.name,
          purpose: l.purpose,
          createdAt: l.createdAt.toISOString(),
          indexedAt: l.indexedAt.toISOString(),
        })),
      });
    } catch (error) {
      this._handleError(res, error, 'getLists');
    }
  }
  async getListFeed(req: Request, res: Response) {
    try {
      const params = getListFeedSchema.parse(req.query);
      const posts = await storage.getListFeed(
        params.list,
        params.limit,
        params.cursor,
      );
      const viewerDid = await this.getAuthenticatedDid(req);
      const serialized = await this.serializePosts(
        posts,
        viewerDid || undefined,
      );
      const oldest = posts.length ? posts[posts.length - 1] : null;
      res.json({
        cursor: oldest ? oldest.indexedAt.toISOString() : undefined,
        feed: serialized.map((p) => ({ post: p })),
      });
    } catch (error) {
      this._handleError(res, error, 'getListFeed');
    }
  }
  async getPosts(req: Request, res: Response) {
    try {
      const params = getPostsSchema.parse(req.query);
      const viewerDid = await this.getAuthenticatedDid(req);
      const posts = await storage.getPosts(params.uris);
      const serializedPosts = await this.serializePosts(
        posts,
        viewerDid || undefined,
      );
      res.json({ posts: serializedPosts });
    } catch (error) {
      this._handleError(res, error, 'getPosts');
    }
  }
  async getLikes(req: Request, res: Response) {
    try {
      const params = getLikesSchema.parse(req.query);
      const viewerDid = await this.getAuthenticatedDid(req);

      const { likes, cursor } = await storage.getPostLikes(
        params.uri,
        params.limit,
        params.cursor,
      );
      const userDids = likes.map((like) => like.userDid);
      const users = await storage.getUsers(userDids);
      const userMap = new Map(users.map((u) => [u.did, u]));

      const relationships = viewerDid
        ? await storage.getRelationships(viewerDid, userDids)
        : new Map();

      res.json({
        uri: params.uri,
        cid: params.cid,
        cursor: cursor,
        likes: likes
          .map((like) => {
            const user = userMap.get(like.userDid);
            if (!user) return null;

            const viewerState = viewerDid
              ? relationships.get(like.userDid)
              : null;
            const viewer = {
              muted: viewerState ? !!viewerState.muting : false,
              blockedBy: viewerState?.blockedBy || false,
              blocking: viewerState?.blocking || undefined,
              following: viewerState?.following || undefined,
              followedBy: viewerState?.followedBy || undefined,
            };

            return {
              actor: {
                did: user.did,
                handle: user.handle,
                displayName: user.displayName || user.handle, // Fallback to handle if displayName is null/undefined
                ...this.maybeAvatar(user.avatarUrl, user.did),
                viewer,
              },
              createdAt: like.createdAt.toISOString(),
              indexedAt: like.indexedAt.toISOString(),
            };
          })
          .filter(Boolean),
      });
    } catch (error) {
      this._handleError(res, error, 'getLikes');
    }
  }
  async getRepostedBy(req: Request, res: Response) {
    try {
      const params = getRepostedBySchema.parse(req.query);
      const viewerDid = await this.getAuthenticatedDid(req);

      const { reposts, cursor } = await storage.getPostReposts(
        params.uri,
        params.limit,
        params.cursor,
      );
      const userDids = reposts.map((repost) => repost.userDid);
      const users = await storage.getUsers(userDids);
      const userMap = new Map(users.map((u) => [u.did, u]));

      const relationships = viewerDid
        ? await storage.getRelationships(viewerDid, userDids)
        : new Map();

      res.json({
        uri: params.uri,
        cid: params.cid,
        cursor: cursor,
        repostedBy: reposts
          .map((repost) => {
            const user = userMap.get(repost.userDid);
            if (!user) return null;

            const viewerState = viewerDid
              ? relationships.get(repost.userDid)
              : null;
            const viewer = {
              muted: viewerState ? !!viewerState.muting : false,
              blockedBy: viewerState?.blockedBy || false,
              blocking: viewerState?.blocking || undefined,
              following: viewerState?.following || undefined,
              followedBy: viewerState?.followedBy || undefined,
            };

            return {
              did: user.did,
              handle: user.handle,
              displayName: user.displayName || user.handle, // Fallback to handle if displayName is null/undefined
              avatar: user.avatarUrl ? this.transformBlobToCdnUrl(user.avatarUrl, user.did, 'avatar') : undefined,
              viewer,
              indexedAt: repost.indexedAt.toISOString(),
            };
          })
          .filter(Boolean),
      });
    } catch (error) {
      this._handleError(res, error, 'getRepostedBy');
    }
  }
  async getQuotes(req: Request, res: Response) {
    try {
      const params = getQuotesSchema.parse(req.query);
      const viewerDid = await this.getAuthenticatedDid(req);
      const posts = await storage.getQuotePosts(
        params.uri,
        params.limit,
        params.cursor,
      );
      const serialized = await this.serializePosts(
        posts,
        viewerDid || undefined,
      );
      const oldest = posts.length ? posts[posts.length - 1] : null;
      res.json({
        posts: serialized,
        cursor: oldest ? oldest.indexedAt.toISOString() : undefined,
        uri: params.uri,
        cid: params.cid,
      });
    } catch (error) {
      this._handleError(res, error, 'getQuotes');
    }
  }
  async getActorLikes(req: Request, res: Response) {
    try {
      const params = getActorLikesSchema.parse(req.query);
      const viewerDid = await this.getAuthenticatedDid(req);

      let actorDid = params.actor;
      if (!params.actor.startsWith('did:')) {
        const user = await storage.getUserByHandle(params.actor);
        if (!user) {
          return res.status(404).json({ error: 'Actor not found' });
        }
        actorDid = user.did;
      }

      const { likes, cursor } = await storage.getActorLikes(
        actorDid,
        params.limit,
        params.cursor,
      );

      const postUris = likes.map((like) => like.postUri);
      const posts = await storage.getPosts(postUris);
      
      // Log if there's a mismatch between liked posts and fetched posts
      if (posts.length !== postUris.length) {
        console.warn(`[XRPC] getActorLikes: Expected ${postUris.length} posts, but only found ${posts.length}`);
        const foundUris = new Set(posts.map(p => p.uri));
        const missingUris = postUris.filter(uri => !foundUris.has(uri));
        console.warn(`[XRPC] Missing posts:`, missingUris);
      }
      
      const serializedPosts = await this.serializePosts(
        posts,
        viewerDid || undefined,
      );

      // Log if posts were filtered out during serialization (e.g., due to invalid handles)
      if (serializedPosts.length !== posts.length) {
        console.warn(`[XRPC] getActorLikes: ${posts.length - serializedPosts.length} posts filtered out during serialization`);
      }

      res.json({
        cursor,
        feed: serializedPosts.map((post) => ({ post })),
      });
    } catch (error) {
      this._handleError(res, error, 'getActorLikes');
    }
  }
}

export const xrpcApi = new XRPCApi();
