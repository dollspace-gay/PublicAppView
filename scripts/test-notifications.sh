#!/bin/bash

# Test notification XRPC endpoints

source "$(dirname "$0")/config.sh"

echo "================================"
echo "Notification XRPC Tests"
echo "================================"
echo ""

# List notifications
make_request "GET" "/xrpc/app.bsky.notification.listNotifications?limit=10"

# Get unread count
make_request "GET" "/xrpc/app.bsky.notification.getUnreadCount"

# Update seen (requires authentication)
make_request "POST" "/xrpc/app.bsky.notification.updateSeen" '{
  "seenAt": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'"
}'

# Register push (requires authentication)
make_request "POST" "/xrpc/app.bsky.notification.registerPush" '{
  "serviceDid": "did:web:push.example.com",
  "token": "test-push-token",
  "platform": "web",
  "appId": "com.example.app"
}'

# Put preferences (requires authentication)
make_request "POST" "/xrpc/app.bsky.notification.putPreferences" '{
  "priority": true
}'
