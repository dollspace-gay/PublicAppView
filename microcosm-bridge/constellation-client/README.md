# Constellation Client

TypeScript/Node.js client for interacting with Constellation's global AT Protocol backlink index.

## Overview

This client provides a clean interface for querying interaction statistics from Constellation, including:

- Like counts for posts
- Repost counts  
- Reply counts
- Quote post counts
- Follower counts for accounts
- Mention counts
- Custom backlink queries

## Features

- ✅ **Type-safe API** - Full TypeScript types
- ✅ **Rate limiting** - Configurable requests per second
- ✅ **Timeout handling** - Automatic request timeouts
- ✅ **Caching** - Redis-based caching with configurable TTL
- ✅ **Health monitoring** - Express-based health check endpoints
- ✅ **Batch operations** - Efficient multi-post enrichment
- ✅ **Error handling** - Graceful degradation on failures

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and customize:

```bash
# Constellation API
CONSTELLATION_URL=https://constellation.microcosm.blue
CONSTELLATION_TIMEOUT=5000

# Redis (for caching)
REDIS_URL=redis://redis:6379

# Cache settings
CACHE_ENABLED=true
CACHE_TTL=60

# Health check
HEALTH_PORT=3003

# Rate limiting
MAX_REQUESTS_PER_SECOND=10

# User agent (customize with your info)
USER_AGENT=AppView-Constellation-Bridge/1.0 (@your-handle.bsky.social)
```

## Usage

### As a Library

```typescript
import { ConstellationAPIClient } from './api-client';
import { StatsEnricher } from './enricher';

// Create API client
const client = new ConstellationAPIClient({
  baseUrl: 'https://constellation.microcosm.blue',
  timeout: 5000,
  maxRequestsPerSecond: 10
});

// Get like count for a post
const likes = await client.getPostLikes('at://did:plc:abc.../app.bsky.feed.post/123');
console.log(`Likes: ${likes}`);

// Get comprehensive post stats
const enricher = new StatsEnricher(client, {
  cacheEnabled: true,
  cacheTTL: 60,
  redisUrl: 'redis://localhost:6379'
});

const stats = await enricher.getPostStats('at://did:plc:abc.../app.bsky.feed.post/123');
console.log(stats);
// { likes: 42, reposts: 12, replies: 8, quotes: 3 }
```

### As a Service

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

The service will start a health check server on port 3003 (configurable).

## API Reference

### ConstellationAPIClient

#### Constructor

```typescript
new ConstellationAPIClient(config: ConstellationConfig)
```

**Config Options:**
- `baseUrl` - Constellation API URL
- `timeout` - Request timeout in milliseconds (default: 5000)
- `userAgent` - User agent string
- `maxRequestsPerSecond` - Rate limit (default: 10)

#### Methods

**Generic Queries:**

```typescript
// Get count of specific backlinks
getLinksCount(target: string, collection: string, path: string): Promise<number>

// Get all backlinks to a target
getAllLinksCount(target: string): Promise<LinksCounts>
```

**Convenience Methods:**

```typescript
// Post interactions
getPostLikes(postUri: string): Promise<number>
getPostReposts(postUri: string): Promise<number>
getPostReplies(postUri: string): Promise<number>
getPostQuotes(postUri: string): Promise<number>

// Account interactions
getFollowers(did: string): Promise<number>
getMentions(did: string): Promise<number>

// Health check
healthCheck(): Promise<boolean>
```

### StatsEnricher

#### Constructor

```typescript
new StatsEnricher(client: ConstellationAPIClient, config: EnricherConfig)
```

**Config Options:**
- `cacheEnabled` - Enable Redis caching
- `cacheTTL` - Cache TTL in seconds
- `redisUrl` - Redis connection string

#### Methods

```typescript
// Get comprehensive post stats
getPostStats(postUri: string): Promise<PostStats>

// Get profile stats
getProfileStats(did: string): Promise<ProfileStats>

// Batch enrich multiple posts
enrichPosts(postUris: string[]): Promise<Map<string, PostStats>>

// Invalidate cache
invalidateCache(uri: string): Promise<void>

// Get cache statistics
getCacheStats(): CacheStats

// Close connections
close(): Promise<void>
```

**Return Types:**

```typescript
interface PostStats {
  likes: number;
  reposts: number;
  replies: number;
  quotes: number;
}

interface ProfileStats {
  followers: number;
  mentions: number;
  blocks: number;
  lists: number;
}
```

## Health Endpoints

When running as a service, the following endpoints are available:

### GET /health

Full health status with detailed information:

