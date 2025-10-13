#!/bin/bash
# Quick script to check if firehose data is flowing to Redis

echo "🔍 Checking firehose data flow to Redis..."
echo ""

# Check if we can connect to Redis
echo "1. Testing Redis connection..."
if command -v redis-cli &> /dev/null; then
    REDIS_CLI="redis-cli"
elif command -v docker &> /dev/null; then
    REDIS_CLI="docker exec redis redis-cli"
else
    echo "❌ Neither redis-cli nor docker command found"
    exit 1
fi

if ! $REDIS_CLI PING &> /dev/null; then
    echo "❌ Cannot connect to Redis"
    exit 1
fi
echo "✅ Redis connection OK"
echo ""

# Check stream length
echo "2. Checking firehose stream length..."
STREAM_LEN=$($REDIS_CLI XLEN firehose:events 2>/dev/null || echo "0")
echo "   Stream 'firehose:events' has $STREAM_LEN events"
echo ""

# Check cursor
echo "3. Checking firehose cursor..."
CURSOR=$($REDIS_CLI GET firehose:python_cursor 2>/dev/null || echo "none")
echo "   Cursor: $CURSOR"
echo ""

# If stream has data, show sample
if [ "$STREAM_LEN" -gt 0 ]; then
    echo "✅ Firehose is working! Showing latest event:"
    echo ""
    $REDIS_CLI XREVRANGE firehose:events + - COUNT 1
    echo ""
    echo "Stream growth monitoring (press Ctrl+C to stop):"
    echo "Time | Stream Length"
    echo "-------------------"
    
    PREV_LEN=$STREAM_LEN
    while true; do
        sleep 2
        CURR_LEN=$($REDIS_CLI XLEN firehose:events 2>/dev/null || echo "0")
        DIFF=$((CURR_LEN - PREV_LEN))
        TIMESTAMP=$(date +"%H:%M:%S")
        
        if [ $DIFF -gt 0 ]; then
            echo "$TIMESTAMP | $CURR_LEN (+$DIFF) ✅"
        else
            echo "$TIMESTAMP | $CURR_LEN (no change) ⚠️"
        fi
        
        PREV_LEN=$CURR_LEN
    done
else
    echo "⚠️  Stream is empty. Possible issues:"
    echo ""
    echo "   A. Python firehose container is not running"
    echo "      → Check: docker ps | grep python-firehose"
    echo ""
    echo "   B. Python firehose has an error"
    echo "      → Check: docker logs python-firehose-1"
    echo ""
    echo "   C. Network connectivity to bsky.network is blocked"
    echo "      → Check firewall/network settings"
    echo ""
    echo "Waiting for data... (will check every 5 seconds, press Ctrl+C to stop)"
    
    while true; do
        sleep 5
        CURR_LEN=$($REDIS_CLI XLEN firehose:events 2>/dev/null || echo "0")
        TIMESTAMP=$(date +"%H:%M:%S")
        
        if [ "$CURR_LEN" -gt 0 ]; then
            echo "$TIMESTAMP | ✅ Data arrived! Stream length: $CURR_LEN"
            exit 0
        else
            echo "$TIMESTAMP | Still waiting... (length: 0)"
        fi
    done
fi
