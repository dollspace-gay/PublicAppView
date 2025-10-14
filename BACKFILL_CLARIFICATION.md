# Backfill Systems Clarification

This document clarifies the two separate backfill systems in the AT Protocol implementation.

## 1. Python Firehose Backfill (System-wide)

**Location**: `python-firehose/backfill_service.py`

**Purpose**: Backfills historical data from the AT Protocol firehose for ALL users

**Configuration**: 
- Set via `BACKFILL_DAYS` environment variable
- `BACKFILL_DAYS=1` means backfill 1 day of historical data for everyone
- Runs as part of the Python unified worker
- Only runs on primary worker (WORKER_ID=0)

**How to enable**:
```bash
# In .env file
BACKFILL_DAYS=1

# Run the Python worker
cd python-firehose
python3 unified_worker.py

# Or with Docker
BACKFILL_DAYS=1 docker-compose -f docker-compose.unified-backfill.yml up
```

## 2. User-specific Repo Backfill (Per-user)

**Location**: `server/services/repo-backfill.ts`

**Purpose**: Allows individual users to import their own historical data from their PDS

**Access**: Via the web UI at `/user` when logged in

**Features**:
- Users can specify number of days to backfill (0 = all time)
- Fetches data directly from the user's PDS
- Updates only that user's data
- Available through the "Backfill Your Data" card in the user panel

**How it works**:
1. User logs in and goes to User Panel
2. Enters number of days to backfill
3. Clicks "Start Backfill"
4. System fetches their CAR file from their PDS
5. Imports their posts, likes, follows, etc.

## Key Differences

| Feature | Python Firehose Backfill | User Repo Backfill |
|---------|-------------------------|-------------------|
| Scope | All users | Single user |
| Data source | AT Protocol firehose | User's PDS CAR file |
| Configuration | Environment variable | Web UI |
| When to use | Initial setup or recovery | User wants their old data |
| Runs where | Python worker process | TypeScript web server |

## The 501 Error Fix

The 501 error occurred because the TypeScript firehose backfill was disabled, but the `/api/user/backfill` endpoint was still needed for user-specific repo backfills. The fix:

1. Re-enabled the endpoint
2. Made it use the `RepoBackfillService` instead of the disabled `BackfillService`
3. Properly handles the `days` parameter from the UI

## For Server Deployment

To have both systems working:

1. **Python Firehose Backfill** (for system-wide historical data):
   - Set `BACKFILL_DAYS=1` in `.env`
   - Run the Python unified worker

2. **User Repo Backfill** (for individual users):
   - Already enabled with the fix
   - Users can access via web UI at `/user`

Both systems can run simultaneously without conflict as they serve different purposes.