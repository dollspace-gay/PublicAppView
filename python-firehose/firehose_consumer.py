#!/usr/bin/env python3
"""
High-performance AT Protocol Firehose Consumer (Python)

This script connects to the AT Protocol firehose and pushes events to Redis streams.
It replaces the TypeScript firehose connection to eliminate memory/worker limitations.

Key advantages over TypeScript:
- True async I/O with asyncio (no event loop blocking)
- Better memory management (no V8 heap limits)
- No need for worker processes - single process handles full firehose throughput
- Native multithreading for Redis operations

The existing TypeScript workers continue to consume from Redis unchanged.
"""

import asyncio
import json
import logging
import os
import signal
import sys
import time
from datetime import datetime
from typing import Optional, Dict, Any

import websockets
import redis.asyncio as aioredis
from websockets.client import WebSocketClientProtocol
from websockets.exceptions import WebSocketException

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


class FirehoseConsumer:
    """
    Asynchronous AT Protocol firehose consumer that pushes to Redis streams.
    
    This is a drop-in replacement for the TypeScript firehose connection,
    designed to eliminate worker overhead and memory limitations.
    """
    
    def __init__(
        self,
        relay_url: str = "wss://bsky.network",
        redis_url: str = "redis://localhost:6379",
        stream_key: str = "firehose:events",
        cursor_key: str = "firehose:cursor",
        max_stream_len: int = 500000,
    ):
        self.relay_url = relay_url
        self.redis_url = redis_url
        self.stream_key = stream_key
        self.cursor_key = cursor_key
        self.max_stream_len = max_stream_len
        
        self.redis: Optional[aioredis.Redis] = None
        self.websocket: Optional[WebSocketClientProtocol] = None
        self.running = False
        self.current_cursor: Optional[int] = None
        
        # Metrics
        self.event_count = 0
        self.last_event_time = time.time()
        self.start_time = time.time()
        
        # Cursor persistence
        self.last_cursor_save = 0
        self.cursor_save_interval = 5  # seconds
        
        # Reconnection
        self.reconnect_delay = 1
        self.max_reconnect_delay = 30
        
    async def connect_redis(self) -> None:
        """Connect to Redis and ensure stream is set up."""
        logger.info(f"Connecting to Redis at {self.redis_url}...")
        
        self.redis = await aioredis.from_url(
            self.redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_keepalive=True,
            # Note: socket_keepalive_options removed for compatibility
            # Basic keepalive is sufficient for Docker networking
        )
        
        # Verify connection
        await self.redis.ping()
        logger.info("Connected to Redis successfully")
        
        # Load saved cursor
        saved_cursor = await self.redis.get(self.cursor_key)
        if saved_cursor:
            self.current_cursor = int(saved_cursor)
            logger.info(f"Loaded saved cursor: {self.current_cursor}")
        else:
            logger.info("No saved cursor found, starting from current position")
    
    async def save_cursor(self, cursor: int) -> None:
        """Save cursor to Redis for restart recovery."""
        self.current_cursor = cursor
        
        # Save periodically to avoid excessive writes
        now = time.time()
        if now - self.last_cursor_save > self.cursor_save_interval:
            self.last_cursor_save = now
            try:
                await self.redis.set(self.cursor_key, str(cursor))
            except Exception as e:
                logger.error(f"Error saving cursor: {e}")
    
    async def push_to_redis(self, event_type: str, data: Dict[str, Any], seq: Optional[int] = None) -> None:
        """
        Push event to Redis stream.
        
        Uses the same format as the TypeScript firehose service so existing
        TypeScript consumers don't need any changes.
        """
        try:
            # Use XADD with MAXLEN to prevent infinite stream growth
            # The ~ makes it approximate trimming (more efficient)
            await self.redis.xadd(
                self.stream_key,
                {
                    "type": event_type,
                    "data": json.dumps(data),
                    "seq": str(seq) if seq else "",
                },
                maxlen=self.max_stream_len,
                approximate=True,
            )
            
            self.event_count += 1
            
            # Log progress every 1000 events
            if self.event_count % 1000 == 0:
                elapsed = time.time() - self.start_time
                rate = self.event_count / elapsed if elapsed > 0 else 0
                logger.info(
                    f"Processed {self.event_count:,} events "
                    f"(~{rate:.0f} events/sec, cursor: {self.current_cursor})"
                )
                
        except Exception as e:
            logger.error(f"Error pushing to Redis: {e}")
            raise
    
    async def handle_websocket_message(self, message: bytes) -> None:
        """Handle incoming WebSocket message from firehose."""
        try:
            # Import atproto library for message parsing
            # Based on: https://gist.github.com/stuartlangridge/20ffe860fee0ecc315d3878c1ea77c35
            from atproto import parse_subscribe_repos_message, models, CAR
            from atproto.xrpc_client.models.utils import get_or_create
            
            try:
                # Parse the binary message using atproto SDK
                commit = parse_subscribe_repos_message(message)
                
                # Handle Commit messages (posts, likes, follows, etc.)
                if isinstance(commit, models.ComAtprotoSyncSubscribeRepos.Commit):
                    seq = commit.seq
                    await self.save_cursor(seq)
                    
                    # Parse CAR (Content Addressable aRchive) from commit blocks
                    # This contains the actual record data
                    car = CAR.from_bytes(commit.blocks)
                    
                    # Parse the commit operations
                    data = {
                        "repo": commit.repo,
                        "ops": [],
                    }
                    
                    # Process operations (creates, updates, deletes)
                    for op in commit.ops:
                        op_data = {
                            "action": op.action,
                            "path": op.path,
                        }
                        
                        # For creates/updates, extract the actual record from CAR blocks
                        if op.action in ["create", "update"] and op.cid:
                            op_data["cid"] = str(op.cid)
                            
                            try:
                                # Get raw record data from CAR blocks
                                raw_record = car.blocks.get(op.cid)
                                if raw_record:
                                    # Decode the record using atproto's get_or_create
                                    # strict=False allows parsing without full validation
                                    record = get_or_create(raw_record, strict=False)
                                    
                                    # Convert record to dict for JSON serialization
                                    # Use model_dump() if available (pydantic v2), else dict()
                                    if hasattr(record, 'model_dump'):
                                        op_data["record"] = record.model_dump()
                                    elif hasattr(record, 'dict'):
                                        op_data["record"] = record.dict()
                                    else:
                                        # Fallback: convert to dict manually
                                        op_data["record"] = dict(raw_record) if isinstance(raw_record, dict) else raw_record
                            except Exception as e:
                                # If record parsing fails, log but continue with just metadata
                                logger.debug(f"Could not parse record for {op.path}: {e}")
                        
                        data["ops"].append(op_data)
                    
                    await self.push_to_redis("commit", data, seq)
                    self.last_event_time = time.time()
                
                # Handle Identity messages (handle changes)
                elif isinstance(commit, models.ComAtprotoSyncSubscribeRepos.Identity):
                    data = {
                        "did": commit.did,
                        "handle": getattr(commit, 'handle', commit.did),
                    }
                    seq = getattr(commit, 'seq', None)
                    await self.push_to_redis("identity", data, seq)
                    if seq:
                        await self.save_cursor(seq)
                    self.last_event_time = time.time()
                
                # Handle Account messages (active/inactive)
                elif isinstance(commit, models.ComAtprotoSyncSubscribeRepos.Account):
                    data = {
                        "did": commit.did,
                        "active": getattr(commit, 'active', True),
                    }
                    seq = getattr(commit, 'seq', None)
                    await self.push_to_redis("account", data, seq)
                    if seq:
                        await self.save_cursor(seq)
                    self.last_event_time = time.time()
                
                else:
                    # Handle or tombstone messages - just log for now
                    logger.debug(f"Received message type: {type(commit).__name__}")
                
            except Exception as e:
                logger.error(f"Error parsing atproto message: {e}")
                # Only log full traceback at debug level to avoid log spam
                logger.debug(f"Message type: {type(message)}, length: {len(message)}", exc_info=True)
            
        except ImportError as e:
            logger.error(
                f"atproto library not installed or missing component: {e}. "
                "Install with: pip install atproto"
            )
            raise
        except Exception as e:
            logger.error(f"Error handling message: {e}")
    
    async def connect_websocket(self) -> None:
        """Connect to AT Protocol firehose WebSocket."""
        # Build WebSocket URL
        ws_url = f"{self.relay_url}/xrpc/com.atproto.sync.subscribeRepos"
        
        # Add cursor parameter if resuming
        if self.current_cursor:
            ws_url += f"?cursor={self.current_cursor}"
            logger.info(f"Resuming from cursor: {self.current_cursor}")
        
        logger.info(f"Connecting to firehose at {ws_url}...")
        
        try:
            async with websockets.connect(
                ws_url,
                ping_interval=30,  # Send ping every 30s to keep connection alive
                ping_timeout=45,   # Expect pong within 45s
                max_size=10 * 1024 * 1024,  # 10MB max message size
                compression=None,  # Disable compression for lower latency
            ) as websocket:
                self.websocket = websocket
                logger.info("Connected to firehose successfully")
                
                # Reset reconnect delay on successful connection
                self.reconnect_delay = 1
                
                # Receive and process messages
                async for message in websocket:
                    if not self.running:
                        break
                    
                    if isinstance(message, bytes):
                        await self.handle_websocket_message(message)
                    else:
                        logger.warning(f"Received unexpected text message: {message[:100]}")
                        
        except WebSocketException as e:
            logger.error(f"WebSocket error: {e}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
            raise
    
    async def run(self) -> None:
        """Main run loop with automatic reconnection."""
        self.running = True
        
        # Connect to Redis
        await self.connect_redis()
        
        # Main loop with reconnection logic
        while self.running:
            try:
                await self.connect_websocket()
            except Exception as e:
                if not self.running:
                    break
                
                logger.error(f"Connection lost: {e}")
                logger.info(f"Reconnecting in {self.reconnect_delay}s...")
                
                await asyncio.sleep(self.reconnect_delay)
                
                # Exponential backoff
                self.reconnect_delay = min(
                    self.reconnect_delay * 2,
                    self.max_reconnect_delay
                )
    
    async def stop(self) -> None:
        """Gracefully stop the consumer."""
        logger.info("Stopping firehose consumer...")
        self.running = False
        
        # Close WebSocket
        if self.websocket:
            await self.websocket.close()
        
        # Save final cursor
        if self.current_cursor and self.redis:
            await self.redis.set(self.cursor_key, str(self.current_cursor))
            logger.info(f"Saved final cursor: {self.current_cursor}")
        
        # Close Redis
        if self.redis:
            await self.redis.aclose()
        
        # Log final stats
        elapsed = time.time() - self.start_time
        rate = self.event_count / elapsed if elapsed > 0 else 0
        logger.info(
            f"Stopped. Total events: {self.event_count:,} "
            f"(~{rate:.0f} events/sec over {elapsed:.0f}s)"
        )


async def main():
    """Main entry point."""
    # Configuration from environment
    relay_url = os.getenv("RELAY_URL", "wss://bsky.network")
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    stream_key = os.getenv("REDIS_STREAM_KEY", "firehose:events")
    cursor_key = os.getenv("REDIS_CURSOR_KEY", "firehose:python_cursor")
    max_stream_len = int(os.getenv("REDIS_MAX_STREAM_LEN", "500000"))
    
    logger.info("=" * 60)
    logger.info("AT Protocol Firehose Consumer (Python)")
    logger.info("=" * 60)
    logger.info(f"Relay URL:         {relay_url}")
    logger.info(f"Redis URL:         {redis_url}")
    logger.info(f"Stream Key:        {stream_key}")
    logger.info(f"Cursor Key:        {cursor_key}")
    logger.info(f"Max Stream Length: {max_stream_len:,}")
    logger.info("=" * 60)
    
    # Create consumer
    consumer = FirehoseConsumer(
        relay_url=relay_url,
        redis_url=redis_url,
        stream_key=stream_key,
        cursor_key=cursor_key,
        max_stream_len=max_stream_len,
    )
    
    # Handle signals for graceful shutdown
    loop = asyncio.get_event_loop()
    
    def signal_handler(signum, frame):
        logger.info(f"Received signal {signum}, initiating graceful shutdown...")
        asyncio.create_task(consumer.stop())
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Run consumer
    try:
        await consumer.run()
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received")
    finally:
        await consumer.stop()


if __name__ == "__main__":
    asyncio.run(main())
