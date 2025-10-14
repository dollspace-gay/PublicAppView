# Post Enrichment and Hydration Fix Summary

## Issues Identified

### 1. Field Name Mismatch: `repostedByDid` vs `userDid`
**Files affected**: 
- `server/services/xrpc-api.ts` (lines 1226, 1264)
- `server/services/hydration.ts` (line 144)

**Problem**: Code was referencing `repost.repostedByDid`, but the database schema uses `repost.userDid`.

**Impact**: Reposts wouldn't display with correct author information, breaking feed enrichment.

**Fix**: Changed all references from `repostedByDid` to `userDid`.

---

### 2. Missing Posts from External Users
**Files affected**:
- `server/storage.ts` (`getAuthorFeed` function, line 682)
- `server/services/xrpc-api.ts` (`getActorLikes` function, line 3847)

**Problem**: When importing a CAR file:
- User's likes reference posts from other users not in the CAR file
- User's reposts reference posts from other users not in the CAR file
- Feed items are created but referenced posts don't exist
- `INNER JOIN` in `getAuthorFeed` filtered out all feed items without existing posts

**Impact**: 
- Zero posts showing in feeds
- Likes page empty
- Error logs showing "Missing posts"

**Fix**:
1. Changed `INNER JOIN` to `LEFT JOIN` in `getAuthorFeed`
2. Filter out feed items where posts don't exist (graceful degradation)
3. Queue missing posts for PDS fetching in `getActorLikes`

---

### 3. Handle.invalid Not Being Resolved
**Files affected**:
- `server/services/repo-backfill.ts` (line 410-412, 527-559)

**Problem**: During CAR file import:
- Users are created with `handle.invalid` as placeholder
- PDS fetching was disabled during bulk import (correct behavior)
- But users were never queued for handle resolution after import completed

**Impact**: All follows and user profiles showed "handle.invalid"

**Fix**: 
1. After processing each repo, queue all users with `handle.invalid` for PDS fetching
2. PDS data fetcher will resolve handles asynchronously (runs every 30 seconds)

---

### 4. Missing userDid in Repost Hydration
**Files affected**:
- `server/services/hydration.ts` (line 144)

**Problem**: `hydrateReposts` method wasn't including `userDid` field in the hydrated result.

**Impact**: Views layer couldn't look up reposter profiles.

**Fix**: Added `userDid: repost.userDid` to the hydrated repost object.

---

## How CAR File Import Now Works

### Phase 1: Extract Referenced Users
- Scan all records to find every DID that's referenced
- Includes post authors, like subjects, repost subjects, follow targets, etc.

### Phase 2: Batch Create Users
- Create minimal user records with `handle.invalid` placeholder
- Fast operation that doesn't block on network calls

### Phase 3: Process Records
- PDS fetching is disabled to avoid overwhelming the system
- Creates posts, likes, reposts, follows, feed items, etc.
- All records are stored but references may point to non-existent data

### Phase 4: Queue for Handle Resolution (NEW)
- After processing completes, queue all `handle.invalid` users for PDS fetching
- PDS data fetcher resolves handles asynchronously
- Fetches complete profile data including avatar, banner, display name

### Phase 5: Async Background Enrichment
- PDS data fetcher runs every 30 seconds
- Resolves handles from DID documents
- Fetches profile data from user's PDS
- Updates user records with real data
- Queues missing posts for fetching

---

## Expected Behavior After Fixes

✅ **Posts Display**: Your posts will now show in feeds (if they exist in database)

✅ **Reposts Display**: Reposts will show with correct reposter information

✅ **Likes Display**: Liked posts that exist will show (external posts queued for fetching)

✅ **Handles Resolution**: All `handle.invalid` users will be queued for resolution
   - Handles should start resolving within 30-60 seconds after import
   - Profile data (avatars, display names) will populate gradually

✅ **Missing External Posts**: Posts from other users will be queued for PDS fetching
   - These will gradually populate as the PDS fetcher runs
   - Feeds will show posts as they become available

---

## Testing the Fix

1. **Restart the application** to load the code changes
2. **Check feed items**: 
   ```sql
   SELECT COUNT(*) FROM feed_items;
   SELECT COUNT(*) FROM posts;
   ```
3. **Check for handle.invalid users**:
   ```sql
   SELECT COUNT(*) FROM users WHERE handle = 'handle.invalid';
   ```
4. **Wait 30-60 seconds** for PDS fetcher to run
5. **Check if handles are resolving**:
   ```sql
   SELECT handle, display_name FROM users WHERE handle != 'handle.invalid' LIMIT 10;
   ```
6. **View your feed** - posts should start appearing

---

## Key Insights from Bluesky AppView Source

After reviewing the official Bluesky AppView implementation:

1. **DataPlane Pattern**: Bluesky uses a DataPlane client that provides proper separation of concerns
2. **Hydration Maps**: Use `HydrationMap<T>` for efficient state management
3. **Graceful Degradation**: Always handle missing data gracefully (LEFT JOIN, null checks)
4. **Async Enrichment**: Don't block on network calls during bulk operations
5. **Field Naming**: Consistent field naming throughout the stack (e.g., `userDid` not `repostedByDid`)

---

## Files Modified

1. `server/services/xrpc-api.ts` - Fixed field references, added PDS queuing
2. `server/services/hydration.ts` - Added userDid to repost hydration
3. `server/storage.ts` - Changed INNER JOIN to LEFT JOIN, filter null posts
4. `server/services/repo-backfill.ts` - Added handle resolution queueing

---

## Next Steps If Issues Persist

1. **Check logs** for PDS fetcher activity:
   ```
   grep "PDS_FETCHER" logs
   ```

2. **Verify PDS fetcher is running**:
   ```
   grep "Processing .* incomplete entries" logs
   ```

3. **Check if users are queued**:
   - Should see: "Queued X users with handle.invalid for PDS fetching"

4. **Verify network connectivity** to PDS servers (bsky.network, user PDSs)

5. **Check database constraints** - ensure no FK constraints are blocking inserts
