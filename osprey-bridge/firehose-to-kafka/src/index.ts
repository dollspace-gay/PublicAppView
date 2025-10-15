import { KafkaProducerClient } from './kafka-producer';
import { EventEnricher } from './event-enricher';
import {
  InputAdapter,
  AdapterEvent,
  FirehoseAdapter,
  RedisAdapter,
  DirectAdapter,
} from './adapters';
import { HealthCheckServer } from './health';
import dotenv from 'dotenv';

dotenv.config();

interface BridgeConfig {
  adapter: {
    type: 'firehose' | 'redis' | 'direct';
    firehose?: {
      url: string;
      cursorFile?: string;
    };
    redis?: {
      redisUrl: string;
      streamKey?: string;
      consumerGroup?: string;
      consumerId?: string;
    };
  };
  kafka: {
    brokers: string[];
    clientId: string;
    topic: string;
  };
  enrichment: {
    databaseUrl?: string;
    enrichWithProfiles: boolean;
    enrichWithHandles: boolean;
  };
}

class FirehoseKafkaBridge {
  private config: BridgeConfig;
  private kafka: KafkaProducerClient;
  private enricher: EventEnricher;
  private adapter: InputAdapter | null = null;
  private healthServer: HealthCheckServer | null = null;
  private eventCount = 0;
  private isRunning = false;

  constructor(config: BridgeConfig) {
    this.config = config;
    this.kafka = new KafkaProducerClient(config.kafka);
    this.enricher = new EventEnricher(config.enrichment.databaseUrl, {
      enrichWithProfiles: config.enrichment.enrichWithProfiles,
      enrichWithHandles: config.enrichment.enrichWithHandles,
    });
  }

  private createAdapter(): InputAdapter {
    const adapterType = this.config.adapter.type;

    switch (adapterType) {
      case 'firehose':
        if (!this.config.adapter.firehose) {
          throw new Error('Firehose adapter configuration missing');
        }
        return new FirehoseAdapter({
          url: this.config.adapter.firehose.url,
          cursorFile: this.config.adapter.firehose.cursorFile,
        });

      case 'redis':
        if (!this.config.adapter.redis) {
          throw new Error('Redis adapter configuration missing');
        }
        return new RedisAdapter({
          redisUrl: this.config.adapter.redis.redisUrl,
          streamKey: this.config.adapter.redis.streamKey,
          consumerGroup: this.config.adapter.redis.consumerGroup,
          consumerId: this.config.adapter.redis.consumerId,
        });

      case 'direct':
        return new DirectAdapter();

      default:
        throw new Error(`Unknown adapter type: ${adapterType}`);
    }
  }

  private async handleEvent(event: AdapterEvent): Promise<void> {
    try {
      // Enrich event with metadata
      const enrichedEvent = await this.enricher.enrich({
        type: event.type,
        data: event.data,
        seq: event.seq,
      });

      // Publish to Kafka
      await this.kafka.publishEvent(enrichedEvent);

      this.eventCount++;
      if (this.eventCount % 100 === 0) {
        console.log(
          `[BRIDGE] Processed ${this.eventCount} events (adapter: ${this.config.adapter.type})`
        );
      }
    } catch (error) {
      console.error('[BRIDGE] Error processing event:', error);
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[BRIDGE] Already running');
      return;
    }

    console.log(
      `[BRIDGE] Starting bridge with ${this.config.adapter.type} adapter...`
    );

    // Connect to Kafka
    await this.kafka.connect();

    // Create and start adapter
    this.adapter = this.createAdapter();
    await this.adapter.start((event) => this.handleEvent(event));

    // Start health check server
    const healthPort = parseInt(process.env.HEALTH_PORT || '3001', 10);
    this.healthServer = new HealthCheckServer(healthPort, () =>
      this.getStatus()
    );
    this.healthServer.start();

    this.isRunning = true;
    console.log('[BRIDGE] Bridge started successfully');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('[BRIDGE] Stopping bridge...');
    this.isRunning = false;

    if (this.healthServer) {
      this.healthServer.stop();
      this.healthServer = null;
    }

    if (this.adapter) {
      await this.adapter.stop();
      this.adapter = null;
    }

    await this.kafka.disconnect();
    await this.enricher.close();

    console.log('[BRIDGE] Bridge stopped');
  }

  getAdapter(): InputAdapter | null {
    return this.adapter;
  }

  getStatus() {
    return {
      running: this.isRunning,
      adapterType: this.config.adapter.type,
      eventsProcessed: this.eventCount,
      kafka: this.kafka.getStatus(),
    };
  }
}

// Main execution
async function main() {
  const adapterType = (process.env.ADAPTER_TYPE || 'firehose') as
    | 'firehose'
    | 'redis'
    | 'direct';

  const config: BridgeConfig = {
    adapter: {
      type: adapterType,
      firehose: {
        url: process.env.RELAY_URL || 'wss://bsky.network',
        cursorFile:
          process.env.FIREHOSE_CURSOR_FILE || '/data/osprey-cursor.txt',
      },
      redis: {
        redisUrl: process.env.REDIS_URL || 'redis://redis:6379',
        streamKey: process.env.REDIS_STREAM_KEY || 'firehose:events',
        consumerGroup: process.env.REDIS_CONSUMER_GROUP || 'osprey-consumers',
        consumerId: process.env.REDIS_CONSUMER_ID || `osprey-${Date.now()}`,
      },
    },
    kafka: {
      brokers: (process.env.KAFKA_BROKERS || 'kafka:9092').split(','),
      clientId: process.env.KAFKA_CLIENT_ID || 'firehose-bridge',
      topic: process.env.KAFKA_TOPIC || 'atproto.firehose.enriched',
    },
    enrichment: {
      databaseUrl: process.env.DATABASE_URL,
      enrichWithProfiles: process.env.ENRICH_WITH_PROFILES !== 'false',
      enrichWithHandles: process.env.ENRICH_WITH_HANDLES !== 'false',
    },
  };

  const bridge = new FirehoseKafkaBridge(config);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[BRIDGE] Received SIGINT, shutting down gracefully...');
    await bridge.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[BRIDGE] Received SIGTERM, shutting down gracefully...');
    await bridge.stop();
    process.exit(0);
  });

  // Start the bridge
  try {
    await bridge.start();

    // Keep the process alive and log status periodically
    setInterval(() => {
      const status = bridge.getStatus();
      console.log(
        `[BRIDGE] Status: ${status.running ? 'Running' : 'Stopped'}, Adapter: ${status.adapterType}, Events: ${status.eventsProcessed}`
      );
    }, 30000); // Every 30 seconds
  } catch (error) {
    console.error('[BRIDGE] Fatal error:', error);
    process.exit(1);
  }
}

// Export for programmatic use
export { FirehoseKafkaBridge, BridgeConfig };

// Run if executed directly
if (require.main === module) {
  main();
}
