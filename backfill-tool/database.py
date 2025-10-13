"""
Database adapter for PostgreSQL connection and operations.

Provides async database operations for the backfill tool.
"""

import asyncio
from datetime import datetime
from typing import Optional, Dict, Any, List
import asyncpg
from urllib.parse import urlparse


class DatabaseAdapter:
    """Async PostgreSQL database adapter"""
    
    def __init__(self, database_url: str):
        self.database_url = database_url
        self.pool: Optional[asyncpg.Pool] = None
        
    async def connect(self, pool_size: int = 10):
        """Connect to PostgreSQL database"""
        # Parse DATABASE_URL
        parsed = urlparse(self.database_url)
        
        # Create connection pool
        self.pool = await asyncpg.create_pool(
            host=parsed.hostname,
            port=parsed.port or 5432,
            user=parsed.username,
            password=parsed.password,
            database=parsed.path.lstrip('/'),
            min_size=2,
            max_size=pool_size,
            command_timeout=60,
        )
        
    async def close(self):
        """Close database connection pool"""
        if self.pool:
            await self.pool.close()
            
    async def execute(self, query: str, *args) -> str:
        """Execute a query that doesn't return results"""
        async with self.pool.acquire() as conn:
            return await conn.execute(query, *args)
            
    async def fetch(self, query: str, *args) -> List[asyncpg.Record]:
        """Fetch multiple rows"""
        async with self.pool.acquire() as conn:
            return await conn.fetch(query, *args)
            
    async def fetchrow(self, query: str, *args) -> Optional[asyncpg.Record]:
        """Fetch a single row"""
        async with self.pool.acquire() as conn:
            return await conn.fetchrow(query, *args)
            
    async def fetchval(self, query: str, *args) -> Any:
        """Fetch a single value"""
        async with self.pool.acquire() as conn:
            return await conn.fetchval(query, *args)
    
    # ===== User Operations =====
    
    async def ensure_user(self, did: str, handle: str = None) -> Dict[str, Any]:
        """Ensure user exists, create if not"""
        # Check if user exists
        user = await self.fetchrow(
            "SELECT did, handle FROM users WHERE did = $1",
            did
        )
        
        if user:
            return dict(user)
        
        # Create user
        handle = handle or 'handle.invalid'
        await self.execute(
            """
            INSERT INTO users (did, handle, indexed_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (did) DO NOTHING
            """,
            did, handle
        )
        
        return {'did': did, 'handle': handle}
    
    # ===== Post Operations =====
    
    async def create_post(self, post_data: Dict[str, Any]) -> bool:
        """Create a post record"""
        try:
            await self.execute(
                """
                INSERT INTO posts (
                    uri, cid, author_did, text, created_at, indexed_at,
                    reply_parent, reply_root, embed_type, embed_uri,
                    langs, labels, tags
                )
                VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (uri) DO NOTHING
                """,
                post_data.get('uri'),
                post_data.get('cid'),
                post_data.get('author_did'),
                post_data.get('text'),
                post_data.get('created_at'),
                post_data.get('reply_parent'),
                post_data.get('reply_root'),
                post_data.get('embed_type'),
                post_data.get('embed_uri'),
                post_data.get('langs', []),
                post_data.get('labels', []),
                post_data.get('tags', []),
            )
            return True
        except Exception as e:
            # Ignore duplicate key errors
            if '23505' in str(e):  # Duplicate key
                return False
            raise
    
    # ===== Like Operations =====
    
    async def create_like(self, like_data: Dict[str, Any]) -> bool:
        """Create a like record"""
        try:
            await self.execute(
                """
                INSERT INTO likes (uri, cid, author_did, subject_uri, created_at, indexed_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (uri) DO NOTHING
                """,
                like_data.get('uri'),
                like_data.get('cid'),
                like_data.get('author_did'),
                like_data.get('subject_uri'),
                like_data.get('created_at'),
            )
            return True
        except Exception as e:
            if '23505' in str(e):
                return False
            raise
    
    # ===== Repost Operations =====
    
    async def create_repost(self, repost_data: Dict[str, Any]) -> bool:
        """Create a repost record"""
        try:
            await self.execute(
                """
                INSERT INTO reposts (uri, cid, author_did, subject_uri, created_at, indexed_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (uri) DO NOTHING
                """,
                repost_data.get('uri'),
                repost_data.get('cid'),
                repost_data.get('author_did'),
                repost_data.get('subject_uri'),
                repost_data.get('created_at'),
            )
            return True
        except Exception as e:
            if '23505' in str(e):
                return False
            raise
    
    # ===== Follow Operations =====
    
    async def create_follow(self, follow_data: Dict[str, Any]) -> bool:
        """Create a follow record"""
        try:
            await self.execute(
                """
                INSERT INTO follows (uri, cid, author_did, subject_did, created_at, indexed_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (uri) DO NOTHING
                """,
                follow_data.get('uri'),
                follow_data.get('cid'),
                follow_data.get('author_did'),
                follow_data.get('subject_did'),
                follow_data.get('created_at'),
            )
            return True
        except Exception as e:
            if '23505' in str(e):
                return False
            raise
    
    # ===== Block Operations =====
    
    async def create_block(self, block_data: Dict[str, Any]) -> bool:
        """Create a block record"""
        try:
            await self.execute(
                """
                INSERT INTO blocks (uri, cid, author_did, subject_did, created_at, indexed_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (uri) DO NOTHING
                """,
                block_data.get('uri'),
                block_data.get('cid'),
                block_data.get('author_did'),
                block_data.get('subject_did'),
                block_data.get('created_at'),
            )
            return True
        except Exception as e:
            if '23505' in str(e):
                return False
            raise
    
    # ===== Profile Operations =====
    
    async def update_profile(self, profile_data: Dict[str, Any]) -> bool:
        """Update user profile"""
        try:
            await self.execute(
                """
                UPDATE users
                SET 
                    display_name = $2,
                    description = $3,
                    avatar = $4,
                    banner = $5,
                    updated_at = NOW()
                WHERE did = $1
                """,
                profile_data.get('did'),
                profile_data.get('display_name'),
                profile_data.get('description'),
                profile_data.get('avatar'),
                profile_data.get('banner'),
            )
            return True
        except Exception as e:
            raise
    
    # ===== Delete Operations =====
    
    async def delete_record(self, uri: str, collection: str) -> bool:
        """Delete a record by URI"""
        try:
            if collection == 'app.bsky.feed.post':
                await self.execute("DELETE FROM posts WHERE uri = $1", uri)
            elif collection == 'app.bsky.feed.like':
                await self.execute("DELETE FROM likes WHERE uri = $1", uri)
            elif collection == 'app.bsky.feed.repost':
                await self.execute("DELETE FROM reposts WHERE uri = $1", uri)
            elif collection == 'app.bsky.graph.follow':
                await self.execute("DELETE FROM follows WHERE uri = $1", uri)
            elif collection == 'app.bsky.graph.block':
                await self.execute("DELETE FROM blocks WHERE uri = $1", uri)
            return True
        except Exception as e:
            return False
    
    # ===== Progress Tracking =====
    
    async def save_backfill_progress(
        self, 
        cursor: int, 
        events_processed: int,
        last_update_time: datetime
    ):
        """Save backfill progress"""
        encoded_cursor = f"{cursor}|{events_processed}"
        await self.execute(
            """
            INSERT INTO firehose_cursor (service, cursor, last_event_time)
            VALUES ('backfill_python', $1, $2)
            ON CONFLICT (service) 
            DO UPDATE SET cursor = $1, last_event_time = $2
            """,
            encoded_cursor,
            last_update_time
        )
    
    async def get_backfill_progress(self) -> Optional[Dict[str, Any]]:
        """Get saved backfill progress"""
        row = await self.fetchrow(
            "SELECT cursor, last_event_time FROM firehose_cursor WHERE service = 'backfill_python'"
        )
        
        if not row:
            return None
        
        # Decode cursor|events format
        cursor_str = row['cursor'] or ''
        parts = cursor_str.split('|')
        cursor = int(parts[0]) if parts[0] else 0
        events_processed = int(parts[1]) if len(parts) > 1 and parts[1] else 0
        
        return {
            'cursor': cursor,
            'events_processed': events_processed,
            'last_update_time': row['last_event_time']
        }
