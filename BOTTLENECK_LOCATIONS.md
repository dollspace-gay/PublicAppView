# Exact Bottleneck Locations

## 1. Critical N+1 Query Problem

### Current Flow (SLOW):
```
Timeline Request
  ↓
getTimeline() - fetches 50 posts
  ↓
feedAlgorithm.applyAlgorithm(posts)
  ↓
enrichPostsWithEngagement(posts)
  ↓
Promise.all([
  storage.getPostLikes(uri1),    ← DB Query #1
  storage.getPostLikes(uri2),    ← DB Query #2
  ...
  storage.getPostLikes(uri50),   ← DB Query #50
  storage.getPostReposts(uri1),  ← DB Query #51
  storage.getPostReposts(uri2),  ← DB Query #52
  ...
  storage.getPostReposts(uri50)  ← DB Query #100
])
  ↓
COUNT(*) FROM likes WHERE post_uri = ? (x50)
COUNT(*) FROM reposts WHERE post_uri = ? (x50)
  ↓
TOTAL: 100 DATABASE QUERIES
```

### Optimized Flow (FAST):
```
Timeline Request
  ↓
getTimeline() - fetches 50 posts
  ↓
feedAlgorithm.applyAlgorithm(posts)
  ↓
enrichPostsWithEngagement(posts)
  ↓
SELECT * FROM post_aggregations 
WHERE post_uri IN (uri1, uri2, ... uri50)  ← ONE DB Query
  ↓
TOTAL: 1 DATABASE QUERY
```

---

## 2. File-by-File Breakdown

### `server/services/feed-algorithm.ts`
**Lines 13-45:** The `enrichPostsWithEngagement()` function

**Problem Code (Lines 19-23):**
```typescript
const [allLikes, allReposts] = await Promise.all([
  Promise.all(postUris.map(uri => storage.getPostLikes(uri))),  // N queries
  Promise.all(postUris.map(uri => storage.getPostReposts(uri))), // N queries
]);
```

**Used By:**
- Line 67: `reverseChronological()` calls it
- Line 75: `engagementBased()` calls it  
- Line 92: `discoveryBased()` calls it

**Impact:** Every feed algorithm hits this bottleneck

---

### `server/storage.ts`

**Lines 811-830:** `getPostLikes()` - Called once per post
```typescript
async getPostLikes(postUri: string, limit = 100, cursor?: string) {
  // Queries likes table for ONE post
  const results = await db
    .select()
    .from(likes)
    .where(eq(likes.postUri, postUri))  // ← Single post query
    .orderBy(desc(likes.indexedAt))
    .limit(limit + 1);
  // ...
}
```

**Lines 901-920:** `getPostReposts()` - Called once per post
```typescript
async getPostReposts(postUri: string, limit = 100, cursor?: string) {
  // Queries reposts table for ONE post
  const results = await db
    .select()
    .from(reposts)
    .where(eq(reposts.postUri, postUri))  // ← Single post query
    .orderBy(desc(reposts.indexedAt))
    .limit(limit + 1);
  // ...
}
```

**These methods should NOT be called in a loop!**

---

### `server/services/xrpc-api.ts`

**Lines 1188-1245:** `getTimeline()` endpoint
```typescript
async getTimeline(req: Request, res: Response) {
  // ...
  let posts = await storage.getTimeline(userDid, params.limit, params.cursor);
  
  // BOTTLENECK: This calls enrichPostsWithEngagement()
  const rankedPosts = await feedAlgorithm.applyAlgorithm(posts, algorithm);
  
  const serializedPosts = await this.serializePosts(rankedPosts, userDid, req);
  // ...
}
```

**Lines 1247-1350:** `getAuthorFeed()` endpoint
Same pattern - calls feed algorithm which triggers N+1 queries

---

### `shared/schema.ts`

**Lines 78-93:** The `postAggregations` table (ALREADY EXISTS!)
```typescript
export const postAggregations = pgTable("post_aggregations", {
  postUri: varchar("post_uri", { length: 512 }).primaryKey(),
  likeCount: integer("like_count").default(0).notNull(),      // ← Use this!
  repostCount: integer("repost_count").default(0).notNull(),  // ← Use this!
  replyCount: integer("reply_count").default(0).notNull(),
  bookmarkCount: integer("bookmark_count").default(0).notNull(),
  quoteCount: integer("quote_count").default(0).notNull(),
  // ... INDEXED for fast lookups
});
```

