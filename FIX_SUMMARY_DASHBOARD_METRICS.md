# Dashboard Metrics Fix for Python Firehose System

## Problem
Events Processed and Firehose Status were not displaying correctly on the App View Dashboard when using the new Python firehose system.

## Root Cause

### Events Processed - NOT WORKING ❌
**Redis Key Mismatch:**
- **Python Worker** wrote metrics to: `"firehose:metrics"`
- **TypeScript Dashboard** read metrics from: `"cluster:metrics"`

The Python worker was incrementing the wrong Redis hash key, so the dashboard never saw the updated metrics.

### Firehose Status - ALREADY WORKING ✅
**Keys Matched:**
- **Python Firehose** wrote status to: `"firehose:status"`
- **TypeScript Dashboard** read status from: `"firehose:status"`

The firehose status implementation was already correct and should have been working.

## Solution

### File Modified: `python-firehose/redis_consumer_worker.py`

**Changed line 966-967:**
```python
# BEFORE (INCORRECT):
self.metrics_key = "firehose:metrics"

# AFTER (CORRECT):
# CRITICAL: Must use same key as TypeScript ("cluster:metrics", not "firehose:metrics")
self.metrics_key = "cluster:metrics"
```

## How It Works

### Architecture Flow
```
AT Protocol Firehose (wss://bsky.network)
       ↓
Python Firehose Consumer (firehose_consumer.py)
  - Pushes events to Redis Stream: "firehose:events"
  - Updates status in Redis: "firehose:status" (TTL 10s, updated every 5s)
       ↓
Redis Streams (firehose:events)
       ↓
Python Redis Consumer Worker (redis_consumer_worker.py)
  - Reads from Redis Stream
  - Processes events to PostgreSQL
  - Increments metrics in Redis: "cluster:metrics" ✅ FIXED
       ↓
PostgreSQL Database
       ↑
TypeScript Dashboard API (/api/metrics)
  - Reads metrics from Redis: "cluster:metrics" ✅ MATCHES
  - Reads status from Redis: "firehose:status" ✅ MATCHES
       ↓
React Dashboard UI
  - Displays Events Processed (from cluster:metrics)
  - Displays Firehose Status (from firehose:status)
  - Displays Event Counts (#commit, #identity, #account)
```

### Redis Keys Used

#### Metrics (Hash) - `cluster:metrics`
**Fields:**
- `totalEvents`: Total events processed across all workers
- `#commit`: Number of commit events (posts, likes, follows, etc.)
- `#identity`: Number of identity events (handle changes)
- `#account`: Number of account events (active/inactive)
- `errors`: Number of processing errors

**Updated by:**
- Python worker: Increments after each successfully processed event (buffered, flushed every 500ms)

**Read by:**
- `/api/metrics` endpoint → Dashboard UI

#### Firehose Status (String with JSON) - `firehose:status`
**Format:**
```json
{
  "connected": boolean,
  "url": string,
  "currentCursor": string | null
}
```

**TTL:** 10 seconds (refreshed every 5 seconds by Python firehose consumer)

**Updated by:**
- Python firehose consumer: Updates when connected/disconnected and every 5 seconds

**Read by:**
- `/api/metrics` endpoint → Dashboard UI

## What Changed

### Python Worker (`redis_consumer_worker.py`)
1. Changed `self.metrics_key` from `"firehose:metrics"` to `"cluster:metrics"`
2. Added comment explaining the critical importance of key name matching

### No Changes Needed
- ✅ Python firehose consumer (already using correct key for status)
- ✅ TypeScript dashboard (already reading from correct keys)
- ✅ Dashboard UI components (already correctly displaying data)

## Testing

### Verify Events Processed
```bash
# Check Redis metrics (should increment as events are processed)
docker-compose exec redis redis-cli HGETALL cluster:metrics

# Expected output:
# 1) "totalEvents"
# 2) "12345"
# 3) "#commit"
# 4) "10000"
# 5) "#identity"
# 6) "2000"
# 7) "#account"
# 8) "345"
# 9) "errors"
# 10) "0"
```

### Verify Firehose Status
```bash
# Check Redis status (should show connected: true)
docker-compose exec redis redis-cli GET firehose:status

# Expected output:
# {"connected":true,"url":"wss://bsky.network","currentCursor":"123456789"}
```

### Verify Dashboard Display
1. Open the dashboard at `http://localhost:5002`
2. Check the "Events Processed" card - should show incrementing count ✅
3. Check the "Firehose Status" section:
   - Connection status: "Connected" with green pulsing dot ✅
   - Event counts (#commit, #identity, #account): should increment ✅
   - Error rate: should be low ✅

## Performance Impact

**None** - This is just a configuration fix (Redis key name). No algorithmic or architectural changes.

The Python worker was already:
- Buffering metrics in memory
- Flushing to Redis every 500ms via pipeline
- Using the same pattern as TypeScript implementation

## Deployment

### Option 1: Restart Python Worker (Recommended)
```bash
# Restart the Python worker container
docker-compose restart python-worker
```

### Option 2: Full System Restart
```bash
# Restart all services
docker-compose down
docker-compose up -d
```

After restart, metrics should immediately start appearing in the dashboard as events are processed.

## Compatibility

✅ **Fully compatible** with existing infrastructure:
- TypeScript implementation unchanged
- Redis architecture unchanged  
- Dashboard UI unchanged
- Multi-worker deployments supported
- Horizontal scaling supported

## Summary

This was a simple but critical bug - a Redis key name mismatch between Python and TypeScript components. The fix was a one-line change to use the correct key name. The dashboard should now correctly display:

1. ✅ **Events Processed** - Total events processed by Python worker
2. ✅ **Firehose Status** - Connection state from Python firehose consumer
3. ✅ **Event Counts** - Breakdown by event type (#commit, #identity, #account)
4. ✅ **Error Tracking** - Processing errors count

All metrics are now consistent across the cluster and visible in the dashboard in real-time.
