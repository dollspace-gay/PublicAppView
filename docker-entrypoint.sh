#!/bin/sh
set -e

echo "⏳ Waiting for database to be ready for migrations..."

# Wait for database to be truly ready (retry up to 30 times with 2s delay = 1 minute max)
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    echo "Attempt $((RETRY_COUNT + 1))/$MAX_RETRIES: Running database migrations..."
    
    if npm run db:push; then
        echo "✅ Database migrations completed successfully!"
        break
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        
        if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
            echo "❌ Migration failed, retrying in 2 seconds..."
            sleep 2
        else
            echo "💥 FATAL: Database migrations failed after $MAX_RETRIES attempts!"
            echo "Check your DATABASE_URL and ensure PostgreSQL is accessible."
            exit 1
        fi
    fi
done

echo "🚀 Starting application with PM2..."
exec pm2-runtime start dist/index.js -i 32 --name bluesky-app --max-memory-restart 2G
