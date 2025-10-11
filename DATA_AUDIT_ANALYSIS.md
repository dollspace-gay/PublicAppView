# Data Audit Analysis - Missing Schema Data

## Critical Issues Found

### 1. Missing Post Metadata ✅ PARTIALLY IMPLEMENTED
**Current**: Schema has fields but not fully utilized
**Status**: 
- ✅ `violatesThreadGate`: boolean - Schema exists, used in views
- ✅ `violatesEmbeddingRules`: boolean - Schema exists
- ✅ `hasThreadGate`: boolean - Schema exists  
- ✅ `hasPostGate`: boolean - Schema exists
- ✅ `tags`: Set<string> - Schema exists as JSONB
**Missing**: Full implementation in event processor and XRPC responses

### 2. Missing Post Aggregations ❌ CRITICAL GAP
**Current**: Hardcoded to 0 in most places
**Status**:
- ❌ `replyCount`: number - Schema exists but not populated
- ❌ `repostCount`: number - Schema exists but not populated  
- ❌ `likeCount`: number - Schema exists but not populated
- ❌ `bookmarkCount`: number - Not in schema
- ❌ `quoteCount`: number - Not in schema
**Impact**: All post engagement metrics show 0

### 3. Missing Viewer State ❌ CRITICAL GAP
**Current**: Hardcoded to undefined/empty
**Status**:
- ❌ `like`: string (like URI) - Schema exists but not populated
- ❌ `repost`: string (repost URI) - Schema exists but not populated
- ❌ `bookmarked`: boolean - Schema exists but not populated
- ❌ `threadMuted`: boolean - Schema exists but not populated
- ❌ `replyDisabled`: boolean - Not in schema
- ❌ `embeddingDisabled`: boolean - Not in schema
- ❌ `pinned`: boolean - Not in schema
**Impact**: Users can't see their interaction state with posts

### 4. Missing Author Information ❌ CRITICAL GAP
**Current**: Basic author DID only
**Status**:
- ❌ Author profile data for repost reasons
- ❌ Author profile data for pinned post reasons
- ❌ `reasonRepost` with full author details
- ❌ `reasonPin` implementation
**Impact**: Reposts and pins don't show who performed the action

### 5. Missing Labels ❌ CRITICAL GAP
**Current**: Empty array
**Status**:
- ❌ Content labels from labeler services
- ❌ Label hydration in XRPC responses
- ❌ Label filtering and moderation
**Impact**: No content moderation or labeling

### 6. Missing Thread Context ❌ CRITICAL GAP
**Current**: Not implemented
**Status**:
- ❌ Thread context for replies
- ❌ Root author like status
- ❌ `threadContext` object in responses
- ❌ `replyRef` with proper thread structure
**Impact**: Thread views are incomplete

### 7. Missing List-based Blocking ❌ CRITICAL GAP
**Current**: Not implemented
**Status**:
- ❌ List-based blocking/muting
- ❌ List membership checks
- ❌ `mutedByList` in viewer state
- ❌ `blockingByList` in viewer state
**Impact**: Advanced moderation features unavailable

## Detailed Analysis

### Database Schema Status
✅ **GOOD**: Most required tables exist in schema
- `posts` table has thread gate fields
- `postAggregations` table exists
- `postViewerStates` table exists  
- `threadContexts` table exists
- `labels` table exists
- `listMutes` and `listBlocks` tables exist

❌ **MISSING**: Additional fields needed
- `bookmarkCount` and `quoteCount` in post aggregations
- `replyDisabled`, `embeddingDisabled`, `pinned` in viewer states

### Redis Integration Status
✅ **GOOD**: Redis queue system is comprehensive
- Event processing with Redis streams
- Counter management for dashboard metrics
- Pub/sub for real-time updates

❌ **MISSING**: Specific data hydration
- No caching of post aggregations
- No caching of viewer states
- No label caching system

### XRPC Endpoint Status
✅ **GOOD**: Basic endpoints implemented
- `getAuthorFeed`, `getTimeline`, `getPostThread`, `getProfile`
- Proper authentication and validation

❌ **MISSING**: Data hydration
- Hardcoded engagement counts (0)
- Empty viewer states
- Missing label hydration
- Incomplete thread context

## Required Schema Updates

### 1. Post Aggregations Table Enhancements
```sql
ALTER TABLE post_aggregations ADD COLUMN bookmark_count INTEGER DEFAULT 0;
ALTER TABLE post_aggregations ADD COLUMN quote_count INTEGER DEFAULT 0;
```

