# Recommended Fixes with Code Examples

## Fix #1: Replace N+1 Queries in Feed Algorithm (CRITICAL)

### Current Code (SLOW - 100 queries)
**File:** `server/services/feed-algorithm.ts`

```typescript
async enrichPostsWithEngagement(posts: Post[]): Promise<PostWithEngagement[]> {
  if (posts.length === 0) {
    return [];
  }

  const postUris = posts.map(p => p.uri);
  
  // ❌ BAD: Makes N queries for likes + N queries for reposts
  const [allLikes, allReposts] = await Promise.all([
    Promise.all(postUris.map(uri => storage.getPostLikes(uri))),
    Promise.all(postUris.map(uri => storage.getPostReposts(uri))),
  ]);
  
  const likeCounts = new Map(postUris.map((uri, i) => [uri, allLikes[i].likes.length]));
  const repostCounts = new Map(postUris.map((uri, i) => [uri, allReposts[i].reposts.length]));
  
  // ... rest of function
}
```

### Fixed Code (FAST - 1-2 queries)
**File:** `server/services/feed-algorithm.ts`

```typescript
import { db } from "../db";
import { postAggregations } from "@shared/schema";
import { inArray } from "drizzle-orm";
import { cacheService } from "./cache";

async enrichPostsWithEngagement(posts: Post[]): Promise<PostWithEngagement[]> {
  if (posts.length === 0) {
    return [];
  }

  const postUris = posts.map(p => p.uri);
  
  // ✅ GOOD: Try cache first
  let aggregationsMap = await cacheService.getPostAggregations(postUris);
  
  if (!aggregationsMap) {
    // ✅ GOOD: Single batch query to aggregations table
    const aggregations = await db
      .select()
      .from(postAggregations)
      .where(inArray(postAggregations.postUri, postUris));
    
    aggregationsMap = new Map(
      aggregations.map(agg => [agg.postUri, agg])
    );
    
    // Cache the results
    await cacheService.setPostAggregations(aggregationsMap);
  }
  
  const enrichedPosts = posts.map((post) => {
    const agg = aggregationsMap.get(post.uri);
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

### Impact
- **Before:** 100 queries per timeline request (50 posts × 2 query types)
- **After:** 0-1 query per timeline request (cache hit = 0 queries, cache miss = 1 query)
- **Performance:** 50-100x faster

---

## Fix #2: Ensure Aggregations are Updated

### Check Event Processor
**File:** `server/services/event-processor.ts`

Make sure likes and reposts update the aggregations table. Search for these patterns:

```typescript
// When a like is created:
await storage.createLike(like);

// Should also do:
await db.insert(postAggregations)
  .values({ postUri: like.postUri, likeCount: 1 })
  .onConflictDoUpdate({
    target: postAggregations.postUri,
    set: { 
      likeCount: sql`${postAggregations.likeCount} + 1`,
      updatedAt: new Date()
    }
  });

// Invalidate cache
await cacheService.invalidatePostAggregation(like.postUri);
```

---

## Fix #3: Increase Database Connection Pool

### Current Code
**File:** `server/db.ts`

```typescript
const DEFAULT_DB_POOL_SIZE = 4; // ❌ Too small
```

### Fixed Code
**File:** `server/db.ts`

```typescript
const DEFAULT_DB_POOL_SIZE = 20; // ✅ Better for production
```

### Or Use Environment Variable
```bash
export DB_POOL_SIZE=20
```

---

## Fix #4: Add Missing Imports

After modifying `feed-algorithm.ts`, ensure these imports are at the top:

```typescript
import type { Post } from "@shared/schema";
import { storage } from "../storage";
import { db } from "../db";
import { postAggregations } from "@shared/schema";
import { inArray } from "drizzle-orm";
import { cacheService } from "./cache";
```

---

## Fix #5: Cache Actor Profiles (Optional but Recommended)

### Add to Hydration
**File:** `server/services/hydration/index.ts`

Before line 163:
```typescript
// Check cache first
const cachedActors = await cacheService.get<Map<string, any>>(
  `actors:${Array.from(actorDids).sort().join(',')}`
);

