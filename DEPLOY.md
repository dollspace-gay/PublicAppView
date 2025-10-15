# Deployment Guide - Applying Code Changes to VPS

When you make code changes to Python files, you need to rebuild the Docker images on your VPS for the changes to take effect.

## Quick Deploy Commands

### For Python Firehose/Worker Changes

If you modified files in `python-firehose/` directory:

```bash
# SSH into your VPS
ssh user@your-vps

# Navigate to the project directory
cd /path/to/PublicAppView

# Pull latest code from git
git pull

# Rebuild and restart the affected service
docker-compose build python-backfill-worker
docker-compose up -d python-backfill-worker

# Watch logs to verify the fix
docker-compose logs -f python-backfill-worker
```

### For App (Node.js) Changes

If you modified TypeScript/JavaScript files:

```bash
# Rebuild and restart app service
docker-compose build app
docker-compose up -d app

# Watch logs
docker-compose logs -f app
```

### Rebuild Everything

If you're not sure which services changed:

```bash
# Pull latest code
git pull

# Rebuild all services
docker-compose build

# Restart all services
docker-compose up -d

# Watch all logs
docker-compose logs -f
```

## Verifying the SQL Fix

After deploying the `unified_worker.py` fix:

1. **Rebuild the service:**
   ```bash
   docker-compose build python-backfill-worker
   docker-compose up -d python-backfill-worker
   ```

2. **Watch for errors:**
   ```bash
   docker-compose logs -f python-backfill-worker | grep -i "error\|syntax"
   ```

3. **Verify database logs:**
   ```bash
   docker-compose logs -f db | grep -i "syntax error"
   ```

4. **Success indicators:**
   - No more `$NULL` or `$false` syntax errors
   - Viewer states (likes/reposts) inserting successfully
   - No "current transaction is aborted" errors

## Deployment Checklist

- [ ] Code changes committed to git
- [ ] Pushed to remote repository
- [ ] SSH'd into VPS
- [ ] Pulled latest code with `git pull`
- [ ] Rebuilt Docker images with `docker-compose build`
- [ ] Restarted services with `docker-compose up -d`
- [ ] Checked logs for errors
- [ ] Verified application is working

## Common Issues

### "Image is up to date" but code not updated
```bash
# Force rebuild without cache
docker-compose build --no-cache python-backfill-worker
docker-compose up -d python-backfill-worker
```

### Container won't stop
```bash
# Force stop and remove
docker-compose stop python-backfill-worker
docker-compose rm -f python-backfill-worker
docker-compose up -d python-backfill-worker
```

### Database connection errors after restart
```bash
# Wait for database to be healthy
docker-compose ps

# Check database logs
docker-compose logs db

# Restart dependent services
docker-compose restart python-backfill-worker
```

### Out of disk space
```bash
# Clean up old Docker images
docker system prune -a

# Clean up old containers
docker-compose down --volumes
docker-compose up -d
```

## Git Workflow

### Committing Changes

```bash
# On your local machine (in VSCode)
git add python-firehose/unified_worker.py
git commit -m "Fix: Correct SQL syntax in post_viewer_states INSERT"
git push origin main
```

### Deploying to VPS

```bash
# On VPS
git pull origin main
docker-compose build python-backfill-worker
docker-compose up -d python-backfill-worker
```

## Rollback

If something goes wrong:

```bash
# Revert to previous git commit
git log  # Find the commit hash you want to revert to
git checkout <commit-hash>

# Rebuild with old code
docker-compose build
docker-compose up -d

# Or reset to latest stable
git checkout main
git pull
docker-compose build
docker-compose up -d
```

## Health Checks

Verify services are healthy:

```bash
# Check status
docker-compose ps

# All services should show "healthy" or "running"
```

## Performance Monitoring

Watch resource usage:

```bash
# Monitor container stats
docker stats

# Watch specific service
docker stats python-backfill-worker
```
