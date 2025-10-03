#!/bin/bash

# Test health and readiness endpoints

source "$(dirname "$0")/config.sh"

echo "================================"
echo "Health & Readiness Tests"
echo "================================"
echo ""

# Test basic health check
make_request "GET" "/health"

# Test readiness check
make_request "GET" "/ready"

# Test server description (XRPC)
make_request "GET" "/xrpc/com.atproto.server.describeServer"
