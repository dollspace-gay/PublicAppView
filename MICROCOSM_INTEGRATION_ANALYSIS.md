# Microcosm-rs Integration Analysis

## Executive Summary

**Yes, we can definitely integrate microcosm-rs components with the appview code**, following a similar pattern to the Osprey bridge. The microcosm-rs project provides several high-value AT Protocol services that would complement the appview nicely.

## What is Microcosm-rs?

Microcosm-rs is a collection of production-ready Rust services for the AT Protocol ecosystem. It provides:

### 🌌 Constellation - Global Backlink Index
- **What it does**: Tracks all social interactions (likes, follows, replies) across atproto as backlinks
- **Use case**: Answer questions like "how many likes does this post have", "who follows this account"
- **API**: Simple JSON REST API
- **Performance**: Runs on Raspberry Pi, <2GB/day storage
- **Public instance**: https://constellation.microcosm.blue/

### 🎇 Spacedust - Interactions Firehose
- **What it does**: WebSocket firehose of all AT-URIs, DIDs, and URLs extracted from every lexicon
- **Use case**: Real-time notifications for any atproto app, not just Bluesky
- **API**: Jetstream-like WebSocket interface
- **Public instance**: https://spacedust.microcosm.blue/

### 🛸 UFOs - Collection Analytics
- **What it does**: Timeseries stats and samples for every collection in atproto
- **Use case**: Usage analytics, unique user counts with HyperLogLog
- **API**: JSON REST API
- **Public instance**: https://ufos-api.microcosm.blue/

### 🛰️ Slingshot - Record Edge Cache
- **What it does**: Fast, eager caching of atproto records and identities from firehose
- **Use case**: High-performance record retrieval with minimal latency
- **Status**: v0, most XRPC APIs working

### 💫 Jetstream Client Library
- **What it does**: Low-overhead Rust Jetstream client with auto-reconnect
- **Use case**: Building blocks for consuming Jetstream in Rust

## Current Osprey Bridge Architecture

Your existing Osprey bridge follows this pattern:

```
Input Sources (3 adapters):
├─ AT Protocol Firehose [FirehoseAdapter]
├─ Redis Stream [RedisAdapter]  
└─ Direct In-Process [DirectAdapter]
  ↓
Pluggable Input Adapter (TypeScript)
  ↓
Firehose-to-Kafka Bridge
  ├─ Event Enricher (PostgreSQL queries)
  ├─ Kafka Producer
  └─ Cursor Persistence
  ↓
Kafka Topic: atproto.firehose.enriched
  ↓
Osprey (external moderation service)
  ↓
Kafka Topic: osprey.labels
  ↓
Label Effector (TypeScript)
  └─ Writes to AppView PostgreSQL
```

**Key characteristics:**
- TypeScript/Node.js implementation
- Pluggable adapter pattern for input sources
- Health monitoring endpoints
- Event enrichment with profile data
- Kafka for inter-service communication
- Docker Compose integration with profiles

## Integration Approaches for Microcosm Components

### Option 1: API Bridge Pattern (Recommended First Step)

**Similar to Osprey**: Create a TypeScript bridge that consumes microcosm APIs and feeds data into your appview.

#### 1A. Constellation Bridge (Interaction Stats)

```
Constellation API (constellation.microcosm.blue)
  ↓
TypeScript HTTP Client Bridge
  ├─ Periodic polling for backlink counts
  ├─ Cache results in Redis
  └─ Expose to AppView via internal API
  ↓
AppView (Enhanced Post/Profile Views)
  └─ Display accurate interaction counts
```

**Value proposition:**
- **More accurate counts**: No need to compute likes/reposts locally
- **Lower compute**: Offload counting to external service
- **Cross-lexicon support**: Works with any atproto app, not just Bluesky
- **Easy to implement**: Simple HTTP client, no complex infrastructure

