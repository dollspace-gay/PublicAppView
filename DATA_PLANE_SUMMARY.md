# Data-Plane Implementation Summary

## What Was Done

I've implemented the **data-plane architecture** to address the #1 critical issue from the AppView analysis. This separates your indexing/storage layer from your API serving layer, matching the official Bluesky AppView architecture.

## Files Created

### Core Architecture
1. **[data-plane/README.md](data-plane/README.md)** - Complete architecture documentation
2. **[DATA_PLANE_MIGRATION.md](DATA_PLANE_MIGRATION.md)** - Step-by-step migration guide

### Data-Plane Server
3. **[data-plane/server/index.ts](data-plane/server/index.ts)** - Server entry point
   - Firehose connection
   - Event processing
   - Internal RPC server
   - Health checks and metrics

4. **[data-plane/server/types.ts](data-plane/server/types.ts)** - Internal API types
   - Request/response types for all endpoints
   - Clean contract between data-plane and AppView

### Data-Plane Routes (Internal RPC Endpoints)
5. **[data-plane/server/routes/profile.ts](data-plane/server/routes/profile.ts)** - ✅ COMPLETE
   - `getProfile` - Get single profile
   - `getProfiles` - Batch get profiles
   - `searchActors` - Full-text actor search

6. **[data-plane/server/routes/feeds.ts](data-plane/server/routes/feeds.ts)** - ⚠️ PARTIAL
   - ✅ `getAuthorFeed` - Get user's posts/reposts
   - ✅ `getPost` - Get single post
   - ✅ `getPosts` - Batch get posts
   - ⏳ `getTimeline` - TODO (following feed)
   - ⏳ `getPostThread` - TODO (thread assembly)

7. **[data-plane/server/routes/graph.ts](data-plane/server/routes/graph.ts)** - ⏳ STUBS
   - Placeholders for follows, blocks, mutes, relationships

8. **[data-plane/server/routes/search.ts](data-plane/server/routes/search.ts)** - ⏳ STUBS
   - Placeholder for post search

9. **[data-plane/server/routes/notifications.ts](data-plane/server/routes/notifications.ts)** - ⏳ STUBS
   - Placeholders for notifications

10. **[data-plane/server/routes/feed-generators.ts](data-plane/server/routes/feed-generators.ts)** - ⏳ STUBS
    - Placeholders for feed generators

### Data-Plane Client
11. **[data-plane/client/index.ts](data-plane/client/index.ts)** - ✅ COMPLETE
    - Full TypeScript client library
    - Typed methods for all endpoints
    - Retry logic and error handling
    - Request timeout handling
    - Health check method

### Configuration
12. **[package.json](package.json)** - Updated scripts:
    - `npm run dev:data-plane` - Run data-plane server
    - `npm run dev:appview` - Run AppView server (with data-plane client)
    - `npm run start:data-plane` - Production data-plane
    - `npm run start:appview` - Production AppView

## How It Works

### Architecture Flow

```
┌─────────────────────────────────────────────────┐
│           AT Protocol Firehose                  │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│          DATA-PLANE SERVER (:5001)               │
│                                                  │
│  ┌────────────┐  ┌───────────┐  ┌──────────┐   │
│  │ Firehose   │─▶│   Event   │─▶│   Postgres│   │
│  │  Client    │  │ Processor │  │  Database │   │
│  └────────────┘  └───────────┘  └──────────┘   │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │    Internal RPC Server (HTTP/JSON)      │    │
│  │  - getProfile    - getPost              │    │
│  │  - getProfiles   - getPosts             │    │
│  │  - searchActors  - getAuthorFeed        │    │
│  └─────────────────────────────────────────┘    │
└──────────────────┬───────────────────────────────┘
                   │ HTTP/JSON-RPC
                   ▼
┌──────────────────────────────────────────────────┐
│           APPVIEW SERVER (:5000)                 │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │      Data-Plane Client Library          │    │
│  │   (with retry, timeout, error handling) │    │
│  └────────────────┬────────────────────────┘    │
│                   │                              │
│                   ▼                              │
│  ┌────────────┐ ┌▼───────────┐  ┌──────────┐   │
│  │ Hydration  │◀│   Views    │◀─│   XRPC   │   │
│  │   Layer    │ │  Builder   │  │Endpoints │   │
│  └────────────┘ └────────────┘  └─────┬────┘   │
│                                        │         │
└────────────────────────────────────────┼─────────┘
                                         │
                                         ▼
                                 ┌──────────────┐
                                 │ Client Apps  │
                                 │(web, mobile) │
                                 └──────────────┘
```

### Request Flow Example

**User requests profile**: `GET /xrpc/app.bsky.actor.getProfile?actor=alice.bsky.social`

1. **AppView** receives XRPC request
2. **AppView** calls `dataPlaneClient.getProfile("alice.bsky.social")`
3. **Data-Plane Client** sends `POST /internal/getProfile` to data-plane server
4. **Data-Plane Server** queries PostgreSQL for user + counts
5. **Data-Plane Server** returns `ProfileRecord` (simple JSON)
6. **AppView** transforms `ProfileRecord` → `app.bsky.actor.defs#profileView` (lexicon)
7. **AppView** adds viewer state (following, blocking, etc.)
8. **AppView** returns lexicon-compliant response to client

## Current Status

### ✅ Complete
- Data-plane server infrastructure
- Internal RPC server
- Profile endpoints (getProfile, getProfiles, searchActors)
- Feed endpoints (getAuthorFeed, getPost, getPosts)
- Data-plane client library
- NPM scripts for development and production
- Comprehensive documentation

