# Redis Integration Update for Feed Items

## Overview
Updated the Redis worker system to properly handle the new feed items schema and ensure data consistency between the database and Redis counters.

## Changes Made

### 1. Event Processor Updates (`server/services/event-processor.ts`)

#### Added Feed Item Creation
- **Posts**: When a post is created via the firehose, a corresponding feed item is now created
- **Reposts**: When a repost is created, a corresponding feed item is now created
- **Feed Item Types**: Properly categorized as 'post' or 'repost'

#### Added Feed Item Deletion
- **Posts**: When a post is deleted, the corresponding feed item is also deleted
- **Reposts**: When a repost is deleted, the corresponding feed item is also deleted

#### Code Changes
```typescript
// In processPost method
const feedItem: InsertFeedItem = {
  uri: uri,
  postUri: uri,
  originatorDid: authorDid,
  type: 'post',
  sortAt: this.safeDate(record.createdAt),
  cid: cid,
  createdAt: this.safeDate(record.createdAt),
};
await this.storage.createFeedItem(feedItem);

// In processRepost method
const feedItem: InsertFeedItem = {
  uri: uri,
  postUri: postUri,
  originatorDid: userDid,
  type: 'repost',
  sortAt: this.safeDate(record.createdAt),
  cid: cid || uri,
  createdAt: this.safeDate(record.createdAt),
};
await this.storage.createFeedItem(feedItem);

// In delete operations
case "app.bsky.feed.post":
  await this.storage.deletePost(uri);
  await this.storage.deleteFeedItem(uri); // Delete corresponding feed item
  break;
case "app.bsky.feed.repost":
  await this.storage.deleteRepost(uri);
  await this.storage.deleteFeedItem(uri); // Delete corresponding feed item
  break;
```

### 2. Storage Layer Updates (`server/storage.ts`)

#### Redis Counter Integration
- **createFeedItem**: Increments 'feed_items' counter in Redis
- **deleteFeedItem**: Decrements 'feed_items' counter in Redis
- **Consistent with existing pattern**: Follows the same pattern as posts, likes, reposts, etc.

#### Code Changes
```typescript
async createFeedItem(feedItem: InsertFeedItem): Promise<FeedItem> {
  const [result] = await db.insert(feedItems).values(feedItem).returning();
  
  // Update Redis counter for dashboard metrics
  const { redisQueue } = await import("./services/redis-queue");
  await redisQueue.incrementRecordCount('feed_items');
  
  return result;
}

async deleteFeedItem(uri: string): Promise<void> {
  await db.delete(feedItems).where(eq(feedItems.uri, uri));
  
  // Update Redis counter for dashboard metrics
  const { redisQueue } = await import("./services/redis-queue");
  await redisQueue.incrementRecordCount('feed_items', -1);
}
```

## Data Flow

### 1. Real-time Processing
```
Firehose Event → Redis Queue → Event Processor → Database + Feed Items + Redis Counters
```

### 2. Feed Item Creation
- **Post Created**: `posts` table + `feed_items` table + Redis counter increment
- **Repost Created**: `reposts` table + `feed_items` table + Redis counter increment

### 3. Feed Item Deletion
- **Post Deleted**: `posts` table + `feed_items` table + Redis counter decrement
- **Repost Deleted**: `reposts` table + `feed_items` table + Redis counter decrement

## Redis Counter Management

### Dashboard Metrics
The Redis counters are used for dashboard metrics and include:
- `users`: Total user count
- `posts`: Total post count
- `likes`: Total like count
- `reposts`: Total repost count
- `follows`: Total follow count
- `blocks`: Total block count
- **`feed_items`: Total feed item count** (NEW)

### Counter Operations
- **Increment**: When creating feed items
- **Decrement**: When deleting feed items
- **Consistency**: Maintains consistency with database state

## Benefits

### 1. Data Consistency
- Feed items are automatically created when posts/reposts are processed
- Feed items are automatically deleted when posts/reposts are deleted
- Redis counters stay in sync with database state

### 2. Real-time Updates
- New posts/reposts immediately appear in feeds
- Deleted posts/reposts are immediately removed from feeds
- Dashboard metrics are updated in real-time

### 3. Performance
- Feed queries use the optimized `feed_items` table
- Redis counters provide fast dashboard metrics
- Proper indexing for feed operations

## Testing

### Verification Steps
1. **Create a post**: Verify feed item is created and counter is incremented
2. **Create a repost**: Verify feed item is created and counter is incremented
3. **Delete a post**: Verify feed item is deleted and counter is decremented
4. **Delete a repost**: Verify feed item is deleted and counter is decremented
5. **Check dashboard**: Verify feed_items counter appears in metrics

### Monitoring
- Monitor Redis queue depth for feed item operations
- Check database consistency between posts/reposts and feed_items
- Verify Redis counter accuracy

## Migration Considerations

### Existing Data
- The migration script populates feed_items from existing posts and reposts
- Redis counters will be updated when the migration runs
- No data loss during the transition

### Backward Compatibility
- Existing API endpoints continue to work
- New feed system is additive, not replacing existing functionality
- Gradual migration path available

## Conclusion

The Redis integration ensures that:
- ✅ Feed items are created in real-time as posts/reposts are processed
- ✅ Feed items are deleted when posts/reposts are deleted
- ✅ Redis counters stay synchronized with database state
- ✅ Dashboard metrics include feed item counts
- ✅ Data consistency is maintained across all operations
- ✅ Performance is optimized for feed operations

This completes the integration between the Redis worker system and the new feed items schema, ensuring that all feed-related data is properly synchronized and maintained in real-time.