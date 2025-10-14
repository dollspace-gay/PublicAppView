# Python Backfill Guide

The AT Protocol backfill functionality is now **exclusively** handled by the Python implementation. TypeScript backfill has been permanently disabled.

## Quick Start

### 1. Basic Usage

```bash
# Backfill last 7 days
BACKFILL_DAYS=7 docker-compose -f docker-compose.python-default.yml up

# Backfill last 30 days
BACKFILL_DAYS=30 docker-compose -f docker-compose.python-default.yml up

# Backfill entire history (use with caution - very resource intensive)
BACKFILL_DAYS=-1 docker-compose -f docker-compose.python-default.yml up
```

### 2. Environment Variables

The Python backfill service is controlled entirely through environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKFILL_DAYS` | `0` | Number of days to backfill (0=disabled, -1=total history) |
| `BACKFILL_BATCH_SIZE` | `5` | Events processed per batch |
| `BACKFILL_BATCH_DELAY_MS` | `2000` | Delay between batches (milliseconds) |
| `BACKFILL_MAX_CONCURRENT` | `2` | Maximum concurrent operations |
| `BACKFILL_MAX_MEMORY_MB` | `512` | Memory limit before throttling (MB) |
| `BACKFILL_USE_IDLE` | `true` | Use idle processing for better resource sharing |

### 3. Resource Profiles

#### Conservative (Default)
Best for production environments where backfill should not impact live operations:
```bash
# Uses default conservative settings
BACKFILL_DAYS=30 docker-compose -f docker-compose.python-default.yml up
```

#### Moderate
Balanced performance for dedicated backfill windows:
```bash
BACKFILL_DAYS=30 \
BACKFILL_BATCH_SIZE=20 \
BACKFILL_BATCH_DELAY_MS=500 \
BACKFILL_MAX_CONCURRENT=5 \
BACKFILL_MAX_MEMORY_MB=1024 \
docker-compose -f docker-compose.python-default.yml up
```

#### Aggressive
Maximum speed for dedicated backfill servers:
```bash
BACKFILL_DAYS=30 \
BACKFILL_BATCH_SIZE=100 \
BACKFILL_BATCH_DELAY_MS=100 \
BACKFILL_MAX_CONCURRENT=10 \
BACKFILL_MAX_MEMORY_MB=2048 \
WORKER_MEMORY_LIMIT=8G \
docker-compose -f docker-compose.python-default.yml up
```

## How It Works

1. **Automatic Start**: When `BACKFILL_DAYS` is set to a non-zero value, the Python unified worker automatically starts the backfill service in the background.

2. **Primary Worker Only**: Backfill only runs on the primary worker (WORKER_ID=0) to avoid conflicts.

3. **Progress Tracking**: Progress is saved to the database every 1000 events, allowing resume after interruption.

4. **Memory Management**: The service monitors memory usage and throttles processing to stay within limits.

5. **Concurrent with Live Data**: Backfill runs alongside live firehose processing without interference.

## Monitoring

### Check Progress
```bash
# View backfill logs
docker-compose logs python-worker | grep BACKFILL

# Check database progress
docker-compose exec db psql -U postgres -d atproto -c "SELECT * FROM firehose_cursor WHERE service = 'backfill';"
```

### Example Log Output
```
[BACKFILL] Starting 30-day historical backfill on primary worker...
[BACKFILL] Resource throttling config:
  - Batch size: 5 events
  - Batch delay: 2000ms
  - Max concurrent: 2
  - Memory limit: 512MB
  - Idle processing: True
[BACKFILL] Progress: 10000 received, 9500 processed, 500 skipped (250 evt/s)
[BACKFILL] Memory: 245MB / 512MB limit
```

## Troubleshooting

### Backfill Not Starting

1. Check if `BACKFILL_DAYS` is set:
   ```bash
   docker-compose exec python-worker env | grep BACKFILL
   ```

2. Verify you're on the primary worker:
   ```bash
   docker-compose exec python-worker env | grep WORKER_ID
   ```

3. Check logs for errors:
   ```bash
   docker-compose logs python-worker | grep -E "BACKFILL|ERROR"
   ```

### Performance Issues

1. **High Memory Usage**: Reduce `BACKFILL_BATCH_SIZE` and `BACKFILL_MAX_CONCURRENT`
2. **Slow Progress**: Increase batch size and reduce delay for faster processing
3. **Database Overload**: Reduce concurrent operations and increase delays

### Resume After Interruption

The backfill automatically resumes from the last saved position. Just restart with the same `BACKFILL_DAYS` value:

```bash
# Original run (interrupted)
BACKFILL_DAYS=30 docker-compose -f docker-compose.python-default.yml up

# Resume (will continue from last position)
BACKFILL_DAYS=30 docker-compose -f docker-compose.python-default.yml up
```

## TypeScript Backfill Status

The TypeScript backfill has been permanently disabled:

- ✅ Code removed from `server/index.ts`
- ✅ API endpoints return 501 Not Implemented
- ✅ Environment variable forced to 0 in all docker-compose files
- ✅ All backfill functionality moved to Python

## Migration from TypeScript

If you were previously using TypeScript backfill:

1. Stop all services
2. Use the new Python-based docker-compose file
3. Set `BACKFILL_DAYS` as needed
4. Start services - Python backfill will handle everything

## Best Practices

1. **Test First**: Start with a small number of days (e.g., 1-7) to test your setup
2. **Monitor Resources**: Watch memory and CPU usage during initial runs
3. **Off-Peak Hours**: Run large backfills during low-traffic periods
4. **Incremental Approach**: For large histories, consider multiple smaller backfills
5. **Database Maintenance**: Run `VACUUM` and `ANALYZE` after large backfills

## Support

For issues or questions:
1. Check logs: `docker-compose logs python-worker`
2. Review this guide
3. Check `python-firehose/README.backfill.md` for technical details