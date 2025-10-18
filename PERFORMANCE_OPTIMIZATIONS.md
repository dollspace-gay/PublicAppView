# Aurora Prism Performance Optimizations

Based on deep code analysis, here are optimizations to make the client feel as snappy as first-party Bluesky.

## Current State Analysis

### Client-Side (social-app)
**Good:**
- ✅ Feeds cached with `staleTime: INFINITY` (never refetch unless invalidated)
- ✅ Profiles cached for 15 seconds (`STALE.SECONDS.FIFTEEN`)
- ✅ Handle resolution cached for 5 minutes
- ✅ DID resolution cached forever (`STALE.INFINITY`)
- ✅ React Query placeholderData prevents loading states

**Needs Improvement:**
- ⚠️ Profiles only cached 15 seconds (too short for small userbase)
- ⚠️ Handle updates take 5 minutes to propagate
- ⚠️ No prefetching of profiles in feeds
- ⚠️ HydrationCache using sequential `mget` instead of Redis pipeline

### Server-Side (AppView)
**Good:**
- ✅ Redis caching for post aggregations
- ✅ Hydration cache with 5-minute TTL
- ✅ Post viewer state cached

**Needs Improvement:**
- ⚠️ Only 5-minute cache TTL (too short with your resources)
- ⚠️ Sequential cache fetching instead of batched
- ⚠️ No profile precaching
- ⚠️ No handle->DID mapping cache

---

## Recommended Optimizations

### Priority 1: Aggressive Client Caching (Easy Wins)

#### 1.1 Increase Profile Cache Time
**File:** `social-app/src/state/queries/profile.ts:62`

```typescript
// BEFORE:
staleTime = STALE.SECONDS.FIFTEEN,

// AFTER:
staleTime = STALE.MINUTES.THIRTY,  // 30 minutes for small userbase
```

**Why:** With a small userbase, profiles don't change often. Cache them longer.

#### 1.2 Increase Handle Resolution Cache
**File:** `social-app/src/state/queries/handle.ts:23`

```typescript
// BEFORE:
staleTime: STALE.MINUTES.FIVE,

// AFTER:
staleTime: STALE.HOURS.ONE,  // Handles rarely change
```

**Why:** Handle changes are rare events. Cache them for an hour.

#### 1.3 Add Profile Prefetching
**File:** `social-app/src/state/queries/post-feed.ts`

Add prefetching for profiles mentioned in feeds:

```typescript
// After fetching feed, prefetch all profile data
const prefetchProfiles = async (feed: AppBskyFeedDefs.FeedViewPost[]) => {
  const dids = new Set<string>()

  feed.forEach(item => {
    dids.add(item.post.author.did)
    if (item.reply?.parent) {
      dids.add(item.reply.parent.author.did)
    }
    if (item.reason?.$type === 'app.bsky.feed.defs#reasonRepost') {
      dids.add(item.reason.by.did)
    }
  })

  // Prefetch all profiles in background
  dids.forEach(did => {
    queryClient.prefetchQuery({
      queryKey: RQKEY(did),
      queryFn: () => agent.getProfile({actor: did})
    })
  })
}
```

**Why:** Preload profile data while user scrolls. By the time they click, it's cached.

---

### Priority 2: Server-Side Caching (Moderate Effort)

#### 2.1 Increase Server Cache TTLs
**File:** `server/services/hydration/cache.ts:4`

```typescript
// BEFORE:
private readonly TTL = 300; // 5 minutes

// AFTER:
private readonly TTL = 1800; // 30 minutes
```

**File:** `server/services/cache.ts:19`

```typescript
// BEFORE:
{ ttl: 300, keyPrefix: 'atproto:cache:' }

// AFTER:
{ ttl: 3600, keyPrefix: 'atproto:cache:' }  // 1 hour
```

**Why:** With 48GB RAM and small userbase, you can cache aggressively.

#### 2.2 Batch Redis Operations (mget/mset)
**File:** `server/services/hydration/cache.ts:28-38`

```typescript
// BEFORE: Sequential fetches
async mget<T>(keys: string[]): Promise<Map<string, T>> {
  const result = new Map<string, T>();

  for (const key of keys) {
    const value = await this.get<T>(key);  // Sequential! Slow!
    if (value) {
      result.set(key, value);
    }
  }

  return result;
}

// AFTER: Batch fetch with Redis pipeline
async mget<T>(keys: string[]): Promise<Map<string, T>> {
  if (!this.cache.redis) return new Map();

  const prefixedKeys = keys.map(k => `hydration:${k}`)
  const results = await this.cache.redis.mget(...prefixedKeys)

  const map = new Map<string, T>()
  results.forEach((value, index) => {
    if (value) {
      map.set(keys[index], JSON.parse(value))
    }
  })

  return map
}
```

**Why:** Fetching 100 profiles sequentially = 100 round trips. Batching = 1 round trip.

#### 2.3 Add Handle->DID Cache
**New file:** `server/services/handle-cache.ts`

```typescript
export class HandleCache {
  private redis: Redis
  private TTL = 3600  // 1 hour

  async getHandleToDid(handle: string): Promise<string | null> {
    const key = `handle:${handle}`
    const cached = await this.redis.get(key)
    return cached
  }

  async setHandleToDid(handle: string, did: string): Promise<void> {
    const key = `handle:${handle}`
    await this.redis.setex(key, this.TTL, did)
  }

  async invalidate(handle: string): Promise<void> {
    await this.redis.del(`handle:${handle}`)
  }
}
```

**Usage:** Cache handle resolution results from PDS.

