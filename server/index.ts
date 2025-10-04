import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { logCollector } from "./services/log-collector";
import { spawn } from "child_process";

const app = express();

// Start Redis in development
if (process.env.NODE_ENV === "development") {
  const redisProcess = spawn("redis-server", [
    "--port", "6379",
    "--dir", "/tmp",
    "--save", "",
    "--appendonly", "no"
  ], {
    stdio: "ignore",
    detached: true
  });
  
  redisProcess.unref();
  console.log("[REDIS] Started Redis server process");
  
  process.on("SIGTERM", () => {
    redisProcess.kill();
  });
  
  process.on("SIGINT", () => {
    redisProcess.kill();
    process.exit();
  });
}

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

// CORS configuration - Allow all origins for AppView API
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, atproto-accept-labelers');
  res.setHeader('Access-Control-Expose-Headers', 'atproto-content-labelers, atproto-repo-rev');
  
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
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > MAX_LOG_LINE_LENGTH) {
        logLine = logLine.slice(0, MAX_LOG_LINE_LENGTH_TRUNCATED) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Log error for debugging
    console.error("[ERROR]", err);
    logCollector.error("Request error", { 
      error: message, 
      status, 
      stack: err.stack 
    });

    res.status(status).json({ message });
    // DO NOT throw after sending response - this would crash the server
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    logCollector.success(`AT Protocol App View service started on port ${port}`);
    logCollector.info("Database connection initialized");
    logCollector.info("XRPC endpoints registered and ready");
    
    // Initialize data pruning service (if enabled)
    import("./services/data-pruning").then(({ dataPruningService }) => {
      // Service auto-initializes in its constructor
    });
    
    // Initialize backfill service (if enabled) - ONLY on primary worker (worker 0)
    // In PM2 cluster mode, pm_id indicates the worker number (0, 1, 2, ...)
    const workerId = process.env.pm_id || process.env.NODE_APP_INSTANCE || "0";
    const isPrimaryWorker = workerId === "0";
    
    if (isPrimaryWorker) {
      import("./services/backfill").then(({ backfillService }) => {
        const backfillDays = parseInt(process.env.BACKFILL_DAYS || "0");
        if (backfillDays > 0) {
          console.log(`[BACKFILL] Starting ${backfillDays}-day historical backfill...`);
          backfillService.start().catch(err => {
            console.error("[BACKFILL] Failed to start:", err);
          });
        } else {
          console.log("[BACKFILL] Disabled (BACKFILL_DAYS=0 or not set)");
        }
      });
    } else {
      console.log(`[BACKFILL] Skipped on worker ${workerId} (only runs on primary worker)`);
    }
  });
})();
