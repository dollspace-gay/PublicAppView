# Deployment Checklist for Performance Fixes

## Pre-Deployment

### ✅ Code Changes Verified
- [x] N+1 query fix applied to `server/services/feed-algorithm.ts`
- [x] Redis caching integrated
- [x] Database connection pool optimized in `server/db.ts`
- [x] No syntax errors in modified files
- [x] All imports are correct

### Before Deploying
- [ ] Backup current production code
- [ ] Ensure Redis is running on production
- [ ] Verify database connection limits
- [ ] Review current database CPU and connection usage

## Deployment Steps

### 1. Environment Variables
Ensure these are set in production:

```bash
# Required
DATABASE_URL=postgresql://...        # Your database connection string
REDIS_URL=redis://...                # Your Redis connection string

# Optional (smart defaults will be used)
DB_POOL_SIZE=20                      # Override if needed (10 for Neon, 20 for PostgreSQL)
```

### 2. Deploy Code
```bash
# Pull latest changes
git pull origin cursor/analyze-serving-api-for-bottlenecks-8e79

# Install dependencies (if any new ones)
npm install

# Restart the application
npm restart
# or
pm2 restart all
```

### 3. Verify Redis Connection
```bash
# Test Redis connectivity
redis-cli PING
# Should return: PONG

# Check Redis memory
redis-cli INFO memory | grep used_memory_human
```

### 4. Monitor Initial Deployment

#### Watch Application Logs
```bash
# Look for these success indicators:
tail -f logs/*.log | grep -E "FEED_ALGORITHM|DB|CACHE"

# Expected log messages:
# [DB] Using connection pool size: 20 (type: PostgreSQL)
# [FEED_ALGORITHM] Fetched aggregations for 50 posts from DB (48 found)
# [FEED_ALGORITHM] Cache hit for 50 posts
```

#### Monitor Database
```bash
# Watch query count (should drop dramatically)
# Watch connection count (should be within pool size)
# Watch CPU usage (should decrease significantly)
```

#### Monitor Redis
```bash
# Watch cache operations
redis-cli MONITOR | grep post_aggregations

# Check hit rate after 10 minutes
redis-cli INFO stats | grep keyspace_hits
```

### 5. Performance Testing

#### Test Timeline Endpoint
```bash
# Should complete in 0.1-0.3 seconds (was 2-5 seconds)
time curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://your-domain.com/xrpc/app.bsky.feed.getTimeline?limit=50"
```

#### Load Test (Optional)
```bash
# Install apache bench if not available
sudo apt-get install apache2-utils

# Test with 100 requests, 10 concurrent
ab -n 100 -c 10 -H "Authorization: Bearer TOKEN" \
  "https://your-domain.com/xrpc/app.bsky.feed.getTimeline?limit=50"

# Compare before/after:
# - Requests per second (should be 10-50x higher)
# - Time per request (should be 10-50x lower)
# - Failed requests (should be 0)
```

## Success Criteria

### Within 15 Minutes
- [ ] No errors in application logs
- [ ] API endpoints responding normally
- [ ] Response times improved significantly
- [ ] Database query count reduced by 90%+

### Within 1 Hour
- [ ] Cache hit rate above 50%
- [ ] Database CPU usage decreased
- [ ] No connection pool exhaustion errors
- [ ] User experience improved (faster timelines)

### Within 24 Hours
- [ ] Cache hit rate stabilized at 70-90%
- [ ] No memory leaks in Redis
- [ ] Database load sustained at lower levels
- [ ] No unexpected errors or edge cases

## Monitoring Queries

### Database Queries
```sql
-- Check connection count
SELECT count(*) FROM pg_stat_activity;

-- Check slow queries
SELECT query, mean_exec_time, calls 
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;

-- Check for aggregations table usage
SELECT * FROM pg_stat_statements 
WHERE query LIKE '%post_aggregations%' 
ORDER BY calls DESC;
```

