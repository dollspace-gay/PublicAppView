# Firehose Redis Data Ingestion and Worker Feeding Analysis

## Architecture Overview

### Data Flow
1. **Firehose Ingestion** (Worker 0 only)
   - Connects to `wss://bsky.network` via `@skyware/firehose`
   - Receives 3 event types: commit, identity, account
   - Pushes events to Redis Stream: `firehose:events`
   - Uses cursor persistence for restart recovery

2. **Redis Queue** (All events)
   - Stream key: `firehose:events`
   - Consumer group: `firehose-processors`
   - MAXLEN: ~100,000 events (approximate trimming)
   - Block timeout: 100ms for low latency
   - Batch size: 300 events per read

3. **Worker Processing** (All workers)
   - Each worker runs 5 parallel consumer pipelines
   - Consumes from Redis using XREADGROUP
   - Processes events with `eventProcessor`
   - Acknowledges only after successful processing
   - Auto-claims pending messages every 5 seconds

## Issues Found

### 🔴 CRITICAL: Redis Data Loss Risk

**Issue**: Redis configuration in `docker-compose.yml` line 6:
```yaml
command: redis-server --maxmemory 8gb --maxmemory-policy allkeys-lru --save "" --appendonly no
```

**Problems**:
1. **Memory Eviction**: `allkeys-lru` policy can evict the firehose stream if memory fills up
2. **No Persistence**: `--save ""` and `--appendonly no` means ALL data is lost on Redis restart
3. **Stream Loss**: If stream is evicted or Redis restarts, all pending events are lost

**Impact**: HIGH - Data loss during memory pressure or Redis restarts

**Recommendation**: 
- Change eviction policy to `noeviction` to prevent stream eviction
- Enable AOF persistence: `--appendonly yes --appendfsync everysec`
- Or use `volatile-lru` to only evict keys with TTL (stream has no TTL)

### 🟡 WARNING: Stream Trimming Could Cause Data Loss

**Issue**: `redis-queue.ts` line 142-144:
```typescript
await this.redis.xadd(
  this.STREAM_KEY,
  "MAXLEN", "~", "100000",
  // ...
);
```

**Problem**: If workers fall significantly behind (>100k events), old events are trimmed before processing

**Impact**: MEDIUM - Data loss if workers are slow or crash

**Metrics to Monitor**:
- Queue depth (`queueDepth` in `/api/metrics`)
- If queue depth approaches 100k, workers are falling behind

**Recommendation**: 
- Increase MAXLEN to 500k or 1M for larger buffer
- Add alerting when queue depth > 50k
- Monitor worker processing rate

### 🟡 WARNING: NOGROUP Error Recovery Loses Pending Messages

**Issue**: `redis-queue.ts` lines 207-234:
```typescript
if (isNogroupError) {
  // Recreates stream from "0"
  await this.ensureStreamAndGroup();
}
```

**Problem**: When stream/group is recreated (e.g., after Redis restart), it starts from position "0", losing all previous pending messages

**Impact**: MEDIUM - Pending messages lost on Redis restart or eviction

**Recommendation**: 
- Use Redis persistence (AOF) to prevent this scenario
- Or implement external checkpointing system

### ✅ GOOD: Auto-Claim Mechanism

**Code**: `routes.ts` lines 186-193:
```typescript
if (++iterationCount % 50 === 0) {
  const claimed = await redisQueue.claimPendingMessages(pipelineConsumerId, 10000);
  // ...
}
```

**Analysis**: 
- Claims messages idle for >10 seconds
- Runs every 5 seconds (~50 iterations × 100ms)
- Good for recovering from dead consumers

**Status**: ✅ Working correctly

### ✅ GOOD: Acknowledgment Strategy

**Code**: `routes.ts` lines 162-171:
```typescript
if (success) {
  await redisQueue.ack(event.messageId);
}
```

**Analysis**:
- Only acknowledges after successful processing
- Treats FK violations (23503) and duplicates (23505) as success
- Failed events remain in stream for retry

**Status**: ✅ Working correctly

### ✅ GOOD: Concurrent Processing

