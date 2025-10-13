# Python Firehose Fix - Records Showing as "unknown"

## Problem

After switching to the Python firehose, all records were being processed as "unknown" generic records instead of their proper types (posts, likes, reposts, etc.). The logs showed:

```
[EVENT_PROCESSOR] Generic record processed: unknown - at://did:plc:.../app.bsky.feed.post/...
[EVENT_PROCESSOR] Generic record processed: unknown - at://did:plc:.../app.bsky.feed.like/...
```

## Root Cause

The Python firehose consumer was extracting records from CAR blocks but not including the critical `$type` field that the TypeScript event processor uses to identify record types. When the Python atproto SDK's model objects are serialized with `model_dump()` or `dict()`, the `$type` field is not automatically included - it must be explicitly added from the model's `py_type` attribute.

## Issues Fixed

### 1. Missing `$type` Field (Critical)
**Problem:** Records were being serialized without the `$type` field
**Impact:** All records were processed as "unknown" generic records
**Fix:** Explicitly add `record_data["$type"] = record.py_type` after serialization

### 2. Missing Record Validation
**Problem:** Ops could be sent without records when CAR parsing failed
**Impact:** TypeScript event processor would crash on `record.$type` access
**Fix:** Skip ops that don't have complete record data (validation added)

### 3. Incomplete Error Handling
**Problem:** Silent failures when record extraction failed
**Impact:** Malformed data could slip through
**Fix:** Added comprehensive error handling with debug logging for each failure case

## Changes Made

The Python firehose consumer now:

1. **Validates** that create/update actions have CIDs before processing
2. **Checks** that CAR blocks are available before attempting extraction
3. **Verifies** that records can be parsed successfully
4. **Ensures** the `$type` field is always present in serialized records
5. **Skips** malformed ops instead of sending incomplete data
6. **Logs** debug messages for each skip case (visible with `LOG_LEVEL=DEBUG`)

## Data Format Verification

Verified that Python firehose output now matches TypeScript firehose format:

### Commit Events
```json
{
  "type": "commit",
  "data": {
    "repo": "did:plc:...",
    "ops": [{
      "action": "create",
      "path": "app.bsky.feed.post/...",
      "cid": "bafyrei...",
      "record": {
        "$type": "app.bsky.feed.post",  // ✓ NOW INCLUDED
        "text": "...",
        "createdAt": "..."
      }
    }]
  },
  "seq": "12345"
}
```

### Identity Events
```json
{
  "type": "identity",
  "data": {
    "did": "did:plc:...",
    "handle": "user.bsky.social"
  }
}
```

### Account Events
```json
{
  "type": "account",
  "data": {
    "did": "did:plc:...",
    "active": true
  }
}
```

## Testing

After deploying the fix:

1. Restart the Python firehose container:
   ```bash
   docker-compose restart python-firehose
   ```

2. Monitor logs to verify proper record types:
   ```bash
   docker-compose logs -f app
   ```

3. Expected output:
   - Posts: `[EVENT_PROCESSOR] Created post: at://...`
   - Likes: `[EVENT_PROCESSOR] Created like: at://...`
   - Reposts: `[EVENT_PROCESSOR] Created repost: at://...`
   - etc.

4. No more "unknown" generic record logs (except for truly unknown record types)

## Debug Mode

To see detailed information about skipped ops:

```bash
# In docker-compose.yml
services:
  python-firehose:
    environment:
      - LOG_LEVEL=DEBUG
```

This will show messages like:
- "Skipping create op - no CAR blocks: ..."
- "Skipping create op - could not parse record: ..."
- "Skipping create op - no $type available: ..."

## Performance Impact

The fix adds validation and error handling but should have minimal performance impact:
- Operations are still processed in parallel
- Only malformed/incomplete data is filtered out
- Debug logging is minimal at INFO level
- CAR block parsing is unchanged

## Summary

The Python firehose now correctly includes the `$type` field in all records and properly validates data before sending to Redis. This ensures the TypeScript event processor can correctly identify and process all record types (posts, likes, reposts, follows, etc.) instead of treating them as unknown generic records.
