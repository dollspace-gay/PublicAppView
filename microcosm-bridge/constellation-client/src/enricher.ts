/**
 * Post and Profile Stats Enricher
 *
 * Enriches posts and profiles with accurate interaction statistics from Constellation.
 * Includes Redis caching to minimize API calls and improve performance.
 */

import { ConstellationAPIClient, LinksCounts } from './api-client.js';
import Redis from 'ioredis';

interface PostStats {
  likes: number;
  reposts: number;
  replies: number;
  quotes: number;
}

interface ProfileStats {
  followers: number;
  mentions: number;
  blocks: number;
  lists: number;
}

interface EnricherConfig {
  cacheEnabled: boolean;
  cacheTTL: number;
  redisUrl?: string;
}

export class StatsEnricher {
  private client: ConstellationAPIClient;
  private cache: Redis | null = null;
  private cacheEnabled: boolean;
  private cacheTTL: number;
  private statsRequested = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(client: ConstellationAPIClient, config: EnricherConfig) {
    this.client = client;
    this.cacheEnabled = config.cacheEnabled;
    this.cacheTTL = config.cacheTTL;

    if (this.cacheEnabled && config.redisUrl) {
      try {
        this.cache = new Redis(config.redisUrl, {
          retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            return delay;
          },
          maxRetriesPerRequest: 3,
        });

        this.cache.on('error', (error) => {
          console.error('[CONSTELLATION] Redis error:', error);
        });

        this.cache.on('connect', () => {
          console.log('[CONSTELLATION] Redis connected');
        });
      } catch (error) {
        console.error('[CONSTELLATION] Failed to connect to Redis:', error);
        this.cache = null;
        this.cacheEnabled = false;
      }
    } else {
      console.log('[CONSTELLATION] Cache disabled');
    }
  }

  /**
   * Get cached value or null if not found
   */
  private async getFromCache<T>(key: string): Promise<T | null> {
    if (!this.cache || !this.cacheEnabled) {
      return null;
    }

    try {
      const cached = await this.cache.get(key);
      if (cached) {
        this.cacheHits++;
        return JSON.parse(cached);
      }
      this.cacheMisses++;
      return null;
    } catch (error) {
      console.error('[CONSTELLATION] Cache get error:', error);
      return null;
    }
  }

  /**
   * Set value in cache
   */
  private async setInCache(key: string, value: any): Promise<void> {
    if (!this.cache || !this.cacheEnabled) {
      return;
    }

    try {
      await this.cache.setex(key, this.cacheTTL, JSON.stringify(value));
    } catch (error) {
      console.error('[CONSTELLATION] Cache set error:', error);
    }
  }

  /**
   * Get comprehensive statistics for a post
   */
  async getPostStats(postUri: string): Promise<PostStats> {
    this.statsRequested++;
    const cacheKey = `constellation:post:${postUri}`;

    // Check cache first
    const cached = await this.getFromCache<PostStats>(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch from Constellation API
    try {
      const [likes, reposts, replies, quotes] = await Promise.all([
        this.client.getPostLikes(postUri),
        this.client.getPostReposts(postUri),
        this.client.getPostReplies(postUri),
        this.client.getPostQuotes(postUri),
      ]);

      const stats: PostStats = { likes, reposts, replies, quotes };

      // Cache the result
      await this.setInCache(cacheKey, stats);

      return stats;
    } catch (error) {
      console.error('[CONSTELLATION] Error fetching post stats:', error);
      // Return zeros on error rather than failing
      return { likes: 0, reposts: 0, replies: 0, quotes: 0 };
    }
  }

  /**
   * Get comprehensive statistics for a profile
   */
  async getProfileStats(did: string): Promise<ProfileStats> {
    this.statsRequested++;
    const cacheKey = `constellation:profile:${did}`;

    // Check cache first
    const cached = await this.getFromCache<ProfileStats>(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch from Constellation API
    try {
      const allLinks = await this.client.getAllLinksCount(did);

      const stats: ProfileStats = {
        followers: allLinks['app.bsky.graph.follow']?.['.subject'] || 0,
        mentions:
          allLinks['app.bsky.feed.post']?.['facets[].features[].did'] || 0,
        blocks: allLinks['app.bsky.graph.block']?.['.subject'] || 0,
        lists: allLinks['app.bsky.graph.listitem']?.['.subject'] || 0,
      };

      // Cache the result
      await this.setInCache(cacheKey, stats);

      return stats;
    } catch (error) {
      console.error('[CONSTELLATION] Error fetching profile stats:', error);
      // Return zeros on error rather than failing
      return { followers: 0, mentions: 0, blocks: 0, lists: 0 };
    }
  }

  /**
   * Batch enrich multiple posts (useful for feed hydration)
   */
  async enrichPosts(postUris: string[]): Promise<Map<string, PostStats>> {
    const results = new Map<string, PostStats>();

    // Process in parallel with concurrency limit
    const batchSize = 5;
    for (let i = 0; i < postUris.length; i += batchSize) {
      const batch = postUris.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (uri) => {
          const stats = await this.getPostStats(uri);
          return { uri, stats };
        })
      );

      batchResults.forEach(({ uri, stats }) => {
        results.set(uri, stats);
      });
    }

    return results;
  }

  /**
   * Invalidate cache for a specific post or profile
   */
  async invalidateCache(uri: string): Promise<void> {
    if (!this.cache || !this.cacheEnabled) {
      return;
    }

    try {
      const postKey = `constellation:post:${uri}`;
      const profileKey = `constellation:profile:${uri}`;
      await this.cache.del(postKey, profileKey);
    } catch (error) {
      console.error('[CONSTELLATION] Cache invalidation error:', error);
    }
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats() {
    const hitRate =
      this.statsRequested > 0
        ? ((this.cacheHits / this.statsRequested) * 100).toFixed(2)
        : '0.00';

    return {
      enabled: this.cacheEnabled,
      ttl: this.cacheTTL,
      statsRequested: this.statsRequested,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      hitRate: `${hitRate}%`,
    };
  }

  /**
   * Close connections and cleanup
   */
  async close(): Promise<void> {
    if (this.cache) {
      await this.cache.quit();
      this.cache = null;
    }
  }
}

export type { PostStats, ProfileStats, EnricherConfig };
