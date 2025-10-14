# AT Protocol Backfill Service (Python)

This is a Python implementation of the TypeScript backfill service, providing historical data backfilling capabilities for the AT Protocol.

## Features

- **Configurable Backfill Duration**
  - Specific number of days (e.g., `BACKFILL_DAYS=7`)
  - Total history backfill with `BACKFILL_DAYS=-1`
  - Disabled with `BACKFILL_DAYS=0` (default)

- **Resume Support**
  - Saves progress to database periodically
  - Can resume from last saved cursor after interruption

- **Resource Management**
  - Configurable batch processing
  - Memory monitoring and throttling
  - Concurrent processing limits
  - Background/idle processing support

- **Integration**
  - Runs automatically with unified worker when enabled
  - Only runs on primary worker (WORKER_ID=0)
  - Can also run standalone

## Configuration

All configuration is done through environment variables:

### Core Settings
- `BACKFILL_DAYS`: Number of days to backfill (0=disabled, -1=total history, >0=specific days)
- `RELAY_URL`: AT Protocol relay URL (default: wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos)
- `DATABASE_URL`: PostgreSQL connection string
- `WORKER_ID`: Worker ID (backfill only runs on worker 0)

### Resource Throttling
- `BACKFILL_BATCH_SIZE`: Events per batch (default: 5)
- `BACKFILL_BATCH_DELAY_MS`: Delay between batches in milliseconds (default: 2000)
- `BACKFILL_MAX_CONCURRENT`: Maximum concurrent event processing (default: 2)
- `BACKFILL_MAX_MEMORY_MB`: Memory limit in MB (default: 512)
- `BACKFILL_USE_IDLE`: Use idle processing (default: true)

## Usage

### Quick Start with Docker Compose (Recommended)

The backfill service is now **automatically integrated** into the docker-compose setup. To enable backfill:

1. Set `BACKFILL_DAYS` in your environment:
   ```bash
   export BACKFILL_DAYS=7  # Backfill last 7 days
   # OR for all history:
   export BACKFILL_DAYS=-1
   ```

2. Start or restart your services:
   ```bash
   docker-compose up -d
   ```

The `python-backfill-worker` service will automatically:
- Start when `BACKFILL_DAYS` is set to a non-zero value
- Begin processing historical data in the background
- Continue running until all historical data is processed
- Save progress periodically for resume capability

**Example: Backfill last 30 days with moderate speed**
```bash
export BACKFILL_DAYS=30
export BACKFILL_BATCH_SIZE=20
export BACKFILL_BATCH_DELAY_MS=1000
export BACKFILL_MAX_MEMORY_MB=1024
docker-compose up -d
```

To check backfill progress:
```bash
# View backfill worker logs
docker-compose logs -f python-backfill-worker

# Check progress in database
docker-compose exec db psql -U postgres -d atproto -c \
  "SELECT * FROM firehose_cursor WHERE service = 'backfill';"
```

### Manual Execution

#### With Unified Worker

The backfill service automatically starts when:
1. `BACKFILL_DAYS` is set to a non-zero value
2. The worker is the primary worker (`WORKER_ID=0` or not set)

```bash
# Backfill last 7 days
BACKFILL_DAYS=7 python unified_worker.py

# Backfill entire available history
BACKFILL_DAYS=-1 python unified_worker.py

# With custom resource limits
BACKFILL_DAYS=30 \
BACKFILL_BATCH_SIZE=10 \
BACKFILL_MAX_MEMORY_MB=1024 \
python unified_worker.py
```

#### Standalone Mode

You can also run the backfill service independently:

```bash
# Run standalone backfill
BACKFILL_DAYS=7 python backfill_service.py
```

## Architecture

The backfill service mirrors the TypeScript implementation with these key components:

1. **BackfillService**: Main service class that manages the backfill process
2. **EventProcessor**: Reuses the same event processor as the main worker
3. **Progress Tracking**: Saves cursor position to `firehose_cursor` table
4. **Memory Management**: Monitors RSS memory and throttles processing
5. **Batching**: Processes events in configurable batches with delays

## Differences from TypeScript Version

While maintaining feature parity, there are some implementation differences:

1. **Memory Monitoring**: Uses `psutil` instead of Node.js `process.memoryUsage()`
2. **Async Handling**: Uses Python's `asyncio` throughout
3. **Cursor Management**: Manual cursor tracking (Python atproto library limitation)
4. **No Signature Verification**: Currently always disabled for performance

## Progress Tracking

Progress is saved to the `firehose_cursor` table with service name "backfill":

```sql
SELECT * FROM firehose_cursor WHERE service = 'backfill';
```

## Performance Considerations

The default settings are very conservative to ensure backfill runs as a true background task:

- Small batch size (5 events)
- Long delays between batches (2 seconds)
- Low concurrency (2 concurrent operations)
- Memory limit (512MB)

For faster backfilling on dedicated resources, you can increase these limits:

```bash
# Aggressive backfill settings
BACKFILL_BATCH_SIZE=100 \
BACKFILL_BATCH_DELAY_MS=100 \
BACKFILL_MAX_CONCURRENT=10 \
BACKFILL_MAX_MEMORY_MB=2048 \
BACKFILL_DAYS=30 \
python unified_worker.py
```

## Monitoring

The backfill service logs detailed progress information:

- Events received, processed, and skipped
- Processing rate (events/second)
- Memory usage
- Cursor position

Example log output:
```
[BACKFILL] Progress: 10000 received, 9500 processed, 500 skipped (250 evt/s)
[BACKFILL] Memory: 245MB / 512MB limit
```

## Error Handling

- **Duplicate Records**: Silently skipped (common during backfill)
- **DID Resolution Timeouts**: Logged but processing continues
- **Memory Limits**: Processing pauses until memory is freed
- **Fatal Errors**: Service stops and saves progress for resume

## Database Schema

The service uses the existing `firehose_cursor` table:

```sql
CREATE TABLE firehose_cursor (
    id SERIAL PRIMARY KEY,
    service VARCHAR(255) NOT NULL UNIQUE,
    cursor TEXT,
    last_event_time TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);
```