# Constellation Local - Phase 2 🌌

Self-hosted AT Protocol backlink index with Docker workers and automatic integration.

## Overview

Phase 2 adds the ability to run your own local Constellation instance, providing:

- **Full Control**: Own your data and infrastructure
- **Zero Rate Limits**: No API throttling on local instance
- **Low Latency**: <10ms response times vs 50-200ms remote
- **Privacy**: All data stays on your infrastructure
- **Cost Effective**: ~2GB/day storage, runs on modest hardware

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    AT Protocol                           │
│                  Jetstream (Firehose)                    │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│          Constellation Local (Rust Service)              │
│                                                           │
│  • RocksDB for backlink storage                          │
│  • Real-time indexing from firehose                      │
│  • HTTP API on port 8080                                 │
│  • ~2GB/day disk usage                                   │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│         Constellation Client (Node.js Bridge)            │
│                                                           │
│  • Auto-detects local vs remote                          │
│  • Redis caching (30s TTL)                               │
│  • No rate limiting for local                            │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│                     AppView                              │
│                                                           │
│  • Enhanced interaction statistics                       │
│  • Transparent integration                               │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### Option 1: Automated Setup (Recommended)

Run the setup script for interactive configuration:

```bash
./scripts/setup-constellation-local.sh
```

This will:
1. ✅ Check prerequisites (Docker, Docker Compose)
2. ✅ Create data directory
3. ✅ Generate environment configuration
4. ✅ Build Constellation Docker image
5. ✅ Start services
6. ✅ Update AppView configuration
7. ✅ Test the installation

### Option 2: Manual Setup

1. **Create data directory:**
```bash
mkdir -p ./constellation-data
chmod 755 ./constellation-data
```

2. **Create environment file:**
```bash
cp .env.constellation-local.example .env.constellation-local
# Edit .env.constellation-local as needed
```

3. **Build and start:**
```bash
docker-compose -f docker-compose.yml -f docker-compose.constellation-local.yml up -d
```

4. **Update AppView configuration:**
Add to your `.env`:
```bash
CONSTELLATION_URL=http://constellation-local:8080
CONSTELLATION_LOCAL=true
CONSTELLATION_ENABLED=true
```

5. **Restart AppView:**
```bash
docker-compose restart app
```

## Configuration

### Environment Variables

See `.env.constellation-local.example` for all options. Key settings:

```bash
# Jetstream endpoint
JETSTREAM_URL=wss://jetstream2.us-east.bsky.network/subscribe

# Resource limits
CONSTELLATION_MEMORY_LIMIT=2G
CONSTELLATION_MEMORY_RESERVATION=512M

# Cache settings (shorter TTL for local instance)
CONSTELLATION_CACHE_TTL=30

# Logging
CONSTELLATION_LOG_LEVEL=info
```

### Jetstream Endpoints

Available Jetstream servers:
- **US East (Primary)**: `wss://jetstream1.us-east.bsky.network/subscribe`
- **US East (Secondary)**: `wss://jetstream2.us-east.bsky.network/subscribe`
- **US West**: `wss://jetstream1.us-west.bsky.network/subscribe`

Choose the closest region for best performance.

## Testing

### Automated Tests

Run the test suite:

```bash
./scripts/test-constellation-local.sh
```

This tests:
- ✅ Container running and healthy
- ✅ API responding
- ✅ Data directory created
- ✅ No critical errors in logs
- ✅ AppView integration
- ✅ Redis cache working
- ✅ API performance (<1s response time)

### Manual Testing

**Check container status:**
```bash
docker ps | grep constellation-local
```

**View logs:**
```bash
docker-compose logs -f constellation-local
```

**Test API directly:**
```bash
# Basic health check
curl http://localhost:8080/

# Test a specific query (replace with real AT-URI)
curl "http://localhost:8080/links/count?\
target=at%3A%2F%2Fdid%3Aplc%3A...\
&collection=app.bsky.feed.like\
&path=.subject.uri"
```

