#!/bin/bash

echo "=== AT Protocol AppView Production Deployment ==="
echo ""

# Stop existing PM2 processes
echo "1. Stopping existing PM2 processes..."
pm2 stop all

# Pull latest code
echo ""
echo "2. Pulling latest code from git..."
git pull

# Install dependencies
echo ""
echo "3. Installing dependencies..."
npm install

# Build if needed (for TypeScript)
echo ""
echo "4. Building application..."
npm run build 2>/dev/null || echo "No build step configured (OK for tsx runtime)"

# Ensure Redis is running
echo ""
echo "5. Ensuring Redis is running..."
if ! redis-cli ping > /dev/null 2>&1; then
  echo "Starting Redis..."
  sudo systemctl start redis-server
  sleep 2
fi

# Push database schema
echo ""
echo "6. Pushing database schema..."
npm run db:push

# Restart PM2 with new code
echo ""
echo "7. Restarting PM2 processes..."
pm2 restart all

# Wait for startup
echo ""
echo "8. Waiting for application to start (10 seconds)..."
sleep 10

# Show status
echo ""
echo "9. Current PM2 status:"
pm2 list

echo ""
echo "10. Testing health endpoint..."
curl -s http://localhost:5000/health && echo "" || echo "❌ Health check failed"

echo ""
echo "11. Testing metrics endpoint..."
curl -s http://localhost:5000/api/metrics | head -c 300
echo ""

echo ""
echo "=== Deployment complete! ==="
echo ""
echo "View logs with: pm2 logs"
echo "Check status with: pm2 status"
echo "Monitor with: pm2 monit"
