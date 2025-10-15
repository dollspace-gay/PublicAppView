import Redis from 'ioredis';
import { InputAdapter, EventHandler, AdapterEvent } from './base-adapter';

export interface RedisAdapterConfig {
  redisUrl: string;
  streamKey?: string;
  consumerGroup?: string;
  consumerId?: string;
}

/**
 * Adapter that consumes events from Redis stream
 * Reuses existing Redis queue infrastructure from main app
 */
export class RedisAdapter implements InputAdapter {
  private redis: Redis | null = null;
  private config: RedisAdapterConfig;
  private streamKey: string;
  private consumerGroup: string;
  private consumerId: string;
  private isRunning = false;
  private consumeLoop: Promise<void> | null = null;

  constructor(config: RedisAdapterConfig) {
    this.config = config;
    this.streamKey = config.streamKey || 'firehose:events';
    this.consumerGroup = config.consumerGroup || 'osprey-consumers';
    this.consumerId = config.consumerId || `osprey-${Date.now()}`;
  }

  getName(): string {
    return 'RedisAdapter';
  }

  async start(eventHandler: EventHandler): Promise<void> {
    console.log(
      `[${this.getName()}] Connecting to Redis at ${this.config.redisUrl}...`
    );

    this.redis = new Redis(this.config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      // Enable auto-reconnect to master on READONLY errors
      enableOfflineQueue: true,
      // Ensure we connect to master, not replica
      role: 'master',
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.redis.on('connect', () => {
      console.log(`[${this.getName()}] Connected to Redis`);
    });

    this.redis.on('error', (error) => {
      // Handle READONLY errors specifically - indicates connection to replica instead of master
      if (error.message && error.message.includes('READONLY')) {
        console.error(
          `[${this.getName()}] READONLY error - connected to replica instead of master. Check REDIS_URL configuration.`
        );
      }
      console.error(`[${this.getName()}] Redis error:`, error);
    });

    // Ensure consumer group exists
    await this.ensureConsumerGroup();

    // Verify we're connected to master (not replica)
    await this.verifyMasterConnection();

    // Start consuming events
    this.isRunning = true;
    this.consumeLoop = this.runConsumeLoop(eventHandler);

    console.log(`[${this.getName()}] Started successfully`);
  }

  async stop(): Promise<void> {
    console.log(`[${this.getName()}] Stopping...`);

    this.isRunning = false;

    if (this.consumeLoop) {
      await this.consumeLoop;
      this.consumeLoop = null;
    }

    // Log pending message count before shutdown
    if (this.redis) {
      try {
        const pending = await this.redis.xpending(
          this.streamKey,
          this.consumerGroup
        );
        if (pending && pending[0] > 0) {
          console.warn(
            `[${this.getName()}] Shutting down with ${pending[0]} pending messages (will be retried on restart)`
          );
        }
      } catch (error) {
        console.error(
          `[${this.getName()}] Error checking pending messages:`,
          error
        );
      }

      await this.redis.quit();
      this.redis = null;
    }

    console.log(`[${this.getName()}] Stopped`);
  }

  private async verifyMasterConnection(): Promise<void> {
    if (!this.redis) return;

    try {
      // Check if we're connected to a master or replica
      const info = await this.redis.info('replication');

      if (info.includes('role:slave') || info.includes('role:replica')) {
        console.error(
          `[${this.getName()}] WARNING: Connected to Redis replica (read-only)!`
        );
        console.error(
          `[${this.getName()}] Write operations like XREADGROUP will fail.`
        );
        console.error(
          `[${this.getName()}] Please update REDIS_URL to point to the master Redis instance.`
        );
      } else if (info.includes('role:master')) {
        console.log(
          `[${this.getName()}] Verified connection to master (read-write)`
        );
      }
    } catch (error) {
      console.warn(`[${this.getName()}] Could not verify Redis role:`, error);
    }
  }

  private async ensureConsumerGroup(): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.xgroup(
        'CREATE',
        this.streamKey,
        this.consumerGroup,
        '0',
        'MKSTREAM'
      );
      console.log(
        `[${this.getName()}] Created consumer group: ${this.consumerGroup}`
      );
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message.includes('BUSYGROUP')) {
        console.log(
          `[${this.getName()}] Consumer group already exists: ${this.consumerGroup}`
        );
      } else {
        console.error(
          `[${this.getName()}] Error creating consumer group:`,
          error
        );
        throw error;
      }
    }
  }

  private async runConsumeLoop(eventHandler: EventHandler): Promise<void> {
    let errorCount = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;

    while (this.isRunning && this.redis) {
      try {
        const events = await this.consumeEvents(10);

        for (const event of events) {
          try {
            await eventHandler(event.event);

            // Only acknowledge after successful processing
            await this.redis!.xack(
              this.streamKey,
              this.consumerGroup,
              event.messageId
            );
            errorCount = 0; // Reset error counter on success
          } catch (error) {
            console.error(
              `[${this.getName()}] Error processing event (messageId: ${event.messageId}):`,
              error
            );
            errorCount++;

            // Don't acknowledge - leave message pending for retry
            // If we hit too many consecutive errors, back off to prevent tight loop
            if (errorCount >= MAX_CONSECUTIVE_ERRORS) {
              console.warn(
                `[${this.getName()}] ${MAX_CONSECUTIVE_ERRORS} consecutive errors, backing off for 5s`
              );
              await new Promise((resolve) => setTimeout(resolve, 5000));
              errorCount = 0; // Reset counter after backoff
            }

            // Break the loop to let pending messages be retried
            break;
          }
        }

        // Small delay if no events to prevent tight loop
        if (events.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`[${this.getName()}] Error in consume loop:`, error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private async consumeEvents(
    count: number
  ): Promise<Array<{ event: AdapterEvent; messageId: string }>> {
    if (!this.redis) {
      return [];
    }

    try {
      const results = (await this.redis.xreadgroup(
        'GROUP',
        this.consumerGroup,
        this.consumerId,
        'COUNT',
        count,
        'BLOCK',
        100,
        'STREAMS',
        this.streamKey,
        '>'
      )) as any;

      if (!results || results.length === 0) {
        return [];
      }

      const events: Array<{ event: AdapterEvent; messageId: string }> = [];

      for (const [_stream, messages] of results as any[]) {
        for (const [messageId, fields] of messages as any[]) {
          try {
            const type = fields[1] as 'commit' | 'identity' | 'account';
            const data = JSON.parse(fields[3]);
            const seq = fields[5] || undefined;

            const event: AdapterEvent = {
              type,
              did: data.repo || data.did,
              data,
              seq,
            };

            events.push({ event, messageId });
          } catch (error) {
            console.error(`[${this.getName()}] Error parsing message:`, error);
            // Acknowledge malformed messages
            await this.redis.xack(
              this.streamKey,
              this.consumerGroup,
              messageId
            );
          }
        }
      }

      return events;
    } catch (error: unknown) {
      const err = error as Error;
      // Handle READONLY errors specifically
      if (err.message && err.message.includes('READONLY')) {
        console.error(
          `[${this.getName()}] READONLY error - Redis is configured as a read-only replica. XREADGROUP requires write access. Please connect to the master Redis instance.`
        );
      } else {
        console.error(`[${this.getName()}] Error consuming events:`, error);
      }
      return [];
    }
  }
}