**Check AppView logs:**
```bash
docker logs app 2>&1 | grep CONSTELLATION
# Should show: "Integration enabled (LOCAL - URL: http://constellation-local:8080)"
```

## Monitoring

### Health Checks

Constellation includes automatic health checks:

```bash
# Docker health status
docker inspect --format='{{.State.Health.Status}}' constellation-local

# API health endpoint
curl http://localhost:8080/
```

### Resource Usage

**Disk space:**
```bash
du -sh ./constellation-data
```

**Memory usage:**
```bash
docker stats constellation-local --no-stream
```

**Container logs:**
```bash
docker logs constellation-local --tail 100 -f
```

### Metrics

Monitor these key metrics:

- **Disk growth**: ~2GB/day for full network
- **Memory usage**: Typically 512MB-1GB
- **CPU usage**: <10% on modest hardware
- **API latency**: <10ms for cache hits

## Maintenance

### Backups

**Create backup:**
```bash
# Stop constellation
docker-compose stop constellation-local

# Backup data
tar -czf constellation-backup-$(date +%Y%m%d).tar.gz ./constellation-data

# Restart
docker-compose start constellation-local
```

**Restore from backup:**
```bash
# Stop constellation
docker-compose stop constellation-local

# Restore data
tar -xzf constellation-backup-YYYYMMDD.tar.gz

# Restart
docker-compose start constellation-local
```

### Updates

**Update to latest version:**
```bash
# Pull latest changes
cd microcosm-bridge/constellation
git pull

# Rebuild
docker-compose -f docker-compose.yml -f docker-compose.constellation-local.yml build constellation-local

# Restart
docker-compose restart constellation-local
```

**Update to specific version:**
```bash
# Set version in .env.constellation-local
CONSTELLATION_VERSION=v1.2.3

# Rebuild and restart
docker-compose -f docker-compose.yml -f docker-compose.constellation-local.yml up -d --build
```

### Log Rotation

Configure log rotation to prevent disk filling:

```bash
# In docker-compose.constellation-local.yml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

## Troubleshooting

### Container Won't Start

**Check Docker logs:**
```bash
docker logs constellation-local
```

**Common issues:**
- Port 8080 already in use: Change `CONSTELLATION_PORT` in `.env`
- Data directory permissions: `chmod 755 ./constellation-data`
- Memory limits too low: Increase in `.env.constellation-local`

### Can't Connect to Jetstream

**Error:** `failed to connect to jetstream`

**Solutions:**
1. Check internet connectivity
2. Try different Jetstream endpoint
3. Check firewall allows WebSocket connections
4. Verify DNS resolution

### High Memory Usage

**If memory usage exceeds limits:**

1. Check for memory leaks in logs
2. Increase memory limit: `CONSTELLATION_MEMORY_LIMIT=4G`
3. Restart container: `docker-compose restart constellation-local`
4. Consider pruning old data (see Constellation docs)

### Slow API Responses

**If API is slow (>100ms):**

1. Check disk I/O: `iostat -x 1`
2. Check memory: `docker stats constellation-local`
3. Check CPU: `top` or `htop`
4. Consider SSD for data directory
5. Tune RocksDB settings (see Constellation docs)

### Data Not Indexing

**If new interactions aren't showing up:**

1. Check Jetstream connection in logs
2. Verify clock is synchronized: `timedatectl`
3. Check for errors: `docker logs constellation-local | grep ERROR`
4. Restart service: `docker-compose restart constellation-local`

### AppView Not Using Local Instance

**Check configuration:**
```bash
# Should show LOCAL
docker logs app 2>&1 | grep CONSTELLATION

# If not, verify .env settings
grep CONSTELLATION .env
```

**Fix:**
1. Ensure `CONSTELLATION_LOCAL=true` in `.env`
2. Ensure `CONSTELLATION_URL=http://constellation-local:8080`
3. Restart app: `docker-compose restart app`

