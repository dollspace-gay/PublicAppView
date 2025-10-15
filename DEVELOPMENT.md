# Local Development Guide

This guide explains how to run AppView locally for development and testing.

## Prerequisites

- Docker and Docker Compose installed
- At least 4GB RAM available for Docker
- Git for version control

## Quick Start

1. **Copy the local environment file:**
   ```bash
   cp .env.local .env
   ```

2. **Start all services in development mode:**
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
   ```

   Or run in background:
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
   ```

3. **View logs:**
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.dev.yml logs -f
   ```

4. **Access the application:**
   - AppView: http://localhost:5000
   - PostgreSQL: localhost:5432
   - Redis: localhost:6379

## Development Features

### Hot Reload
Code changes are automatically reflected in running containers:
- **Python services**: Changes to `python-firehose/*.py` apply immediately
- **Node.js app**: Changes to `src/**` require restart (working on hot-reload)

### Lower Resource Usage
Development mode uses much lower resource limits:
- Database: 2GB RAM (vs 20GB+ in production)
- Redis: 512MB RAM (vs 8GB in production)
- Python workers: 512MB-1GB each

### Debug Logging
All services run with `LOG_LEVEL=DEBUG` for detailed output.

## Common Commands

### Restart a specific service (after code changes)
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml restart python-backfill-worker
```

### Rebuild after dependency changes
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml build python-backfill-worker
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d python-backfill-worker
```

### Stop all services
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml down
```

### Reset database (WARNING: deletes all data)
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### Access database directly
```bash
docker-compose exec db psql -U postgres -d atproto
```

### Access Redis CLI
```bash
docker-compose exec redis redis-cli
```

## Service Architecture

- **db**: PostgreSQL database for storing posts, users, etc.
- **redis**: In-memory cache and message broker
- **python-firehose**: Connects to AT Protocol firehose, pushes to Redis
- **python-worker**: Consumes from Redis, writes to database
- **python-backfill-worker**: Direct firehose → database (with optional backfill)
- **app**: Node.js AppView API server
- **constellation-bridge**: Optional enhanced stats service

## Debugging Tips

### Watch Python worker logs in real-time
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml logs -f python-backfill-worker
```

### Check if services are healthy
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

### Execute commands in a running container
```bash
docker-compose exec python-backfill-worker bash
```

### Check database connection
```bash
docker-compose exec python-backfill-worker python -c "import asyncpg; import asyncio; asyncio.run(asyncpg.connect('postgresql://postgres:password@db:5432/atproto'))"
```

## Testing the SQL Fix

After fixing the `post_viewer_states` SQL error:

1. Restart the affected service:
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.dev.yml restart python-backfill-worker
   ```

2. Watch for errors:
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.dev.yml logs -f python-backfill-worker | grep -i error
   ```

3. Should see no more `$NULL` or `$false` syntax errors!

## Production vs Development

Key differences between `.env.local` and production:

| Setting | Local Dev | Production |
|---------|-----------|------------|
| Database RAM | 2GB | 20GB+ |
| Redis RAM | 512MB | 8GB |
| Worker pool size | 10 | 20 |
| Logging | DEBUG | INFO |
| Backfill | Disabled | Optional |
| Constellation | Disabled | Optional |

## Troubleshooting

### Port already in use
If you see "port already in use" errors, check what's using the ports:
```bash
netstat -ano | findstr :5432
netstat -ano | findstr :5000
```

### Out of memory
Increase Docker's memory limit in Docker Desktop settings (Minimum 4GB recommended).

### Database connection refused
Wait for the database to be healthy:
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml logs db
```

## Next Steps

1. Make code changes in your editor (VSCode)
2. Changes to Python files apply immediately (no restart needed)
3. For dependency changes, rebuild the container
4. Test your changes locally before deploying to VPS

## Useful VSCode Extensions

- Docker (by Microsoft) - Manage containers from VSCode
- PostgreSQL (by Chris Kolkman) - Query database directly
- Python (by Microsoft) - Python development support
- GitLens - Enhanced git integration