**Code**: `routes.ts` lines 139-209:
```typescript
const PARALLEL_PIPELINES = 5;
// 5 consumer pipelines per worker
```

**Analysis**:
- Each worker runs 5 parallel pipelines
- Each pipeline processes batches of 300 events
- Total throughput: Workers × 5 pipelines × batch size

**Status**: ✅ Good for high throughput

## Verification Tests

### 1. Check Redis Stream Status
```bash
# Connect to Redis container
docker exec -it <redis-container> redis-cli

# Check stream length
XLEN firehose:events

# Check consumer group info
XINFO GROUPS firehose:events

# Check pending messages
XPENDING firehose:events firehose-processors
```

### 2. Monitor Queue Depth
```bash
curl http://localhost:5000/api/metrics | jq '.firehoseStatus.queueDepth'
```

**Alert if**: Queue depth > 50,000 (workers falling behind)

### 3. Check Worker Processing
```bash
# Check consumer info
docker exec -it <redis-container> redis-cli XINFO CONSUMERS firehose:events firehose-processors
```

### 4. Verify No NOGROUP Errors
```bash
# Check application logs
docker logs <app-container> 2>&1 | grep NOGROUP
```

**Should see**: No NOGROUP errors (means stream is healthy)

## Recommendations

### Immediate Fixes (CRITICAL)

1. **Fix Redis Configuration** (docker-compose.yml):
```yaml
redis:
  image: redis:7-alpine
  command: redis-server --maxmemory 8gb --maxmemory-policy noeviction --appendonly yes --appendfsync everysec
```

2. **Add Queue Depth Monitoring**:
```typescript
// In routes.ts, add alerting
const queueDepth = await redisQueue.getQueueDepth();
if (queueDepth > 50000) {
  console.error(`[REDIS] ALERT: Queue depth critical: ${queueDepth}`);
  logCollector.error('Redis queue depth critical', { queueDepth });
}
```

### Performance Improvements

1. **Increase Stream Buffer** (redis-queue.ts):
```typescript
"MAXLEN", "~", "500000",  // Increase from 100k to 500k
```

2. **Add Metrics for Worker Lag**:
```typescript
// Track time between event creation and processing
const processingLag = Date.now() - new Date(event.data.createdAt).getTime();
if (processingLag > 60000) { // 1 minute lag
  console.warn(`[REDIS] Processing lag: ${processingLag}ms`);
}
```

## Summary

### What's Working ✅
- Firehose connection and data ingestion to Redis
- Worker consumption with proper acknowledgment
- Concurrent processing with 5 pipelines per worker
- Auto-claim mechanism for dead consumer recovery
- Distributed lock for stream recreation
- Error handling for FK violations and duplicates

### ✅ FIXED - Changes Implemented

1. **✅ Redis Configuration** (`docker-compose.yml`)
   - Changed eviction policy from `allkeys-lru` to `noeviction`
   - Enabled AOF persistence: `--appendonly yes --appendfsync everysec`
   - Added Redis data volume for persistence across restarts
   - **Impact**: Prevents data loss from eviction and Redis restarts

2. **✅ Stream Buffer Size** (`server/services/redis-queue.ts`)
   - Increased MAXLEN from 100,000 to 500,000 events
   - Provides 5x larger buffer for workers to catch up
   - **Impact**: Prevents data loss during temporary worker slowdowns

3. **✅ Queue Depth Monitoring** (`server/routes.ts`)
   - Added monitoring every 10 seconds per pipeline
   - Warning alert at >100k events (20% of buffer)
   - Critical alert at >250k events (50% of buffer)
   - **Impact**: Early warning system for worker performance issues

### Overall Assessment
The architecture is **production-ready** after these fixes. The system now has:
- ✅ No risk of Redis eviction losing stream data
- ✅ Persistence across Redis restarts
- ✅ Larger buffer to handle temporary load spikes
- ✅ Active monitoring and alerting for queue depth
- ✅ Robust error handling and message acknowledgment
- ✅ High throughput with concurrent processing

**All critical issues have been resolved.** The firehose data ingestion and worker feeding pipeline is now properly configured for production use.
