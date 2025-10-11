#!/bin/bash

# A script to authenticate with Bluesky and fetch the user's timeline.
# This version automatically discovers the user's PDS.
#
# USAGE:
#   ./fetch_timeline.sh your-handle.bsky.social your-app-password
#
# DEPENDENCIES:
#   - curl: For making HTTP requests.
#   - jq: For parsing JSON responses. (Install with: sudo apt-get install jq / brew install jq)

set -e # Exit immediately if any command fails

# --- CONFIGURATION ---
# The AppView to fetch the timeline from.
# Set this to your custom AppView for testing or leave as the official one.
APPVIEW_HOST="https://appview.dollspace.gay"

# --- 1. CHECK DEPENDENCIES & ARGUMENTS ---

# Check for jq
if ! command -v jq &> /dev/null; then
    echo "Error: 'jq' is not installed. Please install it to proceed."
    echo "e.g., sudo apt-get install jq or brew install jq"
    exit 1
fi

# Check for curl
if ! command -v curl &> /dev/null; then
    echo "Error: 'curl' is not installed. Please install it to proceed."
    exit 1
fi

# Check for command-line arguments
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <handle> <app-password>"
    exit 1
fi

HANDLE=$1
APP_PASSWORD=$2

# --- 2. RESOLVE HANDLE TO FIND PDS ---

echo "🔎 Resolving handle '$HANDLE' to find user's PDS..."

# Step 2a: Resolve the handle to get the user's DID
# This asks a public server (bsky.social) what DID corresponds to the handle.
DID_RESPONSE=$(curl -s "https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=$HANDLE")
DID=$(echo "$DID_RESPONSE" | jq -r '.did')

if [ "$DID" == "null" ] || [ -z "$DID" ]; then
    echo "❌ Error: Could not resolve handle '$HANDLE' to a DID."
    echo "Server response:"
    echo "$DID_RESPONSE" | jq .
    exit 1
fi

echo "✅ Found DID: $DID"

# Step 2b: Use the DID to look up the user's DID Document from the PLC directory
# The DID Document contains the user's actual PDS address.
DID_DOC=$(curl -s "https://plc.directory/$DID")
PDS_HOST=$(echo "$DID_DOC" | jq -r '.service[] | select(.id == "#atproto_pds") | .serviceEndpoint')

if [ "$PDS_HOST" == "null" ] || [ -z "$PDS_HOST" ]; then
    echo "❌ Error: Could not find PDS host in DID document for $DID."
    echo "DID Document:"
    echo "$DID_DOC" | jq .
    exit 1
fi

echo "✅ Found PDS Host: $PDS_HOST"

# --- 3. AUTHENTICATE AND GET TOKEN ---

echo "🔐 Authenticating with PDS: $PDS_HOST..."

# Capture the full JSON response from the server first for better error handling
SESSION_RESPONSE=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d "{\"identifier\": \"$HANDLE\", \"password\": \"$APP_PASSWORD\"}" \
  "$PDS_HOST/xrpc/com.atproto.server.createSession")

# Now, extract the access token from the response
TOKEN=$(echo "$SESSION_RESPONSE" | jq -r '.accessJwt' || echo "null")

# Verify that we got a token
if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
    echo "❌ Authentication failed. Server response:"
    echo "$SESSION_RESPONSE" | jq .
    echo "Please check your handle and app password."
    exit 1
fi

echo "✅ Successfully obtained access token."

# --- 3a. DECODE TOKEN FOR DEBUGGING ---
# This part is useful for verifying the contents of the token itself.
# The 'sub' field should match the DID we found earlier.
echo "--- DEBUG: Decoding Access Token Payload ---"
DECODED_PAYLOAD=$(echo "$TOKEN" | jq -R 'split(".") | .[1] | @base64d | fromjson' 2>/dev/null || echo "{}")
echo "$DECODED_PAYLOAD" | jq .
echo "------------------------------------------"


# --- 4. FETCH THE TIMELINE ---

echo "📄 Fetching timeline from AppView: $APPVIEW_HOST..."

# Use the captured token in the Authorization header to make an authenticated request.
TIMELINE_RESPONSE=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$APPVIEW_HOST/xrpc/app.bsky.feed.getTimeline?limit=25")


# --- 5. OUTPUT THE RESULT ---

echo "--- TIMELINE RESPONSE ---"
# Pipe the response to jq for pretty-printing if it's valid JSON
if echo "$TIMELINE_RESPONSE" | jq . &> /dev/null; then
    echo "$TIMELINE_RESPONSE" | jq .
else
    echo "❌ Failed to fetch timeline or response was not valid JSON:"
    echo "$TIMELINE_RESPONSE"
fi