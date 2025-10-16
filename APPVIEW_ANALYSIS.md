# PublicAppView vs Official bsky-appview Analysis

## Executive Summary

Your PublicAppView is a **third-party monolithic AT Protocol AppView implementation** designed to run on a single large server rather than distributed pods. After comparing it against the official Bluesky AppView (`@atproto/bsky`), here's what's broken, flawed, or missing.

**Overall Assessment**: Your implementation has the **right ideas** but suffers from architectural misalignments, missing critical infrastructure, and some fundamental misunderstandings of the AppView's role in the AT Protocol ecosystem.

---

## Critical Architecture Differences

### 1. Missing Data-Plane Architecture ❌ CRITICAL

**Official bsky-appview**: Uses a sophisticated **data-plane** architecture that separates data indexing/storage from the API serving layer.

**Your implementation**: Monolithic design where everything lives in one codebase without clear separation.

**Why this matters**:
- The data-plane is the **core indexing engine** that processes firehose events and maintains the indexed state
- It provides internal RPC endpoints for the AppView layer to query
- Allows horizontal scaling by separating read (AppView) from write (data-plane) operations
- Your current approach mixes concerns: firehose ingestion, event processing, and API serving are all tightly coupled

**Missing components**:
- `data-plane/server/` - The indexing service that processes events
- `data-plane/client/` - Client library for AppView to query the data-plane
- `data-plane/server/routes/` - Internal RPC routes (feeds, profile, threads, search, etc.)
- Separation of concerns between indexing and serving

**Fix Required**: Major refactor needed. Extract all indexing/event processing into a separate data-plane service with internal RPC endpoints.

---

### 2. Primitive Hydration Layer ⚠️ MAJOR FLAW

**Official bsky-appview**: Sophisticated hydration system in `packages/bsky/src/hydration/`:
- `hydrator.ts` - Core hydration orchestrator with batching
- `actor.ts` - Actor/profile hydration with viewer state
- `feed.ts` - Feed item hydration with embeds
- `graph.ts` - Social graph hydration (follows, blocks)
- `label.ts` - Content moderation label hydration
- Uses DataLoader pattern for N+1 query prevention

**Your implementation**: Basic hydration in `server/services/hydration.ts`:
- Only handles posts, reposts, and basic profile viewers
- No DataLoader usage for batch loading
- Missing embed hydration
- Missing label propagation
- No thread context hydration
- Primitive viewer state handling

**Impact**: N+1 query problems, slow API responses, incomplete data returned to clients.

**Fix Required**:
1. Implement proper DataLoader pattern (you have the middleware but not full usage)
2. Add comprehensive hydrators for all entity types
3. Implement label propagation system
4. Add embed resolution and recursive hydration

---

### 3. Incorrect "Views" Implementation ⚠️ MAJOR ISSUE

**Official bsky-appview**: Has `views/` module that transforms indexed data into lexicon-compliant view objects:
- `app.bsky.feed.defs#postView`
- `app.bsky.actor.defs#profileView`
- `app.bsky.feed.defs#threadViewPost`

**Your implementation**: Your `server/services/views.ts` appears to exist but is not structured correctly. You're likely constructing view objects ad-hoc in route handlers.

**Why this matters**:
- Views are the **contract** between AppView and clients
- Must precisely match lexicon schemas
- Need consistent transformation logic across all endpoints
- Viewer state must be correctly embedded (like, repost, follow status)

**Fix Required**: Create proper view builder classes that take indexed records + viewer context and produce lexicon-compliant views.

---

### 4. No Proper Thread Assembly ❌ CRITICAL

**Official bsky-appview**: `views/threads-v2.ts` - Sophisticated thread assembly:
- Recursive parent/child loading
- Depth limiting
- Reply pruning based on viewer relationships
- ThreadGate enforcement
- Pagination within threads

**Your implementation**: Basic reply fetching without proper tree assembly.

**Impact**: Thread views are broken or incomplete. Replies won't load correctly.

**Fix Required**: Implement proper thread tree building with:
- Recursive ancestor loading (up to root)
- Descendant loading with depth limits
- Thread gate rule enforcement
- Viewer-based filtering

---

## Missing Core Features

### 5. No Bsync (Block Sync) Protocol ❌ CRITICAL

**Official bsky-appview**: `data-plane/bsync/` implements the bsync protocol for efficient state synchronization.

**Your implementation**: Completely missing.

