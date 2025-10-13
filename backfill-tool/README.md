# AT Protocol Firehose Backfill Tool

A high-performance Python tool for backfilling historical AT Protocol firehose data into your AppView database.

## Why a Separate Tool?

Backfilling is **resource-intensive** and has completely different performance characteristics than real-time processing:

- **Resource Isolation**: Run aggressive backfills without impacting your live service
- **Operational Flexibility**: Run manually for X days, pause, resume, or stop without touching production
- **Better Performance**: Python's async I/O and multiprocessing are well-suited for batch ETL workloads
- **Simple Deployment**: Available inside your Docker container, no separate infrastructure needed

## Architecture

```
┌──────────────────────────────────────┐
│  Main Node.js App                    │
│  • Real-time firehose ingestion      │
│  • API serving                       │
│  • WebSocket dashboard               │
└──────────────────────────────────────┘
                │
                ▼
         (PostgreSQL)
                ▲
                │
┌──────────────────────────────────────┐
│  Python Backfill Tool (Manual)       │
│  • Historical firehose replay        │
│  • Aggressive batch processing       │
│  • Progress checkpointing            │
│  • Resumable on crash                │
└──────────────────────────────────────┘
```

## Features

- ✅ **High Performance**: No throttling - runs as fast as your database can handle
- ✅ **Progress Tracking**: Automatic checkpointing every 1000 events
- ✅ **Resumable**: Crash-safe with cursor persistence
- ✅ **Time-based Filtering**: Backfill X days of history with cutoff dates
- ✅ **Rich CLI**: Beautiful progress bars and statistics
- ✅ **Resource Monitoring**: Real-time event rates and processing stats
- ✅ **Database Safe**: Handles duplicates gracefully (idempotent)

## Installation

The tool is automatically installed inside your Docker container. No additional setup needed!

If running locally outside Docker:

```bash
cd backfill-tool
pip3 install -r requirements.txt
```

## Usage

### Inside Docker Container

```bash
# Enter the running container
docker exec -it <container-name> bash

# Navigate to backfill tool
cd /app/backfill-tool

# Run backfill
python3 backfill.py --days 30
```

### Common Usage Patterns

#### Backfill Last 30 Days
```bash
python3 backfill.py --days 30
```

#### Backfill Last 7 Days
```bash
python3 backfill.py --days 7
```

#### Backfill All Available History
```bash
python3 backfill.py --days -1
```

#### Resume from Last Checkpoint
```bash
python3 backfill.py --resume
```

#### Start from Specific Cursor
```bash
python3 backfill.py --start-cursor 12345000 --days 7
```

#### Custom Workers and Batch Size
```bash
python3 backfill.py --days 30 --workers 8 --batch-size 200
```

## Command Line Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--days` | int | None | Days to backfill (0=disabled, -1=all, >0=X days) |
| `--start-cursor` | int | 0 | Starting cursor position |
| `--workers` | int | 4 | Number of concurrent workers |
| `--batch-size` | int | 100 | Batch size for processing |
| `--resume` | flag | false | Resume from last saved progress |
| `--database-url` | str | $DATABASE_URL | PostgreSQL connection URL |
| `--relay-url` | str | wss://bsky.network | AT Protocol relay URL |

## Environment Variables

The tool uses the same environment variables as your main app:

- `DATABASE_URL` - PostgreSQL connection string (required)
- `RELAY_URL` - AT Protocol relay URL (default: `wss://bsky.network`)

## Performance

Expected throughput depends on your database and network:

- **Local Database**: 1,000-5,000 events/sec
- **Cloud Database (good)**: 500-2,000 events/sec  
- **Cloud Database (basic)**: 100-500 events/sec

For reference:
- 7 days of history ≈ 50-100M events (varies by network activity)
- 30 days of history ≈ 200-500M events