```bash
curl http://localhost:3003/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2025-10-12T10:30:00.000Z",
  "uptime": 3600,
  "constellation": {
    "connected": true,
    "url": "https://constellation.microcosm.blue"
  },
  "cache": {
    "enabled": true,
    "ttl": 60,
    "statsRequested": 1000,
    "cacheHits": 875,
    "cacheMisses": 125,
    "hitRate": "87.50%"
  },
  "version": "1.0.0"
}
```

### GET /ready

Readiness probe (for Kubernetes):

```bash
curl http://localhost:3003/ready
```

Returns `200` if ready, `503` if not.

### GET /live

Liveness probe:

```bash
curl http://localhost:3003/live
```

Always returns `200` if server is responding.

### GET /stats

Cache and performance statistics:

```bash
curl http://localhost:3003/stats
```

Response:
```json
{
  "uptime": 3600,
  "cache": {
    "enabled": true,
    "statsRequested": 1000,
    "cacheHits": 875,
    "cacheMisses": 125,
    "hitRate": "87.50%"
  },
  "timestamp": "2025-10-12T10:30:00.000Z"
}
```

## Docker

### Build

```bash
docker build -t constellation-client .
```

### Run

```bash
docker run -d \
  -p 3003:3003 \
  -e CONSTELLATION_URL=https://constellation.microcosm.blue \
  -e REDIS_URL=redis://redis:6379 \
  -e CACHE_TTL=60 \
  constellation-client
```

### Health Check

The Docker image includes automatic health checks:

```bash
docker ps  # Check HEALTH column
```

## Development

### Project Structure

```
constellation-client/
├── src/
│   ├── api-client.ts    # HTTP client for Constellation API
│   ├── enricher.ts      # Stats enrichment with caching
│   ├── health.ts        # Health check server
│   └── index.ts         # Main service entry point
├── Dockerfile
├── package.json
├── tsconfig.json
└── .env.example
```

### Building

```bash
npm run build
```

Outputs compiled JavaScript to `dist/`.

### Running Tests

```bash
# Test API connectivity
npm run dev

# In another terminal, test endpoints
curl http://localhost:3003/health
curl http://localhost:3003/stats
```

### Linting

```bash
npm run check
```

## Performance

### Latency

- **Cache hit**: <1ms (Redis lookup)
- **Cache miss**: 50-200ms (API call)
- **Batch queries**: 200-500ms (parallel requests)

### Throughput

- **With rate limiting**: 10 req/s to API (configurable)
- **With caching**: Effectively unlimited (cache hits)
- **Typical cache hit rate**: 85-95%

### Resource Usage

- **CPU**: <5% (single core)
- **Memory**: ~50MB
- **Network**: ~1KB per API request

## Error Handling

The client includes comprehensive error handling:

1. **Timeout handling** - Requests timeout after configured duration
2. **Rate limiting** - Automatic rate limiting to respect API limits
3. **Graceful degradation** - Returns null/empty on errors rather than failing
4. **Retry logic** - Automatic Redis reconnection with exponential backoff
5. **Cache fallthrough** - Falls back to API on cache errors

## Monitoring

### Metrics

Track these metrics for production monitoring:

```typescript
const stats = enricher.getCacheStats();

console.log(stats);
// {
//   enabled: true,
//   ttl: 60,
//   statsRequested: 1000,
//   cacheHits: 875,
//   cacheMisses: 125,
//   hitRate: "87.50%"
// }
```

### Logs

The service logs to stdout with the `[CONSTELLATION]` prefix:

```
[CONSTELLATION] Integration enabled (URL: https://constellation.microcosm.blue)
[CONSTELLATION] Redis connected
[CONSTELLATION] Error fetching count: timeout
```

Use these logs for debugging and monitoring.

## Troubleshooting

### Connection Errors

**Symptom**: `Error: Constellation API timeout`

**Solution**:
1. Check Constellation API is accessible: `curl https://constellation.microcosm.blue`
2. Increase timeout: `CONSTELLATION_TIMEOUT=10000`
3. Check network connectivity

### Cache Not Working

**Symptom**: Low cache hit rate

**Solution**:
1. Verify Redis is running: `redis-cli ping`
2. Check Redis URL is correct
3. Increase cache TTL for stale-ok scenarios

### Rate Limiting

**Symptom**: Slow responses, many API calls

**Solution**:
1. Enable caching: `CACHE_ENABLED=true`
2. Increase cache TTL: `CACHE_TTL=120`
3. Reduce rate limit if hitting API limits: `MAX_REQUESTS_PER_SECOND=5`

## License

This code is part of the AppView project and follows its license.

## Resources

- **Constellation Docs**: https://constellation.microcosm.blue/
- **Microcosm Discord**: https://discord.gg/tcDfe4PGVB
- **Source**: https://tangled.org/@microcosm.blue/microcosm-rs