**Implementation pattern:**
```typescript
// microcosm-bridge/constellation-client/src/index.ts
class ConstellationClient {
  async getLikeCount(postUri: string): Promise<number> {
    const response = await fetch(
      `${this.baseUrl}/links/count?` +
      `target=${encodeURIComponent(postUri)}` +
      `&collection=app.bsky.feed.like` +
      `&path=.subject.uri`
    );
    return parseInt(await response.text());
  }

  async getAllBacklinks(did: string): Promise<BacklinkSummary> {
    const response = await fetch(
      `${this.baseUrl}/links/all/count?target=${encodeURIComponent(did)}`
    );
    return await response.json();
  }
}

// Integration with AppView
class EnhancedViewsService {
  async enrichPostWithStats(post: Post): Promise<EnhancedPost> {
    const [likes, reposts, replies] = await Promise.all([
      this.constellation.getLikeCount(post.uri),
      this.constellation.getRepostCount(post.uri),
      this.constellation.getReplyCount(post.uri)
    ]);
    return { ...post, stats: { likes, reposts, replies } };
  }
}
```

#### 1B. Spacedust Bridge (Real-time Interactions)

```
Spacedust WebSocket (spacedust.microcosm.blue)
  ↓
TypeScript WebSocket Client Bridge
  ├─ Subscribe to interaction events
  ├─ Filter relevant DIDs/collections
  └─ Publish to Redis or Kafka
  ↓
AppView Event Processor
  └─ Real-time notification system
```

**Value proposition:**
- **Comprehensive notifications**: Not just Bluesky, all atproto apps
- **Link extraction**: See when your content is referenced anywhere
- **Lower latency**: No need to parse full firehose
- **Reduced bandwidth**: Only receive link events, not all records

