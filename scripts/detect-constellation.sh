#!/bin/bash

# Detect and report Constellation integration status

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"

echo "🔍 Constellation Integration Status"
echo "===================================="
echo

# Check .env configuration
if [ -f "$ENV_FILE" ]; then
    CONSTELLATION_ENABLED=$(grep "^CONSTELLATION_ENABLED=" "$ENV_FILE" | cut -d'=' -f2 || echo "false")
    CONSTELLATION_URL=$(grep "^CONSTELLATION_URL=" "$ENV_FILE" | cut -d'=' -f2 || echo "not set")
    CONSTELLATION_CACHE_TTL=$(grep "^CONSTELLATION_CACHE_TTL=" "$ENV_FILE" | cut -d'=' -f2 || echo "not set")
    
    echo "📝 Configuration (.env):"
    echo "   CONSTELLATION_ENABLED: $CONSTELLATION_ENABLED"
    echo "   CONSTELLATION_URL: $CONSTELLATION_URL"
    echo "   CONSTELLATION_CACHE_TTL: $CONSTELLATION_CACHE_TTL"
    echo
else
    echo "⚠️  No .env file found"
    CONSTELLATION_ENABLED="false"
    echo
fi

# Check if Docker containers are running
cd "$PROJECT_ROOT"

if command -v docker-compose &> /dev/null; then
    echo "🐳 Docker Services:"
    
    # Check AppView
    if docker-compose ps app | grep -q "Up"; then
        echo "   ✅ AppView: Running"
        
        # Check logs for Constellation initialization
        if docker-compose logs app 2>/dev/null | grep -q "CONSTELLATION.*enabled"; then
            echo "      ✅ Constellation integration active in AppView"
        elif [ "$CONSTELLATION_ENABLED" = "true" ]; then
            echo "      ⚠️  Constellation enabled in .env but not initialized"
            echo "         (AppView may need restart)"
        else
            echo "      ℹ️  Constellation integration not enabled"
        fi
    else
        echo "   ❌ AppView: Not running"
    fi
    
    # Check Constellation bridge
    if docker-compose ps constellation-bridge 2>/dev/null | grep -q "Up"; then
        echo "   ✅ Constellation Bridge: Running"
        
        # Check health endpoint
        if command -v curl &> /dev/null; then
            if curl -sf http://localhost:3003/health > /dev/null 2>&1; then
                echo "      ✅ Health check: Passing"
                
                # Get stats
                STATS=$(curl -s http://localhost:3003/stats 2>/dev/null)
                if [ -n "$STATS" ]; then
                    echo "      📊 Stats:"
                    echo "$STATS" | grep -E 'hitRate|statsRequested' | sed 's/^/         /'
                fi
            else
                echo "      ⚠️  Health check: Failed"
            fi
        fi
    else
        if docker-compose config --profiles 2>/dev/null | grep -q "constellation"; then
            echo "   ℹ️  Constellation Bridge: Available but not running"
            echo "      (Start with: docker-compose --profile constellation up -d)"
        else
            echo "   ℹ️  Constellation Bridge: Not configured"
        fi
    fi
    
    # Check Redis
    if docker-compose ps redis 2>/dev/null | grep -q "Up"; then
        echo "   ✅ Redis: Running"
        
        # Check for constellation cache keys
        if docker-compose exec -T redis redis-cli --no-auth-warning keys "constellation:*" 2>/dev/null | grep -q "constellation"; then
            KEY_COUNT=$(docker-compose exec -T redis redis-cli --no-auth-warning keys "constellation:*" 2>/dev/null | wc -l)
            echo "      📦 Cached items: $KEY_COUNT"
        else
            echo "      📦 Cached items: 0"
        fi
    else
        echo "   ❌ Redis: Not running (required for caching)"
    fi
    
    echo
fi

# Check Constellation API connectivity
echo "🌐 API Connectivity:"

if command -v curl &> /dev/null; then
    if [ "$CONSTELLATION_URL" != "not set" ] && [ "$CONSTELLATION_URL" != "" ]; then
        API_URL="${CONSTELLATION_URL//\"/}"  # Remove quotes
        
        echo "   Testing: $API_URL"
        
        if curl -sf -m 5 "$API_URL/" > /dev/null 2>&1; then
            echo "   ✅ Constellation API: Accessible"
            
            # Try a test query
            TEST_URI="at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3kgl53jfg2s2w"
            RESPONSE=$(curl -sf -m 5 "${API_URL}/links/count?target=${TEST_URI}&collection=app.bsky.feed.like&path=.subject.uri" 2>/dev/null)
            
            if [ -n "$RESPONSE" ]; then
                echo "   ✅ Test query successful (count: $RESPONSE)"
            fi
        else
            echo "   ❌ Constellation API: Not accessible"
            echo "      This may be normal if using a self-hosted instance that's not running"
        fi
    else
        echo "   ⚠️  No Constellation URL configured"
    fi
else
    echo "   ⚠️  curl not available, skipping connectivity test"
fi

echo
echo "📊 Summary:"

if [ "$CONSTELLATION_ENABLED" = "true" ]; then
    echo "   ✅ Constellation integration is ENABLED"
    echo
    echo "   Your AppView will use Constellation for:"
    echo "   • Accurate like/repost/reply counts"
    echo "   • Cross-app interaction visibility"
    echo "   • Network-wide statistics"
    echo
    
    if docker-compose ps constellation-bridge 2>/dev/null | grep -q "Up"; then
        echo "   ℹ️  Mode: Full bridge service with health monitoring"
        echo "      Health: http://localhost:3003/health"
        echo "      Stats:  http://localhost:3003/stats"
    else
        echo "   ℹ️  Mode: Lightweight integration (direct API calls)"
        echo "      The AppView queries Constellation API directly"
    fi
else
    echo "   ℹ️  Constellation integration is DISABLED"
    echo
    echo "   To enable, run:"
    echo "   ./scripts/enable-constellation.sh"
fi

echo
echo "📚 Documentation: microcosm-bridge/README.md"
