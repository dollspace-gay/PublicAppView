import Redis from 'ioredis';

export interface FirehoseEvent {
  type: 'commit' | 'identity' | 'account';
  data: any;
  seq?: string;
}

class RedisQueue {
  private redis: Redis | null = null;
  private readonly STREAM_KEY = 'firehose:events';
  private readonly CONSUMER_GROUP = 'firehose-processors';
  private readonly DEAD_LETTER_STREAM_KEY = 'firehose:dead-letters';
  private readonly METRICS_KEY = 'cluster:metrics';
  private isInitialized = false;

  // Buffered metrics for periodic flush
  private metricsBuffer = {
    totalEvents: 0,
    '#commit': 0,
    '#identity': 0,
    '#account': 0,
    errors: 0,
  };
  private flushInterval: NodeJS.Timeout | null = null;

  async connect() {
    if (this.redis) {
      return;
    }

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    console.log(`[REDIS] Connecting to ${redisUrl}...`);

    this.redis = new Redis(redisUrl, {
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
      console.log('[REDIS] Connected');
    });

    this.redis.on('error', (error: any) => {
      // Handle READONLY errors specifically - indicates connection to replica instead of master
      if (error.message && error.message.includes('READONLY')) {
        console.error(
          '[REDIS] READONLY error - connected to replica instead of master. Check REDIS_URL configuration.'
        );
        console.error(
          '[REDIS] XREADGROUP and other write commands require connection to Redis master.'
        );
      }
      console.error('[REDIS] Error:', error);
    });

    await this.ensureStreamAndGroup();

    // Verify we're connected to master (not replica)
    await this.verifyMasterConnection();

    this.isInitialized = true;

    // Start periodic metrics flush (every 500ms)
    this.startMetricsFlush();
  }

