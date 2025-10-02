# AT Protocol App View

## Overview

This project is a self-hostable AT Protocol "App View" service designed to index real-time data from the Bluesky network firehose. It provides a Bluesky-compatible XRPC API, enabling users to run their own backend instance with custom feed algorithms and content moderation capabilities. The system processes AT Protocol events, validates records against Lexicon schemas, stores data in PostgreSQL, and serves it through standard Bluesky API endpoints. The project aims to provide a robust, customizable, and high-performance App View for the AT Protocol ecosystem.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React with TypeScript (Vite).
**UI Components**: Radix UI primitives, shadcn/ui, Tailwind CSS (dark theme).
**State Management**: TanStack Query (React Query).
**Routing**: Wouter.
**Dashboard Interface**: Real-time monitoring dashboard displaying metrics (events, DB records, API requests), a firehose monitor, DB schema visualization, API documentation, Lexicon validator statistics, configuration, logs, and analytics.
**Real-time Updates**: Utilizes WebSocket client for live metrics and event data.

### Backend Architecture

**Runtime**: Node.js with Express.js.
**Language**: TypeScript (ESM).
**API Layer**: Implements 52 Bluesky-compatible XRPC endpoints (100% of core API coverage) including:
- **Feed APIs** (16/16 - Complete): `getTimeline`, `getAuthorFeed`, `getPostThread`, `getPosts`, `getLikes`, `getRepostedBy`, `getQuotes`, `getActorLikes`, `getListFeed`, `searchPosts`, `getFeedGenerator`, `getFeedGenerators`, `getActorFeeds`, `getSuggestedFeeds`, `describeFeedGenerator`, `getFeed`
- **Actor/Profile APIs** (7/7 - Complete): `getProfile`, `getProfiles`, `getSuggestions`, `searchActors`, `searchActorsTypeahead`, `getPreferences`, `putPreferences`
- **Graph APIs** (18/18 - Complete): `getFollows`, `getFollowers`, `getBlocks`, `getMutes`, `muteActor`, `unmuteActor`, `getRelationships`, `getList`, `getLists`, `getListMutes`, `getListBlocks`, `getKnownFollowers`, `getSuggestedFollowsByActor`, `muteActorList`, `unmuteActorList`, `getStarterPack`, `getStarterPacks`, `muteThread`
- **Notification APIs** (5/5 - Complete): `listNotifications`, `getUnreadCount`, `updateSeen`, `registerPush`, `putPreferences`
- **Video APIs** (2/2 - Complete): `getJobStatus`, `getUploadLimits`
- **Moderation APIs** (2/2 - Complete): `queryLabels`, `createReport`
- **Labeler APIs** (1/1 - Complete): `getServices`
**Full-Text Search**: PostgreSQL-powered search with GIN indexes and automatic tsvector updates:
- **Post Search**: Full-text search across post content with ranking and pagination
- **Actor Search**: Search users by handle, display name, and description
- **Typeahead**: Fast prefix matching for autocomplete functionality
- **Unicode Support**: Handles emoji, CJK characters, accented text, and punctuation safely using `plainto_tsquery`
- **Performance**: GIN-indexed tsvector columns with automatic trigger-based updates
**Firehose Client**: Connects to the AT Protocol relay to consume and process `#commit`, `#identity`, and `#account` events with concurrency control (max 50 concurrent operations) and event queuing to prevent database connection pool exhaustion.
**Cursor Persistence**: Implements automatic firehose position tracking with database persistence to enable restart recovery:
- **Automatic Resume**: On startup, loads the last saved cursor position from the database and resumes from that point, preventing data loss during restarts.
- **Periodic Saves**: Saves cursor position every 5 seconds using atomic upsert operations to handle concurrent writes safely.
- **Crash Recovery**: Ensures minimal data loss (max 5 seconds of events) even during unexpected crashes or restarts.
- **Production Ready**: Cursor state survives container restarts, database migrations, and service redeployments.
**Event Processing Pipeline**: Parses raw CBOR events, validates them with Zod against Lexicon schemas, and stores them in the database. Includes pending operation management with TTL-based cleanup (10min TTL, max 10k pending ops) to prevent memory leaks.
**Validation Layer**: Employs Zod-based schemas for AT Protocol record types (posts, likes, reposts, profiles, follows, blocks, feed generators, starter packs, labeler services).
**Metrics Service**: Tracks system performance, event counts, error rates, system health, and firehose connection status. Includes periodic cleanup (every 5 minutes) to prevent memory accumulation.
**Storage Abstraction**: Provides an interface for database operations across various data entities.
**Authentication**: Implements AT Protocol-compliant OAuth 2.0 with DID verification, token encryption (AES-256-GCM), and automatic token refresh.
**Write Operations**: All write operations are proxied to the user's PDS, ensuring data consistency with rollback mechanisms.
**Content Filtering Engine**: Supports keyword-based filtering and user muting, applied to all XRPC feed endpoints.
**Feed Algorithm System**: Offers `reverse-chronological`, `engagement`, and `discovery` ranking algorithms with user preferences and query parameter overrides.
**Feed Generator Integration**: Full AT Protocol-compliant integration for consuming external feed generators:
- **DID Resolution**: Resolves feed generator service DIDs (did:web, did:plc) to extract BskyFeedGenerator service endpoints with 1-hour caching.
- **Skeleton Fetching**: Calls external feed generator `/xrpc/app.bsky.feed.getFeedSkeleton` endpoints with 10-second timeout.
- **JWT Authentication**: Signs requests to feed generators with AppView DID using short-lived (5min) JWT tokens for service-to-service authentication.
- **Hydration**: Fetches full post data from local database using skeleton URIs with batch optimization.
- **Error Handling**: Graceful degradation with proper HTTP status codes (404 for missing feeds, 502 for unavailable services).
- **Performance**: Endpoint caching and batch post lookups prevent N+1 queries.
**Dashboard Authentication**: Optional password-based authentication for dashboard access (separate from AT Protocol OAuth):
- **Password Protection**: When `DASHBOARD_PASSWORD` environment variable is set, all dashboard routes require authentication.
- **Public Mode**: If `DASHBOARD_PASSWORD` is not set, dashboard remains publicly accessible (useful for development).
- **JWT Sessions**: Dashboard sessions use JWT tokens with 24-hour expiry stored in localStorage.
- **Protected Endpoints**: Metrics, logs, events, and configuration endpoints require dashboard authentication.

