# Third-Party Client Authentication Fix

## Problem

Third-party clients using AT Protocol access tokens could not authenticate with the appview. They would receive authentication errors when trying to access protected XRPC endpoints, even though the same tokens worked with the first-party API.

## Root Cause

The XRPC proxy middleware (`/workspace/server/middleware/xrpc-proxy.ts`) only handled local session tokens (HS256) and did not support AT Protocol access tokens (ES256/ES256K) from third-party clients.

### The Issue Flow:
1. Third-party client sends request with `Authorization: Bearer <at-protocol-token>`
2. XRPC proxy middleware extracts token via `authService.extractToken()`
3. Middleware tries to verify as local session token with `authService.verifySessionToken()`
4. **FAILS** because AT Protocol tokens use different algorithms and structure
5. Request falls through without authentication, causing 401 errors

## Solution

Updated the XRPC proxy middleware to use the unified `authService.verifyToken()` method, which handles both token types:

### Key Changes:

1. **Unified Token Verification**: Now uses `authService.verifyToken()` instead of just `authService.verifySessionToken()`

2. **Dual Authentication Paths**:
   - **Local Session Tokens**: Validates session, refreshes PDS token if needed, proxies with session's PDS token
   - **AT Protocol Access Tokens**: Verifies token cryptographically, resolves PDS endpoint, proxies with original token

3. **PDS Endpoint Resolution**: For AT Protocol tokens, resolves the user's PDS endpoint from their DID

### Code Changes:

```typescript
// Before: Only handled local session tokens
const sessionPayload = authService.verifySessionToken(appViewToken);
if (!sessionPayload) {
  return next(); // Failed for AT Protocol tokens
}

// After: Handles both token types
const authPayload = await authService.verifyToken(token);
if (!authPayload?.did) {
  return next();
}

// Handle different token types
if (authPayload.sessionId) {
  // Local session token path
} else {
  // AT Protocol access token path
}
```

## Testing

Use the provided test script to verify the fix:

```bash
# Set environment variables
export APPVIEW_URL="http://localhost:5000"
export TEST_HANDLE="your-handle.bsky.social"
export TEST_PASSWORD="your-password"

# Run the test
node test-third-party-auth.js
```

## Compatibility

This fix maintains full backward compatibility:
- ✅ Local web UI sessions continue to work
- ✅ First-party API access continues to work  
- ✅ Third-party clients can now authenticate
- ✅ No breaking changes to existing functionality

## Files Modified

- `/workspace/server/middleware/xrpc-proxy.ts` - Updated to handle both token types
- `/workspace/test-third-party-auth.js` - Added test script for verification

## Verification

The fix can be verified by:

1. **Third-party client login**: Using `BskyAgent` from `@atproto/api` to login
2. **Authenticated API calls**: Accessing protected endpoints like timeline, profile, etc.
3. **Token forwarding**: Ensuring AT Protocol tokens are properly forwarded to PDS
4. **Backward compatibility**: Ensuring local sessions still work

This resolves the core issue where third-party clients could not authenticate with the appview while maintaining full compatibility with existing functionality.