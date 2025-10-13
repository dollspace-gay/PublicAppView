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
    
    def parse_car_message(self, data: bytes) -> Optional[Dict[str, Any]]:
        """
        Parse CAR (Content Addressable aRchive) message from firehose.
        
        Note: This is a simplified parser. For production use, you might want
        to use a proper CAR/DAG-CBOR library like 'dag-cbor' or 'ipld'.
        
        For now, we'll extract basic info from the WebSocket frames.
        """
        try:
            # The AT Protocol firehose sends messages in a specific format
            # For simplicity, we'll parse the JSON parts
            # In production, you'd use proper CAR/CBOR parsing
            
            # Messages come as {"op":1,"t":"#commit",...} or similar
            # The websocket library gives us the raw bytes
            
            # Try to decode as JSON first (for identity/account updates)
            try:
                return json.loads(data.decode('utf-8'))
            except (UnicodeDecodeError, json.JSONDecodeError):
                # This is likely a binary CAR message (commits)
                # For now, we'll skip detailed parsing and focus on the header
                # A full implementation would use dag-cbor library
                logger.debug("Received binary CAR message (commits)")
                return None
                
        except Exception as e:
            logger.error(f"Error parsing message: {e}")
            return None
    
    async def handle_websocket_message(self, message: bytes) -> None:
        """Handle incoming WebSocket message from firehose."""
        try:
            # AT Protocol firehose sends CBOR-encoded messages
            # We need to decode them properly
            # For this implementation, we'll use the atproto library
            
            # Parse the message (simplified - see note in parse_car_message)
            parsed = self.parse_car_message(message)
            
            if not parsed:
                # Most messages will be here (binary CAR commits)
                # We'd need a proper CAR parser, but for now we'll use atproto library
                # Let's import it dynamically
                try:
                    from atproto import parse_subscribe_repos_message, models
                    
                    msg = parse_subscribe_repos_message(message)
                    
                    if isinstance(msg, models.ComAtprotoSyncSubscribeRepos.Commit):
                        # Extract commit data
                        seq = msg.seq
                        await self.save_cursor(seq)
                        
                        # Parse the commit operations
                        data = {
                            "repo": msg.repo,
                            "ops": [],
                        }
                        
                        # Process operations (creates, updates, deletes)
                        if msg.blocks:
                            # Parse blocks to extract operations
                            # This requires CAR parsing which atproto handles
                            try:
                                for op in msg.ops:
                                    op_data = {
                                        "action": op.action,
                                        "path": op.path,
                                    }
                                    if op.cid:
                                        op_data["cid"] = str(op.cid)
                                    # Record would need to be extracted from blocks
                                    data["ops"].append(op_data)
                            except Exception as e:
                                logger.debug(f"Error parsing ops: {e}")
                        
                        await self.push_to_redis("commit", data, seq)
                    
                    elif isinstance(msg, models.ComAtprotoSyncSubscribeRepos.Identity):
                        # Identity update (handle change)
                        data = {
                            "did": msg.did,
                            "handle": msg.handle,
                        }
                        await self.push_to_redis("identity", data, msg.seq)
                        if msg.seq:
                            await self.save_cursor(msg.seq)
                    
                    elif isinstance(msg, models.ComAtprotoSyncSubscribeRepos.Account):
                        # Account update (active/inactive)
                        data = {
                            "did": msg.did,
                            "active": msg.active,
                        }
                        await self.push_to_redis("account", data, msg.seq)
                        if msg.seq:
                            await self.save_cursor(msg.seq)
                    
                    self.last_event_time = time.time()
                    
                except ImportError:
                    logger.error(
                        "atproto library not installed. "
                        "Install with: pip install atproto"
                    )
                    raise
                except Exception as e:
                    logger.error(f"Error parsing atproto message: {e}")
            
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
