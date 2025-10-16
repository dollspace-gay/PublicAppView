import Redis from 'ioredis';
import type { ThreadRecord, PostRecord } from '../types';

/**
 * Cache Service for Data-Plane
 *
 * Caches:
 * - Assembled threads
 * - Thread gate data
 * - Viewer relationships (blocks/mutes)
 * - Root author following lists
 * - List members
 */
class CacheService {
  private redis: Redis | null = null;
  private isInitialized = false;

  // Cache key prefixes
  private readonly THREAD_PREFIX = 'thread:';
  private readonly THREAD_GATE_PREFIX = 'gate:';
  private readonly VIEWER_BLOCKS_PREFIX = 'viewer:blocks:';
  private readonly VIEWER_MUTES_PREFIX = 'viewer:mutes:';
  private readonly USER_FOLLOWING_PREFIX = 'user:following:';
  private readonly LIST_MEMBERS_PREFIX = 'list:members:';
  private readonly POST_PREFIX = 'post:';

  // TTLs (Time To Live in seconds)
  private readonly THREAD_TTL = 300; // 5 minutes
  private readonly THREAD_GATE_TTL = 3600; // 1 hour (gates rarely change)
  private readonly VIEWER_RELATIONSHIPS_TTL = 600; // 10 minutes
  private readonly FOLLOWING_TTL = 600; // 10 minutes
  private readonly LIST_MEMBERS_TTL = 600; // 10 minutes
  private readonly POST_TTL = 300; // 5 minutes

  async connect() {
    if (this.redis) {
      return;
    }

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    console.log(`[CACHE] Connecting to Redis at ${redisUrl}...`);

    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      enableOfflineQueue: true,
      lazyConnect: false,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.redis.on('connect', () => {
      console.log('[CACHE] Connected to Redis');
    });

    this.redis.on('error', (error: any) => {
      console.error('[CACHE] Redis error:', error);
    });

    this.redis.on('ready', () => {
      console.log('[CACHE] Redis client ready');
      this.isInitialized = true;
    });

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, 5000);