### ⏳ Incomplete (Need Implementation)
- Thread assembly (`getPostThread`) - **CRITICAL**
- Timeline feed (`getTimeline`) - **HIGH**
- Graph queries (follows, blocks, mutes) - **HIGH**
- Search (posts, actors) - **MEDIUM**
- Notifications - **MEDIUM**
- Feed generators - **LOW**

### 🔧 TODO (Migration)
- Update AppView services to use data-plane client
- Remove direct database access from AppView
- Add Redis caching to data-plane client
- Complete missing data-plane endpoints
- End-to-end testing

## How to Use

### Development Mode (Separate Processes)

**Terminal 1 - Start Data-Plane**:
```bash
npm run dev:data-plane
```
This starts the data-plane server on port 5001 with firehose connection.

**Terminal 2 - Start AppView**:
```bash
npm run dev:appview
```
This starts the AppView server on port 5000, configured to use data-plane at localhost:5001.

**Test it works**:
```bash
# Data-plane health
curl http://localhost:5001/health

# Test internal endpoint directly
curl -X POST http://localhost:5001/internal/getProfile \
  -H "Content-Type: application/json" \
  -d '{"actor": "alice.bsky.social"}'

# Test public XRPC (once AppView is migrated)
curl 'http://localhost:5000/xrpc/app.bsky.actor.getProfile?actor=alice.bsky.social'
```

### Development Mode (Current - Monolithic)

You can still use the existing setup:
```bash
npm run dev
```
This runs everything in one process without data-plane separation.

### Production Mode

**Option A: Single Process (Current)**
```bash
npm start
```

**Option B: Separate Processes (Recommended)**
```bash
# Terminal 1
npm run start:data-plane

# Terminal 2
DATA_PLANE_URL=http://localhost:5001 npm run start:appview
```

**Option C: Docker Compose** (see migration guide)

## Key Benefits

1. **Separation of Concerns**
   - Data-plane: Indexing, storage, raw queries
   - AppView: API serving, hydration, views, auth

2. **Independent Scaling**
   - Scale data-plane for write-heavy workloads
   - Scale AppView for read-heavy workloads

3. **Resilience**
   - AppView can cache data-plane responses
   - Data-plane can restart without affecting API (with caching)

4. **Development Velocity**
   - Work on API layer without touching indexing
   - Work on indexing without breaking API
   - Clear contract via typed interfaces

5. **Testing**
   - Mock data-plane client for AppView tests
   - Test data-plane independently

6. **Observability**
   - Clear boundaries for monitoring
   - Separate metrics per layer
   - Easier debugging

## Next Steps

### Immediate (Critical)

1. **Implement thread assembly** in `data-plane/server/routes/feeds.ts`
   - This is the #2 critical issue from analysis
   - Required for `/xrpc/app.bsky.feed.getPostThread`
   - Complex: recursive queries, depth limiting, filtering

2. **Implement timeline feed** in `data-plane/server/routes/feeds.ts`
   - Required for `/xrpc/app.bsky.feed.getTimeline`
   - Join follows with feed_items

3. **Implement graph queries** in `data-plane/server/routes/graph.ts`
   - getFollowers, getFollows, getRelationships
   - Required for profile views and viewer state

### Short-term (High Priority)

4. **Migrate one AppView service** to use data-plane client
   - Start with `actor-service.ts` (simplest)
   - Test thoroughly
   - Use as template for other services

5. **Add caching layer** to data-plane client
   - Redis-backed cache for expensive queries
   - TTL-based expiration
   - Cache invalidation on firehose events

### Medium-term

6. **Complete all data-plane endpoints**
   - Search, notifications, feed generators
   - Comprehensive implementation

7. **Migrate all AppView services**
   - Update all XRPC services to use client
   - Remove direct DB access from AppView

8. **End-to-end testing**
   - Integration tests
   - Load testing
   - Production deployment

## Migration Approach

**Incremental, Non-Breaking**:
1. Data-plane server runs alongside existing setup (no conflicts)
2. Implement endpoints one at a time
3. Update AppView services one at a time
4. Test each migration thoroughly
5. Rollback is easy (just don't use data-plane client)

**Low Risk**:
- No breaking changes to existing code
- Can run both architectures in parallel
- Easy to compare results
- Gradual migration path

## Documentation

- **[data-plane/README.md](data-plane/README.md)** - Architecture deep-dive
- **[DATA_PLANE_MIGRATION.md](DATA_PLANE_MIGRATION.md)** - Step-by-step migration
- **[APPVIEW_ANALYSIS.md](APPVIEW_ANALYSIS.md)** - Why this matters
- **[data-plane/server/types.ts](data-plane/server/types.ts)** - API contract

## Conclusion

The data-plane architecture is now **implemented and ready for gradual migration**. The foundation is solid:

✅ Server infrastructure complete
✅ Client library complete
✅ Core endpoints working (profiles, posts, feeds)
✅ Documentation comprehensive
✅ NPM scripts ready
✅ Non-breaking migration path

The remaining work is:
1. Complete missing endpoints (thread assembly is most critical)
2. Migrate AppView services to use client
3. Add caching layer
4. Production deployment

This addresses the **#1 critical architectural issue** from the analysis and brings your implementation much closer to the official Bluesky AppView design.

Great work on what you've built so far! Now you have a clear path forward. 🚀
