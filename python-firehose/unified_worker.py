#!/usr/bin/env python3
"""
Unified AT Protocol Firehose Worker

This replaces the 32 TypeScript workers with a single Python process that:
1. Connects to the AT Protocol firehose
2. Processes events directly to PostgreSQL
3. Maintains high throughput with async processing

Architecture:
- Firehose → Python Worker → PostgreSQL
- No Redis queue needed (direct processing)
- Async/await for concurrent event handling
"""

import asyncio
import json
import logging
import os
import signal
import sys
import time
from typing import Optional, Any, Dict, List
from datetime import datetime, timezone
from contextlib import asynccontextmanager

import asyncpg
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


class SafeJSONEncoder(json.JSONEncoder):
    """JSON encoder that handles bytes, CIDs, and other non-serializable objects."""
    def default(self, obj):
        if isinstance(obj, bytes):
            return obj.hex()
        if hasattr(obj, '__str__') and not isinstance(obj, (dict, list, tuple)):
            return str(obj)
        try:
            return super().default(obj)
        except TypeError:
            return repr(obj)


class DatabasePool:
    """PostgreSQL connection pool manager"""
    
    def __init__(self, database_url: str, pool_size: int = 20):
        self.database_url = database_url
        self.pool_size = pool_size
        self.pool: Optional[asyncpg.Pool] = None
        
    async def connect(self):
        """Initialize database connection pool"""
        logger.info(f"Creating database pool with {self.pool_size} connections...")
        self.pool = await asyncpg.create_pool(
            self.database_url,
            min_size=10,
            max_size=self.pool_size,
            command_timeout=60,
            max_queries=50000,
            max_inactive_connection_lifetime=300,
        )
        logger.info("Database pool created successfully")
        
    async def close(self):
        """Close database connection pool"""
        if self.pool:
            await self.pool.close()
            logger.info("Database pool closed")
    
    @asynccontextmanager
    async def acquire(self):
        """Acquire a database connection from the pool"""
        if not self.pool:
            raise RuntimeError("Database pool not initialized")
        
        async with self.pool.acquire() as conn:
            yield conn


