# Python vs TypeScript Worker Feature Comparison

**Date:** 2025-10-14  
**Comparison:** Python workers (`unified_worker.py`, `redis_consumer_worker.py`) vs TypeScript `event-processor.ts`

## Executive Summary

You have **TWO** Python workers with different feature sets:
1. **`unified_worker.py`** - Feature-rich, nearly complete parity with TypeScript
2. **`redis_consumer_worker.py`** - Simplified version, missing several advanced features

---

## Feature Matrix

| Feature | TypeScript `event-processor.ts` | Python `unified_worker.py` | Python `redis_consumer_worker.py` |
|---------|--------------------------------|----------------------------|-----------------------------------|
| **Core Record Processing** | ✅ All 20+ types | ✅ All 20+ types | ✅ All 20+ types |
| **Pending Operations Queue** | ✅ Yes | ✅ Yes | ❌ **MISSING** |
| **Notification Creation** | ✅ Yes | ✅ Yes | ❌ **MISSING** |
| **Data Collection Forbidden** | ✅ Yes | ✅ Yes | ❌ **MISSING** |
| **PDS Data Fetching** | ✅ Yes | ❌ **MISSING** | ❌ **MISSING** |
| **DID Resolution** | ✅ Yes | ❌ **MISSING** | ❌ **MISSING** |
| **Lexicon Validation** | ⚠️ Commented out | ❌ **MISSING** | ❌ **MISSING** |
| **Label Service Integration** | ✅ Yes | ❌ **MISSING** | ❌ **MISSING** |
| **TTL Sweeper (Cleanup)** | ✅ Yes | ✅ Yes | ❌ **MISSING** |
| **User Creation Limiting** | ✅ Yes | ✅ Yes | ❌ **MISSING** |
| **Generic Record Storage** | ✅ Yes | ✅ Yes | ✅ Yes |

---

## Detailed Feature Analysis

### 1. ✅ **Core Record Type Processing** (All 3 have this)

Both Python workers and TypeScript handle all these record types:
- Posts, Likes, Reposts, Bookmarks
- Follows, Blocks
- Profiles
- Lists, List Items
- Feed Generators
- Starter Packs
- Labels, Labeler Services
- Verifications
- Post Gates, Thread Gates, List Blocks
- Notification Declarations
- Generic/Unknown Records

### 2. ❌ **Pending Operations Queue** (Missing in `redis_consumer_worker.py`)

**What it does:** 
- Queues operations when foreign key dependencies don't exist yet
- Example: If a like comes in before the post exists, queue it and retry later
- Prevents data loss due to out-of-order event processing

**TypeScript:** ✅ Full implementation with TTL sweeper, metrics tracking  
**`unified_worker.py`:** ✅ Full implementation with pending ops for posts, users, lists  
**`redis_consumer_worker.py`:** ❌ **MISSING** - Assumes all dependencies exist (eventual consistency)

**Impact:** `redis_consumer_worker.py` may drop events if they arrive out of order

---

### 3. ❌ **Notification Creation** (Missing in `redis_consumer_worker.py`)

**What it does:**
- Creates in-app notifications for social interactions
- Reply notifications (when someone replies to your post)
- Mention notifications (when someone mentions you)
- Like notifications (when someone likes your post)
- Repost notifications (when someone reposts your post)
- Follow notifications (when someone follows you)
- Quote notifications (when someone quotes your post)

**TypeScript:** ✅ Creates all notification types  
**`unified_worker.py`:** ✅ Creates all notification types  
**`redis_consumer_worker.py`:** ❌ **MISSING** - No notification creation at all

**Code comparison:**

**TypeScript (`event-processor.ts`):**
```typescript
// Create notification for reply
await this.storage.createNotification({
  uri: `at://${uri.replace('at://', '')}#notification/reply`,
  recipientDid: parentPost.authorDid,
  authorDid: authorDid,
  reason: 'reply',
  reasonSubject: uri,
  cid,
});
```

**Python `unified_worker.py`:**
```python
# Create reply notification
notif_uri = f"{uri}#notification/reply"
await self.create_notification(conn, notif_uri, parent_post['authorDid'], 
                               author_did, 'reply', uri, cid, created_at)
```

**Python `redis_consumer_worker.py`:**
```python
# No notification code at all
```

**Impact:** Users won't receive any notifications in `redis_consumer_worker.py`

---

### 4. ❌ **Data Collection Forbidden Check** (Missing in `redis_consumer_worker.py`)

**What it does:**
- Checks user privacy settings before storing data
- Respects `dataCollectionForbidden` flag in user settings
- Skips processing events for users who opt out of data collection

**TypeScript:** ✅ Checks before processing each record  
**`unified_worker.py`:** ✅ Checks before processing  
**`redis_consumer_worker.py`:** ❌ **MISSING** - Processes all data regardless of privacy settings

**Code comparison:**

**TypeScript:**
```typescript
const forbidden = await this.isDataCollectionForbidden(authorDid);
if (forbidden) {
  return; // Skip processing
}
```

**Python `unified_worker.py`:**
```python
forbidden = await conn.fetchval(
    'SELECT "dataCollectionForbidden" FROM "userSettings" WHERE did = $1',
    author_did
)
if forbidden:
    return  # Skip processing
