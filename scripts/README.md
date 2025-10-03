# API Testing Scripts

This directory contains shell scripts to test all API endpoints of the AT Protocol App View installation.

## Setup

1. **Configure Environment**

Edit `config.sh` to set your instance details:
```bash
export BASE_URL="http://localhost:5000"
export SESSION_TOKEN="your-session-token-here"
export TEST_DID="did:plc:test123"
export TEST_HANDLE="user.bsky.social"
export TEST_POST_URI="at://did:plc:example123/app.bsky.feed.post/abc123"
```

**Required Configuration Variables:**
- `BASE_URL`: The base URL of your AppView instance (e.g., `http://localhost:5000`)
- `SESSION_TOKEN`: Authentication token obtained from the create-session endpoint (optional for health checks)
- `TEST_DID`: A valid DID from your instance for testing actor endpoints (e.g., `did:plc:z72i7hdynmk6r22z27h6tvur`)
- `TEST_HANDLE`: A valid handle from your instance (e.g., `user.bsky.social`)
- `TEST_POST_URI`: A valid post URI from your instance (e.g., `at://did:plc:example/app.bsky.feed.post/3jzxbla`)

**Note:** Most endpoint tests require valid DIDs, handles, and URIs that exist in your instance. You can obtain these by:
1. Checking the `/api/endpoints` endpoint for live data
2. Using the dashboard at `/` to browse existing records
3. Creating test records through the authentication flow

2. **Make Scripts Executable**
```bash
chmod +x scripts/*.sh
```

## Usage

### Health & System Tests
```bash
./scripts/test-health.sh        # Test health and readiness endpoints
./scripts/test-system.sh        # Test system metrics and monitoring
```

### Authentication Tests
```bash
./scripts/test-auth.sh          # Test authentication endpoints
```

### XRPC Feed Tests
```bash
./scripts/test-feed.sh          # Test all feed-related XRPC endpoints
```

### XRPC Actor Tests
```bash
./scripts/test-actor.sh         # Test all actor/profile XRPC endpoints
```

### XRPC Graph Tests
```bash
./scripts/test-graph.sh         # Test all graph/relationship XRPC endpoints
```

### XRPC Notification Tests
```bash
./scripts/test-notifications.sh # Test notification XRPC endpoints
```

### XRPC Video Tests
```bash
./scripts/test-video.sh         # Test video XRPC endpoints
```

### Moderation Tests
```bash
./scripts/test-moderation.sh    # Test moderation endpoints
```

### Label Tests
```bash
./scripts/test-labels.sh        # Test label endpoints
```

### Settings Tests
```bash
./scripts/test-settings.sh      # Test user settings endpoints
```

### Run All Tests
```bash
./scripts/test-all.sh           # Run all endpoint tests
```

## Test Output

Each script will:
- Print the endpoint being tested
- Show the HTTP status code
- Display the response body
- Indicate success/failure

Example output:
```
Testing GET /health
Status: 200
Response: {"status":"ok"}
✓ PASS
```

## Authentication

Most XRPC endpoints require authentication. To obtain a session token:

1. Use the `test-auth.sh` script to create a session
2. Copy the `sessionToken` from the response
3. Update `SESSION_TOKEN` in `config.sh`

## Notes

- These scripts use `curl` for HTTP requests
- `jq` is recommended for pretty-printing JSON (optional)
- Scripts will fail gracefully if endpoints are unavailable
- Check your instance logs if tests fail unexpectedly
