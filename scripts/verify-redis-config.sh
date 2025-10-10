#!/bin/bash
# Verification script for Redis firehose configuration
# This script verifies that all Redis fixes have been properly applied

set -e

echo "🔍 Verifying Redis Firehose Configuration..."
echo "=============================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check Redis config
check_redis_config() {
    echo "📊 Checking Redis Configuration..."
    
    # Get Redis container name
    REDIS_CONTAINER=$(docker ps --filter "ancestor=redis:7-alpine" --format "{{.Names}}" | head -1)
    
    if [ -z "$REDIS_CONTAINER" ]; then
        echo -e "${RED}❌ Redis container not found. Is it running?${NC}"
        return 1
    fi
    
    echo "   Redis container: $REDIS_CONTAINER"
    
    # Check maxmemory-policy
    POLICY=$(docker exec $REDIS_CONTAINER redis-cli CONFIG GET maxmemory-policy | tail -1)
    if [ "$POLICY" = "noeviction" ]; then
        echo -e "   ${GREEN}✅ Eviction policy: noeviction (correct)${NC}"
    else
        echo -e "   ${RED}❌ Eviction policy: $POLICY (should be noeviction)${NC}"
        return 1
    fi
    
    # Check AOF persistence
    AOF=$(docker exec $REDIS_CONTAINER redis-cli CONFIG GET appendonly | tail -1)
    if [ "$AOF" = "yes" ]; then
        echo -e "   ${GREEN}✅ AOF persistence: enabled${NC}"
    else
        echo -e "   ${RED}❌ AOF persistence: disabled (should be enabled)${NC}"
        return 1
    fi
    
    # Check appendfsync
    SYNC=$(docker exec $REDIS_CONTAINER redis-cli CONFIG GET appendfsync | tail -1)
    if [ "$SYNC" = "everysec" ]; then
        echo -e "   ${GREEN}✅ AOF sync: everysec (correct)${NC}"
    else
        echo -e "   ${YELLOW}⚠️  AOF sync: $SYNC (recommended: everysec)${NC}"
    fi
    
    echo ""
}

# Function to check stream status
check_stream_status() {
    echo "📈 Checking Firehose Stream Status..."
    
    REDIS_CONTAINER=$(docker ps --filter "ancestor=redis:7-alpine" --format "{{.Names}}" | head -1)
    
    # Check if stream exists
    STREAM_LEN=$(docker exec $REDIS_CONTAINER redis-cli XLEN firehose:events 2>/dev/null || echo "0")
    echo "   Stream length: $STREAM_LEN events"
    
    if [ "$STREAM_LEN" -gt 0 ]; then
        # Check consumer group
        GROUP_INFO=$(docker exec $REDIS_CONTAINER redis-cli XINFO GROUPS firehose:events 2>/dev/null || echo "")
        if [ -n "$GROUP_INFO" ]; then
            echo -e "   ${GREEN}✅ Consumer group exists: firehose-processors${NC}"
            
            # Check for pending messages
            PENDING=$(docker exec $REDIS_CONTAINER redis-cli XPENDING firehose:events firehose-processors 2>/dev/null | head -1)
            echo "   Pending messages: $PENDING"
        else
            echo -e "   ${YELLOW}⚠️  Consumer group not found (may not be created yet)${NC}"
        fi
    else
        echo -e "   ${YELLOW}⚠️  Stream is empty (no events ingested yet)${NC}"
    fi
    
    echo ""
}

