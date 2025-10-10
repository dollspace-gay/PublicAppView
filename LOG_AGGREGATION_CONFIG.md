# Log Aggregation Configuration

This project now includes log aggregation to reduce log spam from event processing and DID resolution operations.

## Environment Variables

You can configure the log aggregation behavior using these environment variables:

```bash
# Enable/disable log aggregation (default: true)
LOG_AGGREGATION_ENABLED=true

# How often to flush aggregated logs in milliseconds (default: 10000 = 10 seconds)
LOG_AGGREGATION_INTERVAL=10000

# Maximum number of aggregated log entries to keep in memory (default: 1000)
LOG_AGGREGATION_MAX_LOGS=1000
```

## How It Works

The log aggregation system:

1. **Identifies spammy log patterns** - Automatically detects repetitive logs from:
   - Event processor operations (flushing, skipping, creating users, etc.)
   - DID resolver operations (timeouts, retries, network errors, etc.)

2. **Groups similar messages** - Logs with similar patterns are grouped together and counted

3. **Flushes periodically** - Every 10 seconds (configurable), aggregated logs are output with counts

4. **Preserves important logs** - Non-spammy logs (like server startup, critical errors) are output immediately

## Example Output

**Before aggregation:**
```
[EVENT_PROCESSOR] Flushing 3 pending operations for at://did:plc:abc123/app.bsky.feed.post/xyz1
[EVENT_PROCESSOR] Flushing 2 pending operations for at://did:plc:def456/app.bsky.feed.post/xyz2
[EVENT_PROCESSOR] Flushing 4 pending operations for at://did:plc:ghi789/app.bsky.feed.post/xyz3
[DID_RESOLVER] Timeout on attempt 2, retrying in 2000ms
[DID_RESOLVER] Timeout on attempt 2, retrying in 2000ms
[DID_RESOLVER] Timeout on attempt 2, retrying in 2000ms
```

**After aggregation:**
```
[LOG_AGGREGATOR] Flushing 2 aggregated log entries:
[AGGREGATED] [EVENT_PROCESSOR] Flushing 1 pending operations for at://did:plc:test123/app.bsky.feed.post/abc0 (3x over 10s)
[AGGREGATED] [DID_RESOLVER] Timeout on attempt 2, retrying in 2000ms (3x over 10s)
```

## Files Modified

- `server/services/log-aggregator.ts` - Core aggregation logic
- `server/services/console-wrapper.ts` - Smart console wrapper
- `server/services/event-processor.ts` - Updated to use aggregated logging
- `server/services/did-resolver.ts` - Updated to use aggregated logging

## Benefits

- **Reduced log volume** - Spammy logs are aggregated and shown with counts
- **Better readability** - Important logs stand out, repetitive logs are summarized
- **Configurable** - Can be disabled or tuned via environment variables
- **Performance** - Reduces I/O overhead from excessive logging
- **Monitoring friendly** - Easier to spot real issues vs. normal operation noise