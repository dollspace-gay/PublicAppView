# Performance Tuning Guide

This guide explains how to tune your AT Protocol AppView instance for optimal performance based on your server resources and traffic patterns.

## Understanding the Bottleneck

When your server logs show many "timeout exceeded when trying to connect" or "user not ready" errors, it indicates that the event processing pipeline is overwhelmed. The primary bottleneck is typically **user creation**.

### Why User Creation Matters

Every event from the firehose (likes, posts, follows, reposts, etc.) requires that the user who performed the action exists in your database. When a new user appears in the firehose for the first time, the system must:

1. Check if the user exists (database query)
2. If not, create a new user record (database insert)
3. Queue the user for profile data fetching (handle, avatar, banner)

During high traffic, hundreds or thousands of new users can appear simultaneously, overwhelming the system.

## Key Configuration Variables

### 1. `DB_POOL_SIZE` - Database Connection Pool

**Purpose**: Controls how many simultaneous connections to PostgreSQL are allowed.

**Default**: `32`  
**Docker-compose**: `200`  
**Recommended**: 50-200 depending on your database server capacity

```bash
# For small instances (1-2 GB RAM)
DB_POOL_SIZE=50

# For medium instances (4-8 GB RAM)
DB_POOL_SIZE=100

# For large instances (16+ GB RAM)
DB_POOL_SIZE=200
```

**Important**: Your PostgreSQL server must support this many connections. Check your database's `max_connections` setting:

```sql
SHOW max_connections;
```

For Neon databases:
- Free tier: ~10 connections
- Pro tier: ~100-300 connections

### 2. `MAX_CONCURRENT_OPS` - Event Processing Concurrency

**Purpose**: Controls how many events can be processed simultaneously.

**Default**: `80`  
**Docker-compose**: `100`  
**Recommended**: 80-150 depending on memory and CPU

```bash
# For 2 GB RAM
MAX_CONCURRENT_OPS=80

# For 4 GB RAM
MAX_CONCURRENT_OPS=120

# For 8+ GB RAM
MAX_CONCURRENT_OPS=150
```

**Memory impact**: Each concurrent operation uses ~10-20 MB of memory during processing.

### 3. `MAX_CONCURRENT_USER_CREATIONS` - User Creation Concurrency

**Purpose**: Controls how many users can be created simultaneously. This is the **most critical setting** for preventing overload.

**Default**: `50` (previously hardcoded to 10)  
**Docker-compose**: `100`  
**Recommended**: 50-70% of `DB_POOL_SIZE`

```bash
# For DB_POOL_SIZE=50
MAX_CONCURRENT_USER_CREATIONS=35

# For DB_POOL_SIZE=100
MAX_CONCURRENT_USER_CREATIONS=70

# For DB_POOL_SIZE=200
MAX_CONCURRENT_USER_CREATIONS=140
```

**Why this matters**: User creation is the most common database operation during firehose processing. If this limit is too low, events pile up waiting for user creation to complete, eventually exhausting the connection pool and causing timeouts.

## Tuning Strategy

### Step 1: Start Conservative

Use these settings for initial deployment:

```bash
DB_POOL_SIZE=50
MAX_CONCURRENT_OPS=80
MAX_CONCURRENT_USER_CREATIONS=35
```

### Step 2: Monitor Metrics

Access the dashboard at `http://your-server:5000` and check:

1. **Event Processor Metrics** (`/api/metrics/event-processor`):
   - `activeUserCreations` - Currently creating users
   - `maxConcurrentUserCreations` - Maximum allowed
   - `userCreationUtilization` - Percentage of capacity used
   - `pendingUserCreationOpsCount` - Queued operations waiting for user creation

2. **Database Health** (`/api/metrics/database`):
   - Active connections
   - Idle connections
   - Pool utilization

3. **Firehose Metrics**:
   - Queue depth (should stay < 1000)
   - Processing rate (events/second)

### Step 3: Identify Bottlenecks

**If you see:**
- `userCreationUtilization` consistently at 95-100%
- `pendingUserCreationOpsCount` growing
- Many "user not ready" warnings in logs

**Then**: Increase `MAX_CONCURRENT_USER_CREATIONS`

**If you see:**
- Database connection pool exhausted errors
- "timeout exceeded when trying to connect" errors
- Database server CPU at 100%

**Then**: 
1. First, check if `MAX_CONCURRENT_USER_CREATIONS` is set too high
2. If not, increase `DB_POOL_SIZE` (if your database supports it)
3. Consider optimizing database indexes

**If you see:**
- High memory usage (> 80%)
- Out of memory errors
- Queue depth growing rapidly (> 5000)

**Then**: Decrease `MAX_CONCURRENT_OPS`

### Step 4: Scale Gradually

Increase settings by 20-30% at a time and monitor for 15-30 minutes:

```bash
# Starting configuration
DB_POOL_SIZE=50
MAX_CONCURRENT_USER_CREATIONS=35

# After monitoring shows 95%+ utilization, increase by 30%
MAX_CONCURRENT_USER_CREATIONS=45

# Monitor for 15-30 minutes, repeat if needed
MAX_CONCURRENT_USER_CREATIONS=60

# Eventually increase pool size if needed
DB_POOL_SIZE=75
MAX_CONCURRENT_USER_CREATIONS=50
```