**Use cases:**
- Universal notification system (any mention/reference)
- Analytics dashboard (who's linking to my content)
- Discovery features (where is this being discussed)

#### 1C. UFOs Bridge (Analytics)

```
UFOs API (ufos-api.microcosm.blue)
  ↓
TypeScript HTTP Client Bridge
  ├─ Periodic collection stats fetch
  ├─ Store timeseries in PostgreSQL
  └─ Expose via AppView dashboard
  ↓
Admin Dashboard
  └─ Collection trends, user growth analytics
```

**Value proposition:**
- **Network insights**: See trends across entire atproto
- **Collection discovery**: What new app collections are emerging
- **Unique user counts**: HyperLogLog-based cardinality estimates
- **Zero overhead**: No local computation needed

### Option 2: Self-Hosted Rust Services

**For production deployments**: Run your own instances of microcosm services.

```
docker-compose.yml additions:
  
  constellation:
    build: ./microcosm-rs/constellation
    volumes:
      - constellation-data:/data
    environment:
      - JETSTREAM=us-east-1
    profiles:
      - microcosm

  spacedust:
    build: ./microcosm-rs/spacedust
    ports:
      - "3100:3100"
    environment:
      - JETSTREAM=us-east-1
    profiles:
      - microcosm
```

**Advantages:**
- Full control over data and uptime
- No dependency on external services
- Can customize for specific use cases
- Lower latency (local network)

**Considerations:**
- Resource requirements (though modest - Constellation runs on Raspberry Pi)
- Additional operational complexity
- Storage needs (~2GB/day for Constellation)

### Option 3: Hybrid Architecture

**Best of both worlds**: Use public APIs for development/testing, self-host for production.

```typescript
// config/microcosm.ts
export const microcosmConfig = {
  constellation: {
    baseUrl: process.env.CONSTELLATION_URL || 
             'https://constellation.microcosm.blue',
    selfHosted: process.env.CONSTELLATION_SELF_HOSTED === 'true'
  },
  spacedust: {
    wsUrl: process.env.SPACEDUST_URL || 
           'wss://spacedust.microcosm.blue',
    selfHosted: process.env.SPACEDUST_SELF_HOSTED === 'true'
  }
}
```

## Recommended Integration Roadmap

### Phase 1: Constellation API Integration (Low Effort, High Value)
**Estimated effort**: 2-3 days

1. Create `microcosm-bridge/constellation-client/` similar to osprey-bridge structure
2. Implement TypeScript client for Constellation API
3. Add Redis caching layer for API responses
4. Integrate with post/profile hydration service
5. Add health monitoring endpoint
6. Update Docker Compose with optional microcosm profile

**Deliverables:**
- More accurate like/repost/reply counts
- Cross-app interaction visibility
- Foundation for future microcosm integrations

### Phase 2: Spacedust WebSocket Integration
**Estimated effort**: 3-4 days

1. Create `microcosm-bridge/spacedust-client/`
2. WebSocket subscription with reconnection logic
3. Event filtering and transformation
4. Integration with notification system
5. Kafka/Redis pub/sub for event distribution

**Deliverables:**
- Universal atproto notifications
- Real-time link/mention tracking
- Enhanced discovery features

### Phase 3: UFOs Analytics Dashboard
**Estimated effort**: 2-3 days

1. Create `microcosm-bridge/ufos-client/`
2. Periodic stats collection
3. Admin dashboard integration
4. Timeseries visualization

**Deliverables:**
- Network analytics dashboard
- Collection trends visualization
- Growth metrics

### Phase 4: Self-Hosted Deployment (Optional)
**Estimated effort**: 3-5 days

1. Add Rust services to docker-compose.yml
2. Configure persistent storage volumes
3. Setup monitoring and health checks
4. Migration path from public APIs

## Technical Similarities with Osprey Bridge

Your team will find these patterns familiar:

| Aspect | Osprey Bridge | Microcosm Bridge |
|--------|---------------|------------------|
| **Language** | TypeScript | TypeScript (bridge) + Rust (services) |
| **Input** | AT Protocol Firehose → Kafka | Microcosm APIs/WebSockets |
| **Adapters** | Firehose/Redis/Direct | API HTTP/WebSocket/Self-hosted |
| **Health Monitoring** | Express health endpoint | Same pattern |
| **Docker Integration** | docker-compose profiles | Same pattern |
| **Event Processing** | Kafka → Label Effector | Similar async processing |
| **Configuration** | .env files | Same pattern |

## Code Structure Proposal

```
microcosm-bridge/
├── README.md
├── constellation-client/
│   ├── Dockerfile
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── index.ts           # Main service
│       ├── api-client.ts      # Constellation HTTP client
│       ├── cache.ts           # Redis caching layer
│       ├── enricher.ts        # Post/profile enrichment
│       └── health.ts          # Health check endpoint
├── spacedust-client/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.ts           # Main service
│       ├── ws-client.ts       # WebSocket client
│       ├── event-filter.ts    # Event filtering logic
│       └── publisher.ts       # Kafka/Redis publisher
└── ufos-client/
    ├── Dockerfile
    ├── package.json
    └── src/
        ├── index.ts           # Main service
        ├── api-client.ts      # UFOs HTTP client
        └── aggregator.ts      # Stats aggregation
```

## Example: Constellation Integration

Here's what the code would look like:

```typescript
// microcosm-bridge/constellation-client/src/api-client.ts
import fetch from 'node-fetch';

interface ConstellationConfig {
  baseUrl: string;
  timeout?: number;
  cacheEnabled?: boolean;
}

export class ConstellationAPIClient {
  private baseUrl: string;
  private timeout: number;

  constructor(config: ConstellationConfig) {
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout || 5000;
  }

  /**
   * Get count of backlinks to a target from specified collection/path
   */
  async getLinksCount(
    target: string,
    collection: string,
    path: string
  ): Promise<number> {
    const url = `${this.baseUrl}/links/count?` +
      `target=${encodeURIComponent(target)}` +
      `&collection=${encodeURIComponent(collection)}` +
      `&path=${encodeURIComponent(path)}`;

    const response = await fetch(url, {
      timeout: this.timeout,
      headers: {
        'User-Agent': 'AppView-Microcosm-Bridge/1.0 (@your-handle.bsky.social)'
      }
    });

    if (!response.ok) {
      throw new Error(`Constellation API error: ${response.status}`);
    }

    const count = parseInt(await response.text());
    return count;
  }

  /**
   * Get all backlinks to a target (any collection/path)
   */
  async getAllLinksCount(target: string): Promise<Record<string, Record<string, number>>> {
    const url = `${this.baseUrl}/links/all/count?target=${encodeURIComponent(target)}`;
    
    const response = await fetch(url, {
      timeout: this.timeout,
      headers: {
        'User-Agent': 'AppView-Microcosm-Bridge/1.0 (@your-handle.bsky.social)'
      }
    });

    if (!response.ok) {
      throw new Error(`Constellation API error: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Convenience methods for common Bluesky queries
   */
  async getPostLikes(postUri: string): Promise<number> {
    return this.getLinksCount(postUri, 'app.bsky.feed.like', '.subject.uri');
  }

  async getPostReposts(postUri: string): Promise<number> {
    return this.getLinksCount(postUri, 'app.bsky.feed.repost', '.subject.uri');
  }

  async getPostReplies(postUri: string): Promise<number> {
    return this.getLinksCount(postUri, 'app.bsky.feed.post', '.reply.parent.uri');
  }

  async getFollowers(did: string): Promise<number> {
    return this.getLinksCount(did, 'app.bsky.graph.follow', '.subject');
  }
}

