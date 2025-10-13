# Redis Read-Only Replica Error Fix

## Problem

The application was experiencing frequent errors when consuming events from Redis streams:

```
[REDIS] Error consuming events: ReplyError: READONLY You can't write against a read only replica.
    command: {
        name: 'xreadgroup',
        args: [...]
    }
```

## Root Cause

The `XREADGROUP` command is a **write command** in Redis because it:
- Updates the consumer group's last delivered ID
- Modifies the pending entries list (PEL)
- Tracks message delivery attempts

When the application connects to a Redis **replica** (read-only slave) instead of the **master**, write commands like `XREADGROUP`, `XACK`, `XADD`, etc., will fail with `READONLY` errors.

## Solution

The fix ensures that all Redis connections:

1. **Connect to the master** by specifying `role: 'master'` in connection options
2. **Enable offline queue** to buffer commands during reconnection
3. **Detect and report** when connected to a replica instead of master
4. **Gracefully handle** READONLY errors with clear error messages

### Changes Made

#### 1. Redis Queue Service (`server/services/redis-queue.ts`)
- Added `role: 'master'` to connection options
- Added `verifyMasterConnection()` method to check Redis role on startup
- Enhanced error handling for READONLY errors in `consume()` method
- Updated pub/sub subscriber connection with master role

#### 2. Redis Adapter (`osprey-bridge/firehose-to-kafka/src/adapters/redis-adapter.ts`)
- Added `role: 'master'` to connection options
- Added `verifyMasterConnection()` method
- Enhanced error handling in `consumeEvents()` method
- Added READONLY error detection in error event handler

#### 3. Cache Service (`server/services/cache.ts`)
- Added `role: 'master'` to connection options
- Enhanced error handling for READONLY errors

#### 4. Constellation Integration (`server/services/constellation-integration.ts`)
- Added `role: 'master'` to connection options
- Enhanced error handling for READONLY errors

## Configuration

### Correct Setup

Ensure `REDIS_URL` points to the **master** Redis instance:

```bash
# Good - points to master
REDIS_URL=redis://redis-master:6379

# Bad - points to replica
REDIS_URL=redis://redis-replica:6379
```

### Docker Compose

The docker-compose.yml already correctly points to the master:

```yaml
environment:
  - REDIS_URL=redis://redis:6379  # 'redis' service is the master
```

### Redis Sentinel/Cluster Setup

If using Redis Sentinel or Cluster:

```typescript
// For Sentinel
const redis = new Redis({
  sentinels: [
    { host: 'sentinel1', port: 26379 },
    { host: 'sentinel2', port: 26379 },
  ],
  name: 'mymaster',
  role: 'master', // Always connect to master
});

// For Cluster
const redis = new Redis.Cluster([
  { host: 'cluster1', port: 6379 },
  { host: 'cluster2', port: 6379 },
]);
```

## Verification

On startup, you should see:

```
[REDIS] Connecting to redis://redis:6379...
[REDIS] Connected
[REDIS] Verified connection to master (read-write)
```

If connected to a replica, you'll see warnings:

```
[REDIS] WARNING: Connected to Redis replica (read-only)!
[REDIS] Write operations like XREADGROUP will fail.
[REDIS] Please update REDIS_URL to point to the master Redis instance.
```

## Testing

To verify the fix works:

1. **Start the application** and check logs for master verification
2. **Monitor for READONLY errors** (should be gone)
3. **Check Redis role manually**:
   ```bash
   docker exec -it redis redis-cli INFO replication
   # Should show: role:master
   ```

## Why This Matters

Redis Streams with consumer groups are powerful for distributed message processing, but they require write access because:

- **XREADGROUP**: Updates consumer group state
- **XACK**: Acknowledges messages (removes from PEL)
- **XCLAIM**: Claims pending messages from other consumers
- **XGROUP CREATE**: Creates consumer groups
- **XADD**: Adds events to streams

All these operations modify Redis data structures and **cannot run on read-only replicas**.

## Additional Notes

### ioredis `role` Option

The `role: 'master'` option in ioredis:
- Only applies when using Sentinel configurations
- For standalone Redis, it has no effect but doesn't hurt
- For Cluster mode, master selection is automatic

### Failover Scenarios

With Redis Sentinel:
- When master fails, Sentinel promotes a replica
- ioredis automatically reconnects to the new master
- The `role: 'master'` option ensures we follow the promotion

### Read-Only Operations

If you need read-only operations (for scaling reads), you can create a separate Redis connection with `role: 'slave'` for:
- Cache reads
- Analytics queries
- Monitoring dashboards

But **never** use replica connections for:
- XREADGROUP/XACK (consumer groups)
- Any write operations
- Critical data modifications

## Troubleshooting

### Still Getting READONLY Errors?

1. **Check REDIS_URL**:
   ```bash
   echo $REDIS_URL
   # Should point to master, not replica
   ```

2. **Verify Redis role**:
   ```bash
   redis-cli -h <redis-host> INFO replication | grep role
   # Should show: role:master
   ```

3. **Check network configuration**:
   - Ensure DNS resolves to master
   - Check load balancer settings
   - Verify no proxy routing to replica

4. **Check Redis configuration**:
   ```bash
   redis-cli CONFIG GET replica-read-only
   # If "yes", writes will fail on replicas
   ```

### Emergency Workaround

If you must use a replica temporarily (NOT RECOMMENDED):

```bash
# On the Redis replica
redis-cli CONFIG SET replica-read-only no
```

⚠️ **WARNING**: This breaks replication consistency and should only be used in emergencies.

## References

- [Redis Streams Documentation](https://redis.io/docs/data-types/streams/)
- [ioredis Documentation](https://github.com/redis/ioredis)
- [Redis Replication](https://redis.io/docs/management/replication/)
- [Redis Sentinel](https://redis.io/docs/management/sentinel/)
