#!/usr/bin/env python3
"""
Unified AT Protocol Firehose Worker

This replaces the 32 TypeScript workers with a single Python process that:
1. Connects to the AT Protocol firehose
2. Processes events directly to PostgreSQL
3. Maintains high throughput with async processing
4. Matches feature parity with event-processor.ts

Architecture:
- Firehose → Python Worker → PostgreSQL
- No Redis queue needed (direct processing)
- Async/await for concurrent event handling
- Pending operations queue for missing dependencies
- Notification creation for social interactions
- Metrics tracking and TTL sweeper
"""

import asyncio
import json
import logging
import os
import re
import signal
import sys
import time
from typing import Optional, Any, Dict, List, Set
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from collections import defaultdict

import asyncpg
from atproto import (
    CAR,
    FirehoseSubscribeReposClient,
    firehose_models,
    models,
    parse_subscribe_repos_message,
)

# Import new services for full parity with TypeScript
from did_resolver import did_resolver
from pds_data_fetcher import PDSDataFetcher
from label_service import LabelService


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


def sanitize_text(text: Optional[str]) -> Optional[str]:
    """Remove null bytes from text"""
    if not text:
        return None
    return text.replace('\x00', '')


def sanitize_required_text(text: Optional[str]) -> str:
    """Remove null bytes from required text"""
    if not text:
        return ''
    return text.replace('\x00', '')


