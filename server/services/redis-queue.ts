import Redis from "ioredis";

export interface FirehoseEvent {
  type: "commit" | "identity" | "account";
  data: any;
  seq?: string;
}

class RedisQueue {
  private redis: Redis | null = null;
  private readonly STREAM_KEY = "firehose:events";
  private readonly CONSUMER_GROUP = "firehose-processors";
  private readonly METRICS_KEY = "cluster:metrics";
  private isInitialized = false;
  
  // Buffered metrics for periodic flush
  private metricsBuffer = {
    totalEvents: 0,
    "#commit": 0,
    "#identity": 0,
    "#account": 0,
    errors: 0,
  };
  private flushInterval: NodeJS.Timeout | null = null;

  async connect() {
    if (this.redis) {
      return;
    }

    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    console.log(`[REDIS] Connecting to ${redisUrl}...`);

    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.redis.on("connect", () => {
      console.log("[REDIS] Connected");
    });

    this.redis.on("error", (error) => {
      console.error("[REDIS] Error:", error);
    });

    await this.ensureStreamAndGroup();
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
    const hasUpdates = Object.values(this.metricsBuffer).some(v => v > 0);
    if (!hasUpdates) return;
    
    try {
      const pipeline = this.redis.pipeline();
      
      // Increment cluster-wide counters atomically
      if (this.metricsBuffer.totalEvents > 0) {
        pipeline.hincrby(this.METRICS_KEY, "totalEvents", this.metricsBuffer.totalEvents);
      }
      if (this.metricsBuffer["#commit"] > 0) {
        pipeline.hincrby(this.METRICS_KEY, "#commit", this.metricsBuffer["#commit"]);
      }
      if (this.metricsBuffer["#identity"] > 0) {
        pipeline.hincrby(this.METRICS_KEY, "#identity", this.metricsBuffer["#identity"]);
      }
      if (this.metricsBuffer["#account"] > 0) {
        pipeline.hincrby(this.METRICS_KEY, "#account", this.metricsBuffer["#account"]);
      }
      if (this.metricsBuffer.errors > 0) {
        pipeline.hincrby(this.METRICS_KEY, "errors", this.metricsBuffer.errors);
      }
      
      await pipeline.exec();
      
      // Reset buffer after successful flush
      this.metricsBuffer = {
        totalEvents: 0,
        "#commit": 0,
        "#identity": 0,
        "#account": 0,
        errors: 0,
      };
    } catch (error) {
      console.error("[REDIS] Error flushing metrics:", error);
    }
  }

  private async ensureStreamAndGroup() {
    if (!this.redis) return;

    try {
      // Create consumer group if it doesn't exist
      // Use MKSTREAM to create the stream if it doesn't exist
      await this.redis.xgroup(
        "CREATE",
        this.STREAM_KEY,
        this.CONSUMER_GROUP,
        "0",
        "MKSTREAM"
      );
      console.log(`[REDIS] Created consumer group: ${this.CONSUMER_GROUP}`);
    } catch (error: any) {
      // BUSYGROUP error means group already exists, which is fine
      if (!error.message.includes("BUSYGROUP")) {
        console.error("[REDIS] Error creating consumer group:", error);
      }
    }
  }

  async push(event: FirehoseEvent): Promise<void> {
    if (!this.redis || !this.isInitialized) {
      throw new Error("Redis not connected");
    }

    try {
      // Use XADD to append to stream with maxlen to prevent infinite growth
      // Keep last 100k events in stream (auto-trim older ones)
      await this.redis.xadd(
        this.STREAM_KEY,
        "MAXLEN",
        "~",
        "100000",
        "*",
        "type",
        event.type,
        "data",
        JSON.stringify(event.data),
        "seq",
        event.seq || ""
      );
    } catch (error) {
      console.error("[REDIS] Error pushing event:", error);
      throw error;
    }
  }

