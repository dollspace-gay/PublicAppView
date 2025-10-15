/**
 * Health Check Server
 *
 * Provides HTTP health check endpoint for monitoring the Constellation bridge service.
 * Returns detailed status information including API connectivity and cache stats.
 */

import express, { type Express, type Request, type Response } from 'express';
import { Server } from 'http';
import { ConstellationAPIClient } from './api-client.js';
import { StatsEnricher } from './enricher.js';

interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  constellation: {
    connected: boolean;
    url: string;
  };
  cache: {
    enabled: boolean;
    ttl: number;
    statsRequested: number;
    cacheHits: number;
    cacheMisses: number;
    hitRate: string;
  };
  version: string;
}

export class HealthCheckServer {
  private app: Express;
  private server: Server | null = null;
  private port: number;
  private apiClient: ConstellationAPIClient;
  private enricher: StatsEnricher;
  private startTime: number;

  constructor(
    port: number,
    apiClient: ConstellationAPIClient,
    enricher: StatsEnricher
  ) {
    this.port = port;
    this.apiClient = apiClient;
    this.enricher = enricher;
    this.startTime = Date.now();
    this.app = express();
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', async (req: Request, res: Response) => {
      try {
        // Check Constellation API connectivity
        const constellationHealthy = await this.apiClient.healthCheck();

        const cacheStats = this.enricher.getCacheStats();

        const status: HealthStatus = {
          status: constellationHealthy ? 'healthy' : 'degraded',
          timestamp: new Date().toISOString(),
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          constellation: {
            connected: constellationHealthy,
            url: this.apiClient['baseUrl'], // Access private property for status
          },
          cache: cacheStats,
          version: '1.0.0',
        };

        const httpStatus = status.status === 'healthy' ? 200 : 503;
        res.status(httpStatus).json(status);
      } catch (error) {
        console.error('[HEALTH] Error checking health:', error);
        res.status(503).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Readiness check (simpler version for k8s/docker)
    this.app.get('/ready', async (req: Request, res: Response) => {
      try {
        const healthy = await this.apiClient.healthCheck();
        res.status(healthy ? 200 : 503).send(healthy ? 'ready' : 'not ready');
      } catch (error) {
        res.status(503).send('not ready');
      }
    });

    // Liveness check (always returns 200 if server is responding)
    this.app.get('/live', (req: Request, res: Response) => {
      res.status(200).send('alive');
    });

    // Stats endpoint (for debugging/monitoring)
    this.app.get('/stats', (req: Request, res: Response) => {
      const stats = {
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        cache: this.enricher.getCacheStats(),
        timestamp: new Date().toISOString(),
      };
      res.json(stats);
    });
  }

  start(): void {
    this.setupRoutes();

    this.server = this.app.listen(this.port, () => {
      console.log(
        `[HEALTH] Health check server listening on port ${this.port}`
      );
      console.log(`[HEALTH] Endpoints:`);
      console.log(
        `[HEALTH]   GET http://localhost:${this.port}/health - Full health status`
      );
      console.log(
        `[HEALTH]   GET http://localhost:${this.port}/ready  - Readiness probe`
      );
      console.log(
        `[HEALTH]   GET http://localhost:${this.port}/live   - Liveness probe`
      );
      console.log(
        `[HEALTH]   GET http://localhost:${this.port}/stats  - Cache statistics`
      );
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close(() => {
        console.log('[HEALTH] Health check server stopped');
      });
      this.server = null;
    }
  }
}