**This table is maintained and ready to use, but feed-algorithm.ts ignores it!**

---

## 3. Cache Service (Unused)

### `server/services/cache.ts`
**Lines 59-99:** Methods that should be used but aren't
```typescript
async getPostAggregations(postUris: string[]): Promise<Map<string, PostAggregation> | null>
async setPostAggregations(aggregations: Map<string, PostAggregation>): Promise<void>
```

**Status:** ❌ NOT CALLED by feed algorithm or hydration

---

## 4. Call Chain Analysis

```
REQUEST: GET /xrpc/app.bsky.feed.getTimeline
  ↓
routes.ts:2184 - app.get("/xrpc/app.bsky.feed.getTimeline", ...)
  ↓
xrpc-api.ts:1188 - getTimeline()
  ↓
storage.ts:1687 - getTimeline() → returns Post[]
  ↓
xrpc-api.ts:1218 - feedAlgorithm.applyAlgorithm(posts, algorithm)
  ↓
feed-algorithm.ts:47 - applyAlgorithm()
  ↓
feed-algorithm.ts:67/75/92 - reverseChronological/engagementBased/discoveryBased()
  ↓
feed-algorithm.ts:13 - enrichPostsWithEngagement() ← BOTTLENECK HERE
  ↓
feed-algorithm.ts:21-22 - Promise.all(map(uri => storage.getPostLikes(uri)))
  ↓
storage.ts:811 - getPostLikes() - ONE query per post × N posts
storage.ts:901 - getPostReposts() - ONE query per post × N posts
  ↓
💥 100 DATABASE QUERIES
```

---

## 5. Quick Fix Locations

### Fix #1: Feed Algorithm (CRITICAL)
**File:** `server/services/feed-algorithm.ts`
**Lines:** 13-45 (entire `enrichPostsWithEngagement` function)
**Action:** Replace with batch query to `postAggregations` table

### Fix #2: Add Caching
**File:** `server/services/feed-algorithm.ts`
**Lines:** Add cache checks before line 19
**Action:** Check `cacheService.getPostAggregations()` first

### Fix #3: Hydration Caching
**File:** `server/services/hydration/index.ts`
**Lines:** 129-144 (aggregations fetch)
**Action:** Already uses correct batch query! But add Redis cache

### Fix #4: DB Pool Size
**File:** `server/db.ts`
**Line:** 63
**Action:** Change `DEFAULT_DB_POOL_SIZE = 4` to `20`

---

## 6. Environment Variables

Set these to improve performance:

```bash
# Increase database connection pool
DB_POOL_SIZE=20

# Redis cache (should already be set)
REDIS_URL=redis://localhost:6379

# Optional: Enable query logging to verify fixes
DATABASE_LOGGING=true
```

---

## 7. Testing the Fixes

### Before Fixes - Enable Query Logging
Add to `server/db.ts`:
```typescript
const db = createDbPool(mainPoolSize, "main", {
  logger: {
    logQuery: (query: string) => {
      console.log('[DB_QUERY]', query);
    }
  }
});
```

### Expected Output Before Fix:
```
[DB_QUERY] SELECT * FROM likes WHERE post_uri = 'at://...'
[DB_QUERY] SELECT * FROM likes WHERE post_uri = 'at://...'
[DB_QUERY] SELECT * FROM likes WHERE post_uri = 'at://...'
... (100 times)
```

### Expected Output After Fix:
```
[DB_QUERY] SELECT * FROM post_aggregations WHERE post_uri IN ('at://...', 'at://...', ...)
```

### Measure Response Time
```bash
# Before fix
time curl "http://localhost:5000/xrpc/app.bsky.feed.getTimeline?limit=50"
# Expected: 2-5 seconds

# After fix
time curl "http://localhost:5000/xrpc/app.bsky.feed.getTimeline?limit=50"
# Expected: 0.1-0.3 seconds
```

---

## Summary

**Root Cause:** Feed algorithm queries likes/reposts individually instead of reading pre-computed aggregations

**Fix Difficulty:** Easy (change 1 function)

**Performance Impact:** 10-50x improvement

**Why It Exists:** Likely implemented before `postAggregations` table was added, or developer didn't know about it
