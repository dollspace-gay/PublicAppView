#!/bin/bash
set -e

echo "🧪 Testing Kafka integration..."
echo ""

# Check if Kafka is running
if ! docker-compose ps kafka | grep -q "Up"; then
  echo "❌ Kafka is not running. Start with:"
  echo "   docker-compose --profile osprey up -d"
  exit 1
fi

echo "✅ Kafka is running"
echo ""

# List topics
echo "📋 Kafka topics:"
docker-compose exec -T kafka kafka-topics --list --bootstrap-server localhost:9092
echo ""

# Check if bridge is publishing
echo "📊 Recent messages from atproto.firehose.enriched topic:"
echo "   (Press Ctrl+C to stop)"
echo ""

docker-compose exec -T kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic atproto.firehose.enriched \
  --from-beginning \
  --max-messages 5 \
  --timeout-ms 10000 || echo "No messages found yet. Bridge may still be starting up."

echo ""
echo "✅ Kafka test complete"
