# Actor Preferences Caching Implementation

## Overview

The `app.bsky.actor.getPreferences` endpoint has been corrected to implement proper caching as described in the AT Protocol principles. This implementation follows the pattern where the AppView acts as a cache manager for read operations while maintaining data sovereignty by storing preferences on the user's PDS.

## Changes Made

### 1. Updated `getPreferences` Method

**Before:**
- Always returned empty preferences array
- No authentication
- No PDS communication
- No caching

**After:**
- Requires authentication via `requireAuthDid()`
- Implements cache-first pattern
- Falls back to PDS on cache miss
- Stores results in cache for future requests

### 2. Added Caching Infrastructure

**Cache Properties:**
- `preferencesCache`: Map storing user preferences with timestamps
- `PREFERENCES_CACHE_TTL`: 5-minute cache expiration
- Automatic cache cleanup every minute

**Cache Methods:**
- `isPreferencesCacheExpired()`: Checks if cache entry is expired
- `cleanExpiredPreferencesCache()`: Removes expired entries
- `invalidatePreferencesCache()`: Manually invalidates cache for a user
- `getUserSessionForDid()`: Gets user session for PDS communication

### 3. Updated `putPreferences` Method

**Added:**
- Cache invalidation after successful preference updates
- Ensures cache consistency when preferences change

## Implementation Details

### Cache-First Pattern

```typescript
async getPreferences(req: Request, res: Response) {
  // 1. Authenticate user
  const userDid = await this.requireAuthDid(req, res);
  if (!userDid) return;

  // 2. Check cache first
  const cached = this.preferencesCache.get(userDid);
  if (cached && !this.isPreferencesCacheExpired(cached)) {
    return res.json({ preferences: cached.preferences });
  }

  // 3. Cache miss - fetch from PDS
  const session = await this.getUserSessionForDid(userDid);
  const pdsResponse = await pdsClient.proxyXRPC(/* ... */);

  // 4. Store in cache and return
  if (pdsResponse.status === 200) {
    this.preferencesCache.set(userDid, {
      preferences: pdsResponse.body.preferences,
      timestamp: Date.now()
    });
  }

  return res.status(pdsResponse.status).send(pdsResponse.body);
}
```

### Cache Management

- **TTL**: 5 minutes (configurable via `PREFERENCES_CACHE_TTL`)
- **Cleanup**: Automatic cleanup every minute
- **Invalidation**: Manual invalidation on preference updates
- **Memory**: Uses Map for O(1) lookups

## Benefits

1. **Performance**: Cache hits avoid PDS round-trips
2. **Efficiency**: Reduces load on PDS servers
3. **Consistency**: Cache invalidation ensures data freshness
4. **AT Protocol Compliance**: Maintains data sovereignty principle
5. **User Experience**: Faster feed generation with cached preferences

## Testing

The implementation can be tested using the existing test scripts:

```bash
# Test getPreferences (requires authentication)
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/xrpc/app.bsky.actor.getPreferences

# Test putPreferences (invalidates cache)
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"preferences": [...]}' \
  http://localhost:3000/xrpc/app.bsky.actor.putPreferences
```

## Compliance Verification

✅ **Authentication**: Requires valid user authentication  
✅ **Cache-First**: Checks cache before contacting PDS  
✅ **PDS Fallback**: Contacts PDS on cache miss  
✅ **Cache Storage**: Stores results for future requests  
✅ **Cache Invalidation**: Invalidates cache on updates  
✅ **Data Sovereignty**: PDS remains authoritative source  
✅ **Performance**: Reduces PDS load through caching  

The implementation now fully complies with the AT Protocol principle where AppViews act as authenticated proxies and cache managers for user preferences.