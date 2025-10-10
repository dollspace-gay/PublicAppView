#!/usr/bin/env bash
# Quick Redis stream diagnostics for firehose
set -euo pipefail

REDIS_CLI=${REDIS_CLI:-redis-cli}
STREAM=${STREAM:-firehose:events}
GROUP=${GROUP:-firehose-processors}
DLQ=${DLQ:-firehose:dead-letters}

header() { echo -e "\n==== $1 ===="; }

# Basic info
header "Basic info"
$REDIS_CLI PING || { echo "redis-cli cannot connect"; exit 1; }

# Stream sizes
header "Stream sizes"
$REDIS_CLI XLEN "$STREAM" | awk '{print "XLEN "$0}'
$REDIS_CLI XLEN "$DLQ" | awk '{print "DLQ XLEN "$0}'

# Group info and XPENDING summary
header "Group info"
$REDIS_CLI XINFO GROUPS "$STREAM" || true

header "XPENDING summary"
$REDIS_CLI XPENDING "$STREAM" "$GROUP" || true

header "Top consumers by pending"
# Show per-consumer pending list, top 10
mapfile -t CONSUMERS < <($REDIS_CLI XINFO CONSUMERS "$STREAM" "$GROUP" | awk '/name/{print $2}' || true)
for c in "${CONSUMERS[@]}"; do
  cnt=$($REDIS_CLI XPENDING "$STREAM" "$GROUP" - + 100 $c 2>/dev/null | wc -l | tr -d ' ')
  echo "$cnt $c"
done | sort -rn | head -10

header "Oldest pending (10)"
$REDIS_CLI XPENDING "$STREAM" "$GROUP" - + 10 || true

header "Recent DLQ entries (5)"
$REDIS_CLI XREVRANGE "$DLQ" + - COUNT 5 || true

cat <<EOF

Hints:
- If XLEN >> XPENDING, producers are outpacing consumers but acks are happening.
- If XPENDING grows continually, consumers are failing to ack; inspect logs for errors.
- High per-consumer pending suggests a stuck consumer; consider restart or XCLAIM.
- Many DLQ entries means poison messages; inspect /api/redis/dead-letters.
EOF
