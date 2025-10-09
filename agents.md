## Agents and Background Services

This document explains the background "agents" that power the AT Protocol App View: how data flows from the Bluesky network into your database, how processing is distributed, and how to configure, operate, and extend these workers.

### TL;DR
- **Ingest**: Worker 0 connects to the relay via `firehose` and writes events to Redis Streams.
- **Distribute**: All workers run parallel consumer pipelines that read from Redis and call the `eventProcessor`.
- **Persist**: The `eventProcessor` validates lexicons, enforces ordering, writes to PostgreSQL, and emits labels/notifications.
- **Backfill**: Optional historical import via `@atproto/sync` firehose backfill or full-repo CAR backfill.
- **Maintain**: Data pruning, DB health checks, metrics, and label streaming run continuously.

---

## Architecture Overview

- **App Server** (`server/index.ts`, `server/routes.ts`)
  - Boots Express, initializes Redis connections, starts WebSocket endpoints, and spins up agents.
  - Sets worker identity via `NODE_APP_INSTANCE`/`pm_id` and runs role-specific tasks.

- **Firehose Ingestion Agent** (`server/services/firehose.ts`)
  - Connects to the relay (`RELAY_URL`), handles keepalive ping/pong, stall detection, auto-reconnect, and cursor persistence to DB every 5s.
  - Only worker 0 connects to the relay and publishes events to Redis.

- **Redis Queue (Event Bus)** (`server/services/redis-queue.ts`)
  - Uses Redis Streams with a single stream (`firehose:events`) and consumer group (`firehose-processors`).
  - Buffers cluster metrics and exposes status/recents via keys (`cluster:metrics`, `firehose:status`, `firehose:recent_events`).
  - Provides dead-consumer recovery via periodic `XAUTOCLAIM`-like behavior (`claimPendingMessages`).

- **Consumer Pipelines (Workers)** (`server/routes.ts`)
  - All workers run 5 parallel pipelines each to consume from Redis (`consume(..., 300)`), process with `eventProcessor`, and `xack` on success.
  - Duplicate (`23505`) and FK race (`23503`) errors are treated as success to ensure idempotency.

- **Event Processor** (`server/services/event-processor.ts`)
  - Validates against lexicons, sanitizes content, writes posts/likes/reposts/follows/lists/etc., and creates notifications.
  - Maintains TTL queues for out-of-order events (e.g., like before post) and flushes once dependencies arrive.
  - Auto-resolves handles/DIDs on-demand and respects per-user collection opt-out (`dataCollectionForbidden`).

- **Backfill Agents**
  - `server/services/backfill.ts` (Firehose Backfill via `@atproto/sync`)
    - Historical replay with optional cutoff (`BACKFILL_DAYS`), dedicated DB pool, periodic progress save, batching, and backpressure.
  - `server/services/repo-backfill.ts` (Repo CAR Backfill via `@atproto/api`)
    - Full per-repo import from PDS, parses CAR, walks MST for real CIDs (synthetic fallback), concurrent fetches.

- **Maintenance Agents**
  - `server/services/data-pruning.ts`: Periodic deletion beyond `DATA_RETENTION_DAYS` (safety minimums and batch caps).
  - `server/services/database-health.ts`: Periodic DB connectivity/table existence/count checks and loss detection.
  - `server/services/metrics.ts` and `server/services/log-collector.ts`: In-memory metrics and rolling logs (also surfaced to the dashboard).
  - `server/services/instance-moderation.ts`: Operator-driven label application and policy transparency.

---

## Event Flow

1. Firehose connects to `RELAY_URL` and emits `#commit`, `#identity`, `#account` events.
2. Worker 0 serializes them into lightweight objects and pushes to Redis Stream `firehose:events`.
3. Every worker runs multiple pipelines that call `redisQueue.consume()` to fetch batches (blocking for ~100ms), then `processEvent` with `eventProcessor`.
4. On success, the message is acknowledged (`xack`); every ~5s each pipeline also claims abandoned messages.
5. `eventProcessor` performs:
   - User ensure/creation with handle resolution.
   - Validation (lexicon), sanitization, and writes to PostgreSQL.
   - Deferred queueing and later flush for out-of-order dependencies.
   - Label application and notification fanout.

