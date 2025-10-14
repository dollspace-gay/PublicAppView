#!/usr/bin/env python3
"""
Python Redis Consumer Worker

Replaces 32 TypeScript workers with a single Python process that:
1. Consumes events from Redis streams (XREADGROUP)
2. Processes events to PostgreSQL
3. Maintains high throughput with async processing

Architecture:
- Python Firehose Reader → Redis Stream → This Worker → PostgreSQL
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
import redis.asyncio as redis


# Configure logging
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, log_level),
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


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
    """Process AT Protocol events from Redis and write to PostgreSQL"""
    
    def __init__(self, db_pool: DatabasePool):
        self.db = db_pool
        self.event_count = 0
        self.start_time = time.time()
        
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
                        INSERT INTO users (did, handle, created_at)
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
    
    async def process_post(
        self,
        conn: asyncpg.Connection,
        uri: str,
        cid: str,
        author_did: str,
        record: Dict[str, Any]
    ):
        """Process post creation"""
        await self.ensure_user(conn, author_did)
        
        text = record.get('text', '')
        reply = record.get('reply')
        embed = record.get('embed')
        facets = record.get('facets')
        created_at = self.safe_date(record.get('createdAt'))
        
        # Serialize embed and facets as JSON
        embed_json = json.dumps(embed) if embed else None
        facets_json = json.dumps(facets) if facets else None
        
        parent_uri = None
        root_uri = None
        if reply:
            parent_uri = reply.get('parent', {}).get('uri')
            root_uri = reply.get('root', {}).get('uri')
        
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
            
            logger.debug(f"Created post: {uri}")
        except asyncpg.exceptions.UniqueViolationError:
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
                INSERT INTO likes (uri, user_did, post_uri, created_at)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, user_did, post_uri, created_at
            )
            
            # Increment like count
            await conn.execute(
                """
                UPDATE post_aggregations
                SET like_count = like_count + 1
                WHERE post_uri = $1
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
                INSERT INTO reposts (uri, user_did, post_uri, created_at)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, user_did, post_uri, created_at
            )
            
            # Increment repost count
            await conn.execute(
                """
                UPDATE post_aggregations
                SET repost_count = repost_count + 1
                WHERE post_uri = $1
                """,
                post_uri
            )
            
            # Create feed item
            await conn.execute(
                """
                INSERT INTO feed_items (uri, post_uri, originator_did, type, sort_at, cid, created_at)
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
                INSERT INTO follows (uri, follower_did, following_did, created_at)
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
        
        try:
            await conn.execute(
                """
                INSERT INTO blocks (uri, blocker_did, blocked_did, created_at)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, blocker_did, blocked_did, created_at
            )
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
                """
                UPDATE post_aggregations
                SET bookmark_count = bookmark_count + 1
                WHERE post_uri = $1
                """,
                post_uri
            )
            
            logger.debug(f"Created bookmark: {uri}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating bookmark {uri}: {e}")
    
    async def process_profile(
        self,
        conn: asyncpg.Connection,
        did: str,
        record: Dict[str, Any]
    ):
        """Process profile update"""
        display_name = record.get('displayName')
        description = record.get('description')
        avatar_url = None
        banner_url = None
        
        # Extract avatar/banner CIDs
        avatar = record.get('avatar')
        if avatar and isinstance(avatar, dict):
            avatar_url = avatar.get('ref', {}).get('$link') if isinstance(avatar.get('ref'), dict) else avatar.get('ref')
        
        banner = record.get('banner')
        if banner and isinstance(banner, dict):
            banner_url = banner.get('ref', {}).get('$link') if isinstance(banner.get('ref'), dict) else banner.get('ref')
        
        profile_json = json.dumps(record)
        
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
                did, 'handle.invalid', display_name, description, avatar_url, banner_url, profile_json
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
        record: Dict[str, Any]
    ):
        """Process list creation"""
        await self.ensure_user(conn, creator_did)
        
        name = record.get('name', '')
        purpose = record.get('purpose', '')
        description = record.get('description')
        avatar_url = None
        
        avatar = record.get('avatar')
        if avatar and isinstance(avatar, dict):
            avatar_url = avatar.get('ref', {}).get('$link') if isinstance(avatar.get('ref'), dict) else avatar.get('ref')
        
        created_at = self.safe_date(record.get('createdAt'))
        
        try:
            await conn.execute(
                """
                INSERT INTO lists (uri, cid, creator_did, name, purpose, description, avatar_url, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, cid, creator_did, name, purpose, description, avatar_url, created_at
            )
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
        record: Dict[str, Any]
    ):
        """Process feed generator creation"""
        await self.ensure_user(conn, creator_did)
        
        did = record.get('did', '')
        display_name = record.get('displayName', '')
        description = record.get('description')
        avatar_url = None
        
        avatar = record.get('avatar')
        if avatar and isinstance(avatar, dict):
            avatar_url = avatar.get('ref', {}).get('$link') if isinstance(avatar.get('ref'), dict) else avatar.get('ref')
        
        created_at = self.safe_date(record.get('createdAt'))
        
        try:
            await conn.execute(
                """
                INSERT INTO feed_generators (uri, cid, creator_did, did, display_name, description, avatar_url, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, cid, creator_did, did, display_name, description, avatar_url, created_at
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
        record: Dict[str, Any]
    ):
        """Process starter pack creation"""
        await self.ensure_user(conn, creator_did)
        
        name = record.get('name', '')
        description = record.get('description')
        list_uri = record.get('list')
        feeds = [f.get('uri') for f in record.get('feeds', []) if isinstance(f, dict) and 'uri' in f]
        feeds_json = json.dumps(feeds) if feeds else None
        created_at = self.safe_date(record.get('createdAt'))
        
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
        record: Dict[str, Any]
    ):
        """Process labeler service creation"""
        await self.ensure_user(conn, creator_did)
        
        policies = record.get('policies', {'labelValues': [], 'labelValueDefinitions': []})
        policies_json = json.dumps(policies)
        created_at = self.safe_date(record.get('createdAt'))
        
        try:
            await conn.execute(
                """
                INSERT INTO labeler_services (uri, cid, creator_did, policies, created_at)
                VALUES ($1, $2, $3, $4::jsonb, $5)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, cid, creator_did, policies_json, created_at
            )
            logger.info(f"Created labeler service: {uri}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating labeler service {uri}: {e}")
    
    async def process_label(
        self,
        conn: asyncpg.Connection,
        uri: str,
        src: str,
        record: Dict[str, Any]
    ):
        """Process label creation"""
        subject = record.get('uri') or record.get('did')
        val = record.get('val', '')
        neg = record.get('neg', False)
        created_at = self.safe_date(record.get('createdAt'))
        
        if not subject or not val:
            return
        
        try:
            await conn.execute(
                """
                INSERT INTO labels (uri, src, subject, val, neg, created_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, src, subject, val, neg, created_at
            )
            logger.info(f"Applied label {val} to {subject} from {src}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error applying label {uri}: {e}")
    
    async def process_verification(
        self,
        conn: asyncpg.Connection,
        uri: str,
        cid: str,
        creator_did: str,
        record: Dict[str, Any]
    ):
        """Process verification creation"""
        await self.ensure_user(conn, creator_did)
        
        subject_did = record.get('subject', creator_did)
        handle = record.get('handle', '')
        verified_at = self.safe_date(record.get('verifiedAt'))
        created_at = self.safe_date(record.get('createdAt'))
        
        try:
            await conn.execute(
                """
                INSERT INTO verifications (uri, cid, subject_did, handle, verified_at, created_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, cid, subject_did, handle, verified_at, created_at
            )
            logger.info(f"Created verification: {uri} for {subject_did}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating verification {uri}: {e}")
    
    async def process_generic_record(
        self,
        conn: asyncpg.Connection,
        uri: str,
        cid: str,
        author_did: str,
        record: Dict[str, Any]
    ):
        """Process generic/unknown record types"""
        record_type = record.get('$type', 'unknown')
        created_at = self.safe_date(record.get('createdAt'))
        record_json = json.dumps(record)
        
        try:
            await conn.execute(
                """
                INSERT INTO "genericRecords" (uri, cid, "authorDid", "recordType", record, "createdAt")
                VALUES ($1, $2, $3, $4, $5::jsonb, $6)
                ON CONFLICT (uri) DO NOTHING
                """,
                uri, cid, author_did, record_type, record_json, created_at
            )
            logger.info(f"Created generic record: {record_type} - {uri}")
        except asyncpg.exceptions.UniqueViolationError:
            pass
        except Exception as e:
            logger.error(f"Error creating generic record {uri}: {e}")
    
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
            
            elif collection == "app.bsky.feed.generator":
                await conn.execute('DELETE FROM "feedGenerators" WHERE uri = $1', uri)
            
            elif collection == "app.bsky.graph.starterpack":
                await conn.execute('DELETE FROM "starterPacks" WHERE uri = $1', uri)
            
            elif collection == "app.bsky.labeler.service":
                await conn.execute('DELETE FROM "labelerServices" WHERE uri = $1', uri)
            
            elif collection == "com.atproto.label.label":
                await conn.execute("DELETE FROM labels WHERE uri = $1", uri)
            
            elif collection == "app.bsky.graph.verification":
                await conn.execute("DELETE FROM verifications WHERE uri = $1", uri)
            
            elif collection == "app.bsky.feed.postgate":
                await conn.execute('DELETE FROM "postGates" WHERE uri = $1', uri)
            
            elif collection == "app.bsky.feed.threadgate":
                await conn.execute('DELETE FROM "threadGates" WHERE uri = $1', uri)
            
            elif collection == "app.bsky.graph.listblock":
                await conn.execute('DELETE FROM "listBlocks" WHERE uri = $1', uri)
            
            elif collection == "app.bsky.notification.declaration":
                await conn.execute('DELETE FROM "notificationDeclarations" WHERE uri = $1', uri)
            
            else:
                # Unknown record type - try to delete from generic records
                await conn.execute('DELETE FROM "genericRecords" WHERE uri = $1', uri)
            
            logger.debug(f"Deleted {collection}: {uri}")
        except Exception as e:
            logger.error(f"Error deleting {uri}: {e}")
    
    async def process_commit(self, event_data: Dict[str, Any]):
        """Process a commit event from Redis"""
        repo = event_data.get('repo')
        ops = event_data.get('ops', [])
        
        if not repo or not ops:
            return
        
        # Acquire database connection and process in transaction
        async with self.db.acquire() as conn:
            async with conn.transaction():
                for op in ops:
                    action = op.get('action')
                    path = op.get('path')
                    record = op.get('record')
                    cid = op.get('cid')
                    
                    if not path:
                        continue
                    
                    collection = path.split("/")[0]
                    uri = f"at://{repo}/{path}"
                    
                    try:
                        if action in ["create", "update"] and record:
                            record_type = record.get('$type')
                            
                            if record_type == "app.bsky.feed.post":
                                await self.process_post(conn, uri, cid, repo, record)
                            
                            elif record_type == "app.bsky.feed.like":
                                post_uri = record.get('subject', {}).get('uri')
                                if post_uri:
                                    created_at = self.safe_date(record.get('createdAt'))
                                    await self.process_like(conn, uri, repo, post_uri, created_at)
                            
                            elif record_type == "app.bsky.feed.repost":
                                post_uri = record.get('subject', {}).get('uri')
                                if post_uri:
                                    created_at = self.safe_date(record.get('createdAt'))
                                    await self.process_repost(conn, uri, repo, post_uri, cid, created_at)
                            
                            elif record_type == "app.bsky.bookmark":
                                post_uri = record.get('subject', {}).get('uri')
                                if post_uri:
                                    created_at = self.safe_date(record.get('createdAt'))
                                    await self.process_bookmark(conn, uri, repo, post_uri, created_at)
                            
                            elif record_type == "app.bsky.graph.follow":
                                following_did = record.get('subject')
                                if following_did:
                                    created_at = self.safe_date(record.get('createdAt'))
                                    await self.process_follow(conn, uri, repo, following_did, created_at)
                            
                            elif record_type == "app.bsky.graph.block":
                                blocked_did = record.get('subject')
                                if blocked_did:
                                    created_at = self.safe_date(record.get('createdAt'))
                                    await self.process_block(conn, uri, repo, blocked_did, created_at)
                            
                            elif record_type == "app.bsky.actor.profile":
                                await self.process_profile(conn, repo, record)
                            
                            elif record_type == "app.bsky.graph.list":
                                await self.process_list(conn, uri, cid, repo, record)
                            
                            elif record_type == "app.bsky.graph.listitem":
                                list_uri = record.get('list')
                                subject_did = record.get('subject')
                                if list_uri and subject_did:
                                    created_at = self.safe_date(record.get('createdAt'))
                                    await self.process_list_item(conn, uri, cid, list_uri, subject_did, created_at)
                            
                            elif record_type == "app.bsky.feed.generator":
                                await self.process_feed_generator(conn, uri, cid, repo, record)
                            
                            elif record_type == "app.bsky.graph.starterpack":
                                await self.process_starter_pack(conn, uri, cid, repo, record)
                            
                            elif record_type == "app.bsky.labeler.service":
                                await self.process_labeler_service(conn, uri, cid, repo, record)
                            
                            elif record_type == "com.atproto.label.label":
                                await self.process_label(conn, uri, repo, record)
                            
                            elif record_type == "app.bsky.graph.verification":
                                await self.process_verification(conn, uri, cid, repo, record)
                            
                            elif record_type in ["app.bsky.feed.postgate", "app.bsky.feed.threadgate", 
                                               "app.bsky.graph.listblock", "app.bsky.notification.declaration"]:
                                # These are metadata records - just log them
                                logger.debug(f"Processed {record_type}: {uri}")
                            
                            else:
                                # Unknown record type - store as generic record
                                await self.process_generic_record(conn, uri, cid, repo, record)
                        
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
    
    async def process_identity(self, event_data: Dict[str, Any]):
        """Process identity event"""
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
                logger.debug(f"Updated handle: {did} -> {handle}")
            except Exception as e:
                logger.error(f"Error updating identity {did}: {e}")
    
    async def process_account(self, event_data: Dict[str, Any]):
        """Process account event"""
        did = event_data.get('did')
        active = event_data.get('active', True)
        
        logger.debug(f"Account event: {did} - active: {active}")
        # Could update user status if needed


class RedisConsumerWorker:
    """Worker that consumes from Redis streams and processes to PostgreSQL"""
    
    def __init__(
        self,
        redis_url: str,
        database_url: str,
        stream_key: str = "firehose:events",
        consumer_group: str = "firehose-processors",
        consumer_id: str = "python-worker",
        db_pool_size: int = 20,
        batch_size: int = 10,
        parallel_consumers: int = 5,
    ):
        self.redis_url = redis_url
        self.database_url = database_url
        self.stream_key = stream_key
        self.consumer_group = consumer_group
        self.consumer_id = consumer_id
        self.db_pool_size = db_pool_size
        self.batch_size = batch_size
        self.parallel_consumers = parallel_consumers
        
        self.redis_client: Optional[redis.Redis] = None
        self.db_pool: Optional[DatabasePool] = None
        self.event_processor: Optional[EventProcessor] = None
        self.running = False
        
    async def initialize(self):
        """Initialize connections"""
        logger.info("Initializing Redis consumer worker...")
        
        # Connect to Redis
        logger.info(f"Connecting to Redis at {self.redis_url}...")
        self.redis_client = redis.from_url(
            self.redis_url,
            decode_responses=True,
            socket_keepalive=True,
        )
        await self.redis_client.ping()
        logger.info("Connected to Redis")
        
        # Ensure consumer group exists
        try:
            await self.redis_client.xgroup_create(
                self.stream_key,
                self.consumer_group,
                id="0",
                mkstream=True
            )
            logger.info(f"Created consumer group: {self.consumer_group}")
        except redis.ResponseError as e:
            if "BUSYGROUP" in str(e):
                logger.info(f"Consumer group {self.consumer_group} already exists")
            else:
                raise
        
        # Create database pool
        self.db_pool = DatabasePool(self.database_url, self.db_pool_size)
        await self.db_pool.connect()
        
        # Create event processor
        self.event_processor = EventProcessor(self.db_pool)
        
        logger.info("Worker initialized successfully")
    
    async def consume_events(self, pipeline_id: int):
        """Consumer pipeline - runs in parallel"""
        consumer_name = f"{self.consumer_id}-{pipeline_id}"
        logger.info(f"Starting consumer pipeline {pipeline_id}: {consumer_name}")
        
        while self.running:
            try:
                # Read from Redis stream with consumer group
                # Block for 100ms if no messages
                results = await self.redis_client.xreadgroup(
                    groupname=self.consumer_group,
                    consumername=consumer_name,
                    streams={self.stream_key: ">"},
                    count=self.batch_size,
                    block=100,
                )
                
                if not results:
                    continue
                
                # Process messages
                for stream_name, messages in results:
                    for message_id, fields in messages:
                        try:
                            # Parse event from Redis
                            event_type = fields.get('type')
                            event_data = json.loads(fields.get('data', '{}'))
                            
                            # Route to appropriate handler
                            if event_type == "commit":
                                await self.event_processor.process_commit(event_data)
                            elif event_type == "identity":
                                await self.event_processor.process_identity(event_data)
                            elif event_type == "account":
                                await self.event_processor.process_account(event_data)
                            
                            # Acknowledge message
                            await self.redis_client.xack(
                                self.stream_key,
                                self.consumer_group,
                                message_id
                            )
                        
                        except Exception as e:
                            logger.error(f"Error processing message {message_id}: {e}")
                            # Still acknowledge to prevent retry loop
                            await self.redis_client.xack(
                                self.stream_key,
                                self.consumer_group,
                                message_id
                            )
            
            except redis.ResponseError as e:
                if "NOGROUP" in str(e):
                    logger.warning("Consumer group missing, recreating...")
                    await asyncio.sleep(1)
                    await self.initialize()
                else:
                    logger.error(f"Redis error in pipeline {pipeline_id}: {e}")
                    await asyncio.sleep(1)
            
            except Exception as e:
                logger.error(f"Error in consumer pipeline {pipeline_id}: {e}")
                await asyncio.sleep(1)
    
    async def run(self):
        """Run the worker with multiple parallel consumer pipelines"""
        self.running = True
        
        logger.info(f"Starting {self.parallel_consumers} parallel consumer pipelines...")
        
        # Create multiple consumer pipelines
        tasks = [
            asyncio.create_task(self.consume_events(i))
            for i in range(self.parallel_consumers)
        ]
        
        try:
            await asyncio.gather(*tasks)
        except asyncio.CancelledError:
            logger.info("Consumer tasks cancelled")
    
    async def stop(self):
        """Gracefully stop the worker"""
        logger.info("Stopping Redis consumer worker...")
        self.running = False
        
        # Close connections
        if self.redis_client:
            await self.redis_client.close()
        
        if self.db_pool:
            await self.db_pool.close()
        
        logger.info("Worker stopped")


async def main():
    """Main entry point"""
    # Configuration from environment
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    database_url = os.getenv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/atproto")
    stream_key = os.getenv("REDIS_STREAM_KEY", "firehose:events")
    consumer_group = os.getenv("REDIS_CONSUMER_GROUP", "firehose-processors")
    consumer_id = os.getenv("CONSUMER_ID", "python-worker")
    db_pool_size = int(os.getenv("DB_POOL_SIZE", "20"))
    batch_size = int(os.getenv("BATCH_SIZE", "10"))
    parallel_consumers = int(os.getenv("PARALLEL_CONSUMERS", "5"))
    
    logger.info("=" * 60)
    logger.info("Python Redis Consumer Worker")
    logger.info("Replaces 32 TypeScript workers with single process")
    logger.info("=" * 60)
    logger.info(f"Redis URL:            {redis_url}")
    logger.info(f"Stream Key:           {stream_key}")
    logger.info(f"Consumer Group:       {consumer_group}")
    logger.info(f"Consumer ID:          {consumer_id}")
    logger.info(f"Database Pool:        {db_pool_size} connections")
    logger.info(f"Parallel Consumers:   {parallel_consumers}")
    logger.info(f"Batch Size:           {batch_size}")
    logger.info("=" * 60)
    
    # Create worker
    worker = RedisConsumerWorker(
        redis_url=redis_url,
        database_url=database_url,
        stream_key=stream_key,
        consumer_group=consumer_group,
        consumer_id=consumer_id,
        db_pool_size=db_pool_size,
        batch_size=batch_size,
        parallel_consumers=parallel_consumers,
    )
    
    # Initialize
    await worker.initialize()
    
    # Handle signals for graceful shutdown
    loop = asyncio.get_event_loop()
    
    def signal_handler():
        logger.info("Received shutdown signal")
        asyncio.create_task(worker.stop())
        loop.stop()
    
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, signal_handler)
    
    # Run worker
    try:
        await worker.run()
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received")
    finally:
        await worker.stop()


if __name__ == "__main__":
    asyncio.run(main())
