#!/bin/bash

# Test label endpoints

source "$(dirname "$0")/config.sh"

echo "================================"
echo "Label Tests"
echo "================================"
echo ""

# Get label definitions
make_request "GET" "/api/labels/definitions"

# Query labels
make_request "GET" "/api/labels/query?subject=$TEST_POST_URI&limit=10"

# Apply label (requires labeler auth)
make_request "POST" "/api/labels/apply" '{
  "subject": "'"$TEST_POST_URI"'",
  "val": "spam",
  "neg": false,
  "comment": "Spam content detected"
}'

# Delete label (requires labeler auth)
make_request "DELETE" "/api/labels/$TEST_POST_URI"

# Create label definition (requires admin auth)
make_request "POST" "/api/labels/definitions" '{
  "identifier": "custom-label",
  "severity": "inform",
  "blurs": "content",
  "locales": [{
    "lang": "en",
    "name": "Custom Label",
    "description": "A custom label for testing"
  }]
}'

# Get labeler services (XRPC)
make_request "GET" "/xrpc/app.bsky.labeler.getServices?dids=$TEST_DID"
