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
    """Process AT Protocol events and write to PostgreSQL with feature parity to event-processor.ts"""
    
    def __init__(self, db_pool: DatabasePool):
        self.db = db_pool
        self.event_count = 0
        self.start_time = time.time()
        
        # Pending operations (matches TypeScript implementation)
        self.pending_ops: Dict[str, List[Dict[str, Any]]] = defaultdict(list)  # postUri -> pending likes/reposts
        self.pending_op_index: Dict[str, str] = {}  # opUri -> postUri
        self.pending_user_ops: Dict[str, List[Dict[str, Any]]] = defaultdict(list)  # userDid -> pending follows/blocks
        self.pending_user_op_index: Dict[str, str] = {}  # opUri -> userDid
        self.pending_list_items: Dict[str, List[Dict[str, Any]]] = defaultdict(list)  # listUri -> pending list items
        self.pending_list_item_index: Dict[str, str] = {}  # itemUri -> listUri
        
        # TTL and metrics
        self.TTL_MS = 24 * 60 * 60 * 1000  # 24 hours
        self.total_pending_count = 0
        self.total_pending_user_ops = 0
        self.total_pending_list_items = 0
        
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
                    INSERT INTO "listItems" (uri, cid, "listUri", "subjectDid", "createdAt")
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
                    
                    # Batch logging
                    self.user_creation_count += 1
                    if self.user_creation_count % self.USER_BATCH_LOG_SIZE == 0:
                        logger.info(f"[USER] Created {self.USER_BATCH_LOG_SIZE} users (total: {self.user_creation_count})")
                        
                except asyncpg.exceptions.UniqueViolationError:
                    # Race condition - user was created by another process
                    pass
            
            # Flush any pending operations for this user
            await self.flush_pending_user_ops(conn, did)
            
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
                link = ref.get('$link') if isinstance(ref, dict) else getattr(ref, '$link', None)
                return link if link != 'undefined' else None
            if hasattr(ref, 'toString'):
                return str(ref)
        
        if hasattr(blob, 'cid'):
            return blob.cid if blob.cid != 'undefined' else None
        
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
                INSERT INTO notifications (uri, "recipientDid", "authorDid", reason, "reasonSubject", cid, "isRead", "createdAt")
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
                updates.append(f'"likeUri" = ${param_idx}')
                params.append(like_uri)
                param_idx += 1
            
            if repost_uri:
                updates.append(f'"repostUri" = ${param_idx}')
                params.append(repost_uri)
                param_idx += 1
            
            if bookmarked:
                updates.append('bookmarked = true')
            
            # Insert or update
            await conn.execute(
                f"""
                INSERT INTO "postViewerStates" ("postUri", "viewerDid", "likeUri", "repostUri", bookmarked, "threadMuted", "replyDisabled", "embeddingDisabled", pinned)
                VALUES ($1, $2, ${3 if like_uri else 'NULL'}, ${4 if repost_uri else 'NULL'}, ${'true' if bookmarked else 'false'}, false, false, false, false)
                ON CONFLICT ("postUri", "viewerDid") DO UPDATE SET
                    {', '.join(updates) if updates else '"likeUri" = "postViewerStates"."likeUri"'}
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
            
            # Handle reply - increment parent reply count and create thread context
            if parent_uri:
                await conn.execute(
                    'UPDATE "postAggregations" SET "replyCount" = "replyCount" + 1 WHERE "postUri" = $1',
                    parent_uri
                )
                
                # Create thread context
                if root_uri:
                    root_post = await conn.fetchrow('SELECT "authorDid" FROM posts WHERE uri = $1', root_uri)
                    if root_post:
                        # Check if root author liked this post
                        root_author_like = await conn.fetchrow(
                            'SELECT uri FROM likes WHERE "userDid" = $1 AND "postUri" = $2',
                            root_post['authorDid'], uri
                        )
                        
                        await conn.execute(
                            """
                            INSERT INTO "threadContexts" ("postUri", "rootAuthorLikeUri")
                            VALUES ($1, $2)
                            ON CONFLICT ("postUri") DO NOTHING
                            """,
                            uri, root_author_like['uri'] if root_author_like else None
                        )
                
                # Create reply notification
                parent_post = await conn.fetchrow('SELECT "authorDid" FROM posts WHERE uri = $1', parent_uri)
                if parent_post and parent_post['authorDid'] != author_did:
                    notif_uri = f"{uri}#notification/reply"
                    await self.create_notification(conn, notif_uri, parent_post['authorDid'], author_did, 'reply', uri, cid, created_at)
            
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
                    INSERT INTO quotes (uri, cid, "postUri", "quotedUri", "quotedCid", "createdAt")
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (uri) DO NOTHING
                    """,
                    quote_uri, cid, uri, quoted_uri, quoted_cid, created_at
                )
                
                # Increment quote count
                await conn.execute(
                    'UPDATE "postAggregations" SET "quoteCount" = "quoteCount" + 1 WHERE "postUri" = $1',
                    quoted_uri
                )
                
                # Create quote notification
                quoted_post = await conn.fetchrow('SELECT "authorDid" FROM posts WHERE uri = $1', quoted_uri)
                if quoted_post and quoted_post['authorDid'] != author_did:
                    notif_uri = f"{uri}#notification/quote"
                    await self.create_notification(conn, notif_uri, quoted_post['authorDid'], author_did, 'quote', uri, cid, created_at)
            
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
            INSERT INTO likes (uri, "userDid", "postUri", "createdAt")
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (uri) DO NOTHING
            """,
            uri, user_did, post_uri, created_at
        )
        
        # Increment like count
        await conn.execute(
            'UPDATE "postAggregations" SET "likeCount" = "likeCount" + 1 WHERE "postUri" = $1',
            post_uri
        )
        
        # Create viewer state
        await self.create_post_viewer_state(conn, post_uri, user_did, like_uri=uri)
        
        # Create like notification
        post = await conn.fetchrow('SELECT "authorDid" FROM posts WHERE uri = $1', post_uri)
        if post and post['authorDid'] != user_did:
            notif_uri = f"{uri}#notification"
            await self.create_notification(conn, notif_uri, post['authorDid'], user_did, 'like', post_uri, cid, created_at)
    
    async def process_like(
        self,
        conn: asyncpg.Connection,
        uri: str,
        user_did: str,
        post_uri: str,
        created_at: datetime,
        cid: Optional[str] = None
    ):
        """Process like creation"""
        await self.ensure_user(conn, user_did)
        
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
            INSERT INTO reposts (uri, "userDid", "postUri", "createdAt")
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (uri) DO NOTHING
            """,
            uri, user_did, post_uri, created_at
        )
        
        # Increment repost count
        await conn.execute(
            'UPDATE "postAggregations" SET "repostCount" = "repostCount" + 1 WHERE "postUri" = $1',
            post_uri
        )
        
        # Create viewer state
        await self.create_post_viewer_state(conn, post_uri, user_did, repost_uri=uri)
        
        # Create feed item
        await conn.execute(
            """
            INSERT INTO "feedItems" (uri, "postUri", "originatorDid", type, "sortAt", cid, "createdAt")
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (uri) DO NOTHING
            """,
            uri, post_uri, user_did, 'repost', created_at, cid, created_at
        )
        
        # Create repost notification
        post = await conn.fetchrow('SELECT "authorDid" FROM posts WHERE uri = $1', post_uri)
        if post and post['authorDid'] != user_did:
            notif_uri = f"{uri}#notification"
            await self.create_notification(conn, notif_uri, post['authorDid'], user_did, 'repost', post_uri, cid, created_at)
    
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
            INSERT INTO follows (uri, "followerDid", "followingDid", "createdAt")
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
        cid: Optional[str] = None
    ):
        """Process follow creation"""
        await self.ensure_user(conn, follower_did)
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
            INSERT INTO blocks (uri, "blockerDid", "blockedDid", "createdAt")
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
                INSERT INTO bookmarks (uri, "userDid", "postUri", "createdAt")
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, user_did, post_uri, created_at
            )
            
            # Increment bookmark count
            await conn.execute(
                'UPDATE "postAggregations" SET "bookmarkCount" = "bookmarkCount" + 1 WHERE "postUri" = $1',
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
                INSERT INTO lists (uri, cid, "creatorDid", name, purpose, description, "avatarUrl", "createdAt")
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
                INSERT INTO "listItems" (uri, cid, "listUri", "subjectDid", "createdAt")
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
                    INSERT INTO users (did, handle, "createdAt")
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
        """Process record deletion"""
        try:
            if collection == "app.bsky.feed.post":
                await conn.execute("DELETE FROM posts WHERE uri = $1", uri)
                await conn.execute('DELETE FROM "feedItems" WHERE uri = $1', uri)
            
            elif collection == "app.bsky.feed.like":
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
                    await conn.execute(
                        'DELETE FROM "postViewerStates" WHERE "postUri" = $1 AND "viewerDid" = $2',
                        like['postUri'], like['userDid']
                    )
            
            elif collection == "app.bsky.feed.repost":
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
                    await conn.execute(
                        'DELETE FROM "postViewerStates" WHERE "postUri" = $1 AND "viewerDid" = $2',
                        repost['postUri'], repost['userDid']
                    )
            
            elif collection == "app.bsky.bookmark":
                bookmark = await conn.fetchrow(
                    'SELECT "userDid", "postUri" FROM bookmarks WHERE uri = $1',
                    uri
                )
                if bookmark:
                    await conn.execute("DELETE FROM bookmarks WHERE uri = $1", uri)
                    await conn.execute(
                        'UPDATE "postAggregations" SET "bookmarkCount" = GREATEST("bookmarkCount" - 1, 0) WHERE "postUri" = $1',
                        bookmark['postUri']
                    )
            
            elif collection == "app.bsky.graph.follow":
                await conn.execute("DELETE FROM follows WHERE uri = $1", uri)
            
            elif collection == "app.bsky.graph.block":
                await conn.execute("DELETE FROM blocks WHERE uri = $1", uri)
            
            elif collection == "app.bsky.graph.list":
                await conn.execute("DELETE FROM lists WHERE uri = $1", uri)
            
            elif collection == "app.bsky.graph.listitem":
                await conn.execute('DELETE FROM "listItems" WHERE uri = $1', uri)
            
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
                                        await self.process_like(conn, uri, repo, post_uri, created_at, cid)
                                
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
                                        await self.process_follow(conn, uri, repo, following_did, created_at, cid)
                                
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
                f"(~{rate:.0f} events/sec) | "
                f"Pending: {self.total_pending_count} likes/reposts, "
                f"{self.total_pending_user_ops} follows/blocks, "
                f"{self.total_pending_list_items} list items"
            )
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get current metrics"""
        return {
            **self.metrics,
            'pending_count': self.total_pending_count,
            'pending_user_ops_count': self.total_pending_user_ops,
            'pending_list_items_count': self.total_pending_list_items,
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
            
            # Handle Identity messages
            elif isinstance(commit, models.ComAtprotoSyncSubscribeRepos.Identity):
                event_data = {
                    'did': commit.did,
                    'handle': commit.handle,
                }
                asyncio.create_task(self.event_processor.process_identity(event_data))
            
            # Handle Account messages
            elif isinstance(commit, models.ComAtprotoSyncSubscribeRepos.Account):
                event_data = {
                    'did': commit.did,
                    'active': commit.active,
                }
                asyncio.create_task(self.event_processor.process_account(event_data))
            
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
