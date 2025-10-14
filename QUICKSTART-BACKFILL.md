# Quick Start: Automatic Python Backfill

This guide shows you how to enable automatic historical data backfill for your AT Protocol AppView.

## What is Backfill?

Backfill retrieves historical posts, likes, follows, and other events from the AT Protocol network and stores them in your database. This is useful when:
- Setting up a new AppView instance
- You want to populate your database with historical data
- Users expect to see past posts in their feeds

## How to Enable Backfill

The Python backfill service runs automatically when you set the `BACKFILL_DAYS` environment variable.

### Option 1: Using Environment Variables (Recommended)

```bash
# Set the backfill duration (pick one):
export BACKFILL_DAYS=7      # Backfill last 7 days
export BACKFILL_DAYS=30     # Backfill last 30 days
export BACKFILL_DAYS=-1     # Backfill ALL available history

# Optional: Configure backfill performance (defaults are conservative)
export BACKFILL_BATCH_SIZE=5              # Events per batch
export BACKFILL_BATCH_DELAY_MS=2000       # Delay between batches (ms)
export BACKFILL_MAX_MEMORY_MB=512         # Memory limit

# Start your services
docker-compose up -d
```

### Option 2: Using .env File

1. Copy `.env.example` to `.env` if you haven't already:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and set `BACKFILL_DAYS`:
   ```bash
   # In .env file:
   BACKFILL_DAYS=7
   ```

3. Start your services:
   ```bash
   docker-compose up -d
   ```

## Backfill Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKFILL_DAYS` | `0` | `0`=disabled, `-1`=all history, `>0`=specific days |
| `BACKFILL_BATCH_SIZE` | `5` | Events to process before pausing |
| `BACKFILL_BATCH_DELAY_MS` | `2000` | Milliseconds to wait between batches |
| `BACKFILL_MAX_CONCURRENT` | `2` | Max concurrent processing operations |
| `BACKFILL_MAX_MEMORY_MB` | `512` | Pause if memory exceeds this limit |
| `BACKFILL_USE_IDLE` | `true` | Use idle CPU time for processing |
| `BACKFILL_DB_POOL_SIZE` | `2` | Database connection pool size |

## Performance Profiles

### Conservative (Default) - Background Task
**~2.5 events/sec, ~9,000 events/hour**

Best for: Running backfill alongside normal operations
```bash
export BACKFILL_DAYS=7
export BACKFILL_BATCH_SIZE=5
export BACKFILL_BATCH_DELAY_MS=2000
export BACKFILL_MAX_MEMORY_MB=512
```

### Moderate - Balanced Speed
**~20 events/sec, ~72,000 events/hour**

Best for: Faster backfill with moderate resource usage
```bash
export BACKFILL_DAYS=30
export BACKFILL_BATCH_SIZE=20
export BACKFILL_BATCH_DELAY_MS=1000
export BACKFILL_MAX_CONCURRENT=5
export BACKFILL_MAX_MEMORY_MB=1024
```

### Aggressive - Maximum Speed
**~100 events/sec, ~360,000 events/hour**

Best for: Dedicated backfill on high-memory servers
```bash
export BACKFILL_DAYS=-1
export BACKFILL_BATCH_SIZE=50
export BACKFILL_BATCH_DELAY_MS=500
export BACKFILL_MAX_CONCURRENT=10
export BACKFILL_MAX_MEMORY_MB=2048
```

## Monitoring Backfill Progress

### View Real-Time Logs
```bash
docker-compose logs -f python-backfill-worker
```

You'll see output like:
```
[BACKFILL] Starting 7-day historical backfill...
[BACKFILL] Progress: 10000 received, 9500 processed, 500 skipped (250 evt/s)
[BACKFILL] Memory: 245MB / 512MB limit
```

### Check Progress in Database
```bash
docker-compose exec db psql -U postgres -d atproto -c \
  "SELECT * FROM firehose_cursor WHERE service = 'backfill';"
```

### Monitor with Docker
```bash
# Check if backfill worker is running
docker-compose ps python-backfill-worker

# View resource usage
docker stats python-backfill-worker
```

## How It Works

1. **Automatic Startup**: When `BACKFILL_DAYS` is set to a non-zero value, the `python-backfill-worker` service automatically starts
2. **Background Processing**: The worker connects to the AT Protocol firehose and processes historical events
3. **Progress Tracking**: Progress is saved to the database every 1000 events
4. **Resume Capability**: If interrupted, backfill automatically resumes from the last saved position
5. **Automatic Completion**: Once all historical data is processed, the backfill worker continues as a normal firehose worker

## Disabling Backfill

To disable backfill:

```bash
export BACKFILL_DAYS=0
docker-compose up -d
```

Or remove/comment out the line in your `.env` file.

## Troubleshooting

### Backfill Not Starting

Check logs:
```bash
docker-compose logs python-backfill-worker
```

Common issues:
- `BACKFILL_DAYS=0` (backfill is disabled)
- Database schema not initialized (wait for `app` service to complete migrations)
- Memory or resource constraints

### Slow Backfill Performance

Try increasing these settings:
```bash
export BACKFILL_BATCH_SIZE=20
export BACKFILL_BATCH_DELAY_MS=1000
export BACKFILL_MAX_CONCURRENT=5
export BACKFILL_MAX_MEMORY_MB=1024
```

### High Memory Usage

The backfill automatically pauses when memory exceeds `BACKFILL_MAX_MEMORY_MB`. You can:
- Increase the limit: `export BACKFILL_MAX_MEMORY_MB=1024`
- Or reduce batch size: `export BACKFILL_BATCH_SIZE=3`

### Database Connection Issues

Ensure the app service has completed database migrations:
```bash
docker-compose logs app | grep migration
```

## Additional Documentation

For detailed technical information, see:
- [Python Backfill Service Documentation](python-firehose/README.backfill.md)
- [Backfill Configuration Example](.env.backfill.example)

## Example: Complete Setup

```bash
# 1. Set environment variables
export BACKFILL_DAYS=7
export BACKFILL_BATCH_SIZE=20
export BACKFILL_BATCH_DELAY_MS=1000

# 2. Start services
docker-compose up -d

# 3. Monitor progress
docker-compose logs -f python-backfill-worker

# 4. Check when complete (look for "Backfill completed" message)
```

That's it! Your AppView will now automatically backfill historical data whenever `BACKFILL_DAYS` is set.
