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
**API Layer**: Implements 50 Bluesky-compatible XRPC endpoints (Priority 1 Complete, Phase 2 Complete, Phase 3 Complete) including:
- **Feed APIs** (15/16): `getTimeline`, `getAuthorFeed`, `getPostThread`, `getPosts`, `getLikes`, `getRepostedBy`, `getQuotes`, `getActorLikes`, `getListFeed`, `searchPosts`, `getFeedGenerator`, `getFeedGenerators`, `getActorFeeds`, `getSuggestedFeeds`, `describeFeedGenerator`
- **Actor/Profile APIs** (7/7 - Complete): `getProfile`, `getProfiles`, `getSuggestions`, `searchActors`, `searchActorsTypeahead`, `getPreferences`, `putPreferences`
- **Graph APIs** (17/18): `getFollows`, `getFollowers`, `getBlocks`, `getMutes`, `muteActor`, `unmuteActor`, `getRelationships`, `getList`, `getLists`, `getListMutes`, `getListBlocks`, `getKnownFollowers`, `getSuggestedFollowsByActor`, `muteActorList`, `unmuteActorList`, `getStarterPack`, `getStarterPacks`
- **Notification APIs** (5/5 - Complete): `listNotifications`, `getUnreadCount`, `updateSeen`, `registerPush`, `putPreferences`
- **Video APIs** (2/2 - Complete): `getJobStatus`, `getUploadLimits`
- **Moderation APIs** (2/2 - Complete): `queryLabels`, `createReport`
- **Labeler APIs** (1/1 - Complete): `getServices`
**Firehose Client**: Connects to the AT Protocol relay to consume and process `#commit`, `#identity`, and `#account` events with concurrency control (max 50 concurrent operations) and event queuing to prevent database connection pool exhaustion.
**Event Processing Pipeline**: Parses raw CBOR events, validates them with Zod against Lexicon schemas, and stores them in the database. Includes pending operation management with TTL-based cleanup (10min TTL, max 10k pending ops) to prevent memory leaks.
**Validation Layer**: Employs Zod-based schemas for AT Protocol record types (posts, likes, reposts, profiles, follows, blocks, feed generators, starter packs, labeler services).
**Metrics Service**: Tracks system performance, event counts, error rates, system health, and firehose connection status. Includes periodic cleanup (every 5 minutes) to prevent memory accumulation.
**Storage Abstraction**: Provides an interface for database operations across various data entities.
**Authentication**: Implements AT Protocol-compliant OAuth 2.0 with DID verification, token encryption (AES-256-GCM), and automatic token refresh.
**Write Operations**: All write operations are proxied to the user's PDS, ensuring data consistency with rollback mechanisms.
**Content Filtering Engine**: Supports keyword-based filtering and user muting, applied to all XRPC feed endpoints.
**Feed Algorithm System**: Offers `reverse-chronological`, `engagement`, and `discovery` ranking algorithms with user preferences and query parameter overrides.

### Data Storage

**Database**: PostgreSQL, utilizing Neon serverless driver.
**ORM**: Drizzle ORM with a schema-first approach.
**Schema Design**: Includes tables for `users`, `posts`, `likes`, `reposts`, `follows`, `blocks`, `mutes`, `user_preferences`, `list_mutes`, `list_blocks`, `feed_generators`, `starter_packs`, `labeler_services`, `push_subscriptions`, and `video_jobs` with optimized indexing and composite cursor pagination.
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
- `DATABASE_URL`: PostgreSQL connection string.
- `RELAY_URL`: AT Protocol relay URL.
- `SESSION_SECRET`: JWT secret for session tokens.