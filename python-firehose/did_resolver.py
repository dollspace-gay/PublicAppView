#!/usr/bin/env python3
"""
DID Resolution Service for AT Protocol

Resolves DIDs to PDS endpoints, handles, and verifies identity.
Python port of server/services/did-resolver.ts
"""

import asyncio
import logging
import time
from typing import Optional, Dict, Any, Tuple
from collections import OrderedDict
import aiohttp
import aiodns

logger = logging.getLogger(__name__)


class LRUCache:
    """Simple LRU Cache with TTL support"""
    
    def __init__(self, max_size: int, ttl_ms: int):
        self.cache: OrderedDict = OrderedDict()
        self.max_size = max_size
        self.ttl_ms = ttl_ms
        
    def get(self, key: str) -> Optional[Any]:
        """Get value from cache if not expired"""
        if key not in self.cache:
            return None
            
        value, timestamp = self.cache[key]
        
        # Check if expired
        if (time.time() * 1000) - timestamp > self.ttl_ms:
            del self.cache[key]
            return None
            
        # Move to end (most recently used)
        self.cache.move_to_end(key)
        return value
        
    def set(self, key: str, value: Any):
        """Set value in cache with current timestamp"""
        # Remove if exists
        if key in self.cache:
            del self.cache[key]
            
        # Evict oldest if at capacity
        if len(self.cache) >= self.max_size:
            self.cache.popitem(last=False)
            
        self.cache[key] = (value, time.time() * 1000)
        
    def clear(self):
        """Clear all cache entries"""
        self.cache.clear()
        
    def size(self) -> int:
        """Get current cache size"""
        return len(self.cache)


class RequestQueue:
    """Request queue with concurrency limiting"""
    
    def __init__(self, max_concurrent: int):
        self.max_concurrent = max_concurrent
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.active_count = 0
        self.completed_count = 0
        self.failed_count = 0
        
    async def enqueue(self, operation):
        """Enqueue and execute operation with concurrency limit"""
        async with self.semaphore:
            self.active_count += 1
            try:
                result = await operation()
                self.completed_count += 1
                return result
            except Exception as e:
                self.failed_count += 1
                raise
            finally:
                self.active_count -= 1


