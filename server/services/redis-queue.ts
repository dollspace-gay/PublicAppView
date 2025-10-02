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
  private isInitialized = false;

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
        1000,
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
    } catch (error) {
      console.error("[REDIS] Error consuming events:", error);
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
    } catch (error) {
      console.error("[REDIS] Error claiming pending messages:", error);
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

  async disconnect() {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      this.isInitialized = false;
    }
  }
}

export const redisQueue = new RedisQueue();
