#!/bin/bash

# Test post creation and interaction endpoints

source "$(dirname "$0")/config.sh"

echo "================================"
echo "Post & Interaction Tests"
echo "================================"
echo ""

# Create post (requires authentication)
make_request "POST" "/api/posts/create" '{
  "text": "Test post from API testing script",
  "createdAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'"
}'

# Create like (requires authentication)
make_request "POST" "/api/likes/create" '{
  "subject": {
    "uri": "'"$TEST_POST_URI"'",
    "cid": "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5ixbx7ydgvduvyzvvvve"
  },
  "createdAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'"
}'

# Delete like (requires authentication)
make_request "DELETE" "/api/likes/at://did:plc:example/app.bsky.feed.like/test123"

# Create follow (requires authentication)
make_request "POST" "/api/follows/create" '{
  "subject": "'"$TEST_DID"'",
  "createdAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'"
}'

# Delete follow (requires authentication)
make_request "DELETE" "/api/follows/at://did:plc:example/app.bsky.graph.follow/test123"