## Performance Optimization

### For High-Traffic Deployments

1. **Increase memory:**
```bash
CONSTELLATION_MEMORY_LIMIT=4G
CONSTELLATION_MEMORY_RESERVATION=2G
```

2. **Use SSD/NVMe for data:**
```bash
# Mount fast storage
CONSTELLATION_DATA_PATH=/mnt/nvme/constellation-data
```

3. **Tune RocksDB** (in Constellation source):
- Increase block cache
- Tune compaction settings
- Enable compression

4. **Scale horizontally:**
- Run multiple AppView instances
- Use load balancer for Constellation API
- Consider read replicas (advanced)

### For Resource-Constrained Deployments

1. **Reduce memory:**
```bash
CONSTELLATION_MEMORY_LIMIT=1G
CONSTELLATION_MEMORY_RESERVATION=256M
```

2. **Increase cache TTL:**
```bash
CONSTELLATION_CACHE_TTL=300  # 5 minutes
```

3. **Limit logging:**
```bash
CONSTELLATION_LOG_LEVEL=warn
```

## Advanced Configuration

### Custom Jetstream

If running your own Jetstream:

```bash
JETSTREAM_URL=wss://your-jetstream.example.com/subscribe
```

### Jetstream with Authentication

For authenticated Jetstream endpoints:

```bash
# Modify Dockerfile to add authentication
# See microcosm-rs documentation
```

### Custom API Port

To use different port:

```bash
CONSTELLATION_PORT=8888

# Update AppView configuration
CONSTELLATION_URL=http://constellation-local:8888
```

### Data Retention

Configure data retention (requires Constellation v2.0+):

```bash
# In Constellation config (see microcosm-rs docs)
CONSTELLATION_RETENTION_DAYS=90
```

## Comparison: Local vs Remote

| Feature | Local Instance | Remote (Public) |
|---------|---------------|-----------------|
| Latency | <10ms | 50-200ms |
| Rate Limiting | None | 10 req/s |
| Uptime | Your control | Best-effort |
| Data Privacy | Full control | Shared service |
| Setup Time | ~30 minutes | Instant |
| Maintenance | Your responsibility | Maintained |
| Cost | Infrastructure | Free |
| Historical Data | Requires backfill | Available |

## Migration

### From Remote to Local

Already using remote Constellation? Easy migration:

1. Run setup script: `./scripts/setup-constellation-local.sh`
2. Wait for indexing to catch up (~24 hours for recent data)
3. Switch configuration (done by setup script)
4. Test with: `./scripts/test-constellation-local.sh`

**Zero downtime:** Client automatically falls back to cached data during migration.

### From Local to Remote

Switching back to remote:

```bash
# Update .env
CONSTELLATION_URL=https://constellation.microcosm.blue
CONSTELLATION_LOCAL=false

# Restart app
docker-compose restart app

# Optionally stop local instance
docker-compose stop constellation-local
```

## Support

### Resources

- **Constellation Documentation**: https://constellation.microcosm.blue/
- **Microcosm Discord**: https://discord.gg/tcDfe4PGVB
- **Source Code**: https://tangled.org/@microcosm.blue/microcosm-rs
- **Issues**: Open issue in your AppView repository

### Getting Help

1. Run diagnostic: `./scripts/test-constellation-local.sh`
2. Collect logs: `docker logs constellation-local > constellation.log`
3. Check resource usage: `docker stats constellation-local`
4. Search existing issues
5. Ask in Microcosm Discord #constellation channel

## License

Constellation is licensed under AGPL-3.0. See microcosm-rs repository for details.

This integration code follows your AppView's license.

## Credits

- **Constellation**: [@bad-example.com](https://bsky.app/profile/bad-example.com)
- **Microcosm Project**: [microcosm.blue](https://microcosm.blue)
- **Integration**: Phase 2 Docker workers with automatic client integration
