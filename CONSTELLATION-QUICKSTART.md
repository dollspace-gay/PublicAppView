# Constellation Quick Start - Integrated Deployment 🚀

Constellation Phase 2 is now **integrated into the main docker-compose.yml**! 

## TL;DR - One Command Setup

```bash
# Copy environment file
cp .env.example .env

# Start with Constellation profile
docker-compose --profile constellation up -d

# That's it! 🎉
```

## What You Get

When you enable the `constellation` profile, you get:

- ✅ **Local Constellation instance** - Self-hosted backlink index
- ✅ **Constellation bridge** - Client for AppView integration
- ✅ **Automatic integration** - Zero manual configuration needed
- ✅ **10x faster** - <10ms latency vs 50-200ms remote
- ✅ **No rate limits** - Unlimited API calls
- ✅ **~2GB/day storage** - For full network indexing

## Quick Start Options

### Option 1: Default Profile (Recommended)

Start with the constellation profile enabled:

```bash
# Copy and edit environment
cp .env.example .env

# Start all services including Constellation
docker-compose --profile constellation up -d

# Check logs
docker-compose logs -f constellation-local
```

### Option 2: Start Without Constellation First

Start your AppView without Constellation, then add it later:

```bash
# Start basic services
docker-compose up -d

# Later, add Constellation
docker-compose --profile constellation up -d

# Restart app to use local instance
docker-compose restart app
```

### Option 3: Use Remote API Instead

Don't want to run a local instance? Use the public API:

```bash
# Edit .env
CONSTELLATION_ENABLED=true
CONSTELLATION_URL=https://constellation.microcosm.blue
CONSTELLATION_LOCAL=false
CONSTELLATION_CACHE_TTL=60

# Start without constellation profile
docker-compose up -d
```

## Configuration

All configuration is in your `.env` file:

```bash
# Enable Constellation
CONSTELLATION_ENABLED=true

# Use local instance (default)
CONSTELLATION_URL=http://constellation-local:8080
CONSTELLATION_LOCAL=true

# Jetstream endpoint (choose closest region)
JETSTREAM_URL=wss://jetstream2.us-east.bsky.network/subscribe

# Resource limits
CONSTELLATION_MEMORY_LIMIT=2G
CONSTELLATION_MEMORY_RESERVATION=512M

# Cache settings
CONSTELLATION_CACHE_TTL=30
```

## Verify It's Working

### Check Services

```bash
# All services should be healthy
docker-compose ps

# Should show:
# constellation-local   Up (healthy)
# constellation-bridge  Up (healthy)
# app                   Up (healthy)
```

### Check Logs

```bash
# Constellation should be indexing
docker-compose logs constellation-local | tail -20

# Look for:
# [INFO] Connected to jetstream
# [INFO] Processing events from firehose
# [INFO] Indexed N links...
```

### Check AppView Integration

```bash
# AppView should detect local instance
docker-compose logs app | grep CONSTELLATION

# Should show:
# [CONSTELLATION] Integration enabled (LOCAL - URL: http://constellation-local:8080)
```

### Test API

```bash
# Health check
curl http://localhost:8080/

# Should return HTML with API docs
```

## Profiles Explained

The `constellation` profile makes the services optional:

```yaml
profiles:
  - constellation  # Enable with --profile constellation
  - all           # Or --profile all for everything
```

**Without profile:** Base AppView services only
**With `--profile constellation`:** Adds Constellation local + bridge
**With `--profile all`:** Adds all optional services

## Common Commands

### Start Everything

```bash
docker-compose --profile constellation up -d
```

### Stop Everything

```bash
docker-compose --profile constellation down
```

### Restart Constellation

```bash
docker-compose restart constellation-local
```

### View Logs

```bash
# All logs
docker-compose logs -f

# Constellation only
docker-compose logs -f constellation-local

# AppView integration
docker-compose logs app | grep CONSTELLATION
```

### Check Disk Usage

```bash
# Data directory size
docker volume inspect $(docker-compose config --volumes | grep constellation-data) \
  | jq -r '.[0].Mountpoint' \
  | xargs du -sh

# Or check the volume directly
du -sh /var/lib/docker/volumes/constellation-data/_data
```

### Update Constellation

```bash
# Pull latest changes
docker-compose --profile constellation pull constellation-local

# Or rebuild from source
docker-compose --profile constellation build --no-cache constellation-local

# Restart
docker-compose restart constellation-local
```

## Performance

### Expected Metrics

- **Disk growth**: ~2GB/day for full network
- **Memory usage**: 512MB-1GB typical
- **CPU usage**: <10% on modern hardware  
- **API latency**: <10ms (local) vs 50-200ms (remote)
- **Cache hit rate**: 85-95% typical

### Monitor Performance

```bash
# Resource usage
docker stats constellation-local

# API performance
time curl http://localhost:8080/
```

## Troubleshooting

### Services Won't Start

```bash
# Check logs
docker-compose logs constellation-local

# Common issues:
# 1. Port 8080 in use -> Change CONSTELLATION_PORT in .env
# 2. Memory limit -> Increase CONSTELLATION_MEMORY_LIMIT
# 3. Permission error -> Check data volume permissions
```

### Can't Connect to Jetstream

```bash
# Try different endpoint in .env
JETSTREAM_URL=wss://jetstream1.us-east.bsky.network/subscribe

# Restart
docker-compose restart constellation-local
```

### High Memory Usage

```bash
# Increase limits in .env
CONSTELLATION_MEMORY_LIMIT=4G

# Restart
docker-compose restart constellation-local
```

### Slow Performance

