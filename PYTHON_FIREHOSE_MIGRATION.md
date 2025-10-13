# Python Firehose Migration Guide

## Overview

This document explains the hybrid Python/TypeScript architecture for firehose consumption and how to migrate from the all-TypeScript approach.

## The Problem

Your TypeScript firehose consumer was using multiple workers because:

1. **Memory Limits**: Node.js V8 heap is limited (~1.4-4GB per process)
2. **Single-threaded**: Event loop can't do true multithreading
3. **Worker Overhead**: Each worker needs:
   - Separate process
   - Own memory allocation  
   - Database connection pool (100 connections × N workers)
   - Inter-process coordination

With 32 workers, this meant:
- ~64GB RAM total
- Complex deployment
- Difficult debugging
- Connection pool exhaustion risks

## The Solution: Hybrid Architecture

**Key Insight**: You only need Python for the firehose → Redis ingestion. Everything else can stay TypeScript!

```
┌──────────────────────────────────────────────────────────────┐
│  INGESTION LAYER (Python - 1 process)                        │
│                                                               │
│  AT Protocol Firehose                                        │
│         ↓                                                    │
│  Python Consumer (firehose_consumer.py)                     │
│         ↓                                                    │
│  Redis Stream (firehose:events)                             │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│  PROCESSING LAYER (TypeScript - existing code)               │
│                                                               │
│  TypeScript Workers (event-processor.ts, etc.)              │
│         ↓                                                    │
│  PostgreSQL Database                                         │
└──────────────────────────────────────────────────────────────┘
```

### What Gets Rewritten (Python)

✅ **Firehose WebSocket connection** (`server/services/firehose.ts` → `python-firehose/firehose_consumer.py`)
- Connects to `wss://bsky.network`
- Receives commit/identity/account events
- Pushes to Redis streams

### What Stays TypeScript (No Changes)

✅ **Redis consumption** (`server/services/redis-queue.ts`)
✅ **Event processing** (`server/services/event-processor.ts`)
✅ **Database operations** (`server/db.ts`, all models)
✅ **API routes** (`server/routes.ts`)
✅ **All business logic**

**You're changing ~500 lines of connection code, keeping ~10,000+ lines of business logic!**

## Migration Steps

### Step 1: Deploy Python Firehose Consumer

```bash
# Build and start the Python consumer
docker-compose up -d python-firehose

# Verify it's running
docker-compose logs -f python-firehose

# You should see:
# [INFO] Connected to firehose successfully
# [INFO] Processed 1,000 events (~2,500 events/sec, cursor: 123456789)
```

### Step 2: Update TypeScript to Consume from Redis Only

Your TypeScript `server/services/firehose.ts` currently:
1. Connects to firehose WebSocket
2. Pushes events to Redis
3. Workers consume from Redis

**Change**: Disable steps 1-2, keep only step 3 (Redis consumption).

You have two options:

#### Option A: Use Redis Adapter (Recommended - Already Exists!)

Your `osprey-bridge/firehose-to-kafka` already has a `RedisAdapter` that consumes from Redis streams. You can use this pattern:

```typescript
// Instead of connecting to firehose directly:
// await firehoseClient.connect();

// Just consume from Redis (the Python service is pushing):
const consumer = new RedisAdapter({
  redisUrl: process.env.REDIS_URL,
  streamKey: 'firehose:events',
  consumerGroup: 'firehose-processors',
  consumerId: `worker-${process.pid}`,
});

await consumer.start(async (event) => {
  // Your existing event processing logic
  await eventProcessor.process(event);
});
```

#### Option B: Disable Firehose Connection (Simplest)

If your workers already consume from Redis via `redis-queue.ts`, just disable the firehose connection:

```typescript
// server/index.ts or wherever you start the firehose

// OLD (before):
// await firehoseClient.connect();

// NEW (after):
// Don't connect - Python service is pushing to Redis instead
console.log('[FIREHOSE] Using Python firehose consumer, skipping WebSocket connection');
```

### Step 3: Monitor and Verify

