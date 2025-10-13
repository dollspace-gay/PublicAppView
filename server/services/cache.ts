import Redis from "ioredis";
import { PostAggregation, PostViewerState, ThreadContext, Label } from "@shared/schema";

export interface CacheConfig {
  ttl: number; // Time to live in seconds
  keyPrefix: string;
}

export class CacheService {
  private redis: Redis | null = null;
  private isInitialized = false;
  private readonly config: CacheConfig;

  constructor(config: CacheConfig = { ttl: 300, keyPrefix: "atproto:cache:" }) {
    this.config = config;
  }

  async connect() {
    if (this.redis) {
      return;
    }

    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    console.log(`[CACHE] Connecting to Redis at ${redisUrl}...`);

    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      // Enable auto-reconnect to master on READONLY errors
      enableOfflineQueue: true,
      // Ensure we connect to master for write operations
      role: 'master',
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.redis.on("connect", () => {
      console.log("[CACHE] Connected to Redis");
    });

    this.redis.on("error", (error: any) => {
      // Handle READONLY errors specifically
      if (error.message && error.message.includes('READONLY')) {
        console.error("[CACHE] READONLY error - connected to replica instead of master.");
      }
      console.error("[CACHE] Redis error:", error);
    });

    this.isInitialized = true;
  }

  private getKey(type: string, identifier: string): string {
    return `${this.config.keyPrefix}${type}:${identifier}`;
  }

  // Post Aggregations Caching
  async getPostAggregations(postUris: string[]): Promise<Map<string, PostAggregation> | null> {
    if (!this.redis || !this.isInitialized) return null;

    try {
      const keys = postUris.map(uri => this.getKey("post_aggregations", uri));
      const results = await this.redis.mget(...keys);
      
      const aggregations = new Map<string, PostAggregation>();
      let hasData = false;

      results.forEach((data, index) => {
        if (data) {
          const aggregation = JSON.parse(data) as PostAggregation;
          aggregations.set(postUris[index], aggregation);
          hasData = true;
        }
      });

      return hasData ? aggregations : null;
    } catch (error) {
      console.error("[CACHE] Error getting post aggregations:", error);
      return null;
    }
  }

  async setPostAggregations(aggregations: Map<string, PostAggregation>): Promise<void> {
    if (!this.redis || !this.isInitialized) return;

    try {
      const pipeline = this.redis.pipeline();
      
      for (const [uri, aggregation] of aggregations) {
        const key = this.getKey("post_aggregations", uri);
        pipeline.setex(key, this.config.ttl, JSON.stringify(aggregation));
      }
      
      await pipeline.exec();
    } catch (error) {
      console.error("[CACHE] Error setting post aggregations:", error);
    }
  }

  async invalidatePostAggregation(postUri: string): Promise<void> {
    if (!this.redis || !this.isInitialized) return;

    try {
      const key = this.getKey("post_aggregations", postUri);
      await this.redis.del(key);
    } catch (error) {
      console.error("[CACHE] Error invalidating post aggregation:", error);
    }
  }

  // Post Viewer States Caching
  async getPostViewerStates(postUris: string[], viewerDid: string): Promise<Map<string, PostViewerState> | null> {
    if (!this.redis || !this.isInitialized) return null;

    try {
      const keys = postUris.map(uri => this.getKey("post_viewer_states", `${viewerDid}:${uri}`));
      const results = await this.redis.mget(...keys);
      
      const viewerStates = new Map<string, PostViewerState>();
      let hasData = false;

      results.forEach((data, index) => {
        if (data) {
          const viewerState = JSON.parse(data) as PostViewerState;
          viewerStates.set(postUris[index], viewerState);
          hasData = true;
        }
      });

      return hasData ? viewerStates : null;
    } catch (error) {
      console.error("[CACHE] Error getting post viewer states:", error);
      return null;
    }
  }

  async setPostViewerStates(viewerStates: Map<string, PostViewerState>, viewerDid: string): Promise<void> {
    if (!this.redis || !this.isInitialized) return;

    try {
      const pipeline = this.redis.pipeline();
      
      for (const [uri, viewerState] of viewerStates) {
        const key = this.getKey("post_viewer_states", `${viewerDid}:${uri}`);
        pipeline.setex(key, this.config.ttl, JSON.stringify(viewerState));
      }
      
      await pipeline.exec();
    } catch (error) {
      console.error("[CACHE] Error setting post viewer states:", error);
    }
  }