  private startMetricsFlush() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    this.flushInterval = setInterval(async () => {
      await this.flushMetrics();
    }, 500);
  }

  private async flushMetrics() {
    if (!this.redis || !this.isInitialized) return;

    // Only flush if there are buffered increments
    const hasUpdates = Object.values(this.metricsBuffer).some((v) => v > 0);
    if (!hasUpdates) return;

    try {
      const pipeline = this.redis.pipeline();

      // Increment cluster-wide counters atomically
      if (this.metricsBuffer.totalEvents > 0) {
        pipeline.hincrby(
          this.METRICS_KEY,
          'totalEvents',
          this.metricsBuffer.totalEvents
        );
      }
      if (this.metricsBuffer['#commit'] > 0) {
        pipeline.hincrby(
          this.METRICS_KEY,
          '#commit',
          this.metricsBuffer['#commit']
        );
      }
      if (this.metricsBuffer['#identity'] > 0) {
        pipeline.hincrby(
          this.METRICS_KEY,
          '#identity',
          this.metricsBuffer['#identity']
        );
      }
      if (this.metricsBuffer['#account'] > 0) {
        pipeline.hincrby(
          this.METRICS_KEY,
          '#account',
          this.metricsBuffer['#account']
        );
      }
      if (this.metricsBuffer.errors > 0) {
        pipeline.hincrby(this.METRICS_KEY, 'errors', this.metricsBuffer.errors);
      }

      await pipeline.exec();

      // Reset buffer after successful flush
      this.metricsBuffer = {
        totalEvents: 0,
        '#commit': 0,
        '#identity': 0,
        '#account': 0,
        errors: 0,
      };
    } catch (error) {
      console.error('[REDIS] Error flushing metrics:', error);
    }
  }

  private async verifyMasterConnection(): Promise<void> {
    if (!this.redis) return;

    try {
      // Check if we're connected to a master or replica
      const info = await this.redis.info('replication');

      if (info.includes('role:slave') || info.includes('role:replica')) {
        console.error(
          '[REDIS] WARNING: Connected to Redis replica (read-only)!'
        );
        console.error('[REDIS] Write operations like XREADGROUP will fail.');
        console.error(
          '[REDIS] Please update REDIS_URL to point to the master Redis instance.'
        );
      } else if (info.includes('role:master')) {
        console.log('[REDIS] Verified connection to master (read-write)');
      }
    } catch (error) {
      console.warn('[REDIS] Could not verify Redis role:', error);
    }
  }

  private async ensureStreamAndGroup() {
    if (!this.redis) return;

    try {
      // Create consumer group if it doesn't exist
      // Use MKSTREAM to create the stream if it doesn't exist
      await this.redis.xgroup(
        'CREATE',
        this.STREAM_KEY,
        this.CONSUMER_GROUP,
        '0',
        'MKSTREAM'
      );
      console.log(`[REDIS] Created consumer group: ${this.CONSUMER_GROUP}`);
    } catch (error: any) {
      // BUSYGROUP error means group already exists, which is fine
      if (!error.message.includes('BUSYGROUP')) {
        console.error('[REDIS] Error creating consumer group:', error);
      }
    }
  }

  async push(event: FirehoseEvent): Promise<void> {
    if (!this.redis || !this.isInitialized) {
      throw new Error('Redis not connected');
    }

    try {
      // Use XADD to append to stream with maxlen to prevent infinite growth
      // INCREASED: Keep last 500k events in stream (up from 100k) to provide larger buffer
      // This prevents data loss if workers temporarily fall behind during high load
      // Approximate trimming (~) is more efficient than exact trimming
      await this.redis.xadd(
        this.STREAM_KEY,
        'MAXLEN',
        '~',
        '500000',
        '*',
        'type',
        event.type,
        'data',
        JSON.stringify(event.data),
        'seq',
        event.seq || ''
      );
    } catch (error) {
      console.error('[REDIS] Error pushing event:', error);
      throw error;
    }
  }

  async consume(
    consumerId: string,
    count: number = 10
  ): Promise<Array<FirehoseEvent & { messageId: string }>> {
    if (!this.redis || !this.isInitialized) {
      throw new Error('Redis not connected');
    }

    try {
      // XREADGROUP to consume events as a consumer group member
      // Block for 1 second if no messages available
      const results = await this.redis.xreadgroup(
        'GROUP',
        this.CONSUMER_GROUP,
        consumerId,
        'COUNT',
        count,
        'BLOCK',
        100, // 100ms block timeout for low latency
        'STREAMS',
        this.STREAM_KEY,
        '>'
      );

      if (!results || results.length === 0) {
        return [];
      }

      const events: Array<FirehoseEvent & { messageId: string }> = [];
      for (const [_stream, messages] of results as any[]) {
        for (const [messageId, fields] of messages as any[]) {
          try {
            const type = fields[1] as 'commit' | 'identity' | 'account';
            const data = JSON.parse(fields[3]);
            const seq = fields[5] || undefined;

            // Return event with messageId so caller can acknowledge after processing
            events.push({ type, data, seq, messageId });
          } catch (error) {
            console.error('[REDIS] Error parsing message:', error);
            // Acknowledge malformed messages to prevent retry loop
            await this.redis.xack(
              this.STREAM_KEY,
              this.CONSUMER_GROUP,
              messageId
            );
          }
        }
      }

      return events;
    } catch (error: any) {
      const errorMsg = error.message || error.toString() || '';

      // Handle READONLY error - connected to replica instead of master
      if (errorMsg.includes('READONLY')) {
        console.error(
          '[REDIS] READONLY error - Redis is configured as a read-only replica.'
        );
        console.error(
          '[REDIS] XREADGROUP requires write access. Please connect to the master Redis instance.'
        );
        console.error(
          '[REDIS] Check that REDIS_URL points to master, not a replica.'
        );
        return [];
      }

      // Handle NOGROUP error - stream or consumer group was deleted (Redis restart, memory eviction, etc.)
      const isNogroupError =
        errorMsg.includes('NOGROUP') || errorMsg.includes('No such key');

      if (isNogroupError) {
        console.warn(
          `[REDIS] Stream/group missing (${errorMsg}), recreating...`
        );
        try {
          // Use Redis SET NX as a distributed lock to prevent multiple workers from recreating simultaneously
          const lockKey = 'firehose:stream:recreate-lock';
          const lockAcquired = await this.redis.set(
            lockKey,
            '1',
            'EX',
            5,
            'NX'
          );

          if (lockAcquired) {
            // We got the lock, recreate the stream/group
            await this.ensureStreamAndGroup();
            console.log(
              `[REDIS] Successfully recreated stream and consumer group`
            );
          } else {
            // Another worker is already recreating, wait a bit
            console.log(
              `[REDIS] Another worker is recreating stream/group, waiting...`
            );
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } catch (retryError) {
          console.error('[REDIS] Failed to recreate stream/group:', retryError);
        }
      } else {
        console.error('[REDIS] Error consuming events:', error);
      }
      return [];
    }
  }

  // Acknowledge a processed message (call AFTER successful processing)
  async ack(messageId: string): Promise<void> {
    if (!this.redis || !this.isInitialized) {
      return;
    }

    try {
      await this.redis.xack(this.STREAM_KEY, this.CONSUMER_GROUP, messageId);
    } catch (error) {
      console.error('[REDIS] Error acknowledging message:', error);
    }
  }

  // Claim pending messages from dead/slow consumers (for recovery)
  async claimPendingMessages(
    consumerId: string,
    idleTimeMs: number = 30000
  ): Promise<Array<FirehoseEvent & { messageId: string }>> {
    if (!this.redis || !this.isInitialized) {
      return [];
    }

    try {
      // Get up to 100 pending messages; we'll filter by idle/attempts
      const pending = await this.redis.xpending(
        this.STREAM_KEY,
        this.CONSUMER_GROUP,
        '-',
        '+',
        100
      );

      if (!pending || pending.length === 0) {
        return [];
      }

      const events: Array<FirehoseEvent & { messageId: string }> = [];

      const maxDeliveries = parseInt(
        process.env.REDIS_MAX_DELIVERIES || '10',
        10
      );
      const deadLetterMaxLen = parseInt(
        process.env.REDIS_DEAD_LETTER_MAXLEN || '10000',
        10
      );

      for (const entry of pending as any[]) {
        const messageId = entry[0];
        const idleMs = entry[2];
        const deliveries = entry[3];

        if (idleMs <= idleTimeMs) {
          continue;
        }

        // If a message has exceeded max delivery attempts, move it to a dead-letter stream and ack it
        if (typeof deliveries === 'number' && deliveries >= maxDeliveries) {
          try {
            const claimed = await this.redis.xclaim(
              this.STREAM_KEY,
              this.CONSUMER_GROUP,
              consumerId,
              idleTimeMs,
              messageId
            );

            if (claimed && claimed.length > 0) {
              const [claimedId, fields] = claimed[0] as any[];
              try {
                const type = fields[1] as 'commit' | 'identity' | 'account';
                const data = JSON.parse(fields[3]);
                const seq = fields[5] || undefined;

                // Write to dead-letter stream (bounded length)
                await this.redis.xadd(
                  this.DEAD_LETTER_STREAM_KEY,
                  'MAXLEN',
                  '~',
                  String(deadLetterMaxLen),
                  '*',
                  'type',
                  type,
                  'data',
                  JSON.stringify(data),
                  'seq',
                  seq || '',
                  'origId',
                  claimedId,
                  'deliveries',
                  String(deliveries)
                );

                // Ack to remove from pending
                await this.redis.xack(
                  this.STREAM_KEY,
                  this.CONSUMER_GROUP,
                  claimedId
                );
                console.warn(
                  `[REDIS] Moved poison message to dead-letter after ${deliveries} deliveries: ${claimedId}`
                );
              } catch (parseErr) {
                console.error(
                  '[REDIS] Error handling dead-letter message:',
                  parseErr
                );
                await this.redis.xack(
                  this.STREAM_KEY,
                  this.CONSUMER_GROUP,
                  claimedId
                );
              }
            }
          } catch (claimErr) {
            console.error('[REDIS] Error claiming poison message:', claimErr);
          }
          continue;
        }

        // Otherwise, claim and reprocess
        try {
          const claimed = await this.redis.xclaim(
            this.STREAM_KEY,
            this.CONSUMER_GROUP,
            consumerId,
            idleTimeMs,
            messageId
          );

          if (claimed && claimed.length > 0) {
            for (const [claimedId, fields] of claimed as any[]) {
              try {
                const type = fields[1] as 'commit' | 'identity' | 'account';
                const data = JSON.parse(fields[3]);
                const seq = fields[5] || undefined;
                events.push({ type, data, seq, messageId: claimedId });
              } catch (error) {
                console.error('[REDIS] Error parsing claimed message:', error);
                await this.redis.xack(
                  this.STREAM_KEY,
                  this.CONSUMER_GROUP,
                  claimedId
                );
              }
            }
          }
        } catch (err) {
          console.error('[REDIS] Error claiming pending messages:', err);
        }
      }

      return events;
    } catch (error: any) {
      // Handle NOGROUP error gracefully
      const errorMsg = error.message || error.toString() || '';
      const isNogroupError =
        errorMsg.includes('NOGROUP') || errorMsg.includes('No such key');

      if (isNogroupError) {
        console.warn(
          `[REDIS] Stream/group missing during claim, will be recreated by consume loop`
        );
      } else {
        console.error('[REDIS] Error claiming pending messages:', error);
      }
      return [];
    }
  }

  // Queue depth = total pending (unacked) messages for the consumer group
  async getQueueDepth(): Promise<number> {
    if (!this.redis || !this.isInitialized) {
      return 0;
    }

    try {
      const summary = await this.redis.xpending(
        this.STREAM_KEY,
        this.CONSUMER_GROUP
      );
      // summary = [ pending, smallestId, greatestId, [ [consumer, count], ... ] ]
      if (Array.isArray(summary) && summary.length > 0) {
        const pendingTotal = Number(summary[0] || 0);
        return isNaN(pendingTotal) ? 0 : pendingTotal;
      }
      return 0;
    } catch (error) {
      return 0;
    }
  }

  // Current stream length (bounded by XADD MAXLEN)
  async getStreamLength(): Promise<number> {
    if (!this.redis || !this.isInitialized) {
      return 0;
    }
    try {
      return await this.redis.xlen(this.STREAM_KEY);
    } catch (error) {
      return 0;
    }
  }

  async getDeadLetterLength(): Promise<number> {
    if (!this.redis || !this.isInitialized) {
      return 0;
    }
    try {
      return await this.redis.xlen(this.DEAD_LETTER_STREAM_KEY);
    } catch (error) {
      return 0;
    }
  }

  async getDeadLetters(
    count: number = 100
  ): Promise<Array<Record<string, any>>> {
    if (!this.redis || !this.isInitialized) {
      return [];
    }
    try {
      const items = await this.redis.xrevrange(
        this.DEAD_LETTER_STREAM_KEY,
        '+',
        '-',
        'COUNT',
        count
      );
      return (items as any[]).map((entry: any[]) => {
        const [id, fields] = entry;
        const obj: Record<string, any> = { id };
        for (let i = 0; i < fields.length; i += 2) {
          obj[fields[i]] = fields[i + 1];
        }
        return obj;
      });
    } catch (error) {
      return [];
    }
  }

  // Store firehose status for cluster-wide visibility
  async setFirehoseStatus(status: {
    connected: boolean;
    url: string;
    currentCursor: string | null;
  }): Promise<void> {
    if (!this.redis || !this.isInitialized) {
      return;
    }

    try {
      await this.redis.setex(
        'firehose:status',
        10, // Expire after 10 seconds (will be refreshed by worker 0)
        JSON.stringify(status)
      );
    } catch (error) {
      console.error('[REDIS] Error setting firehose status:', error);
    }
  }

  async getFirehoseStatus(): Promise<{
    connected: boolean;
    url: string;
    currentCursor: string | null;
  } | null> {
    if (!this.redis || !this.isInitialized) {
      return null;
    }

    try {
      const data = await this.redis.get('firehose:status');
      if (data) {
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      console.error('[REDIS] Error getting firehose status:', error);
      return null;
    }
  }

  // Store recent events for dashboard visibility across all workers
  async setRecentEvents(events: any[]): Promise<void> {
    if (!this.redis || !this.isInitialized) {
      return;
    }

    try {
      await this.redis.setex(
        'firehose:recent_events',
        10, // Expire after 10 seconds (will be refreshed by worker 0)
        JSON.stringify(events)
      );
    } catch (error) {
      console.error('[REDIS] Error setting recent events:', error);
    }
  }

  async getRecentEvents(): Promise<any[]> {
    if (!this.redis || !this.isInitialized) {
      return [];
    }

    try {
      const data = await this.redis.get('firehose:recent_events');
      if (data) {
        return JSON.parse(data);
      }
      return [];
    } catch (error) {
      console.error('[REDIS] Error getting recent events:', error);
      return [];
    }
  }

  // Cluster-wide metrics methods
  incrementClusterMetric(type: '#commit' | '#identity' | '#account') {
    // Buffer locally for periodic flush
    this.metricsBuffer[type]++;
    this.metricsBuffer.totalEvents++;
  }

  incrementClusterError() {
    this.metricsBuffer.errors++;
  }

  async getClusterMetrics(): Promise<{
    totalEvents: number;
    eventCounts: { '#commit': number; '#identity': number; '#account': number };
    errors: number;
  }> {
    if (!this.redis || !this.isInitialized) {
      return {
        totalEvents: 0,
        eventCounts: { '#commit': 0, '#identity': 0, '#account': 0 },
        errors: 0,
      };
    }

    try {
      const metrics = await this.redis.hgetall(this.METRICS_KEY);

      return {
        totalEvents: parseInt(metrics.totalEvents || '0'),
        eventCounts: {
          '#commit': parseInt(metrics['#commit'] || '0'),
          '#identity': parseInt(metrics['#identity'] || '0'),
          '#account': parseInt(metrics['#account'] || '0'),
        },
        errors: parseInt(metrics.errors || '0'),
      };
    } catch (error) {
      console.error('[REDIS] Error getting cluster metrics:', error);
      return {
        totalEvents: 0,
        eventCounts: { '#commit': 0, '#identity': 0, '#account': 0 },
        errors: 0,
      };
    }
  }

  // Redis pub/sub for broadcasting events to all workers
  private subscriber: Redis | null = null;
  private eventCallbacks: Array<(event: any) => void> = [];

  async initializePubSub() {
    if (this.subscriber) {
      return;
    }

    // Create separate Redis client for pub/sub
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.subscriber = new Redis(redisUrl, {
      // Ensure we connect to master, not replica
      role: 'master',
      enableReadyCheck: true,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.subscriber.on('message', (_channel: string, message: string) => {
      try {
        const event = JSON.parse(message);
        // Broadcast to all registered callbacks
        this.eventCallbacks.forEach((callback) => callback(event));
      } catch (error) {
        console.error('[REDIS] Error parsing pub/sub message:', error);
      }
    });

    await this.subscriber.subscribe('firehose:events:broadcast');
    console.log('[REDIS] Subscribed to event broadcasts');
  }

  async publishEvent(event: any) {
    if (!this.redis || !this.isInitialized) {
      return;
    }

    try {
      await this.redis.publish(
        'firehose:events:broadcast',
        JSON.stringify(event)
      );
    } catch (error) {
      console.error('[REDIS] Error publishing event:', error);
    }
  }

  onEventBroadcast(callback: (event: any) => void) {
    this.eventCallbacks.push(callback);
  }

  offEventBroadcast(callback: (event: any) => void) {
    this.eventCallbacks = this.eventCallbacks.filter((cb) => cb !== callback);
  }

  // Database record counters (faster than COUNT queries)
  async incrementRecordCount(table: string, delta: number = 1) {
    if (!this.redis || !this.isInitialized) {
      return;
    }

    try {
      await this.redis.hincrby('db:record_counts', table, delta);
    } catch (error) {
      console.error('[REDIS] Error incrementing record count:', error);
    }
  }

  async setRecordCount(table: string, value: number) {
    if (!this.redis || !this.isInitialized) {
      return;
    }

    try {
      await this.redis.hset('db:record_counts', table, value.toString());
    } catch (error) {
      console.error('[REDIS] Error setting record count:', error);
    }
  }

  async getRecordCounts(): Promise<Record<string, number>> {
    if (!this.redis || !this.isInitialized) {
      return {};
    }

    try {
      const counts = await this.redis.hgetall('db:record_counts');
      const result: Record<string, number> = {};
      for (const [key, value] of Object.entries(counts)) {
        result[key] = parseInt(value) || 0;
      }
      return result;
    } catch (error) {
      console.error('[REDIS] Error getting record counts:', error);
      return {};
    }
  }

  async disconnect() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }

    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      this.isInitialized = false;
    }
  }
}

export const redisQueue = new RedisQueue();
