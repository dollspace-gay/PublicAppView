# Aurora Prism Roadmap 🗺️

## Current Version: v1.0 (Hybrid Mode)

Aurora Prism currently operates in **Hybrid Mode**: firehose for followed users + on-demand fetching for everything else.

---

## 🚀 Upcoming Features

### 🏠 Personal AppView Mode (v2.0)
**Status:** Planned
**Priority:** High

A lightweight, firehose-less mode for self-hosting and privacy-focused users.

#### What is Personal Mode?
A configuration option that transforms Aurora Prism into a minimal, single-user AppView that fetches content on-demand instead of indexing the entire network.

#### Key Features
- **Firehose-less operation** - Disable network indexing entirely
- **On-demand fetching** - Fetch posts/profiles only when viewed
- **Aggressive caching** - Cache everything you view for fast subsequent loads
- **Minimal storage** - Only store content you actually interact with
- **Low bandwidth** - No need to consume the entire firehose
- **Privacy-first** - Only index what you personally view

#### Use Cases
- 🏡 **Self-hosting** - Run on Raspberry Pi, home server, or VPS
- 🔒 **Privacy mode** - Don't store network-wide data you'll never use
- 💰 **Cost savings** - Drastically lower storage and bandwidth costs
- 👥 **Small communities** - Perfect for 1-100 users who follow similar people
- 🧪 **Development** - Test without needing full firehose infrastructure
- ✈️ **Offline-first** - Build personal cache for offline reading

#### Technical Implementation

**Configuration:**
```env
# Enable personal mode
APPVIEW_MODE=personal          # Options: "network" (default), "personal"
ENABLE_FIREHOSE=false          # Disable firehose consumer
CACHE_ONLY_FOLLOWED=true       # Only cache followed users
MAX_CACHED_USERS=500           # Limit cached users (optional)
PERSONAL_MODE_CONCURRENCY=10   # Concurrent PDS fetches
```

**Architecture Changes:**
1. **Disable Firehose Consumer**
   - Skip Jetstream/relay connection entirely
   - Remove firehose event processing overhead
   - No need for cursor tracking or backfill

2. **On-Demand Everything**
   - Timeline: Fetch from each followed user's PDS
   - Profiles: Fetch from user's PDS
   - Posts: Fetch from author's PDS
   - Notifications: Poll user's PDS
   - Search: Federated search across PDSs

3. **Smart Caching**
   - Cache all fetched content in PostgreSQL
   - TTL-based invalidation (configurable)
   - LRU eviction for storage limits
   - Pre-fetch followed users' recent posts

4. **Resource Optimization**
   - Database: ~100MB-1GB (vs 100GB+ for network mode)
   - Memory: ~512MB-1GB (vs 2GB+ for network mode)
   - Bandwidth: ~10-100MB/day (vs GB/day for firehose)

**Comparison: Network Mode vs Personal Mode**

| Feature | Network Mode (Current) | Personal Mode |
|---------|----------------------|---------------|
| Firehose | ✅ Full network indexing | ❌ Disabled |
| Storage | 100GB+ | 100MB-1GB |
| Memory | 2GB+ | 512MB-1GB |
| Bandwidth | GB/day | MB/day |
| Startup | Minutes (firehose sync) | Seconds |
| Timeline load | Instant (cached) | 1-3s (fetch on-demand) |
| Discovery | Full network | Followed users only |
| Feed generators | Full support | Limited (on-demand) |
| Multi-user | Thousands | 1-100 |
| Best for | Public AppView | Self-hosting |

#### Implementation Phases

**Phase 1: Core On-Demand Fetching** ✅ (Already Implemented!)
- [x] On-demand post fetching (feed-generator-client.ts)
- [x] On-demand feed generator discovery
- [x] PDS resolution and record fetching
- [x] Event processor integration

**Phase 2: Personal Mode Configuration**
- [ ] Add `APPVIEW_MODE` config option
- [ ] Conditional firehose consumer startup
- [ ] Personal mode validation and warnings
- [ ] Documentation and setup guide

**Phase 3: Timeline Optimization**
- [ ] Fetch timeline from followed users' PDSs
- [ ] Parallel fetching with rate limiting
- [ ] Smart caching with TTL
- [ ] Pre-fetch strategies (background jobs)

**Phase 4: Resource Limits**
- [ ] Configurable cache size limits
- [ ] LRU eviction for old content
- [ ] Storage usage monitoring
- [ ] Automatic cleanup jobs

**Phase 5: UX Improvements**
- [ ] Loading indicators for on-demand fetches
- [ ] Offline mode support
- [ ] Cache warmup on login
- [ ] Background sync workers

**Phase 6: Advanced Features**
- [ ] P2P cache sharing (optional)
- [ ] Federated search across personal AppViews
- [ ] Export/import cached data
- [ ] Hybrid mode (firehose for followed + on-demand for rest)

#### Future Enhancements

**Optional P2P Features:**
- Share cached data with friends' personal AppViews
- Distributed caching for communities
- Peer-to-peer discovery of new content

**Mobile Support:**
- Native mobile apps with personal AppView backend
- Sync between devices
- Offline-first reading experience

---

## 📋 Other Roadmap Items

### v1.1 - Polish & Performance
- [ ] Complete Bluesky web client rebranding
- [ ] Optimize database queries
- [ ] Add metrics dashboard improvements
- [ ] Better error handling and user feedback

### v1.2 - Advanced Moderation
- [ ] Custom labeler support
- [ ] Community moderation tools
- [ ] Content filtering improvements
- [ ] Block/mute list management

### v1.3 - Federation Features
- [ ] Multi-AppView federation
- [ ] Cross-AppView search
- [ ] Shared blocklists
- [ ] Instance reputation system

---

## 🎯 Vision

Aurora Prism aims to be the **most flexible AT Protocol AppView**:

1. **Network Mode** - Full firehose indexing for public instances
2. **Personal Mode** - Lightweight self-hosting for individuals
3. **Hybrid Mode** - Best of both worlds (configurable mix)

This flexibility makes Aurora Prism suitable for:
- 🌐 Public AppViews (thousands of users)
- 🏠 Personal AppViews (self-hosters)
- 👥 Community AppViews (small groups)
- 🏢 Enterprise AppViews (private networks)

---

## 🤝 Contributing

Want to help build Personal Mode? Check out:
- [DEVELOPMENT.md](./DEVELOPMENT.md) - Setup development environment
- [GitHub Issues](https://github.com/yourusername/aurora-prism/issues) - Find tasks
- [Discord](#) - Join the community

---

**Last Updated:** 2025-01-17