### Redis Queries
```bash
# Connected clients
redis-cli CLIENT LIST | wc -l

# Cache hit rate (should be 70-90%)
redis-cli INFO stats | grep -E "keyspace_hits|keyspace_misses"

# Memory usage
redis-cli INFO memory | grep -E "used_memory_human|maxmemory"

# Keys count
redis-cli DBSIZE
```

### Application Metrics
```bash
# API response times (should be 0.1-0.3s)
grep "GET.*timeline.*in.*ms" logs/*.log | tail -20

# Database query count per request
grep "FEED_ALGORITHM.*from DB" logs/*.log | wc -l

# Cache hit count
grep "FEED_ALGORITHM.*Cache hit" logs/*.log | wc -l
```

## Rollback Plan

If issues occur, rollback is quick and simple:

### Option 1: Quick Rollback (Git)
```bash
# Rollback the specific files
git checkout HEAD~1 -- server/services/feed-algorithm.ts server/db.ts

# Restart application
npm restart
```

### Option 2: Full Rollback (Branch)
```bash
# Switch to previous stable branch
git checkout main  # or your stable branch

# Restart application
npm restart
```

### Option 3: Emergency Rollback (Code only)
If git isn't available, manually revert the changes:

**In `server/services/feed-algorithm.ts`:**
- Remove the `postAggregations` import
- Remove the `cacheService` import
- Replace batch query with old N+1 queries

**In `server/db.ts`:**
- Change `DEFAULT_DB_POOL_SIZE` back to 4

## Troubleshooting

### Issue: "Cannot find module 'postAggregations'"
**Solution:** Ensure `@shared/schema` exports `postAggregations` (it should already)

### Issue: "Redis connection failed"
**Solution:** 
```bash
# Check if Redis is running
redis-cli PING

# Start Redis if needed
redis-server

# Check REDIS_URL environment variable
echo $REDIS_URL
```

### Issue: "Database connection pool exhausted"
**Solution:** 
```bash
# Reduce pool size temporarily
export DB_POOL_SIZE=10

# Or increase database max_connections
# In PostgreSQL config: max_connections = 200
```

### Issue: "Cache miss rate is 100%"
**Solution:**
- Check Redis connectivity
- Verify `cacheService` is initialized
- Check TTL settings (default 5 minutes)
- Review cache invalidation logic

### Issue: "Still seeing slow queries"
**Solution:**
- Check if `postAggregations` table is populated
- Verify indexes exist on the table
- Check database query logs for bottlenecks
- Review cache hit rate

## Post-Deployment Tasks

### Day 1
- [ ] Monitor error logs continuously
- [ ] Check cache hit rate every hour
- [ ] Verify database CPU is lower
- [ ] Collect user feedback on speed

### Week 1
- [ ] Review performance metrics
- [ ] Optimize cache TTL if needed
- [ ] Adjust connection pool size if needed
- [ ] Document any issues encountered

### Month 1
- [ ] Analyze long-term performance trends
- [ ] Plan additional optimizations
- [ ] Review and optimize other slow endpoints
- [ ] Consider read replicas if needed

## Metrics Dashboard

Create a dashboard to track:
- API response time (p50, p95, p99)
- Database query count per endpoint
- Redis cache hit rate
- Database connection pool usage
- Error rate
- Requests per second

## Support Contacts

If issues arise:
1. Check this deployment checklist
2. Review `/workspace/FIXES_APPLIED.md`
3. Check `/workspace/PERFORMANCE_BOTTLENECK_ANALYSIS.md`
4. Run `/workspace/verify-performance-fix.sh`
5. Review logs and metrics

## Files Modified

Summary of all changes:
1. `server/services/feed-algorithm.ts` - N+1 fix + caching
2. `server/db.ts` - Connection pool optimization

These are the ONLY files modified. Low risk, high impact changes.

---

**Deployment Date:** _____________
**Deployed By:** _____________
**Rollback Plan Tested:** [ ] Yes [ ] No
**All Checks Passed:** [ ] Yes [ ] No
