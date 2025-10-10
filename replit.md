# AT Protocol App View

## Overview

A production-ready, self-hostable AT Protocol "App View" service that indexes real-time data from the Bluesky network firehose and provides a fully Bluesky-compatible XRPC API. The application consists of a Node.js/Express backend with PostgreSQL database, Redis for event queuing, and a React frontend dashboard for monitoring.

**Purpose**: Enable individuals and communities to run their own Bluesky-compatible social network view with configurable data retention, avoiding centralized liability while maintaining full protocol compliance.

**Key Philosophy**: Scale down, not just up - supports everything from personal instances (days/weeks of data) to full network mirrors, with privacy-by-design through configurable data minimization.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Multi-Worker Event Processing Architecture

**Problem**: Process high-volume real-time firehose events (1000+ events/sec) with fault tolerance and horizontal scalability.

**Solution**: PM2 cluster mode with 32 workers, Redis Streams for event distribution, and role-based worker assignment.

- **Worker 0 (Primary)**: Connects to AT Protocol firehose via WebSocket (`wss://bsky.network`), ingests CBOR-encoded events (#commit, #identity, #account), publishes to Redis Stream (`firehose:events`), runs backfill agents and data pruning
- **Workers 1-31**: Each runs 5 parallel consumer pipelines reading from Redis Stream, processes events via `eventProcessor`, acknowledges on success
- **Redis Stream**: Single stream with consumer group, 500k event buffer (MAXLEN ~500000), auto-claim for dead consumer recovery every 5s
- **Event Processor**: Validates lexicons (Zod), manages out-of-order events with TTL queues, writes to PostgreSQL, generates notifications

**Why PM2 Cluster**: Built-in process management, automatic restarts, zero-downtime reloads, worker identity via `pm_id`

**Alternatives Considered**: Kubernetes (overkill for self-hosting), single-process async (insufficient throughput)

**Pros**: Horizontal scaling, fault isolation, graceful degradation
**Cons**: More complex than single-process, requires Redis

### Database Schema and ORM

**Problem**: Store and query complex social graph data with full-text search, federation support, and migration management.

**Solution**: PostgreSQL with Drizzle ORM, 28+ tables covering users, posts, likes, reposts, follows, blocks, mutes, feed generators, lists, notifications, starter packs, and moderation labels.

- **Drizzle ORM**: Type-safe schema definitions in `shared/schema.ts`, migration generation via `drizzle-kit`
- **Full-Text Search**: PostgreSQL `tsvector` columns with GIN indexes, automatic updates via triggers, Unicode support
- **Indexes**: Composite indexes on (did, createdAt), foreign key indexes, full-text search indexes
- **Connection Pooling**: Neon serverless driver with automatic connection management
- **Federation Support**: Foreign key constraints removed for external references
  - Likes/Reposts/Bookmarks can reference external posts (not in local database)
  - Follows/Blocks/Mutes can reference external users (not in local database)
  - Enables federated social graph without requiring complete network mirror

**Why Drizzle**: Lightweight, type-safe, SQL-first approach, better performance than Prisma for read-heavy workloads

**Why No Foreign Keys for Federation**: AppView may only index subset of network (e.g., one user's data), so interactions can reference posts/users not in local database

**Alternatives Considered**: Prisma (heavier runtime), raw SQL (no type safety)

**Pros**: Type safety, migration management, performant queries, federation support
**Cons**: Less mature ecosystem than Prisma

### Authentication and Authorization

**Problem**: Support both local OAuth sessions and third-party AT Protocol access tokens (ES256/ES256K) for compatibility with external clients.

**Solution**: Dual authentication system in `server/services/auth.ts` with token type detection and unified verification.

- **Local Sessions**: HS256 JWT with session tracking in PostgreSQL, AES-256-GCM encrypted PDS tokens, automatic refresh
- **AT Protocol Tokens**: ES256K signature verification via DID resolution, Multikey public key parsing, fallback to JWK format
- **Token Detection**: Algorithm inspection (HS256 vs ES256/ES256K), payload structure analysis
- **DID Resolution**: @atproto/identity for handle→DID and DID document fetching

**Why Dual Authentication**: Enable both web app users (local sessions) and third-party clients (AT Protocol tokens)

**Pros**: Protocol compliance, third-party client support, secure token storage
**Cons**: Complex verification logic, requires DID resolution infrastructure

### Real-Time Data Ingestion

**Problem**: Maintain continuous connection to AT Protocol firehose with automatic reconnection, cursor persistence, and backpressure handling.

**Solution**: `@skyware/firehose` client in `server/services/firehose.ts` with WebSocket keepalive, stall detection, and Redis-based event distribution.

- **Firehose Client**: Connects to relay, handles ping/pong keepalive (30s interval, 45s timeout), auto-reconnects on disconnect
- **Cursor Persistence**: Saves position to PostgreSQL every 5 seconds, enables restart recovery with minimal data loss
- **Backpressure**: Redis Stream buffering (500k events), worker pipeline throttling (300 events/batch)
- **Event Types**: #commit (record changes), #identity (handle updates), #account (status changes)

**Why @skyware/firehose**: Simpler API than @atproto/sync, better reconnection handling

**Alternatives Considered**: @atproto/sync Firehose (lower-level, more complex), polling PDS endpoints (not real-time)

**Pros**: Real-time updates, automatic recovery, minimal data loss
**Cons**: Single point of failure (worker 0), WebSocket connection fragility

### Feed Algorithm System

**Problem**: Generate personalized and algorithmic feeds while respecting user preferences and content filtering rules.

**Solution**: Multi-algorithm feed ranking in `server/services/feed-algorithm.ts` with engagement scoring, user preferences, and keyword filtering.

- **Algorithms**: Reverse-chronological (default), engagement-based (likes + reposts), discovery (weighted by engagement + freshness)
- **User Preferences**: Stored in `user_preferences` table, applied to timeline/feed generation
- **Content Filtering**: Keyword-based mute lists, user muting, applies to all feed endpoints
- **Feed Generators**: AT Protocol-compliant custom feeds via DID resolution, JWT auth, skeleton fetching from external services

**Why Multi-Algorithm**: Support different user preferences and use cases (news, engagement, discovery)

**Pros**: Flexible ranking, user control, protocol compliance
**Cons**: Requires tuning engagement weights, potential filter bubble effects

### PDS Write Proxy

**Problem**: AppView is read-only but users expect write operations (post, like, follow) to work from the UI.

**Solution**: Proxy pattern in `server/middleware/xrpc-proxy.ts` that forwards write requests to user's PDS with session token.

- **Write Detection**: Identifies XRPC procedures vs queries, routes writes to PDS
- **PDS Resolution**: Extracts PDS endpoint from user's DID document
- **Token Forwarding**: Uses session's PDS token (refreshed if needed) for authentication
- **Rollback Support**: Returns success/error from PDS, allows local rollback on failure

**Why Proxy Pattern**: Maintains protocol compliance (writes go to PDS), enables seamless UX

**Alternatives Considered**: Direct PDS integration (breaks federation), blocking writes (poor UX)

**Pros**: Protocol compliance, seamless UX, no data duplication for writes
**Cons**: Latency from double-hop, PDS availability dependency

### Monitoring Dashboard

**Problem**: Operators need visibility into firehose health, database state, API performance, and system resources.

**Solution**: React-based dashboard in `client/src/` with real-time Server-Sent Events (SSE) for metrics and logs.

- **Frontend**: Vite + React + TanStack Query, shadcn/ui components, Tailwind CSS
- **Metrics Collection**: In-memory counters in `server/services/metrics.ts`, SSE broadcast every 2 seconds
- **Database Introspection**: Dynamic schema discovery via `information_schema`, table statistics, index analysis
- **Firehose Status**: Connection state, cursor position, event counts, lag detection
- **Logs**: Rolling in-memory log buffer with aggregation for spam reduction

**Why SSE**: Simpler than WebSocket for one-way real-time updates, automatic reconnection

**Pros**: Real-time visibility, low overhead, browser-native
**Cons**: SSE connection limits per domain, in-memory metrics (not persistent)

### Data Retention and Pruning

**Problem**: Prevent unbounded database growth while respecting operator's privacy/liability preferences.

**Solution**: Configurable retention windows in `server/services/data-pruning.ts` with safety minimums and batch limits.

- **Retention Policy**: `DATA_RETENTION_DAYS` environment variable (default 7 days, minimum 1 day)
- **Batch Deletion**: Deletes in chunks to avoid long locks, periodic execution (every 6 hours)
- **Safety Minimums**: Always keeps at least 1 day of data, max 100k records per batch
- **Pruned Tables**: Posts, likes, reposts, notifications (keeps users, follows, profiles)

**Why Configurable Retention**: Enables "scale down" philosophy - personal instances can keep days/weeks instead of years

**Pros**: Predictable storage costs, privacy by design, liability reduction
**Cons**: Data loss is permanent, may break historical queries

### Lexicon Validation

**Problem**: Ensure all ingested records conform to AT Protocol lexicon schemas before database insertion.

**Solution**: Zod-based validation in `server/utils/lexicon-validator.ts` for all 8 record types.

- **Validated Types**: app.bsky.feed.post, app.bsky.feed.like, app.bsky.feed.repost, app.bsky.feed.generator, app.bsky.actor.profile, app.bsky.graph.follow, app.bsky.graph.block, app.bsky.graph.starterpack
- **Validation Strategy**: Parse with Zod schema, reject invalid records, log errors
- **Content Sanitization**: Text length limits, facet validation, embed structure checking

**Why Zod**: Type-safe schema definitions, composable validators, detailed error messages

**Pros**: Data integrity, protocol compliance, early error detection
**Cons**: Performance overhead on validation, strict rejection may lose data

## External Dependencies

### Core AT Protocol Libraries

- **@atproto/api** (v0.17.0): BskyAgent for PDS communication, XRPC client, record builders
- **@atproto/identity** (v0.4.9): DID resolution (did:plc, did:web), handle resolution
- **@atproto/oauth-client-node** (v0.3.8): OAuth 2.0 client with DID verification
- **@atproto/repo** (v0.8.10): Repository operations, CAR file parsing, MST traversal
- **@atproto/sync** (v0.1.35): Historical firehose backfill client
- **@skyware/firehose** (v0.5.2): Real-time firehose client with reconnection

**Usage**: Protocol compliance, DID resolution, PDS communication, CAR file parsing

### Database and Caching

- **PostgreSQL**: Primary data store via `@neondatabase/serverless` driver
- **Redis**: Event queue (Redis Streams), cursor persistence, cluster coordination
- **Drizzle ORM**: Schema management, query builder, migrations

**PostgreSQL Configuration**:
- Connection pooling via Neon serverless
- Full-text search with GIN indexes
- Foreign key constraints for referential integrity

**Redis Configuration** (docker-compose.yml):
- `maxmemory-policy: noeviction` to prevent stream eviction
- AOF persistence enabled (`appendonly yes`) for durability
- 8GB memory limit, everysec fsync

### Authentication and Cryptography

- **jsonwebtoken**: JWT signing and verification (HS256, ES256, ES256K)
- **jose**: JWK operations, ES256K signature verification
- **crypto** (Node.js): AES-256-GCM encryption for PDS tokens, random ID generation

**Key Management**:
- OAuth signing keys: ES256 (P-256 curve) stored as files (production) or database (dev)
- Session tokens: HS256 with 7-day expiration, stored in PostgreSQL
- PDS tokens: AES-256-GCM encrypted in session records

### Frontend Stack

- **React** (v19.0.0): UI framework with hooks
- **Vite** (v6.0.7): Build tool and dev server
- **TanStack Query** (v5.60.5): Data fetching, caching, SSE integration
- **shadcn/ui**: Radix UI components with Tailwind styling
- **Tailwind CSS** (v4.0.0): Utility-first CSS framework

### Process Management

- **PM2**: Cluster mode for multi-worker deployment
  - 32 workers in production
  - Automatic restarts on failure
  - Worker identity via `pm_id`
  - Zero-downtime reloads

**Docker Deployment**:
- `docker-compose.yml` orchestrates app, PostgreSQL, Redis
- Health checks for all services
- Volume persistence for Redis AOF and OAuth keys

### Third-Party Services

- **Bluesky Relay**: `wss://bsky.network` for real-time firehose events
- **PDS Endpoints**: Resolved via DID documents, used for:
  - Write operations (create post, like, follow)
  - Session token refresh
  - OAuth token validation
- **DID PLC Directory**: `https://plc.directory` for did:plc resolution

**Network Dependencies**:
- Firehose: WebSocket connection to relay (critical path)
- PDS: HTTPS for write operations (user-initiated)
- DID Resolution: HTTPS to PLC directory (cached aggressively)