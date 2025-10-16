# Data-Plane Architecture

## Overview

The data-plane is the **indexing and storage layer** of the AppView. It is responsible for:

1. **Ingesting events** from the firehose
2. **Processing and validating** records
3. **Indexing data** into PostgreSQL
4. **Serving internal queries** to the AppView layer via RPC

This separation allows:
- **Independent scaling**: Scale indexing and serving independently
- **Clear boundaries**: Indexing logic separated from API logic
- **Reliability**: Data-plane can restart without affecting API serving (with caching)
- **Performance**: Optimize each layer for its specific workload

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        AT Protocol                          │
│                  Firehose (WebSocket)                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                     DATA-PLANE                              │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐      │
│  │  Firehose    │─▶│   Event     │─▶│  PostgreSQL  │      │
│  │   Client     │  │  Processor  │  │   Database   │      │
│  └──────────────┘  └─────────────┘  └──────────────┘      │
│                           │                                 │
│                           ▼                                 │
│  ┌──────────────────────────────────────────────┐          │
│  │         Internal RPC Server (HTTP)           │          │
│  │  - getProfile      - getPostThread           │          │
│  │  - getFeed         - searchPosts             │          │
│  │  - getFollowers    - getNotifications        │          │
│  └──────────────────────────────────────────────┘          │
└────────────────────────┬────────────────────────────────────┘
                         │ Internal HTTP/JSON-RPC
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      APPVIEW LAYER                          │
│  ┌──────────────────────────────────────────────┐          │
│  │      Data-Plane Client (with caching)        │          │
│  └────────────────────┬─────────────────────────┘          │
│                       │                                     │
│                       ▼                                     │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐      │
│  │  Hydration   │◀─│   Views     │◀─│     XRPC     │      │
│  │   Layer      │  │  Builder    │  │   Endpoints  │      │
│  └──────────────┘  └─────────────┘  └──────┬───────┘      │
│                                             │               │
└─────────────────────────────────────────────┼───────────────┘
                                              │
                                              ▼
                                    ┌──────────────────┐
                                    │   Client Apps    │
                                    │  (web, mobile)   │
                                    └──────────────────┘
```

## Data-Plane Server

**Location**: `data-plane/server/`

**Responsibilities**:
- Maintain firehose connection
- Process events and validate records
- Index data into PostgreSQL
- Serve internal RPC queries to AppView layer
- Manage cursor persistence and recovery

**Key Files**:
- `index.ts` - Server entry point
- `routes/` - Internal RPC endpoints
- `db/` - Database access layer (shared with AppView)

**Port**: 5001 (internal, not exposed to public)

## Data-Plane Client

**Location**: `data-plane/client/`

**Responsibilities**:
- Provide typed interface for AppView to query data-plane
- Handle connection pooling and retries
- Implement caching layer (Redis)
- Batch requests when possible

**Key Files**:
- `index.ts` - Client class
- `types.ts` - Request/response types
- `cache.ts` - Caching layer

## AppView Layer

**Location**: `server/` (existing code, modified)

**Responsibilities**:
- Serve public XRPC endpoints (app.bsky.*)
- Use data-plane client to fetch indexed data
- Hydrate records with related data
- Transform data into lexicon-compliant views
- Handle authentication and authorization

**Key Files** (modified):
- `routes.ts` - Public XRPC routes (no longer directly query DB)
- `services/views.ts` - View builders (use data-plane client)
- `services/hydration/` - Hydration layer (use data-plane client)

## Deployment Models

### Development (Single Process)
Both data-plane and AppView run in same process:
```bash
npm run dev
```

### Production (Separate Processes)
Run data-plane and AppView as separate services:

```bash
# Terminal 1: Data-plane (indexing)
npm run data-plane

# Terminal 2: AppView (API serving)
npm run appview
```

### Production (Docker Compose)
```yaml
services:
  data-plane:
    build: .
    command: npm run data-plane
    ports:
      - "5001:5001"  # Internal only
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}

  appview:
    build: .
    command: npm run appview
    ports:
      - "5000:5000"  # Public
    environment:
      - DATA_PLANE_URL=http://data-plane:5001
      - REDIS_URL=${REDIS_URL}
```

## Migration Strategy

1. ✅ Create data-plane directory structure
2. ⏳ Move event processing to data-plane server
3. ⏳ Implement internal RPC routes in data-plane
4. ⏳ Create data-plane client library
5. ⏳ Update AppView layer to use client (one endpoint at a time)
6. ⏳ Remove direct database access from AppView layer
7. ⏳ Add health checks and monitoring
8. ⏳ Test separation with both deployment models

## Internal RPC API Contract

The data-plane exposes these internal endpoints (not public):

### Profile Queries
- `POST /internal/getProfile` - Get profile by DID/handle
- `POST /internal/getProfiles` - Batch get profiles
- `POST /internal/searchActors` - Search actors

### Feed Queries
- `POST /internal/getAuthorFeed` - Get user's posts/reposts
- `POST /internal/getTimeline` - Get following timeline
- `POST /internal/getPostThread` - Get post with replies
- `POST /internal/getPost` - Get single post
- `POST /internal/getPosts` - Batch get posts

### Graph Queries
- `POST /internal/getFollowers` - Get followers list
- `POST /internal/getFollows` - Get following list
- `POST /internal/getRelationships` - Get relationship states
- `POST /internal/getBlocks` - Get blocks
- `POST /internal/getMutes` - Get mutes

### Search
- `POST /internal/searchPosts` - Full-text post search
- `POST /internal/searchActors` - Full-text actor search

### Notifications
- `POST /internal/listNotifications` - Get notification list
- `POST /internal/getUnreadCount` - Get unread count

### Feed Generators
- `POST /internal/getFeedGenerators` - Get feed generator list
- `POST /internal/getFeedGenerator` - Get single feed generator

All requests/responses are JSON. Authentication not required (internal-only).

## Benefits of This Architecture

1. **Separation of Concerns**: Indexing logic is separate from API logic
2. **Independent Scaling**: Scale data-plane for write-heavy, AppView for read-heavy
3. **Resilience**: AppView can use cached data if data-plane is restarting
4. **Development**: Can work on API layer without affecting indexing
5. **Testing**: Can mock data-plane client for AppView tests
6. **Observability**: Clear boundaries for monitoring and debugging

## Differences from Official

**Official bsky-appview**: Uses gRPC/protobuf for internal communication

**Our implementation**: Uses HTTP/JSON for simplicity

**Trade-off**: HTTP/JSON is slower but easier to debug and doesn't require protobuf compilation.

For monolithic self-hosting, this is acceptable. If you need the performance, migrate to gRPC later.
