## XRPC Utilities

This directory contains utility modules extracted from the monolithic `xrpc-api.ts` file, organized by functional domain.

## Modules

### Cache Management (`cache.ts`)
Manages caching for preferences and handle resolution with TTL-based expiration.

**Key Features:**
- Preferences cache (5 minute TTL)
- Handle resolution cache (10 minute TTL)
- Automatic cache cleanup
- Cache invalidation

**Exports:**
- `CacheManager` - Cache manager class
- `cacheManager` - Singleton instance

**Usage:**
```typescript
import { cacheManager } from './xrpc/utils';

// Get cached preferences
const prefs = cacheManager.getPreferences(userDid);

// Cache handle resolution
cacheManager.cacheHandleResolution(handle, did);

// Invalidate cache
cacheManager.invalidatePreferencesCache(userDid);
```

### Resolvers (`resolvers.ts`)
Handles DID resolution, actor resolution, and PDS endpoint discovery.

**Key Features:**
- DID document resolution via PLC directory
- Actor identifier (handle/DID) resolution
- PDS endpoint discovery with SSRF protection
- Automatic handle-to-DID caching

**Exports:**
- `resolveDidDocument(did)` - Resolve DID to DID document
- `getUserPdsEndpoint(userDid)` - Get PDS endpoint for a user
- `resolveActor(res, actor)` - Resolve actor identifier to DID

**Usage:**
```typescript
import { resolveActor, getUserPdsEndpoint } from './xrpc/utils';

// Resolve actor (handle or DID) to DID
const did = await resolveActor(res, 'alice.bsky.social');

// Get PDS endpoint
const pdsUrl = await getUserPdsEndpoint(userDid);
```

### Authentication Helpers (`auth-helpers.ts`)
Handles authentication, token verification, and session management.

**Key Features:**
- JWT token extraction and verification
- DID extraction from authenticated requests
- Session management
- Audience and scope validation

**Exports:**
- `getUserSessionForDid(userDid)` - Get valid session for user
- `getAuthenticatedDid(req)` - Extract DID from request (returns null if not authenticated)
- `requireAuthDid(req, res)` - Require authentication (sends 401 if missing)

**Usage:**
```typescript
import { getAuthenticatedDid, requireAuthDid } from './xrpc/utils';

// Optional authentication
const viewerDid = await getAuthenticatedDid(req);

// Required authentication
const userDid = await requireAuthDid(req, res);
if (!userDid) return; // 401 already sent
```

### Error Handling (`error-handler.ts`)
Centralized error handling for XRPC API endpoints.

**Key Features:**
- Zod validation error handling
- Network/fetch error detection
- Upstream service failure handling
- Appropriate HTTP status codes

**Exports:**
- `handleError(res, error, context)` - Handle errors with appropriate responses

**Usage:**
```typescript
import { handleError } from './xrpc/utils';

try {
  // ... endpoint logic
} catch (error) {
  handleError(res, error, 'getTimeline');
}
```

### Serializers (`serializers.ts`)
Handles post serialization, URL transformation, and CDN URL generation.

**Key Features:**
- Enhanced post serialization with hydration
- Blob CID to CDN URL transformation
- Embed URL transformation
- Avatar/banner helpers
- Author viewer state creation

**Exports:**
- `getBaseUrl(req)` - Get base URL from request
- `cidFromBlobJson(json)` - Extract CID from blob JSON
- `transformBlobToCdnUrl(cid, did, format, req)` - Transform blob to CDN URL
- `directCidToCdnUrl(cid, did, format, req)` - Alias for transformBlobToCdnUrl
- `transformEmbedUrls(embed, req)` - Transform embed URLs
- `maybeAvatar(cid, did, req)` - Conditionally include avatar
- `maybeBanner(cid, did, req)` - Conditionally include banner
- `createAuthorViewerState(did, mutes, blocks, data)` - Create viewer state
- `serializePostsEnhanced(posts, viewerDid, req)` - Serialize posts with hydration

**Usage:**
```typescript
import { transformBlobToCdnUrl, serializePostsEnhanced } from './xrpc/utils';

// Transform blob to CDN URL
const avatarUrl = transformBlobToCdnUrl(avatarCid, userDid, 'avatar', req);

// Serialize posts
const serializedPosts = await serializePostsEnhanced(posts, viewerDid, req);
```

## Organization Benefits

### Before Phase 2
```
xrpc-api.ts (4,734 lines)
├── Lines 403-753: Private helper methods (all mixed together)
└── Lines 754-4734: Public endpoint methods
```

### After Phase 2
```
xrpc/utils/
├── cache.ts (140 lines) - Cache management
├── resolvers.ts (110 lines) - DID/actor resolution
├── auth-helpers.ts (130 lines) - Authentication
├── error-handler.ts (55 lines) - Error handling
├── serializers.ts (500+ lines) - Serialization
├── index.ts (30 lines) - Central exports
└── README.md - Documentation
```

## Migration Status

✅ **Phase 2 Complete**: All private utility methods extracted
- Total utilities: ~26 private methods
- Organized into 5 utility modules
- Centralized export via index.ts
- Full documentation

## Type Safety

All utility modules use proper TypeScript types where possible:
- `Request` and `Response` types from Express
- Generic `unknown` types for dynamic data (safer than `any`)
- Proper type guards and narrowing
- Clear function signatures

## Testing Strategy

Each utility module can be tested independently:
1. **Cache**: Test TTL, expiration, invalidation
2. **Resolvers**: Test DID resolution, handle lookup, SSRF protection
3. **Auth**: Test token verification, audience validation
4. **Error Handler**: Test error type detection, status codes
5. **Serializers**: Test URL transformation, post serialization

## Next Steps

These utilities are now ready to be imported by:
- Service modules (Phase 3)
- Other parts of the codebase that need these utilities
- The main `xrpc-api.ts` file (when we create the facade)
