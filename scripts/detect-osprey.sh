#!/bin/bash
# Auto-detection script for Osprey installation
# Sets OSPREY_ENABLED environment variable if Osprey is found

OSPREY_DIR="./osprey"
BRIDGE_DIR="./osprey-bridge/firehose-to-kafka"

# Check if Osprey directory exists
if [ -d "$OSPREY_DIR" ]; then
  echo "✅ Osprey directory detected at $OSPREY_DIR"
  
  # Check if bridge is configured
  if [ -d "$BRIDGE_DIR" ]; then
    echo "✅ Osprey bridge configured"
    
    # Export for Docker Compose
    export OSPREY_ENABLED=true
    export COMPOSE_PROFILES=osprey
    
    echo "OSPREY_ENABLED=true" > .osprey-detected
    echo "true"
  else
    echo "⚠️  Osprey found but bridge not configured"
    echo "false"
  fi
else
  echo "ℹ️  Osprey not installed (no $OSPREY_DIR directory)"
  rm -f .osprey-detected
  echo "false"
fi