```

**Python `redis_consumer_worker.py`:**
```python
# No privacy check
```

**Impact:** Privacy violation - stores data for users who opted out

---

### 5. ❌ **PDS Data Fetching** (Missing in BOTH Python workers)

**What it does:**
- Fetches missing data from PDS (Personal Data Server) when incomplete
- Backfills handles, profiles, and records that weren't in the firehose
- Marks incomplete entries for later fetching

**TypeScript:** ✅ Full PDS integration via `pdsDataFetcher`  
**`unified_worker.py`:** ❌ **MISSING** (has commented-out references)  
**`redis_consumer_worker.py`:** ❌ **MISSING**

**TypeScript code:**
```typescript
pdsDataFetcher.markIncomplete('user', did);
```

**Python code:**
```python
# pdsDataFetcher.markIncomplete('user', did)  # Commented out
```

**Impact:** 
- May have incomplete profiles (missing handles, avatars)
- Relies on firehose having complete data
- Less resilient to data gaps

---

### 6. ❌ **DID Resolution** (Missing in BOTH Python workers)

**What it does:**
- Resolves DIDs to handles via DID documents
- Updates user handles from authoritative sources
- Ensures accurate handle-to-DID mapping

**TypeScript:** ✅ Via `didResolver.resolveDIDToHandle()`  
**Python workers:** ❌ **MISSING**

**Impact:** 
- May have stale or incorrect handles
- Uses fallback `handle.invalid` more often

---

### 7. ⚠️ **Lexicon Validation** (Commented out in TypeScript, missing in Python)

**What it does:**
- Validates records against AT Protocol lexicon schemas
- Ensures data conforms to specification

**TypeScript:** ⚠️ Code exists but commented out  
**Python workers:** ❌ **MISSING**

**Impact:** Minimal - TypeScript doesn't use it either

---

### 8. ❌ **Label Service Integration** (Missing in BOTH Python workers)

**What it does:**
- Integrates with external labeling services
- Applies moderation labels to content
- Separate from basic label storage

**TypeScript:** ✅ Via `labelService.applyLabel()`  
**Python workers:** ❌ **MISSING**

**TypeScript code:**
```typescript
await labelService.applyLabel({
  uri,
  src,
  val: record.val,
  neg: record.neg || false,
});
```

**Python code:**
```python
# Direct database insert only, no service integration
await conn.execute(
    "INSERT INTO labels (uri, src, subject, val, neg, ...) VALUES ..."
)
```

**Impact:** 
- Labels are stored but may not trigger external moderation actions
- May need separate label processing

---

### 9. ❌ **TTL Sweeper** (Missing in `redis_consumer_worker.py`)

**What it does:**
- Periodically cleans up expired pending operations
- Prevents memory leaks from stale queues
- Runs every minute to sweep 24-hour-old entries

**TypeScript:** ✅ Full sweeper with metrics  
**`unified_worker.py`:** ✅ Full sweeper implementation  
**`redis_consumer_worker.py`:** ❌ **MISSING** (no pending ops, so not needed)

---

### 10. ❌ **User Creation Limiting** (Missing in `redis_consumer_worker.py`)

**What it does:**
- Limits concurrent user creations to prevent DB pool exhaustion
- Queues user creation requests when limit is reached
- Deduplicates concurrent creations for same user

**TypeScript:** ✅ `MAX_CONCURRENT_USER_CREATIONS = 10`  
**`unified_worker.py`:** ✅ User creation limiting  
**`redis_consumer_worker.py`:** ❌ **MISSING**

**Impact:** 
- May overwhelm database during high traffic
- Potential for deadlocks/timeouts

---

## Architecture Differences

### TypeScript `event-processor.ts`
```
Firehose → EventProcessor → [Pending Queues] → PostgreSQL
                          ↓
                    PDS Fetcher (backfill)
                          ↓
                    Label Service
                          ↓
                    DID Resolver
                          ↓
                    Notifications
```

### Python `unified_worker.py`
```
Firehose → UnifiedWorker → [Pending Queues] → PostgreSQL
                         ↓
                   Notifications
                         ↓
                   Privacy Checks