// microcosm-bridge/constellation-client/src/enricher.ts
import { ConstellationAPIClient } from './api-client';
import Redis from 'ioredis';

export class PostStatsEnricher {
  private client: ConstellationAPIClient;
  private cache: Redis | null;
  private cacheEnabled: boolean;
  private cacheTTL: number;

  constructor(
    client: ConstellationAPIClient,
    redisUrl?: string,
    cacheTTL = 60 // 1 minute default
  ) {
    this.client = client;
    this.cacheEnabled = !!redisUrl;
    this.cacheTTL = cacheTTL;
    
    if (redisUrl) {
      this.cache = new Redis(redisUrl);
    } else {
      this.cache = null;
    }
  }

  async getPostStats(postUri: string) {
    const cacheKey = `constellation:stats:${postUri}`;

    // Check cache first
    if (this.cache && this.cacheEnabled) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    // Fetch from Constellation
    const [likes, reposts, replies, quotes] = await Promise.all([
      this.client.getPostLikes(postUri),
      this.client.getPostReposts(postUri),
      this.client.getPostReplies(postUri),
      this.client.getLinksCount(postUri, 'app.bsky.feed.post', '.embed.record.uri')
    ]);

    const stats = { likes, reposts, replies, quotes };

    // Cache the result
    if (this.cache && this.cacheEnabled) {
      await this.cache.setex(cacheKey, this.cacheTTL, JSON.stringify(stats));
    }

    return stats;
  }

  async getProfileStats(did: string) {
    const cacheKey = `constellation:profile:${did}`;

    if (this.cache && this.cacheEnabled) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    const allLinks = await this.client.getAllLinksCount(did);
    
    const stats = {
      followers: allLinks['app.bsky.graph.follow']?.['.subject'] || 0,
      mentions: allLinks['app.bsky.feed.post']?.['facets[].features[].did'] || 0,
      blocks: allLinks['app.bsky.graph.block']?.['.subject'] || 0,
      lists: allLinks['app.bsky.graph.listitem']?.['.subject'] || 0
    };

    if (this.cache && this.cacheEnabled) {
      await this.cache.setex(cacheKey, this.cacheTTL, JSON.stringify(stats));
    }

    return stats;
  }

  async close() {
    if (this.cache) {
      await this.cache.quit();
    }
  }
}
```

## Integration with Existing AppView

```typescript
// server/services/constellation-integration.ts
import { ConstellationAPIClient } from '../../microcosm-bridge/constellation-client/src/api-client';
import { PostStatsEnricher } from '../../microcosm-bridge/constellation-client/src/enricher';

const constellationEnabled = process.env.CONSTELLATION_ENABLED === 'true';
const constellationUrl = process.env.CONSTELLATION_URL || 'https://constellation.microcosm.blue';

export const constellationClient = constellationEnabled 
  ? new ConstellationAPIClient({ baseUrl: constellationUrl })
  : null;

export const postStatsEnricher = constellationEnabled
  ? new PostStatsEnricher(
      constellationClient!,
      process.env.REDIS_URL,
      parseInt(process.env.CONSTELLATION_CACHE_TTL || '60')
    )
  : null;

// server/services/hydration.ts (existing file - add to it)
export async function hydratePost(post: Post): Promise<HydratedPost> {
  // ... existing hydration logic ...

  // Add Constellation stats if enabled
  if (postStatsEnricher) {
    try {
      const stats = await postStatsEnricher.getPostStats(post.uri);
      post.likeCount = stats.likes;
      post.repostCount = stats.reposts;
      post.replyCount = stats.replies;
      post.quoteCount = stats.quotes;
    } catch (error) {
      console.error('[CONSTELLATION] Failed to enrich post stats:', error);
      // Fall back to local counts
    }
  }

  return post;
}
```

## Environment Variables

```bash
# .env additions for Constellation
CONSTELLATION_ENABLED=true
CONSTELLATION_URL=https://constellation.microcosm.blue
CONSTELLATION_CACHE_TTL=60

