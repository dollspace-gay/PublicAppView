# Image Loading Fix - CDN to PDS Fallback

## Issue Summary
Clients using the appview were experiencing 404 errors when loading images with hex-encoded CIDs:
```
01551220031e6d44e13ee3e0f44859c9a14da0740980bcf228da685d6bfb526fdb1e805d@jpeg - Failed to load resource: the server responded with a status of 404 (Not Found)
```

Additionally, there was a JavaScript error:
```
Uncaught TypeError: Cannot read properties of undefined (reading 'reply')
```

## Root Cause

### Image Loading Issue
The appview's image proxy endpoint (`/img/:preset/plain/:did/:cidWithFormat`) was **only** trying to fetch images from Bluesky's CDN (`cdn.bsky.app`). However:

1. **Not all images are on the CDN**: Some images are only available on the user's Personal Data Server (PDS)
2. **CDN propagation delay**: Newly uploaded images may not have propagated to the CDN yet
3. **CDN coverage**: Some smaller or newer instances may not have all their content on the CDN

When the CDN returned a 404, the proxy immediately failed without attempting to fetch from the source PDS.

### Reply Hydration Error
This error was already fixed in a previous commit. The `replyRef()` method in `server/services/views.ts` now checks if both root and parent posts are successfully loaded before returning the reply object, preventing undefined access errors.

## Solution Implemented

### PDS Fallback for Image Loading

Modified the image proxy endpoint in `server/routes.ts` to implement a two-tier fallback mechanism:

1. **Primary (Fast Path)**: Try fetching from Bluesky CDN first
   - Fast response times for cached content
   - Low latency for frequently accessed images
   
2. **Fallback (PDS Path)**: If CDN returns 404, fetch from user's PDS
   - Resolve the DID to find the user's PDS endpoint
   - Fetch the blob using `com.atproto.sync.getBlob` XRPC method
   - Return the image from the PDS

### Code Changes

```typescript
// Try fetching from Bluesky CDN first (fast path)
let response = await safeFetch(cdnUrl, { ... });

// If CDN returns 404, fallback to fetching from user's PDS
if (!response.ok && response.status === 404) {
  console.log(`[BLOB_PROXY] CDN returned 404, trying PDS fallback for ${did}`);
  
  // Resolve DID to PDS endpoint
  const pdsEndpoint = await didResolver.resolveDIDToPDS(did);
  
  if (pdsEndpoint) {
    // Build safe URL to fetch blob from PDS
    const blobUrl = buildSafeBlobUrl(pdsEndpoint, did, cid);
    
    if (blobUrl && isUrlSafeToFetch(blobUrl)) {
      const pdsResponse = await safeFetch(blobUrl, { ... });
      
      if (pdsResponse.ok) {
        response = pdsResponse;
      }
    }
  }
}
```

## Benefits

1. **Improved Reliability**: Images load successfully even when not cached on CDN
2. **Better User Experience**: No broken images for users on smaller PDS instances
3. **Graceful Degradation**: Fast CDN path used when available, PDS fallback when needed
4. **Security Maintained**: All URLs validated through existing security checks (`isUrlSafeToFetch`, `isValidDID`, `isValidCID`)

## Performance Considerations

- **CDN Hit**: ~50-200ms (fast path, most common)
- **PDS Fallback**: ~200-1000ms (slower but ensures image loads)
- **Caching**: Both CDN and PDS responses cached with `max-age=31536000` (1 year)

The performance impact is minimal since:
1. Most images will be on CDN (fast path)
2. PDS fallback only happens on first request
3. After first successful fetch, the image is cached by the client

## Testing

To test the fix, try accessing an image that's not on the CDN:

```bash
# This should now work even if the image isn't on cdn.bsky.app
curl -I "http://localhost:5000/img/avatar/plain/did:plc:abc123/01551220...@jpeg"
```

Expected behavior:
1. First attempt: Fetch from CDN (may 404)
2. If 404: Log "CDN returned 404, trying PDS fallback"
3. Resolve DID to PDS
4. Fetch from PDS
5. Return image successfully

## Related Issues Fixed

The "Cannot read properties of undefined (reading 'reply')" error was already fixed in `server/services/views.ts` (lines 88-94). The code now validates that both root and parent posts are loaded before returning the reply reference.

## Future Improvements

Consider:
1. **Caching PDS-fetched images**: Store images fetched from PDS in local cache or upload to CDN
2. **Parallel fetching**: Try both CDN and PDS simultaneously and return whichever responds first
3. **Metrics**: Track CDN hit rate vs PDS fallback rate for monitoring
4. **Proactive CDN population**: Background job to ensure all images are uploaded to CDN

## Files Modified

- `server/routes.ts` (lines 315-420): Added PDS fallback logic to image proxy endpoint

## Security Notes

The implementation maintains all existing security measures:
- DID validation via `isValidDID()`
- CID validation via `isValidCID()` (supports hex-encoded CIDs)
- URL safety checks via `isUrlSafeToFetch()`
- Safe URL construction via `buildSafeBlobUrl()`
- SSRF protection through validated fetch wrapper `safeFetch()`
