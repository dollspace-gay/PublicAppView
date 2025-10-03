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

### Monitoring Dashboard
- **Real-time Metrics**: Events processed, DB records, API requests per minute
- **Dynamic Database Schema**: Auto-introspects all 28+ tables with columns, types, indexes, and row counts
- **Dynamic Lexicon Validator**: Displays all 8 supported AT Protocol lexicons
- **System Health**: CPU, memory, disk usage, network status
- **Firehose Status**: Connection state, cursor position, event counts
- **API Documentation**: Live endpoint listing with performance metrics
- **Logs & Analytics**: Real-time log viewer with filtering

## Quick Start

### Prerequisites
- PostgreSQL database
- Node.js 20+
- (Optional) Domain for `did:web` identifier

### Setup

1. **Clone and Install**
```bash
git clone <your-repo>
cd at-protocol-appview
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

## Docker Installation

### Building the Docker Image

1. **Create a Dockerfile**
```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --production

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client/dist ./client/dist

# Expose port
EXPOSE 5000

# Start the application
CMD ["npm", "start"]
```

2. **Build the Image**
```bash
docker build -t at-protocol-appview .
```

### Running with Docker

**Basic Run**
```bash
docker run -d \
  --name appview \
  -p 5000:5000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/dbname" \
  -e SESSION_SECRET="your-secure-secret" \
  -e NODE_ENV="production" \
  at-protocol-appview
```

**With Docker Compose**

Create `docker-compose.yml`:
```yaml
version: '3.8'

services:
  appview:
    build: .
    ports:
      - "5000:5000"
    environment:
      DATABASE_URL: postgresql://user:pass@postgres:5432/appview
      SESSION_SECRET: ${SESSION_SECRET}
      NODE_ENV: production
      APPVIEW_DID: did:web:your-domain.com
    restart: unless-stopped
    depends_on:
      - postgres
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:5000/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: appview
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  postgres_data:
```

Then run:
```bash
docker-compose up -d
```

### Monitoring Docker Container

**View Container Status**
```bash
# Check if container is running
docker ps | grep appview

# View detailed container info
docker inspect appview

# Check resource usage
docker stats appview
```

**View Logs**
```bash
# Follow logs in real-time
docker logs -f appview

# View last 100 lines
docker logs --tail 100 appview

# View logs with timestamps
docker logs -t appview
```

**Health Checks**
```bash
# Check health status
docker inspect --format='{{.State.Health.Status}}' appview

# Manual health check
curl http://localhost:5000/health
curl http://localhost:5000/ready

# View health check logs
docker inspect --format='{{json .State.Health}}' appview | jq
```

**Performance Monitoring**
```bash
# Real-time stats (CPU, memory, network)
docker stats appview --no-stream

# Export metrics
docker stats appview --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
```

**Container Management**
```bash
# Stop container
docker stop appview

# Start container
docker start appview

# Restart container
docker restart appview

# Remove container
docker rm -f appview
```

**Entering the Container**
```bash
# Open shell in running container
docker exec -it appview sh

# Run commands in container
docker exec appview npm run db:push
```

## Environment Variables

### Required
- `DATABASE_URL`: PostgreSQL connection string
- `SESSION_SECRET`: JWT secret (generate with `openssl rand -base64 32`)

### Optional
- `RELAY_URL`: AT Protocol relay URL (default: `wss://bsky.network`)
- `APPVIEW_DID`: DID for this AppView instance (default: `did:web:appview.local`)
- `PORT`: Server port (default: `5000`)
- `NODE_ENV`: Environment mode (`development` or `production`)
- `ENABLE_BACKFILL`: Enable historical backfill (**NOT recommended**, default: `false`)

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
