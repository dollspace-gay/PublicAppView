#!/bin/bash

# Test all graph/relationship XRPC endpoints

source "$(dirname "$0")/config.sh"

echo "================================"
echo "Graph XRPC Tests"
echo "================================"
echo ""

# Get follows
make_request "GET" "/xrpc/app.bsky.graph.getFollows?actor=$TEST_DID&limit=10"

# Get followers
make_request "GET" "/xrpc/app.bsky.graph.getFollowers?actor=$TEST_DID&limit=10"

# Get blocks
make_request "GET" "/xrpc/app.bsky.graph.getBlocks?limit=10"

# Get mutes
make_request "GET" "/xrpc/app.bsky.graph.getMutes?limit=10"

# Get relationships
make_request "GET" "/xrpc/app.bsky.graph.getRelationships?actor=$TEST_DID&others=$TEST_DID"

# Get known followers
make_request "GET" "/xrpc/app.bsky.graph.getKnownFollowers?actor=$TEST_DID&limit=10"

# Get suggested follows by actor
make_request "GET" "/xrpc/app.bsky.graph.getSuggestedFollowsByActor?actor=$TEST_DID&limit=10"

# Get list
make_request "GET" "/xrpc/app.bsky.graph.getList?list=at://did:plc:example/app.bsky.graph.list/test&limit=10"

# Get lists
make_request "GET" "/xrpc/app.bsky.graph.getLists?actor=$TEST_DID&limit=10"

# Get list mutes
make_request "GET" "/xrpc/app.bsky.graph.getListMutes?limit=10"

# Get list blocks
make_request "GET" "/xrpc/app.bsky.graph.getListBlocks?limit=10"

# Get starter pack
make_request "GET" "/xrpc/app.bsky.graph.getStarterPack?starterPack=at://did:plc:example/app.bsky.graph.starterpack/test"

# Get starter packs
make_request "GET" "/xrpc/app.bsky.graph.getStarterPacks?uris=at://did:plc:example/app.bsky.graph.starterpack/test"

# Mute actor (requires authentication)
make_request "POST" "/xrpc/app.bsky.graph.muteActor" '{
  "actor": "'"$TEST_DID"'"
}'

# Unmute actor (requires authentication)
make_request "POST" "/xrpc/app.bsky.graph.unmuteActor" '{
  "actor": "'"$TEST_DID"'"
}'

# Mute actor list (requires authentication)
make_request "POST" "/xrpc/app.bsky.graph.muteActorList" '{
  "list": "at://did:plc:example/app.bsky.graph.list/test"
}'

# Unmute actor list (requires authentication)
make_request "POST" "/xrpc/app.bsky.graph.unmuteActorList" '{
  "list": "at://did:plc:example/app.bsky.graph.list/test"
}'

# Mute thread (requires authentication)
make_request "POST" "/xrpc/app.bsky.graph.muteThread" '{
  "root": "'"$TEST_POST_URI"'"
}'
