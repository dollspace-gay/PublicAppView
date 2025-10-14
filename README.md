# AT Protocol App View

A production-ready, self-hostable AT Protocol "App View" service that indexes real-time data from the Bluesky network firehose and provides a fully Bluesky-compatible XRPC API.

## Features

### Core Infrastructure
- **Real-time Firehose Ingestion**: Connects to AT Protocol relay (wss://bsky.network) and processes CBOR-encoded events (#commit, #identity, #account)
- **Cursor Persistence**: Automatic position tracking with database persistence enables restart recovery with minimal data loss (max 5 seconds)
- **PostgreSQL Database**: Optimized schema with 28+ tables including users, posts, likes, reposts, follows, blocks, mutes, feed generators, and more
- **Lexicon Validation**: Zod-based validation for all 8 AT Protocol record types (post, like, repost, generator, profile, follow, block, starterpack)

### Complete XRPC API (52 Endpoints)
- **Feed APIs** (16/16): Timeline, author feeds, post threads, likes, quotes, search, feed generators
- **Actor/Profile APIs** (7/7): Profiles, suggestions, search, preferences
- **Graph APIs** (18/18): Follows, followers, blocks, mutes, lists, relationships, starter packs
- **Notification APIs** (5/5): List notifications, unread count, push subscriptions
- **Video APIs** (2/2): Job status, upload limits
- **Moderation APIs** (2/2): Labels, reports
- **Labeler APIs** (1/1): Labeler services

### Advanced Features
- **Full-Text Search**: PostgreSQL-powered search with GIN indexes, automatic tsvector updates, Unicode support
- **Feed Algorithm System**: Reverse-chronological, engagement, and discovery ranking with user preferences
- **Feed Generator Integration**: AT Protocol-compliant integration with DID resolution, JWT authentication, skeleton fetching
- **Content Filtering**: Keyword-based filtering and user muting applied to all feed endpoints
- **OAuth 2.0 Authentication**: AT Protocol-compliant with DID verification, token encryption (AES-256-GCM), automatic refresh
- **PDS Write Proxy**: All write operations proxied to user's PDS with rollback mechanisms
- **🌟 Constellation Integration**: Self-hosted or remote backlink index for accurate network-wide interaction statistics (Phase 2)

### Monitoring Dashboard
- **Real-time Metrics**: Events processed, DB records, API requests per minute
- **Dynamic Database Schema**: Auto-introspects all 28+ tables with columns, types, indexes, and row counts
- **Dynamic Lexicon Validator**: Displays all 8 supported AT Protocol lexicons
- **System Health**: CPU, memory, disk usage, network status
- **Firehose Status**: Connection state, cursor position, event counts
- **API Documentation**: Live endpoint listing with performance metrics
- **Logs & Analytics**: Real-time log viewer with filtering

## Design Philosophy: Scale Down, Not Just Up

**True decentralization means scaling to fit your needs - whether that's a personal instance or a full network mirror.**

Most current AppViews default to mirroring everything, but this creates centralized liability risks. This AppView takes a different approach with **configurable retention and backfill**:

### Why Configurable Retention Matters

- **Personal Instances**: Run an instance with just your circles' data (days or weeks, not years)
- **Topical Communities**: A gaming community keeps 90 days of game-related posts, a news instance keeps 30
- **Privacy by Design**: Data minimization isn't just good practice - you can't be compelled to hand over data you never stored
- **Technical Defense**: Against authoritarian data seizure or legal overreach, the best defense is not having the data

### Flexible Deployment Models

Configure `BACKFILL_DAYS` and `DATA_RETENTION_DAYS` to match your use case:

- **Zero-retention ephemeral** (0 days): Real-time only, no history
- **Personal/community** (7-30 days): Recent activity for small groups  
- **Topical archive** (90-180 days): Focused collections
- **Full mirror** (0 = unlimited): Complete network history

This isn't about choosing between centralized or decentralized - it's about **enabling distributed operation at any scale**. Run what you need, store what you want, minimize what you don't.

## Quick Start

### Prerequisites
- PostgreSQL database
- Redis (for caching and metrics)
- Node.js 20+
- (Optional) Domain for `did:web` identifier

### Setup

1. **Clone and Install**
```bash
git clone <your-repo> PublicAppView
cd PublicAppView
npm install
```

2. **Configure Environment**
```bash
cp .env.example .env
# Edit .env with your DATABASE_URL and SESSION_SECRET
```

3. **Initialize Database**
```bash
npm run db:push
```

4. **Start the Server**
```bash
npm run dev
```

The server starts on port 5000 with the dashboard at http://localhost:5000

## Constellation Integration 🌌

**NEW in Phase 2:** Self-hosted AT Protocol backlink index for accurate interaction statistics!

### What is Constellation?

Constellation provides **network-wide interaction statistics** (likes, reposts, replies, quotes, followers) by indexing the global AT Protocol firehose. Now integrated directly into docker-compose!

### Quick Enable

```bash
# Copy environment file
cp .env.example .env

# Start with Constellation
docker-compose --profile constellation up -d
```

**That's it!** You now have:
- ✅ Local Constellation instance (self-hosted backlink index)
- ✅ Automatic AppView integration
- ✅ 10x faster than remote API (<10ms vs 50-200ms)
- ✅ No rate limits (vs 10 req/s remote)
- ✅ ~2GB/day storage for full network indexing

### Configuration Options

**Local Instance (Default):**
```bash
CONSTELLATION_ENABLED=true
CONSTELLATION_URL=http://constellation-local:8080
CONSTELLATION_LOCAL=true
```

**Remote API (No local instance needed):**
```bash
CONSTELLATION_ENABLED=true
CONSTELLATION_URL=https://constellation.microcosm.blue
CONSTELLATION_LOCAL=false
```

### Documentation

- 📖 **Quick Start**: [CONSTELLATION-QUICKSTART.md](CONSTELLATION-QUICKSTART.md)
- 🚀 **Full Phase 2 Guide**: [CONSTELLATION-PHASE2-QUICKSTART.md](CONSTELLATION-PHASE2-QUICKSTART.md)
- 📚 **Complete Docs**: [microcosm-bridge/constellation/README.md](microcosm-bridge/constellation/README.md)

### Benefits

| Feature | Local | Remote |
|---------|-------|--------|
| Setup | One command | Zero setup |
| Latency | <10ms | 50-200ms |
| Rate Limits | None | 10 req/s |
| Cost | Infrastructure only | Free |
| Storage | ~2GB/day | None |
| Privacy | Full control | Shared service |

## Docker Installation

### Building the Docker Image

The Dockerfile is already included in the repository. It uses a multi-stage build with:
- Node.js 20-slim base image
- PM2 cluster mode for multi-worker deployment
- Automatic database migrations on startup
- Health checks and production optimizations

**Build the Image**
```bash
# Build all services (use --no-cache for clean build)
sudo docker-compose build --no-cache

# Or build without cache flag
sudo docker-compose build
```

### Running with Docker

**Basic Run (requires external PostgreSQL and Redis)**
```bash
docker run -d \
  --name at-protocol-appview \
  -p 5000:5000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/dbname" \
  -e REDIS_URL="redis://host:6379" \
  -e SESSION_SECRET="your-secure-secret" \
  -e NODE_ENV="production" \
  at-protocol-appview
```

**With Docker Compose (Recommended)**

A complete `docker-compose.yml` is included in the repository with:
- **Redis** service (in-memory caching and metrics)
- **PostgreSQL** service (database with production tuning)
- **Python Firehose** services (high-performance event ingestion)
- **App** service (AppView with all dependencies)
- **Constellation** services (optional, via profile)

Start all services:
```bash
# Basic deployment
docker-compose up -d

# OR with Constellation for enhanced statistics (recommended)
docker-compose --profile constellation up -d
```

The docker-compose setup includes:
- PostgreSQL 14 with optimized connection pooling and shared buffers
- Redis 7 with 8GB memory and stream persistence
- Python workers for high-throughput firehose processing
- Optional Constellation local instance (Phase 2)
- Health checks for all services
- Automatic dependency ordering
- Volume persistence for database and Constellation data

### Monitoring Docker Services

**View Service Status**
```bash
# Check all services
docker-compose ps

# View detailed service info
docker-compose logs

# Check resource usage
docker stats
```

**View Logs**
```bash
# Follow all logs in real-time
docker-compose logs -f

# Follow specific service logs
docker-compose logs -f app
docker-compose logs -f db
docker-compose logs -f redis

# View last 100 lines
docker-compose logs --tail 100 app

# Or use container names directly
docker logs -f publicappview-app-1
docker logs --tail 100 publicappview-db-1
```

**Health Checks**
```bash
# Check service health
docker-compose ps

# Manual health check
curl http://localhost:5000/health
curl http://localhost:5000/ready

# View health status
docker inspect --format='{{.State.Health.Status}}' publicappview-app-1
```

**Performance Monitoring**
```bash
# Real-time stats (all services)
docker stats

# Specific containers
docker stats publicappview-app-1 publicappview-db-1 publicappview-redis-1
```

**Service Management**
```bash
# Stop all services
docker-compose stop

# Start all services
docker-compose start

# Restart all services
docker-compose restart

# Restart specific service
docker-compose restart app

# Remove all services
docker-compose down

# Remove with volumes (WARNING: deletes data)
docker-compose down -v
```

**Entering the Container**
```bash
# Open shell in app container
docker-compose exec app sh

# Run commands in container
docker-compose exec app npm run db:push

# Or use container name directly (note: Docker Compose uses directory name as prefix)
docker exec -it publicappview-app-1 sh
```

**Note:** Docker Compose creates container names using the pattern `{directory-name}-{service-name}-{number}`. Since this repo is cloned to `PublicAppView`, the actual container names are:
- `publicappview-app-1` (main AppView service)
- `publicappview-db-1` (PostgreSQL database)
- `publicappview-redis-1` (Redis cache)

## Environment Variables

### Required
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string (default: `redis://localhost:6379`)
- `SESSION_SECRET`: JWT secret (generate with `openssl rand -base64 32`)

### Optional
- `RELAY_URL`: AT Protocol relay URL (default: `wss://bsky.network`)
- `APPVIEW_DID`: DID for this AppView instance (default: `did:web:appview.local`)
- `PORT`: Server port (default: `5000`)
- `NODE_ENV`: Environment mode (`development` or `production`)
- `BACKFILL_DAYS`: Historical backfill in days (0=disabled, -1=all history, >0=backfill X days, default: `0`)
  - **NEW**: Python backfill now runs automatically when enabled! See [QUICKSTART-BACKFILL.md](./QUICKSTART-BACKFILL.md)
  - Advanced configuration: [.env.backfill.example](./.env.backfill.example) and [Python Backfill Docs](./python-firehose/README.backfill.md)
- `DATA_RETENTION_DAYS`: Auto-prune old data (0=keep forever, >0=prune after X days, default: `0`)
- `DB_POOL_SIZE`: Database connection pool size (default: `32`)
- `MAX_CONCURRENT_OPS`: Max concurrent event processing (default: `80`)

## Production Deployment

### Health & Monitoring
- **Health Check**: `GET /health` - Basic liveness probe
- **Readiness Check**: `GET /ready` - Comprehensive readiness probe (firehose, DB, memory)
- **Service Discovery**: `GET /xrpc/com.atproto.server.describeServer` - AT Protocol metadata

### Recommended Configuration
```bash
# Environment
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/dbname
SESSION_SECRET=<secure-random-secret>
APPVIEW_DID=did:web:your-domain.com

# Resources
# - Memory: 2+ GB
# - CPU: 2+ cores
# - Disk: 100+ GB (grows with firehose data)
```

### Container Orchestration
- **Liveness Probe**: `GET /health` (interval: 10s, timeout: 5s)
- **Readiness Probe**: `GET /ready` (interval: 5s, timeout: 3s, failure threshold: 3)
- **Resource Limits**: `memory: 2Gi`, `cpu: 1000m` (adjust based on load)

**Note**: Not horizontally scalable - use single-instance deployment with failover

## Architecture

### Event Processing Pipeline
1. **Firehose Client** connects to AT Protocol relay
2. **Event Processor** parses CBOR events and validates against Lexicon schemas
3. **Storage Layer** persists data to PostgreSQL with optimized indexing
4. **XRPC API** serves data through Bluesky-compatible endpoints
5. **Cursor Service** tracks position for restart recovery

### Database Schema
- 28+ tables with optimized indexing
- Full-text search indexes (GIN) on tsvector columns
- Composite cursor pagination support
- Dynamic schema introspection for dashboard

### Authentication Flow
1. User authenticates with AT Protocol PDS
2. AppView verifies DID and PDS endpoint
3. Session created with encrypted tokens
4. Automatic token refresh on expiry
5. Write operations proxied to user's PDS

## API Documentation

Access the interactive API documentation at `/api` in the dashboard, showing:
- All 52 XRPC endpoints with methods and paths
- Live performance metrics (avg response time, requests/min, success rate)
- Endpoint status (active/available)

## Development

```bash
# Install dependencies
npm install

# Run database migrations
npm run db:push

# Start development server
npm run dev

# Access dashboard
open http://localhost:5000
```

## License

MIT
