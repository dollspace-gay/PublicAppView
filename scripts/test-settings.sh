#!/bin/bash

# Test user settings endpoints

source "$(dirname "$0")/config.sh"

echo "================================"
echo "Settings Tests"
echo "================================"
echo ""

# Get settings (requires authentication)
make_request "GET" "/api/settings"

# Update settings (requires authentication)
make_request "PUT" "/api/settings" '{
  "blockedKeywords": ["spam", "test"],
  "mutedUsers": [],
  "feedAlgorithm": "reverse-chronological"
}'

# Block keyword (requires authentication)
make_request "POST" "/api/settings/keywords/block" '{
  "keyword": "unwanted"
}'

# Unblock keyword (requires authentication)
make_request "DELETE" "/api/settings/keywords/spam"

# Mute user (requires authentication)
make_request "POST" "/api/settings/users/mute" '{
  "did": "'"$TEST_DID"'"
}'

# Unmute user (requires authentication)
make_request "DELETE" "/api/settings/users/mute/$TEST_DID"

# Update feed preferences (requires authentication)
make_request "PUT" "/api/settings/feed" '{
  "feedAlgorithm": "engagement",
  "showReplies": true,
  "showReposts": true,
  "showQuotes": true
}'