## Common Scenarios

### Scenario 1: "Overwhelmed by Events"

**Symptoms**: Logs filled with timeout errors, events piling up

**Solution**:
```bash
# Increase user creation capacity significantly
DB_POOL_SIZE=150
MAX_CONCURRENT_USER_CREATIONS=100
MAX_CONCURRENT_OPS=120
```

### Scenario 2: "Running on Small VPS (2 GB RAM)"

**Symptoms**: Out of memory errors, system swap usage high

**Solution**:
```bash
# Reduce concurrency to match available memory
DB_POOL_SIZE=30
MAX_CONCURRENT_OPS=50
MAX_CONCURRENT_USER_CREATIONS=20
```

### Scenario 3: "Neon Free Tier Database"

**Symptoms**: Database connection errors, "too many connections"

**Solution**:
```bash
# Keep pool small for free tier limits
DB_POOL_SIZE=8
MAX_CONCURRENT_OPS=50
MAX_CONCURRENT_USER_CREATIONS=5
```

### Scenario 4: "Powerful Dedicated Server (16+ GB RAM)"

**Symptoms**: Resources underutilized, want maximum throughput

**Solution**:
```bash
# Max out concurrency for high throughput
DB_POOL_SIZE=250
MAX_CONCURRENT_OPS=200
MAX_CONCURRENT_USER_CREATIONS=175
```

## Understanding the New Changes (v2.0)

### What Changed?

Previously, `MAX_CONCURRENT_USER_CREATIONS` was hardcoded to 10, creating a severe bottleneck. Now it's configurable and defaults to 50.

### Why 10 Was Too Low

With only 10 concurrent user creations allowed:
- High-traffic events could bring in 100+ new users per second
- Each user creation takes ~100-500ms (database insert + queuing for profile fetch)
- Queue would back up with 90+ users waiting
- Eventually, the 30-second timeout would trigger
- Events would be dropped with "user not ready" errors

### How 50+ Helps

With 50+ concurrent user creations:
- Can handle 100-200 new users per second
- Queue rarely backs up during normal traffic
- 30-second timeout rarely triggers
- System remains responsive during traffic spikes

### Migration Path

If you're upgrading from an older version:

1. Add `MAX_CONCURRENT_USER_CREATIONS=50` to your `.env` file
2. Restart the server
3. Monitor the dashboard for 15-30 minutes
4. Adjust based on your traffic and resources

## Monitoring Commands

### Check current configuration:
```bash
curl http://localhost:5000/api/metrics/event-processor | jq '.maxConcurrentUserCreations'
```

### Check utilization:
```bash
curl http://localhost:5000/api/metrics/event-processor | jq '.userCreationUtilization'
```

### Check queue depth:
```bash
curl http://localhost:5000/api/metrics/event-processor | jq '.pendingUserCreationOpsCount'
```

### Watch in real-time:
```bash
watch -n 2 'curl -s http://localhost:5000/api/metrics/event-processor | jq "{active: .activeUserCreations, max: .maxConcurrentUserCreations, util: .userCreationUtilization, queued: .pendingUserCreationOpsCount}"'
```

## Troubleshooting

### Problem: Still seeing timeout errors after increasing limits

**Check**:
1. Is your database server CPU/memory maxed out?
2. Are database indexes up to date? Run: `npm run db:push`
3. Is your network connection to the database stable?
4. Are you running on a free-tier database with connection limits?

### Problem: Memory usage keeps growing

**Check**:
1. Is `MAX_CONCURRENT_OPS` too high for available RAM?
2. Are you running other services on the same server?
3. Node.js heap size: Set `NODE_OPTIONS="--max-old-space-size=4096"` for 4 GB

### Problem: Database connection pool exhausted

**Check**:
1. Is `MAX_CONCURRENT_USER_CREATIONS` + other operations exceeding `DB_POOL_SIZE`?
2. Set `MAX_CONCURRENT_USER_CREATIONS` to 60-70% of `DB_POOL_SIZE`
3. Are there long-running queries? Check `SELECT * FROM pg_stat_activity;`

## Best Practices

1. **Always monitor after changes**: Wait 15-30 minutes to see the impact
2. **Scale gradually**: Increase by 20-30% at a time
3. **Match database capacity**: Don't exceed your database's `max_connections`
4. **Leave headroom**: Set `MAX_CONCURRENT_USER_CREATIONS` to 60-70% of `DB_POOL_SIZE`
5. **Consider your traffic**: Adjust based on actual usage patterns
6. **Use alerts**: Set up monitoring for high utilization (> 90%)

## Additional Resources

- [Database Health Check](http://localhost:5000/api/metrics/database)
- [Event Processor Metrics](http://localhost:5000/api/metrics/event-processor)
- [System Health](http://localhost:5000/health)
- [Backfill Optimization](./BACKFILL_OPTIMIZATION.md)
