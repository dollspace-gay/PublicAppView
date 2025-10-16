# Data-Plane Migration Guide

This guide explains how to migrate from the monolithic architecture to the data-plane separation architecture.

## What Changed?

### Before (Monolithic)
```
┌─────────────────────────────────────────────┐
│            Single Server Process            │
│  ┌────────────┐  ┌───────────┐  ┌─────────┐│
│  │ Firehose   │─▶│   Event   │─▶│   DB    ││
│  │            │  │ Processor │  │         ││
│  └────────────┘  └───────────┘  └─────────┘│
│  ┌────────────────────────────────────────┐ │
│  │         XRPC Endpoints                 │ │
│  │  (directly queries database)           │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### After (Data-Plane Separation)
```
┌─────────────────────────────────────────────┐
│          DATA-PLANE SERVER (5001)           │
│  ┌────────────┐  ┌───────────┐  ┌─────────┐│
│  │ Firehose   │─▶│   Event   │─▶│   DB    ││
│  │            │  │ Processor │  │         ││
│  └────────────┘  └───────────┘  └─────────┘│
│  ┌────────────────────────────────────────┐ │
│  │   Internal RPC Server (HTTP/JSON)      │ │
│  └────────────────────────────────────────┘ │
└──────────────────┬──────────────────────────┘
                   │ Internal API
                   ▼
┌─────────────────────────────────────────────┐
│          APPVIEW SERVER (5000)              │
│  ┌────────────────────────────────────────┐ │
│  │    Data-Plane Client (with cache)      │ │
│  └─────────────────┬──────────────────────┘ │
│                    │                         │
│  ┌────────────┐  ┌▼───────────┐  ┌────────┐│
│  │ Hydration  │◀─│   Views    │◀─│  XRPC  ││
│  └────────────┘  └────────────┘  └────────┘│
└─────────────────────────────────────────────┘
```

## Benefits

1. **Separation of Concerns**: Indexing logic separate from API logic
2. **Independent Scaling**: Scale write-heavy indexing separately from read-heavy API
3. **Resilience**: AppView can use cached data if data-plane is restarting
4. **Development**: Work on API layer without affecting indexing
5. **Testing**: Mock data-plane client for AppView tests
6. **Observability**: Clear boundaries for monitoring

## Migration Steps

### Phase 1: Add Data-Plane Server (Non-Breaking)

**Status**: ✅ COMPLETE

The data-plane server is now available at `data-plane/server/`. It can run alongside your existing monolithic setup.

**What was added**:
- `data-plane/server/index.ts` - Data-plane server entry point
- `data-plane/server/routes/` - Internal RPC endpoints
- `data-plane/server/types.ts` - Internal API types
- `data-plane/client/index.ts` - Client library for AppView
- `data-plane/README.md` - Architecture documentation

**Current status**: Data-plane server works but endpoints are incomplete (many return 501 Not Implemented).

### Phase 2: Run Data-Plane Server (Development)

**Start data-plane server**:
```bash
npm run dev:data-plane
```

This starts the data-plane server on port 5001 with:
- Firehose connection
- Event processing
- Internal RPC endpoints (incomplete)
- Health checks at http://localhost:5001/health

**Test it works**:
```bash
# Check health
curl http://localhost:5001/health

# Test profile endpoint
curl -X POST http://localhost:5001/internal/getProfile \
  -H "Content-Type: application/json" \
  -d '{"actor": "did:plc:some-did"}'
```

### Phase 3: Update AppView to Use Data-Plane Client (In Progress)

**What needs to change**:

Currently, your AppView XRPC endpoints query the database directly:

```typescript
// OLD: Direct database access
app.get('/xrpc/app.bsky.actor.getProfile', async (req, res) => {
  const profile = await db.query.users.findFirst({
    where: eq(users.handle, req.query.actor)
  });
  // ... more database queries ...
});
```

This should become:

```typescript
// NEW: Use data-plane client
import { dataPlaneClient } from '../../data-plane/client';

