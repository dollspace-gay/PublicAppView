import { redisQueue } from "./redis-queue";

export interface CacheOptions {
  ttl: number; // Time to live in seconds
  prefix: string; // Redis key prefix
}

export class CacheService {
  private static instance: CacheService;
  private cacheOptions: Map<string, CacheOptions> = new Map();

  constructor() {
    // Set default cache options
    this.cacheOptions.set('post_aggregations', { ttl: 300, prefix: 'agg:' }); // 5 minutes
    this.cacheOptions.set('viewer_states', { ttl: 600, prefix: 'vs:' }); // 10 minutes
    this.cacheOptions.set('thread_contexts', { ttl: 1800, prefix: 'tc:' }); // 30 minutes
    this.cacheOptions.set('labels', { ttl: 3600, prefix: 'lbl:' }); // 1 hour
    this.cacheOptions.set('list_mutes', { ttl: 1800, prefix: 'lm:' }); // 30 minutes
    this.cacheOptions.set('list_blocks', { ttl: 1800, prefix: 'lb:' }); // 30 minutes
  }

  static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  private getKey(type: string, identifier: string): string {
    const options = this.cacheOptions.get(type);
    if (!options) throw new Error(`Unknown cache type: ${type}`);
    return `${options.prefix}${identifier}`;
  }

  private getTtl(type: string): number {
    const options = this.cacheOptions.get(type);
    if (!options) throw new Error(`Unknown cache type: ${type}`);
    return options.ttl;
  }

  async get<T>(type: string, identifier: string): Promise<T | null> {
    try {
      const key = this.getKey(type, identifier);
      const redis = (redisQueue as any).redis;
      if (!redis) return null;
      
      const cached = await redis.get(key);
      if (!cached) return null;
      
      return JSON.parse(cached);
    } catch (error) {
      console.error(`[CACHE] Error getting ${type}:${identifier}:`, error);
      return null;
    }
  }

  async set<T>(type: string, identifier: string, data: T): Promise<void> {
    try {
      const key = this.getKey(type, identifier);
      const ttl = this.getTtl(type);
      const redis = (redisQueue as any).redis;
      if (!redis) return;
      
      await redis.setex(key, ttl, JSON.stringify(data));
    } catch (error) {
      console.error(`[CACHE] Error setting ${type}:${identifier}:`, error);
    }
  }

  async getMany<T>(type: string, identifiers: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    
    if (identifiers.length === 0) return result;
    
    try {
      const redis = (redisQueue as any).redis;
      if (!redis) return result;
      
      const keys = identifiers.map(id => this.getKey(type, id));
      const cached = await redis.mget(...keys);
      
      for (let i = 0; i < identifiers.length; i++) {
        if (cached[i]) {
          try {
            result.set(identifiers[i], JSON.parse(cached[i]));
          } catch (parseError) {
            console.error(`[CACHE] Error parsing cached data for ${identifiers[i]}:`, parseError);
          }
        }
      }
    } catch (error) {
      console.error(`[CACHE] Error getting many ${type}:`, error);
    }
    
    return result;
  }

  async setMany<T>(type: string, data: Map<string, T>): Promise<void> {
    if (data.size === 0) return;
    
    try {
      const redis = (redisQueue as any).redis;
      if (!redis) return;
      
      const ttl = this.getTtl(type);
      const pipeline = redis.pipeline();
      
      for (const [identifier, value] of data) {
        const key = this.getKey(type, identifier);
        pipeline.setex(key, ttl, JSON.stringify(value));
      }
      
      await pipeline.exec();
    } catch (error) {
      console.error(`[CACHE] Error setting many ${type}:`, error);
    }
  }

  async delete(type: string, identifier: string): Promise<void> {
    try {
      const key = this.getKey(type, identifier);
      const redis = (redisQueue as any).redis;
      if (!redis) return;
      
      await redis.del(key);
    } catch (error) {
      console.error(`[CACHE] Error deleting ${type}:${identifier}:`, error);
    }
  }

  async deleteMany(type: string, identifiers: string[]): Promise<void> {
    if (identifiers.length === 0) return;
    
    try {
      const redis = (redisQueue as any).redis;
      if (!redis) return;
      
      const keys = identifiers.map(id => this.getKey(type, id));
      await redis.del(...keys);
    } catch (error) {
      console.error(`[CACHE] Error deleting many ${type}:`, error);
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const redis = (redisQueue as any).redis;
      if (!redis) return;
      
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      console.error(`[CACHE] Error invalidating pattern ${pattern}:`, error);
    }
  }
}

export const cacheService = CacheService.getInstance();