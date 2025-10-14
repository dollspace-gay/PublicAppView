# Serving API Performance Bottleneck Analysis

## Executive Summary

After analyzing the codebase, I've identified **critical N+1 query problems** and several other performance bottlenecks in the serving API. The main issue is that the feed algorithm is making hundreds of individual database queries instead of using the existing `postAggregations` table that was specifically designed for this purpose.

---

## 🔴 CRITICAL BOTTLENECKS

### 1. **N+1 Query Problem in Feed Algorithm** (SEVERE)

**Location:** `server/services/feed-algorithm.ts:19-23`

**The Problem:**
```typescript
const [allLikes, allReposts] = await Promise.all([
  Promise.all(postUris.map(uri => storage.getPostLikes(uri))),
  Promise.all(postUris.map(uri => storage.getPostReposts(uri))),
]);
```

**Why This is Critical:**
- For a timeline with 50 posts, this executes **100 separate database queries** (50 for likes + 50 for reposts)
- Each `getPostLikes()` and `getPostReposts()` hits the database individually
- This happens on EVERY timeline/feed request
- The `enrichPostsWithEngagement()` function is called by ALL feed algorithms (reverse-chronological, engagement, discovery)

**Impact:**
- Timeline endpoint: 100+ DB queries per request
- Author feed endpoint: 100+ DB queries per request
- Multiply by concurrent users = database gets hammered

**The Fix:**
You already have a `postAggregations` table with indexed `likeCount` and `repostCount` columns! The code should:
1. Query `postAggregations` table in ONE batch query using `inArray()`
2. Fall back to counting if aggregation doesn't exist

**Estimated Performance Gain:** 10-50x faster (100 queries → 1-2 queries)

---

### 2. **Redundant Post Hydration Queries**

**Location:** `server/services/hydration/index.ts:84-127`

**The Problem:**
The enhanced hydrator fetches reply parent/root posts separately, which can add significant overhead:
```typescript
const replyPostsData = await db
  .select()
  .from(posts)
  .where(inArray(posts.uri, replyUris));
```

**Impact:**
- Additional database query for every batch of posts with replies
- Often duplicates data already in the main feed
- Reply posts then need their own actors fetched

**Recommendation:**
- Implement a hydration depth limit
- Consider lazy loading reply context
- Cache frequently accessed parent posts

---

### 3. **Missing Query Result Caching**

**Current State:**
- Redis cache service exists (`server/services/cache.ts`)
- Cache methods for aggregations exist (`getPostAggregations`, `setPostAggregations`)
- **But the cache is NOT being used in the feed algorithm or hydration pipeline**

**Impact:**
- Every request hits the database
- No benefit from Redis cache
- Repeated work for the same posts across different users

**The Fix:**
1. Check Redis cache before DB queries
2. Populate cache on DB hits
3. Invalidate on like/repost/reply creation

**Estimated Performance Gain:** 2-5x faster for hot posts

---

## 🟡 MODERATE BOTTLENECKS

### 4. **Actor Hydration for Every Post**

**Location:** `server/services/hydration/index.ts:163-186`

**The Problem:**
```typescript
const actorsData = await db
  .select()
  .from(users)
  .where(inArray(users.did, Array.from(actorDids)));
```

While this uses `inArray()` (good!), it's not cached. Popular actors (e.g., high-follower accounts) get queried repeatedly.

**Recommendation:**
- Cache actor profiles in Redis with longer TTL (30-60 minutes)
- Implement a warming strategy for popular accounts

---

### 5. **Viewer State Queries**

**Location:** `server/services/hydration/viewer-context.ts` (imported in index)

The viewer state queries (likes, reposts, follows for a specific viewer) happen on every request without caching.

**Recommendation:**
- Cache viewer states per user session
- Use shorter TTL (5-10 minutes) to keep fresh

---

### 6. **Embed Resolution**

**Location:** `server/services/hydration/embed-resolver.ts`

The embed resolver has a local Map cache, but:
- Cache doesn't persist across requests (new Map on each instantiation)
- Recursively fetches quote posts up to depth 3
- No database query optimization for batch embed fetching

**Recommendation:**
- Move cache to Redis
- Batch fetch all embedded posts in one query
- Implement lazy loading for deep quote chains

