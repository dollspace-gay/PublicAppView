import { CacheService } from '../cache';

export class HydrationCache {
  private readonly TTL = 1800; // 30 minutes (increased for small userbase)
  private cache: CacheService;

  constructor() {
    this.cache = new CacheService({ ttl: this.TTL, keyPrefix: 'hydration:' });
  }

  /**
   * Get cached hydration data
   */
  async get<T>(key: string): Promise<T | null> {
    return await this.cache.get<T>(key);
  }

  /**
   * Set cached hydration data
   */
  async set(key: string, value: any, ttl: number = this.TTL): Promise<void> {
    await this.cache.set(key, value, ttl);
  }

  /**
   * Get multiple cached values using Redis pipeline for performance
   */
  async mget<T>(keys: string[]): Promise<Map<string, T>> {
    if (keys.length === 0) return new Map();

    const result = new Map<string, T>();

    // Use cache service's internal connection
    const cacheService = this.cache as any;
    if (!cacheService.redis || !cacheService.isInitialized) {
      // Fallback to sequential if Redis not available
      for (const key of keys) {
        const value = await this.get<T>(key);
        if (value) {
          result.set(key, value);
        }
      }
      return result;
    }

    // Batch fetch with Redis mget
    try {
      const prefixedKeys = keys.map(k => `hydration:${k}`);
      const values = await cacheService.redis.mget(...prefixedKeys);

      values.forEach((value: string | null, index: number) => {
        if (value) {
          try {
            result.set(keys[index], JSON.parse(value) as T);
          } catch (e) {
            console.error(`[HYDRATION_CACHE] Failed to parse cached value for ${keys[index]}`);
          }
        }
      });
    } catch (error) {
      console.error('[HYDRATION_CACHE] Error in batch mget:', error);
      // Fallback to sequential on error
      for (const key of keys) {
        const value = await this.get<T>(key);
        if (value) {
          result.set(key, value);
        }
      }
    }

    return result;
  }

  /**
   * Set multiple cached values using Redis pipeline for performance
   */
  async mset(entries: Map<string, any>, ttl: number = this.TTL): Promise<void> {
    if (entries.size === 0) return;

    const cacheService = this.cache as any;
    if (!cacheService.redis || !cacheService.isInitialized) {
      // Fallback to sequential if Redis not available
      for (const [key, value] of Array.from(entries.entries())) {
        await this.set(key, value, ttl);
      }
      return;
    }

    // Batch set with Redis pipeline
    try {
      const pipeline = cacheService.redis.pipeline();

      for (const [key, value] of Array.from(entries.entries())) {
        const prefixedKey = `hydration:${key}`;
        const serialized = JSON.stringify(value);
        pipeline.setex(prefixedKey, ttl, serialized);
      }

      await pipeline.exec();
    } catch (error) {
      console.error('[HYDRATION_CACHE] Error in batch mset:', error);
      // Fallback to sequential on error
      for (const [key, value] of Array.from(entries.entries())) {
        await this.set(key, value, ttl);
      }
    }
  }

  /**
   * Invalidate cached data
   */
  async invalidate(key: string): Promise<void> {
    await this.cache.del(key);
  }

  /**
   * Invalidate multiple keys using Redis pipeline for performance
   */
  async invalidateMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    const cacheService = this.cache as any;
    if (!cacheService.redis || !cacheService.isInitialized) {
      // Fallback to sequential if Redis not available
      for (const key of keys) {
        await this.invalidate(key);
      }
      return;
    }

    // Batch delete with Redis pipeline
    try {
      const prefixedKeys = keys.map(k => `hydration:${k}`);
      if (prefixedKeys.length > 0) {
        await cacheService.redis.del(...prefixedKeys);
      }
    } catch (error) {
      console.error('[HYDRATION_CACHE] Error in batch invalidate:', error);
      // Fallback to sequential on error
      for (const key of keys) {
        await this.invalidate(key);
      }
    }
  }

  /**
   * Build cache key for posts
   */
  postKey(uri: string): string {
    return `post:${uri}`;
  }

  /**
   * Build cache key for actor
   */
  actorKey(did: string): string {
    return `actor:${did}`;
  }

  /**
   * Build cache key for viewer context
   */
  viewerContextKey(did: string): string {
    return `viewer:${did}`;
  }

  /**
   * Build cache key for labels
   */
  labelsKey(uri: string): string {
    return `labels:${uri}`;
  }
}