app.get('/xrpc/app.bsky.actor.getProfile', async (req, res) => {
  const profile = await dataPlaneClient.getProfile(req.query.actor);
  // ... transform to lexicon view ...
});
```

**Files to update** (one endpoint at a time):
1. `server/services/xrpc/services/actor-service.ts` - Use `dataPlaneClient.getProfile()`
2. `server/services/xrpc/services/timeline-service.ts` - Use `dataPlaneClient.getAuthorFeed()`, `getTimeline()`
3. `server/services/xrpc/services/graph-service.ts` - Use `dataPlaneClient.getFollowers()`, etc.
4. `server/services/xrpc/services/search-service.ts` - Use `dataPlaneClient.searchPosts()`, `searchActors()`
5. `server/services/xrpc/services/notification-service.ts` - Use `dataPlaneClient.listNotifications()`

**Example migration** (app.bsky.actor.getProfile):

Before:
```typescript
// server/services/xrpc/services/actor-service.ts
export async function getProfile(actor: string, viewerDid?: string) {
  const user = await db.query.users.findFirst({
    where: actor.startsWith('did:')
      ? eq(users.did, actor)
      : eq(users.handle, actor),
  });

  if (!user) {
    throw new Error('Profile not found');
  }

  // Get counts...
  const followerCount = await db.execute(sql`...`);
  // ...

  return {
    did: user.did,
    handle: user.handle,
    // ... lexicon view ...
  };
}
```

After:
```typescript
// server/services/xrpc/services/actor-service.ts
import { dataPlaneClient } from '../../../data-plane/client';

export async function getProfile(actor: string, viewerDid?: string) {
  // Query data-plane instead of database
  const profile = await dataPlaneClient.getProfile(actor);

  // Transform to lexicon view
  return {
    did: profile.did,
    handle: profile.handle,
    displayName: profile.displayName,
    description: profile.description,
    avatar: profile.avatarUrl,
    banner: profile.bannerUrl,
    followersCount: profile.followersCount,
    followsCount: profile.followsCount,
    postsCount: profile.postsCount,
    indexedAt: profile.indexedAt,
    // Add viewer state if authenticated
    viewer: viewerDid ? await getViewerState(actor, viewerDid) : undefined,
  };
}
```

### Phase 4: Complete Data-Plane Endpoints

**Currently incomplete endpoints** (return 501):
- `/internal/getTimeline` - Need to implement following feed logic
- `/internal/getPostThread` - Need to implement thread assembly
- `/internal/getFollowers` - Need to implement graph queries
- `/internal/getFollows` - Need to implement graph queries
- `/internal/getRelationships` - Need to implement relationship queries
- `/internal/getBlocks` - Need to implement block queries
- `/internal/getMutes` - Need to implement mute queries
- `/internal/searchPosts` - Need to implement full-text search
- `/internal/listNotifications` - Need to implement notification queries
- `/internal/getUnreadCount` - Need to implement notification count
- `/internal/getFeedGenerators` - Need to implement feed generator queries

**Priority order** (most critical first):
1. ✅ `getProfile` - DONE
2. ✅ `getProfiles` - DONE
3. ✅ `getAuthorFeed` - DONE (basic)
4. ✅ `getPost` - DONE
5. ✅ `getPosts` - DONE
6. ⏳ `getPostThread` - CRITICAL (thread assembly logic needed)
7. ⏳ `getTimeline` - HIGH (following feed logic needed)
8. ⏳ `getFollowers` / `getFollows` - HIGH
9. ⏳ `getRelationships` - HIGH (for viewer state)
10. ⏳ `searchPosts` / `searchActors` - MEDIUM
11. ⏳ `listNotifications` - MEDIUM
12. ⏳ Feed generators - LOW

### Phase 5: Remove Direct Database Access from AppView

Once all endpoints use the data-plane client, remove direct database access from AppView:

1. Remove `import { db }` from AppView service files
2. Remove database schema imports
3. Update AppView to only use `dataPlaneClient`
4. AppView should only access database for:
   - User sessions
   - User settings/preferences
   - OAuth tokens
   - Admin operations

**Data-plane owns**: Posts, users (profiles), likes, reposts, follows, blocks, notifications, feed generators

**AppView owns**: Sessions, user settings, OAuth state, admin data

### Phase 6: Add Caching to Data-Plane Client

Currently, the data-plane client makes HTTP requests for every query. Add Redis caching:

```typescript
// data-plane/client/cache.ts
export class CachedDataPlaneClient extends DataPlaneClient {
  private redis: Redis;