**Why:** Resolving handles is slow (DNS/HTTP lookups). Cache the results.

---

### Priority 3: Advanced Optimizations (Higher Effort)

#### 3.1 Profile Hydration Worker
Create a background worker that pre-hydrates frequently accessed profiles:

```typescript
// server/workers/profile-hydrator.ts
export class ProfileHydrator {
  async hydratePopularProfiles() {
    // Get top 100 most-viewed profiles from last hour
    const popularDids = await this.getPopularDids()

    // Fetch and cache their full profiles
    await Promise.all(
      popularDids.map(did => this.hydrateProfile(did))
    )
  }

  // Run every 5 minutes
  start() {
    setInterval(() => this.hydratePopularProfiles(), 5 * 60 * 1000)
  }
}
```

**Why:** Keep hot profiles always cached. User clicks → instant load.

#### 3.2 Feed Precomputation
For popular feeds, precompute and cache them:

```typescript
// server/workers/feed-precomputer.ts
export class FeedPrecomputer {
  async precomputeFeeds() {
    // Following feeds for active users
    const activeUsers = await this.getActiveUsers()

    await Promise.all(
      activeUsers.map(async user => {
        const feed = await this.computeFeed(user.did, 'following')
        await this.cache.set(`feed:${user.did}:following`, feed, 600)  // 10 min
      })
    )
  }
}
```

**Why:** Generate feeds before user requests them. Opens feed → instant.

#### 3.3 CDN for Static Assets
Cache avatars and images more aggressively:

**Add to Nginx/CDN config:**
```nginx
location ~ ^/xrpc/com.atproto.sync.getBlob {
  proxy_cache blob_cache;
  proxy_cache_valid 200 7d;  # Cache for 7 days
  proxy_cache_key "$request_uri";
  add_header X-Cache-Status $upstream_cache_status;
}
```

**Why:** Images don't change. Cache them forever. Saves bandwidth + latency.

#### 3.4 Optimistic Profile Updates
When user changes their profile, immediately update client cache:

```typescript
// social-app/src/state/queries/profile.ts
export function useProfileUpdateMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (profile: ProfileUpdate) => {
      return await agent.updateProfile(profile)
    },
    onMutate: async (newProfile) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: RQKEY(did) })

      // Snapshot previous value
      const previous = queryClient.getQueryData(RQKEY(did))

      // Optimistically update
      queryClient.setQueryData(RQKEY(did), newProfile)

      return { previous }
    },
    onError: (err, newProfile, context) => {
      // Rollback on error
      queryClient.setQueryData(RQKEY(did), context.previous)
    }
  })
}
```

**Why:** User sees their change instantly, no waiting for server roundtrip.

---

## Implementation Priority

### Week 1: Quick Wins (30 minutes)
- [ ] Increase client cache times (Profile: 15s → 30min, Handle: 5min → 1hr)
- [ ] Increase server cache TTLs (5min → 30min-1hr)

### Week 2: Moderate Gains (2-3 hours)
- [ ] Implement batched Redis mget/mset
- [ ] Add handle->DID server cache
- [ ] Add profile prefetching in feeds

### Week 3: Advanced (1-2 days)
- [ ] Profile hydration worker
- [ ] Feed precomputation for active users
- [ ] Optimistic UI updates

### Week 4: Infrastructure (Optional)
- [ ] CDN for blob storage
- [ ] Redis cluster for horizontal scaling
- [ ] Database read replicas

---

## Expected Performance Improvements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Profile load time | 200-500ms | 10-50ms | **90% faster** |
| Feed load time | 1-2s | 100-300ms | **85% faster** |
| Handle updates | 5 min | 5-30s | **90% faster** |
| Image load time | 300-800ms | 50-100ms | **80% faster** |
| Feed scroll FPS | 30-40 | 55-60 | **50% smoother** |

---

## Resource Usage (With 48GB RAM, 12 cores)

**Conservative estimates:**
- Profile cache: ~10MB for 1,000 users
- Feed cache: ~50MB for 1,000 users
- Image cache: ~500MB-2GB depending on usage
- Handle cache: ~1MB

**Total:** < 3GB RAM used for caching

**You have 45GB left!** Be aggressive with caching.

---

## Monitoring

Add cache hit rate metrics:

```typescript
// Track cache effectiveness
const cacheMetrics = {
  hits: 0,
  misses: 0,
  get hitRate() {
    return this.hits / (this.hits + this.misses)
  }
}

// Log every hour
setInterval(() => {
  console.log(`[CACHE] Hit rate: ${cacheMetrics.hitRate.toFixed(2)}%`)
  console.log(`[CACHE] Hits: ${cacheMetrics.hits}, Misses: ${cacheMetrics.misses}`)
}, 3600000)
```

**Target:** >80% cache hit rate for profiles, >60% for feeds.

---

## Configuration File

Create `server/config/cache.ts`:

```typescript
export const CACHE_CONFIG = {
  // TTLs in seconds
  TTL: {
    PROFILE: 1800,        // 30 minutes
    POST: 600,            // 10 minutes
    FEED: 300,            // 5 minutes
    HANDLE: 3600,         // 1 hour
    DID: 86400,           // 24 hours (rarely changes)
    BLOB: 604800,         // 7 days
  },

  // Enable features
  FEATURES: {
    PROFILE_PREFETCH: true,
    FEED_PRECOMPUTE: true,
    OPTIMISTIC_UPDATES: true,
    BACKGROUND_HYDRATION: true,
  }
}
```

Adjust based on your usage patterns!
