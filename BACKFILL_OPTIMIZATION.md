# Firehose Backfill Resource Optimization

The firehose backfill process has been optimized to run as a true background task with minimal system resource usage.

## Overview

The backfill now includes multiple resource throttling mechanisms:

1. **Configurable Batch Processing** - Process events in small batches with delays
2. **Memory Monitoring** - Automatic pause/resume based on memory usage
3. **Concurrency Limiting** - Limit parallel database operations
4. **Idle Processing** - Use Node.js event loop idle time for non-blocking processing
5. **Progressive Backoff** - Increase delays when memory is constrained

## Default Configuration

By default, the backfill is configured to be **very conservative** to ensure it doesn't impact your system:

- **Batch Size**: 5 events (very small batches)
- **Batch Delay**: 2000ms (2 seconds between batches)
- **Max Concurrent Operations**: 2 (minimal database load)
- **Memory Limit**: 512MB (pause if exceeded)
- **Idle Processing**: Enabled (uses setImmediate for yielding)

With these defaults, the backfill processes approximately **2.5 events/second** or **9,000 events/hour** - truly a background task!

## Environment Variables

You can tune the backfill performance based on your system resources:

### BACKFILL_BATCH_SIZE
Number of events to process before delaying.
```bash
BACKFILL_BATCH_SIZE=5  # Default: very conservative
BACKFILL_BATCH_SIZE=20 # Moderate: ~10 events/sec
BACKFILL_BATCH_SIZE=50 # Aggressive: ~25 events/sec
```

### BACKFILL_BATCH_DELAY_MS
Milliseconds to wait between batches.
```bash
BACKFILL_BATCH_DELAY_MS=2000  # Default: 2 seconds (very slow)
BACKFILL_BATCH_DELAY_MS=1000  # Moderate: 1 second
BACKFILL_BATCH_DELAY_MS=500   # Aggressive: 0.5 seconds
```

### BACKFILL_MAX_CONCURRENT
Maximum concurrent event processing operations.
```bash
BACKFILL_MAX_CONCURRENT=2   # Default: minimal load
BACKFILL_MAX_CONCURRENT=5   # Moderate
BACKFILL_MAX_CONCURRENT=10  # Higher throughput
```

### BACKFILL_MAX_MEMORY_MB
Memory limit in MB. Backfill pauses if exceeded.
```bash
BACKFILL_MAX_MEMORY_MB=512   # Default: 512MB
BACKFILL_MAX_MEMORY_MB=1024  # For larger systems
BACKFILL_MAX_MEMORY_MB=2048  # For high-memory servers
```

### BACKFILL_USE_IDLE
Use Node.js idle time processing (setImmediate).
```bash
BACKFILL_USE_IDLE=true   # Default: enabled (more cooperative)
BACKFILL_USE_IDLE=false  # Disable for faster processing
```

### BACKFILL_DB_POOL_SIZE
Dedicated database connection pool size for backfill.
```bash
BACKFILL_DB_POOL_SIZE=2   # Default: minimal connections
BACKFILL_DB_POOL_SIZE=5   # More connections for faster processing
```

## Performance Profiles

### Background Task (Default)
**Best for**: Running alongside production workloads, minimal system impact
```bash
BACKFILL_BATCH_SIZE=5
BACKFILL_BATCH_DELAY_MS=2000
BACKFILL_MAX_CONCURRENT=2
BACKFILL_MAX_MEMORY_MB=512
BACKFILL_USE_IDLE=true
```
**Throughput**: ~2.5 events/sec (~9K events/hour)

### Moderate Speed
**Best for**: Dedicated backfill time, moderate system resources
```bash
BACKFILL_BATCH_SIZE=20
BACKFILL_BATCH_DELAY_MS=1000
BACKFILL_MAX_CONCURRENT=5
BACKFILL_MAX_MEMORY_MB=1024
BACKFILL_USE_IDLE=true
```
**Throughput**: ~20 events/sec (~72K events/hour)

### Fast Backfill
**Best for**: High-memory servers, dedicated backfill with monitoring
```bash
BACKFILL_BATCH_SIZE=50
BACKFILL_BATCH_DELAY_MS=500
BACKFILL_MAX_CONCURRENT=10
BACKFILL_MAX_MEMORY_MB=2048
BACKFILL_USE_IDLE=false
BACKFILL_DB_POOL_SIZE=5
```
**Throughput**: ~100 events/sec (~360K events/hour)

## Memory Management