# For self-hosted instance
# CONSTELLATION_URL=http://constellation:8080
```

## docker-compose.yml Integration

```yaml
  # Add to profiles section
  constellation-bridge:
    build: ./microcosm-bridge/constellation-client
    depends_on:
      - redis
      - postgres
    environment:
      - CONSTELLATION_URL=${CONSTELLATION_URL:-https://constellation.microcosm.blue}
      - REDIS_URL=${REDIS_URL}
      - DATABASE_URL=${DATABASE_URL}
      - CACHE_TTL=${CONSTELLATION_CACHE_TTL:-60}
    profiles:
      - microcosm
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3003/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Optional: Self-hosted Constellation
  constellation:
    image: ghcr.io/at-microcosm/constellation:latest  # when available
    # OR build from source:
    # build: ./microcosm-rs/constellation
    volumes:
      - constellation-data:/data
    environment:
      - JETSTREAM=us-east-1
    profiles:
      - microcosm-selfhosted
    restart: unless-stopped
    
volumes:
  constellation-data:
```

## Comparison with Osprey Bridge

| Feature | Osprey Bridge | Constellation Bridge |
|---------|---------------|---------------------|
| **Purpose** | Moderation labels | Interaction statistics |
| **Data Flow** | Firehose → Kafka → Osprey → Kafka → DB | API polling → Cache → AppView |
| **Complexity** | High (multiple services, Kafka) | Low (simple HTTP client) |
| **Latency** | Real-time | Near real-time (cache TTL) |
| **Resource Use** | High (Kafka, multiple containers) | Low (single service) |
| **External Dependency** | Osprey service | Constellation API |
| **Implementation Time** | ~2 weeks | ~2-3 days |

## Benefits of Integration

### For Your AppView:

1. **Accurate Counts**: Constellation provides definitive interaction counts across the network
2. **Reduced Compute**: Offload expensive counting operations
3. **Cross-App Support**: See interactions from all atproto apps, not just Bluesky
4. **Lower Latency**: Constellation is optimized for fast backlink queries
5. **Scalability**: No need to maintain your own indexing infrastructure
6. **Innovation**: Access to analytics and features not possible with local data alone

### For the Ecosystem:

1. **Microservices Architecture**: Best-in-class services working together
2. **Reduced Redundancy**: Don't rebuild what already exists
3. **Community Resources**: Leverage public infrastructure or self-host
4. **Rust Performance**: Benefit from high-performance Rust services

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Public API downtime | Redis caching, graceful fallback to local counts |
| API rate limiting | Self-host for production, respect public instance limits |
| API changes | Version pinning, adapter pattern for easy updates |
| Network latency | Aggressive caching, async enrichment, pre-warming |
| Data consistency | Cache invalidation strategy, periodic refresh |

## Next Steps

1. **Review this analysis** with your team
2. **Try public APIs** manually to understand data format:
   ```bash
   # Get likes for a post
   curl 'https://constellation.microcosm.blue/links/count?target=at%3A%2F%2Fdid%3Aplc%3A...'
   
   # Get all backlinks to a DID
   curl 'https://constellation.microcosm.blue/links/all/count?target=did:plc:...'
   ```
3. **Implement Phase 1** (Constellation integration) as a proof of concept
4. **Evaluate results** and decide on Phase 2+
5. **Consider self-hosting** for production deployment

## Questions for Consideration

1. Do you want **accurate global counts** or are local counts sufficient?
2. Is **cross-app interaction visibility** valuable for your use case?
3. Would you prefer to **use public APIs** (quick start) or **self-host** (control)?
4. What's your **cache tolerance** for interaction counts (1 min? 5 min? real-time)?
5. Are you interested in **analytics features** (UFOs) for admin dashboards?

## Conclusion

**Yes, microcosm-rs can be integrated** following the same adapter/bridge pattern as Osprey. The integration is actually **simpler than Osprey** for the API-based services (Constellation, UFOs) since they just require HTTP clients rather than complex Kafka pipelines.

**Recommended approach**: Start with Constellation API integration for enhanced post/profile stats. It's low-effort, high-value, and gives you experience with the microcosm ecosystem before committing to more complex integrations or self-hosting.

The architecture patterns you've already established with Osprey bridge (Docker Compose profiles, health monitoring, Redis caching, TypeScript services) map perfectly to microcosm integration.