---

## 🟢 MINOR OPTIMIZATIONS

### 7. **Database Connection Pool Size**

**Location:** `server/db.ts:63-65`

Default pool size is only 4 connections:
```typescript
const DEFAULT_DB_POOL_SIZE = 4;
```

**Recommendation:**
- Increase to 10-20 for production servers
- Set via `DB_POOL_SIZE` environment variable
- Monitor connection usage

---

### 8. **Sequential Operations in Timeline**

**Location:** `server/services/xrpc-api.ts:1196-1199`

```typescript
const [followCount, userPostCount] = await Promise.all([
  storage.getUserFollowingCount(userDid),
  storage.getUserPostCount(userDid)
]);
```

This is actually good! But the timeline fetch happens sequentially after:
```typescript
let posts = await storage.getTimeline(userDid, params.limit, params.cursor);
```

**Minor optimization:**
Could parallel fetch settings and timeline, though impact is small.

---

## 📊 RECOMMENDED FIX PRIORITY

### Priority 1: Fix N+1 in Feed Algorithm (CRITICAL)
**File:** `server/services/feed-algorithm.ts`

Replace the N+1 queries with:
```typescript
async enrichPostsWithEngagement(posts: Post[]): Promise<PostWithEngagement[]> {
  if (posts.length === 0) return [];

  const postUris = posts.map(p => p.uri);
  
  // SINGLE batch query instead of N queries
  const aggregations = await db
    .select()
    .from(postAggregations)
    .where(inArray(postAggregations.postUri, postUris));
  
  const aggMap = new Map(aggregations.map(a => [a.postUri, a]));
  
  const enrichedPosts = posts.map((post) => {
    const agg = aggMap.get(post.uri);
    const likeCount = agg?.likeCount || 0;
    const repostCount = agg?.repostCount || 0;
    
    const hoursSinceIndexed = (Date.now() - post.indexedAt.getTime()) / (1000 * 60 * 60);
    const timeDecay = 1 / (1 + hoursSinceIndexed / 24);
    const engagementScore = (likeCount + repostCount * 2) * timeDecay;
    
    return {
      ...post,
      likeCount,
      repostCount,
      engagementScore,
    };
  });
  
  return enrichedPosts;
}
```

### Priority 2: Implement Redis Caching
**Files:** 
- `server/services/hydration/index.ts`
- `server/services/feed-algorithm.ts`

Add cache checks before all DB queries:
1. Check `cacheService.getPostAggregations(postUris)`
2. For cache misses, query DB
3. Populate cache with results

### Priority 3: Cache Actor Profiles
**File:** `server/services/hydration/index.ts`

Implement actor profile caching with 30-60 minute TTL.

### Priority 4: Optimize Embed Resolution
**File:** `server/services/hydration/embed-resolver.ts`

Move to Redis cache and batch fetch embedded posts.

### Priority 5: Increase DB Pool Size
**File:** `server/db.ts`

Set `DB_POOL_SIZE=20` in production environment.

---

## 🎯 EXPECTED PERFORMANCE IMPROVEMENTS

After implementing Priority 1 & 2:
- **Timeline endpoint:** 10-50x faster (from 100+ queries to 1-3 queries)
- **Author feed endpoint:** 10-50x faster
- **Database load:** Reduced by 90%+
- **API response time:** From seconds to milliseconds for cached content

---

## 🔍 HOW TO VERIFY

Before fixes:
```bash
# Check DB query count in logs
grep "SELECT.*FROM.*likes" logs | wc -l
grep "SELECT.*FROM.*reposts" logs | wc -l
```

After fixes:
```bash
# Should see mostly postAggregations queries
grep "SELECT.*FROM.*post_aggregations" logs | wc -l
```

Monitor:
- API response times (should drop dramatically)
- Database connection pool usage
- Redis hit rate
- Database query counts

---

## 📝 NOTES

1. The `postAggregations` table already exists and is maintained
2. The aggregations are updated by the event processor when likes/reposts are created
3. Redis cache service is already initialized but underutilized
4. The infrastructure for fast serving exists, it's just not being used properly

The good news: **These are all fixable code-level issues, not architectural problems!**