### Data Storage

**Database**: PostgreSQL, utilizing Neon serverless driver.
**ORM**: Drizzle ORM with a schema-first approach.
**Schema Design**: Includes tables for `users`, `posts`, `likes`, `reposts`, `follows`, `blocks`, `mutes`, `user_preferences`, `list_mutes`, `list_blocks`, `thread_mutes`, `feed_generators`, `starter_packs`, `labeler_services`, `push_subscriptions`, `video_jobs`, and `firehose_cursor` with optimized indexing and composite cursor pagination.
**Migration Management**: Drizzle Kit is used for schema migrations.

## External Dependencies

**AT Protocol Services**:
- **Bluesky Relay**: `wss://bsky.network` (for firehose data).
- **AT Protocol Lexicons**: Official `app.bsky.*` schemas for validation.

**Database**:
- **PostgreSQL**: Primary data store.
- **Neon Serverless**: PostgreSQL client.

**Key Libraries**:
- `@skyware/firehose`: AT Protocol firehose client.
- `cbor-x`: CBOR decoding.
- `drizzle-orm`: ORM.
- `zod`: Runtime type validation.
- `express`: HTTP server.
- `ws`: WebSocket implementation.
- `@tanstack/react-query`: Data fetching and caching.
- `@radix-ui/*`: Headless UI components.
- `tailwindcss`: CSS framework.

**Environment Requirements**:
- `DATABASE_URL`: PostgreSQL connection string (required).
- `RELAY_URL`: AT Protocol relay URL (defaults to `wss://bsky.network`).
- `SESSION_SECRET`: JWT secret for session tokens and encryption (required for production).
- `APPVIEW_DID`: DID of this AppView instance for feed generator JWT signing (defaults to `did:web:appview.local`).
- `DASHBOARD_PASSWORD`: Password for dashboard authentication (optional - dashboard is public if not set).
- `ENABLE_BACKFILL`: Enable historical data backfill (default: `false`, **NOT recommended for production**).
- `PORT`: Server port (default: `5000`).
- `NODE_ENV`: Environment mode (`development` or `production`).

## Production Deployment

### Production Readiness Features

**Service Discovery**: 
- **Endpoint**: `GET /xrpc/com.atproto.server.describeServer`
- **Purpose**: AT Protocol-compliant server metadata endpoint that advertises AppView capabilities, version, and supported features.
- **Response**: Returns server DID, supported XRPC methods (all 52 endpoints), and feature flags (OAuth, PDS proxy, content filtering, custom feeds, full-text search, cursor persistence).