**Why this matters**:
- Bsync is used for efficient bulk data fetching from PDS
- Required for proper profile/post backfilling
- Critical for recovering from firehose gaps
- Part of the AT Protocol specification

**Fix Required**: Implement bsync client or document that you're not supporting it (breaking spec).

---

### 6. Missing Image Service ⚠️ MAJOR GAP

**Official bsky-appview**: Complete `image/` module:
- `image/server.ts` - Serves resized images
- `image/sharp.ts` - Image processing with Sharp
- `image/uri.ts` - CDN URL building
- `image/invalidator.ts` - Cache invalidation

**Your implementation**: You have `bsky-appview/image/` directory but it's the **copied official code**, not integrated into your actual server.

**Impact**:
- No image serving
- No thumbnail generation
- Clients must fetch full-size images from blob storage
- Poor performance and bandwidth usage

**Fix Required**: Integrate image service or proxy to external image CDN.

---

### 7. Incomplete Notification System ⚠️ MODERATE

**Your implementation**: Basic notifications in `server/services/xrpc/services/notification-service.ts`

**Missing**:
- Notification grouping (e.g., "5 people liked your post")
- Unread count caching
- Notification preferences/filtering
- Push notification integration (partially there in schema but not implemented)

**Fix Required**: Implement notification grouping and improve notification query performance.

---

### 8. No Feed Generator Integration Testing ⚠️ MODERATE

**Your implementation**: Has `feed-generator-client.ts` and `feed-generator-discovery.ts`

**Issue**:
- Discovery logic looks OK
- Missing proper JWT authentication for feed generators
- No DID resolution caching for feed generator DIDs
- Missing skeleton hydration optimization

**Fix Required**: Add proper auth, caching, and skeleton merging logic.

---

## Flawed Implementations

### 9. Event Processing Race Conditions ⚠️ DATA INTEGRITY RISK

**File**: `server/services/event-processor.ts`

**Issues**:
1. **Pending operation queues are memory-only**: If server crashes, you lose pending ops
2. **No distributed locking**: Multiple workers will process same events with Redis queue
3. **User creation concurrency is limited but not distributed**: `MAX_CONCURRENT_USER_CREATIONS` only works per-process
4. **TTL sweeper runs every minute but doesn't persist**: Lost on restart

**Impact**: Data loss on crashes, duplicate processing in multi-worker deployments.

**Fix Required**:
- Use Redis-backed queues for pending ops
- Implement distributed locks for user creation
- Persist pending state to database or Redis

---

### 10. Firehose Cursor Persistence is Weak ⚠️

**File**: `server/services/firehose.ts`

**Issues**:
1. Cursor saves every 5 seconds but only from worker 0
2. If worker 0 crashes, cursor is lost
3. No distributed coordination for cursor persistence
4. Single firehose connection across all workers (via Redis pub/sub) is clever but fragile

**Your design** (Redis pub/sub for events) is **actually good** for monolithic deployment but doesn't align with official's pod-based model.

**Fix Required**:
- Make cursor persistence distributed and redundant
- Document that this is a single-instance deployment model

---

### 11. Search Implementation is Incomplete ⚠️

**File**: `server/services/search.ts`

**Official bsky-appview**: Uses dedicated search infrastructure (likely Elasticsearch or similar)

**Your implementation**: PostgreSQL full-text search with GIN indexes

**Issues**:
- No faceted search
- No relevance tuning
- No autocomplete/typeahead
- No trending/popularity signals
- Limited language support

**Trade-off**: PostgreSQL FTS is fine for small/medium deployments but won't scale to Bluesky's size.

**Recommendation**: Document this as a limitation or add note about replacing with Elasticsearch later.

---

### 12. Moderation Service is Stub Implementation ⚠️

**File**: `server/services/moderation.ts`

**Missing**:
- Moderator queue management
- Report triage/routing
- Bulk moderation actions
- Appeal system
- Audit logging

**Your tables exist** (moderationReports, moderationActions) but service logic is minimal.

**Fix Required**: Implement full moderation workflow or mark as "admin only" feature.

---

### 13. No Proper Cache Invalidation Strategy ⚠️

**File**: `server/services/cache.ts`

**Issues**:
- Simple TTL-based caching
- No event-driven invalidation
- No cache warming
- Missing cache-aside pattern for expensive queries

**Official approach**: Uses Redis with sophisticated invalidation based on firehose events.

**Fix Required**: Add event listeners to invalidate cache when entities change.

---

## Missing Infrastructure