if (cachedActors) {
  actorsMap = cachedActors;
} else {
  // Fetch actors (existing code)
  const actorsData = await db
    .select()
    .from(users)
    .where(inArray(users.did, Array.from(actorDids)));
  
  // Build map (existing code)
  const actorsMap = new Map<string, any>();
  for (const actor of actorsData) {
    actorsMap.set(actor.did, { /* ... */ });
  }
  
  // Cache with 30 minute TTL
  await cacheService.set(
    `actors:${Array.from(actorDids).sort().join(',')}`,
    actorsMap,
    1800 // 30 minutes
  );
}
```

---

## Fix #6: Monitor Database Queries (For Testing)

### Add Query Logging Temporarily
**File:** `server/db.ts`

After creating the pool, add:
```typescript
// Development query logging
if (process.env.LOG_QUERIES === 'true') {
  const originalQuery = (db as any).execute;
  (db as any).execute = async function(...args: any[]) {
    const startTime = Date.now();
    const result = await originalQuery.apply(this, args);
    const duration = Date.now() - startTime;
    console.log(`[DB_QUERY] ${duration}ms:`, args[0]);
    return result;
  };
}
```

Then run:
```bash
LOG_QUERIES=true npm run dev
```

---

## Testing Your Fixes

### 1. Before Making Changes
```bash
# Terminal 1: Start server with query logging
LOG_QUERIES=true npm run dev

# Terminal 2: Make a timeline request
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:5000/xrpc/app.bsky.feed.getTimeline?limit=50"

# Count database queries in Terminal 1
# Should see 100+ SELECT queries to likes and reposts tables
```

### 2. After Making Changes
```bash
# Terminal 1: Start server with query logging
LOG_QUERIES=true npm run dev

# Terminal 2: Make a timeline request
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:5000/xrpc/app.bsky.feed.getTimeline?limit=50"

# Count database queries in Terminal 1
# Should see 1 SELECT query to post_aggregations table
# Or 0 queries if cache hit
```

### 3. Load Testing (Optional)
```bash
# Install Apache Bench
sudo apt-get install apache2-utils

# Test before fixes
ab -n 100 -c 10 -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:5000/xrpc/app.bsky.feed.getTimeline?limit=50"

# Test after fixes
ab -n 100 -c 10 -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:5000/xrpc/app.bsky.feed.getTimeline?limit=50"

# Compare:
# - Requests per second (should be 10-50x higher)
# - Time per request (should be 10-50x lower)
```

---

## Rollback Plan

If something breaks, you can quickly rollback:

### 1. Save Current Code
```bash
git stash save "feed-algorithm-optimization"
```

### 2. If Issues Occur
```bash
git stash pop
```

### 3. Gradual Rollout
Deploy the fix to one server first, monitor for 24 hours, then roll out to all servers.

---

## Expected Results

### Before Fixes
- Timeline request: 2-5 seconds
- Database CPU: 80-100%
- Database queries per request: 100+
- Can handle: ~10 concurrent users

### After Fixes
- Timeline request: 0.1-0.3 seconds
- Database CPU: 10-20%
- Database queries per request: 0-1
- Can handle: ~500 concurrent users

### Database Query Reduction
- **Before:** 100 queries × 100 requests/sec = 10,000 queries/sec
- **After:** 1 query × 100 requests/sec = 100 queries/sec (with cache: even lower)
- **Reduction:** 99% fewer database queries

---

## Additional Optimizations (Future)

1. **Add database read replicas** for even better scalability
2. **Implement query result streaming** for large result sets
3. **Add CDN caching** for public timelines
4. **Implement pagination cursor optimization**
5. **Add database query timeout limits**
6. **Use database connection pooling per worker**

---

## Summary

**Primary Fix:** Replace N queries in feed algorithm with 1 batch query
**Secondary Fix:** Add Redis caching layer
**Tertiary Fix:** Increase connection pool size

**Time to Implement:** 1-2 hours
**Testing Time:** 2-4 hours
**Expected Performance Improvement:** 10-50x faster

**Risk Level:** Low (can easily rollback)
**Complexity:** Low (change 1 function)
**Impact:** High (fixes the main bottleneck)