### 2. Post Viewer States Table Enhancements  
```sql
ALTER TABLE post_viewer_states ADD COLUMN reply_disabled BOOLEAN DEFAULT FALSE;
ALTER TABLE post_viewer_states ADD COLUMN embedding_disabled BOOLEAN DEFAULT FALSE;
ALTER TABLE post_viewer_states ADD COLUMN pinned BOOLEAN DEFAULT FALSE;
```

## Implementation Recommendations

### Phase 1: Critical Data Hydration (HIGH PRIORITY)

#### 1.1 Post Aggregations Population
**Files to modify**: `server/services/event-processor.ts`, `server/storage.ts`
```typescript
// In processPost method
await this.storage.createPostAggregation({
  postUri: uri,
  likeCount: 0,
  repostCount: 0, 
  replyCount: 0,
  bookmarkCount: 0,
  quoteCount: 0
});

// In processLike method  
await this.storage.incrementPostAggregation(postUri, 'likeCount', 1);
await this.storage.createPostViewerState({
  postUri,
  viewerDid: userDid,
  likeUri: uri
});

// In processRepost method
await this.storage.incrementPostAggregation(postUri, 'repostCount', 1);
await this.storage.createPostViewerState({
  postUri,
  viewerDid: userDid, 
  repostUri: uri
});
```

#### 1.2 XRPC Response Hydration
**Files to modify**: `server/services/xrpc-api.ts`, `server/services/views.ts`
```typescript
// Replace hardcoded 0s with actual data
const aggregations = await storage.getPostAggregations(postUris);
const viewerStates = await storage.getPostViewerStates(postUris, viewerDid);

// In post view creation
replyCount: aggregations.get(post.uri)?.replyCount || 0,
repostCount: aggregations.get(post.uri)?.repostCount || 0,
likeCount: aggregations.get(post.uri)?.likeCount || 0,
bookmarkCount: aggregations.get(post.uri)?.bookmarkCount || 0,
quoteCount: aggregations.get(post.uri)?.quoteCount || 0,
viewer: viewerStates.get(post.uri) || {}
```

#### 1.3 Label Hydration
**Files to modify**: `server/services/label.ts`, `server/services/xrpc-api.ts`
```typescript
// Add label hydration to all post responses
const labels = await labelService.getLabelsForSubjects(postUris);
// Include in post view
labels: labels.get(post.uri) || []
```

### Phase 2: Advanced Features (MEDIUM PRIORITY)

#### 2.1 Thread Context Implementation
**Files to modify**: `server/services/event-processor.ts`, `server/services/views.ts`
```typescript
// Create thread context for replies
if (post.parentUri) {
  await this.storage.createThreadContext({
    postUri: uri,
    rootAuthorLikeUri: await this.getRootAuthorLikeUri(post)
  });
}

// In thread view creation
const threadContext = await storage.getThreadContext(postUri);
threadContext: threadContext ? {
  rootAuthorLike: threadContext.rootAuthorLikeUri
} : undefined
```

#### 2.2 List-based Moderation
**Files to modify**: `server/services/views.ts`
```typescript
// Add list-based muting/blocking to viewer state
const listMutes = await storage.getListMutes(viewerDid);
const listBlocks = await storage.getListBlocks(viewerDid);

viewer: {
  ...viewerState,
  mutedByList: listMutes.get(authorDid) ? {
    $type: 'app.bsky.graph.defs#listViewBasic',
    uri: listMutes.get(authorDid).uri,
    name: listMutes.get(authorDid).name,
    purpose: listMutes.get(authorDid).purpose
  } : undefined,
  blockingByList: listBlocks.get(authorDid) ? {
    $type: 'app.bsky.graph.defs#listViewBasic', 
    uri: listBlocks.get(authorDid).uri,
    name: listBlocks.get(authorDid).name,
    purpose: listBlocks.get(authorDid).purpose
  } : undefined
}
```

### Phase 3: Performance Optimization (LOW PRIORITY)

#### 3.1 Redis Caching Layer
**Files to modify**: `server/services/redis-queue.ts`, `server/services/hydration.ts`
```typescript
// Add caching for frequently accessed data
class PostAggregationCache {
  async get(postUris: string[]): Promise<Map<string, PostAggregation>> {
    // Check Redis cache first
    // Fall back to database
    // Cache results
  }
}

class ViewerStateCache {
  async get(postUris: string[], viewerDid: string): Promise<Map<string, PostViewerState>> {
    // Similar caching pattern
  }
}
```

