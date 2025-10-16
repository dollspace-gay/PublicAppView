# Aurora Prism 🌈✨

**A cyberpunk-themed, self-hostable AT Protocol AppView with aurora-inspired aesthetics**

Aurora Prism is a production-ready AT Protocol "App View" service that indexes real-time data from the Bluesky network and provides a fully Bluesky-compatible XRPC API with a stunning cyberpunk dashboard.

## ✨ Features

### 🎨 Aurora Stack Theme
- **Cyberpunk Aesthetics**: Deep space blue (#0D1117) with vibrant neon accents
- **Aurora Glow Effects**: Glowing buttons, cards, and interactive elements
- **Prism Gradients**: Teal → Green → Purple color palette throughout
- **Live Animations**: Pulsing indicators, shimmer effects, and aurora waves

### 🚀 Core Infrastructure
- **Real-time Firehose**: Connects to AT Protocol relay (wss://bsky.network)
- **PostgreSQL Database**: 28+ optimized tables for posts, likes, follows, and more
- **Smart Data Protection**: User-backfilled data is never pruned
- **Full XRPC API**: 52 Bluesky-compatible endpoints

### 🔐 Advanced Features
- **OAuth 2.0 Authentication**: Secure login with DID verification
- **Full-Text Search**: PostgreSQL-powered with GIN indexes
- **Feed Algorithms**: Reverse-chronological, engagement, and discovery ranking
- **Content Filtering**: Keyword filtering and user muting
- **Write Proxy**: All write operations proxied to user's PDS

### 📊 Monitoring Dashboard
- **Real-time Metrics**: Events/min, DB stats, API performance
- **System Health**: CPU, memory, disk, network status
- **Dynamic Schema**: Auto-introspecting database viewer
- **API Documentation**: Live endpoint listing with metrics
- **Logs & Analytics**: Real-time log viewer with filtering

## 🎯 Design Philosophy: Your Data, Your Control

**True decentralization means you control what you keep.**

Aurora Prism protects user-backfilled data while pruning random firehose noise:

- ✅ **Protected Forever**: Your posts, likes, follows, and everyone you follow
- ✅ **Smart Backfill**: Thread context, quote posts, notifications
- ✅ **Configurable Retention**: Only prune content from users who never logged in
- ✅ **Privacy by Design**: You can't be forced to hand over data you never stored

## 🚀 Quick Start

### Docker Installation (Recommended)

**Prerequisites:**
- Docker and Docker Compose installed
- A domain (optional, for `did:web` identifier)

**Installation Steps:**

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/aurora-prism.git
cd aurora-prism

# 2. Generate OAuth keys
./oauth-keyset-json.sh

# 3. Setup DID and keys
./setup-did-and-keys.sh

# 4. Start all services
sudo docker-compose up --build -d
```

That's it! 🎉 Aurora Prism will be running at `http://localhost:5000`

### What Gets Setup

The Docker Compose setup includes:
- **PostgreSQL 14**: Database with production tuning (5000 max connections)
- **Redis 7**: Caching and metrics (8GB memory, LRU eviction)
- **Aurora Prism**: The AppView with dashboard and API
- **Automatic Migrations**: Database schema created on startup
- **Health Checks**: All services monitored

### First Login

1. Navigate to `http://localhost:5000`
2. Click "Login" in the sidebar
3. Enter your Bluesky handle and app password
4. Start exploring your personalized Aurora Prism! ✨

## 📦 Manual Installation

If you prefer not to use Docker:

```bash
# Prerequisites: PostgreSQL, Redis, Node.js 20+

# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL, REDIS_URL, SESSION_SECRET

# 3. Initialize database
npm run db:push

# 4. Start server
npm run dev
```

## 🔧 Configuration

### Environment Variables

**Required:**
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `SESSION_SECRET`: Generate with `openssl rand -base64 32`

**Optional:**
- `RELAY_URL`: AT Protocol relay (default: `wss://bsky.network`)
- `APPVIEW_DID`: Your AppView's DID (default: `did:web:localhost`)
- `APPVIEW_HOSTNAME`: Your domain name
- `PORT`: Server port (default: `5000`)
- `DATA_RETENTION_DAYS`: Prune old unprotected data (0=keep forever, >0=prune after X days)
- `BACKFILL_DAYS`: Historical backfill on startup (0=disabled, >0=X days back)

### Data Protection

Aurora Prism automatically protects:
- ✅ All users who have ever logged in
- ✅ All users they follow
- ✅ All content from protected users (posts, likes, reposts)
- ✅ All notifications for protected users

Only content from users who **never** logged in and are **not** followed gets pruned.

## 🐳 Docker Commands

### Service Management

```bash
# View status
sudo docker-compose ps

# View logs
sudo docker-compose logs -f

# Restart services
sudo docker-compose restart

# Stop services
sudo docker-compose stop

# Stop and remove (keeps data)
sudo docker-compose down

# Stop and remove everything (WARNING: deletes data!)
sudo docker-compose down -v
```

### Container Access

```bash
# Open shell in Aurora Prism container
sudo docker-compose exec app sh

# Run database migrations
sudo docker-compose exec app npm run db:push

# View specific service logs
sudo docker-compose logs -f app
sudo docker-compose logs -f db
sudo docker-compose logs -f redis
```

### Health Checks

```bash
# Check service health
curl http://localhost:5000/health

# Check readiness (firehose, DB, memory)
curl http://localhost:5000/ready

# View AT Protocol metadata
curl http://localhost:5000/xrpc/com.atproto.server.describeServer
```

## 🎨 Aurora Prism Theme

The Aurora Stack theme includes custom CSS classes for cyberpunk effects:

- `.btn-aurora-primary` - Teal glowing button
- `.btn-aurora-secondary` - Green glowing button
- `.btn-aurora-accent` - Purple glowing button
- `.card-aurora` - Card with hover glow
- `.stat-aurora` - Glowing number display
- `.heading-aurora` - Gradient text (teal → green → purple)
- `.pulse-aurora` - Pulsing live indicator
- `.shimmer-aurora` - Loading shimmer effect

## 📊 Dashboard Features

Access the Aurora Prism dashboard at `http://localhost:5000`:

- **Overview**: Real-time metrics with aurora-styled charts
- **Firehose Monitor**: Watch events stream in with sparkle effects
- **Database Schema**: Dynamic table viewer with glowing borders
- **API Endpoints**: 52 XRPC endpoints with performance metrics
- **Lexicon Validator**: AT Protocol schema validation
- **Logs & Analytics**: Real-time log viewer with filtering
- **Instance Policy**: Configure moderation and labels
- **User Panel**: Backfill data, manage sessions, delete data

## 🔐 Authentication

Aurora Prism uses AT Protocol OAuth 2.0:

1. User logs in with Bluesky credentials
2. Aurora Prism verifies DID and PDS endpoint
3. Session created with AES-256-GCM encrypted tokens
4. Automatic token refresh on expiry
5. All write operations proxied to user's PDS

## 🏗️ Architecture

### Event Processing Pipeline
1. **Firehose Client** → Connect to AT Protocol relay
2. **Event Processor** → Parse CBOR and validate schemas
3. **Storage Layer** → Persist to PostgreSQL
4. **XRPC API** → Serve Bluesky-compatible endpoints
5. **Cursor Service** → Track position for restart recovery

### Database Schema
- 28+ tables with optimized indexes
- Full-text search (GIN indexes)
- Automatic backfill tracking
- Protected user data marking

## 🚀 Production Deployment

### Recommended Resources
- **Memory**: 2+ GB
- **CPU**: 2+ cores
- **Disk**: 100+ GB (grows with firehose data)

### Health Monitoring
- **Liveness**: `GET /health` (interval: 10s)
- **Readiness**: `GET /ready` (interval: 5s)
- **Metrics**: Real-time dashboard at `/`

### Security Recommendations
- Use HTTPS in production (reverse proxy with nginx/Cloudflare)
- Set strong `SESSION_SECRET` (32+ random bytes)
- Configure `APPVIEW_DID` with your domain
- Enable `DATA_RETENTION_DAYS` to minimize data liability
- Regular backups of PostgreSQL database

## 📚 Documentation

- **Setup Scripts**: [./scripts/README.md](./scripts/README.md)
- **Backfill Guide**: [./QUICKSTART-BACKFILL.md](./QUICKSTART-BACKFILL.md)
- **Environment Config**: [./.env.example](./.env.example)

## 🤝 Contributing

Contributions welcome! Please open issues or pull requests.

## 📄 License

MIT License - See [LICENSE](./LICENSE) for details

---

<div align="center">

**Aurora Prism** - *Where the firehose meets the aurora borealis* 🌈✨

Built with ❤️ for the decentralized web

</div>
