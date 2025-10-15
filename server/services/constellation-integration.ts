/**
 * Constellation Integration Service
 *
 * Integrates Constellation's global backlink index with the AppView.
 * Provides enhanced interaction statistics when enabled.
 */

import Redis from 'ioredis';

interface ConstellationConfig {
  enabled: boolean;
  url: string;
  cacheTTL: number;
  timeout: number;
}

interface PostStats {
  likes: number;
  reposts: number;
  replies: number;
  quotes: number;
}

interface ProfileStats {
  followers: number;
  mentions: number;
}

class ConstellationIntegration {
  private enabled: boolean;
  private baseUrl: string;
  private cacheTTL: number;
  private timeout: number;
  private redis: Redis | null = null;
  private statsRequested = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private apiErrors = 0;
  private lastRequestTime = 0;
  private requestDelay = 100; // Minimum delay between requests in ms
  private maxRetries = 3;
  private retryDelay = 1000; // Initial retry delay in ms

  constructor(config: ConstellationConfig) {
    this.enabled = config.enabled;
    this.baseUrl = config.url.replace(/\/$/, '');
    this.cacheTTL = config.cacheTTL;
    this.timeout = config.timeout;

    // Rate limiting configuration from environment variables
    this.requestDelay = parseInt(
      process.env.CONSTELLATION_REQUEST_DELAY || '100',
      10
    );
    this.maxRetries = parseInt(
      process.env.CONSTELLATION_MAX_RETRIES || '3',
      10
    );
    this.retryDelay = parseInt(
      process.env.CONSTELLATION_RETRY_DELAY || '1000',
      10
    );

    if (this.enabled) {
      const redisUrl = process.env.REDIS_URL;
      if (redisUrl) {
        this.redis = new Redis(redisUrl, {
          retryStrategy: (times) => Math.min(times * 50, 2000),
          maxRetriesPerRequest: 3,
          // Enable auto-reconnect to master on READONLY errors
          enableOfflineQueue: true,
          // Ensure we connect to master for write operations
          role: 'master',
        });

        this.redis.on('error', (error: any) => {
          // Handle READONLY errors specifically
          if (error.message && error.message.includes('READONLY')) {
            console.error(
              '[CONSTELLATION] READONLY error - connected to replica instead of master.'
            );
          }
          console.error('[CONSTELLATION] Redis error:', error);
        });
      }

      console.log(`[CONSTELLATION] Integration enabled (URL: ${this.baseUrl})`);
    }
  }