### 14. No Proper Logging/Observability ⚠️

**Official bsky-appview**: Uses structured logging with context propagation

**Your implementation**:
- `logCollector.ts` is basic
- No request tracing
- No distributed tracing (OpenTelemetry)
- No error aggregation (Sentry, etc.)

**Impact**: Debugging production issues will be painful.

---

### 15. No Rate Limiting Per-User ⚠️

**File**: `server/middleware/rate-limit.ts`

**Your implementation**: IP-based rate limiting

**Official approach**: Per-DID rate limiting with sliding windows

**Issue**: IP limiting doesn't work for authenticated users (multiple users behind NAT)

**Fix Required**: Add DID-based rate limiting for authenticated endpoints.

---

### 16. Missing Health Checks ⚠️

**You have**: `/health` and `/ready` endpoints

**Missing**:
- Dependency health checks (PostgreSQL, Redis, Firehose)
- Detailed status reporting
- Liveness vs readiness distinction
- Metrics endpoint (`/metrics` for Prometheus)

**Fix Required**: Make health checks comprehensive.

---

## Schema Differences

### 17. Database Schema Gaps ⚠️

**Your schema** (`shared/schema.ts`) is **comprehensive** and actually includes some tables the official might not (like `bookmarks`).

**Missing compared to official**:
1. **Aggregation tables**: Official uses separate tables for counts; yours uses `postAggregations` (good!)
2. **Message threading**: Official has DM support; yours doesn't
3. **Video processing**: You have `videoJobs` table but no service
4. **Blob references**: Official tracks blob usage; yours doesn't

**Your unique additions** (actually good):
- `bookmarks` table
- `quotes` table
- `verifications` table
- `threadContexts` table
- More comprehensive than official schema!

**Issue**: Your schema is **ahead** of your implementation. Many tables aren't used.

---

### 18. Foreign Key Constraints Removed ⚠️ CONTROVERSIAL

**Your approach**: Comments say "No FK - can reference external users"

**Official approach**: Maintains referential integrity within indexed data

**Your reasoning**: You're building a federated AppView that indexes external data

**Issue**: This is **philosophically different** from official. Official assumes all data is local. Yours assumes federation.

**Verdict**: This is OK **IF** you properly handle orphaned records and cascade deletes manually.

---

## Missing Lexicon Endpoints

### 19. Incomplete XRPC Coverage ⚠️

**Your claim** (README): "52 endpoints implemented"

**Official bsky endpoints**: ~60+ endpoints

**Missing** (spot-checked):
- `app.bsky.graph.getSuggestedFollowsByActor`
- `app.bsky.actor.getPreferences` (partially there)
- `app.bsky.actor.putPreferences` (needs PDS proxy)
- `app.bsky.feed.describeFeedGenerator`
- `app.bsky.feed.searchPosts` (yours is simpler)
- `app.bsky.labeler.getServices`
- `app.bsky.unspecced.getPopularFeedGenerators`

**Fix Required**: Audit against latest lexicons and implement missing endpoints.

---

## Broken Features

### 20. OAuth Implementation is Incomplete ❌ SECURITY ISSUE

**File**: `server/services/oauth-service.ts`

**Issues**:
1. Using `@atproto/oauth-client-node` but not fully configured
2. Missing PKCE enforcement in some flows
3. Token storage uses simple encryption (AES-GCM) but key rotation not implemented
4. No refresh token rotation
5. Session fixation risk (session ID from client)

**Fix Required**:
- Follow OAuth 2.1 best practices
- Implement token rotation
- Use cryptographically random session IDs

---

### 21. PDS Write Proxy is Risky ⚠️

**File**: `server/middleware/xrpc-proxy.ts`

**Your approach**: Proxy write operations to user's PDS

**Issues**:
1. No request signing verification
2. No replay attack prevention
3. No rate limiting on proxied requests
4. Passes user tokens through (OK) but no validation

**Official approach**: AppView doesn't handle writes; clients go directly to PDS

**Verdict**: Your proxy approach is **non-standard**. Works but adds attack surface.

---

### 22. DID Resolution Caching is Weak ⚠️

**File**: `server/services/did-resolver.ts`

**Issues**:
- Simple in-memory cache (lost on restart)
- No TTL honoring from DID documents
- No cache warming for popular DIDs
- Missing PLC directory integration

**Fix Required**: Use persistent cache (Redis) and respect TTL.

---

## Performance Issues

### 23. No Connection Pooling Configuration ⚠️