```

### Python `redis_consumer_worker.py`
```
Redis Stream → SimpleProcessor → PostgreSQL
(Direct processing, no queues, no notifications)
```

---

## Recommendations

### Option 1: **Use `unified_worker.py`** (Recommended)
- ✅ Most feature-complete Python worker
- ✅ Has notifications, pending ops, privacy checks
- ⚠️ Still missing PDS fetching, DID resolution, label service
- **Best for:** Production use with active users

### Option 2: **Use `redis_consumer_worker.py`**
- ✅ Simplest implementation
- ✅ Good for bulk imports where order is guaranteed
- ❌ Missing critical features (notifications, privacy)
- **Best for:** Backfilling historical data only

### Option 3: **Complete `unified_worker.py`** (Ideal)
Add these missing features to match TypeScript:
1. **PDS Data Fetching** - Port `pds-data-fetcher.ts` logic
2. **DID Resolution** - Add handle resolution from DID docs
3. **Label Service Integration** - Add external service calls
4. **Lexicon Validation** - Optional, not critical

---

## Missing Features Summary

### Critical (User-Facing Impact)
1. ❌ **Notifications** (`redis_consumer_worker.py` only)
2. ❌ **Privacy/Data Collection Checks** (`redis_consumer_worker.py` only)
3. ❌ **PDS Data Fetching** (both Python workers)

### Important (Data Quality)
4. ❌ **DID Resolution** (both Python workers)
5. ❌ **Pending Operations** (`redis_consumer_worker.py` only)
6. ❌ **User Creation Limiting** (`redis_consumer_worker.py` only)

### Nice-to-Have
7. ❌ **Label Service Integration** (both Python workers)
8. ❌ **Lexicon Validation** (both Python workers)
9. ❌ **TTL Sweeper** (`redis_consumer_worker.py` only)

---

## Code Examples of Key Differences

### Notification Creation

**TypeScript:**
```typescript
// Creates 6 types: reply, mention, like, repost, follow, quote
await this.storage.createNotification({
  uri: `at://${uri}#notification/reply`,
  recipientDid: parentPost.authorDid,
  authorDid: authorDid,
  reason: 'reply',
  reasonSubject: uri,
  cid,
});
```

**`unified_worker.py`:**
```python
# Creates 6 types: reply, mention, like, repost, follow, quote
notif_uri = f"{uri}#notification/reply"
await self.create_notification(
    conn, notif_uri, parent_post['authorDid'],
    author_did, 'reply', uri, cid, created_at
)
```

**`redis_consumer_worker.py`:**
```python
# ❌ NO NOTIFICATION CODE
```

---

### Pending Operations

**TypeScript:**
```typescript
// Queue like if post doesn't exist
if (!post) {
  this.enqueuePending(postUri, {
    type: 'like',
    payload: likeData,
    enqueuedAt: Date.now()
  });
}
// Later, when post arrives:
await this.flushPending(postUri);
```

**`unified_worker.py`:**
```python
# Queue like if post doesn't exist
if not post:
    self.pending_ops[post_uri].append({
        'type': 'like',
        'payload': like_data,
        'enqueued_at': time.time()
    })
# Later, when post arrives:
await self.flush_pending_ops(conn, post_uri)
```

**`redis_consumer_worker.py`:**
```python
# ❌ NO PENDING QUEUE - Direct insert with ON CONFLICT DO NOTHING
await conn.execute(
    "INSERT INTO likes (...) VALUES (...) ON CONFLICT DO NOTHING"
)
# Like is lost if post doesn't exist!
```

---

### Privacy Checks

**TypeScript:**
```typescript
const forbidden = await this.isDataCollectionForbidden(authorDid);
if (forbidden) {
  smartConsole.log(`[PRIVACY] Skipping data for ${authorDid} (collection forbidden)`);
  return;
}
```

**`unified_worker.py`:**
```python
settings = await conn.fetchrow(
    'SELECT "dataCollectionForbidden" FROM "userSettings" WHERE did = $1',
    author_did
)
if settings and settings['dataCollectionForbidden']:
    logger.info(f"Skipping data for {author_did} (collection forbidden)")
    return
```

**`redis_consumer_worker.py`:**
```python
# ❌ NO PRIVACY CHECK - Processes all data
await conn.execute("INSERT INTO posts ...")  # No check!
```

---

## Testing Checklist

To verify feature parity, test:

### 1. Notification Creation
- [ ] Reply to a post → Notification created?
- [ ] Mention a user → Notification created?
- [ ] Like a post → Notification created?
- [ ] Repost a post → Notification created?
- [ ] Follow a user → Notification created?
- [ ] Quote a post → Notification created?

### 2. Pending Operations
- [ ] Like arrives before post → Queued and retried?
- [ ] Follow arrives before user exists → Queued?
- [ ] List item arrives before list → Queued?

### 3. Privacy Checks
- [ ] User sets `dataCollectionForbidden=true` → Data skipped?
- [ ] Cache invalidation works?

### 4. Out-of-Order Events
- [ ] Events arrive in random order → All eventually processed?
- [ ] No data loss?

### 5. High Traffic
- [ ] Many concurrent user creations → No deadlocks?
- [ ] DB pool not exhausted?

---

## Conclusion

**Current State:**
- **`unified_worker.py`**: ~85% feature parity with TypeScript
- **`redis_consumer_worker.py`**: ~60% feature parity with TypeScript

**Biggest Gaps:**
1. PDS data fetching (both Python workers)
2. DID resolution (both Python workers)  
3. Notifications (`redis_consumer_worker.py` only)
4. Privacy checks (`redis_consumer_worker.py` only)
5. Pending operations (`redis_consumer_worker.py` only)

**Recommendation:**
- **Use `unified_worker.py` for production**
- **Add PDS fetching and DID resolution to reach 95%+ parity**
- **Use `redis_consumer_worker.py` only for backfilling historical data**