**Health Monitoring**:
- **Health Check**: `GET /health` - Basic liveness probe (always returns 200 if service is running).
- **Readiness Check**: `GET /ready` - Comprehensive readiness probe that checks:
  - Firehose connection status
  - Database connectivity and health
  - Memory usage (<95% threshold)
  - Returns HTTP 200 if ready, HTTP 503 if not ready with detailed diagnostics.

**Cursor Persistence**: 
- Automatic firehose position tracking with database persistence.
- Enables zero-data-loss restart recovery (max 5 seconds of events during crash).
- Position saved every 5 seconds using atomic upsert operations.

**Error Handling**:
- Categorized error types: network, timeout, auth, rate-limit, protocol, unknown.
- Automatic reconnection for recoverable errors.
- Detailed error logging with context.

**Monitoring & Metrics**:
- Queue depth and active processing count exposed via `/api/metrics`.
- Per-endpoint performance tracking (latency, success rate).
- System health metrics (CPU, memory, database).
- Firehose status (connected, cursor position, queue depth).

### Production Configuration Recommendations

1. **Environment Variables**:
   ```bash
   NODE_ENV=production
   DATABASE_URL=postgresql://user:pass@host:5432/dbname
   SESSION_SECRET=<generate-with-openssl-rand-base64-32>
   APPVIEW_DID=did:web:your-domain.com
   DASHBOARD_PASSWORD=<secure-password>
   RELAY_URL=wss://bsky.network
   PORT=5000
   ```

2. **Database**:
   - Use a production-grade PostgreSQL instance with sufficient resources.
   - Recommended: 4+ CPU cores, 8+ GB RAM, 100+ GB storage (grows with firehose data).
   - Enable connection pooling (Neon serverless handles this automatically).
   - Regular backups (PostgreSQL WAL archiving or snapshot backups).

3. **Container Orchestration**:
   - Configure liveness probe: `GET /health` (interval: 10s, timeout: 5s).
   - Configure readiness probe: `GET /ready` (interval: 5s, timeout: 3s, failure threshold: 3).
   - Set resource limits: `memory: 2Gi`, `cpu: 1000m` (adjust based on load).
   - Use persistent volumes for cursor state (though database-backed, disk may help during startup).

4. **Scaling Considerations**:
   - **Vertical Scaling**: Increase memory and CPU for single-instance deployments.
   - **Database Read Replicas**: Offload read-heavy XRPC endpoints to read replicas.
   - **NOT Horizontally Scalable**: Multiple instances will compete for firehose events and cause duplicate processing. Use single-instance deployment with failover.

5. **Security**:
   - Always set `DASHBOARD_PASSWORD` in production.
   - Use TLS/HTTPS for all external traffic.
   - Firewall database to allow only AppView instance connections.
   - Rotate `SESSION_SECRET` periodically.

### Historical Backfill Service

**WARNING**: Historical backfill is a resource-intensive operation that can take days/weeks and requires massive disk space and memory. It is **NOT recommended** for production unless you have significant infrastructure capacity.

**Infrastructure Ready**: 
- Backfill service implemented with resumable cursor tracking.
- Progress persistence in database.
- Safety limits (max 100k events per run, 1k event progress save interval).

**Activation**:
- Set `ENABLE_BACKFILL=true` to enable (default: `false`).
- Service will NOT run unless explicitly enabled.
- Monitor disk space, memory, and database performance closely.

**Considerations**:
- Backfill will attempt to download ALL historical data from the AT Protocol network.
- Requires 100s of GB to TBs of disk space depending on how far back you go.
- Can overwhelm database write capacity and connection pools.
- May take weeks to complete for full network history.
- Consider starting from a recent date rather than the beginning of time.

### Deployment Checklist

- [ ] Set all required environment variables.
- [ ] Configure production PostgreSQL instance.
- [ ] Set up health/readiness probes in orchestrator.
- [ ] Enable dashboard authentication (`DASHBOARD_PASSWORD`).
- [ ] Configure TLS/HTTPS termination.
- [ ] Set up database backups.
- [ ] Monitor `/api/metrics` for system health.
- [ ] Test `/xrpc/com.atproto.server.describeServer` for service discovery.
- [ ] Verify cursor persistence survives restarts.
- [ ] Do NOT enable backfill (`ENABLE_BACKFILL=false`).