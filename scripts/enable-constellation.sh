#!/bin/bash

# Enable Constellation integration for AppView
# Adds/updates environment variables and optionally starts the bridge service

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"

echo "🌌 Constellation Integration Setup"
echo "=================================="
echo

# Check if .env exists
if [ ! -f "$ENV_FILE" ]; then
    echo "📝 Creating .env file..."
    touch "$ENV_FILE"
fi

# Function to update or add env variable
update_env() {
    local key=$1
    local value=$2
    
    if grep -q "^${key}=" "$ENV_FILE"; then
        # Update existing
        sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
        echo "✅ Updated ${key}=${value}"
    else
        # Add new
        echo "${key}=${value}" >> "$ENV_FILE"
        echo "✅ Added ${key}=${value}"
    fi
}

# Prompt for configuration
echo "Choose Constellation endpoint:"
echo "1) Public instance (constellation.microcosm.blue) - Recommended for getting started"
echo "2) Self-hosted instance"
echo
read -p "Enter choice [1]: " choice
choice=${choice:-1}

if [ "$choice" = "2" ]; then
    read -p "Enter self-hosted Constellation URL [http://constellation:8080]: " CONSTELLATION_URL
    CONSTELLATION_URL=${CONSTELLATION_URL:-http://constellation:8080}
    SELF_HOSTED=true
else
    CONSTELLATION_URL="https://constellation.microcosm.blue"
    SELF_HOSTED=false
    echo
    echo "ℹ️  Using public instance - please be respectful:"
    echo "   - Free to use for development and production"
    echo "   - Best-effort uptime (no SLA)"
    echo "   - Rate limiting applies"
    echo
fi

# Cache TTL
echo
read -p "Cache TTL in seconds [60]: " CACHE_TTL
CACHE_TTL=${CACHE_TTL:-60}

# Update .env file
echo
echo "📝 Updating .env file..."
update_env "CONSTELLATION_ENABLED" "true"
update_env "CONSTELLATION_URL" "$CONSTELLATION_URL"
update_env "CONSTELLATION_CACHE_TTL" "$CACHE_TTL"

# Clean up backup
rm -f "$ENV_FILE.bak"

echo
echo "✅ Configuration saved to .env"
echo

# Ask about running the bridge service
if [ "$SELF_HOSTED" = false ]; then
    echo "ℹ️  The lightweight integration layer is now configured."
    echo "   Your AppView will query Constellation API directly."
    echo
    read -p "Do you want to also run the full bridge service with health monitoring? [y/N]: " run_bridge
    
    if [[ "$run_bridge" =~ ^[Yy]$ ]]; then
        RUN_BRIDGE=true
    else
        RUN_BRIDGE=false
    fi
else
    echo "ℹ️  For self-hosted instances, we recommend running the bridge service."
    echo
    read -p "Run the bridge service? [Y/n]: " run_bridge
    
    if [[ "$run_bridge" =~ ^[Nn]$ ]]; then
        RUN_BRIDGE=false
    else
        RUN_BRIDGE=true
    fi
fi

# Start services
echo
echo "🚀 Starting services..."
echo

cd "$PROJECT_ROOT"

if [ "$RUN_BRIDGE" = true ]; then
    echo "Starting AppView with Constellation bridge..."
    docker-compose --profile constellation up -d --build
    
    echo
    echo "⏳ Waiting for services to be healthy..."
    sleep 5
    
    # Check bridge health
    if command -v curl &> /dev/null; then
        echo
        echo "🏥 Checking bridge health..."
        if curl -sf http://localhost:3003/health > /dev/null 2>&1; then
            echo "✅ Constellation bridge is healthy!"
            echo
            curl -s http://localhost:3003/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:3003/health
        else
            echo "⚠️  Bridge health check failed, but service may still be starting..."
            echo "   Check logs with: docker-compose logs constellation-bridge"
        fi
    fi
else
    echo "Restarting AppView with Constellation integration..."
    docker-compose restart app
    
    echo
    echo "⏳ Waiting for AppView to restart..."
    sleep 3
fi

echo
echo "✅ Constellation integration enabled!"
echo
echo "📋 Next steps:"
echo

if [ "$RUN_BRIDGE" = true ]; then
    echo "1. Check bridge status:"
    echo "   curl http://localhost:3003/health"
    echo
    echo "2. View bridge logs:"
    echo "   docker-compose logs -f constellation-bridge"
    echo
else
    echo "1. Check AppView logs for Constellation initialization:"
    echo "   docker-compose logs app | grep CONSTELLATION"
    echo
fi

echo "3. Test with a post URI:"
echo "   curl 'https://constellation.microcosm.blue/links/count?target=at://...&collection=app.bsky.feed.like&path=.subject.uri'"
echo

echo "4. Monitor stats in your feeds - counts should now be network-wide!"
echo

if [ "$SELF_HOSTED" = true ]; then
    echo "📝 Note: Make sure your self-hosted Constellation instance is running:"
    echo "   docker-compose --profile constellation-selfhosted up -d"
    echo
fi

echo "📚 For more information, see: microcosm-bridge/README.md"