  async invalidatePostViewerState(postUri: string, viewerDid: string): Promise<void> {
    if (!this.redis || !this.isInitialized) return;

    try {
      const key = this.getKey("post_viewer_states", `${viewerDid}:${postUri}`);
      await this.redis.del(key);
    } catch (error) {
      console.error("[CACHE] Error invalidating post viewer state:", error);
    }
  }

  // Thread Contexts Caching
  async getThreadContexts(postUris: string[]): Promise<Map<string, ThreadContext> | null> {
    if (!this.redis || !this.isInitialized) return null;

    try {
      const keys = postUris.map(uri => this.getKey("thread_contexts", uri));
      const results = await this.redis.mget(...keys);
      
      const threadContexts = new Map<string, ThreadContext>();
      let hasData = false;

      results.forEach((data, index) => {
        if (data) {
          const threadContext = JSON.parse(data) as ThreadContext;
          threadContexts.set(postUris[index], threadContext);
          hasData = true;
        }
      });

      return hasData ? threadContexts : null;
    } catch (error) {
      console.error("[CACHE] Error getting thread contexts:", error);
      return null;
    }
  }

  async setThreadContexts(threadContexts: Map<string, ThreadContext>): Promise<void> {
    if (!this.redis || !this.isInitialized) return;

    try {
      const pipeline = this.redis.pipeline();
      
      for (const [uri, threadContext] of threadContexts) {
        const key = this.getKey("thread_contexts", uri);
        pipeline.setex(key, this.config.ttl, JSON.stringify(threadContext));
      }
      
      await pipeline.exec();
    } catch (error) {
      console.error("[CACHE] Error setting thread contexts:", error);
    }
  }

  // Labels Caching
  async getLabels(subjects: string[]): Promise<Map<string, Label[]> | null> {
    if (!this.redis || !this.isInitialized) return null;

    try {
      const keys = subjects.map(subject => this.getKey("labels", subject));
      const results = await this.redis.mget(...keys);
      
      const labels = new Map<string, Label[]>();
      let hasData = false;

      results.forEach((data, index) => {
        if (data) {
          const subjectLabels = JSON.parse(data) as Label[];
          labels.set(subjects[index], subjectLabels);
          hasData = true;
        }
      });

      return hasData ? labels : null;
    } catch (error) {
      console.error("[CACHE] Error getting labels:", error);
      return null;
    }
  }

  async setLabels(labels: Map<string, Label[]>): Promise<void> {
    if (!this.redis || !this.isInitialized) return;

    try {
      const pipeline = this.redis.pipeline();
      
      for (const [subject, subjectLabels] of labels) {
        const key = this.getKey("labels", subject);
        pipeline.setex(key, this.config.ttl, JSON.stringify(subjectLabels));
      }
      
      await pipeline.exec();
    } catch (error) {
      console.error("[CACHE] Error setting labels:", error);
    }
  }

  // Generic cache operations
  async get<T>(key: string): Promise<T | null> {
    if (!this.redis || !this.isInitialized) return null;

    try {
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error("[CACHE] Error getting key:", error);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    if (!this.redis || !this.isInitialized) return;

    try {
      const serialized = JSON.stringify(value);
      const expireTime = ttl || this.config.ttl;
      await this.redis.setex(key, expireTime, serialized);
    } catch (error) {
      console.error("[CACHE] Error setting key:", error);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.redis || !this.isInitialized) return;

    try {
      await this.redis.del(key);
    } catch (error) {
      console.error("[CACHE] Error deleting key:", error);
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    if (!this.redis || !this.isInitialized) return;

    try {
      // Use SCAN instead of KEYS to avoid blocking Redis
      let cursor = '0';
      const keysToDelete: string[] = [];
      
      do {
        const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = result[0];
        const keys = result[1];
        
        if (keys.length > 0) {
          keysToDelete.push(...keys);
        }
      } while (cursor !== '0');
      
      // Delete in batches to avoid command buffer issues
      const BATCH_SIZE = 100;
      for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
        const batch = keysToDelete.slice(i, i + BATCH_SIZE);
        if (batch.length > 0) {
          await this.redis.del(...batch);
        }
      }
    } catch (error) {
      console.error("[CACHE] Error invalidating pattern:", error);
    }
  }

  async disconnect() {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      this.isInitialized = false;
    }
  }

  // Health check
  async isHealthy(): Promise<boolean> {
    if (!this.redis || !this.isInitialized) return false;

    try {
      const result = await this.redis.ping();
      return result === "PONG";
    } catch (error) {
      return false;
    }
  }
}

// Export singleton instance
export const cacheService = new CacheService();