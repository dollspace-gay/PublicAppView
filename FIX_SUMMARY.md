# Fix Summary: Event Overload Issue

## Problem Identified

Your server was being overwhelmed by firehose events with these symptoms:
- Hundreds of "timeout exceeded when trying to connect" errors
- "user not ready" warnings filling logs
- Events being dropped or skipped
- System becoming unresponsive

## Root Cause

The bottleneck was **user creation concurrency**, which was hardcoded to only 10 concurrent operations. When the firehose brought in hundreds of events per second, each requiring user records to exist, the system couldn't keep up:

1. Events require users to exist in the database
2. Only 10 users could be created at once
3. Queue backed up with 100+ users waiting
4. Database connection pool exhausted
5. 30-second timeout triggered
6. Events dropped with errors

## Changes Made

### 1. Made User Creation Concurrency Configurable

**File**: `server/services/event-processor.ts`

- Changed from hardcoded `10` to configurable `MAX_CONCURRENT_USER_CREATIONS`
- New default: `50` (5x increase)
- Can be adjusted via environment variable

### 2. Added Backpressure Protection

- Added 30-second timeout for user creation queue
- Prevents indefinite waiting that could deadlock the system
- Events are dropped cleanly if queue is too backed up

### 3. Added Monitoring Metrics

- `maxConcurrentUserCreations` - Current limit
- `userCreationUtilization` - Percentage of capacity used (e.g., "75%")
- `activeUserCreations` - Currently active operations
- `pendingUserCreationDeduplication` - Deduplicated pending requests

### 4. Updated Configuration Files

- `.env.example` - Added `MAX_CONCURRENT_USER_CREATIONS=50`
- `docker-compose.yml` - Set to `100` for production
- `Dockerfile` - Set to `50` for default builds
- `README.md` - Documented the new variable

### 5. Created Performance Tuning Guide

**New file**: `PERFORMANCE_TUNING.md`

Comprehensive guide covering:
- How to diagnose bottlenecks
- Configuration strategies for different server sizes
- Monitoring commands
- Troubleshooting steps

## Immediate Fix for Your Server

### Option 1: Quick Fix (Environment Variable)

Add this to your `.env` file or docker-compose environment:

```bash
MAX_CONCURRENT_USER_CREATIONS=100
```

Then restart:
```bash
docker-compose restart app
# or
pm2 restart all
```

### Option 2: Optimal Configuration

Based on your docker-compose.yml showing `DB_POOL_SIZE=200`, use these settings:

```bash
# In your .env or docker-compose.yml
DB_POOL_SIZE=200
MAX_CONCURRENT_OPS=150
MAX_CONCURRENT_USER_CREATIONS=140
```

This allows:
- 200 database connections
- 150 concurrent event operations
- 140 concurrent user creations (70% of pool size)
- 60 connections for other operations (queries, etc.)

## How to Verify the Fix

### 1. Check Logs

After restart, you should see:
- Fewer "timeout exceeded" errors
- Fewer "user not ready" warnings
- More "Created 5000 users" batch logs

### 2. Monitor Metrics

Access the dashboard metrics:

```bash
# Check current utilization
curl http://localhost:5000/api/metrics/event-processor | jq '{
  active: .activeUserCreations,
  max: .maxConcurrentUserCreations,
  utilization: .userCreationUtilization,
  queued: .pendingUserCreationOpsCount
}'
```

**Healthy output**:
```json
{
  "active": 45,
  "max": 100,
  "utilization": "45%",
  "queued": 0
}
```

**Unhealthy output** (needs tuning):
```json
{
  "active": 100,
  "max": 100,
  "utilization": "100%",
  "queued": 523
}
```

### 3. Watch Real-Time

```bash
watch -n 2 'curl -s http://localhost:5000/api/metrics/event-processor | jq "{active: .activeUserCreations, max: .maxConcurrentUserCreations, util: .userCreationUtilization, queued: .pendingUserCreationOpsCount}"'
```

## Expected Improvements

| Metric | Before (10 limit) | After (100 limit) |
|--------|------------------|-------------------|
| User creation capacity | 10/sec | 100/sec |
| Events processed | ~50/sec | ~500/sec |
| Timeout errors | Hundreds/min | Few/hour |
| "User not ready" warnings | Constant | Rare |
| System responsiveness | Sluggish | Smooth |

## If Issues Persist

### 1. Database is the bottleneck

**Symptoms**: Database CPU at 100%, slow queries

**Solution**:
```bash
# Check database indexes
npm run db:push

# Check active connections
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"

# If Neon free tier, upgrade to pro for more connections
```

### 2. Memory is the bottleneck

**Symptoms**: Out of memory errors, system swap usage

**Solution**:
```bash
# Reduce concurrency
MAX_CONCURRENT_OPS=80
MAX_CONCURRENT_USER_CREATIONS=50

# Increase Node.js heap size
NODE_OPTIONS="--max-old-space-size=4096"
```

### 3. Still overwhelmed

**Symptoms**: Queue depth keeps growing, events still timing out

**Solution**:
```bash
# Further increase limits if resources allow
DB_POOL_SIZE=300
MAX_CONCURRENT_USER_CREATIONS=200
MAX_CONCURRENT_OPS=200

# Or consider splitting the workload across multiple instances
```

## Monitoring Dashboard

Access your dashboard at `http://your-server:5000` and check:

1. **System Health** tab - Overall system status
2. **Event Processor** metrics - User creation queue depth
3. **Database** tab - Connection pool usage
4. **Logs** tab - Real-time error monitoring

## Additional Tuning

See the comprehensive [PERFORMANCE_TUNING.md](./PERFORMANCE_TUNING.md) guide for:
- Detailed configuration strategies
- Server size recommendations
- Monitoring best practices
- Troubleshooting steps

## Files Modified

1. `server/services/event-processor.ts` - Core fix
2. `.env.example` - Configuration template
3. `docker-compose.yml` - Docker defaults
4. `Dockerfile` - Build defaults
5. `README.md` - Documentation
6. `PERFORMANCE_TUNING.md` - New tuning guide (this was created)

## Rollback Plan

If you need to rollback, the previous hardcoded value was 10:

```typescript
// Old code:
private readonly MAX_CONCURRENT_USER_CREATIONS = 10;

// New code (can set via env):
private readonly MAX_CONCURRENT_USER_CREATIONS = parseInt(process.env.MAX_CONCURRENT_USER_CREATIONS || '50');
```

To get the old behavior (not recommended):
```bash
MAX_CONCURRENT_USER_CREATIONS=10
```

## Questions?

- Check [PERFORMANCE_TUNING.md](./PERFORMANCE_TUNING.md) for detailed guidance
- Monitor metrics at `/api/metrics/event-processor`
- Check logs for remaining errors
- Adjust settings gradually based on your traffic patterns
