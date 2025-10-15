/**
 * Cache Utilities
 * Manages caching for preferences and handle resolution
 */

interface PreferencesCache {
  preferences: unknown[];
  timestamp: number;
}

interface HandleResolutionCache {
  did: string;
  timestamp: number;
}

export class CacheManager {
  // Preferences cache: DID -> { preferences: unknown[], timestamp: number }
  private preferencesCache = new Map<string, PreferencesCache>();
  private readonly PREFERENCES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Handle resolution cache: handle -> { did: string, timestamp: number }
  private handleResolutionCache = new Map<string, HandleResolutionCache>();
  private readonly HANDLE_RESOLUTION_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  constructor() {
    // Clear expired cache entries every minute
    setInterval(() => {
      this.cleanExpiredPreferencesCache();
      this.cleanExpiredHandleResolutionCache();
    }, 60 * 1000);
  }

  /**
   * Get preferences from cache
   */
  getPreferences(userDid: string): unknown[] | null {
    const cached = this.preferencesCache.get(userDid);
    if (cached && !this.isPreferencesCacheExpired(cached)) {
      return cached.preferences;
    }
    return null;
  }

  /**
   * Set preferences in cache
   */
  setPreferences(userDid: string, preferences: unknown[]): void {
    this.preferencesCache.set(userDid, {
      preferences,
      timestamp: Date.now(),
    });
  }

  /**
   * Invalidate preferences cache for a specific user
   */
  invalidatePreferencesCache(userDid: string): void {
    this.preferencesCache.delete(userDid);
    console.log(`[PREFERENCES] Cache invalidated for ${userDid}`);
  }

  /**
   * Check if preferences cache entry is expired
   */
  private isPreferencesCacheExpired(cached: PreferencesCache): boolean {
    return Date.now() - cached.timestamp > this.PREFERENCES_CACHE_TTL;
  }

  /**
   * Clean expired entries from preferences cache
   */
  private cleanExpiredPreferencesCache(): void {
    const now = Date.now();
    const expiredDids: string[] = [];

    this.preferencesCache.forEach((cached, did) => {
      if (now - cached.timestamp > this.PREFERENCES_CACHE_TTL) {
        expiredDids.push(did);
      }
    });

    expiredDids.forEach((did) => {
      this.preferencesCache.delete(did);
    });
  }

  /**
   * Get DID from handle resolution cache
   */
  getResolvedHandle(handle: string): string | null {
    const cached = this.handleResolutionCache.get(handle.toLowerCase());
    if (cached && !this.isHandleResolutionCacheExpired(cached)) {
      console.log(
        `[RESOLVE_ACTOR] Cache hit for handle: ${handle} -> ${cached.did}`
      );
      return cached.did;
    }
    return null;
  }

  /**
   * Cache handle resolution result
   */
  cacheHandleResolution(handle: string, did: string): void {
    this.handleResolutionCache.set(handle.toLowerCase(), {
      did,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if handle resolution cache entry is expired
   */
  private isHandleResolutionCacheExpired(
    cached: HandleResolutionCache
  ): boolean {
    return Date.now() - cached.timestamp > this.HANDLE_RESOLUTION_CACHE_TTL;
  }

  /**
   * Clean expired entries from handle resolution cache
   */
  private cleanExpiredHandleResolutionCache(): void {
    const now = Date.now();
    const expiredHandles: string[] = [];

    this.handleResolutionCache.forEach((cached, handle) => {
      if (now - cached.timestamp > this.HANDLE_RESOLUTION_CACHE_TTL) {
        expiredHandles.push(handle);
      }
    });

    expiredHandles.forEach((handle) => {
      this.handleResolutionCache.delete(handle);
    });
  }
}

// Export singleton instance
export const cacheManager = new CacheManager();
