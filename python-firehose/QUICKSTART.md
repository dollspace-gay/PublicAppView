# Python Firehose Consumer - Quick Start

Get up and running in 5 minutes!

## TL;DR

```bash
# 1. Build and start
docker-compose up -d python-firehose

# 2. Watch it work
docker-compose logs -f python-firehose

# 3. Verify events flowing
docker-compose exec redis redis-cli XLEN firehose:events

# 4. That's it! Your TypeScript workers consume from Redis (no changes needed)
```

## What This Does

- ✅ Connects to AT Protocol firehose (Bluesky network)
- ✅ Receives events (posts, likes, follows, etc.)
- ✅ Pushes to Redis streams (`firehose:events`)
- ✅ Your TypeScript workers consume from Redis (unchanged)
- ✅ Saves cursor for restart recovery

## Why Use This?

**Problem**: TypeScript firehose needs 32 workers using ~64GB RAM due to Node.js memory limits.

**Solution**: Python handles firehose ingestion in 1 process using ~2GB RAM. TypeScript workers stay the same.

**Result**: 85% memory reduction, simpler deployment, same functionality.

## Configuration

Works out-of-the-box with defaults. To customize:

```yaml
# docker-compose.yml
python-firehose:
  environment:
    - RELAY_URL=wss://bsky.network              # Firehose URL
    - REDIS_URL=redis://redis:6379              # Redis connection
    - REDIS_STREAM_KEY=firehose:events          # Stream name (match TypeScript)
    - REDIS_CURSOR_KEY=firehose:python_cursor   # Cursor storage key
    - REDIS_MAX_STREAM_LEN=500000               # Max events in stream
```

## Monitoring

### Check if it's running

```bash
docker-compose ps python-firehose
# Should show: Up (healthy)
```

### View logs

```bash
docker-compose logs -f python-firehose

# You should see:
# [INFO] Connected to firehose successfully
# [INFO] Processed 1,000 events (~2,500 events/sec, cursor: 123456789)
```

### Check Redis stream

```bash
# Number of events in stream
docker-compose exec redis redis-cli XLEN firehose:events

# Current cursor position
docker-compose exec redis redis-cli GET firehose:python_cursor

# Watch events flowing (real-time)
docker-compose exec redis redis-cli MONITOR | grep firehose:events
```

### Performance metrics

```bash
# Memory usage
docker stats python-firehose

# Should show: ~1-2GB RAM (vs 64GB for 32 TypeScript workers)
```

## Troubleshooting

### "Connection refused" error

Redis isn't ready yet. Wait for Redis to be healthy:

```bash
docker-compose up -d redis
docker-compose logs -f redis
# Wait for: "Ready to accept connections"
```

### "READONLY" error

Connected to Redis replica instead of master. Check `REDIS_URL`:

```bash
# Should point to master, not replica
REDIS_URL=redis://redis:6379  # ✅ Correct
REDIS_URL=redis://replica:6379  # ❌ Wrong
```

### No events showing up

Check firehose connection:

```bash
# Look for connection success
docker-compose logs python-firehose | grep "Connected to firehose"

# Check for errors
docker-compose logs python-firehose | grep ERROR
```

### High memory usage

Python should use much less memory than TypeScript. If not:

```bash
# Check for memory leaks
docker stats python-firehose

# Restart if needed
docker-compose restart python-firehose
```

## Migrating from TypeScript Firehose

### Step 1: Start Python consumer

```bash
docker-compose up -d python-firehose
```

### Step 2: Verify events flowing

```bash
# Should see increasing numbers
docker-compose exec redis redis-cli XLEN firehose:events
# Wait 10 seconds
docker-compose exec redis redis-cli XLEN firehose:events
```

### Step 3: Update TypeScript (optional)

Your TypeScript workers already consume from Redis, so they'll automatically pick up events from Python.

If you want to disable TypeScript's firehose connection:

```typescript
// server/index.ts
// await firehoseClient.connect();  // Disable this line
```

### Step 4: Reduce workers (optional)

Since Python handles ingestion efficiently, reduce TypeScript workers:

```yaml
# docker-compose.yml
app:
  deploy:
    replicas: 4  # Down from 32
```

## Common Commands

```bash
# Start
docker-compose up -d python-firehose

# Stop
docker-compose stop python-firehose

# Restart
docker-compose restart python-firehose

# View logs
docker-compose logs -f python-firehose

# Check health
docker-compose ps python-firehose

# Remove (keeps Redis data)
docker-compose down python-firehose
```

## What's Next?

- Read [README.md](./README.md) for detailed documentation
- See [PYTHON_FIREHOSE_MIGRATION.md](../PYTHON_FIREHOSE_MIGRATION.md) for migration guide
- Check [firehose_consumer.py](./firehose_consumer.py) to understand the code

## Need Help?

1. Check logs: `docker-compose logs -f python-firehose`
2. Verify Redis: `docker-compose exec redis redis-cli ping`
3. Test connection: `curl -v https://bsky.network` (should connect)

---

**Remember**: This is just the firehose ingestion layer. All your TypeScript business logic stays the same!