  async getProfile(actor: string): Promise<ProfileRecord> {
    const cacheKey = `profile:${actor}`;
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const profile = await super.getProfile(actor);
    await this.redis.setex(cacheKey, 60, JSON.stringify(profile)); // 60s TTL

    return profile;
  }
}
```

### Phase 7: Production Deployment

**Option A: Single Process (Current)**

Keep running everything in one process (no changes needed):
```bash
npm run dev  # Development
npm start    # Production
```

**Option B: Separate Processes (Recommended)**

Run data-plane and AppView as separate services:

```bash
# Terminal 1: Data-plane (indexing)
npm run dev:data-plane

# Terminal 2: AppView (API)
DATA_PLANE_URL=http://localhost:5001 npm run dev:appview
```

**Option C: Docker Compose**

```yaml
version: '3.8'
services:
  db:
    image: postgres:14
    # ... postgres config ...

  redis:
    image: redis:7
    # ... redis config ...

  data-plane:
    build: .
    command: npm run start:data-plane
    ports:
      - "5001:5001"  # Internal only (not exposed)
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - RELAY_URL=${RELAY_URL}
    depends_on:
      - db
      - redis

  appview:
    build: .
    command: npm run start:appview
    ports:
      - "5000:5000"  # Public
    environment:
      - DATA_PLANE_URL=http://data-plane:5001
      - REDIS_URL=${REDIS_URL}
      - SESSION_SECRET=${SESSION_SECRET}
    depends_on:
      - data-plane
      - redis
```

## Testing

### Test Data-Plane Server

```bash
# Start data-plane
npm run dev:data-plane

# In another terminal, test endpoints
curl http://localhost:5001/health
curl http://localhost:5001/ready
curl http://localhost:5001/metrics

# Test profile endpoint
curl -X POST http://localhost:5001/internal/getProfile \
  -H "Content-Type: application/json" \
  -d '{"actor": "alice.bsky.social"}'
```

### Test AppView with Data-Plane Client

```bash
# Start both services
npm run dev:data-plane  # Terminal 1
DATA_PLANE_URL=http://localhost:5001 npm run dev:appview  # Terminal 2

# Test public XRPC endpoint
curl 'http://localhost:5000/xrpc/app.bsky.actor.getProfile?actor=alice.bsky.social'
```

## Rollback Plan

If you need to rollback to the monolithic architecture:

1. Keep using `npm run dev` (unchanged)
2. Don't update AppView services to use data-plane client
3. The data-plane code doesn't affect the existing monolithic setup

The data-plane is **additive** - it doesn't break existing functionality.

## Next Steps

1. ✅ Read this migration guide
2. ⏳ Complete remaining data-plane endpoints (start with `getPostThread`)
3. ⏳ Update one AppView service to use data-plane client (start with actor-service)
4. ⏳ Test thoroughly
5. ⏳ Gradually migrate all endpoints
6. ⏳ Add caching to data-plane client
7. ⏳ Deploy as separate services

## Questions?

Refer to:
- `data-plane/README.md` - Architecture overview
- `data-plane/server/types.ts` - Internal API types
- `data-plane/client/index.ts` - Client API
- `APPVIEW_ANALYSIS.md` - Why this architecture matters

## Status

**Current state**: Data-plane server implemented but incomplete. AppView still uses direct database access.

**Target state**: Data-plane handles all indexing and queries. AppView only handles API serving, hydration, and views.

**Estimated effort**: 2-3 weeks to complete all endpoints and migration.

**Risk level**: Low - migration can be done incrementally without breaking existing functionality.
