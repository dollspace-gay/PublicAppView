#!/bin/bash
set -e

echo "🔍 Checking for Osprey installation..."

# Check if osprey directory exists
if [ -d "./osprey" ]; then
  echo "✅ Osprey directory found at ./osprey"
  
  # Check for required files
  if [ -f "./osprey-bridge/firehose-to-kafka/package.json" ]; then
    echo "✅ Osprey bridge configuration found"
    
    # Set environment variable
    export OSPREY_ENABLED=true
    export COMPOSE_PROFILES=osprey
    
    echo ""
    echo "🚀 Starting services with Osprey integration enabled..."
    echo ""
    
    # Start with osprey profile
    docker-compose --profile osprey up -d --build
    
    echo ""
    echo "✅ Osprey integration enabled successfully!"
    echo ""
    echo "Monitor bridge logs:"
    echo "  docker-compose logs -f osprey-bridge"
    echo ""
    echo "Check Kafka topics:"
    echo "  docker-compose exec kafka kafka-topics --list --bootstrap-server localhost:9092"
    echo ""
    
  else
    echo "❌ Osprey bridge not found. Please ensure osprey-bridge/ directory exists."
    exit 1
  fi
else
  echo "⚠️  Osprey directory not found."
  echo ""
  echo "To enable Osprey labeling:"
  echo "  1. Clone Osprey: git clone https://github.com/roostorg/osprey.git"
  echo "  2. Add AT Proto module: cd osprey && git submodule add https://github.com/bluesky-social/osprey-atproto.git"
  echo "  3. Re-run this script: ./scripts/enable-osprey.sh"
  echo ""
  echo "Starting without Osprey integration..."
  docker-compose up -d
fi
