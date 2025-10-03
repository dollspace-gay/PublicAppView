#!/bin/bash

# Test video XRPC endpoints

source "$(dirname "$0")/config.sh"

echo "================================"
echo "Video XRPC Tests"
echo "================================"
echo ""

# Get job status
make_request "GET" "/xrpc/app.bsky.video.getJobStatus?jobId=test-job-123"

# Get upload limits
make_request "GET" "/xrpc/app.bsky.video.getUploadLimits"