Cursor persistence:
- Live firehose: worker 0 saves cursor to DB every 5 seconds (`firehoseCursor` table).
- Backfill: a dedicated runner updates progress (`saveBackfillProgress`), including counts and last update time.

---

## Agents in Detail

### Firehose Ingestion (`server/services/firehose.ts`)
- Keepalive (ping every 30s), pong timeout (45s), stall threshold (2m) with forced reconnect.
- Concurrency guard for commit handling (`MAX_CONCURRENT_OPS`) with queue backpressure and drop policy when overloaded.
- Status and recent events are mirrored into Redis for the dashboard.

### Redis Queue (`server/services/redis-queue.ts`)
- Stream: `firehose:events`, group: `firehose-processors`.
- `consume(consumerId, count)` uses `XREADGROUP` with short block; `ack(messageId)` acks processed entries.
- `claimPendingMessages(consumerId, idleMs)` reclaims abandoned messages for resilience.
- Cluster metrics buffered and flushed every 500ms to `cluster:metrics`.

### Event Processor (`server/services/event-processor.ts`)
- Handles `app.bsky.feed.post|like|repost`, `app.bsky.actor.profile`, `app.bsky.graph.*`, `app.bsky.feed.generator`, `com.atproto.label.label`, etc.
- Pending queues:
  - Per-post ops (likes/reposts) until the post exists.
  - Per-user ops (follow/block) until both users exist.
  - Per-list items until the list exists.
- Sweeper drops stale pending items after 24h (counters tracked).
- Mentions and replies generate notifications; records respect user collection opt-out.

### Backfill (History)
- Firehose Backfill (`server/services/backfill.ts`)
  - Modes: `BACKFILL_DAYS=0` disabled, `>0` days cutoff, `-1` total history window.
  - Uses `MemoryRunner` for cursoring; batches and sleeps to avoid DB overload; dedicated DB pool.
- Repo Backfill (`server/services/repo-backfill.ts`)
  - Fetches `com.atproto.sync.getRepo`, reads CAR, walks MST for CIDs, processes via `eventProcessor` with real or synthetic CID fallback.
  - Concurrent repo fetches with periodic progress logging; dedicated DB pool.

### Maintenance
- Data Pruning (`server/services/data-pruning.ts`)
  - Enforced minimum retention (7 days); first run delayed 1h after startup; max deletions per batch and iteration safety cap.
- Database Health (`server/services/database-health.ts`)
  - Connectivity, table existence checks, row counts, and drastic drop detection (>50%).
- Instance Moderation (`server/services/instance-moderation.ts`)
  - Operator labels (e.g., takedown) applied via the instance labeler DID; optional reference deletion/hiding.

### Real-time and API Surfaces
- WebSocket dashboard stream at `/ws` (keepalive, metrics every 2s, firehose status, system health, recent events).
- Label subscription stream at `/xrpc/com.atproto.label.subscribeLabels` (public per spec).
- Health endpoints: `/health`, `/ready`, `/api/database/health`.
- Backfill endpoints:
  - User-initiated recent backfill: `POST /api/user/backfill { days }` (≤3: firehose; >3: repo backfill).
  - Admin/test: `POST /api/backfill/repo { did }`.

---

## Worker Model and Lifecycle

- Process manager sets `PM2_INSTANCES` and per-worker `NODE_APP_INSTANCE`/`pm_id`.
- `server/routes.ts` assigns roles:
  - Worker 0: firehose ingest → Redis; all workers: consumers (5 pipelines each).
  - All workers initialize Redis connections, metrics, WS servers, and admin/auth routes.
