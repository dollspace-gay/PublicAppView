#!/bin/bash

# Test moderation endpoints

source "$(dirname "$0")/config.sh"

echo "================================"
echo "Moderation Tests"
echo "================================"
echo ""

# Create report (XRPC)
make_request "POST" "/xrpc/app.bsky.moderation.createReport" '{
  "reasonType": "com.atproto.moderation.defs#reasonSpam",
  "subject": {
    "$type": "com.atproto.repo.strongRef",
    "uri": "'"$TEST_POST_URI"'",
    "cid": "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5ixbx7ydgvduvyzvvvve"
  },
  "reason": "Test spam report"
}'

# Query labels (XRPC)
make_request "GET" "/xrpc/com.atproto.label.queryLabels?uriPatterns=$TEST_POST_URI"

# Get moderation queue (requires moderator auth)
make_request "GET" "/api/moderation/queue?status=pending&limit=10"

# Get moderation report (requires moderator auth)
make_request "GET" "/api/moderation/report/1"

# Assign moderator (requires admin auth)
make_request "POST" "/api/moderation/assign" '{
  "reportId": 1,
  "moderatorDid": "'"$TEST_DID"'"
}'

# Take moderation action (requires moderator auth)
make_request "POST" "/api/moderation/action" '{
  "reportId": 1,
  "action": "acknowledge",
  "reason": "Reviewed and acknowledged"
}'

# Dismiss report (requires moderator auth)
make_request "POST" "/api/moderation/dismiss" '{
  "reportId": 1,
  "reason": "Not a violation"
}'

# Escalate report (requires moderator auth)
make_request "POST" "/api/moderation/escalate" '{
  "reportId": 1,
  "reason": "Needs senior review"
}'

# Get moderator workload (requires moderator auth)
make_request "GET" "/api/moderation/workload/$TEST_DID"