      this.redis!.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.redis!.once('error', (error) => {
        clearTimeout(timeout);
        // Don't reject - just log and continue without cache
        console.warn(
          '[CACHE] Redis connection failed, continuing without cache:',
          error
        );
        resolve();
      });
    });
  }

  /**
   * Get cached assembled thread
   */
  async getThread(
    uri: string,
    depth: number,
    parentHeight: number,
    viewerDid?: string
  ): Promise<ThreadRecord | null> {
    if (!this.isEnabled()) return null;

    try {
      const key = this.getThreadKey(uri, depth, parentHeight, viewerDid);
      const data = await this.redis!.get(key);

      if (data) {
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      console.error('[CACHE] Error getting thread:', error);
      return null;
    }
  }

  /**
   * Cache assembled thread
   */
  async setThread(
    uri: string,
    depth: number,
    parentHeight: number,
    viewerDid: string | undefined,
    thread: ThreadRecord
  ): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const key = this.getThreadKey(uri, depth, parentHeight, viewerDid);
      await this.redis!.setex(key, this.THREAD_TTL, JSON.stringify(thread));
    } catch (error) {
      console.error('[CACHE] Error setting thread:', error);
    }
  }

  /**
   * Invalidate thread cache for a specific post URI
   */
  async invalidateThread(uri: string): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      // Delete all variations of this thread (different depths, viewers, etc.)
      const pattern = `${this.THREAD_PREFIX}${this.escapeRedisKey(uri)}:*`;
      await this.deleteByPattern(pattern);
    } catch (error) {
      console.error('[CACHE] Error invalidating thread:', error);
    }
  }

  /**
   * Get cached thread gate
   */
  async getThreadGate(postUri: string): Promise<any | null> {
    if (!this.isEnabled()) return null;

    try {
      const key = `${this.THREAD_GATE_PREFIX}${this.escapeRedisKey(postUri)}`;
      const data = await this.redis!.get(key);

      if (data) {
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      console.error('[CACHE] Error getting thread gate:', error);
      return null;
    }
  }

  /**
   * Cache thread gate
   */
  async setThreadGate(postUri: string, gate: any): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const key = `${this.THREAD_GATE_PREFIX}${this.escapeRedisKey(postUri)}`;
      await this.redis!.setex(key, this.THREAD_GATE_TTL, JSON.stringify(gate));
    } catch (error) {
      console.error('[CACHE] Error setting thread gate:', error);
    }
  }

  /**
   * Invalidate thread gate cache
   */
  async invalidateThreadGate(postUri: string): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const key = `${this.THREAD_GATE_PREFIX}${this.escapeRedisKey(postUri)}`;
      await this.redis!.del(key);

      // Also invalidate any threads that might be affected
      await this.invalidateThread(postUri);
    } catch (error) {
      console.error('[CACHE] Error invalidating thread gate:', error);
    }
  }

  /**
   * Get cached viewer blocks
   */
  async getViewerBlocks(viewerDid: string): Promise<Set<string> | null> {
    if (!this.isEnabled()) return null;

    try {
      const key = `${this.VIEWER_BLOCKS_PREFIX}${this.escapeRedisKey(viewerDid)}`;
      const data = await this.redis!.get(key);

      if (data) {
        const array = JSON.parse(data);
        return new Set(array);
      }
      return null;
    } catch (error) {
      console.error('[CACHE] Error getting viewer blocks:', error);
      return null;
    }
  }

  /**
   * Cache viewer blocks
   */
  async setViewerBlocks(
    viewerDid: string,
    blockedDids: Set<string>
  ): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const key = `${this.VIEWER_BLOCKS_PREFIX}${this.escapeRedisKey(viewerDid)}`;
      const array = Array.from(blockedDids);
      await this.redis!.setex(
        key,
        this.VIEWER_RELATIONSHIPS_TTL,
        JSON.stringify(array)
      );
    } catch (error) {
      console.error('[CACHE] Error setting viewer blocks:', error);
    }
  }

  /**
   * Get cached viewer mutes
   */
  async getViewerMutes(viewerDid: string): Promise<Set<string> | null> {
    if (!this.isEnabled()) return null;

    try {
      const key = `${this.VIEWER_MUTES_PREFIX}${this.escapeRedisKey(viewerDid)}`;
      const data = await this.redis!.get(key);

      if (data) {
        const array = JSON.parse(data);
        return new Set(array);
      }
      return null;
    } catch (error) {
      console.error('[CACHE] Error getting viewer mutes:', error);
      return null;
    }
  }

  /**
   * Cache viewer mutes
   */
  async setViewerMutes(
    viewerDid: string,
    mutedDids: Set<string>
  ): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const key = `${this.VIEWER_MUTES_PREFIX}${this.escapeRedisKey(viewerDid)}`;
      const array = Array.from(mutedDids);
      await this.redis!.setex(
        key,
        this.VIEWER_RELATIONSHIPS_TTL,
        JSON.stringify(array)
      );
    } catch (error) {
      console.error('[CACHE] Error setting viewer mutes:', error);
    }
  }

  /**
   * Invalidate viewer relationships cache (blocks and mutes)
   */
  async invalidateViewerRelationships(viewerDid: string): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const blocksKey = `${this.VIEWER_BLOCKS_PREFIX}${this.escapeRedisKey(viewerDid)}`;
      const mutesKey = `${this.VIEWER_MUTES_PREFIX}${this.escapeRedisKey(viewerDid)}`;
      await this.redis!.del(blocksKey, mutesKey);
    } catch (error) {
      console.error('[CACHE] Error invalidating viewer relationships:', error);
    }
  }

  /**
   * Get cached user following list
   */
  async getUserFollowing(did: string): Promise<Set<string> | null> {
    if (!this.isEnabled()) return null;

    try {
      const key = `${this.USER_FOLLOWING_PREFIX}${this.escapeRedisKey(did)}`;
      const data = await this.redis!.get(key);

      if (data) {
        const array = JSON.parse(data);
        return new Set(array);
      }
      return null;
    } catch (error) {
      console.error('[CACHE] Error getting user following:', error);
      return null;
    }
  }

  /**
   * Cache user following list
   */
  async setUserFollowing(
    did: string,
    followingDids: Set<string>
  ): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const key = `${this.USER_FOLLOWING_PREFIX}${this.escapeRedisKey(did)}`;
      const array = Array.from(followingDids);
      await this.redis!.setex(key, this.FOLLOWING_TTL, JSON.stringify(array));
    } catch (error) {
      console.error('[CACHE] Error setting user following:', error);
    }
  }

  /**
   * Invalidate user following cache
   */
  async invalidateUserFollowing(did: string): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const key = `${this.USER_FOLLOWING_PREFIX}${this.escapeRedisKey(did)}`;
      await this.redis!.del(key);
    } catch (error) {
      console.error('[CACHE] Error invalidating user following:', error);
    }
  }

  /**
   * Get cached list members
   */
  async getListMembers(listUri: string): Promise<Set<string> | null> {
    if (!this.isEnabled()) return null;

    try {
      const key = `${this.LIST_MEMBERS_PREFIX}${this.escapeRedisKey(listUri)}`;
      const data = await this.redis!.get(key);

      if (data) {
        const array = JSON.parse(data);
        return new Set(array);
      }
      return null;
    } catch (error) {
      console.error('[CACHE] Error getting list members:', error);
      return null;
    }
  }

  /**
   * Cache list members
   */
  async setListMembers(
    listUri: string,
    memberDids: Set<string>
  ): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const key = `${this.LIST_MEMBERS_PREFIX}${this.escapeRedisKey(listUri)}`;
      const array = Array.from(memberDids);
      await this.redis!.setex(
        key,
        this.LIST_MEMBERS_TTL,
        JSON.stringify(array)
      );
    } catch (error) {
      console.error('[CACHE] Error setting list members:', error);
    }
  }

  /**
   * Invalidate list members cache
   */
  async invalidateListMembers(listUri: string): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const key = `${this.LIST_MEMBERS_PREFIX}${this.escapeRedisKey(listUri)}`;
      await this.redis!.del(key);
    } catch (error) {
      console.error('[CACHE] Error invalidating list members:', error);
    }
  }

  /**
   * Get cached post
   */
  async getPost(uri: string): Promise<PostRecord | null> {
    if (!this.isEnabled()) return null;

    try {
      const key = `${this.POST_PREFIX}${this.escapeRedisKey(uri)}`;
      const data = await this.redis!.get(key);

      if (data) {
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      console.error('[CACHE] Error getting post:', error);
      return null;
    }
  }

  /**
   * Cache post
   */
  async setPost(uri: string, post: PostRecord): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const key = `${this.POST_PREFIX}${this.escapeRedisKey(uri)}`;
      await this.redis!.setex(key, this.POST_TTL, JSON.stringify(post));
    } catch (error) {
      console.error('[CACHE] Error setting post:', error);
    }
  }

  /**
   * Invalidate post cache
   */
  async invalidatePost(uri: string): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const key = `${this.POST_PREFIX}${this.escapeRedisKey(uri)}`;
      await this.redis!.del(key);

      // Also invalidate any threads containing this post
      await this.invalidateThread(uri);
    } catch (error) {
      console.error('[CACHE] Error invalidating post:', error);
    }
  }

  /**
   * Helper: Generate thread cache key
   */
  private getThreadKey(
    uri: string,
    depth: number,
    parentHeight: number,
    viewerDid?: string
  ): string {
    const viewer = viewerDid ? `:${this.escapeRedisKey(viewerDid)}` : ':public';
    return `${this.THREAD_PREFIX}${this.escapeRedisKey(uri)}:d${depth}:h${parentHeight}${viewer}`;
  }

  /**
   * Helper: Escape special characters in Redis keys
   */
  private escapeRedisKey(key: string): string {
    // Replace characters that might cause issues in Redis keys
    return key.replace(/[:*?[\]]/g, '_');
  }

  /**
   * Helper: Delete keys by pattern (for invalidation)
   */
  private async deleteByPattern(pattern: string): Promise<void> {
    if (!this.redis) return;

    try {
      // Use SCAN to find matching keys (more efficient than KEYS)
      let cursor = '0';
      do {
        const [newCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100
        );
        cursor = newCursor;

        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      console.error('[CACHE] Error deleting by pattern:', error);
    }
  }

  /**
   * Check if cache is enabled and connected
   */
  private isEnabled(): boolean {
    return this.redis !== null && this.isInitialized;
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    connected: boolean;
    keyCount: number;
    memoryUsage: string;
    hitRate?: number;
  }> {
    if (!this.isEnabled()) {
      return {
        connected: false,
        keyCount: 0,
        memoryUsage: '0B',
      };
    }

    try {
      const info = await this.redis!.info('memory');
      const dbSize = await this.redis!.dbsize();

      // Parse memory usage from info
      const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
      const memoryUsage = memoryMatch ? memoryMatch[1] : 'unknown';

      return {
        connected: true,
        keyCount: dbSize,
        memoryUsage,
      };
    } catch (error) {
      console.error('[CACHE] Error getting stats:', error);
      return {
        connected: false,
        keyCount: 0,
        memoryUsage: '0B',
      };
    }
  }

  /**
   * Clear all cache keys (use with caution!)
   */
  async clearAll(): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      // Only clear our cache prefixes, not the entire Redis database
      const prefixes = [
        this.THREAD_PREFIX,
        this.THREAD_GATE_PREFIX,
        this.VIEWER_BLOCKS_PREFIX,
        this.VIEWER_MUTES_PREFIX,
        this.USER_FOLLOWING_PREFIX,
        this.LIST_MEMBERS_PREFIX,
        this.POST_PREFIX,
      ];

      for (const prefix of prefixes) {
        await this.deleteByPattern(`${prefix}*`);
      }

      console.log('[CACHE] Cleared all cache keys');
    } catch (error) {
      console.error('[CACHE] Error clearing cache:', error);
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      this.isInitialized = false;
    }
  }
}

export const cacheService = new CacheService();
