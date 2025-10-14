# Microcosm Bridge

This directory contains bridge services that integrate Microcosm's AT Protocol services with the AppView.

## What is Microcosm?

[Microcosm](https://microcosm.blue) is a collection of production-ready Rust services for the AT Protocol ecosystem, providing:

- **Constellation** - Global backlink index for accurate interaction statistics
- **Spacedust** - Real-time interactions firehose
- **UFOs** - Collection analytics and timeseries stats
- **Slingshot** - Fast edge cache for records and identities

## Current Integration: Constellation

### Overview

The Constellation integration provides **accurate, network-wide interaction statistics** for posts and profiles by querying Constellation's global backlink index.

**✨ NEW: Phase 2 Available!** - Self-hosted local Constellation with Docker workers. [Jump to Phase 2 →](#phase-2-local-constellation)

**Benefits:**
- ✅ **Accurate counts** - Definitive interaction counts across the entire network
- ✅ **Cross-app support** - Includes interactions from all AT Protocol apps, not just Bluesky
- ✅ **Reduced compute** - Offloads expensive counting operations to external service
- ✅ **Lower latency** - Constellation is optimized for fast backlink queries
- ✅ **Automatic fallback** - Falls back to local counts if Constellation is unavailable
- 🆕 **Self-hosted option** - Run your own Constellation instance (Phase 2)

### How It Works

```
┌─────────────────┐
│   AppView       │
│   (Feed/Posts)  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Enhanced Hydrator                  │
│  1. Fetch posts from PostgreSQL     │
│  2. Fetch local aggregations        │
│  3. Query Constellation API         │◄──┐
│  4. Override with accurate counts   │   │
└─────────────────────────────────────┘   │
         │                                 │
         │ (if enabled)                    │
         ▼                                 │
┌─────────────────────────────────────┐   │
│  Constellation Integration Service  │   │
│  - Redis cache (60s TTL)            │   │
│  - Parallel API requests            │   │
│  - Graceful error handling          │   │
└─────────────────┬───────────────────┘   │
                  │                        │
                  ▼                        │
         ┌────────────────┐                │
         │ Redis Cache    │                │
         │ (60s TTL)      │                │
         └────────┬───────┘                │
                  │ miss                   │
                  ▼                        │
         ┌────────────────────┐            │
         │ Constellation API  │────────────┘
         │ constellation.     │
         │ microcosm.blue     │
         └────────────────────┘
```

### Architecture

**Three Layers:**

1. **Bridge Service** (`constellation-client/`)
   - Standalone Node.js service
   - Maintains health check endpoint
   - Can be used independently or via integration layer

2. **Integration Layer** (`server/services/constellation-integration.ts`)
   - Lightweight service used by AppView
   - Direct API calls to Constellation
   - Redis caching for performance
   - Graceful fallback to local stats

3. **Hydration Integration** (`server/services/hydration/index.ts`)
   - Enriches post aggregations with Constellation stats
   - Transparent to API consumers
   - Zero breaking changes to existing code

**Why Two Approaches?**

- **Bridge Service**: Full-featured, can run as separate service, includes monitoring
- **Integration Layer**: Lightweight, embedded in AppView, minimal dependencies

For most use cases, the **Integration Layer** (already installed) is sufficient. The Bridge Service is available for advanced deployments.

## Deployment Options

### Phase 1: Remote Constellation (Current)

Use the public Constellation API (already configured):
- ✅ Zero setup required
- ✅ Free to use
- ✅ Best-effort uptime
- ⚠️ Rate limited (10 req/s)
- ⚠️ Higher latency (50-200ms)

**Best for:** Development, testing, low-traffic instances

### Phase 2: Local Constellation (NEW! 🌟)

Run your own self-hosted Constellation instance:
- ✅ **Full control** over data and infrastructure
- ✅ **Zero rate limits** on API calls
- ✅ **10x lower latency** (<10ms vs 50-200ms)
- ✅ **Privacy** - all data stays local
- ✅ **Production-ready** with Docker workers
- ⚠️ Requires ~2GB/day storage
- ⚠️ Initial setup: ~30 minutes

**Best for:** Production deployments, high-traffic instances, privacy-sensitive applications

[**→ Quick Start Guide for Phase 2**](../CONSTELLATION-PHASE2-QUICKSTART.md)

## Usage

### Enable Constellation Integration

The easiest way to enable Constellation integration is via environment variables:

```bash
# Add to .env file
CONSTELLATION_ENABLED=true
CONSTELLATION_URL=https://constellation.microcosm.blue
CONSTELLATION_CACHE_TTL=60
```

Then restart your AppView:

```bash
docker-compose restart app
```

That's it! Your AppView will now use Constellation for accurate interaction counts.

### Using the Bridge Service (Optional)

If you want to run the full Constellation bridge service with dedicated health monitoring:

```bash
# Enable with docker-compose profile
docker-compose --profile constellation up -d

# Or set in .env
echo "CONSTELLATION_ENABLED=true" >> .env
docker-compose --profile constellation up -d
```

### Verify It's Working

Check the AppView logs for Constellation initialization:

```bash
docker-compose logs app | grep CONSTELLATION

# You should see:
# [CONSTELLATION] Integration enabled (URL: https://constellation.microcosm.blue)
```

Check stats via the health endpoint (if using bridge service):

```bash
curl http://localhost:3003/health

# Response:
# {
#   "status": "healthy",
#   "constellation": {
#     "connected": true,
#     "url": "https://constellation.microcosm.blue"
#   },
#   "cache": {
#     "enabled": true,
#     "hitRate": "87.5%"
#   }
# }
```

### Test with a Real Post

Compare local vs Constellation counts:

```bash
# Get a post URI from your instance
POST_URI="at://did:plc:abc123.../app.bsky.feed.post/abc123"

# Query Constellation directly
curl "https://constellation.microcosm.blue/links/count?\
target=$POST_URI&\
collection=app.bsky.feed.like&\
path=.subject.uri"

# Output: 42

# Compare with your AppView's feed - counts should match!
```

## Configuration

### Environment Variables

#### Basic Configuration

```bash
# Enable/disable integration
CONSTELLATION_ENABLED=true

# API endpoint (use public instance or self-hosted)
CONSTELLATION_URL=https://constellation.microcosm.blue

# Cache TTL in seconds (how long to cache results)
CONSTELLATION_CACHE_TTL=60
```

#### Advanced Configuration (Bridge Service)

```bash
# Health check port
HEALTH_PORT=3003

# API timeout in milliseconds
CONSTELLATION_TIMEOUT=5000

# Rate limiting (requests per second to public API)
MAX_REQUESTS_PER_SECOND=10

# User agent (please customize with your info)
USER_AGENT=AppView-Constellation/1.0 (@your-handle.bsky.social)
```

### Docker Compose Profiles

The bridge service uses Docker Compose profiles for optional deployment:

```yaml
profiles:
  - constellation  # Enable with --profile constellation
  - microcosm     # Future: Enable all microcosm integrations
```

## Public API Usage

The default configuration uses Constellation's public instance at `constellation.microcosm.blue`.

**Please be respectful:**
- ✅ The public instance is free to use for development and production
- ✅ Rate limiting is built-in (10 req/s default)
- ✅ Results are cached (60s default) to minimize API calls
- ✅ Custom User-Agent helps the maintainer understand usage

**Public Instance Details:**
- Hosted by [@bad-example.com](https://bsky.app/profile/bad-example.com)
- Best-effort uptime (no SLA)
- May have rate limiting
- APIs may change (with notice)

For production deployments, consider [self-hosting (Phase 2)](#phase-2-local-constellation).

## Phase 2: Local Constellation

### What is Phase 2?

Phase 2 provides **automatic Docker-based deployment** of a local Constellation instance with:

- 🐳 **Docker workers** - Fully containerized setup
- 🔄 **Automatic integration** - Zero configuration needed
- 📦 **One-command deploy** - Interactive setup script
- 🔧 **Auto-configuration** - Client automatically detects local instance
- 🏥 **Health monitoring** - Built-in health checks and diagnostics
- 📊 **Performance tuning** - Optimized for local deployment

### Quick Start

**Single command deployment:**

```bash
./scripts/setup-constellation-local.sh
```

This automated script:
1. ✅ Checks system requirements
2. ✅ Creates data directory
3. ✅ Generates configuration
4. ✅ Builds Docker image
5. ✅ Starts services
6. ✅ Integrates with AppView
7. ✅ Runs health checks

**Estimated time:** 30 minutes (10-15 min build, rest is automated)

### Verify Installation

```bash
# Run comprehensive test suite
./scripts/test-constellation-local.sh

# Check service status
docker-compose ps constellation-local

# View logs
docker-compose logs -f constellation-local

# Test API
curl http://localhost:8080/
```

### Manual Deployment

If you prefer manual control:

```bash
# 1. Create data directory
mkdir -p ./constellation-data

# 2. Configure environment
cp .env.constellation-local.example .env.constellation-local
# Edit .env.constellation-local as needed

# 3. Start services
docker-compose -f docker-compose.yml -f docker-compose.constellation-local.yml up -d

# 4. Update AppView .env
cat >> .env << EOF
CONSTELLATION_URL=http://constellation-local:8080
CONSTELLATION_LOCAL=true
CONSTELLATION_ENABLED=true
EOF

# 5. Restart AppView
docker-compose restart app
```

### Architecture

Phase 2 adds these components:

```
┌─────────────────────────────────────────┐
│   AT Protocol Jetstream (Firehose)      │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│   Constellation Local (Rust Service)    │
│   • RocksDB storage                     │
│   • Real-time indexing                  │
│   • HTTP API (port 8080)                │
│   • ~2GB/day storage                    │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│   Constellation Client (Auto-detect)    │
│   • Detects local vs remote             │
│   • Disables rate limiting for local    │
│   • Optimized caching (30s TTL)         │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│   AppView (Transparent Integration)     │
└─────────────────────────────────────────┘
```

### Configuration Files

| File | Purpose |
|------|---------|
| `docker-compose.constellation-local.yml` | Docker service definitions |
| `.env.constellation-local` | Local instance configuration |
| `constellation-data/` | RocksDB data directory |
| `microcosm-bridge/constellation/Dockerfile` | Constellation build |
| `scripts/setup-constellation-local.sh` | Automated setup |
| `scripts/test-constellation-local.sh` | Test suite |

### Resource Requirements

**Minimum (Development):**
- CPU: 1 core
- RAM: 512MB
- Disk: 50GB (25 days)

**Recommended (Production):**
- CPU: 2+ cores
- RAM: 2GB
- Disk: 200GB+ (SSD recommended)

**High-Traffic:**
- CPU: 4+ cores
- RAM: 4GB
- Disk: 500GB+ (NVMe recommended)

### What's Included

Phase 2 provides:

✅ **Dockerfile** - Multi-stage Rust build
✅ **Docker Compose** - Service orchestration
✅ **Setup Script** - Interactive configuration
✅ **Test Suite** - 9 comprehensive tests
✅ **Auto-detection** - Client automatically uses local instance
✅ **Health Checks** - Built-in monitoring
✅ **Documentation** - Complete guides and troubleshooting

### Documentation

- 📖 **Quick Start**: [`CONSTELLATION-PHASE2-QUICKSTART.md`](../CONSTELLATION-PHASE2-QUICKSTART.md)
- 📚 **Full Guide**: [`constellation/README.md`](constellation/README.md)
- 🧪 **Testing**: Run `./scripts/test-constellation-local.sh`
- 🛠️ **Setup**: Run `./scripts/setup-constellation-local.sh`

## Monitoring

### Health Checks

**Integration Layer:**
Check AppView logs for Constellation stats:

```bash
docker-compose logs app | grep CONSTELLATION
```

**Bridge Service:**
Dedicated health endpoints:

```bash
# Full health check
curl http://localhost:3003/health

# Readiness probe (for k8s)
curl http://localhost:3003/ready

# Liveness probe
curl http://localhost:3003/live

# Cache statistics
curl http://localhost:3003/stats
```

### Metrics

The integration tracks:
- `statsRequested` - Total requests for stats
- `cacheHits` - Number of cache hits
- `cacheMisses` - Number of cache misses
- `apiErrors` - Number of API errors
- `hitRate` - Cache hit percentage

View metrics via the stats endpoint:

```bash
curl http://localhost:3003/stats

# Response:
# {
#   "uptime": 3600,
#   "cache": {
#     "enabled": true,
#     "statsRequested": 1000,
#     "cacheHits": 875,
#     "cacheMisses": 125,
#     "hitRate": "87.50%"
#   }
# }
```

## Performance

### Latency

With caching enabled (default):
- **Cache hit**: <1ms (Redis lookup)
- **Cache miss**: 50-200ms (Constellation API call)
- **First request**: 200-500ms (parallel API calls for likes/reposts/replies/quotes)

### Throughput

- **Public API**: ~10 requests/second (rate limited)
- **Self-hosted**: Limited only by your infrastructure
- **Cache effectiveness**: Typically 85-95% hit rate in production

### Resource Usage

**Integration Layer:**
- CPU: Negligible (async I/O)
- Memory: ~10MB
- Network: ~1KB per API request

**Bridge Service:**
- CPU: <5% (single core)
- Memory: ~50MB
- Network: ~1KB per API request

## Troubleshooting

### Integration Not Working

Check if enabled:
```bash
docker-compose logs app | grep "CONSTELLATION.*enabled"
```

If not enabled, add to `.env`:
```bash
CONSTELLATION_ENABLED=true
```

### API Errors

Check Constellation API health:
```bash
curl -I https://constellation.microcosm.blue/
```

Check AppView logs:
```bash
docker-compose logs app | grep "CONSTELLATION.*error"
```

### Cache Not Working

Verify Redis connection:
```bash
docker-compose exec redis redis-cli ping
# Should return: PONG
```

Check cache keys:
```bash
docker-compose exec redis redis-cli keys "constellation:*"
```

### Slow Performance

1. **Check cache hit rate** (should be >80%):
   ```bash
   curl http://localhost:3003/stats
   ```

2. **Increase cache TTL** (if stale data is acceptable):
   ```bash
   CONSTELLATION_CACHE_TTL=120  # 2 minutes
   ```

3. **Self-host Constellation** for lower latency

### Counts Don't Match Local DB

This is expected! Constellation provides **network-wide** counts:

- ✅ **More accurate** - Includes all interactions across the network
- ✅ **Cross-app** - Includes interactions from other AT Protocol apps
- ✅ **Real-time** - Updated immediately from the firehose

Your local DB only knows about interactions it has seen.

## Development

### Local Development

```bash
cd microcosm-bridge/constellation-client

# Install dependencies
npm install

# Copy env config
cp .env.example .env

# Run in development mode
npm run dev
```

### Testing

Test API client:
```bash
node -e "
const { ConstellationAPIClient } = require('./dist/api-client.js');
const client = new ConstellationAPIClient({
  baseUrl: 'https://constellation.microcosm.blue'
});

client.getPostLikes('at://did:plc:abc.../app.bsky.feed.post/123')
  .then(count => console.log('Likes:', count));
"
```

### Building

```bash
npm run build
```

## Future Integrations

This bridge structure is designed to support additional Microcosm services:

### Coming Soon

**Spacedust Integration** - Real-time interactions firehose
- Universal notifications (any mention/reference)
- Link extraction across all apps
- Lower bandwidth than full firehose

**UFOs Integration** - Collection analytics
- Network-wide trends
- Collection discovery
- Unique user counts

**Slingshot Integration** - Record edge cache
- Fast record retrieval
- Identity caching
- Reduced PDS load

## Architecture Comparison

### Constellation vs Osprey Bridge

| Aspect | Osprey Bridge | Constellation Bridge |
|--------|---------------|---------------------|
| Purpose | Moderation labels | Interaction statistics |
| Data Source | Kafka pipeline | HTTP API |
| Complexity | High (multi-service) | Low (single service) |
| Latency | Real-time | Near real-time (60s cache) |
| Resource Use | High (Kafka cluster) | Low (Redis only) |
| Setup Time | ~2 weeks | ~1 hour |

### Design Philosophy

**Lightweight Integration**: Unlike Osprey's complex Kafka pipeline, the Constellation integration is intentionally simple:

1. **No Kafka Required** - Direct HTTP API calls
2. **Minimal Dependencies** - Just Redis for caching
3. **Graceful Degradation** - Falls back to local stats on error
4. **Zero Breaking Changes** - Transparent to API consumers

This makes it easy to adopt incrementally without infrastructure changes.

## Contributing

### Adding New Microcosm Services

Follow this structure:

```
microcosm-bridge/
├── constellation-client/  (✅ Complete)
├── spacedust-client/      (🚧 Coming soon)
├── ufos-client/           (📋 Planned)
└── README.md
```

Each client follows the same pattern:
1. TypeScript service with health monitoring
2. Redis caching layer
3. Docker Compose integration
4. Optional self-hosted deployment

### Testing Changes

```bash
# Run with test profile
docker-compose --profile constellation build
docker-compose --profile constellation up -d

# Check logs
docker-compose logs -f constellation-bridge

# Run health checks
curl http://localhost:3003/health
```

## Resources

- **Constellation Public API**: https://constellation.microcosm.blue/
- **Microcosm Discord**: https://discord.gg/tcDfe4PGVB
- **Source Repository**: https://tangled.org/@microcosm.blue/microcosm-rs
- **Maintainer**: [@bad-example.com](https://bsky.app/profile/bad-example.com)

## License

This bridge code is part of your AppView and follows your project's license.

The Microcosm services it integrates with are available under AGPL (Constellation) or MIT/Apache2.0 (future).

## Support

- **AppView Integration**: Open an issue in your repository
- **Constellation API**: [Microcosm Discord](https://discord.gg/tcDfe4PGVB)
- **Public Instance**: Tag [@bad-example.com](https://bsky.app/profile/bad-example.com) on Bluesky