  async consume(
    consumerId: string,
    count: number = 10
  ): Promise<Array<FirehoseEvent & { messageId: string }>> {
    if (!this.redis || !this.isInitialized) {
      throw new Error("Redis not connected");
    }

    try {
      // XREADGROUP to consume events as a consumer group member
      // Block for 1 second if no messages available
      const results = await this.redis.xreadgroup(
        "GROUP",
        this.CONSUMER_GROUP,
        consumerId,
        "COUNT",
        count,
        "BLOCK",
        100, // 100ms block timeout for low latency
        "STREAMS",
        this.STREAM_KEY,
        ">"
      );

      if (!results || results.length === 0) {
        return [];
      }

      const events: Array<FirehoseEvent & { messageId: string }> = [];
      for (const [_stream, messages] of results as any[]) {
        for (const [messageId, fields] of messages as any[]) {
          try {
            const type = fields[1] as "commit" | "identity" | "account";
            const data = JSON.parse(fields[3]);
            const seq = fields[5] || undefined;

            // Return event with messageId so caller can acknowledge after processing
            events.push({ type, data, seq, messageId });
          } catch (error) {
            console.error("[REDIS] Error parsing message:", error);
            // Acknowledge malformed messages to prevent retry loop
            await this.redis.xack(this.STREAM_KEY, this.CONSUMER_GROUP, messageId);
          }
        }
      }

      return events;
    } catch (error: any) {
      // Handle NOGROUP error - stream or consumer group was deleted (Redis restart, memory eviction, etc.)
      const errorMsg = error.message || error.toString() || '';
      const isNogroupError = errorMsg.includes('NOGROUP') || errorMsg.includes('No such key');
      
      if (isNogroupError) {
        console.warn(`[REDIS] Stream/group missing (${errorMsg}), recreating...`);
        try {
          // Use Redis SET NX as a distributed lock to prevent multiple workers from recreating simultaneously
          const lockKey = 'firehose:stream:recreate-lock';
          const lockAcquired = await this.redis.set(lockKey, '1', 'EX', 5, 'NX');
          
          if (lockAcquired) {
            // We got the lock, recreate the stream/group
            await this.ensureStreamAndGroup();
            console.log(`[REDIS] Successfully recreated stream and consumer group`);
          } else {
            // Another worker is already recreating, wait a bit
            console.log(`[REDIS] Another worker is recreating stream/group, waiting...`);
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (retryError) {
          console.error('[REDIS] Failed to recreate stream/group:', retryError);
        }
      } else {
        console.error("[REDIS] Error consuming events:", error);
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
      console.error("[REDIS] Error acknowledging message:", error);
    }
  }

  // Claim pending messages from dead/slow consumers (for recovery)
  async claimPendingMessages(consumerId: string, idleTimeMs: number = 30000): Promise<Array<FirehoseEvent & { messageId: string }>> {
    if (!this.redis || !this.isInitialized) {
      return [];
    }

    try {
      // Get pending messages that have been idle for more than idleTimeMs
      const pending = await this.redis.xpending(
        this.STREAM_KEY,
        this.CONSUMER_GROUP,
        "-",
        "+",
        10
      );

      if (!pending || pending.length === 0) {
        return [];
      }

      const events: Array<FirehoseEvent & { messageId: string }> = [];
      
      for (const [messageId, _consumer, idleMs] of pending as any[]) {
        if (idleMs > idleTimeMs) {
          // Claim this message from the dead consumer
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
                const type = fields[1] as "commit" | "identity" | "account";
                const data = JSON.parse(fields[3]);
                const seq = fields[5] || undefined;
                events.push({ type, data, seq, messageId: claimedId });
              } catch (error) {
                console.error("[REDIS] Error parsing claimed message:", error);
                await this.redis.xack(this.STREAM_KEY, this.CONSUMER_GROUP, claimedId);
              }
            }
          }
        }
      }

      return events;
    } catch (error: any) {
      // Handle NOGROUP error gracefully
      const errorMsg = error.message || error.toString() || '';
      const isNogroupError = errorMsg.includes('NOGROUP') || errorMsg.includes('No such key');
      
      if (isNogroupError) {
        console.warn(`[REDIS] Stream/group missing during claim, will be recreated by consume loop`);
      } else {
        console.error("[REDIS] Error claiming pending messages:", error);
      }
      return [];
    }
  }

  async getQueueDepth(): Promise<number> {
    if (!this.redis || !this.isInitialized) {
      return 0;
    }

    try {
      const length = await this.redis.xlen(this.STREAM_KEY);
      return length;
    } catch (error) {
      return 0;
    }
  }

  // Store firehose status for cluster-wide visibility
  async setFirehoseStatus(status: { connected: boolean; url: string; currentCursor: string | null }): Promise<void> {
    if (!this.redis || !this.isInitialized) {
      return;
    }

    try {
      await this.redis.setex(
        "firehose:status",
        10, // Expire after 10 seconds (will be refreshed by worker 0)
        JSON.stringify(status)
      );
    } catch (error) {
      console.error("[REDIS] Error setting firehose status:", error);
    }
  }

  async getFirehoseStatus(): Promise<{ connected: boolean; url: string; currentCursor: string | null } | null> {
    if (!this.redis || !this.isInitialized) {
      return null;
    }

    try {
      const data = await this.redis.get("firehose:status");
      if (data) {
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      console.error("[REDIS] Error getting firehose status:", error);
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
        "firehose:recent_events",
        10, // Expire after 10 seconds (will be refreshed by worker 0)
        JSON.stringify(events)
      );
    } catch (error) {
      console.error("[REDIS] Error setting recent events:", error);
    }
  }

  async getRecentEvents(): Promise<any[]> {
    if (!this.redis || !this.isInitialized) {
      return [];
    }

    try {
      const data = await this.redis.get("firehose:recent_events");
      if (data) {
        return JSON.parse(data);
      }
      return [];
    } catch (error) {
      console.error("[REDIS] Error getting recent events:", error);
      return [];
    }
  }

  // Cluster-wide metrics methods
  incrementClusterMetric(type: "#commit" | "#identity" | "#account") {
    // Buffer locally for periodic flush
    this.metricsBuffer[type]++;
    this.metricsBuffer.totalEvents++;
  }
  
  incrementClusterError() {
    this.metricsBuffer.errors++;
  }
  
  async getClusterMetrics(): Promise<{
    totalEvents: number;
    eventCounts: { "#commit": number; "#identity": number; "#account": number };
    errors: number;
  }> {
    if (!this.redis || !this.isInitialized) {
      return {
        totalEvents: 0,
        eventCounts: { "#commit": 0, "#identity": 0, "#account": 0 },
        errors: 0,
      };
    }
    
    try {
      const metrics = await this.redis.hgetall(this.METRICS_KEY);
      
      return {
        totalEvents: parseInt(metrics.totalEvents || "0"),
        eventCounts: {
          "#commit": parseInt(metrics["#commit"] || "0"),
          "#identity": parseInt(metrics["#identity"] || "0"),
          "#account": parseInt(metrics["#account"] || "0"),
        },
        errors: parseInt(metrics.errors || "0"),
      };
    } catch (error) {
      console.error("[REDIS] Error getting cluster metrics:", error);
      return {
        totalEvents: 0,
        eventCounts: { "#commit": 0, "#identity": 0, "#account": 0 },
        errors: 0,
      };
    }
  }

  async disconnect() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      this.isInitialized = false;
    }
  }
}

export const redisQueue = new RedisQueue();
