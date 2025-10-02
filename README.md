# AT Protocol App View

A self-hostable AT Protocol "App View" service that ingests data from the Bluesky firehose, indexes social data, and exposes a Bluesky-compatible XRPC API.

## Features

- **Real-time Firehose Ingestion**: WebSocket client connects to AT Protocol relay (wss://bsky.network) and processes CBOR-encoded events
- **Event Processing**: Handles #commit, #identity, and #account events with full operation parsing
- **PostgreSQL Database**: Optimized schema for users, posts, likes, reposts, follows, and blocks
- **Lexicon Validation**: Zod-based validation for all AT Protocol record types
- **XRPC API**: Bluesky-compatible endpoints including getTimeline, getAuthorFeed, getPostThread, getProfile, getFollows, and getFollowers
- **Admin Dashboard**: Real-time monitoring interface with metrics, system health, and configuration

## Architecture

