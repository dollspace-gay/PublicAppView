#!/bin/bash

echo "=== AT Protocol AppView Production Diagnostics ==="
echo ""
echo "1. Checking if Redis is running..."
if redis-cli ping > /dev/null 2>&1; then
  echo "✅ Redis is running (PONG received)"
else
  echo "❌ Redis is NOT running or not accessible"
  echo "   Fix: sudo systemctl start redis-server"
fi

echo ""
echo "2. Checking Redis connection from Node..."
redis-cli info server | grep "redis_version" || echo "❌ Could not get Redis version"

echo ""
echo "3. Checking if PM2 processes are running..."
pm2 list

echo ""
echo "4. Checking environment variables..."
echo "NODE_ENV: ${NODE_ENV:-NOT SET}"
echo "DATABASE_URL: ${DATABASE_URL:+SET (hidden)}"
echo "SESSION_SECRET: ${SESSION_SECRET:+SET (hidden)}"
echo "REDIS_HOST: ${REDIS_HOST:-NOT SET (defaults to localhost)}"
echo "REDIS_PORT: ${REDIS_PORT:-NOT SET (defaults to 6379)}"
echo "APPVIEW_DID: ${APPVIEW_DID:-NOT SET}"

echo ""
echo "5. Checking PostgreSQL connection..."
psql "${DATABASE_URL}" -c "SELECT version();" > /dev/null 2>&1 && echo "✅ PostgreSQL connected" || echo "❌ PostgreSQL connection failed"

echo ""
echo "6. Testing Redis from Node..."
node -e "const redis = require('ioredis'); const r = new redis({host: process.env.REDIS_HOST || 'localhost', port: process.env.REDIS_PORT || 6379}); r.ping().then(() => {console.log('✅ Redis connection works from Node'); process.exit(0);}).catch((err) => {console.error('❌ Redis error:', err.message); process.exit(1);});"

echo ""
echo "7. Checking API health..."
curl -s http://localhost:5000/health && echo "" || echo "❌ Health endpoint failed"

echo ""
echo "8. Testing metrics endpoint..."
curl -s http://localhost:5000/api/metrics | head -c 200
echo ""

echo ""
echo "=== Recent PM2 logs (last 50 lines) ==="
pm2 logs --lines 50 --nostream

echo ""
echo "=== Diagnostic complete ==="
