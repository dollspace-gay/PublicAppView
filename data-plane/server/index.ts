import express, { type Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { firehoseClient } from '../../server/services/firehose';
import { eventProcessor } from '../../server/services/event-processor';
import { redisQueue } from '../../server/services/redis-queue';
import { logCollector } from '../../server/services/log-collector';
import { metricsService } from '../../server/services/metrics';
import { cacheService } from './services/cache';

// Import internal routes
import { profileRoutes } from './routes/profile';
import { feedRoutes } from './routes/feeds';
import { graphRoutes } from './routes/graph';
import { searchRoutes } from './routes/search';
import { notificationRoutes } from './routes/notifications';
import { feedGeneratorRoutes } from './routes/feed-generators';

const app = express();

// Disable X-Powered-By header
app.disable('x-powered-by');

// Trust proxy for proper IP detection
app.set('trust proxy', 1);

// JSON body parser
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `[DATA_PLANE] ${req.method} ${req.path} ${res.statusCode} in ${duration}ms`
    );
  });

  next();
});

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'data-plane',
    timestamp: new Date().toISOString(),
  });
});

// Readiness check endpoint
app.get('/ready', async (_req, res) => {
  try {
    const firehoseStatus = await firehoseClient.getStatus();
    const redisConnected = redisQueue.isConnected();
    const cacheStats = await cacheService.getStats();

    const ready =
      firehoseStatus.connected && redisConnected && cacheStats.connected;

    res.status(ready ? 200 : 503).json({
      ready,
      firehose: {
        connected: firehoseStatus.connected,
        cursor: firehoseStatus.currentCursor?.slice(0, 20) + '...',
      },
      redis: {
        connected: redisConnected,
      },
      cache: {
        connected: cacheStats.connected,
        keyCount: cacheStats.keyCount,
        memoryUsage: cacheStats.memoryUsage,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      ready: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
});

// Metrics endpoint
app.get('/metrics', (_req, res) => {
  const metrics = {
    firehose: metricsService.getFirehoseMetrics(),
    eventProcessor: eventProcessor.getMetrics(),
    system: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    },
  };

  res.json(metrics);
});

// Internal RPC routes (not exposed to public)
app.use('/internal', profileRoutes);
app.use('/internal', feedRoutes);
app.use('/internal', graphRoutes);
app.use('/internal', searchRoutes);
app.use('/internal', notificationRoutes);
app.use('/internal', feedGeneratorRoutes);

// Error handler
app.use(
  (
    err: Error & { status?: number },
    _req: Request,
    res: Response,
    _next: NextFunction
  ) => {
    const status = err.status || 500;
    const message = err.message || 'Internal Server Error';

    console.error('[DATA_PLANE] Error:', err);
    logCollector.error('Data-plane error', {
      error: message,
      status,
      stack: err.stack,
    });

    res.status(status).json({ error: message });
  }
);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Initialize and start server
async function start() {
  try {
    console.log('[DATA_PLANE] Starting data-plane server...');

    // Connect to Redis
    await redisQueue.connect();
    console.log('[DATA_PLANE] Connected to Redis');

    // Connect cache service
    await cacheService.connect();
    console.log('[DATA_PLANE] Connected cache service');

    // Initialize Redis pub/sub for event broadcasting
    await redisQueue.initializePubSub();
    console.log('[DATA_PLANE] Initialized Redis pub/sub');

    // Connect to firehose (worker 0, total 1 worker in data-plane)
    await firehoseClient.connect(0, 1);
    console.log('[DATA_PLANE] Connected to firehose');

    // Subscribe to Redis events from firehose
    redisQueue.subscribe((event) => {
      // Process events from Redis queue
      if (event.type === 'commit') {
        eventProcessor.processCommit(event.data).catch((error) => {
          console.error('[DATA_PLANE] Error processing commit event:', error);
        });
      } else if (event.type === 'identity') {
        eventProcessor.processIdentity(event.data).catch((error) => {
          console.error('[DATA_PLANE] Error processing identity event:', error);
        });
      } else if (event.type === 'account') {
        eventProcessor.processAccount(event.data).catch((error) => {
          console.error('[DATA_PLANE] Error processing account event:', error);
        });
      }
    });
    console.log('[DATA_PLANE] Subscribed to Redis events');

    // Start HTTP server
    const port = parseInt(process.env.DATA_PLANE_PORT || '5001', 10);
    const httpServer = createServer(app);

    httpServer.listen(port, '0.0.0.0', () => {
      console.log(`[DATA_PLANE] Server listening on port ${port}`);
      logCollector.success(`Data-plane server started on port ${port}`);
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log('[DATA_PLANE] Shutting down gracefully...');

      firehoseClient.disconnect();
      await cacheService.disconnect();
      await redisQueue.disconnect();

      httpServer.close(() => {
        console.log('[DATA_PLANE] Server closed');
        process.exit(0);
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        console.error('[DATA_PLANE] Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    console.error('[DATA_PLANE] Failed to start:', error);
    logCollector.error('Data-plane startup failed', { error });
    process.exit(1);
  }
}

// Start server if running directly
if (require.main === module) {
  start();
}

export { app, start };
