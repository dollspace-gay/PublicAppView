#!/bin/bash

# Test all actor/profile XRPC endpoints

source "$(dirname "$0")/config.sh"

echo "================================"
echo "Actor XRPC Tests"
echo "================================"
echo ""

# Get profile
make_request "GET" "/xrpc/app.bsky.actor.getProfile?actor=$TEST_DID"

# Get profiles (batch)
make_request "GET" "/xrpc/app.bsky.actor.getProfiles?actors=$TEST_DID"

# Get suggestions
make_request "GET" "/xrpc/app.bsky.actor.getSuggestions?limit=10"

# Search actors
make_request "GET" "/xrpc/app.bsky.actor.searchActors?q=test&limit=10"

# Search actors typeahead
make_request "GET" "/xrpc/app.bsky.actor.searchActorsTypeahead?q=test&limit=10"
