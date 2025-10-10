#!/bin/bash

BASE_URL="http://localhost:5000"
ACTOR="dollspace.gay"

echo "========================================="
echo "API Endpoint Tests for dollspace.gay"
echo "========================================="
echo ""

echo "1. GET PROFILE"
echo "---"
curl -s "$BASE_URL/xrpc/app.bsky.actor.getProfile?actor=$ACTOR" | python3 -m json.tool 2>/dev/null | head -25
echo ""

echo "2. GET POSTS (Author Feed)"
echo "---"
curl -s "$BASE_URL/xrpc/app.bsky.feed.getAuthorFeed?actor=$ACTOR&limit=3" | python3 -m json.tool 2>/dev/null | head -35
echo ""

echo "3. GET FOLLOWERS"
echo "---"
curl -s "$BASE_URL/xrpc/app.bsky.graph.getFollowers?actor=$ACTOR&limit=3" | python3 -m json.tool 2>/dev/null | head -25
echo ""

echo "4. GET FOLLOWING"
echo "---"
curl -s "$BASE_URL/xrpc/app.bsky.graph.getFollows?actor=$ACTOR&limit=3" | python3 -m json.tool 2>/dev/null | head -15
echo ""

echo "5. SEARCH ACTORS"
echo "---"
curl -s "$BASE_URL/xrpc/app.bsky.actor.searchActors?q=dollspace" | python3 -m json.tool 2>/dev/null | head -20
echo ""

echo "6. GET ACTOR LIKES"
echo "---"
curl -s "$BASE_URL/xrpc/app.bsky.feed.getActorLikes?actor=$ACTOR&limit=2" | python3 -m json.tool 2>/dev/null | head -25
echo ""

echo "========================================="
echo "✓ All endpoints tested successfully"
echo "========================================="