class DIDResolver:
    """DID Resolution Service for AT Protocol"""
    
    def __init__(self):
        self.plc_directory = "https://plc.directory"
        self.max_retries = 3
        self.base_timeout = 15  # seconds
        self.retry_delay = 1.0  # seconds
        self.circuit_breaker_threshold = 5
        self.circuit_breaker_timeout = 60000  # ms
        self.failure_count = 0
        self.last_failure_time = 0
        self.circuit_open = False
        self.resolution_count = 0
        self.batch_log_size = 5000
        
        # Caching
        self.did_document_cache = LRUCache(100000, 24 * 60 * 60 * 1000)  # 24 hour TTL
        self.handle_cache = LRUCache(100000, 24 * 60 * 60 * 1000)
        self.cache_hits = 0
        self.cache_misses = 0
        
        # Request queue for rate limiting
        self.request_queue = RequestQueue(15)  # Max 15 concurrent requests
        
        # HTTP session
        self.session: Optional[aiohttp.ClientSession] = None
        
    async def initialize(self):
        """Initialize HTTP session"""
        if not self.session:
            self.session = aiohttp.ClientSession()
            
    async def close(self):
        """Close HTTP session"""
        if self.session:
            await self.session.close()
            self.session = None
            
    def is_circuit_open(self) -> bool:
        """Check if circuit breaker is open"""
        if not self.circuit_open:
            return False
            
        # Check if enough time has passed
        if (time.time() * 1000) - self.last_failure_time > self.circuit_breaker_timeout:
            self.circuit_open = False
            self.failure_count = 0
            logger.info("[DID_RESOLVER] Circuit breaker reset")
            return False
            
        return True
        
    def record_success(self):
        """Record successful operation"""
        self.failure_count = 0
        self.circuit_open = False
        
    def record_failure(self):
        """Record failed operation"""
        self.failure_count += 1
        self.last_failure_time = time.time() * 1000
        
        if self.failure_count >= self.circuit_breaker_threshold:
            self.circuit_open = True
            logger.warning(f"[DID_RESOLVER] Circuit breaker opened after {self.failure_count} failures")
            
    async def retry_with_backoff(self, operation, max_retries: int = None, base_delay: float = None):
        """Retry operation with exponential backoff"""
        max_retries = max_retries or self.max_retries
        base_delay = base_delay or self.retry_delay
        last_error = None
        
        for attempt in range(max_retries + 1):
            try:
                return await operation()
            except Exception as e:
                last_error = e
                
                if attempt == max_retries:
                    raise last_error
                    
                delay = base_delay * (2 ** attempt)
                logger.warning(f"[DID_RESOLVER] Attempt {attempt + 1} failed, retrying in {delay}s: {str(e)}")
                await asyncio.sleep(delay)
                
        raise last_error
        
    async def resolve_handle_via_dns(self, handle: str) -> Optional[str]:
        """Resolve handle to DID via DNS TXT record"""
        try:
            resolver = aiodns.DNSResolver()
            txt_records = await resolver.query(f"_atproto.{handle}", 'TXT')
            
            for record in txt_records:
                did = record.text.strip()
                if did.startswith('did:'):
                    if not (did.startswith('did:plc:') or did.startswith('did:web:')):
                        logger.warning(f"[DID_RESOLVER] Unsupported DID method in DNS for {handle}: {did}")
                    return did
                    
            return None
        except Exception as e:
            # DNS errors are common, don't log unless it's not NXDOMAIN
            if 'NXDOMAIN' not in str(e) and 'NODATA' not in str(e):
                logger.debug(f"[DID_RESOLVER] DNS error for {handle}: {str(e)}")
            return None
            
    async def resolve_handle_via_https(self, handle: str) -> Optional[str]:
        """Resolve handle to DID via HTTPS well-known endpoint"""
        try:
            url = f"https://{handle}/.well-known/atproto-did"
            timeout = aiohttp.ClientTimeout(total=self.base_timeout)
            
            async with self.session.get(url, headers={'Accept': 'text/plain'}, timeout=timeout) as response:
                if response.status == 404:
                    return None
                    
                if response.status != 200:
                    logger.warning(f"[DID_RESOLVER] HTTP {response.status} for {handle}/.well-known/atproto-did")
                    return None
                    
                did = (await response.text()).strip()
                
                # Check for HTML/JSON response
                if did.startswith('<') or did.startswith('{'):
                    return None
                    
                if not did.startswith('did:'):
                    return None
                    
                if not (did.startsWith('did:plc:') or did.startswith('did:web:')):
                    logger.warning(f"[DID_RESOLVER] Unsupported DID method for {handle}: {did}")
                    
                return did
        except asyncio.TimeoutError:
            logger.warning(f"[DID_RESOLVER] Timeout resolving {handle}/.well-known/atproto-did")
            return None
        except Exception as e:
            logger.debug(f"[DID_RESOLVER] HTTPS error for {handle}: {str(e)}")
            return None
            
    async def resolve_handle(self, handle: str) -> Optional[str]:
        """Resolve handle to DID"""
        try:
            # Try DNS first
            did = await self.resolve_handle_via_dns(handle)
            if did:
                return did
                
            # Fallback to HTTPS
            did = await self.resolve_handle_via_https(handle)
            return did
        except Exception as e:
            logger.error(f"[DID_RESOLVER] Error resolving handle {handle}: {str(e)}")
            return None
            
    async def resolve_plc_did(self, did: str) -> Optional[Dict[str, Any]]:
        """Resolve PLC DID to DID document"""
        if self.is_circuit_open():
            logger.warning(f"[DID_RESOLVER] Circuit breaker open, skipping PLC DID resolution for {did}")
            return None
            
        try:
            async def fetch_operation():
                return await self.retry_with_backoff(async_fetch)
                
            async def async_fetch():
                url = f"{self.plc_directory}/{did}"
                timeout = aiohttp.ClientTimeout(total=self.base_timeout)
                
                async with self.session.get(url, headers={'Accept': 'application/did+ld+json, application/json'}, timeout=timeout) as response:
                    if response.status == 404:
                        logger.warning(f"[DID_RESOLVER] DID not found in PLC: {did}")
                        return None
                        
                    if response.status >= 500:
                        raise Exception(f"PLC directory server error {response.status}")
                        
                    if response.status != 200:
                        raise Exception(f"HTTP {response.status}")
                        
                    data = await response.json()
                    
                    # Validate DID document
                    if not data or not isinstance(data, dict):
                        raise Exception("Invalid DID document: not an object")
                        
                    if not data.get('id'):
                        raise Exception("Invalid DID document: missing id")
                        
                    # Security: Verify DID matches
                    if data['id'] != did:
                        logger.error(f"[DID_RESOLVER] SECURITY: DID mismatch from PLC for {did}: document contains {data['id']}")
                        raise Exception(f"DID mismatch: expected {did}, got {data['id']}")
                        
                    return data
                    
            result = await self.request_queue.enqueue(fetch_operation)
            self.record_success()
            return result
        except Exception as e:
            self.record_failure()
            logger.error(f"[DID_RESOLVER] Error resolving PLC DID {did}: {str(e)}")
            return None
            
    async def resolve_web_did(self, did: str) -> Optional[Dict[str, Any]]:
        """Resolve Web DID to DID document"""
        try:
            async def fetch_operation():
                # Extract domain from did:web:example.com
                did_parts = did.replace('did:web:', '').split(':')
                domain = did_parts[0]
                path = '/' + '/'.join(did_parts[1:]) if len(did_parts) > 1 else ''
                
                # Construct URL
                if path:
                    url = f"https://{domain}{path}/did.json"
                else:
                    url = f"https://{domain}/.well-known/did.json"
                    
                logger.info(f"[DID_RESOLVER] Resolving Web DID from: {url}")
                
                timeout = aiohttp.ClientTimeout(total=self.base_timeout)
                async with self.session.get(url, headers={'Accept': 'application/did+ld+json, application/json'}, timeout=timeout) as response:
                    if response.status == 404:
                        logger.warning(f"[DID_RESOLVER] Web DID not found: {did} at {url}")
                        return None
                        
                    if response.status != 200:
                        raise Exception(f"HTTP {response.status}")
                        
                    data = await response.json()
                    
                    # Validate
                    if not data or not isinstance(data, dict):
                        raise Exception("Invalid DID document: not an object")
                        
                    if not data.get('id'):
                        raise Exception("Invalid DID document: missing id")
                        
                    # Security: Verify DID matches
                    if data['id'] != did:
                        logger.error(f"[DID_RESOLVER] SECURITY: DID mismatch for did:web {did}: document contains {data['id']}")
                        raise Exception(f"DID mismatch: expected {did}, got {data['id']}")
                        
                    return data
                    
            return await self.retry_with_backoff(fetch_operation)
        except Exception as e:
            logger.error(f"[DID_RESOLVER] Error resolving Web DID {did}: {str(e)}")
            return None
            
    async def resolve_did(self, did: str) -> Optional[Dict[str, Any]]:
        """Resolve DID to DID document"""
        # Check cache first
        cached = self.did_document_cache.get(did)
        if cached:
            self.cache_hits += 1
            return cached
            
        self.cache_misses += 1
        
        try:
            did_doc = None
            
            if did.startswith('did:plc:'):
                did_doc = await self.resolve_plc_did(did)
            elif did.startswith('did:web:'):
                did_doc = await self.resolve_web_did(did)
            else:
                logger.error(f"[DID_RESOLVER] Unsupported DID method: {did}")
                return None
                
            # Cache successful resolutions
            if did_doc:
                self.did_document_cache.set(did, did_doc)
                
            return did_doc
        except Exception as e:
            logger.error(f"[DID_RESOLVER] Error resolving DID {did}: {str(e)}")
            return None
            
    def get_pds_endpoint(self, did_doc: Dict[str, Any]) -> Optional[str]:
        """Extract PDS endpoint from DID document"""
        services = did_doc.get('service')
        if not services or not isinstance(services, list):
            logger.warning(f"[DID_RESOLVER] No services array in DID document for {did_doc.get('id')}")
            return None
            
        # Find AtprotoPersonalDataServer service
        for service in services:
            if service.get('id') in ['#atproto_pds', 'atproto_pds'] or \
               service.get('type') in ['AtprotoPersonalDataServer', 'AtProtoPersonalDataServer']:
                endpoint = service.get('serviceEndpoint')
                
                if not endpoint or not isinstance(endpoint, str):
                    logger.warning(f"[DID_RESOLVER] Invalid PDS endpoint format for {did_doc.get('id')}")
                    return None
                    
                if not (endpoint.startswith('https://') or endpoint.startswith('http://')):
                    logger.warning(f"[DID_RESOLVER] PDS endpoint must be HTTP(S) URL: {endpoint}")
                    return None
                    
                return endpoint
                
        logger.warning(f"[DID_RESOLVER] No PDS service found in DID document for {did_doc.get('id')}")
        return None
        
    def get_handle_from_did_document(self, did_doc: Dict[str, Any]) -> Optional[str]:
        """Extract handle from DID document"""
        also_known_as = did_doc.get('alsoKnownAs')
        if not also_known_as or not isinstance(also_known_as, list):
            return None
            
        # Find handle URI in alsoKnownAs (format: at://username.domain)
        for uri in also_known_as:
            if isinstance(uri, str) and uri.startswith('at://'):
                handle = uri.replace('at://', '')
                if handle and '.' in handle:
                    return handle
                    
        return None
        
    async def resolve_did_to_pds(self, did: str) -> Optional[str]:
        """Resolve DID directly to PDS endpoint"""
        try:
            did_doc = await self.resolve_did(did)
            if not did_doc:
                return None
                
            return self.get_pds_endpoint(did_doc)
        except Exception as e:
            logger.error(f"[DID_RESOLVER] Error resolving DID {did} to PDS: {str(e)}")
            return None
            
    async def resolve_did_to_handle(self, did: str) -> Optional[str]:
        """Resolve DID to handle"""
        # Check handle cache first
        cached_handle = self.handle_cache.get(did)
        if cached_handle:
            self.cache_hits += 1
            return cached_handle
            
        self.cache_misses += 1
        
        try:
            did_doc = await self.resolve_did(did)
            if not did_doc:
                logger.warning(f"[DID_RESOLVER] Could not resolve DID document for {did}")
                return None
                
            handle = self.get_handle_from_did_document(did_doc)
            if not handle:
                logger.warning(f"[DID_RESOLVER] No handle found in DID document for {did}")
                return None
                
            # Cache the handle mapping
            self.handle_cache.set(did, handle)
            
            # Batch logging
            self.resolution_count += 1
            if self.resolution_count % self.batch_log_size == 0:
                total_requests = self.cache_hits + self.cache_misses
                cache_hit_rate = (self.cache_hits / total_requests * 100) if total_requests > 0 else 0
                logger.info(f"[DID_RESOLVER] Resolved {self.batch_log_size} DIDs (total: {self.resolution_count}, cache hit rate: {cache_hit_rate:.1f}%)")
                
            return handle
        except Exception as e:
            logger.error(f"[DID_RESOLVER] Error resolving DID {did} to handle: {str(e)}")
            return None
            
    def clear_caches(self):
        """Clear all caches"""
        self.did_document_cache.clear()
        self.handle_cache.clear()
        self.cache_hits = 0
        self.cache_misses = 0
        logger.info("[DID_RESOLVER] Caches cleared")


# Global singleton instance
did_resolver = DIDResolver()
