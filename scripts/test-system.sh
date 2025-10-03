#!/bin/bash

# Test system monitoring and metrics endpoints

source "$(dirname "$0")/config.sh"

echo "================================"
echo "System Monitoring Tests"
echo "================================"
echo ""

# Test metrics endpoint
make_request "GET" "/api/metrics"

# Test lexicons endpoint
make_request "GET" "/api/lexicons"

# Test endpoints listing
make_request "GET" "/api/endpoints"

# Test database schema
make_request "GET" "/api/database/schema"

# Test recent events
make_request "GET" "/api/events/recent"

# Test logs
make_request "GET" "/api/logs"

# Test filter stats
make_request "GET" "/api/filter/stats"
