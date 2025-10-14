# Feed Generator Discovery

## Problem

When running an AppView without a full historical backfill, you miss feed generator (`app.bsky.feed.generator`) records that were created before your instance started listening to the relay. This means users can't discover or use those feeds on your instance.

## Solution

This AppView now includes a **Feed Generator Discovery Service** that provides AT Protocol-compliant alternatives to full relay backfill by querying PDS instances directly:

### Automatic Discovery (Default Behavior)

**When a feed generator is detected through the firehose**, the AppView automatically:
1. Resolves the creator's PDS endpoint
2. Queries `com.atproto.repo.listRecords` to enumerate ALL feed generators from that creator
3. Indexes any additional feeds discovered
4. Implements a 24-hour cooldown to avoid duplicate scans

This means you automatically discover all feeds from any creator as soon as you encounter one of their feeds!

### Manual Discovery Methods

You can also manually trigger discovery:

#### 1. Refresh from Known Creators
Scan repositories of users who have already published feed generators (discovered through the firehose) to catch any new feeds they've published.

#### 2. Scan Specific User Repositories
Use `com.atproto.repo.listRecords` to enumerate all feed generators published by specific users. Provide a curated list of known feed generator creators.

#### 3. Index Specific Feed URIs
Manually fetch and index individual feed generators by their AT URI using `com.atproto.repo.getRecord`.

**Note**: This service queries PDS instances directly, NOT other AppViews. It uses proper AT Protocol methods (`com.atproto.repo.listRecords` and `com.atproto.repo.getRecord`) to fetch records from the authoritative source.

## API Endpoints

All endpoints require admin authentication.

### Start Discovery

```bash
POST /api/admin/feed-generators/discover
```

**Request Body:**
```json
{
  "fromKnownCreators": true,
  "fromSpecificUsers": [
    "did:plc:abc123...",
    "did:plc:xyz789..."
  ],
  "specificUris": [
    "at://did:plc:abc123.../app.bsky.feed.generator/my-feed"
  ]
}
```

**Options:**
- `fromKnownCreators` (boolean, optional): Scan all users who have already published feed generators (from your database) to check for new feeds
- `fromSpecificUsers` (array of DIDs, optional): List of specific user DIDs to scan for feed generators via their PDS
- `specificUris` (array of AT URIs, optional): Specific feed generator URIs to fetch and index

**Response:**
```json
{
  "success": true,
  "message": "Feed generator discovery started in background"
}
```

Discovery runs asynchronously in the background. Check the stats endpoint for progress.

### Get Discovery Stats

```bash
GET /api/admin/feed-generators/discovery-stats
```

**Response:**
```json
{
  "stats": {
    "discovered": 150,
    "indexed": 142,
    "failed": 3,
    "skipped": 5
  },
  "isRunning": false
}
```

### Index a Specific Feed Generator

```bash
POST /api/admin/feed-generators/index-uri
```

**Request Body:**
```json
{
  "uri": "at://did:plc:abc123.../app.bsky.feed.generator/my-feed"
}
```

**Response:**
```json
{
  "success": true,
  "feedGenerator": {
    "uri": "at://did:plc:abc123.../app.bsky.feed.generator/my-feed",
    "cid": "bafyrei...",
    "did": "did:web:feedgen.example.com",
    "displayName": "My Awesome Feed",
    "description": "A feed about...",
    "createdAt": "2024-01-15T12:00:00.000Z"
  },
  "message": "Feed generator indexed successfully"
}
```

## Usage Examples

### Example 1: Refresh Feeds from Known Creators

```bash
curl -X POST http://localhost:5000/api/admin/feed-generators/discover \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fromKnownCreators": true
  }'
```

This will scan all users who have already published feed generators (tracked in your database from the firehose) and check their repositories via their PDS for any new feeds they've created.

### Example 2: Scan Specific Users for Feeds

```bash
curl -X POST http://localhost:5000/api/admin/feed-generators/discover \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fromSpecificUsers": [
      "did:plc:z72i7hdynmk6r22z27h6tvur",
      "did:plc:q6gjnaw2blty4crticxkmujt"
    ]
  }'
```

This will query each user's PDS endpoint to enumerate and index all feed generators they've published. Useful for bootstrapping from a curated list of known popular feed creators.

### Example 3: Index a Specific Feed

```bash
curl -X POST http://localhost:5000/api/admin/feed-generators/index-uri \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "uri": "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot"
  }'
```

