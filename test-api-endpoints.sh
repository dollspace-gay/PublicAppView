#!/bin/bash

# Comprehensive API Endpoint Tests for dollspace.gay
# Tests all major XRPC endpoints to verify data retrieval

BASE_URL="http://localhost:5000"
ACTOR="dollspace.gay"

echo "========================================="
echo "AT Protocol API Endpoint Tests"
echo "Testing Actor: $ACTOR"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

test_count=0
pass_count=0
fail_count=0

# Test function
run_test() {
    local name="$1"
    local endpoint="$2"
    local expected_field="$3"
    
    test_count=$((test_count + 1))
    echo -e "${YELLOW}Test $test_count: $name${NC}"
    echo "Endpoint: $endpoint"
    
    response=$(curl -s "$endpoint")
    
    # Check if response contains expected field or is valid JSON
    if echo "$response" | jq -e "$expected_field" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ PASS${NC}"
        echo "Response preview:"
        echo "$response" | jq -C "." 2>/dev/null | head -20
        pass_count=$((pass_count + 1))
    else
        echo -e "${RED}✗ FAIL${NC}"
        echo "Error response:"
        echo "$response" | jq -C "." 2>/dev/null || echo "$response"
        fail_count=$((fail_count + 1))
    fi
    echo ""
    echo "---"
    echo ""
}

# 1. Test: Get Actor Profile
run_test \
    "Get Actor Profile" \
    "$BASE_URL/xrpc/app.bsky.actor.getProfile?actor=$ACTOR" \
    ".did"

# 2. Test: Get Author Feed (Posts)
run_test \
    "Get Author Feed (Posts)" \
    "$BASE_URL/xrpc/app.bsky.feed.getAuthorFeed?actor=$ACTOR&limit=10" \
    ".feed"

# 3. Test: Get Followers
run_test \
    "Get Followers" \
    "$BASE_URL/xrpc/app.bsky.graph.getFollowers?actor=$ACTOR&limit=10" \
    ".followers"

# 4. Test: Get Following
run_test \
    "Get Following" \
    "$BASE_URL/xrpc/app.bsky.graph.getFollows?actor=$ACTOR&limit=10" \
    ".follows"

# 5. Test: Search Actors
run_test \
    "Search Actors" \
    "$BASE_URL/xrpc/app.bsky.actor.searchActors?q=dollspace&limit=10" \
    ".actors"

# 6. Test: Search Actors Typeahead
run_test \
    "Search Actors Typeahead" \
    "$BASE_URL/xrpc/app.bsky.actor.searchActorsTypeahead?q=dollspace&limit=5" \
    ".actors"

# 7. Test: Get Profiles (Batch)
run_test \
    "Get Profiles (Batch)" \
    "$BASE_URL/xrpc/app.bsky.actor.getProfiles?actors=$ACTOR" \
    ".profiles"

# 8. Test: Search Posts
run_test \
    "Search Posts" \
    "$BASE_URL/xrpc/app.bsky.feed.searchPosts?q=from:$ACTOR&limit=10" \
    ".posts"

# 9. Test: Get Actor Likes
run_test \
    "Get Actor Likes" \
    "$BASE_URL/xrpc/app.bsky.feed.getActorLikes?actor=$ACTOR&limit=10" \
    ".feed"

# 10. Test: Get Actor Feeds (Custom Feeds)
run_test \
    "Get Actor Feeds" \
    "$BASE_URL/xrpc/app.bsky.feed.getActorFeeds?actor=$ACTOR" \
    ".feeds"

# Summary
echo "========================================="
echo "Test Summary"
echo "========================================="
echo -e "Total Tests: $test_count"
echo -e "${GREEN}Passed: $pass_count${NC}"
echo -e "${RED}Failed: $fail_count${NC}"
echo ""

if [ $fail_count -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
fi