class DatabasePool:
    """PostgreSQL connection pool manager"""
    
    def __init__(self, database_url: str, pool_size: int = 20):
        self.database_url = database_url
        self.pool_size = pool_size
        self.pool: Optional[asyncpg.Pool] = None
        
    async def connect(self):
        """Initialize database connection pool with retry logic for schema initialization"""
        logger.info(f"Creating database pool with {self.pool_size} connections...")
        
        # Retry logic to wait for database schema to be created
        max_retries = 30
        retry_delay = 2  # seconds
        
        for attempt in range(max_retries):
            try:
                self.pool = await asyncpg.create_pool(
                    self.database_url,
                    min_size=10,
                    max_size=self.pool_size,
                    command_timeout=60,
                    max_queries=50000,
                    max_inactive_connection_lifetime=300,
                )
                
                # Verify schema exists by checking for users table
                async with self.pool.acquire() as conn:
                    await conn.fetchval("SELECT COUNT(*) FROM users LIMIT 1")
                
                logger.info("Database pool created successfully and schema verified")
                return
                
            except asyncpg.exceptions.UndefinedTableError:
                logger.warning(f"Database schema not ready (attempt {attempt + 1}/{max_retries}). Waiting for schema creation...")
                if self.pool:
                    await self.pool.close()
                    self.pool = None
                if attempt < max_retries - 1:
                    await asyncio.sleep(retry_delay)
                else:
                    logger.error("Database schema not created after maximum retries. Ensure the 'app' service has completed migrations.")
                    raise
            except Exception as e:
                logger.error(f"Error creating database pool (attempt {attempt + 1}/{max_retries}): {e}")
                if self.pool:
                    await self.pool.close()
                    self.pool = None
                if attempt < max_retries - 1:
                    await asyncio.sleep(retry_delay)
                else:
                    raise
        
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
    """Process AT Protocol events and write to PostgreSQL with feature parity to event-processor.ts"""
    
    def __init__(self, db_pool: DatabasePool):
        self.db = db_pool
        self.event_count = 0
        self.start_time = time.time()
        
        # Initialize services (matches TypeScript implementation)
        self.pds_data_fetcher = None  # Will be initialized async
        self.label_service = None  # Will be initialized async
        self.skip_pds_fetching = False  # Flag to disable PDS fetching during bulk operations
        
        # Pending operations (matches TypeScript implementation)
        self.pending_ops: Dict[str, List[Dict[str, Any]]] = defaultdict(list)  # postUri -> pending likes/reposts
        self.pending_op_index: Dict[str, str] = {}  # opUri -> postUri
        self.pending_user_ops: Dict[str, List[Dict[str, Any]]] = defaultdict(list)  # userDid -> pending follows/blocks
        self.pending_user_op_index: Dict[str, str] = {}  # opUri -> userDid
        self.pending_list_items: Dict[str, List[Dict[str, Any]]] = defaultdict(list)  # listUri -> pending list items
        self.pending_list_item_index: Dict[str, str] = {}  # itemUri -> listUri
        self.pending_user_creation_ops: Dict[str, List[Dict[str, Any]]] = defaultdict(list)  # did -> ops waiting for user creation
        
        # TTL and metrics
        self.TTL_MS = 24 * 60 * 60 * 1000  # 24 hours
        self.total_pending_count = 0
        self.total_pending_user_ops = 0
        self.total_pending_list_items = 0
        self.total_pending_user_creation_ops = 0
        
        # Concurrent user creation limiting to prevent connection pool exhaustion
        self.pending_user_creations: Dict[str, asyncio.Task] = {}  # did -> pending task (for deduplication)
        self.active_user_creations = 0
        self.MAX_CONCURRENT_USER_CREATIONS = int(os.getenv('MAX_CONCURRENT_USER_CREATIONS', '10'))
        
        # Data collection forbidden cache
        self.data_collection_cache: Dict[str, bool] = {}
        self.cache_clear_time = time.time()
        self.CACHE_CLEAR_INTERVAL = 5 * 60  # 5 minutes
        
        # Metrics
        self.metrics = {
            'pending_queued': 0,
            'pending_flushed': 0,
            'pending_expired': 0,
            'pending_user_ops_queued': 0,
            'pending_user_ops_flushed': 0,
            'pending_user_ops_expired': 0,
            'pending_list_items_queued': 0,
            'pending_list_items_flushed': 0,
            'pending_list_items_expired': 0,
            'pending_user_creation_ops_queued': 0,
            'pending_user_creation_ops_flushed': 0,
            'pending_user_creation_ops_expired': 0,
        }
        
        # User creation tracking
        self.user_creation_count = 0
        self.USER_BATCH_LOG_SIZE = 5000
        
        # Start TTL sweeper
        self.start_ttl_sweeper()
        
    def start_ttl_sweeper(self):
        """Start background task to sweep expired operations"""
        async def sweep_loop():
            while True:
                try:
                    await asyncio.sleep(60)  # Run every minute
                    await self.sweep_expired_ops()
                except Exception as e:
                    logger.error(f"Error in TTL sweeper: {e}")
        
        asyncio.create_task(sweep_loop())
    
    async def sweep_expired_ops(self):
        """Sweep expired pending operations"""
        now = time.time() * 1000  # Convert to milliseconds
        expired = 0
        expired_user_ops = 0
        expired_list_items = 0
        
        # Sweep pending likes/reposts
        for post_uri in list(self.pending_ops.keys()):
            ops = self.pending_ops[post_uri]
            valid_ops = [op for op in ops if (now - op['enqueued_at']) <= self.TTL_MS]
            removed = len(ops) - len(valid_ops)
            
            if removed > 0:
                expired += removed
                for op in ops:
                    if op not in valid_ops:
                        self.pending_op_index.pop(op['uri'], None)
            
            if valid_ops:
                self.pending_ops[post_uri] = valid_ops
            else:
                del self.pending_ops[post_uri]
        
        # Sweep pending user ops
        for user_did in list(self.pending_user_ops.keys()):
            ops = self.pending_user_ops[user_did]
            valid_ops = [op for op in ops if (now - op['enqueued_at']) <= self.TTL_MS]
            removed = len(ops) - len(valid_ops)
            
            if removed > 0:
                expired_user_ops += removed
                for op in ops:
                    if op not in valid_ops:
                        self.pending_user_op_index.pop(op['uri'], None)
            
            if valid_ops:
                self.pending_user_ops[user_did] = valid_ops
            else:
                del self.pending_user_ops[user_did]
        
        # Sweep pending list items
        for list_uri in list(self.pending_list_items.keys()):
            items = self.pending_list_items[list_uri]
            valid_items = [item for item in items if (now - item['enqueued_at']) <= self.TTL_MS]
            removed = len(items) - len(valid_items)
            
            if removed > 0:
                expired_list_items += removed
                for item in items:
                    if item not in valid_items:
                        self.pending_list_item_index.pop(item['uri'], None)
            
            if valid_items:
                self.pending_list_items[list_uri] = valid_items
            else:
                del self.pending_list_items[list_uri]
        
        # Sweep pending user creation ops
        expired_user_creation_ops = 0
        for did in list(self.pending_user_creation_ops.keys()):
            ops = self.pending_user_creation_ops[did]
            valid_ops = [op for op in ops if (now - op['enqueued_at']) <= self.TTL_MS]
            removed = len(ops) - len(valid_ops)
            
            if removed > 0:
                expired_user_creation_ops += removed
            
            if valid_ops:
                self.pending_user_creation_ops[did] = valid_ops
            else:
                del self.pending_user_creation_ops[did]
        
        # Update metrics and counts
        if expired > 0:
            self.total_pending_count -= expired
            self.metrics['pending_expired'] += expired
            logger.info(f"[TTL_SWEEPER] Expired {expired} pending operations")
        
        if expired_user_ops > 0:
            self.total_pending_user_ops -= expired_user_ops
            self.metrics['pending_user_ops_expired'] += expired_user_ops
            logger.info(f"[TTL_SWEEPER] Expired {expired_user_ops} pending user operations")
        
        if expired_list_items > 0:
            self.total_pending_list_items -= expired_list_items
            self.metrics['pending_list_items_expired'] += expired_list_items
            logger.info(f"[TTL_SWEEPER] Expired {expired_list_items} pending list items")
        
        if expired_user_creation_ops > 0:
            self.total_pending_user_creation_ops -= expired_user_creation_ops
            self.metrics['pending_user_creation_ops_expired'] += expired_user_creation_ops
            logger.info(f"[TTL_SWEEPER] Expired {expired_user_creation_ops} pending user creation operations")
    
    def enqueue_pending_op(self, post_uri: str, op_data: Dict[str, Any]):
        """Enqueue pending like/repost when post doesn't exist"""
        op_uri = op_data['uri']
        
        # Check for duplicates
        if op_uri in self.pending_op_index:
            return
        
        self.pending_ops[post_uri].append(op_data)
        self.pending_op_index[op_uri] = post_uri
        self.total_pending_count += 1
        self.metrics['pending_queued'] += 1
        logger.debug(f"[PENDING] Queued {op_data['type']} {op_uri} for post {post_uri}")
    
    async def flush_pending_ops(self, conn: asyncpg.Connection, post_uri: str):
        """Flush pending operations when post becomes available"""
        ops = self.pending_ops.get(post_uri, [])
        if not ops:
            return
        
        del self.pending_ops[post_uri]
        logger.info(f"[PENDING] Flushing {len(ops)} operations for {post_uri}")
        
        for op in ops:
            try:
                if op['type'] == 'like':
                    await self._create_like_internal(conn, op['uri'], op['user_did'], op['post_uri'], op['created_at'])
                elif op['type'] == 'repost':
                    await self._create_repost_internal(conn, op['uri'], op['user_did'], op['post_uri'], op.get('cid', op['uri']), op['created_at'])
                
                self.pending_op_index.pop(op['uri'], None)
                self.total_pending_count -= 1
                self.metrics['pending_flushed'] += 1
            except Exception as e:
                logger.error(f"[PENDING] Error flushing {op['type']}: {e}")
                self.pending_op_index.pop(op['uri'], None)
                self.total_pending_count -= 1
    
    def enqueue_pending_user_op(self, user_did: str, op_data: Dict[str, Any]):
        """Enqueue pending follow/block when user doesn't exist"""
        op_uri = op_data['uri']
        
        if op_uri in self.pending_user_op_index:
            return
        
        self.pending_user_ops[user_did].append(op_data)
        self.pending_user_op_index[op_uri] = user_did
        self.total_pending_user_ops += 1
        self.metrics['pending_user_ops_queued'] += 1
        logger.debug(f"[PENDING] Queued {op_data['type']} {op_uri} for user {user_did}")
    
    async def flush_pending_user_ops(self, conn: asyncpg.Connection, user_did: str):
        """Flush pending user operations"""
        ops = self.pending_user_ops.get(user_did, [])
        if not ops:
            return
        
        del self.pending_user_ops[user_did]
        
        for op in ops:
            try:
                if op['type'] == 'follow':
                    await self._create_follow_internal(conn, op['uri'], op['follower_did'], op['following_did'], op['created_at'], op.get('cid'))
                elif op['type'] == 'block':
                    await self._create_block_internal(conn, op['uri'], op['blocker_did'], op['blocked_did'], op['created_at'])
                
                self.pending_user_op_index.pop(op['uri'], None)
                self.total_pending_user_ops -= 1
                self.metrics['pending_user_ops_flushed'] += 1
            except Exception as e:
                logger.error(f"[PENDING] Error flushing user op: {e}")
    
    def enqueue_pending_list_item(self, list_uri: str, item_data: Dict[str, Any]):
        """Enqueue pending list item when list doesn't exist"""
        item_uri = item_data['uri']
        
        if item_uri in self.pending_list_item_index:
            return
        
        self.pending_list_items[list_uri].append(item_data)
        self.pending_list_item_index[item_uri] = list_uri
        self.total_pending_list_items += 1
        self.metrics['pending_list_items_queued'] += 1
        logger.debug(f"[PENDING] Queued list item {item_uri} for list {list_uri}")
    
    def cancel_pending_op(self, op_uri: str):
        """Cancel a pending operation (like/repost)"""
        post_uri = self.pending_op_index.get(op_uri)
        if not post_uri:
            return
        
        queue = self.pending_ops.get(post_uri, [])
        filtered_queue = [op for op in queue if op['uri'] != op_uri]
        removed = len(queue) - len(filtered_queue)
        
        if removed > 0:
            if filtered_queue:
                self.pending_ops[post_uri] = filtered_queue
            else:
                del self.pending_ops[post_uri]
            
            self.total_pending_count -= removed
            self.pending_op_index.pop(op_uri, None)
            logger.debug(f"[PENDING] Cancelled pending op: {op_uri}")
    
    def cancel_pending_user_op(self, op_uri: str):
        """Cancel a pending user operation (follow/block)"""
        user_did = self.pending_user_op_index.get(op_uri)
        if not user_did:
            return
        
        queue = self.pending_user_ops.get(user_did, [])
        filtered_queue = [op for op in queue if op['uri'] != op_uri]
        removed = len(queue) - len(filtered_queue)
        
        if removed > 0:
            if filtered_queue:
                self.pending_user_ops[user_did] = filtered_queue
            else:
                del self.pending_user_ops[user_did]
            
            self.total_pending_user_ops -= removed
            self.pending_user_op_index.pop(op_uri, None)
            logger.debug(f"[PENDING] Cancelled pending user op: {op_uri}")
    
    def enqueue_pending_user_creation_op(self, did: str, repo: str, op: Any):
        """Enqueue operation for user creation (for ops that come before user is created)"""
        pending_op = {
            'repo': repo,
            'op': op,
            'enqueued_at': time.time() * 1000
        }
        
        self.pending_user_creation_ops[did].append(pending_op)
        self.total_pending_user_creation_ops += 1
        self.metrics['pending_user_creation_ops_queued'] += 1
        logger.debug(f"[PENDING] Queued op for user creation: {did}")
    
    async def flush_pending_user_creation_ops(self, conn: asyncpg.Connection, did: str):
        """Flush pending user creation operations"""
        ops = self.pending_user_creation_ops.get(did, [])
        if not ops:
            return
        
        del self.pending_user_creation_ops[did]
        logger.info(f"[PENDING] Flushing {len(ops)} pending user creation operations for {did}")
        
        for pending_op in ops:
            try:
                # Reprocess the original commit operation
                # Extract the op details and route to the appropriate handler
                op_data = pending_op['op']
                repo = pending_op['repo']
                
                # Build uri from repo and path
                path = getattr(op_data, 'path', '')
                uri = f"at://{repo}/{path}"
                cid_obj = getattr(op_data, 'cid', None)
                cid = str(cid_obj) if cid_obj else uri
                record = getattr(op_data, 'record', None)
                
                if record:
                    record_type = getattr(record, 'py_type', None)
                    
                    if record_type == "app.bsky.feed.like":
                        post_uri = getattr(getattr(record, 'subject', None), 'uri', None)
                        if post_uri:
                            created_at = self.safe_date(getattr(record, 'createdAt', None))
                            await self.process_like(conn, uri, repo, post_uri, created_at, cid)
                    
                    elif record_type == "app.bsky.graph.follow":
                        following_did = getattr(record, 'subject', None)
                        if following_did:
                            created_at = self.safe_date(getattr(record, 'createdAt', None))
                            await self.process_follow(conn, uri, repo, following_did, created_at, cid)
                    
                    elif record_type == "app.bsky.graph.starterpack":
                        await self.process_starter_pack(conn, uri, cid, repo, record)
                
                self.total_pending_user_creation_ops -= 1
                self.metrics['pending_user_creation_ops_flushed'] += 1
            except Exception as e:
                logger.error(f"[PENDING] Error flushing user creation op: {e}")
    
    async def flush_pending_list_items(self, conn: asyncpg.Connection, list_uri: str):
        """Flush pending list items"""
        items = self.pending_list_items.get(list_uri, [])
        if not items:
            return
        
        del self.pending_list_items[list_uri]
        logger.info(f"[PENDING] Flushing {len(items)} list items for {list_uri}")
        
        for item in items:
            try:
                await conn.execute(
                    """
                    INSERT INTO list_items (uri, cid, list_uri, subject_did, created_at)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (uri) DO NOTHING
                    """,
                    item['uri'], item['cid'], item['list_uri'], item['subject_did'], item['created_at']
                )
                
                self.pending_list_item_index.pop(item['uri'], None)
                self.total_pending_list_items -= 1
                self.metrics['pending_list_items_flushed'] += 1
            except Exception as e:
                logger.error(f"[PENDING] Error flushing list item: {e}")
    
    async def is_data_collection_forbidden(self, conn: asyncpg.Connection, did: str) -> bool:
        """Check if data collection is forbidden for user (with caching)"""
        # Clear cache periodically
        if time.time() - self.cache_clear_time > self.CACHE_CLEAR_INTERVAL:
            self.data_collection_cache.clear()
            self.cache_clear_time = time.time()
        
        # Check cache
        if did in self.data_collection_cache:
            return self.data_collection_cache[did]
        
        # Query database
        settings = await conn.fetchrow(
            'SELECT "dataCollectionForbidden" FROM "userSettings" WHERE did = $1',
            did
        )
        
        forbidden = settings['dataCollectionForbidden'] if settings else False
        self.data_collection_cache[did] = forbidden
        
        return forbidden
    
    async def ensure_user(self, conn: asyncpg.Connection, did: str) -> bool:
        """Ensure user exists in database with deduplication (wrapper method)"""
        # Check if there's already a pending creation for this user
        # This prevents duplicate concurrent operations for the same user
        existing_creation = self.pending_user_creations.get(did)
        if existing_creation and not existing_creation.done():
            # Wait for existing creation to complete
            try:
                return await existing_creation
            except:
                pass
        
        # Create the task and store it for deduplication
        creation_task = asyncio.create_task(self.ensure_user_internal(conn, did))
        self.pending_user_creations[did] = creation_task
        
        # Clean up after completion
        def cleanup(task):
            self.pending_user_creations.pop(did, None)
        
        creation_task.add_done_callback(cleanup)
        
        return await creation_task
    
    async def ensure_user_internal(self, conn: asyncpg.Connection, did: str) -> bool:
        """Internal method to ensure user exists with concurrent creation limiting"""
        try:
            # First check if user exists - quick DB query
            user = await conn.fetchrow(
                "SELECT did, avatar_url, display_name FROM users WHERE did = $1",
                did
            )
            
            if not user:
                # Wait if we're at the concurrent creation limit
                # This prevents overwhelming the database with too many concurrent user creations
                while self.active_user_creations >= self.MAX_CONCURRENT_USER_CREATIONS:
                    await asyncio.sleep(0.01)  # Wait 10ms before checking again
                
                self.active_user_creations += 1
                
                try:
                    # User doesn't exist - we need to create them
                    # CRITICAL: We skip DID resolution during initial creation to avoid holding DB connections
                    # for extended periods, which would exhaust the connection pool
                    # The user will be marked for profile fetching to get the proper handle later
                    
                    # Use 'handle.invalid' as a temporary fallback (matches Bluesky's approach)
                    # This will be updated when the profile is fetched with the actual handle
                    INVALID_HANDLE = 'handle.invalid'
                    
                    # Create user with fallback handle - will be updated when profile is fetched
                    # This keeps the DB operation fast
                    try:
                        await conn.execute(
                            """
                            INSERT INTO users (did, handle, created_at)
                            VALUES ($1, $2, NOW())
                            ON CONFLICT (did) DO NOTHING
                            """,
                            did,
                            INVALID_HANDLE
                        )
                        
                        # Mark user for PDS profile fetching to get proper handle and avatar/banner
                        if not self.skip_pds_fetching and self.pds_data_fetcher:
                            self.pds_data_fetcher.mark_incomplete('user', did)
                        
                        # Batch logging: only log every 5000 user creations
                        self.user_creation_count += 1
                        if self.user_creation_count % self.USER_BATCH_LOG_SIZE == 0:
                            logger.info(f"[USER] Created {self.USER_BATCH_LOG_SIZE} users (total: {self.user_creation_count})")
                    except asyncpg.exceptions.UniqueViolationError:
                        # If createUser resulted in a unique constraint violation, it means the user was created
                        # by a parallel process. This is fine - we can continue.
                        pass
                finally:
                    self.active_user_creations -= 1
            
            # If we reach here, the user *should* exist, either from before or from creation.
            # Now, flush all pending operations for this user.
            await self.flush_pending_user_ops(conn, did)
            await self.flush_pending_user_creation_ops(conn, did)
            return True
            
        except Exception as error:
            # If createUser resulted in a unique constraint violation, it means the user was created
            # by a parallel process. We can treat this as a success and flush the queues.
            if hasattr(error, 'code') and error.code == '23505':
                await self.flush_pending_user_ops(conn, did)
                await self.flush_pending_user_creation_ops(conn, did)
                return True
            logger.error(f"Error ensuring user {did}: {error}")
            return False
    
    def safe_date(self, value: Optional[str]) -> datetime:
        """Parse date safely, returning current time if invalid
        
        Returns naive datetime in UTC (without timezone info) to match PostgreSQL's
        timestamp type which is 'timestamp without time zone'.
        """
        if not value:
            return datetime.now(timezone.utc).replace(tzinfo=None)
        try:
            dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
            # Convert to naive datetime in UTC for PostgreSQL compatibility
            return dt.replace(tzinfo=None) if dt.tzinfo else dt
        except Exception:
            return datetime.now(timezone.utc).replace(tzinfo=None)
    
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
                link = ref.get('$link') if isinstance(ref, dict) else getattr(ref, '$link', None)
                if link and link != 'undefined':
                    return str(link) if not isinstance(link, str) else link
            # Convert ref to string if it's a CID object
            if ref and ref != 'undefined':
                return str(ref)
        
        if hasattr(blob, 'cid'):
            cid = blob.cid
            if cid and cid != 'undefined':
                return str(cid) if not isinstance(cid, str) else cid
        
        return None
    
    async def create_notification(
        self,
        conn: asyncpg.Connection,
        uri: str,
        recipient_did: str,
        author_did: str,
        reason: str,
        reason_subject: Optional[str],
        cid: Optional[str],
        created_at: datetime
    ):
        """Create notification record"""
        try:
            await conn.execute(
                """
                INSERT INTO notifications (uri, recipient_did, author_did, reason, reason_subject, cid, is_read, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, false, $7)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, recipient_did, author_did, reason, reason_subject, cid, created_at
            )
        except Exception as e:
            logger.debug(f"Error creating notification: {e}")
    
    async def create_post_viewer_state(
        self,
        conn: asyncpg.Connection,
        post_uri: str,
        viewer_did: str,
        like_uri: Optional[str] = None,
        repost_uri: Optional[str] = None,
        bookmarked: bool = False
    ):
        """Create or update post viewer state"""
        try:
            # Build update fields
            updates = []
            params = [post_uri, viewer_did]
            param_idx = 3
            
            if like_uri:
                updates.append(f'like_uri = ${param_idx}')
                params.append(like_uri)
                param_idx += 1
            
            if repost_uri:
                updates.append(f'repost_uri = ${param_idx}')
                params.append(repost_uri)
                param_idx += 1
            
            if bookmarked:
                updates.append('bookmarked = true')
            
            # Insert or update
            await conn.execute(
                f"""
                INSERT INTO post_viewer_states (post_uri, viewer_did, like_uri, repost_uri, bookmarked, thread_muted, reply_disabled, embedding_disabled, pinned)
                VALUES ($1, $2, ${3 if like_uri else 'NULL'}, ${4 if repost_uri else 'NULL'}, ${'true' if bookmarked else 'false'}, false, false, false, false)
                ON CONFLICT (post_uri, viewer_did) DO UPDATE SET
                    {', '.join(updates) if updates else 'like_uri = post_viewer_states.like_uri'}
                """.replace('${', '$'),
                *params[:2], *(params[2:] if updates else [])
            )
        except Exception as e:
            logger.debug(f"Error creating viewer state: {e}")
    
    async def process_post(
        self,
        conn: asyncpg.Connection,
        uri: str,
        cid: str,
        author_did: str,
        record: Any
    ):
        """Process post creation with full feature parity"""
        await self.ensure_user(conn, author_did)
        
        # Check data collection forbidden
        if await self.is_data_collection_forbidden(conn, author_did):
            return
        
        text = sanitize_required_text(getattr(record, 'text', None))
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
                INSERT INTO posts (uri, cid, author_did, text, parent_uri, root_uri, embed, facets, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, cid, author_did, text, parent_uri, root_uri, embed_json, facets_json, created_at
            )
            
            # Create post aggregation
            await conn.execute(
                """
                INSERT INTO post_aggregations (post_uri, like_count, repost_count, reply_count, bookmark_count, quote_count)
                VALUES ($1, 0, 0, 0, 0, 0)
                ON CONFLICT (post_uri) DO NOTHING
                """,
                uri
            )
            
            # Create feed item
            await conn.execute(
                """
                INSERT INTO feed_items (uri, post_uri, originator_did, type, sort_at, cid, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, uri, author_did, 'post', created_at, cid, created_at
            )
            
            # Handle reply - increment parent reply count and create thread context
            if parent_uri:
                await conn.execute(
                    'UPDATE post_aggregations SET reply_count = reply_count + 1 WHERE post_uri = $1',
                    parent_uri
                )
                
                # Create thread context
                if root_uri:
                    root_post = await conn.fetchrow('SELECT author_did FROM posts WHERE uri = $1', root_uri)
                    if root_post:
                        # Check if root author liked this post
                        root_author_like = await conn.fetchrow(
                            'SELECT uri FROM likes WHERE user_did = $1 AND post_uri = $2',
                            root_post['author_did'], uri
                        )
                        
                        await conn.execute(
                            """
                            INSERT INTO thread_contexts (post_uri, root_author_like_uri)
                            VALUES ($1, $2)
                            ON CONFLICT (post_uri) DO NOTHING
                            """,
                            uri, root_author_like['uri'] if root_author_like else None
                        )
                
                # Create reply notification
                parent_post = await conn.fetchrow('SELECT author_did FROM posts WHERE uri = $1', parent_uri)
                if parent_post and parent_post['author_did'] != author_did:
                    notif_uri = f"{uri}#notification/reply"
                    await self.create_notification(conn, notif_uri, parent_post['author_did'], author_did, 'reply', uri, cid, created_at)
            
            # Handle mentions
            mentions = re.findall(r'@([a-zA-Z0-9.-]+)', text)
            processed_mentions: Set[str] = set()
            
            for mention in mentions:
                if mention in processed_mentions:
                    continue
                
                mentioned_user = await conn.fetchrow('SELECT did FROM users WHERE handle = $1', mention)
                if mentioned_user and mentioned_user['did'] != author_did:
                    notif_uri = f"{uri}#notification/mention/{mentioned_user['did']}"
                    await self.create_notification(conn, notif_uri, mentioned_user['did'], author_did, 'mention', uri, cid, created_at)
                    processed_mentions.add(mention)
            
            # Handle quote posts
            quoted_uri = None
            quoted_cid = None
            
            if embed:
                embed_type = getattr(embed, 'py_type', None)
                if embed_type == 'app.bsky.embed.record':
                    record_embed = getattr(embed, 'record', None)
                    if record_embed:
                        quoted_uri = getattr(record_embed, 'uri', None)
                        quoted_cid = getattr(record_embed, 'cid', None)
                elif embed_type == 'app.bsky.embed.recordWithMedia':
                    record_embed = getattr(embed, 'record', None)
                    if record_embed:
                        inner_record = getattr(record_embed, 'record', None)
                        if inner_record:
                            quoted_uri = getattr(inner_record, 'uri', None)
                            quoted_cid = getattr(inner_record, 'cid', None)
            
            if quoted_uri:
                quote_uri = f"{uri}#quote"
                await conn.execute(
                    """
                    INSERT INTO quotes (uri, cid, post_uri, quoted_uri, quoted_cid, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (uri) DO NOTHING
                    """,
                    quote_uri, cid, uri, quoted_uri, quoted_cid, created_at
                )
                
                # Increment quote count
                await conn.execute(
                    'UPDATE post_aggregations SET quote_count = quote_count + 1 WHERE post_uri = $1',
                    quoted_uri
                )
                
                # Create quote notification
                quoted_post = await conn.fetchrow('SELECT author_did FROM posts WHERE uri = $1', quoted_uri)
                if quoted_post and quoted_post['author_did'] != author_did:
                    notif_uri = f"{uri}#notification/quote"
                    await self.create_notification(conn, notif_uri, quoted_post['author_did'], author_did, 'quote', uri, cid, created_at)
            
            # Flush any pending operations waiting for this post
            await self.flush_pending_ops(conn, uri)
            
            logger.debug(f"Created post: {uri}")
            
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating post {uri}: {e}")
    
    async def _create_like_internal(
        self,
        conn: asyncpg.Connection,
        uri: str,
        user_did: str,
        post_uri: str,
        created_at: datetime,
        cid: Optional[str] = None
    ):
        """Internal method to create like (used by both direct and pending processing)"""
        await conn.execute(
            """
            INSERT INTO likes (uri, user_did, post_uri, created_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (uri) DO NOTHING
            """,
            uri, user_did, post_uri, created_at
        )
        
        # Increment like count
        await conn.execute(
            'UPDATE post_aggregations SET like_count = like_count + 1 WHERE post_uri = $1',
            post_uri
        )
        
        # Create viewer state
        await self.create_post_viewer_state(conn, post_uri, user_did, like_uri=uri)
        
        # Create like notification
        post = await conn.fetchrow('SELECT author_did FROM posts WHERE uri = $1', post_uri)
        if post and post['author_did'] != user_did:
            notif_uri = f"{uri}#notification"
            await self.create_notification(conn, notif_uri, post['author_did'], user_did, 'like', post_uri, cid, created_at)
    
    async def process_like(
        self,
        conn: asyncpg.Connection,
        uri: str,
        user_did: str,
        post_uri: str,
        created_at: datetime,
        cid: Optional[str] = None,
        repo: Optional[str] = None,
        op: Optional[Any] = None
    ):
        """Process like creation"""
        user_ready = await self.ensure_user(conn, user_did)
        if not user_ready:
            # If we have the original op data, queue for later
            if repo and op:
                self.enqueue_pending_user_creation_op(user_did, repo, op)
                logger.debug(f"[PENDING] Queued like {uri} - user not ready")
            return
        
        # Check data collection forbidden
        if await self.is_data_collection_forbidden(conn, user_did):
            return
        
        try:
            await self._create_like_internal(conn, uri, user_did, post_uri, created_at, cid)
            logger.debug(f"Created like: {uri}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except asyncpg.exceptions.ForeignKeyViolationError:
            # Post doesn't exist yet - queue for later
            self.enqueue_pending_op(post_uri, {
                'type': 'like',
                'uri': uri,
                'user_did': user_did,
                'post_uri': post_uri,
                'created_at': created_at,
                'cid': cid,
                'enqueued_at': time.time() * 1000
            })
        except Exception as e:
            logger.error(f"Error creating like {uri}: {e}")
    
    async def _create_repost_internal(
        self,
        conn: asyncpg.Connection,
        uri: str,
        user_did: str,
        post_uri: str,
        cid: str,
        created_at: datetime
    ):
        """Internal method to create repost"""
        await conn.execute(
            """
            INSERT INTO reposts (uri, user_did, post_uri, created_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (uri) DO NOTHING
            """,
            uri, user_did, post_uri, created_at
        )
        
        # Increment repost count
        await conn.execute(
            'UPDATE post_aggregations SET repost_count = repost_count + 1 WHERE post_uri = $1',
            post_uri
        )
        
        # Create viewer state
        await self.create_post_viewer_state(conn, post_uri, user_did, repost_uri=uri)
        
        # Create feed item
        await conn.execute(
            """
            INSERT INTO feed_items (uri, post_uri, originator_did, type, sort_at, cid, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (uri) DO NOTHING
            """,
            uri, post_uri, user_did, 'repost', created_at, cid, created_at
        )
        
        # Create repost notification
        post = await conn.fetchrow('SELECT author_did FROM posts WHERE uri = $1', post_uri)
        if post and post['author_did'] != user_did:
            notif_uri = f"{uri}#notification"
            await self.create_notification(conn, notif_uri, post['author_did'], user_did, 'repost', post_uri, cid, created_at)
    
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
        
        # Check data collection forbidden
        if await self.is_data_collection_forbidden(conn, user_did):
            return
        
        try:
            await self._create_repost_internal(conn, uri, user_did, post_uri, cid, created_at)
            logger.debug(f"Created repost: {uri}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except asyncpg.exceptions.ForeignKeyViolationError:
            # Post doesn't exist yet - queue for later
            self.enqueue_pending_op(post_uri, {
                'type': 'repost',
                'uri': uri,
                'user_did': user_did,
                'post_uri': post_uri,
                'cid': cid,
                'created_at': created_at,
                'enqueued_at': time.time() * 1000
            })
        except Exception as e:
            logger.error(f"Error creating repost {uri}: {e}")
    
    async def _create_follow_internal(
        self,
        conn: asyncpg.Connection,
        uri: str,
        follower_did: str,
        following_did: str,
        created_at: datetime,
        cid: Optional[str] = None
    ):
        """Internal method to create follow"""
        await conn.execute(
            """
            INSERT INTO follows (uri, follower_did, following_did, created_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (uri) DO NOTHING
            """,
            uri, follower_did, following_did, created_at
        )
        
        # Create follow notification
        notif_uri = f"{uri}#notification"
        await self.create_notification(conn, notif_uri, following_did, follower_did, 'follow', None, cid, created_at)
    
    async def process_follow(
        self,
        conn: asyncpg.Connection,
        uri: str,
        follower_did: str,
        following_did: str,
        created_at: datetime,
        cid: Optional[str] = None,
        repo: Optional[str] = None,
        op: Optional[Any] = None
    ):
        """Process follow creation"""
        follower_ready = await self.ensure_user(conn, follower_did)
        if not follower_ready:
            # If we have the original op data, queue for later
            if repo and op:
                self.enqueue_pending_user_creation_op(follower_did, repo, op)
                logger.debug(f"[PENDING] Queued follow {uri} - follower not ready")
            return
        
        await self.ensure_user(conn, following_did)
        
        # Check data collection forbidden
        if await self.is_data_collection_forbidden(conn, follower_did):
            return
        
        try:
            await self._create_follow_internal(conn, uri, follower_did, following_did, created_at, cid)
            logger.debug(f"Created follow: {uri}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating follow {uri}: {e}")
    
    async def _create_block_internal(
        self,
        conn: asyncpg.Connection,
        uri: str,
        blocker_did: str,
        blocked_did: str,
        created_at: datetime
    ):
        """Internal method to create block"""
        await conn.execute(
            """
            INSERT INTO blocks (uri, blocker_did, blocked_did, created_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (uri) DO NOTHING
            """,
            uri, blocker_did, blocked_did, created_at
        )
    
    async def process_block(
        self,
        conn: asyncpg.Connection,
        uri: str,
        blocker_did: str,
        blocked_did: str,
        created_at: datetime
    ):
        """Process block creation"""
        await self.ensure_user(conn, blocker_did)
        await self.ensure_user(conn, blocked_did)
        
        # Check data collection forbidden
        if await self.is_data_collection_forbidden(conn, blocker_did):
            return
        
        try:
            await self._create_block_internal(conn, uri, blocker_did, blocked_did, created_at)
            logger.debug(f"Created block: {uri}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating block {uri}: {e}")
    
    async def process_bookmark(
        self,
        conn: asyncpg.Connection,
        uri: str,
        user_did: str,
        post_uri: str,
        created_at: datetime
    ):
        """Process bookmark creation"""
        await self.ensure_user(conn, user_did)
        
        # Check data collection forbidden
        if await self.is_data_collection_forbidden(conn, user_did):
            return
        
        try:
            await conn.execute(
                """
                INSERT INTO bookmarks (uri, user_did, post_uri, created_at)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, user_did, post_uri, created_at
            )
            
            # Increment bookmark count
            await conn.execute(
                'UPDATE post_aggregations SET bookmark_count = bookmark_count + 1 WHERE post_uri = $1',
                post_uri
            )
            
            # Create viewer state
            await self.create_post_viewer_state(conn, post_uri, user_did, bookmarked=True)
            
            logger.debug(f"Created bookmark: {uri}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating bookmark {uri}: {e}")
    
    async def process_profile(
        self,
        conn: asyncpg.Connection,
        did: str,
        record: Any
    ):
        """Process profile update"""
        display_name = sanitize_text(getattr(record, 'displayName', None))
        description = sanitize_text(getattr(record, 'description', None))
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
                INSERT INTO users (did, handle, display_name, description, avatar_url, banner_url, profile_record, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
                ON CONFLICT (did) DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    description = EXCLUDED.description,
                    avatar_url = EXCLUDED.avatar_url,
                    banner_url = EXCLUDED.banner_url,
                    profile_record = EXCLUDED.profile_record
                """,
                did, 'handle.invalid', display_name, description, avatar_cid, banner_cid, profile_json
            )
            logger.debug(f"Updated profile: {did}")
        except Exception as e:
            logger.error(f"Error updating profile {did}: {e}")
    
    async def process_list(
        self,
        conn: asyncpg.Connection,
        uri: str,
        cid: str,
        creator_did: str,
        record: Any
    ):
        """Process list creation"""
        await self.ensure_user(conn, creator_did)
        
        # Check data collection forbidden
        if await self.is_data_collection_forbidden(conn, creator_did):
            return
        
        name = sanitize_required_text(getattr(record, 'name', None))
        purpose = getattr(record, 'purpose', '')
        description = sanitize_text(getattr(record, 'description', None))
        avatar_cid = self.extract_blob_cid(getattr(record, 'avatar', None))
        created_at = self.safe_date(getattr(record, 'createdAt', None))
        
        try:
            await conn.execute(
                """
                INSERT INTO lists (uri, cid, creator_did, name, purpose, description, avatar_url, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, cid, creator_did, name, purpose, description, avatar_cid, created_at
            )
            
            # Flush pending list items
            await self.flush_pending_list_items(conn, uri)
            
            logger.debug(f"Created list: {uri}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating list {uri}: {e}")
    
    async def process_list_item(
        self,
        conn: asyncpg.Connection,
        uri: str,
        cid: str,
        list_uri: str,
        subject_did: str,
        created_at: datetime
    ):
        """Process list item creation"""
        await self.ensure_user(conn, subject_did)
        
        try:
            # Check if list exists
            list_exists = await conn.fetchval('SELECT EXISTS(SELECT 1 FROM lists WHERE uri = $1)', list_uri)
            
            if not list_exists:
                # Queue for later
                self.enqueue_pending_list_item(list_uri, {
                    'uri': uri,
                    'cid': cid,
                    'list_uri': list_uri,
                    'subject_did': subject_did,
                    'created_at': created_at,
                    'enqueued_at': time.time() * 1000
                })
                return
            
            await conn.execute(
                """
                INSERT INTO list_items (uri, cid, list_uri, subject_did, created_at)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, cid, list_uri, subject_did, created_at
            )
            logger.debug(f"Created list item: {uri}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating list item {uri}: {e}")
    
    async def process_feed_generator(
        self,
        conn: asyncpg.Connection,
        uri: str,
        cid: str,
        creator_did: str,
        record: Any
    ):
        """Process feed generator creation"""
        await self.ensure_user(conn, creator_did)
        
        # Check data collection forbidden
        if await self.is_data_collection_forbidden(conn, creator_did):
            return
        
        did = getattr(record, 'did', '')
        display_name = sanitize_required_text(getattr(record, 'displayName', None))
        description = sanitize_text(getattr(record, 'description', None))
        avatar_cid = self.extract_blob_cid(getattr(record, 'avatar', None))
        created_at = self.safe_date(getattr(record, 'createdAt', None))
        
        try:
            await conn.execute(
                """
                INSERT INTO feed_generators (uri, cid, creator_did, did, display_name, description, avatar_url, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, cid, creator_did, did, display_name, description, avatar_cid, created_at
            )
            logger.debug(f"Created feed generator: {uri}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating feed generator {uri}: {e}")
    
    async def process_starter_pack(
        self,
        conn: asyncpg.Connection,
        uri: str,
        cid: str,
        creator_did: str,
        record: Any,
        repo: Optional[str] = None,
        op: Optional[Any] = None
    ):
        """Process starter pack creation"""
        creator_ready = await self.ensure_user(conn, creator_did)
        if not creator_ready:
            # If we have the original op data, queue for later
            if repo and op:
                self.enqueue_pending_user_creation_op(creator_did, repo, op)
                logger.debug(f"[PENDING] Queued starter pack {uri} - creator not ready")
            return
        
        # Check data collection forbidden
        if await self.is_data_collection_forbidden(conn, creator_did):
            return
        
        name = sanitize_required_text(getattr(record, 'name', None))
        description = sanitize_text(getattr(record, 'description', None))
        list_uri = getattr(record, 'list', None)
        
        # Extract feed URIs
        feeds_attr = getattr(record, 'feeds', None)
        feeds = []
        if feeds_attr:
            try:
                feeds = [getattr(f, 'uri', None) for f in feeds_attr if hasattr(f, 'uri')]
            except:
                pass
        
        feeds_json = json.dumps(feeds) if feeds else None
        created_at = self.safe_date(getattr(record, 'createdAt', None))
        
        try:
            await conn.execute(
                """
                INSERT INTO starter_packs (uri, cid, creator_did, name, description, list_uri, feeds, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, cid, creator_did, name, description, list_uri, feeds_json, created_at
            )
            logger.debug(f"Created starter pack: {uri}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating starter pack {uri}: {e}")
    
    async def process_labeler_service(
        self,
        conn: asyncpg.Connection,
        uri: str,
        cid: str,
        creator_did: str,
        record: Any
    ):
        """Process labeler service creation"""
        await self.ensure_user(conn, creator_did)
        
        # Check data collection forbidden
        if await self.is_data_collection_forbidden(conn, creator_did):
            return
        
        policies_attr = getattr(record, 'policies', None)
        policies = {'labelValues': [], 'labelValueDefinitions': []}
        
        if policies_attr:
            try:
                if hasattr(policies_attr, 'model_dump'):
                    policies = policies_attr.model_dump()
                elif hasattr(policies_attr, 'dict'):
                    policies = policies_attr.dict()
            except:
                pass
        
        policies_json = json.dumps(policies, cls=SafeJSONEncoder)
        created_at = self.safe_date(getattr(record, 'createdAt', None))
        
        try:
            await conn.execute(
                """
                INSERT INTO labeler_services (uri, cid, creator_did, policies, created_at)
                VALUES ($1, $2, $3, $4::jsonb, $5)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, cid, creator_did, policies_json, created_at
            )
            logger.info(f"[LABELER_SERVICE] Processed labeler service {uri} for {creator_did}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating labeler service {uri}: {e}")
    
    async def process_verification(
        self,
        conn: asyncpg.Connection,
        uri: str,
        cid: str,
        creator_did: str,
        record: Any
    ):
        """Process verification record creation"""
        await self.ensure_user(conn, creator_did)
        
        # Check data collection forbidden
        if await self.is_data_collection_forbidden(conn, creator_did):
            return
        
        subject_did = getattr(record, 'subject', creator_did) or creator_did
        handle = getattr(record, 'handle', '') or ''
        verified_at = self.safe_date(getattr(record, 'verifiedAt', None))
        created_at = self.safe_date(getattr(record, 'createdAt', None))
        
        try:
            await conn.execute(
                """
                INSERT INTO verifications (uri, cid, subject_did, handle, verified_at, created_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, cid, subject_did, handle, verified_at, created_at
            )
            logger.info(f"[VERIFICATION] Processed verification {uri} for {subject_did}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating verification {uri}: {e}")
    
    async def process_label(
        self,
        conn: asyncpg.Connection,
        uri: str,
        src: str,
        record: Any
    ):
        """Process label (moderation) creation - using label service for full parity"""
        subject = getattr(record, 'uri', None) or getattr(record, 'did', None)
        val = getattr(record, 'val', '')
        neg = getattr(record, 'neg', False)
        
        # Try to get createdAt, default to now if not available
        created_at_attr = getattr(record, 'createdAt', None)
        cid_attr = getattr(record, 'cid', None)
        if cid_attr and created_at_attr:
            created_at = self.safe_date(created_at_attr)
        else:
            created_at = datetime.now(timezone.utc).replace(tzinfo=None)
        
        if not subject or not val:
            return
        
        try:
            # Use label service if available (creates label + label event for real-time broadcasting)
            if self.label_service:
                await self.label_service.apply_label(src, subject, val, neg, created_at)
            else:
                # Fallback to direct DB insert (for backwards compatibility)
                await conn.execute(
                    """
                    INSERT INTO labels (uri, src, subject, val, neg, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (uri) DO NOTHING
                    """,
                    uri, src, subject, val, neg, created_at
                )
                logger.info(f"[LABEL] Applied label {val} to {subject} from {src}")
        except asyncpg.exceptions.UniqueViolationError:
            logger.debug(f"[LABEL] Skipped duplicate label {val} for {subject}")
        except Exception as e:
            logger.error(f"Error applying label {uri}: {e}")
    
    async def process_generic_record(
        self,
        conn: asyncpg.Connection,
        uri: str,
        cid: str,
        author_did: str,
        record: Any
    ):
        """Process generic/unknown record types"""
        record_type = getattr(record, 'py_type', None) or getattr(record, '$type', 'unknown')
        created_at = self.safe_date(getattr(record, 'createdAt', None))
        
        # Serialize record
        record_json = None
        try:
            if hasattr(record, 'model_dump'):
                record_json = json.dumps(record.model_dump(), cls=SafeJSONEncoder)
            elif hasattr(record, 'dict'):
                record_json = json.dumps(record.dict(), cls=SafeJSONEncoder)
            else:
                record_json = json.dumps({'type': str(record_type)}, cls=SafeJSONEncoder)
        except Exception as e:
            logger.debug(f"Could not serialize generic record: {e}")
            record_json = json.dumps({'type': str(record_type)}, cls=SafeJSONEncoder)
        
        try:
            await conn.execute(
                """
                INSERT INTO generic_records (uri, cid, author_did, record_type, record, created_at)
                VALUES ($1, $2, $3, $4, $5::jsonb, $6)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, cid, author_did, record_type, record_json, created_at
            )
            logger.info(f"[GENERIC] Processed generic record: {record_type} - {uri}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating generic record {uri}: {e}")
    
    async def process_record(
        self,
        uri: str,
        cid: str,
        author_did: str,
        record: Any
    ):
        """Process a record (used by PDS data fetcher) - public method matching TypeScript interface"""
        try:
            record_type = getattr(record, 'py_type', None) or getattr(record, '$type', None)
            
            async with self.db.acquire() as conn:
                async with conn.transaction():
                    if record_type == "app.bsky.feed.post":
                        await self.process_post(conn, uri, cid, author_did, record)
                    
                    elif record_type == "app.bsky.feed.like":
                        # Extract path from uri for compatibility
                        path = uri.split('at://')[1].split(author_did + '/')[1] if 'at://' in uri else ''
                        post_uri = getattr(getattr(record, 'subject', None), 'uri', None)
                        if post_uri:
                            created_at = self.safe_date(getattr(record, 'createdAt', None))
                            await self.process_like(conn, uri, author_did, post_uri, created_at, cid)
                    
                    elif record_type == "app.bsky.feed.repost":
                        post_uri = getattr(getattr(record, 'subject', None), 'uri', None)
                        if post_uri:
                            created_at = self.safe_date(getattr(record, 'createdAt', None))
                            await self.process_repost(conn, uri, author_did, post_uri, cid, created_at)
                    
                    elif record_type == "app.bsky.graph.follow":
                        following_did = getattr(record, 'subject', None)
                        if following_did:
                            created_at = self.safe_date(getattr(record, 'createdAt', None))
                            await self.process_follow(conn, uri, author_did, following_did, created_at, cid)
                    
                    elif record_type == "app.bsky.graph.block":
                        blocked_did = getattr(record, 'subject', None)
                        if blocked_did:
                            created_at = self.safe_date(getattr(record, 'createdAt', None))
                            await self.process_block(conn, uri, author_did, blocked_did, created_at)
                    
                    elif record_type == "app.bsky.graph.list":
                        await self.process_list(conn, uri, cid, author_did, record)
                    
                    elif record_type == "app.bsky.graph.listitem":
                        list_uri = getattr(record, 'list', None)
                        subject_did = getattr(record, 'subject', None)
                        if list_uri and subject_did:
                            created_at = self.safe_date(getattr(record, 'createdAt', None))
                            await self.process_list_item(conn, uri, cid, list_uri, subject_did, created_at)
                    
                    elif record_type == "app.bsky.feed.generator":
                        await self.process_feed_generator(conn, uri, cid, author_did, record)
                    
                    elif record_type == "app.bsky.graph.starterpack":
                        await self.process_starter_pack(conn, uri, cid, author_did, record)
                    
                    elif record_type == "app.bsky.labeler.service":
                        await self.process_labeler_service(conn, uri, cid, author_did, record)
                    
                    else:
                        logger.info(f"[PROCESS_RECORD] Unknown record type: {record_type}")
        
        except Exception as error:
            # Handle duplicate key errors gracefully (common during reconnections)
            if hasattr(error, 'code') and error.code == '23505':
                # Silently skip duplicates
                return
            logger.error(f"[PROCESS_RECORD] Error processing record {uri}: {error}")
    
    async def process_identity(self, event_data: Dict[str, Any]):
        """Process identity event (handle update)"""
        did = event_data.get('did')
        handle = event_data.get('handle')
        
        if not did or not handle:
            return
        
        async with self.db.acquire() as conn:
            try:
                await conn.execute(
                    """
                    INSERT INTO users (did, handle, created_at)
                    VALUES ($1, $2, NOW())
                    ON CONFLICT (did) DO UPDATE SET handle = EXCLUDED.handle
                    """,
                    did, handle
                )
                logger.info(f"[IDENTITY] Updated handle for {did} to {handle}")
            except Exception as e:
                logger.error(f"Error updating identity {did}: {e}")
    
    async def process_account(self, event_data: Dict[str, Any]):
        """Process account event (account status change)"""
        did = event_data.get('did')
        active = event_data.get('active', True)
        
        logger.info(f"[ACCOUNT] Account status change: {did} - active: {active}")
        # Could update user status in database if needed
    
    async def process_delete(
        self,
        conn: asyncpg.Connection,
        uri: str,
        collection: str
    ):
        """Process record deletion with full feature parity"""
        # Cancel pending operations if applicable
        if collection in ["app.bsky.feed.like", "app.bsky.feed.repost"]:
            self.cancel_pending_op(uri)
        elif collection in ["app.bsky.graph.follow", "app.bsky.graph.block"]:
            self.cancel_pending_user_op(uri)
        
        # If it's a post being deleted, clear all pending likes/reposts for it
        if collection == "app.bsky.feed.post":
            ops = self.pending_ops.get(uri, [])
            if ops:
                for op in ops:
                    self.pending_op_index.pop(op['uri'], None)
                    self.total_pending_count -= 1
                del self.pending_ops[uri]
                logger.info(f"[DELETE] Cleared {len(ops)} pending operations for deleted post {uri}")
        
        try:
            if collection == "app.bsky.feed.post":
                await conn.execute("DELETE FROM posts WHERE uri = $1", uri)
                await conn.execute('DELETE FROM feed_items WHERE uri = $1', uri)
            
            elif collection == "app.bsky.feed.like":
                like = await conn.fetchrow(
                    'SELECT user_did, post_uri FROM likes WHERE uri = $1',
                    uri
                )
                if like:
                    await conn.execute("DELETE FROM likes WHERE uri = $1", uri)
                    await conn.execute(
                        'UPDATE post_aggregations SET like_count = GREATEST(like_count - 1, 0) WHERE post_uri = $1',
                        like['post_uri']
                    )
                    await conn.execute(
                        'DELETE FROM post_viewer_states WHERE post_uri = $1 AND viewer_did = $2',
                        like['post_uri'], like['user_did']
                    )
            
            elif collection == "app.bsky.feed.repost":
                repost = await conn.fetchrow(
                    'SELECT user_did, post_uri FROM reposts WHERE uri = $1',
                    uri
                )
                if repost:
                    await conn.execute("DELETE FROM reposts WHERE uri = $1", uri)
                    await conn.execute('DELETE FROM feed_items WHERE uri = $1', uri)
                    await conn.execute(
                        'UPDATE post_aggregations SET repost_count = GREATEST(repost_count - 1, 0) WHERE post_uri = $1',
                        repost['post_uri']
                    )
                    await conn.execute(
                        'DELETE FROM post_viewer_states WHERE post_uri = $1 AND viewer_did = $2',
                        repost['post_uri'], repost['user_did']
                    )
            
            elif collection == "app.bsky.bookmark":
                bookmark = await conn.fetchrow(
                    'SELECT user_did, post_uri FROM bookmarks WHERE uri = $1',
                    uri
                )
                if bookmark:
                    await conn.execute("DELETE FROM bookmarks WHERE uri = $1", uri)
                    await conn.execute(
                        'UPDATE post_aggregations SET bookmark_count = GREATEST(bookmark_count - 1, 0) WHERE post_uri = $1',
                        bookmark['post_uri']
                    )
                    await conn.execute(
                        'DELETE FROM post_viewer_states WHERE post_uri = $1 AND viewer_did = $2',
                        bookmark['post_uri'], bookmark['user_did']
                    )
            
            elif collection == "app.bsky.graph.follow":
                # Try to get followerDid, with fallback to extracting from URI
                follow = await conn.fetchrow('SELECT follower_did FROM follows WHERE uri = $1', uri)
                if follow:
                    await conn.execute('DELETE FROM follows WHERE uri = $1', uri)
                else:
                    # Fallback: extract followerDid from URI (at://did/collection/rkey)
                    uri_parts = uri.replace('at://', '').split('/')
                    if len(uri_parts) >= 1:
                        follower_did = uri_parts[0]
                        try:
                            await conn.execute('DELETE FROM follows WHERE uri = $1', uri)
                        except Exception as e:
                            logger.error(f"Error deleting follow {uri}: {e}")
            
            elif collection == "app.bsky.graph.block":
                await conn.execute("DELETE FROM blocks WHERE uri = $1", uri)
            
            elif collection == "app.bsky.graph.list":
                await conn.execute("DELETE FROM lists WHERE uri = $1", uri)
            
            elif collection == "app.bsky.graph.listitem":
                await conn.execute('DELETE FROM list_items WHERE uri = $1', uri)
            
            elif collection == "app.bsky.feed.generator":
                await conn.execute('DELETE FROM feed_generators WHERE uri = $1', uri)
            
            elif collection == "app.bsky.graph.starterpack":
                await conn.execute('DELETE FROM starter_packs WHERE uri = $1', uri)
            
            elif collection == "app.bsky.labeler.service":
                await conn.execute('DELETE FROM labeler_services WHERE uri = $1', uri)
            
            elif collection == "com.atproto.label.label":
                await conn.execute("DELETE FROM labels WHERE uri = $1", uri)
            
            elif collection == "app.bsky.graph.verification":
                await conn.execute("DELETE FROM verifications WHERE uri = $1", uri)
            
            elif collection == "app.bsky.feed.postgate":
                await conn.execute('DELETE FROM "postGates" WHERE uri = $1', uri)
            
            elif collection == "app.bsky.feed.threadgate":
                # Thread gates are stored as metadata on posts, not in a separate table
                # The hasThreadGate flag on posts will be updated when the post is re-indexed
                logger.debug(f"Thread gate deletion requested for {uri} - handled via post metadata")
            
            elif collection == "app.bsky.graph.listblock":
                await conn.execute('DELETE FROM "listBlocks" WHERE uri = $1', uri)
            
            elif collection == "app.bsky.notification.declaration":
                await conn.execute('DELETE FROM "notificationDeclarations" WHERE uri = $1', uri)
            
            else:
                # Unknown record type - try to delete from generic records
                await conn.execute('DELETE FROM generic_records WHERE uri = $1', uri)
            
            logger.debug(f"Deleted {collection}: {uri}")
        except Exception as e:
            logger.error(f"Error deleting {uri}: {e}")
    
    async def process_commit(self, commit: models.ComAtprotoSyncSubscribeRepos.Commit):
        """Process a commit event with full feature parity"""
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
            # Process each operation in its own transaction to prevent
            # errors in one operation from aborting subsequent operations
            for op in commit.ops:
                action = op.action
                path = op.path
                collection = path.split("/")[0]
                uri = f"at://{repo}/{path}"
                
                try:
                    async with conn.transaction():
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
                                        await self.process_like(conn, uri, repo, post_uri, created_at, cid, repo, op)
                                
                                elif record_type == "app.bsky.feed.repost":
                                    post_uri = getattr(getattr(record, 'subject', None), 'uri', None)
                                    if post_uri:
                                        created_at = self.safe_date(getattr(record, 'createdAt', None))
                                        await self.process_repost(conn, uri, repo, post_uri, cid, created_at)
                                
                                elif record_type == "app.bsky.bookmark":
                                    post_uri = getattr(getattr(record, 'subject', None), 'uri', None)
                                    if post_uri:
                                        created_at = self.safe_date(getattr(record, 'createdAt', None))
                                        await self.process_bookmark(conn, uri, repo, post_uri, created_at)
                                
                                elif record_type == "app.bsky.graph.follow":
                                    following_did = getattr(record, 'subject', None)
                                    if following_did:
                                        created_at = self.safe_date(getattr(record, 'createdAt', None))
                                        await self.process_follow(conn, uri, repo, following_did, created_at, cid, repo, op)
                                
                                elif record_type == "app.bsky.graph.block":
                                    blocked_did = getattr(record, 'subject', None)
                                    if blocked_did:
                                        created_at = self.safe_date(getattr(record, 'createdAt', None))
                                        await self.process_block(conn, uri, repo, blocked_did, created_at)
                                
                                elif record_type == "app.bsky.actor.profile":
                                    await self.process_profile(conn, repo, record)
                                
                                elif record_type == "app.bsky.graph.list":
                                    await self.process_list(conn, uri, cid, repo, record)
                                
                                elif record_type == "app.bsky.graph.listitem":
                                    list_uri = getattr(record, 'list', None)
                                    subject_did = getattr(record, 'subject', None)
                                    if list_uri and subject_did:
                                        created_at = self.safe_date(getattr(record, 'createdAt', None))
                                        await self.process_list_item(conn, uri, cid, list_uri, subject_did, created_at)
                                
                                elif record_type == "app.bsky.feed.generator":
                                    await self.process_feed_generator(conn, uri, cid, repo, record)
                                
                                elif record_type == "app.bsky.graph.starterpack":
                                    await self.process_starter_pack(conn, uri, cid, repo, record, repo, op)
                                
                                elif record_type == "app.bsky.labeler.service":
                                    await self.process_labeler_service(conn, uri, cid, repo, record)
                                
                                elif record_type == "com.atproto.label.label":
                                    await self.process_label(conn, uri, repo, record)
                                
                                elif record_type == "app.bsky.graph.verification":
                                    await self.process_verification(conn, uri, cid, repo, record)
                                
                                elif record_type in ["app.bsky.feed.postgate", "app.bsky.feed.threadgate", 
                                                   "app.bsky.graph.listblock", "app.bsky.notification.declaration"]:
                                    # These are metadata records - just log them (stubs matching TypeScript)
                                    logger.debug(f"[METADATA] Processed {record_type}: {uri}")
                                
                                else:
                                    # Unknown record type - store as generic record
                                    await self.process_generic_record(conn, uri, cid, repo, record)
                                
                            except Exception as e:
                                logger.debug(f"Error extracting record for {uri}: {e}")
                                continue
                        
                        elif action == "delete":
                            await self.process_delete(conn, uri, collection)
                
                except Exception as e:
                    # Log error and continue with next operation
                    # Transaction will be automatically rolled back
                    logger.error(f"Error processing {action} {uri}: {e}")
                    continue
        
        self.event_count += 1
        if self.event_count % 1000 == 0:
            elapsed = time.time() - self.start_time
            rate = self.event_count / elapsed if elapsed > 0 else 0
            logger.info(
                f"Processed {self.event_count:,} events "
                f"(~{rate:.0f} events/sec) | "
                f"Pending: {self.total_pending_count} likes/reposts, "
                f"{self.total_pending_user_ops} follows/blocks, "
                f"{self.total_pending_list_items} list items"
            )
    
    def set_skip_pds_fetching(self, skip: bool):
        """Enable/disable PDS fetching for incomplete data (used during bulk imports)"""
        # Note: PDS fetching is not implemented in this worker yet, but method exists for compatibility
        logger.info(f"[CONFIG] Skip PDS fetching: {skip}")
    
    def invalidate_data_collection_cache(self, did: str):
        """Invalidate the data collection cache for a specific user"""
        self.data_collection_cache.pop(did, None)
        logger.debug(f"[CACHE] Invalidated data collection cache for {did}")
    
    async def retry_pending_operations(self):
        """Retry processing pending operations for records that might now be available"""
        logger.info("[RETRY] Retrying pending operations...")
        
        retried_count = 0
        
        async with self.db.acquire() as conn:
            # Retry pending user operations
            for user_did in list(self.pending_user_ops.keys()):
                try:
                    user = await conn.fetchval('SELECT EXISTS(SELECT 1 FROM users WHERE did = $1)', user_did)
                    if user:
                        await self.flush_pending_user_ops(conn, user_did)
                        retried_count += len(self.pending_user_ops.get(user_did, []))
                except Exception as e:
                    logger.error(f"[RETRY] Error retrying user ops for {user_did}: {e}")
            
            # Retry pending list items
            for list_uri in list(self.pending_list_items.keys()):
                try:
                    list_exists = await conn.fetchval('SELECT EXISTS(SELECT 1 FROM lists WHERE uri = $1)', list_uri)
                    if list_exists:
                        items_count = len(self.pending_list_items.get(list_uri, []))
                        await self.flush_pending_list_items(conn, list_uri)
                        retried_count += items_count
                except Exception as e:
                    logger.error(f"[RETRY] Error retrying list items for {list_uri}: {e}")
            
            # Retry pending likes/reposts
            for post_uri in list(self.pending_ops.keys()):
                try:
                    post = await conn.fetchval('SELECT EXISTS(SELECT 1 FROM posts WHERE uri = $1)', post_uri)
                    if post:
                        ops_count = len(self.pending_ops.get(post_uri, []))
                        await self.flush_pending_ops(conn, post_uri)
                        retried_count += ops_count
                except Exception as e:
                    logger.error(f"[RETRY] Error retrying pending ops for {post_uri}: {e}")
        
        if retried_count > 0:
            logger.info(f"[RETRY] Successfully retried {retried_count} pending operations")
        
        return retried_count
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get current metrics (matches TypeScript interface)"""
        return {
            **self.metrics,
            'pending_count': self.total_pending_count,
            'pending_user_ops_count': self.total_pending_user_ops,
            'pending_list_items_count': self.total_pending_list_items,
            'pending_user_creation_ops_count': self.total_pending_user_creation_ops,
            'active_user_creations': self.active_user_creations,
            'pending_user_creation_deduplication': len(self.pending_user_creations),
            'event_count': self.event_count,
            'user_creation_count': self.user_creation_count,
        }


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
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        
        self.event_count = 0
        self.start_time = time.time()
        
    async def initialize(self):
        """Initialize database connection pool and services"""
        logger.info("Initializing unified worker...")
        
        # Store event loop reference
        self.loop = asyncio.get_event_loop()
        
        # Create database pool
        self.db_pool = DatabasePool(self.database_url, self.db_pool_size)
        await self.db_pool.connect()
        
        # Initialize DID resolver
        await did_resolver.initialize()
        logger.info("DID resolver initialized")
        
        # Initialize PDS data fetcher
        pds_data_fetcher = PDSDataFetcher(self.db_pool)
        await pds_data_fetcher.initialize()
        logger.info("PDS data fetcher initialized")
        
        # Initialize label service
        label_service = LabelService(self.db_pool)
        logger.info("Label service initialized")
        
        # Create event processor
        self.event_processor = EventProcessor(self.db_pool)
        
        # Wire up services to event processor
        self.event_processor.pds_data_fetcher = pds_data_fetcher
        self.event_processor.label_service = label_service
        pds_data_fetcher.event_processor = self.event_processor
        
        logger.info("Unified worker initialized with full feature parity")
    
    def on_message_handler(self, message: firehose_models.MessageFrame) -> None:
        """Handle incoming firehose message (sync callback)"""
        try:
            commit = parse_subscribe_repos_message(message)
            
            # Handle Commit messages (posts, likes, follows, etc.)
            if isinstance(commit, models.ComAtprotoSyncSubscribeRepos.Commit):
                # Schedule async processing using the event loop
                if self.loop:
                    asyncio.run_coroutine_threadsafe(
                        self.event_processor.process_commit(commit),
                        self.loop
                    )
            
            # Handle Identity messages
            elif isinstance(commit, models.ComAtprotoSyncSubscribeRepos.Identity):
                event_data = {
                    'did': commit.did,
                    'handle': commit.handle,
                }
                if self.loop:
                    asyncio.run_coroutine_threadsafe(
                        self.event_processor.process_identity(event_data),
                        self.loop
                    )
            
            # Handle Account messages
            elif isinstance(commit, models.ComAtprotoSyncSubscribeRepos.Account):
                event_data = {
                    'did': commit.did,
                    'active': commit.active,
                }
                if self.loop:
                    asyncio.run_coroutine_threadsafe(
                        self.event_processor.process_account(event_data),
                        self.loop
                    )
            
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
        
        # Print final metrics
        if self.event_processor:
            metrics = self.event_processor.get_metrics()
            logger.info("Final metrics:")
            for key, value in metrics.items():
                logger.info(f"  {key}: {value:,}")
            
            # Close PDS data fetcher
            if self.event_processor.pds_data_fetcher:
                await self.event_processor.pds_data_fetcher.close()
                logger.info("PDS data fetcher closed")
        
        # Close DID resolver
        await did_resolver.close()
        logger.info("DID resolver closed")
        
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
    logger.info("Feature parity with event-processor.ts")
    logger.info("Replaces 32 TypeScript workers with single process")
    logger.info("=" * 60)
    logger.info(f"Relay URL:      {relay_url}")
    logger.info(f"Database Pool:  {db_pool_size} connections")
    logger.info("=" * 60)
    
    # Check if backfill is enabled (only on primary worker - worker 0)
    worker_id = int(os.getenv("WORKER_ID", "0"))
    backfill_days = int(os.getenv("BACKFILL_DAYS", "0"))
    
    if worker_id == 0 and backfill_days != 0:
        # Start backfill service in the background
        logger.info(f"[BACKFILL] Starting {backfill_days}-day historical backfill on primary worker...")
        
        # Import and start backfill service asynchronously
        try:
            from backfill_service import BackfillService
            backfill = BackfillService(database_url, relay_url)
            await backfill.initialize()
            
            # Start backfill in background task
            async def run_backfill():
                try:
                    await backfill.start()
                except Exception as e:
                    logger.error(f"[BACKFILL] Failed to start: {e}", exc_info=True)
            
            asyncio.create_task(run_backfill())
            logger.info("[BACKFILL] Backfill service started in background")
        except Exception as e:
            logger.error(f"[BACKFILL] Failed to initialize backfill service: {e}", exc_info=True)
    elif backfill_days != 0:
        logger.info(f"[BACKFILL] Skipped on worker {worker_id} (only runs on primary worker)")
    else:
        logger.info("[BACKFILL] Disabled (BACKFILL_DAYS=0 or not set)")
    
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
