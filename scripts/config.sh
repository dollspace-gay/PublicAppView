#!/bin/bash

# Base configuration for all test scripts
export BASE_URL="http://localhost:5000"
export SESSION_TOKEN=""
export TEST_DID="did:plc:example123"
export TEST_HANDLE="user.bsky.social"
export TEST_POST_URI="at://did:plc:example123/app.bsky.feed.post/abc123"

# Colors for output
export GREEN='\033[0;32m'
export RED='\033[0;31m'
export YELLOW='\033[1;33m'
export NC='\033[0m' # No Color

# Helper function to make requests
make_request() {
    local method=$1
    local endpoint=$2
    local data=$3
    local auth_header=""
    
    if [ -n "$SESSION_TOKEN" ]; then
        auth_header="-H \"Authorization: Bearer $SESSION_TOKEN\""
    fi
    
    echo -e "${YELLOW}Testing $method $endpoint${NC}"
    
    if [ -n "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            $auth_header \
            -d "$data")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint" \
            $auth_header)
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    echo "Status: $http_code"
    
    if command -v jq &> /dev/null; then
        echo "$body" | jq '.' 2>/dev/null || echo "$body"
    else
        echo "$body"
    fi
    
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 400 ]; then
        echo -e "${GREEN}✓ PASS${NC}\n"
        return 0
    else
        echo -e "${RED}✗ FAIL${NC}\n"
        return 1
    fi
}
