# Python vs TypeScript Backfill Separation

This document clarifies how the Python and TypeScript backfill implementations are completely separate and independent.

## Overview

- **Python Backfill**: Implemented in `backfill_service.py`, runs with the Python unified worker
- **TypeScript Backfill**: Implemented in `server/services/backfill.ts`, runs with the TypeScript server

These are **completely independent** implementations that do not interfere with each other.

## How They're Separated

### 1. Different Services
- **Python**: Runs in the `python-unified-worker` container
- **TypeScript**: Runs in the `app` container (TypeScript server)

### 2. Environment Variable Control

The `BACKFILL_DAYS` environment variable controls each service independently:

```yaml
# Python worker gets its own BACKFILL_DAYS setting
python-unified-worker:
  environment:
    - BACKFILL_DAYS=${BACKFILL_DAYS:-0}  # Controls Python backfill

# TypeScript server can have a different setting
app:
  environment:
    - BACKFILL_DAYS=0  # Force disable TypeScript backfill
```

### 3. Worker ID Check

Both implementations check for the primary worker:
- **Python**: Checks `WORKER_ID=0`
- **TypeScript**: Checks `pm_id=0` or `NODE_APP_INSTANCE=0`

### 4. Database Isolation

While both use the same `firehose_cursor` table, they use different service names:
- **Python**: Uses service name `"backfill"`
- **TypeScript**: Uses service name `"backfill"`

⚠️ **Note**: If you want to run both simultaneously (not recommended), you should modify one to use a different service name like `"backfill_python"`.

## Recommended Configurations

### Option 1: Python-Only Backfill (Recommended)

Use `docker-compose.unified-backfill.yml`:

```bash
# Enable Python backfill, disable TypeScript
BACKFILL_DAYS=7 docker-compose -f docker-compose.unified-backfill.yml up
```

This configuration:
- Sets `BACKFILL_DAYS=7` for Python worker
- Forces `BACKFILL_DAYS=0` for TypeScript server
- Ensures only Python backfill runs

### Option 2: Explicit Control

Set environment variables explicitly:

```bash
# Python backfill only
export BACKFILL_DAYS=7  # This goes to Python worker

# Override for TypeScript in docker-compose.yml
app:
  environment:
    - BACKFILL_DAYS=0  # Override to disable TypeScript backfill
```

### Option 3: Standalone Python Backfill

Run backfill completely separately:

```bash
# Run just the backfill service
cd python-firehose
BACKFILL_DAYS=30 python backfill_service.py
```

## Configuration Precedence

1. **Docker Compose Environment**: Takes precedence over shell environment
2. **Shell Environment Variables**: Used if not overridden in docker-compose
3. **Default Values**: Used if no environment variable is set

Example:
```yaml
# This ALWAYS wins, regardless of shell environment
python-unified-worker:
  environment:
    - BACKFILL_DAYS=7  # This value is used

# Even if you run:
# BACKFILL_DAYS=30 docker-compose up
# The Python worker still uses BACKFILL_DAYS=7
```

## Ensuring TypeScript Backfill is Disabled

To guarantee TypeScript backfill never runs:

1. **In docker-compose.yml**, explicitly set:
   ```yaml
   app:
     environment:
       - BACKFILL_DAYS=0
       - FIREHOSE_ENABLED=false
   ```

2. **Or modify server/index.ts** to completely remove backfill code

3. **Or set worker ID** to non-zero for TypeScript:
   ```yaml
   app:
     environment:
       - pm_id=1  # Not primary worker, backfill won't run
   ```

## Monitoring Which Backfill is Running

Check the logs to see which backfill service is active:

```bash
# Python backfill logs
docker-compose logs python-unified-worker | grep BACKFILL

# TypeScript backfill logs  
docker-compose logs app | grep BACKFILL
```

Python logs will show:
```
[BACKFILL] Starting 7-day historical backfill on primary worker...
[BACKFILL] Resource throttling config:
  - Batch size: 5 events
  - Batch delay: 2000ms
```

TypeScript logs (if disabled) will show:
```
[BACKFILL] Disabled (BACKFILL_DAYS=0 or not set)
```

## Summary

- Python and TypeScript backfills are **completely independent**
- Use environment variables to control which one runs
- Recommended: Use Python backfill with TypeScript disabled
- They don't interfere unless you explicitly configure them to run simultaneously
- The `docker-compose.unified-backfill.yml` file is pre-configured for Python-only backfill