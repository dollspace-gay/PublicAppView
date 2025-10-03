#!/bin/bash

# Test authentication endpoints

source "$(dirname "$0")/config.sh"

echo "================================"
echo "Authentication Tests"
echo "================================"
echo ""

# Test create session (requires valid DID and tokens)
echo "Note: This will fail without valid PDS credentials"
make_request "POST" "/api/auth/create-session" '{
  "did": "'"$TEST_DID"'",
  "pdsEndpoint": "https://bsky.social",
  "accessToken": "dummy-token-for-testing",
  "refreshToken": "dummy-refresh-token"
}'

# Test get current session (requires authentication)
make_request "GET" "/api/auth/session"

# Test logout
make_request "POST" "/api/auth/logout"
