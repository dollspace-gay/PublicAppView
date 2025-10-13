#!/usr/bin/env python3
"""
High-performance AT Protocol Firehose Consumer (Python)

This script connects to the AT Protocol firehose and pushes events to Redis streams.
It replaces the TypeScript firehose connection to eliminate memory/worker limitations.

Based on official examples:
- https://github.com/MarshalX/atproto/blob/main/examples/firehose/sub_repos.py
- https://github.com/MarshalX/bluesky-feed-generator/blob/main/server/data_stream.py
"""

import asyncio
import json
import logging
import os
import signal
import time
from typing import Optional

import redis.asyncio as aioredis
from atproto import (
    CAR,
    FirehoseSubscribeReposClient,
    firehose_models,
    models,
    parse_subscribe_repos_message,
)

# Configure logging
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, log_level),
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


class FirehoseConsumer:
    """
    Asynchronous AT Protocol firehose consumer that pushes to Redis streams.
    
    Uses the official FirehoseSubscribeReposClient for proper message handling.
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
        self.client: Optional[FirehoseSubscribeReposClient] = None
        self.running = False
        self.current_cursor: Optional[int] = None
        self.loop = None  # Event loop reference for callback
        
        # Metrics
        self.event_count = 0
        self.last_event_time = time.time()
        self.start_time = time.time()
        
        # Cursor persistence
        self.last_cursor_save = 0
        self.cursor_save_interval = 5  # seconds
        
    async def connect_redis(self) -> None:
        """Connect to Redis and ensure stream is set up."""
        logger.info(f"Connecting to Redis at {self.redis_url}...")
        
        self.redis = await aioredis.from_url(
            self.redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_keepalive=True,
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
    
    async def push_to_redis(self, event_type: str, data: dict, seq: Optional[int] = None) -> None:
        """Push event to Redis stream."""
        try:
            if self.event_count == 0:
                logger.info(f"📤 Pushing first event to Redis stream '{self.stream_key}'")
            
            # Use XADD with MAXLEN to prevent infinite stream growth
            result = await self.redis.xadd(
                self.stream_key,
                {
                    "type": event_type,
                    "data": json.dumps(data),
                    "seq": str(seq) if seq else "",
                },
                maxlen=self.max_stream_len,
                approximate=True,
            )
            
            if self.event_count == 0:
                logger.info(f"✅ First event pushed successfully! Stream entry ID: {result}")
            
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
    
    async def handle_message(self, message: firehose_models.MessageFrame) -> None:
        """Handle incoming firehose message."""
        try:
            if self.event_count == 0:
                logger.info("📥 Received first message from firehose!")
            
            logger.debug(f"Received message, parsing...")
            commit = parse_subscribe_repos_message(message)
            logger.debug(f"Parsed commit type: {type(commit).__name__}")
            
            # Handle Commit messages (posts, likes, follows, etc.)
            if isinstance(commit, models.ComAtprotoSyncSubscribeRepos.Commit):
                seq = commit.seq
                await self.save_cursor(seq)
                
                # Parse the commit operations
                data = {
                    "repo": commit.repo,
                    "ops": [],
                }
                
                # Parse CAR blocks if available for full record data
                car = None
                if commit.blocks:
                    try:
                        car = CAR.from_bytes(commit.blocks)
                    except Exception as e:
                        logger.debug(f"Could not parse CAR blocks: {e}")
                
                # Process operations
                for op in commit.ops:
                    op_data = {
                        "action": op.action,
                        "path": op.path,
                    }
                    
                    # Include CID
                    if hasattr(op, 'cid') and op.cid:
                        op_data["cid"] = str(op.cid)
                        
                        # Try to extract record data from CAR blocks
                        if car and op.action in ["create", "update"]:
                            try:
                                record_bytes = car.blocks.get(op.cid)
                                if record_bytes:
                                    # Use models.get_or_create to parse the record
                                    record = models.get_or_create(record_bytes, strict=False)
                                    if record:
                                        # Convert to dict for JSON serialization
                                        if hasattr(record, 'model_dump'):
                                            op_data["record"] = record.model_dump()
                                        elif hasattr(record, 'dict'):
                                            op_data["record"] = record.dict()
                            except Exception as e:
                                logger.debug(f"Could not extract record for {op.path}: {e}")
                    
                    data["ops"].append(op_data)
                
                logger.debug(f"Pushing commit to Redis: {len(data['ops'])} ops")
                await self.push_to_redis("commit", data, seq)
                self.last_event_time = time.time()
                logger.debug(f"Successfully pushed commit seq={seq}")
            
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
            
        except Exception as e:
            logger.error(f"Error handling message: {e}")
    
    def _sync_callback(self, message: firehose_models.MessageFrame) -> bool:
        """Synchronous callback that schedules async message handling.
        
        Returns:
            bool: True to continue receiving messages, False to stop.
        """
        if not self.running:
            return False
            
        try:
            # Create a future in the event loop
            future = asyncio.run_coroutine_threadsafe(
                self.handle_message(message),
                self.loop
            )
            # Wait for it with a timeout to prevent blocking
            future.result(timeout=10)
            return True  # Continue receiving messages
        except Exception as e:
            logger.error(f"Error in callback: {e}", exc_info=True)
            return self.running  # Continue if still running, otherwise stop
    
    async def run(self) -> None:
        """Main run loop."""
        self.running = True
        self.loop = asyncio.get_running_loop()
        
        # Connect to Redis
        await self.connect_redis()
        
        # Main reconnection loop
        while self.running:
            try:
                # Create firehose client with cursor if available
                params = None
                if self.current_cursor:
                    params = models.ComAtprotoSyncSubscribeRepos.Params(cursor=self.current_cursor)
                    logger.info(f"Resuming from cursor: {self.current_cursor}")
                
                logger.info(f"Connecting to firehose at {self.relay_url}...")
                self.client = FirehoseSubscribeReposClient(params, base_uri=self.relay_url)
                
                logger.info("Connected to firehose successfully")
                logger.info("Starting message processing...")
                logger.info("⏳ Waiting for messages from firehose...")
                
                # Run the blocking start() in a thread pool
                await asyncio.to_thread(self.client.start, self._sync_callback)
                
                logger.warning("Client stopped receiving messages (this is unusual)")
                    
            except Exception as e:
                logger.error(f"Firehose error: {e}", exc_info=True)
                if self.running:
                    logger.info("Reconnecting in 5 seconds...")
                    await asyncio.sleep(5)
                else:
                    break
    
    async def stop(self) -> None:
        """Gracefully stop the consumer."""
        logger.info("Stopping firehose consumer...")
        self.running = False
        
        # Stop the firehose client
        if self.client:
            try:
                self.client.stop()
            except Exception as e:
                logger.debug(f"Error stopping client: {e}")
        
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
