# Python Backfill Deployment Guide

This guide explains how to deploy and run the Python unified worker with backfill enabled for 1 day.

## Prerequisites

- Python 3.8 or higher
- PostgreSQL database
- Required Python packages (installed via requirements.txt)

## Configuration

### 1. Environment Variables

The `.env` file has been created with the following backfill settings:

```bash
# Backfill Configuration
BACKFILL_DAYS=1  # Backfill 1 day of historical data

# Resource optimization for background processing
BACKFILL_BATCH_SIZE=5
BACKFILL_BATCH_DELAY_MS=2000
BACKFILL_MAX_CONCURRENT=2
BACKFILL_MAX_MEMORY_MB=512
BACKFILL_USE_IDLE=true
BACKFILL_DB_POOL_SIZE=2
```

### 2. Running with Docker Compose

```bash
# Using the unified backfill configuration
BACKFILL_DAYS=1 docker-compose -f docker-compose.unified-backfill.yml up -d

# Or using the Python default configuration
docker-compose -f docker-compose.python-default.yml up -d
```

### 3. Running Standalone (Without Docker)

#### Option 1: Using the startup script
```bash
cd /workspace
./start-python-backfill.sh
```

#### Option 2: Direct Python execution
```bash
cd /workspace/python-firehose
source ../.env
export BACKFILL_DAYS=1
python3 unified_worker.py
```

### 4. Running as a Systemd Service

```bash
# Copy the service file to systemd
sudo cp /workspace/atproto-python-worker.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable the service to start on boot
sudo systemctl enable atproto-python-worker

# Start the service
sudo systemctl start atproto-python-worker

# Check status
sudo systemctl status atproto-python-worker

# View logs
sudo journalctl -u atproto-python-worker -f
```

## Monitoring Backfill Progress

### 1. Check Logs

```bash
# Docker logs
docker-compose logs python-unified-worker | grep BACKFILL

# Systemd logs
sudo journalctl -u atproto-python-worker | grep BACKFILL

# Direct execution logs
# Logs will appear in stdout
```

### 2. Database Progress

```sql
-- Check backfill cursor position
SELECT * FROM firehose_cursor WHERE service = 'backfill';

-- Check event counts by type
SELECT event_type, COUNT(*) 
FROM events 
WHERE created_at > NOW() - INTERVAL '1 day'
GROUP BY event_type;
```

### 3. Expected Log Messages

When backfill is working correctly, you should see:

```
[BACKFILL] Starting 1-day historical backfill on primary worker...
[BACKFILL] Resource throttling config:
  - Batch size: 5 events
  - Batch delay: 2000ms
  - Max concurrent: 2
  - Memory limit: 512MB
  - Idle processing: True
[BACKFILL] Backfill service started in background
[BACKFILL] Progress: X received, Y processed, Z skipped (N evt/s)
```

## Troubleshooting

### Backfill Not Starting

1. **Check BACKFILL_DAYS setting**:
   ```bash
   grep BACKFILL_DAYS .env
   # Should show: BACKFILL_DAYS=1
   ```

2. **Verify Python dependencies**:
   ```bash
   cd python-firehose
   pip install -r requirements.txt
   ```

3. **Check database connection**:
   ```bash
   psql $DATABASE_URL -c "SELECT 1"
   ```

4. **Ensure worker ID is 0**:
   ```bash
   echo $WORKER_ID
   # Should be 0 or empty (defaults to 0)
   ```

### Performance Issues

If backfill is too slow or consuming too many resources:

1. **Adjust batch settings** in `.env`:
   ```bash
   # For faster processing (more resource intensive)
   BACKFILL_BATCH_SIZE=20
   BACKFILL_BATCH_DELAY_MS=1000
   BACKFILL_MAX_CONCURRENT=5
   BACKFILL_MAX_MEMORY_MB=1024
   ```

2. **Monitor memory usage**:
   ```bash
   # Watch Python process memory
   watch -n 5 'ps aux | grep python.*unified'
   ```

### Common Issues

1. **"Backfill is disabled" message**:
   - Ensure BACKFILL_DAYS is not 0
   - Check that environment variables are loaded

2. **Memory limit exceeded**:
   - Increase BACKFILL_MAX_MEMORY_MB
   - Reduce BACKFILL_BATCH_SIZE

3. **Database connection errors**:
   - Verify DATABASE_URL is correct
   - Check PostgreSQL is running
   - Ensure database exists

## Stopping Backfill

```bash
# Docker
docker-compose down

# Systemd
sudo systemctl stop atproto-python-worker

# Direct execution
# Press Ctrl+C
```

## Resume Capability

The backfill service automatically saves progress to the database. If stopped and restarted, it will resume from the last saved position. This is stored in the `firehose_cursor` table with service name "backfill".

## Expected Duration

With the conservative settings (5 events per batch, 2-second delay):
- Processing rate: ~2.5 events/second
- 1 day of data: Varies based on activity, typically 100K-500K events
- Estimated time: 11-55 hours for 1 day of backfill

To speed up, adjust the batch settings as shown in the Performance Issues section.