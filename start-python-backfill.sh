#!/bin/bash
# Script to start the Python unified worker with backfill

# Load environment variables
set -a
source /workspace/.env
set +a

# Change to Python firehose directory
cd /workspace/python-firehose

# Log startup
echo "Starting AT Protocol Python Unified Worker with Backfill..."
echo "BACKFILL_DAYS: $BACKFILL_DAYS"
echo "DATABASE_URL: $DATABASE_URL"
echo "RELAY_URL: $RELAY_URL"

# Start the Python unified worker
exec python3 unified_worker.py