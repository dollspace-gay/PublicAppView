#!/bin/bash

# Start Redis in the background
echo "[STARTUP] Starting Redis server..."
redis-server --daemonize yes --port 6379 --dir /tmp --save "" --appendonly no

# Wait for Redis to be ready
for i in {1..10}; do
  if redis-cli ping > /dev/null 2>&1; then
    echo "[STARTUP] Redis is ready!"
    break
  fi
  echo "[STARTUP] Waiting for Redis to start... ($i/10)"
  sleep 1
done

# Check if Redis is running
if ! redis-cli ping > /dev/null 2>&1; then
  echo "[STARTUP] ERROR: Redis failed to start!"
  exit 1
fi

# Start the application
echo "[STARTUP] Starting Node.js application..."
NODE_ENV=development tsx server/index.ts
