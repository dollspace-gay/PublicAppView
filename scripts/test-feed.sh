#!/bin/bash

# Test all feed-related XRPC endpoints

source "$(dirname "$0")/config.sh"

echo "================================"
echo "Feed XRPC Tests"
echo "================================"
echo ""

# Get timeline
make_request "GET" "/xrpc/app.bsky.feed.getTimeline?limit=10"

# Get author feed
make_request "GET" "/xrpc/app.bsky.feed.getAuthorFeed?actor=$TEST_DID&limit=10"

# Get post thread
make_request "GET" "/xrpc/app.bsky.feed.getPostThread?uri=$TEST_POST_URI"

# Search posts
make_request "GET" "/xrpc/app.bsky.feed.searchPosts?q=test&limit=10"

# Get posts (batch)
make_request "GET" "/xrpc/app.bsky.feed.getPosts?uris=$TEST_POST_URI"

# Get likes
make_request "GET" "/xrpc/app.bsky.feed.getLikes?uri=$TEST_POST_URI&limit=10"

# Get reposted by
make_request "GET" "/xrpc/app.bsky.feed.getRepostedBy?uri=$TEST_POST_URI&limit=10"

# Get quotes
make_request "GET" "/xrpc/app.bsky.feed.getQuotes?uri=$TEST_POST_URI&limit=10"

# Get actor likes
make_request "GET" "/xrpc/app.bsky.feed.getActorLikes?actor=$TEST_DID&limit=10"

# Get feed from generator
make_request "GET" "/xrpc/app.bsky.feed.getFeed?feed=at://did:plc:example/app.bsky.feed.generator/test&limit=10"

# Get feed generator
make_request "GET" "/xrpc/app.bsky.feed.getFeedGenerator?feed=at://did:plc:example/app.bsky.feed.generator/test"

# Get feed generators (batch)
make_request "GET" "/xrpc/app.bsky.feed.getFeedGenerators?feeds=at://did:plc:example/app.bsky.feed.generator/test"

# Get actor feeds
make_request "GET" "/xrpc/app.bsky.feed.getActorFeeds?actor=$TEST_DID&limit=10"

# Get suggested feeds
make_request "GET" "/xrpc/app.bsky.feed.getSuggestedFeeds?limit=10"

# Describe feed generator
make_request "GET" "/xrpc/app.bsky.feed.describeFeedGenerator"

# Get list feed
make_request "GET" "/xrpc/app.bsky.graph.getListFeed?list=at://did:plc:example/app.bsky.graph.list/test&limit=10"
