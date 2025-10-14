# Worker Configuration Summary

## Overview

This system uses **Python workers** for high-performance event processing and **TypeScript services** for API and web interface.

## Architecture

### Current Configuration (Python Workers - ACTIVE)

```
AT Protocol Firehose → Python Firehose Consumer → Redis Stream → Python Worker → PostgreSQL
                                                                       ↓
                                                               TypeScript API (read-only access)
```

### Components

1. **Python Firehose Consumer** (`python-firehose` service)
   - Connects to AT Protocol firehose (wss://bsky.network)
   - Pushes events to Redis stream (`firehose:events`)
   - Handles cursor persistence for restart recovery
   - Low memory footprint (~2GB)

2. **Python Redis Consumer Worker** (`python-worker` service) ⚡ **ACTIVE**
   - Consumes events from Redis stream
   - Processes events to PostgreSQL
   - Replaces 32 TypeScript workers with single Python process
   - Configurable parallel consumers (default: 5)
   - Memory efficient (~4GB)

3. **TypeScript API Service** (`app` service)
   - Serves API endpoints (XRPC, REST)
   - Provides web interface
   - Read-only access to PostgreSQL
   - **Does NOT consume from Redis** (Python workers handle this)
   - **Does NOT connect to firehose** (Python handles this)

## Environment Variables

### Docker Compose Configuration

#### Python Services (ENABLED)
- `RELAY_URL`: AT Protocol firehose URL (default: `wss://bsky.network`)
- `REDIS_URL`: Redis connection URL (default: `redis://redis:6379`)
- `REDIS_STREAM_KEY`: Redis stream key (default: `firehose:events`)
- `DATABASE_URL`: PostgreSQL connection URL
- `DB_POOL_SIZE`: Python worker DB pool size (default: `20`)
- `BATCH_SIZE`: Events per batch (default: `10`)
- `PARALLEL_CONSUMERS`: Concurrent consumer pipelines (default: `5`)
- `LOG_LEVEL`: Logging level (default: `INFO`)

#### TypeScript Service (API Only)
- `FIREHOSE_ENABLED`: Enable TypeScript firehose (default: `false`) ❌ **DISABLED**
- `TYPESCRIPT_WORKERS_ENABLED`: Enable TypeScript workers (default: `false`) ❌ **DISABLED**

## Service Status

### ✅ Active Services
- `python-firehose`: Python firehose consumer (firehose → Redis)
- `python-worker`: Python Redis consumer (Redis → PostgreSQL)
- `app`: TypeScript API service (API requests only)
- `redis`: Redis stream server
- `db`: PostgreSQL database

### ❌ Inactive Services
- TypeScript firehose connection (replaced by Python)
- TypeScript worker consumption (replaced by Python)

## Configuration Changes Made

### 1. Docker Compose (`docker-compose.yml`)

#### Added Python Worker Service
```yaml
python-worker:
  build:
    context: ./python-firehose
    dockerfile: Dockerfile.worker
  environment:
    - DATABASE_URL=postgresql://postgres:password@db:5432/atproto
    - REDIS_URL=redis://redis:6379
    - REDIS_STREAM_KEY=firehose:events
    - REDIS_CONSUMER_GROUP=firehose-processors
    - CONSUMER_ID=python-worker
    - DB_POOL_SIZE=${PYTHON_WORKER_DB_POOL_SIZE:-20}
    - BATCH_SIZE=${PYTHON_WORKER_BATCH_SIZE:-10}
    - PARALLEL_CONSUMERS=${PYTHON_WORKER_PARALLEL_CONSUMERS:-5}
```

#### Updated App Service
```yaml
app:
  environment:
    - FIREHOSE_ENABLED=${FIREHOSE_ENABLED:-false}  # TypeScript firehose disabled
    - TYPESCRIPT_WORKERS_ENABLED=${TYPESCRIPT_WORKERS_ENABLED:-false}  # TypeScript workers disabled
```

### 2. TypeScript Routes (`server/routes.ts`)

#### Disabled TypeScript Firehose
- Changed default from `true` to `false`
- Only connects when `FIREHOSE_ENABLED=true`

#### Disabled TypeScript Workers
- Wrapped worker consumption loop in conditional
- Only runs when `TYPESCRIPT_WORKERS_ENABLED=true`
- TypeScript service now serves API requests only

## Worker Code

### Python Worker (`python-firehose/redis_consumer_worker.py`)
- **Status**: ✅ WIRED IN AND ACTIVE
- **Purpose**: Consume from Redis stream → Write to PostgreSQL
- **Features**:
  - Async event processing
  - Parallel consumer pipelines (configurable)
  - Automatic cursor management
  - Database connection pooling
  - Full event type support (commit, identity, account)
  - Pending operations queue for dependencies
  - TTL sweeper for cleanup

### TypeScript Worker (`server/routes.ts` + `server/services/event-processor.ts`)
- **Status**: ❌ DISABLED
- **Purpose**: Previously consumed from Redis → Wrote to PostgreSQL
- **Replaced By**: Python worker (more efficient, single process)

## Benefits of Python Worker

1. **Resource Efficiency**
   - Single Python process replaces 32 TypeScript workers
   - Lower memory footprint (~4GB vs ~32GB+)
   - Reduced CPU usage

2. **Simplified Architecture**
   - Fewer moving parts
   - Easier to monitor and debug
   - Single point of configuration

3. **Performance**
   - Native async/await in Python
   - Efficient Redis client
   - Optimized PostgreSQL connection pooling

## Switching Between Modes

### Use Python Workers (Current/Recommended)
```bash
# In .env or docker-compose.yml
FIREHOSE_ENABLED=false
TYPESCRIPT_WORKERS_ENABLED=false
```

### Use TypeScript Workers (Legacy/Fallback)
```bash
# In .env or docker-compose.yml
FIREHOSE_ENABLED=true
TYPESCRIPT_WORKERS_ENABLED=true
```

Note: You would also need to disable/remove the Python services.

## Monitoring

### Check Python Worker Logs
```bash
docker compose logs -f python-worker
```

### Check Python Firehose Logs
```bash
docker compose logs -f python-firehose
```

### Check TypeScript API Logs
```bash
docker compose logs -f app
```

### Expected Startup Messages

#### Python Worker
```
[INFO] Initializing Redis consumer worker...
[INFO] Connecting to Redis at redis://redis:6379...
[INFO] Connected to Redis
[INFO] Creating database pool with 20 connections...
[INFO] Database pool created successfully
[INFO] Worker initialized successfully
[INFO] Starting 5 parallel consumer pipelines...
```

#### TypeScript API
```
[FIREHOSE] TypeScript firehose disabled (using Python firehose)
[WORKERS] TypeScript workers disabled (using Python workers for Redis → PostgreSQL)
[WORKERS] This instance will serve API requests only
```

## Files Modified

1. `docker-compose.yml` - Added `python-worker` service, updated `app` environment
2. `server/routes.ts` - Added conditionals to disable TypeScript workers
3. `WORKER_CONFIGURATION.md` - This documentation file (NEW)

## Files Unchanged (Still Functional)

1. `python-firehose/redis_consumer_worker.py` - Python worker (NOW WIRED IN)
2. `python-firehose/firehose_consumer.py` - Python firehose (ALREADY ACTIVE)
3. `python-firehose/Dockerfile.worker` - Python worker Dockerfile (ALREADY EXISTS)
4. `server/services/event-processor.ts` - TypeScript event processor (INACTIVE BUT AVAILABLE)
5. `server/services/firehose.ts` - TypeScript firehose (INACTIVE BUT AVAILABLE)

## Summary

✅ **Python worker is now WIRED IN and ACTIVE**
❌ **TypeScript workers are now DISABLED (made inactive)**

The system uses Python for high-performance event processing while TypeScript continues to serve API requests and the web interface.
