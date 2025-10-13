#!/usr/bin/env python3
"""
High-performance AT Protocol Firehose Consumer (Python)

This script connects to the AT Protocol firehose and pushes events to Redis streams.
Based on official atproto examples - uses synchronous approach for simplicity.
"""

import json
import logging
import os
import signal
import sys
import time
from typing import Optional

import redis
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
    Synchronous AT Protocol firehose consumer that pushes to Redis streams.
    Uses sync Redis client for simplicity (no async/sync bridge issues).
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
        
        self.redis_client: Optional[redis.Redis] = None
        self.client: Optional[FirehoseSubscribeReposClient] = None
        self.running = False
        self.current_cursor: Optional[int] = None
        
        # Metrics
        self.event_count = 0
        self.last_event_time = time.time()
        self.start_time = time.time()
        
        # Cursor persistence
        self.last_cursor_save = 0
        self.cursor_save_interval = 5  # seconds
        
    def connect_redis(self) -> None:
        """Connect to Redis."""
        logger.info(f"Connecting to Redis at {self.redis_url}...")
        
        self.redis_client = redis.from_url(
            self.redis_url,
            decode_responses=True,
            socket_keepalive=True,
        )
        
        # Verify connection
        self.redis_client.ping()
        logger.info("Connected to Redis successfully")
        
        # Load saved cursor
        saved_cursor = self.redis_client.get(self.cursor_key)
        if saved_cursor:
            self.current_cursor = int(saved_cursor)
            logger.info(f"Loaded saved cursor: {self.current_cursor}")
        else:
            logger.info("No saved cursor found, starting from current position")
    
    def save_cursor(self, cursor: int) -> None:
        """Save cursor to Redis for restart recovery."""
        self.current_cursor = cursor
        
        # Save periodically to avoid excessive writes
        now = time.time()
        if now - self.last_cursor_save > self.cursor_save_interval:
            self.last_cursor_save = now
            try:
                self.redis_client.set(self.cursor_key, str(cursor))
            except Exception as e:
                logger.error(f"Error saving cursor: {e}")
    
    def push_to_redis(self, event_type: str, data: dict, seq: Optional[int] = None) -> None:
        """Push event to Redis stream."""
        try:
            # Use XADD with MAXLEN to prevent infinite stream growth
            self.redis_client.xadd(
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
    
    def on_message_handler(self, message: firehose_models.MessageFrame) -> None:
        """Handle incoming firehose message."""
        try:
            logger.debug(f"Received message")
            
            commit = parse_subscribe_repos_message(message)
            logger.debug(f"Parsed: {type(commit).__name__}")
            
            # Handle Commit messages (posts, likes, follows, etc.)
            if isinstance(commit, models.ComAtprotoSyncSubscribeRepos.Commit):
                seq = commit.seq
                self.save_cursor(seq)
                
                # Parse the commit operations
                data = {
                    "repo": commit.repo,
                    "ops": [],
                }
                
                # Parse CAR blocks if available
                car = None
                if commit.blocks:
                    try:
                        car = CAR.from_bytes(commit.blocks)
                    except Exception as e:
                        logger.debug(f"Could not parse CAR: {e}")
                
                # Process operations
                for op in commit.ops:
                    op_data = {
                        "action": op.action,
                        "path": op.path,
                    }
                    
                    # Include CID
                    if hasattr(op, 'cid') and op.cid:
                        op_data["cid"] = str(op.cid)
                        
                        # Try to extract record data
                        if car and op.action in ["create", "update"]:
                            try:
                                record_bytes = car.blocks.get(op.cid)
                                if record_bytes:
                                    record = models.get_or_create(record_bytes, strict=False)
                                    if record:
                                        if hasattr(record, 'model_dump'):
                                            op_data["record"] = record.model_dump()
                                        elif hasattr(record, 'dict'):
                                            op_data["record"] = record.dict()
                            except Exception as e:
                                logger.debug(f"Could not extract record: {e}")
                    
                    data["ops"].append(op_data)
                
                logger.debug(f"Pushing commit with {len(data['ops'])} ops")
                self.push_to_redis("commit", data, seq)
                self.last_event_time = time.time()
            
            # Handle Identity messages
            elif isinstance(commit, models.ComAtprotoSyncSubscribeRepos.Identity):
                data = {
                    "did": commit.did,
                    "handle": getattr(commit, 'handle', commit.did),
                }
                seq = getattr(commit, 'seq', None)
                self.push_to_redis("identity", data, seq)
                if seq:
                    self.save_cursor(seq)
                self.last_event_time = time.time()
            
            # Handle Account messages
            elif isinstance(commit, models.ComAtprotoSyncSubscribeRepos.Account):
                data = {
                    "did": commit.did,
                    "active": getattr(commit, 'active', True),
                }
                seq = getattr(commit, 'seq', None)
                self.push_to_redis("account", data, seq)
                if seq:
                    self.save_cursor(seq)
                self.last_event_time = time.time()
            
        except Exception as e:
            logger.error(f"Error handling message: {e}", exc_info=True)
    
    def run(self) -> None:
        """Main run loop."""
        self.running = True
        
        # Connect to Redis
        self.connect_redis()
        
        # Create firehose client
        params = None
        if self.current_cursor:
            params = models.ComAtprotoSyncSubscribeRepos.Params(cursor=self.current_cursor)
            logger.info(f"Resuming from cursor: {self.current_cursor}")
        
        logger.info(f"Connecting to firehose at {self.relay_url}...")
        self.client = FirehoseSubscribeReposClient(params, base_uri=self.relay_url)
        
        logger.info("Connected to firehose successfully")
        logger.info("Starting to listen for events...")
        
        # Start the client (this blocks until stopped)
        self.client.start(self.on_message_handler)
    
    def stop(self) -> None:
        """Gracefully stop the consumer."""
        logger.info("Stopping firehose consumer...")
        self.running = False
        
        # Stop client
        if self.client:
            try:
                self.client.stop()
            except:
                pass
        
        # Save final cursor
        if self.current_cursor and self.redis_client:
            self.redis_client.set(self.cursor_key, str(self.current_cursor))
            logger.info(f"Saved final cursor: {self.current_cursor}")
        
        # Close Redis
        if self.redis_client:
            self.redis_client.close()
        
        # Log final stats
        elapsed = time.time() - self.start_time
        rate = self.event_count / elapsed if elapsed > 0 else 0
        logger.info(
            f"Stopped. Total events: {self.event_count:,} "
            f"(~{rate:.0f} events/sec over {elapsed:.0f}s)"
        )


def main():
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
        logger.info(f"Received signal {signum}, shutting down...")
        consumer.stop()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Run consumer
    try:
        consumer.run()
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received")
        consumer.stop()
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        consumer.stop()
        sys.exit(1)


if __name__ == "__main__":
    main()