class EventProcessor:
    """Process AT Protocol events and write to PostgreSQL"""
    
    def __init__(self, db_pool: DatabasePool):
        self.db = db_pool
        self.event_count = 0
        self.start_time = time.time()
        self.pending_user_cache = {}  # Cache for pending user creations
        
    async def ensure_user(self, conn: asyncpg.Connection, did: str) -> bool:
        """Ensure user exists in database, create if needed"""
        try:
            # Check if user exists
            user = await conn.fetchrow(
                "SELECT did FROM users WHERE did = $1",
                did
            )
            
            if not user:
                # Create user with fallback handle
                try:
                    await conn.execute(
                        """
                        INSERT INTO users (did, handle, "createdAt")
                        VALUES ($1, $2, NOW())
                        ON CONFLICT (did) DO NOTHING
                        """,
                        did,
                        'handle.invalid'
                    )
                    logger.debug(f"Created user: {did}")
                except asyncpg.exceptions.UniqueViolationError:
                    # Race condition - user was created by another process
                    pass
            
            return True
        except Exception as e:
            logger.error(f"Error ensuring user {did}: {e}")
            return False
    
    def safe_date(self, value: Optional[str]) -> datetime:
        """Parse date safely, returning current time if invalid"""
        if not value:
            return datetime.now(timezone.utc)
        try:
            dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
            return dt
        except Exception:
            return datetime.now(timezone.utc)
    
    def extract_blob_cid(self, blob: Any) -> Optional[str]:
        """Extract CID from blob reference"""
        if not blob:
            return None
        
        if isinstance(blob, str):
            return blob if blob != 'undefined' else None
        
        # Handle blob.ref field
        if hasattr(blob, 'ref'):
            ref = blob.ref
            if isinstance(ref, str):
                return ref if ref != 'undefined' else None
            if hasattr(ref, '$link'):
                return ref['$link'] if ref['$link'] != 'undefined' else None
            if hasattr(ref, 'toString'):
                return str(ref)
        
        if hasattr(blob, 'cid'):
            return blob.cid if blob.cid != 'undefined' else None
        
        return None
    
    async def process_post(
        self,
        conn: asyncpg.Connection,
        uri: str,
        cid: str,
        author_did: str,
        record: Any
    ):
        """Process post creation"""
        await self.ensure_user(conn, author_did)
        
        text = getattr(record, 'text', '') or ''
        reply = getattr(record, 'reply', None)
        embed = getattr(record, 'embed', None)
        facets = getattr(record, 'facets', None)
        created_at = self.safe_date(getattr(record, 'createdAt', None))
        
        # Serialize embed and facets as JSON
        embed_json = None
        facets_json = None
        
        if embed:
            try:
                if hasattr(embed, 'model_dump'):
                    embed_json = json.dumps(embed.model_dump(), cls=SafeJSONEncoder)
                elif hasattr(embed, 'dict'):
                    embed_json = json.dumps(embed.dict(), cls=SafeJSONEncoder)
            except Exception as e:
                logger.debug(f"Could not serialize embed: {e}")
        
        if facets:
            try:
                if isinstance(facets, list):
                    facets_json = json.dumps([
                        f.model_dump() if hasattr(f, 'model_dump') else f.dict() if hasattr(f, 'dict') else f
                        for f in facets
                    ], cls=SafeJSONEncoder)
            except Exception as e:
                logger.debug(f"Could not serialize facets: {e}")
        
        parent_uri = None
        root_uri = None
        if reply:
            parent_uri = getattr(getattr(reply, 'parent', None), 'uri', None)
            root_uri = getattr(getattr(reply, 'root', None), 'uri', None)
        
        try:
            await conn.execute(
                """
                INSERT INTO posts (uri, cid, "authorDid", text, "parentUri", "rootUri", embed, facets, "createdAt")
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, cid, author_did, text, parent_uri, root_uri, embed_json, facets_json, created_at
            )
            
            # Create post aggregation
            await conn.execute(
                """
                INSERT INTO "postAggregations" ("postUri", "likeCount", "repostCount", "replyCount", "bookmarkCount", "quoteCount")
                VALUES ($1, 0, 0, 0, 0, 0)
                ON CONFLICT ("postUri") DO NOTHING
                """,
                uri
            )
            
            # Create feed item
            await conn.execute(
                """
                INSERT INTO "feedItems" (uri, "postUri", "originatorDid", type, "sortAt", cid, "createdAt")
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, uri, author_did, 'post', created_at, cid, created_at
            )
            
            logger.debug(f"Created post: {uri}")
        except asyncpg.exceptions.UniqueViolationError:
            # Post already exists
            pass
        except Exception as e:
            logger.error(f"Error creating post {uri}: {e}")
    
    async def process_like(
        self,
        conn: asyncpg.Connection,
        uri: str,
        user_did: str,
        post_uri: str,
        created_at: datetime
    ):
        """Process like creation"""
        await self.ensure_user(conn, user_did)
        
        try:
            await conn.execute(
                """
                INSERT INTO likes (uri, "userDid", "postUri", "createdAt")
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, user_did, post_uri, created_at
            )
            
            # Increment like count
            await conn.execute(
                """
                UPDATE "postAggregations"
                SET "likeCount" = "likeCount" + 1
                WHERE "postUri" = $1
                """,
                post_uri
            )
            
            logger.debug(f"Created like: {uri}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating like {uri}: {e}")
    
    async def process_repost(
        self,
        conn: asyncpg.Connection,
        uri: str,
        user_did: str,
        post_uri: str,
        cid: str,
        created_at: datetime
    ):
        """Process repost creation"""
        await self.ensure_user(conn, user_did)
        
        try:
            await conn.execute(
                """
                INSERT INTO reposts (uri, "userDid", "postUri", "createdAt")
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, user_did, post_uri, created_at
            )
            
            # Increment repost count
            await conn.execute(
                """
                UPDATE "postAggregations"
                SET "repostCount" = "repostCount" + 1
                WHERE "postUri" = $1
                """,
                post_uri
            )
            
            # Create feed item
            await conn.execute(
                """
                INSERT INTO "feedItems" (uri, "postUri", "originatorDid", type, "sortAt", cid, "createdAt")
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, post_uri, user_did, 'repost', created_at, cid, created_at
            )
            
            logger.debug(f"Created repost: {uri}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating repost {uri}: {e}")
    
    async def process_follow(
        self,
        conn: asyncpg.Connection,
        uri: str,
        follower_did: str,
        following_did: str,
        created_at: datetime
    ):
        """Process follow creation"""
        await self.ensure_user(conn, follower_did)
        await self.ensure_user(conn, following_did)
        
        try:
            await conn.execute(
                """
                INSERT INTO follows (uri, "followerDid", "followingDid", "createdAt")
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, follower_did, following_did, created_at
            )
            logger.debug(f"Created follow: {uri}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating follow {uri}: {e}")
    
    async def process_profile(
        self,
        conn: asyncpg.Connection,
        did: str,
        record: Any
    ):
        """Process profile update"""
        display_name = getattr(record, 'displayName', None)
        description = getattr(record, 'description', None)
        avatar_cid = self.extract_blob_cid(getattr(record, 'avatar', None))
        banner_cid = self.extract_blob_cid(getattr(record, 'banner', None))
        
        # Serialize full profile record
        profile_json = None
        try:
            if hasattr(record, 'model_dump'):
                profile_json = json.dumps(record.model_dump(), cls=SafeJSONEncoder)
            elif hasattr(record, 'dict'):
                profile_json = json.dumps(record.dict(), cls=SafeJSONEncoder)
        except Exception as e:
            logger.debug(f"Could not serialize profile: {e}")
        
        try:
            await conn.execute(
                """
                INSERT INTO users (did, handle, "displayName", description, "avatarUrl", "bannerUrl", "profileRecord", "createdAt")
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
                ON CONFLICT (did) DO UPDATE SET
                    "displayName" = EXCLUDED."displayName",
                    description = EXCLUDED.description,
                    "avatarUrl" = EXCLUDED."avatarUrl",
                    "bannerUrl" = EXCLUDED."bannerUrl",
                    "profileRecord" = EXCLUDED."profileRecord"
                """,
                did, 'handle.invalid', display_name, description, avatar_cid, banner_cid, profile_json
            )
            logger.debug(f"Updated profile: {did}")
        except Exception as e:
            logger.error(f"Error updating profile {did}: {e}")
    
    async def process_delete(
        self,
        conn: asyncpg.Connection,
        uri: str,
        collection: str
    ):
        """Process record deletion"""
        try:
            if collection == "app.bsky.feed.post":
                await conn.execute("DELETE FROM posts WHERE uri = $1", uri)
                await conn.execute('DELETE FROM "feedItems" WHERE uri = $1', uri)
            elif collection == "app.bsky.feed.like":
                # Get like info before deleting
                like = await conn.fetchrow(
                    'SELECT "userDid", "postUri" FROM likes WHERE uri = $1',
                    uri
                )
                if like:
                    await conn.execute("DELETE FROM likes WHERE uri = $1", uri)
                    await conn.execute(
                        'UPDATE "postAggregations" SET "likeCount" = GREATEST("likeCount" - 1, 0) WHERE "postUri" = $1',
                        like['postUri']
                    )
            elif collection == "app.bsky.feed.repost":
                # Get repost info before deleting
                repost = await conn.fetchrow(
                    'SELECT "userDid", "postUri" FROM reposts WHERE uri = $1',
                    uri
                )
                if repost:
                    await conn.execute("DELETE FROM reposts WHERE uri = $1", uri)
                    await conn.execute('DELETE FROM "feedItems" WHERE uri = $1', uri)
                    await conn.execute(
                        'UPDATE "postAggregations" SET "repostCount" = GREATEST("repostCount" - 1, 0) WHERE "postUri" = $1',
                        repost['postUri']
                    )
            elif collection == "app.bsky.graph.follow":
                await conn.execute("DELETE FROM follows WHERE uri = $1", uri)
            elif collection == "app.bsky.graph.block":
                await conn.execute("DELETE FROM blocks WHERE uri = $1", uri)
            
            logger.debug(f"Deleted {collection}: {uri}")
        except Exception as e:
            logger.error(f"Error deleting {uri}: {e}")
    
    async def process_commit(self, commit: models.ComAtprotoSyncSubscribeRepos.Commit):
        """Process a commit event"""
        repo = commit.repo
        
        # Parse CAR blocks if available
        car = None
        if commit.blocks:
            try:
                car = CAR.from_bytes(commit.blocks)
            except Exception as e:
                logger.debug(f"Could not parse CAR: {e}")
        
        # Acquire database connection
        async with self.db.acquire() as conn:
            # Process operations in a transaction
            async with conn.transaction():
                for op in commit.ops:
                    action = op.action
                    path = op.path
                    collection = path.split("/")[0]
                    uri = f"at://{repo}/{path}"
                    
                    try:
                        if action in ["create", "update"]:
                            # Extract record from CAR blocks
                            if not car or not hasattr(op, 'cid') or not op.cid:
                                continue
                            
                            try:
                                record_bytes = car.blocks.get(op.cid)
                                if not record_bytes:
                                    continue
                                
                                record = models.get_or_create(record_bytes, strict=False)
                                if not record:
                                    continue
                                
                                # Get record type
                                record_type = getattr(record, 'py_type', None)
                                if not record_type:
                                    continue
                                
                                cid = str(op.cid)
                                
                                # Route to appropriate handler
                                if record_type == "app.bsky.feed.post":
                                    await self.process_post(conn, uri, cid, repo, record)
                                elif record_type == "app.bsky.feed.like":
                                    post_uri = getattr(getattr(record, 'subject', None), 'uri', None)
                                    if post_uri:
                                        created_at = self.safe_date(getattr(record, 'createdAt', None))
                                        await self.process_like(conn, uri, repo, post_uri, created_at)
                                elif record_type == "app.bsky.feed.repost":
                                    post_uri = getattr(getattr(record, 'subject', None), 'uri', None)
                                    if post_uri:
                                        created_at = self.safe_date(getattr(record, 'createdAt', None))
                                        await self.process_repost(conn, uri, repo, post_uri, cid, created_at)
                                elif record_type == "app.bsky.graph.follow":
                                    following_did = getattr(record, 'subject', None)
                                    if following_did:
                                        created_at = self.safe_date(getattr(record, 'createdAt', None))
                                        await self.process_follow(conn, uri, repo, following_did, created_at)
                                elif record_type == "app.bsky.actor.profile":
                                    await self.process_profile(conn, repo, record)
                                
                            except Exception as e:
                                logger.debug(f"Error extracting record for {uri}: {e}")
                                continue
                        
                        elif action == "delete":
                            await self.process_delete(conn, uri, collection)
                    
                    except Exception as e:
                        logger.error(f"Error processing {action} {uri}: {e}")
                        continue
        
        self.event_count += 1
        if self.event_count % 1000 == 0:
            elapsed = time.time() - self.start_time
            rate = self.event_count / elapsed if elapsed > 0 else 0
            logger.info(
                f"Processed {self.event_count:,} events "
                f"(~{rate:.0f} events/sec)"
            )