#### 3.2 Batch Operations
**Files to modify**: `server/services/storage.ts`
```typescript
// Optimize database queries with batch operations
async getPostAggregationsBatch(postUris: string[]): Promise<Map<string, PostAggregation>> {
  // Single query for all post aggregations
}

async getPostViewerStatesBatch(postUris: string[], viewerDid: string): Promise<Map<string, PostViewerState>> {
  // Single query for all viewer states
}
```

## Required XRPC Endpoint Updates

### 1. getAuthorFeed
- Hydrate post aggregations
- Hydrate viewer states
- Hydrate labels
- Hydrate thread contexts

### 2. getTimeline
- Same as getAuthorFeed

### 3. getPostThread
- Hydrate thread context
- Hydrate reply aggregations

### 4. getProfile
- Include pinned post information
- Include aggregations

## Required Redis Updates

### 1. Counter Management
- Add post aggregations counters
- Add viewer state counters
- Add label counters

### 2. Caching
- Cache post aggregations
- Cache viewer states
- Cache labels

## Summary

### Current Status
✅ **Database Schema**: 95% complete - most tables exist
✅ **Redis Integration**: 90% complete - comprehensive queue system
✅ **XRPC Endpoints**: 80% complete - basic functionality works
❌ **Data Hydration**: 20% complete - most data hardcoded to 0/empty

### Critical Gaps Identified
1. **Post Aggregations**: Schema exists but not populated (all show 0)
2. **Viewer States**: Schema exists but not populated (all empty)
3. **Label System**: Schema exists but not integrated with XRPC responses
4. **Thread Context**: Schema exists but not implemented
5. **List-based Moderation**: Schema exists but not used in viewer states

### Impact Assessment
- **User Experience**: Severely degraded - no engagement metrics, no interaction state
- **Moderation**: Non-functional - no labels, no list-based blocking
- **Threading**: Incomplete - missing context and proper reply structure
- **Performance**: Suboptimal - no caching, inefficient queries

## Next Steps

### Immediate Actions (Week 1) ✅ COMPLETED
1. ✅ **Implement post aggregations population** in event processor
2. ✅ **Add viewer state hydration** to XRPC responses  
3. ✅ **Create missing storage methods** for batch operations
4. ✅ **Test with real data** to verify functionality

#### Phase 1 Implementation Summary ✅
**Files Modified:**
- `server/storage.ts` - Added post aggregations, viewer states, and thread context methods
- `server/services/event-processor.ts` - Updated to create aggregations and viewer states
- `server/services/xrpc-api.ts` - Updated serializePosts to use real data
- `server/services/views.ts` - Updated to use aggregations and viewer states
- `server/types/feed.ts` - Updated HydrationState interface

**Key Features Implemented:**
- ✅ Post aggregations (likeCount, repostCount, replyCount, bookmarkCount, quoteCount)
- ✅ Viewer states (like, repost, bookmarked, threadMuted)
- ✅ Thread contexts (rootAuthorLikeUri)
- ✅ Real-time aggregation updates on like/repost/reply
- ✅ Proper cleanup on unlike/unrepost
- ✅ Batch operations for performance
- ✅ Redis counter integration

### Short Term (Week 2-3) ✅ COMPLETED
1. ✅ **Implement label hydration** system
2. ✅ **Add thread context** creation and retrieval
3. ✅ **Integrate list-based moderation** into viewer states
4. ✅ **Add Redis caching** for performance

#### Phase 2 Implementation Summary ✅
**Files Modified:**
- `server/services/cache.ts` - New Redis caching service
- `server/storage.ts` - Added list-based moderation methods and caching
- `server/services/xrpc-api.ts` - Enhanced with label hydration and list moderation
- `server/services/views.ts` - Updated reason objects and thread context
- `server/services/event-processor.ts` - Enhanced thread context creation

**Key Features Implemented:**
- ✅ Label hydration system for content moderation
- ✅ List-based blocking/muting in viewer states
- ✅ Enhanced thread context with root author like tracking
- ✅ Reason objects (reasonRepost, reasonPin) with author info
- ✅ Redis caching for performance optimization
- ✅ Batch operations for list moderation
- ✅ Comprehensive error handling and fallbacks

### Medium Term (Month 1-2)
1. **Performance optimization** with batch queries
2. **Advanced moderation features** implementation
3. **Comprehensive testing** and validation
4. **Documentation updates** for new features

### Success Metrics
- [ ] All post engagement metrics show real data (not 0)
- [ ] User interaction states are properly displayed
- [ ] Content labels appear in responses
- [ ] Thread views show proper context
- [ ] List-based moderation works
- [ ] Performance meets AT Protocol standards