- `server/index.ts` kicks off:
  - Database health monitoring.
  - Data pruning (if enabled).
  - Historical backfill (if `BACKFILL_DAYS > 0`, worker 0 only).

---

## Configuration (agents-related)

- **FIREHOSE**
  - `RELAY_URL` (default: `wss://bsky.network`)
  - `FIREHOSE_ENABLED` (default: true)
  - `MAX_CONCURRENT_OPS` (per-worker in-flight processing limit)
- **Redis**
  - `REDIS_URL` (e.g., `redis://redis:6379`)
- **Database Pools**
  - `DB_POOL_SIZE` (main pool)
  - `BACKFILL_DB_POOL_SIZE` (dedicated pool for backfill agents)
- **History / Retention**
  - `BACKFILL_DAYS` (0=off, >0=cutoff window, -1=total)
  - `DATA_RETENTION_DAYS` (0=keep forever; min safety enforced)
- **Instance / Admin**
  - `APPVIEW_DID`, `ADMIN_DIDS`
  - `ENABLE_INSTANCE_MODERATION` (see instance moderation guide)
- **Osprey Integration** (optional)
  - `OSPREY_ENABLED` and related `OSPREY_*`/`LABEL_EFFECTOR_*` vars (see Osprey section below)

See also: `README.md` → Environment Variables.

---

## Operations

- **Start locally**
```bash
npm install
npm run db:push
npm run dev
```
- **Docker**: Use the included `docker-compose.yml` (Redis + Postgres + App). See `README.md`.
- **Toggle ingestion**: Set `FIREHOSE_ENABLED=false` to run consumers/UI without live ingest.
- **Backfill**: Set `BACKFILL_DAYS` and restart; or call the backfill endpoints.
- **Scale**: Increase PM2 instances and tune `DB_POOL_SIZE`, `MAX_CONCURRENT_OPS`; Redis Streams will distribute work across all pipelines.
- **Monitor**:
  - Health: `GET /health`, `GET /ready`, `GET /api/database/health`
  - Dashboard: open the app and watch `/ws` updates (events/min, error rate, firehose status, DB counts).

---

## Osprey (Optional Integration)

If `OSPREY_ENABLED=true`, you can offload ingestion/labeling via the Osprey Bridge components (Kafka-based):
- See `osprey-bridge/README.md` for architecture, adapters (direct/redis/firehose), environment, and health endpoints.
- The app exposes `/api/osprey/status` to report the bridge/effector health when enabled.

---

## Extending: Adding a New Agent

- Put long-running logic under `server/services/<your-agent>.ts`.
- Initialize it in `server/index.ts` after the HTTP server starts; guard with `pm_id` so only the intended worker runs it.
- For high-throughput pipelines, prefer Redis Streams; follow the existing `redis-queue` patterns for batching, acking, and dead-consumer recovery.
- Update `metricsService` for visibility and consider surfacing state over `/ws`.
- Make it configurable via environment variables and document safe defaults.

---

## Troubleshooting

- **No events arriving**: Check `FIREHOSE_ENABLED`, Redis connectivity (`REDIS_URL`), and network access to `RELAY_URL`.
- **Zombie connections**: Firehose agent auto-terminates dead sockets and reconnects; confirm via `/ws` firehose status.
- **Backpressure / throughput issues**: Lower `MAX_CONCURRENT_OPS`, increase DB/Redis resources, or scale worker count.
- **Duplicate/FK errors**: These are expected during reconnections/out-of-order delivery and are handled idempotently.
- **Backfill slow**: Adjust `BACKFILL_DB_POOL_SIZE`, backfill batch size/delay (see code), or use repo CAR backfill for targeted users.

---

## Related Documents
- `README.md` (Architecture, Quick Start, Environment)
- `PRODUCTION_DEPLOYMENT.md`
- `WEBDID_SETUP.md`
- `server/config/INSTANCE_MODERATION_GUIDE.md`
- `ENDPOINT_ANALYSIS.md`
- `osprey-bridge/README.md`