This will fetch and index a single feed generator by its AT URI.

### Example 4: Combined Discovery

```bash
curl -X POST http://localhost:5000/api/admin/feed-generators/discover \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fromKnownCreators": true,
    "fromSpecificUsers": ["did:plc:z72i7hdynmk6r22z27h6tvur"],
    "specificUris": [
      "at://did:plc:abc123.../app.bsky.feed.generator/custom-feed"
    ]
  }'
```

This combines all three methods in a single discovery run: refreshes known creators, scans specific users, and fetches specific URIs.

### Check Discovery Progress

```bash
curl http://localhost:5000/api/admin/feed-generators/discovery-stats \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

## How It Works

### Automatic Discovery

When the firehose processor encounters a feed generator record:
1. The feed generator is indexed immediately
2. A background task is triggered to scan that creator's entire repository
3. Uses `com.atproto.repo.listRecords` with collection `app.bsky.feed.generator` to find all feeds
4. Indexes any additional feeds discovered
5. Marks the creator as "scanned" with a 24-hour cooldown to prevent duplicate work

### Manual Discovery

1. **Known Creator Refresh**: Queries your local database for users who have published feed generators, then scans their PDS repositories (bypasses cooldown)
2. **User Repository Scanning**: Uses `com.atproto.repo.listRecords` with collection `app.bsky.feed.generator` to enumerate all feeds published by a user via their PDS
3. **Direct URI Fetching**: Uses `com.atproto.repo.getRecord` to fetch a specific feed generator record from the user's PDS
4. **Indexing**: Each discovered feed generator is processed through the event processor and stored in the database

All operations query the authoritative source (PDS instances) directly, following proper AT Protocol architecture.

## Benefits

- **No Full Backfill Required**: Discover and index feed generators without processing the entire relay history
- **Protocol-Compliant**: Queries PDS instances directly using proper AT Protocol methods (no AppView dependencies)
- **Selective Indexing**: Choose which feeds to index based on your instance's needs
- **Incremental Updates**: Run discovery periodically to catch new feed generators from known creators
- **Bootstrap from Curated Lists**: Provide a list of known feed creators to quickly populate your instance

## Limitations

- Only discovers feed generators that are currently published (deleted feeds won't be found)
- Requires knowing specific user DIDs or relying on feeds already discovered via the firehose
- Does not automatically discover ALL feed generators in the network (use backfill for complete coverage)
- PDS availability: If a user's PDS is offline, their feeds can't be discovered until it's back online

## Recommended Workflow

### For New Instances

1. Start your AppView instance (listens to relay from now forward)
2. **[Optional Bootstrap]** Provide a curated list of known feed generator creators and run discovery with `fromSpecificUsers` to immediately populate popular feeds
3. **Automatic discovery takes over**: As your instance encounters feed generators through the firehose, it automatically discovers all feeds from those creators
4. Users can manually submit feed URIs to be indexed via `index-uri` endpoint

### Ongoing Operation

- **Automatic**: Feed generators are discovered automatically as they appear in the firehose
- **Manual refresh**: Periodically run discovery with `fromKnownCreators` to catch brand new feeds from existing creators (bypasses 24-hour cooldown)
- **User submissions**: Accept feed URIs from users and index them via `index-uri` endpoint

## Suggested Feed Creator List

You can create a curated list of popular feed generator creators. Some well-known feed creators include:
- `did:plc:z72i7hdynmk6r22z27h6tvur` (bsky.app team feeds)
- `did:plc:q6gjnaw2blty4crticxkmujt` (skyfeed.app)

Build your own list based on your community's needs or by monitoring the firehose for popular feeds.

## Notes

- **Automatic discovery** happens in the background when feed generators are detected via firehose
- Manual discovery runs in the background and won't block the API
- Already-indexed feeds are automatically skipped
- A 24-hour cooldown prevents scanning the same creator multiple times (can be bypassed with manual `fromKnownCreators`)
- Failed discoveries are logged and can be retried
- The service integrates with the existing event processor to ensure consistency

## Performance Characteristics

- **Automatic scans**: Triggered once per creator, with 24-hour cooldown
- **PDS queries**: Each scan makes one `listRecords` call to the creator's PDS
- **Non-blocking**: All discovery operations run asynchronously without blocking the firehose
- **Throttled**: Automatic discovery happens gradually as feed generators are encountered naturally
