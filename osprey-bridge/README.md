# Osprey Bridge

This directory contains bridge services that connect the AT Protocol firehose to Kafka for Osprey consumption.

## Components

### Firehose-to-Kafka Bridge

Ingests events from multiple sources, enriches them with user profile metadata, and publishes to Kafka for Osprey processing.

**Input Adapters:**
- **FirehoseAdapter**: Direct connection to AT Protocol firehose (`wss://bsky.network`)
- **RedisAdapter**: Consumes from existing Redis stream (reuses main app's queue)
- **DirectAdapter**: In-process event delivery (zero latency, no serialization overhead)

**Features:**
- Pluggable input sources via ADAPTER_TYPE environment variable
- Event enrichment with user handles and profile data
- Kafka publishing with GZIP compression
- Cursor persistence for firehose adapter
- Graceful shutdown and recovery

**Event Enrichment:**
- Queries PostgreSQL for user profiles (handle, displayName, follower/post counts)
- Caches results for 1 minute to reduce database load
- Optional - can be disabled via environment variables

## Usage

### Enable Osprey Integration

```bash
# Start with Osprey profile enabled (default: firehose adapter)
OSPREY_ENABLED=true docker-compose --profile osprey up -d

# Use Redis adapter to consume from existing queue
OSPREY_ENABLED=true OSPREY_ADAPTER_TYPE=redis docker-compose --profile osprey up -d

# Or set in .env file
echo "OSPREY_ENABLED=true" >> .env
echo "OSPREY_ADAPTER_TYPE=redis" >> .env
docker-compose --profile osprey up -d
```

### Adapter Selection

**Firehose Adapter** (default):
- Independent firehose connection with own cursor
- Best for: Dedicated Osprey instances
```bash
OSPREY_ADAPTER_TYPE=firehose
```

**Redis Adapter**:
- Reuses existing Redis stream from main app
- No duplicate firehose connection
- Best for: Multi-worker deployments, resource efficiency
```bash
OSPREY_ADAPTER_TYPE=redis
```

**Direct Adapter**:
- In-process event delivery (requires code integration)
- Zero latency, no queue overhead
- Best for: Single-instance deployments, tight integration
```bash
OSPREY_ADAPTER_TYPE=direct
```

### Disable Osprey Integration

```bash
# Run without osprey profile (default behavior)
docker-compose up -d
```

## Architecture

```
Input Sources (3 options):
├─ AT Protocol Firehose (wss://bsky.network) [FirehoseAdapter]
├─ Redis Stream (firehose:events) [RedisAdapter]
└─ Direct In-Process Events [DirectAdapter]
  ↓
Pluggable Input Adapter
  ↓
Firehose-to-Kafka Bridge
  ├─ Event Enricher (queries PostgreSQL)
  ├─ Kafka Producer (publishes enriched events)
  └─ Cursor Persistence (firehose only)
  ↓
Kafka Topic: atproto.firehose.enriched
  ↓
Osprey (processes events and generates labels)
  ↓
Kafka Topic: osprey.labels
  ↓
Label Effector ✅ Phase 4 Complete
  ├─ Kafka Consumer (consumes label events)
  ├─ Label Validator (validates AT Protocol format)
  └─ Database Writer (applies to PostgreSQL)
  ↓
AppView Label Service (labels available via XRPC)
```

## Environment Variables

See `firehose-to-kafka/.env.example` for all configuration options.

### Key Variables:

**Adapter Selection:**
- `ADAPTER_TYPE`: Input source (`firehose`, `redis`, or `direct`, default: `firehose`)

**Firehose Adapter:**
- `RELAY_URL`: Firehose WebSocket URL (default: `wss://bsky.network`)
- `FIREHOSE_CURSOR_FILE`: Cursor persistence file (default: `/data/osprey-cursor.txt`)

**Redis Adapter:**
- `REDIS_URL`: Redis connection string (default: `redis://redis:6379`)
- `REDIS_STREAM_KEY`: Redis stream name (default: `firehose:events`)
- `REDIS_CONSUMER_GROUP`: Consumer group name (default: `osprey-consumers`)

**Kafka:**
- `KAFKA_BROKERS`: Kafka broker addresses (default: `kafka:9092`)
- `KAFKA_TOPIC`: Kafka topic name (default: `atproto.firehose.enriched`)

**Enrichment:**
- `DATABASE_URL`: PostgreSQL connection for enrichment
- `ENRICH_WITH_PROFILES`: Enable profile enrichment (default: `true`)
- `ENRICH_WITH_HANDLES`: Enable handle enrichment (default: `true`)

## Monitoring

View bridge logs:
```bash
docker-compose logs -f osprey-bridge
```

Check Kafka topics:
```bash
docker-compose exec kafka kafka-topics --list --bootstrap-server localhost:9092
```

View Kafka messages:
```bash
docker-compose exec kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic atproto.firehose.enriched \
  --from-beginning \
  --max-messages 10
```

## Development

To develop the bridge locally:

```bash
cd osprey-bridge/firehose-to-kafka
npm install
npm run dev
```

### Label Effector

Consumes moderation labels from Osprey and applies them to the AppView's label system.

**Features:**
- Kafka consumer for `osprey.labels` topic
- AT Protocol label format validation (com.atproto.label.defs#label)
- Automatic label application via PostgreSQL
- Support for label negation (undoing previously applied labels)
- Health monitoring on port 3002
- Real-time label event broadcasting

**Environment Variables:**
- `KAFKA_LABEL_TOPIC`: Kafka topic for labels (default: `osprey.labels`)
- `OSPREY_LABELER_DID`: DID of Osprey labeler service
- `DATABASE_URL`: PostgreSQL connection for AppView

## Phase Completion

- **Phase 1**: ✅ Complete - Firehose-to-Kafka bridge with event enrichment
- **Phase 2**: ✅ Complete - Input stream customization (FirehoseAdapter, RedisAdapter, DirectAdapter)
- **Phase 3**: ✅ Complete - Drop-in auto-detection with health monitoring
- **Phase 4**: ✅ Complete - Label effector (apply Osprey labels to AppView)
