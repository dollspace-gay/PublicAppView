import { CacheService } from '../cache';

export class HydrationCache {
  private readonly TTL = 300; // 5 minutes
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
   * Get multiple cached values (not supported by current cache, fetch individually)
   */
  async mget<T>(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    
    for (const key of keys) {
      const value = await this.get<T>(key);
      if (value) {
        result.set(key, value);
      }
    }
    
    return result;
  }

  /**
   * Set multiple cached values
   */
  async mset(entries: Map<string, any>, ttl: number = this.TTL): Promise<void> {
    for (const [key, value] of Array.from(entries.entries())) {
      await this.set(key, value, ttl);
    }
  }

  /**
   * Invalidate cached data
   */
  async invalidate(key: string): Promise<void> {
    await this.cache.del(key);
  }

  /**
   * Invalidate multiple keys
   */
  async invalidateMany(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.invalidate(key);
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