**Estimation:**
- At 1,000 events/sec: 7 days takes ~14-28 hours
- At 500 events/sec: 7 days takes ~28-56 hours

## Progress Tracking

The tool automatically saves progress every 1,000 events to the `firehose_cursor` table:

```sql
SELECT * FROM firehose_cursor WHERE service = 'backfill_python';
```

This allows you to:
- Resume after crashes
- Stop and restart at any time
- Monitor progress from your main app

## Best Practices

### 1. Run During Off-Peak Hours
Run backfills when your live service has lower traffic to maximize database resources.

### 2. Monitor Database Performance
```bash
# Watch PostgreSQL connections
docker exec -it <postgres-container> psql -U user -d dbname -c "SELECT count(*) FROM pg_stat_activity;"

# Watch database load
docker stats
```

### 3. Use Screen or Tmux
For long-running backfills:

```bash
# Start screen session
screen -S backfill

# Run backfill
cd /app/backfill-tool
python3 backfill.py --days 30

# Detach: Ctrl+A then D
# Reattach: screen -r backfill
```

### 4. Incremental Backfills
Instead of one huge backfill, run smaller incremental ones:

```bash
# Week 1
python3 backfill.py --days 7

# Week 2-4 (start from where week 1 ended)
python3 backfill.py --start-cursor <last-cursor> --days 21
```

## Supported Record Types

The tool currently processes:

- ✅ **Posts** (`app.bsky.feed.post`)
- ✅ **Likes** (`app.bsky.feed.like`)
- ✅ **Reposts** (`app.bsky.feed.repost`)
- ✅ **Follows** (`app.bsky.graph.follow`)
- ✅ **Blocks** (`app.bsky.graph.block`)
- ✅ **Profiles** (`app.bsky.actor.profile`)
- ✅ **Identity Events** (handle changes)
- ✅ **Account Events** (account status)

## Troubleshooting

### "Connection refused" to database
Check that `DATABASE_URL` is set correctly:
```bash
echo $DATABASE_URL
```

### "Connection refused" to relay
Check network connectivity:
```bash
ping bsky.network
```

### Slow performance
1. Check database connection pool size
2. Increase `--workers` parameter
3. Check database CPU/memory usage
4. Verify network latency to relay

### Out of memory
1. Reduce `--workers` count
2. Reduce `--batch-size`
3. Check for database connection leaks

### Duplicate key errors
This is normal and expected! The tool is idempotent and handles duplicates gracefully.

## Architecture Details

### Database Connection
- Uses `asyncpg` for high-performance async PostgreSQL operations
- Connection pooling with configurable pool size
- Automatic retry on transient failures

### Event Processing
- Async event processing pipeline
- Idempotent writes (handles duplicates)
- Foreign key race condition handling
- Automatic user creation for referenced DIDs

### Progress Persistence
- Cursor saved every 1,000 events
- Atomic progress updates
- Crash-safe resumption

## Comparison: Python vs Node.js Backfill

| Aspect | Python Tool | Node.js (Old) |
|--------|-------------|---------------|
| **Resource Isolation** | ✅ Separate process | ❌ Shares with live app |
| **Performance** | ✅ Fast, no throttling | ❌ Throttled to avoid impact |
| **Operational** | ✅ Run manually | ❌ Always running |
| **Memory** | ✅ Better GC | ❌ Can impact main app |
| **Complexity** | ✅ Single purpose | ❌ Mixed concerns |

## Future Enhancements

Potential additions:
- [ ] Multi-relay support
- [ ] Parallel cursor ranges
- [ ] Metric exports (Prometheus)
- [ ] Web UI for progress monitoring
- [ ] Selective collection backfill
- [ ] Rate limiting options

## Contributing

The backfill tool is designed to be simple and maintainable. If you add support for new record types:

1. Add database operations to `database.py`
2. Add event handlers to `event_processor.py`
3. Test with a small backfill first
4. Update this README

## License

Same as main AppView project.