**File**: `server/db.ts`

**Issues**:
- Uses Drizzle ORM with Neon serverless driver
- Neon is great but you're not configuring pool size properly
- `MAX_CONCURRENT_OPS=80` but what's your DB pool size?
- Risk of pool exhaustion under load

**Fix Required**: Document required PostgreSQL connection limits and configure pool size.

---

### 24. Feed Generation is Slow ⚠️

**File**: `server/services/feed-algorithm.ts`

**Issues**:
- Runs complex queries in-line for every feed request
- No pre-computed feed tables
- No fan-out-on-write optimization

**Official approach**: Pre-computes popular feeds, stores in fast-access tables

**Your approach**: Fan-out-on-read (compute at request time)

**Trade-off**: Your approach is simpler but slower. OK for small deployments.

---

## What You're Doing RIGHT ✅

### 25. Things You Got Right

1. **Database schema is excellent** - More comprehensive than official in some areas
2. **PostgreSQL full-text search** - Good pragmatic choice
3. **Redis for clustering** - Clever use of Redis pub/sub for event distribution
4. **Cursor persistence** - Good recovery mechanism
5. **Monolithic design** - Makes sense for self-hosting
6. **DataLoader middleware** - You have it set up (just need to use it more)
7. **Content filtering** - Your keyword filtering is nice addition
8. **Data collection forbidden flag** - Good privacy feature
9. **Admin authorization** - Good security model
10. **Comprehensive monitoring dashboard** - Very useful!

---

## Priority Fixes

### CRITICAL (Fix Immediately)

1. ❌ Implement proper thread assembly (`views/threads-v2.ts` equivalent)
2. ❌ Fix OAuth security issues (token rotation, PKCE)
3. ❌ Fix event processor race conditions (Redis-backed queues)
4. ❌ Add missing lexicon endpoints for basic functionality

### HIGH (Fix Soon)

5. ⚠️ Implement comprehensive hydration layer with DataLoader
6. ⚠️ Add image serving/processing service
7. ⚠️ Improve firehose cursor persistence (distributed)
8. ⚠️ Fix DID resolution caching
9. ⚠️ Implement proper view transformations

### MEDIUM (Nice to Have)

10. ⚠️ Add notification grouping
11. ⚠️ Improve search (facets, relevance)
12. ⚠️ Add cache invalidation strategy
13. ⚠️ Implement moderation workflow
14. ⚠️ Add health check dependencies

### LOW (Document or Defer)

15. Document lack of bsync support
16. Document data-plane differences
17. Document that this is single-instance deployment
18. Consider adding Elasticsearch later

---

## Philosophical Differences

Your AppView is designed for **self-hosting** and **monolithic deployment**. The official AppView is designed for **distributed pods** and **horizontal scaling**. Neither is wrong, but they serve different purposes.

**Your model**: Single big VPS, Redis for coordination, PostgreSQL for everything.

**Official model**: Kubernetes pods, separate data-plane, distributed caching, external search.

**Verdict**: Your design is **valid** for small/medium deployments (< 10M posts). Won't scale to Bluesky's size but doesn't need to.

---

## Recommendations

### Short-term
1. Fix thread assembly ASAP (breaks core UX)
2. Fix OAuth security holes
3. Implement proper hydration with DataLoader
4. Add missing critical endpoints

### Medium-term
1. Extract data-plane as separate service (big refactor)
2. Add image service
3. Improve caching and invalidation
4. Complete notification system

### Long-term
1. Consider adding Elasticsearch for search
2. Implement bsync protocol
3. Add proper observability (OpenTelemetry)
4. Performance optimization (pre-computed feeds)

---

## Conclusion

Your PublicAppView is a **valiant effort** and has some genuinely good ideas (especially the privacy features and comprehensive schema). However, it's missing critical pieces of the AT Protocol specification and has architectural misalignments with the official implementation.

**Key takeaways**:
- ✅ Database schema is solid
- ✅ Monolithic design is pragmatic for self-hosting
- ❌ Missing data-plane separation
- ❌ Thread assembly is broken
- ❌ Hydration is too primitive
- ⚠️ OAuth needs security fixes
- ⚠️ Event processing has race conditions

**Bottom line**: This is a **working prototype** that handles basic cases but needs significant work to be production-ready. Focus on thread assembly, hydration, and security fixes first.

Good luck! You've built more than most people do with Cursor and Replit. Now it's time to clean it up. 🚀