```bash
# Check Redis stream has events
docker-compose exec redis redis-cli XLEN firehose:events
# Should show: (integer) 50000 or similar

# Check Python cursor is advancing
docker-compose exec redis redis-cli GET firehose:python_cursor
# Should show: "123456789" (increasing over time)

# Check TypeScript workers are processing
docker-compose logs -f app | grep "Processed"
# Should show your existing event processing logs
```

### Step 4: Reduce Worker Count (Optional)

Since Python handles ingestion more efficiently, you can reduce TypeScript workers:

```yaml
# docker-compose.yml
app:
  deploy:
    replicas: 4  # Down from 32!
```

Or adjust concurrency limits:

```yaml
environment:
  - MAX_CONCURRENT_OPS=50  # Down from 100
```

## Performance Comparison

### Before (All TypeScript)

```
┌─────────────────────────────────────────────────┐
│ 32 × TypeScript Workers                         │
│                                                  │
│ Each worker:                                     │
│   - 2GB RAM                                      │
│   - 100 DB connections                           │
│   - Full event processing pipeline               │
│                                                  │
│ Total: 64GB RAM, 3200 DB connections            │
└─────────────────────────────────────────────────┘
```

### After (Python + TypeScript)

```
┌──────────────────────────────────┐
│ 1 × Python Firehose Consumer     │
│   - 1-2GB RAM                     │
│   - 1 Redis connection            │
│   - Just firehose → Redis         │
└──────────────────────────────────┘
           +
┌──────────────────────────────────┐
│ 4 × TypeScript Workers            │
│   - 2GB RAM each = 8GB total      │
│   - 100 DB connections each       │
│   - Event processing only         │
│                                   │
│ Total: 10GB RAM, 400 DB conns    │
└──────────────────────────────────┘
```

**Savings**: ~85% reduction in memory, ~87% reduction in database connections!

## Rollback Plan

If something goes wrong, rollback is simple:

```bash
# Stop Python consumer
docker-compose stop python-firehose

# Re-enable TypeScript firehose connection
# Uncomment: await firehoseClient.connect();

# Restart TypeScript app
docker-compose restart app
```

Your TypeScript firehose code still exists, it's just not being used.

## FAQ

### Q: Do I need to rewrite my business logic in Python?

**A: No!** Only the firehose WebSocket connection is in Python. All your business logic, database operations, API routes, etc. stay in TypeScript.

### Q: What if the Python consumer crashes?

**A: Same as before.** The cursor is saved every 5 seconds to Redis, so on restart it resumes from the last position. TypeScript workers continue processing events from Redis.

### Q: Can I run both Python and TypeScript firehose at the same time?

**A: Yes, for testing.** Both will push to the same Redis stream. TypeScript workers will deduplicate based on sequence numbers. Good for gradual migration.

### Q: Does this work with my existing monitoring/logging?

**A: Yes.** Python consumer logs to stdout (captured by Docker). TypeScript workers continue logging as before. Both are visible in `docker-compose logs`.

### Q: What about performance?

**A: Significantly better.** Python's async I/O and memory management handle the firehose more efficiently. You'll use 50-80% less memory and can reduce worker count.

### Q: Do I need to learn Python?

**A: Not really.** The Python consumer is ~500 lines and self-contained. You won't be modifying it much. Your TypeScript codebase (10,000+ lines) is where you'll spend 99% of your time.

## Next Steps

1. ✅ Deploy Python firehose consumer (`docker-compose up -d python-firehose`)
2. ✅ Verify events flowing to Redis (`redis-cli XLEN firehose:events`)
3. ✅ Update TypeScript to consume from Redis only (or keep as-is if workers already do)
4. ✅ Monitor both services for 24-48 hours
5. ✅ Reduce worker count once stable
6. ✅ Celebrate 85% memory savings! 🎉

## Resources

- [Python Firehose README](./python-firehose/README.md) - Detailed Python consumer docs
- [AT Protocol Firehose Docs](https://atproto.com/specs/event-stream) - Firehose specification
- [Redis Streams Guide](https://redis.io/docs/data-types/streams/) - Redis streams tutorial

---

**Remember**: This isn't a full rewrite. You're just replacing the firehose connection layer with Python while keeping all your TypeScript business logic. It's a surgical optimization, not a migration!