class UnifiedWorker:
    """Unified AT Protocol worker - replaces 32 TypeScript workers"""
    
    def __init__(
        self,
        relay_url: str,
        database_url: str,
        db_pool_size: int = 20,
    ):
        self.relay_url = relay_url
        self.database_url = database_url
        self.db_pool_size = db_pool_size
        
        self.db_pool: Optional[DatabasePool] = None
        self.event_processor: Optional[EventProcessor] = None
        self.client: Optional[FirehoseSubscribeReposClient] = None
        self.running = False
        
        self.event_count = 0
        self.start_time = time.time()
        
    async def initialize(self):
        """Initialize database connection pool"""
        logger.info("Initializing unified worker...")
        
        # Create database pool
        self.db_pool = DatabasePool(self.database_url, self.db_pool_size)
        await self.db_pool.connect()
        
        # Create event processor
        self.event_processor = EventProcessor(self.db_pool)
        
        logger.info("Unified worker initialized")
    
    def on_message_handler(self, message: firehose_models.MessageFrame) -> None:
        """Handle incoming firehose message (sync callback)"""
        try:
            commit = parse_subscribe_repos_message(message)
            
            # Handle Commit messages (posts, likes, follows, etc.)
            if isinstance(commit, models.ComAtprotoSyncSubscribeRepos.Commit):
                # Schedule async processing
                asyncio.create_task(self.event_processor.process_commit(commit))
            
            # TODO: Handle Identity and Account messages if needed
            
        except Exception as e:
            logger.error(f"Error handling message: {e}", exc_info=True)
    
    def run(self):
        """Main run loop"""
        self.running = True
        
        logger.info(f"Connecting to firehose at {self.relay_url}...")
        self.client = FirehoseSubscribeReposClient()
        
        logger.info("Starting to listen for events...")
        
        try:
            self.client.start(self.on_message_handler)
        except Exception as e:
            logger.error(f"Error in client.start(): {e}", exc_info=True)
            raise
    
    async def stop(self):
        """Gracefully stop the worker"""
        logger.info("Stopping unified worker...")
        self.running = False
        
        # Stop client
        if self.client:
            try:
                self.client.stop()
            except:
                pass
        
        # Close database pool
        if self.db_pool:
            await self.db_pool.close()
        
        # Log final stats
        elapsed = time.time() - self.start_time
        rate = self.event_count / elapsed if elapsed > 0 else 0
        logger.info(
            f"Stopped. Total events: {self.event_count:,} "
            f"(~{rate:.0f} events/sec over {elapsed:.0f}s)"
        )


async def main():
    """Main entry point"""
    # Configuration from environment
    relay_url = os.getenv("RELAY_URL", "wss://bsky.network")
    database_url = os.getenv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/atproto")
    db_pool_size = int(os.getenv("DB_POOL_SIZE", "20"))
    
    logger.info("=" * 60)
    logger.info("Unified AT Protocol Worker (Python)")
    logger.info("Replaces 32 TypeScript workers with single process")
    logger.info("=" * 60)
    logger.info(f"Relay URL:      {relay_url}")
    logger.info(f"Database Pool:  {db_pool_size} connections")
    logger.info("=" * 60)
    
    # Create worker
    worker = UnifiedWorker(
        relay_url=relay_url,
        database_url=database_url,
        db_pool_size=db_pool_size,
    )
    
    # Initialize
    await worker.initialize()
    
    # Handle signals for graceful shutdown
    def signal_handler(signum, frame):
        logger.info(f"Received signal {signum}, shutting down...")
        asyncio.create_task(worker.stop())
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Run worker (blocking - runs in event loop)
    try:
        # Run in executor to handle sync callback
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, worker.run)
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received")
        await worker.stop()
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        await worker.stop()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