  /**
   * Check if Constellation integration is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get cached value or null
   */
  private async getFromCache<T>(key: string): Promise<T | null> {
    if (!this.redis) return null;

    try {
      const cached = await this.redis.get(key);
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
    if (!this.redis) return;

    try {
      await this.redis.setex(key, this.cacheTTL, JSON.stringify(value));
    } catch (error) {
      console.error('[CONSTELLATION] Cache set error:', error);
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Rate limit requests
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.requestDelay) {
      await this.sleep(this.requestDelay - timeSinceLastRequest);
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Make HTTP request with timeout and retry logic
   */
  private async fetchWithTimeout(
    url: string,
    retryCount = 0
  ): Promise<Response> {
    // Apply rate limiting
    await this.rateLimit();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'AppView-Constellation/1.0',
        },
      });

      clearTimeout(timeoutId);

      // Handle rate limiting (429 errors)
      if (response.status === 429 && retryCount < this.maxRetries) {
        const retryAfter = response.headers.get('retry-after');
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : this.retryDelay * Math.pow(2, retryCount); // Exponential backoff

        console.log(
          `[CONSTELLATION] Rate limited, retrying after ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`
        );
        await this.sleep(delay);
        return this.fetchWithTimeout(url, retryCount + 1);
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Constellation API timeout after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Get link count from Constellation API
   */
  private async getLinksCount(
    target: string,
    collection: string,
    path: string
  ): Promise<number> {
    const url =
      `${this.baseUrl}/links/count?` +
      `target=${encodeURIComponent(target)}` +
      `&collection=${encodeURIComponent(collection)}` +
      `&path=${encodeURIComponent(path)}`;

    try {
      const response = await this.fetchWithTimeout(url);
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(
            `Constellation API rate limit exceeded: ${response.status}`
          );
        }
        throw new Error(`Constellation API error: ${response.status}`);
      }

      const text = await response.text();
      let count: number;

      // Try to parse as JSON first (new API format)
      try {
        const json = JSON.parse(text);
        if (typeof json === 'object' && 'total' in json) {
          count = parseInt(String(json.total), 10);
        } else {
          throw new Error('JSON response missing total field');
        }
      } catch (jsonError) {
        // Fall back to plain text number (old API format)
        count = parseInt(text.trim(), 10);
      }

      if (isNaN(count)) {
        throw new Error(`Invalid response: ${text}`);
      }

      return count;
    } catch (error) {
      this.apiErrors++;
      // Handle different types of errors appropriately
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          // Silently fail on timeout - enrichAggregations will fall back to local counts
        } else if (error.message.includes('rate limit')) {
          // Log rate limit errors but don't spam the logs
          if (this.apiErrors % 10 === 1) {
            console.warn(
              '[CONSTELLATION] Rate limit exceeded. Will use cached/local data.'
            );
          }
        } else {
          console.error('[CONSTELLATION] Error fetching count:', error);
        }
      }
      throw error;
    }
  }

  /**
   * Get comprehensive post statistics from Constellation
   */
  async getPostStats(postUri: string): Promise<PostStats | null> {
    if (!this.enabled) return null;

    this.statsRequested++;
    const cacheKey = `constellation:post:${postUri}`;

    // Check cache first
    const cached = await this.getFromCache<PostStats>(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch from Constellation API with sequential requests to avoid rate limiting
    try {
      // Sequential requests instead of parallel to reduce load on API
      const likes = await this.getLinksCount(
        postUri,
        'app.bsky.feed.like',
        '.subject.uri'
      );
      const reposts = await this.getLinksCount(
        postUri,
        'app.bsky.feed.repost',
        '.subject.uri'
      );
      const replies = await this.getLinksCount(
        postUri,
        'app.bsky.feed.post',
        '.reply.parent.uri'
      );
      const quotes = await this.getLinksCount(
        postUri,
        'app.bsky.feed.post',
        '.embed.record.uri'
      );

      const stats: PostStats = { likes, reposts, replies, quotes };

      // Cache the result
      await this.setInCache(cacheKey, stats);

      return stats;
    } catch (error) {
      // Return null on error - caller will fall back to local counts
      return null;
    }
  }

  /**
   * Enrich aggregation map with Constellation stats
   * Modifies the aggregationsMap in place, falling back to existing values on error
   */
  async enrichAggregations(
    aggregationsMap: Map<string, any>,
    postUris: string[]
  ): Promise<void> {
    if (!this.enabled) return;

    // Process posts in smaller batches with rate limiting
    const batchSize = 2; // Reduced batch size to avoid rate limiting
    for (let i = 0; i < postUris.length; i += batchSize) {
      const batch = postUris.slice(i, i + batchSize);

      // Process batch items sequentially to respect rate limits
      for (const uri of batch) {
        try {
          const constellationStats = await this.getPostStats(uri);

          if (constellationStats) {
            // Get existing aggregation or create empty one
            const existing = aggregationsMap.get(uri) || {
              likeCount: 0,
              repostCount: 0,
              replyCount: 0,
              quoteCount: 0,
              bookmarkCount: 0,
            };

            // Override with Constellation stats (keep bookmarkCount from local)
            aggregationsMap.set(uri, {
              likeCount: constellationStats.likes,
              repostCount: constellationStats.reposts,
              replyCount: constellationStats.replies,
              quoteCount: constellationStats.quotes,
              bookmarkCount: existing.bookmarkCount, // Constellation doesn't track bookmarks
            });
          }
        } catch (error) {
          // Log error but continue processing other posts
          console.error(
            `[CONSTELLATION] Error fetching stats for ${uri}:`,
            error
          );
        }
      }
    }
  }

  /**
   * Get profile statistics from Constellation
   */
  async getProfileStats(did: string): Promise<ProfileStats | null> {
    if (!this.enabled) return null;

    const cacheKey = `constellation:profile:${did}`;

    // Check cache first
    const cached = await this.getFromCache<ProfileStats>(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch from Constellation API
    try {
      const [followers, mentions] = await Promise.all([
        this.getLinksCount(did, 'app.bsky.graph.follow', '.subject'),
        this.getLinksCount(
          did,
          'app.bsky.feed.post',
          '.facets[].features[].did'
        ),
      ]);

      const stats: ProfileStats = { followers, mentions };

      // Cache the result
      await this.setInCache(cacheKey, stats);

      return stats;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get statistics for monitoring
   */
  getStats() {
    const hitRate =
      this.statsRequested > 0
        ? ((this.cacheHits / this.statsRequested) * 100).toFixed(2)
        : '0.00';

    return {
      enabled: this.enabled,
      statsRequested: this.statsRequested,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      apiErrors: this.apiErrors,
      hitRate: `${hitRate}%`,
    };
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }
}

// Initialize singleton instance
const config: ConstellationConfig = {
  enabled: process.env.CONSTELLATION_ENABLED === 'true',
  url: process.env.CONSTELLATION_URL || 'https://constellation.microcosm.blue',
  cacheTTL: parseInt(process.env.CONSTELLATION_CACHE_TTL || '60', 10),
  timeout: parseInt(process.env.CONSTELLATION_TIMEOUT || '10000', 10), // 10s default timeout
};

export const constellationIntegration = new ConstellationIntegration(config);

// Export class for testing
export { ConstellationIntegration };
export type { ConstellationConfig, PostStats, ProfileStats };
