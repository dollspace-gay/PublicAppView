#!/bin/bash

# Improved API Test - Validates actual data retrieval
BASE_URL="http://localhost:5000"
ACTOR="dollspace.gay"

echo "========================================="
echo "API Data Verification for dollspace.gay"
echo "========================================="
echo ""

# Test 1: Profile
echo "1. USER PROFILE"
echo "---"
profile=$(curl -s "$BASE_URL/xrpc/app.bsky.actor.getProfile?actor=$ACTOR")
echo "$profile" | jq '{
  did: .did,
  handle: .handle,
  displayName: .displayName,
  description: .description[:80],
  followersCount: .followersCount,
  followsCount: .followsCount,
  postsCount: .postsCount
}'
echo ""

# Test 2: Posts
echo "2. USER POSTS (Latest 3)"
echo "---"
feed=$(curl -s "$BASE_URL/xrpc/app.bsky.feed.getAuthorFeed?actor=$ACTOR&limit=3")
echo "$feed" | jq '.feed[] | {
  uri: .post.uri,
  text: .post.record.text,
  createdAt: .post.record.createdAt,
  likeCount: .post.likeCount,
  replyCount: .post.replyCount
}'
echo ""

# Test 3: Followers
echo "3. FOLLOWERS"
echo "---"
followers=$(curl -s "$BASE_URL/xrpc/app.bsky.graph.getFollowers?actor=$ACTOR&limit=5")
echo "$followers" | jq '{
  total: (.followers | length),
  followers: .followers[0:3] | map({did: .did, handle: .handle, displayName: .displayName})
}'
echo ""

# Test 4: Following
echo "4. FOLLOWING"
echo "---"
following=$(curl -s "$BASE_URL/xrpc/app.bsky.graph.getFollows?actor=$ACTOR&limit=5")
echo "$following" | jq '{
  total: (.follows | length),
  follows: .follows[0:3] | map({did: .did, handle: .handle})
}'
echo ""

# Test 5: Search
echo "5. SEARCH RESULTS"
echo "---"
search=$(curl -s "$BASE_URL/xrpc/app.bsky.actor.searchActors?q=dollspace&limit=3")
echo "$search" | jq '.actors[] | {
  did: .did,
  handle: .handle,
  displayName: .displayName
}'
echo ""

# Test 6: Likes
echo "6. LIKED POSTS"
echo "---"
likes=$(curl -s "$BASE_URL/xrpc/app.bsky.feed.getActorLikes?actor=$ACTOR&limit=3")
echo "$likes" | jq '{
  total: (.feed | length),
  likes: .feed[0:2] | map({
    text: .post.record.text[:60],
    author: .post.author.handle
  })
}'
echo ""

# Test 7: Specific post
echo "7. POST THREAD (If post exists)"
echo "---"
post_uri=$(echo "$feed" | jq -r '.feed[0].post.uri // empty')
if [ -n "$post_uri" ]; then
  thread=$(curl -s "$BASE_URL/xrpc/app.bsky.feed.getPostThread?uri=$post_uri")
  echo "$thread" | jq '.thread.post | {
    text: .record.text,
    author: .author.handle,
    createdAt: .record.createdAt,
    replyCount: .replyCount,
    likeCount: .likeCount
  }'
else
  echo "No posts found"
fi
echo ""

# Test 8: Batch profile lookup
echo "8. BATCH PROFILE LOOKUP"
echo "---"
profiles=$(curl -s "$BASE_URL/xrpc/app.bsky.actor.getProfiles?actors=$ACTOR")
echo "$profiles" | jq '.profiles[] | {
  handle: .handle,
  displayName: .displayName,
  postsCount: .postsCount,
  followersCount: .followersCount
}'
echo ""

echo "========================================="
echo "✓ API Data Verification Complete"
echo "========================================="