# Function to check queue depth
check_queue_depth() {
    echo "📊 Checking Queue Backlog (pending)..."
    
    # Try to get metrics from API
    METRICS=$(curl -s http://localhost:5000/api/metrics 2>/dev/null || echo "{}")
    
    if [ "$METRICS" = "{}" ]; then
        echo -e "   ${YELLOW}⚠️  Cannot reach API endpoint (is the app running?)${NC}"
        return 0
    fi
    
    QUEUE_DEPTH=$(echo $METRICS | jq -r '.firehoseStatus.queueDepth // 0' 2>/dev/null || echo "0")
    STREAM_LEN=$(echo $METRICS | jq -r '.firehoseStatus.streamLength // 0' 2>/dev/null || echo "0")
    DEADLETTERS=$(echo $METRICS | jq -r '.firehoseStatus.deadLetterLength // 0' 2>/dev/null || echo "0")
    CONNECTED=$(echo $METRICS | jq -r '.firehoseStatus.isConnected // false' 2>/dev/null || echo "false")

    echo "   Pending (XPENDING): $QUEUE_DEPTH"
    echo "   Stream length (XLEN): $STREAM_LEN"
    echo "   Dead letters: $DEADLETTERS"
    echo "   Firehose connected: $CONNECTED"

    if [ "$QUEUE_DEPTH" -gt 200000 ]; then
        echo -e "   ${RED}❌ CRITICAL: Pending >200k - workers falling behind!${NC}"
    elif [ "$QUEUE_DEPTH" -gt 80000 ]; then
        echo -e "   ${YELLOW}⚠️  WARNING: Pending >80k - monitor workers${NC}"
    else
        echo -e "   ${GREEN}✅ Pending backlog healthy${NC}"
    fi
    
    echo ""
}

# Function to check data volume
check_data_volume() {
    echo "💾 Checking Data Persistence..."
    
    # Check if redis_data volume exists
    VOLUME=$(docker volume ls | grep redis_data || echo "")
    
    if [ -n "$VOLUME" ]; then
        echo -e "   ${GREEN}✅ Redis data volume exists${NC}"
        
        # Get volume size
        SIZE=$(docker volume inspect redis_data | jq -r '.[0].Mountpoint' 2>/dev/null || echo "")
        if [ -n "$SIZE" ]; then
            echo "   Volume mountpoint: $SIZE"
        fi
    else
        echo -e "   ${RED}❌ Redis data volume not found${NC}"
        echo "      This means AOF data will be lost on container restart!"
        return 1
    fi
    
    echo ""
}

# Function to check for errors in logs
check_logs() {
    echo "📋 Checking Recent Logs for Issues..."
    
    APP_CONTAINER=$(docker ps --filter "name=app" --format "{{.Names}}" | head -1)
    
    if [ -z "$APP_CONTAINER" ]; then
        echo -e "   ${YELLOW}⚠️  App container not found${NC}"
        return 0
    fi
    
    # Check for NOGROUP errors (shouldn't happen with fixes)
    NOGROUP_ERRORS=$(docker logs $APP_CONTAINER 2>&1 | grep -c "NOGROUP" 2>/dev/null || echo "0")
    if [ "$NOGROUP_ERRORS" -gt 0 ]; then
        echo -e "   ${RED}❌ Found $NOGROUP_ERRORS NOGROUP errors (stream recreation issues)${NC}"
    else
        echo -e "   ${GREEN}✅ No NOGROUP errors${NC}"
    fi
    
    # Check for queue depth warnings
    QUEUE_WARNINGS=$(docker logs $APP_CONTAINER 2>&1 | grep -c "Queue depth" 2>/dev/null || echo "0")
    if [ "$QUEUE_WARNINGS" -gt 0 ]; then
        echo -e "   ${YELLOW}⚠️  Found $QUEUE_WARNINGS queue depth warnings${NC}"
        echo "      Recent warnings:"
        docker logs $APP_CONTAINER 2>&1 | grep "Queue depth" | tail -3
    else
        echo -e "   ${GREEN}✅ No queue depth warnings${NC}"
    fi
    
    echo ""
}

# Run all checks
check_redis_config
check_stream_status
check_queue_depth
check_data_volume
check_logs

echo "=============================================="
echo -e "${GREEN}✅ Redis firehose verification complete!${NC}"
echo ""
echo "Key Metrics to Monitor:"
echo "  - Queue depth should stay < 100k"
echo "  - Firehose should be connected"
echo "  - No NOGROUP errors in logs"
echo "  - Redis eviction policy = noeviction"
echo "  - AOF persistence enabled"
