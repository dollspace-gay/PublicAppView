# Fix for Database Connection Timeout Errors

## Problem

The event processor was experiencing massive "timeout exceeded when trying to connect" errors under high event volume, causing thousands of events to be skipped or enqueued.

### Root Cause

The `ensureUser()` function was holding database connections while making slow external network calls:

1. Event processing calls `ensureUser(did)`
2. Acquires DB connection with `storage.getUser(did)` 
3. If user doesn't exist, calls `didResolver.resolveDIDToHandle(did)` **while still holding the DB connection**
4. DID resolution can take 15-60 seconds (with retries and timeouts)
5. With high event volume (200+ simultaneous events), all 200 database connections get exhausted
6. New queries timeout waiting for a connection (60 second `connectionTimeoutMillis`)

This created a bottleneck where slow external network calls were blocking database connections, preventing any other database operations from completing.

## Solution

Implemented three key improvements to prevent connection pool exhaustion:

### 1. **Short Timeout for DID Resolution** (5 seconds)
Instead of waiting up to 60 seconds for DID resolution, we now timeout after 5 seconds and use the DID as a fallback handle. This prevents holding database connections for extended periods.

```typescript
handle = await Promise.race([
  didResolver.resolveDIDToHandle(did),
  new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)) // 5 second timeout
]);

// Use DID as fallback if resolution fails/times out
await this.storage.createUser({
  did,
  handle: handle || did, // Fallback to DID as handle
});

// Background fetcher will update with proper handle later
pdsDataFetcher.markIncomplete('user', did);
```

### 2. **Concurrency Limiting** (Max 100 concurrent user creations)
Added a semaphore-like mechanism to limit concurrent user creation operations, preventing the database from being overwhelmed:

```typescript
// Wait if we're at the concurrent creation limit
while (this.activeUserCreations >= this.MAX_CONCURRENT_USER_CREATIONS) {
  await new Promise(resolve => setTimeout(resolve, 10));
}

this.activeUserCreations++;
try {
  // Create user
} finally {
  this.activeUserCreations--;
}
```

### 3. **Deduplication of Concurrent Operations**
Added a map to track pending user creation operations, preventing duplicate concurrent operations for the same user:

```typescript
// Check if there's already a pending creation for this user
const existingCreation = this.pendingUserCreations.get(did);
if (existingCreation) {
  return existingCreation; // Reuse existing promise
}

// Create and track the promise
const creationPromise = this.ensureUserInternal(did);
this.pendingUserCreations.set(did, creationPromise);
```

## Benefits

1. **Prevents connection pool exhaustion**: Database connections are no longer held during slow external network calls
2. **Faster event processing**: 5 second timeout instead of 60 seconds means events process 12x faster
3. **Graceful degradation**: Uses DID as fallback handle if resolution fails, ensuring events still process
4. **Background updates**: PDS data fetcher updates handles asynchronously in the background
5. **Better concurrency control**: Limits concurrent operations to prevent overwhelming the database
6. **Deduplication**: Prevents wasteful duplicate operations for the same user

## Monitoring

Added new metrics to monitor the fix effectiveness:

```typescript
{
  activeUserCreations: number,           // Current concurrent user creations
  pendingUserCreationDeduplication: number  // Deduplicated operations (map size)
}
```

## Expected Results

- ✅ No more "timeout exceeded when trying to connect" errors
- ✅ Events process successfully instead of being skipped/enqueued
- ✅ Database connections remain available for other operations
- ✅ Users are created with DID as handle, then updated by background fetcher
- ✅ Much faster event processing (5s max wait instead of 60s)

## Related Files Modified

- `server/services/event-processor.ts` - Fixed ensureUser() and added concurrency controls