```bash
# Check disk I/O
docker stats constellation-local

# Check if on SSD (recommended)
df -T | grep docker

# Consider increasing cache TTL
CONSTELLATION_CACHE_TTL=60
```

### AppView Not Using Local Instance

```bash
# Check app logs
docker-compose logs app | grep CONSTELLATION

# If shows REMOTE, check .env:
CONSTELLATION_URL=http://constellation-local:8080
CONSTELLATION_LOCAL=true

# Restart app
docker-compose restart app
```

## Switching Modes

### From Remote to Local

```bash
# Update .env
CONSTELLATION_URL=http://constellation-local:8080
CONSTELLATION_LOCAL=true

# Start Constellation
docker-compose --profile constellation up -d

# Restart app
docker-compose restart app
```

### From Local to Remote

```bash
# Update .env
CONSTELLATION_URL=https://constellation.microcosm.blue
CONSTELLATION_LOCAL=false

# Restart app
docker-compose restart app

# Optionally stop local instance
docker-compose stop constellation-local constellation-bridge
```

## Resource Requirements

### Minimum (Development/Testing)
- **CPU**: 1 core
- **RAM**: 512MB for Constellation
- **Disk**: 50GB free (25 days of data)
- **Network**: 1 Mbps sustained

### Recommended (Production)
- **CPU**: 2+ cores
- **RAM**: 2GB for Constellation
- **Disk**: 200GB+ free (SSD recommended)
- **Network**: 10 Mbps sustained

### High-Traffic
- **CPU**: 4+ cores
- **RAM**: 4GB for Constellation
- **Disk**: 500GB+ free (NVMe recommended)
- **Network**: 100 Mbps sustained

## Data Management

### Backup

```bash
# Stop Constellation
docker-compose stop constellation-local

# Backup volume
docker run --rm \
  -v constellation-data:/data \
  -v $(pwd):/backup \
  busybox \
  tar czf /backup/constellation-backup-$(date +%Y%m%d).tar.gz /data

# Restart
docker-compose start constellation-local
```

### Restore

```bash
# Stop Constellation
docker-compose stop constellation-local

# Restore from backup
docker run --rm \
  -v constellation-data:/data \
  -v $(pwd):/backup \
  busybox \
  tar xzf /backup/constellation-backup-YYYYMMDD.tar.gz -C /

# Restart
docker-compose start constellation-local
```

### Clean Old Data

```bash
# Remove volume (WARNING: deletes all data)
docker-compose --profile constellation down -v

# Remove just constellation data
docker volume rm constellation-data

# Start fresh
docker-compose --profile constellation up -d
```

## Advanced Usage

### Custom Jetstream

```bash
# If running your own Jetstream
JETSTREAM_URL=wss://my-jetstream.example.com/subscribe
```

### Custom Port

```bash
# Use different port
CONSTELLATION_PORT=8888

# Update app config too
CONSTELLATION_URL=http://constellation-local:8888
```

### Debug Mode

```bash
# Enable verbose logging
CONSTELLATION_LOG_LEVEL=debug
RUST_BACKTRACE=1

# Restart
docker-compose restart constellation-local

# Watch logs
docker-compose logs -f constellation-local
```

### Production Deployment

```bash
# Use specific version instead of 'main'
CONSTELLATION_VERSION=v1.2.3

# Increase resources
CONSTELLATION_MEMORY_LIMIT=4G
CONSTELLATION_MEMORY_RESERVATION=2G

# Longer cache for stability
CONSTELLATION_CACHE_TTL=60

# Rebuild with specific version
docker-compose --profile constellation build --no-cache
docker-compose --profile constellation up -d
```

## Next Steps

Once Constellation is running:

1. **Monitor performance**: Watch logs and metrics
2. **Set up backups**: Regular backups of constellation-data volume
3. **Tune resources**: Adjust based on your traffic
4. **Check disk space**: Plan for ~2GB/day growth
5. **Update regularly**: Pull updates from microcosm-rs

## Documentation

- **Full Phase 2 Guide**: [CONSTELLATION-PHASE2-QUICKSTART.md](CONSTELLATION-PHASE2-QUICKSTART.md)
- **Detailed Docs**: [microcosm-bridge/constellation/README.md](microcosm-bridge/constellation/README.md)
- **Bridge Info**: [microcosm-bridge/README.md](microcosm-bridge/README.md)
- **Setup Script**: `./scripts/setup-constellation-local.sh` (alternative method)
- **Test Suite**: `./scripts/test-constellation-local.sh`

## Support

- **Discord**: https://discord.gg/tcDfe4PGVB (#constellation channel)
- **Constellation Docs**: https://constellation.microcosm.blue/
- **Source**: https://tangled.org/@microcosm.blue/microcosm-rs
- **Issues**: Open in your AppView repository

## FAQ

**Q: Do I need to run local Constellation?**
A: No, you can use the remote API. Local is recommended for production.

**Q: How much does local Constellation cost to run?**
A: Just your infrastructure costs. Runs on modest hardware (~$10-20/month VPS).

**Q: Can I skip the profile and always run Constellation?**
A: Yes! Remove the `profiles:` section from docker-compose.yml.

**Q: What if my disk fills up?**
A: Set up backups and data retention. See microcosm-rs docs for pruning old data.

**Q: Is historical data included?**
A: No, indexing starts from deployment time. Historical backfill is manual (see microcosm-rs docs).

**Q: Can I run multiple Constellation instances?**
A: Yes! Use load balancer and configure each AppView to use different instances.

---

**Questions?** Join the [Microcosm Discord](https://discord.gg/tcDfe4PGVB) or check the full documentation.

**Ready to go?** Run `docker-compose --profile constellation up -d` and you're live! 🚀
