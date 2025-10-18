import 'dotenv/config';
import express, { type Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { registerRoutes } from './routes';
import { setupVite, serveStatic, log } from './vite';
import { logCollector } from './services/log-collector';
import { cacheService } from './services/cache';

const app = express();

// Disable X-Powered-By header to prevent information disclosure
app.disable('x-powered-by');

// Trust proxy for proper IP detection behind reverse proxies (Replit, Cloudflare, etc.)
app.set('trust proxy', 1);

// Use 'extended' query parser to handle array parameters from clients
app.set('query parser', 'extended');

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Cookie parser for CSRF tokens
app.use(cookieParser());

// A custom, safe JSON body parser that doesn't crash on malformed input
const safeJsonParser = (req: Request, res: Response, next: NextFunction) => {
  // We only care about requests that might have a JSON body
  if (
    req.method === 'GET' ||
    req.method === 'HEAD' ||
    req.method === 'OPTIONS' ||
    req.method === 'DELETE'
  ) {
    return next();
  }

  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    return next();
  }

  const chunks: Buffer[] = [];
  let totalLength = 0;
  const limit = 10 * 1024 * 1024; // 10mb limit

  req.on('data', (chunk: Buffer) => {
    totalLength += chunk.length;
    if (totalLength > limit) {
      res.status(413).json({
        error: 'PayloadTooLarge',
        message: 'Request body exceeds 10mb limit',
      });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (req.destroyed) return;

    const bodyBuffer = Buffer.concat(chunks);

    // Replicate the 'verify' functionality to store the raw body
    (req as Request & { rawBody?: Buffer }).rawBody = bodyBuffer;

    if (bodyBuffer.length === 0) {
      req.body = {};
      return next();
    }

    try {
      const bodyString = bodyBuffer.toString('utf8');
      req.body = JSON.parse(bodyString);
      next();
    } catch (error) {
      console.error('[BODY_PARSER] Malformed JSON received:', error);
      res.status(400).json({
        error: 'BadRequest',
        message: 'Malformed JSON in request body',
      });
    }
  });

  req.on('error', (err) => {
    console.error('[BODY_PARSER] Request stream error:', err);
    next(err);
  });
};

app.use(safeJsonParser);
app.use(
  express.urlencoded({
    extended: false,
    limit: '10mb', // Same limit for URL-encoded data
  })
);

// CORS configuration - Following ATProto standards
// ATProto services are public APIs using bearer token auth (Authorization header),
// not session cookies, so CSRF protection via origin restrictions is not necessary.
// This matches how official Bluesky AppView handles CORS.
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Allow all origins for XRPC/API endpoints (standard ATProto behavior)
  // Use wildcard for requests without origin, or reflect origin for credentialed requests
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Accept, atproto-accept-labelers, X-CSRF-Token'
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'atproto-content-labelers, atproto-repo-rev, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset'
  );
  // Cache preflight requests for 24 hours
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
});

// Logging configuration
const MAX_LOG_LINE_LENGTH = 80;
const MAX_LOG_LINE_LENGTH_TRUNCATED = 79;

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on('finish', () => {
    const duration = Date.now() - start;
    if (path.startsWith('/api')) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > MAX_LOG_LINE_LENGTH) {
        logLine = logLine.slice(0, MAX_LOG_LINE_LENGTH_TRUNCATED) + '…';
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Initialize search extensions before registering routes
  const { initSearchExtensions } = await import(
    './scripts/init-search-extensions'
  );
  await initSearchExtensions();

  const server = await registerRoutes(app);

  app.use(
    (
      err: Error & { status?: number; statusCode?: number },
      req: Request,
      res: Response,
      _next: NextFunction
    ) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || 'Internal Server Error';

      // Log error for debugging
      console.error('[ERROR]', err);
      logCollector.error('Request error', {
        error: message,
        status,
        stack: err.stack,
      });

      // Ensure CORS headers are present on error responses
      const origin = req.headers.origin;
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }

      res.status(status).json({ message });
      // DO NOT throw after sending response - this would crash the server
    }
  );

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get('env') === 'development') {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen(
    {
      port,
      host: '0.0.0.0',
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      logCollector.success(
        `AT Protocol App View service started on port ${port}`
      );
      logCollector.info('Database connection initialized');
      logCollector.info('XRPC endpoints registered and ready');

      // Initialize database health monitoring
      import('./services/database-health').then(({ databaseHealthService }) => {
        databaseHealthService.start().catch((err) => {
          console.error('[DB_HEALTH] Failed to start health monitoring:', err);
        });
      });

      // Initialize cache service
      cacheService
        .connect()
        .then(() => {
          logCollector.info('Redis cache service initialized');
        })
        .catch((err) => {
          console.error('[CACHE] Failed to initialize cache service:', err);
        });

      // Initialize data pruning service (if enabled)
      import('./services/data-pruning').then(
        ({ dataPruningService: _dataPruningService }) => {
          // Service auto-initializes in its constructor
        }
      );

      // TypeScript backfill service is PERMANENTLY DISABLED
      // Backfill functionality has been moved to Python (python-firehose/backfill_service.py)
      // The Python implementation provides better performance and resource management
      // To run backfill, use the Python unified worker with BACKFILL_DAYS environment variable
      console.log(
        '[BACKFILL] TypeScript backfill is permanently disabled. Use Python backfill service instead.'
      );
    }
  );
})();
