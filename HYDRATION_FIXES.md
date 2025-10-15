# Hydration Fixes for Likes and Images

## Issue
Likes and images weren't hydrating properly for clients in the application.

## Root Causes Identified

### 1. Likes Not Hydrating
**Problem**: The `createPostViewerState` method in `server/storage.ts` was using a simple INSERT operation. Due to the unique constraint on `(postUri, viewerDid)`, this would fail when trying to create a viewer state for a post where one already existed (e.g., if a user first bookmarked a post, then liked it).

**Impact**: Likes (and other viewer states) were not being properly stored in the `post_viewer_states` table, causing them to not appear for clients.

### 2. Images Not Hydrating Consistently
**Problem**: In `server/services/xrpc-api.ts`, the `serializePostsEnhanced` method only set the `embed` field on the post view when a `hydratedEmbed` was available from the embed resolver. If the embed resolver didn't process a post's embed, no embed would be included in the response, even though the raw embed data existed in the record.

**Impact**: Images and other embeds would sometimes not appear in the client if the embed resolver didn't process them.

## Fixes Applied

### Fix 1: UPSERT for Post Viewer States
**File**: `server/storage.ts`  
**Method**: `createPostViewerState`

Changed from simple INSERT to UPSERT (INSERT ... ON CONFLICT DO UPDATE):

```typescript
async createPostViewerState(viewerState: InsertPostViewerState): Promise<PostViewerState> {
  // Use upsert to handle cases where viewer state already exists
  const [result] = await this.db
    .insert(postViewerStates)
    .values(viewerState)
    .onConflictDoUpdate({
      target: [postViewerStates.postUri, postViewerStates.viewerDid],
      set: {
        likeUri: viewerState.likeUri !== undefined ? viewerState.likeUri : sql`${postViewerStates.likeUri}`,
        repostUri: viewerState.repostUri !== undefined ? viewerState.repostUri : sql`${postViewerStates.repostUri}`,
        bookmarked: viewerState.bookmarked !== undefined ? viewerState.bookmarked : sql`${postViewerStates.bookmarked}`,
        threadMuted: viewerState.threadMuted !== undefined ? viewerState.threadMuted : sql`${postViewerStates.threadMuted}`,
        replyDisabled: viewerState.replyDisabled !== undefined ? viewerState.replyDisabled : sql`${postViewerStates.replyDisabled}`,
        embeddingDisabled: viewerState.embeddingDisabled !== undefined ? viewerState.embeddingDisabled : sql`${postViewerStates.embeddingDisabled}`,
        pinned: viewerState.pinned !== undefined ? viewerState.pinned : sql`${postViewerStates.pinned}`,
        updatedAt: sql`NOW()`
      }
    })
    .returning();
  return result;
}
```

**Benefits**:
- No more INSERT failures due to unique constraint violations
- Properly merges viewer state updates (e.g., adding a like to a post that's already bookmarked)
- Only updates fields that are provided, preserving existing values for undefined fields

### Fix 2: Fallback for Embed Hydration
**File**: `server/services/xrpc-api.ts`  
**Method**: `serializePostsEnhanced`

Added fallback to use `record.embed` when `hydratedEmbed` is not available:

```typescript
// Set the embed view - prioritize hydratedEmbed, but include record.embed as fallback
if (hydratedEmbed) {
  // Transform relative URLs in embeds to full URIs
  postView.embed = this.transformEmbedUrls(hydratedEmbed, req);
} else if (record.embed) {
  // If no hydratedEmbed but we have a record embed, use that
  // This ensures embeds are always available even if embed resolver didn't process them
  postView.embed = this.transformEmbedUrls(record.embed, req);
}
```

**Benefits**:
- Ensures embeds are always included in the response when they exist
- Provides redundancy in case the embed resolver has issues
- Maintains proper URL transformation for both hydrated and raw embeds

## Testing Recommendations

1. **Test Likes Hydration**:
   - Like a post → verify like appears
   - Unlike and re-like the same post → verify it still works
   - Bookmark a post, then like it → verify both states are preserved
   - Check that like counts are accurate

2. **Test Image Hydration**:
   - Posts with single images → verify images display
   - Posts with multiple images → verify all images display
   - Posts with image embeds in quotes → verify nested images work
   - Check that image URLs are properly formed and accessible

3. **Test Edge Cases**:
   - Concurrent likes from the same user on different posts
   - Rapidly liking and unliking the same post
   - Posts with various embed types (images, external links, videos)
   - Posts from different feeds and timelines

## Related Files
- `server/storage.ts` - Database operations for viewer states
- `server/services/xrpc-api.ts` - API serialization logic
- `server/services/hydration/optimized-hydrator.ts` - Post hydration logic
- `server/services/event-processor.ts` - Event handling that creates viewer states
- `shared/schema.ts` - Database schema including unique constraints
