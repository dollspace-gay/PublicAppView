#!/usr/bin/env python3
"""
PDS Data Fetcher Service

Fetches missing data from source PDS when entries are incomplete
due to missing referenced users or posts.
Python port of server/services/pds-data-fetcher.ts
"""

import asyncio
import logging
import time
from typing import Optional, Dict, Any, List
from collections import defaultdict
import aiohttp
import asyncpg

from did_resolver import did_resolver

logger = logging.getLogger(__name__)


class IncompleteEntry:
    """Represents an incomplete database entry needing data from PDS"""
    
    def __init__(self, entry_type: str, did: str, uri: Optional[str] = None, missing_data: Any = None):
        self.type = entry_type
        self.did = did
        self.uri = uri
        self.missing_data = missing_data
        self.retry_count = 0
        self.last_attempt = time.time() * 1000


class PDSDataFetcher:
    """Fetches missing data from Personal Data Servers"""
    
    def __init__(self, db_pool):
        self.db_pool = db_pool
        self.max_retry_attempts = 3
        self.retry_delay_ms = 30000  # 30 seconds
        self.fetch_timeout = 10  # seconds
        self.batch_log_size = 5000
        self.incomplete_entries: Dict[str, IncompleteEntry] = {}
        self.is_processing = False
        self.fetch_count = 0
        self.update_count = 0
        self.success_count = 0
        self.post_count = 0
        
        # HTTP session
        self.session: Optional[aiohttp.ClientSession] = None
        
        # Event processor reference (set after initialization)
        self.event_processor = None
        
    async def initialize(self):
        """Initialize HTTP session and start periodic processing"""
        if not self.session:
            self.session = aiohttp.ClientSession()
            
        # Initialize DID resolver
        await did_resolver.initialize()
        
        # Start periodic processing
        asyncio.create_task(self.periodic_processing())
        
    async def close(self):
        """Close HTTP session"""
        if self.session:
            await self.session.close()
            self.session = None
            
        await did_resolver.close()
        
    def sanitize_did(self, did: str) -> str:
        """Sanitize and validate DID format"""
        if not did:
            return ''
            
        original = did
        
        # Remove whitespace
        cleaned = did.replace(' ', '').replace('\t', '').replace('\n', '')
        
        # Remove duplicate colons
        cleaned = ':'.join(part for part in cleaned.split(':') if part)
        
        # Add back 'did:' prefix if it was removed
        if not cleaned.startswith('did:'):
            cleaned = 'did:' + cleaned
            
        # Remove trailing punctuation
        cleaned = cleaned.rstrip(':;,._-')
        
        if cleaned != original:
            logger.warning(f"[PDS_FETCHER] Cleaned malformed DID: '{original}' → '{cleaned}'")
            
        # Validate format
        if not cleaned.startswith('did:'):
            logger.warning(f"[PDS_FETCHER] Invalid DID format: '{cleaned}'")
            
        return cleaned
        
    def mark_incomplete(
        self,
        entry_type: str,
        did: str,
        uri: Optional[str] = None,
        missing_data: Any = None
    ):
        """Mark an entry as incomplete and needing data fetch"""
        clean_did = self.sanitize_did(did)
        key = f"{entry_type}:{clean_did}:{uri}" if uri else f"{entry_type}:{clean_did}"
        
        if key in self.incomplete_entries:
            self.incomplete_entries[key].retry_count += 1
            self.incomplete_entries[key].last_attempt = time.time() * 1000
            self.incomplete_entries[key].missing_data = missing_data or self.incomplete_entries[key].missing_data
        else:
            self.incomplete_entries[key] = IncompleteEntry(entry_type, clean_did, uri, missing_data)
            
    async def periodic_processing(self):
        """Periodically process incomplete entries every 30 seconds"""
        while True:
            await asyncio.sleep(30)
            
            if self.is_processing:
                continue
                
            try:
                await self.process_incomplete_entries()
            except Exception as e:
                logger.error(f"[PDS_FETCHER] Error in periodic processing: {str(e)}")
                
    async def process_incomplete_entries(self):
        """Process all incomplete entries"""
        if not self.incomplete_entries:
            return
            
        self.is_processing = True
        logger.info(f"[PDS_FETCHER] Processing {len(self.incomplete_entries)} incomplete entries...")
        
        entries = list(self.incomplete_entries.items())
        processed = 0
        success = 0
        
        for key, entry in entries:
            try:
                # Skip if too many retries
                if entry.retry_count >= self.max_retry_attempts:
                    logger.warning(f"[PDS_FETCHER] Max retries exceeded for {entry.type} {entry.uri or entry.did}")
                    
                    # For users, create minimal record
                    if entry.type == 'user':
                        try:
                            clean_did = self.sanitize_did(entry.did)
                            handle = await did_resolver.resolve_did_to_handle(clean_did)
                            
                            async with self.db_pool.acquire() as conn:
                                await conn.execute(
                                    """
                                    INSERT INTO users (did, handle, created_at)
                                    VALUES ($1, $2, NOW())
                                    ON CONFLICT (did) DO UPDATE SET handle = EXCLUDED.handle
                                    """,
                                    clean_did, handle or clean_did
                                )
                                
                            logger.info(f"[PDS_FETCHER] Created minimal user record for {clean_did}")
                            
                            # Flush pending operations
                            if self.event_processor:
                                await self.event_processor.flush_pending_user_ops(conn, clean_did)
                        except Exception as e:
                            logger.error(f"[PDS_FETCHER] Failed to create minimal user for {entry.did}: {str(e)}")
                            
                    del self.incomplete_entries[key]
                    continue
                    
                # Skip if recently attempted
                time_since_last = (time.time() * 1000) - entry.last_attempt
                if time_since_last < self.retry_delay_ms:
                    continue
                    
                # Fetch missing data
                result = await self.fetch_missing_data(entry)
                if result['success']:
                    success += 1
                    del self.incomplete_entries[key]
                    self.success_count += 1
                    
                    if self.success_count % self.batch_log_size == 0:
                        logger.info(f"[PDS_FETCHER] {self.batch_log_size} successful fetches (total: {self.success_count})")
                else:
                    logger.warning(f"[PDS_FETCHER] Failed to fetch {entry.type} {entry.uri or entry.did}: {result.get('error')}")
                    
                processed += 1
            except Exception as e:
                logger.error(f"[PDS_FETCHER] Error processing {entry.type} {entry.uri or entry.did}: {str(e)}")
                
        logger.info(f"[PDS_FETCHER] Processed {processed} entries, {success} successful, {len(self.incomplete_entries)} remaining")
        self.is_processing = False
        
    async def fetch_missing_data(self, entry: IncompleteEntry) -> Dict[str, Any]:
        """Fetch missing data from PDS"""
        try:
            clean_did = self.sanitize_did(entry.did)
            
            # Validate DID format
            if not (clean_did.startswith('did:plc:') or clean_did.startswith('did:web:')):
                return {'success': False, 'error': f'Invalid DID format: {clean_did}'}
                
            # Resolve DID to PDS endpoint
            pds_endpoint = await did_resolver.resolve_did_to_pds(clean_did)
            if not pds_endpoint:
                return {'success': False, 'error': f'Could not resolve PDS endpoint for DID: {clean_did}'}
                
            # Batch logging
            self.fetch_count += 1
            if self.fetch_count % self.batch_log_size == 0:
                logger.info(f"[PDS_FETCHER] Fetched data for {self.batch_log_size} entries (total: {self.fetch_count})")
                
            # Route to appropriate handler
            if entry.type == 'user':
                return await self.fetch_user_data(clean_did, pds_endpoint)
            elif entry.type == 'post':
                return await self.fetch_post_data(clean_did, entry.uri, pds_endpoint)
            elif entry.type in ['list', 'listitem', 'feedgen', 'starterpack', 'labeler', 'record']:
                return await self.fetch_record_by_uri(entry.uri, pds_endpoint)
            elif entry.type in ['like', 'repost', 'follow']:
                # Ensure the actor exists first
                return await self.fetch_user_data(clean_did, pds_endpoint)
            else:
                return {'success': False, 'error': f'Unknown entry type: {entry.type}'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
            
    async def fetch_user_data(self, did: str, pds_endpoint: str) -> Dict[str, Any]:
        """Fetch user profile data from PDS"""
        try:
            encoded_did = aiohttp.helpers.quote(did, safe='')
            url = f"{pds_endpoint}/xrpc/com.atproto.repo.getRecord?repo={encoded_did}&collection=app.bsky.actor.profile&rkey=self"
            
            timeout = aiohttp.ClientTimeout(total=self.fetch_timeout)
            async with self.session.get(url, headers={'Accept': 'application/json'}, timeout=timeout) as response:
                if response.status == 400:
                    text = await response.text()
                    if 'RecordNotFound' in text:
                        # Account exists but has no profile
                        handle = await did_resolver.resolve_did_to_handle(did)
                        
                        async with self.db_pool.acquire() as conn:
                            await conn.execute(
                                """
                                INSERT INTO users (did, handle, created_at)
                                VALUES ($1, $2, NOW())
                                ON CONFLICT (did) DO UPDATE SET handle = EXCLUDED.handle
                                """,
                                did, handle or did
                            )
                            
                        logger.warning(f"[PDS_FETCHER] No profile record at PDS for {did} - created minimal user")
                        
                        # Flush pending operations
                        if self.event_processor:
                            async with self.db_pool.acquire() as conn:
                                await self.event_processor.flush_pending_user_ops(conn, did)
                                
                        return {'success': True, 'data': {'did': did, 'handle': handle or did, 'profile': None}}
                        
                if response.status != 200:
                    error_text = await response.text()
                    return {'success': False, 'error': f'Profile fetch failed: {response.status} - {error_text[:200]}'}
                    
                data = await response.json()
                profile = data.get('value')
                
                if profile:
                    handle = await did_resolver.resolve_did_to_handle(did)
                    
                    # Extract avatar and banner CIDs
                    avatar_cid = self.extract_blob_cid(profile.get('avatar'))
                    banner_cid = self.extract_blob_cid(profile.get('banner'))
                    
                    # Update user with full profile
                    async with self.db_pool.acquire() as conn:
                        await conn.execute(
                            """
                            INSERT INTO users (did, handle, display_name, description, avatar_url, banner_url, created_at)
                            VALUES ($1, $2, $3, $4, $5, $6, NOW())
                            ON CONFLICT (did) DO UPDATE SET
                                handle = EXCLUDED.handle,
                                display_name = EXCLUDED.display_name,
                                description = EXCLUDED.description,
                                avatar_url = EXCLUDED.avatar_url,
                                banner_url = EXCLUDED.banner_url
                            """,
                            did, handle or did, profile.get('displayName'), profile.get('description'), avatar_cid, banner_cid
                        )
                        
                    self.update_count += 1
                    if self.update_count % self.batch_log_size == 0:
                        logger.info(f"[PDS_FETCHER] Updated {self.batch_log_size} users (total: {self.update_count})")
                        
                    # Flush pending operations
                    if self.event_processor:
                        async with self.db_pool.acquire() as conn:
                            await self.event_processor.flush_pending_user_ops(conn, did)
                            
                    return {'success': True, 'data': {'did': did, 'handle': handle or did, 'profile': profile}}
                else:
                    return {'success': False, 'error': 'No profile record found'}
        except asyncio.TimeoutError:
            return {'success': False, 'error': 'Timeout'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
            
    async def fetch_post_data(self, author_did: str, post_uri: str, pds_endpoint: str) -> Dict[str, Any]:
        """Fetch post data from PDS"""
        try:
            # Extract collection and rkey from URI
            uri_parts = post_uri.split('/')
            collection = uri_parts[-2]
            rkey = uri_parts[-1]
            
            # URL encode parameters
            encoded_did = aiohttp.helpers.quote(author_did, safe='')
            encoded_collection = aiohttp.helpers.quote(collection, safe='')
            encoded_rkey = aiohttp.helpers.quote(rkey, safe='')
            
            url = f"{pds_endpoint}/xrpc/com.atproto.repo.getRecord?repo={encoded_did}&collection={encoded_collection}&rkey={encoded_rkey}"
            
            timeout = aiohttp.ClientTimeout(total=self.fetch_timeout)
            async with self.session.get(url, headers={'Accept': 'application/json'}, timeout=timeout) as response:
                if response.status in [400, 404]:
                    text = await response.text()
                    if 'RecordNotFound' in text:
                        logger.warning(f"[PDS_FETCHER] Post not found (deleted): {post_uri}")
                        return {'success': True, 'data': None}  # Treat as success to stop retrying
                        
                if response.status != 200:
                    error_text = await response.text()
                    return {'success': False, 'error': f'Record fetch failed: {response.status} - {error_text[:200]}'}
                    
                record_data = await response.json()
                
                if record_data.get('uri') and record_data.get('cid') and record_data.get('value'):
                    # Process the post record via event processor
                    if self.event_processor:
                        await self.event_processor.process_record(
                            record_data['uri'],
                            record_data['cid'],
                            author_did,
                            record_data['value']
                        )
                        
                    self.post_count += 1
                    if self.post_count % self.batch_log_size == 0:
                        logger.info(f"[PDS_FETCHER] Fetched and processed {self.batch_log_size} posts (total: {self.post_count})")
                        
                    return {'success': True, 'data': record_data}
                else:
                    return {'success': False, 'error': 'Record response missing required fields'}
        except asyncio.TimeoutError:
            return {'success': False, 'error': 'Timeout'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
            
    async def fetch_record_by_uri(self, uri: str, pds_endpoint: str) -> Dict[str, Any]:
        """Fetch any record by AT URI"""
        try:
            repo, collection, rkey = self.parse_at_uri(uri)
            
            # URL encode parameters
            encoded_repo = aiohttp.helpers.quote(repo, safe='')
            encoded_collection = aiohttp.helpers.quote(collection, safe='')
            encoded_rkey = aiohttp.helpers.quote(rkey, safe='')
            
            url = f"{pds_endpoint}/xrpc/com.atproto.repo.getRecord?repo={encoded_repo}&collection={encoded_collection}&rkey={encoded_rkey}"
            
            timeout = aiohttp.ClientTimeout(total=self.fetch_timeout)
            async with self.session.get(url, headers={'Accept': 'application/json'}, timeout=timeout) as response:
                if response.status in [400, 404]:
                    text = await response.text()
                    if 'RecordNotFound' in text:
                        logger.warning(f"[PDS_FETCHER] Record not found (deleted): {uri}")
                        return {'success': True, 'data': None}
                        
                if response.status != 200:
                    error_text = await response.text()
                    return {'success': False, 'error': f'Record fetch failed: {response.status} - {error_text[:200]}'}
                    
                record_data = await response.json()
                
                if record_data.get('uri') and record_data.get('cid') and record_data.get('value'):
                    # Process via event processor
                    if self.event_processor:
                        await self.event_processor.process_record(
                            record_data['uri'],
                            record_data['cid'],
                            repo,
                            record_data['value']
                        )
                        
                    return {'success': True, 'data': record_data}
                else:
                    return {'success': False, 'error': 'Record response missing required fields'}
        except asyncio.TimeoutError:
            return {'success': False, 'error': 'Timeout'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
            
    def parse_at_uri(self, uri: str) -> tuple:
        """Parse AT URI of form at://did:.../collection/rkey"""
        parts = uri.split('/')
        if len(parts) < 5:
            raise ValueError(f"Invalid AT URI: {uri}")
            
        # parts: ['at:', '', 'did:plc:...', 'app.bsky.collection', 'rkey']
        repo = parts[2]
        collection = parts[3]
        rkey = parts[4]
        return repo, collection, rkey
        
    def extract_blob_cid(self, blob: Any) -> Optional[str]:
        """Extract CID from blob reference"""
        if not blob:
            return None
            
        if isinstance(blob, str):
            return None if blob == 'undefined' else blob
            
        if isinstance(blob, dict):
            ref = blob.get('ref')
            if isinstance(ref, str):
                return None if ref == 'undefined' else ref
            elif isinstance(ref, dict):
                link = ref.get('$link')
                if link:
                    return None if link == 'undefined' else link
                # Handle binary CID (would need additional processing)
                if 'code' in ref and 'multihash' in ref:
                    # For simplicity, try to call toString if it's an object
                    if hasattr(ref, '__str__'):
                        return str(ref)
                        
            cid = blob.get('cid')
            if cid:
                return None if cid == 'undefined' else cid
                
        return None
        
    def get_stats(self) -> Dict[str, Any]:
        """Get statistics about incomplete entries"""
        stats = {
            'total': len(self.incomplete_entries),
            'by_type': {},
            'by_retry_count': {},
            'oldest_entry': 0
        }
        
        oldest_time = time.time() * 1000
        
        for entry in self.incomplete_entries.values():
            # Count by type
            stats['by_type'][entry.type] = stats['by_type'].get(entry.type, 0) + 1
            
            # Count by retry count
            stats['by_retry_count'][entry.retry_count] = stats['by_retry_count'].get(entry.retry_count, 0) + 1
            
            # Find oldest
            if entry.last_attempt < oldest_time:
                oldest_time = entry.last_attempt
                
        stats['oldest_entry'] = (time.time() * 1000) - oldest_time
        
        return stats
