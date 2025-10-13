/**
 * Constellation Bridge Service
 * 
 * Main entry point for the Constellation API bridge.
 * Connects to Constellation's backlink index and provides enriched stats via Redis cache.
 */

import dotenv from 'dotenv';
import { ConstellationAPIClient } from './api-client.js';
import { StatsEnricher } from './enricher.js';
import { HealthCheckServer } from './health.js';

dotenv.config();

interface BridgeConfig {
  constellation: {
    url: string;
    timeout: number;
    userAgent: string;
    maxRequestsPerSecond: number;
  };
  cache: {
    enabled: boolean;
    ttl: number;
    redisUrl?: string;
  };
  health: {
    port: number;
  };
}

class ConstellationBridge {
  private config: BridgeConfig;
  private apiClient: ConstellationAPIClient;
  private enricher: StatsEnricher;
  private healthServer: HealthCheckServer | null = null;
  private isRunning = false;

  constructor(config: BridgeConfig) {
    this.config = config;

    // Initialize API client
    this.apiClient = new ConstellationAPIClient({
      baseUrl: config.constellation.url,
      timeout: config.constellation.timeout,
      userAgent: config.constellation.userAgent,
      maxRequestsPerSecond: config.constellation.maxRequestsPerSecond,
    });

    // Initialize enricher with caching
    this.enricher = new StatsEnricher(this.apiClient, {
      cacheEnabled: config.cache.enabled,
      cacheTTL: config.cache.ttl,
      redisUrl: config.cache.redisUrl,
    });

    console.log('[BRIDGE] Constellation bridge initialized');
    console.log(`[BRIDGE] API URL: ${config.constellation.url}`);
    console.log(`[BRIDGE] Cache: ${config.cache.enabled ? 'enabled' : 'disabled'} (TTL: ${config.cache.ttl}s)`);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[BRIDGE] Already running');
      return;
    }

    console.log('[BRIDGE] Starting Constellation bridge...');

    // Test connection to Constellation API
    try {
      const healthy = await this.apiClient.healthCheck();
      if (!healthy) {
        console.warn('[BRIDGE] Warning: Constellation API health check failed, but continuing...');
      } else {
        console.log('[BRIDGE] Constellation API connection verified');
      }
    } catch (error) {
      console.error('[BRIDGE] Error checking Constellation API:', error);
      console.warn('[BRIDGE] Continuing anyway, will retry on actual requests');
    }

    // Start health check server
    this.healthServer = new HealthCheckServer(
      this.config.health.port,
      this.apiClient,
      this.enricher
    );
    this.healthServer.start();

    this.isRunning = true;
    console.log('[BRIDGE] Constellation bridge started successfully');
    console.log('[BRIDGE] Service ready to enrich posts and profiles');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('[BRIDGE] Stopping Constellation bridge...');
    this.isRunning = false;

    if (this.healthServer) {
      this.healthServer.stop();
      this.healthServer = null;
    }

    await this.enricher.close();

    console.log('[BRIDGE] Constellation bridge stopped');
  }

  getEnricher(): StatsEnricher {
    return this.enricher;
  }

  getApiClient(): ConstellationAPIClient {
    return this.apiClient;
  }

  getStatus() {
    return {
      running: this.isRunning,
      constellationUrl: this.config.constellation.url,
      cacheEnabled: this.config.cache.enabled,
      cacheStats: this.enricher.getCacheStats(),
    };
  }
}

// Main execution
async function main() {
  const config: BridgeConfig = {
    constellation: {
      url: process.env.CONSTELLATION_URL || 'https://constellation.microcosm.blue',
      timeout: parseInt(process.env.CONSTELLATION_TIMEOUT || '5000', 10),
      userAgent: process.env.USER_AGENT || 'AppView-Constellation-Bridge/1.0',
      maxRequestsPerSecond: parseInt(process.env.MAX_REQUESTS_PER_SECOND || '10', 10),
    },
    cache: {
      enabled: process.env.CACHE_ENABLED !== 'false',
      ttl: parseInt(process.env.CACHE_TTL || '60', 10),
      redisUrl: process.env.REDIS_URL,
    },
    health: {
      port: parseInt(process.env.HEALTH_PORT || '3003', 10),
    },
  };

  const bridge = new ConstellationBridge(config);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[BRIDGE] Received shutdown signal, shutting down gracefully...');
    await bridge.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('[BRIDGE] Uncaught exception:', error);
    bridge.stop().then(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[BRIDGE] Unhandled rejection at:', promise, 'reason:', reason);
  });

  // Start the bridge
  try {
    await bridge.start();

    // Keep process alive and log status periodically
    setInterval(() => {
      const status = bridge.getStatus();
      const cacheStats = status.cacheStats;
      console.log(
        `[BRIDGE] Status: ${status.running ? 'Running' : 'Stopped'} | ` +
        `Cache: ${cacheStats.hitRate} hit rate (${cacheStats.statsRequested} requests)`
      );
    }, 60000); // Every 60 seconds
  } catch (error) {
    console.error('[BRIDGE] Fatal error:', error);
    process.exit(1);
  }
}

// Export for programmatic use
export { ConstellationBridge, BridgeConfig };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