The backfill includes automatic memory management:

1. **Periodic Checks**: Memory is checked every 100 events
2. **Automatic Pause**: If memory exceeds the limit, processing pauses for 5 seconds
3. **Garbage Collection**: Triggers GC if available (run with `node --expose-gc`)
4. **Recovery Wait**: If memory is still high after GC, waits 10 seconds before resuming
5. **Monitoring**: Logs memory usage every 10,000 events

## Monitoring Backfill Progress

The backfill logs progress regularly:

```
[BACKFILL] Resource throttling config:
  - Batch size: 5 events
  - Batch delay: 2000ms
  - Max concurrent: 2
  - Memory limit: 512MB
  - Idle processing: true

[BACKFILL] Progress: 10000 received, 9500 processed, 500 skipped (2.5 evt/s)
[BACKFILL] Memory: 384MB / 512MB limit
```

## Running with Optimizations

### Using Docker
Add environment variables to your `docker-compose.yml`:

```yaml
environment:
  BACKFILL_DAYS: 7
  BACKFILL_BATCH_SIZE: 10
  BACKFILL_BATCH_DELAY_MS: 1500
  BACKFILL_MAX_CONCURRENT: 3
  BACKFILL_MAX_MEMORY_MB: 768
```

### Using Direct Node.js
```bash
export BACKFILL_DAYS=7
export BACKFILL_BATCH_SIZE=10
export BACKFILL_BATCH_DELAY_MS=1500
export BACKFILL_MAX_CONCURRENT=3
export BACKFILL_MAX_MEMORY_MB=768
npm start
```

### With Garbage Collection
For better memory management, enable manual GC:

```bash
node --expose-gc dist/server/index.js
```

## Nice Priority (Linux/macOS)

For even lower system impact, run the process with nice priority:

```bash
nice -n 19 node dist/server/index.js
```

Or in Docker:
```yaml
services:
  app:
    # ...
    command: nice -n 19 node dist/server/index.js
```

## CPU Limiting with Docker

Limit CPU usage in Docker:

```yaml
services:
  app:
    # ...
    cpus: '0.5'  # Use max 50% of one CPU core
    mem_limit: 1g
```

## Recommendations

1. **Start Conservative**: Use default settings first, monitor system impact
2. **Tune Gradually**: Increase batch size/concurrency slowly if system can handle it
3. **Monitor Memory**: Watch for memory growth, adjust limit as needed
4. **Off-Peak Hours**: Run faster backfills during low-traffic periods
5. **Separate Instance**: For large backfills, consider a dedicated server

## Troubleshooting

### Backfill Too Slow
- Increase `BACKFILL_BATCH_SIZE` (e.g., 20-50)
- Decrease `BACKFILL_BATCH_DELAY_MS` (e.g., 500-1000)
- Increase `BACKFILL_MAX_CONCURRENT` (e.g., 5-10)
- Disable idle processing: `BACKFILL_USE_IDLE=false`

### System Still Overloaded
- Decrease `BACKFILL_BATCH_SIZE` (e.g., 2-3)
- Increase `BACKFILL_BATCH_DELAY_MS` (e.g., 3000-5000)
- Decrease `BACKFILL_MAX_CONCURRENT` (e.g., 1)
- Lower `BACKFILL_MAX_MEMORY_MB` (e.g., 256-384)
- Use nice priority or CPU limits

### Memory Keeps Pausing
- Increase `BACKFILL_MAX_MEMORY_MB`
- Run with `--expose-gc` for better garbage collection
- Reduce batch size to use less memory at once
- Check for memory leaks in other parts of the application

## Technical Details

### Idle Processing with setImmediate

When `BACKFILL_USE_IDLE=true`, the backfill uses Node.js `setImmediate()` between batches. This allows other I/O operations and events to be processed before continuing with backfill events, making it more cooperative with the rest of your application.

### Concurrency Queue

The backfill maintains an internal queue that limits concurrent database operations. This prevents the database connection pool from being exhausted and ensures the backfill doesn't starve the main application of database connections.

### Memory Throttling

Memory checks are performed every 100 events (configurable via `MEMORY_CHECK_INTERVAL`). When memory exceeds the limit:
1. Processing pauses immediately
2. Garbage collection is triggered (if available)
3. System waits 5 seconds for memory to be freed
4. If still high, waits an additional 10 seconds
5. Processing resumes once memory is below the limit

This ensures the backfill never causes out-of-memory errors.
