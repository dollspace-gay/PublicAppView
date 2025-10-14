#!/bin/bash
# Migration script from TypeScript to Python backfill

echo "=========================================="
echo "Migrating to Python Backfill Service"
echo "=========================================="
echo ""
echo "This script will help you migrate from the TypeScript backfill"
echo "to the new Python backfill service."
echo ""

# Check if docker-compose is running
if docker-compose ps | grep -q "Up"; then
    echo "⚠️  WARNING: Docker services are currently running."
    echo "Please stop them first with: docker-compose down"
    exit 1
fi

# Create backup of current docker-compose.yml
if [ -f docker-compose.yml ]; then
    echo "📁 Backing up current docker-compose.yml to docker-compose.yml.backup"
    cp docker-compose.yml docker-compose.yml.backup
fi

# Use the Python default configuration
echo "📝 Setting up Python-based configuration..."
cp docker-compose.python-default.yml docker-compose.yml

echo ""
echo "✅ Migration complete!"
echo ""
echo "=========================================="
echo "How to use Python backfill:"
echo "=========================================="
echo ""
echo "1. Start with backfill disabled (default):"
echo "   docker-compose up"
echo ""
echo "2. Enable backfill for specific days:"
echo "   BACKFILL_DAYS=7 docker-compose up"
echo ""
echo "3. Enable total history backfill:"
echo "   BACKFILL_DAYS=-1 docker-compose up"
echo ""
echo "4. Customize resources (example):"
echo "   BACKFILL_DAYS=30 \\"
echo "   BACKFILL_BATCH_SIZE=20 \\"
echo "   BACKFILL_MAX_MEMORY_MB=1024 \\"
echo "   docker-compose up"
echo ""
echo "=========================================="
echo "Important changes:"
echo "=========================================="
echo "✅ TypeScript backfill is permanently disabled"
echo "✅ Python worker handles all backfill operations"
echo "✅ Same BACKFILL_DAYS environment variable"
echo "✅ Progress saved to database for resume support"
echo ""
echo "For more information, see PYTHON_BACKFILL_GUIDE.md"