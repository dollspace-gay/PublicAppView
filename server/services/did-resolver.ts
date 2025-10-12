/**
 * DID Resolution Service for AT Protocol
 * 
 * Resolves DIDs to PDS endpoints and verifies identity
 */

import { smartConsole } from './console-wrapper';
import { isUrlSafeToFetch } from '../utils/security';
import { promises as dnsPromises } from 'dns';

interface DIDDocument {
  id: string;
  alsoKnownAs?: string[];
  verificationMethod?: any[];
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
}

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

interface QueuedRequest<T> {
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
}

/**
 * Simple LRU Cache implementation
 */
class LRUCache<K, V> {
  private cache: Map<K, CacheEntry<V>>;
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number, ttlMs: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttlMs;
  }

  get(key: K): V | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    // Remove if exists (to update position)
    this.cache.delete(key);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  has(key: K): boolean {
    return this.get(key) !== null;
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  getStats(): { size: number; maxSize: number; ttl: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl,
    };
  }
}

/**
 * Request Queue with concurrency limiting
 */
class RequestQueue {
  private queue: QueuedRequest<any>[] = [];
  private activeCount = 0;
  private maxConcurrent: number;
  private queuedCount = 0;
  private completedCount = 0;
  private failedCount = 0;

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ operation, resolve, reject });
      this.queuedCount++;
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const request = this.queue.shift();
    if (!request) return;

    this.activeCount++;
    this.queuedCount--;

    try {
      const result = await request.operation();
      this.completedCount++;
      request.resolve(result);
    } catch (error) {
      this.failedCount++;
      request.reject(error);
    } finally {
      this.activeCount--;
      this.processQueue(); // Process next item
    }
  }

  getStats(): { 
    queued: number; 
    active: number; 
    completed: number;
    failed: number;
    maxConcurrent: number;
  } {
    return {
      queued: this.queue.length,
      active: this.activeCount,
      completed: this.completedCount,
      failed: this.failedCount,
      maxConcurrent: this.maxConcurrent,
    };
  }

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = max;
    // Process queue in case we increased concurrency
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      this.processQueue();
    }
  }
}

export class DIDResolver {
  private plcDirectory = "https://plc.directory";
  private maxRetries = 3;
  private baseTimeout = 15000; // 15 seconds base timeout
  private retryDelay = 1000; // 1 second initial delay
  private circuitBreakerThreshold = 5; // Number of consecutive failures before circuit opens
  private circuitBreakerTimeout = 60000; // 1 minute circuit breaker timeout
  private failureCount = 0;
  private lastFailureTime = 0;
  private circuitOpen = false;
  private resolutionCount = 0;
  private readonly BATCH_LOG_SIZE = 5000;
  
  // Caching
  private didDocumentCache: LRUCache<string, DIDDocument>;
  private handleCache: LRUCache<string, string>;
  private cacheHits = 0;
  private cacheMisses = 0;
  
  // Request queue for rate limiting
  private requestQueue: RequestQueue;
  
  constructor() {
    // Cache up to 100k DID documents with 24 hour TTL
    this.didDocumentCache = new LRUCache(100000, 24 * 60 * 60 * 1000);
    // Cache up to 100k handle mappings with 24 hour TTL
    this.handleCache = new LRUCache(100000, 24 * 60 * 60 * 1000);
    // Limit to 15 concurrent requests to plc.directory
    this.requestQueue = new RequestQueue(15);
  }

  /**
   * Configure resolver settings
   */
  configure(options: {
    maxRetries?: number;
    baseTimeout?: number;
    retryDelay?: number;
    circuitBreakerThreshold?: number;
    circuitBreakerTimeout?: number;
    maxConcurrentRequests?: number;
    cacheTTL?: number;
    cacheSize?: number;
  }) {
    if (options.maxRetries !== undefined) this.maxRetries = options.maxRetries;
    if (options.baseTimeout !== undefined) this.baseTimeout = options.baseTimeout;
    if (options.retryDelay !== undefined) this.retryDelay = options.retryDelay;
    if (options.circuitBreakerThreshold !== undefined) this.circuitBreakerThreshold = options.circuitBreakerThreshold;
    if (options.circuitBreakerTimeout !== undefined) this.circuitBreakerTimeout = options.circuitBreakerTimeout;
    if (options.maxConcurrentRequests !== undefined) this.requestQueue.setMaxConcurrent(options.maxConcurrentRequests);
    
    // Recreate caches if size/TTL changed
    if (options.cacheSize !== undefined || options.cacheTTL !== undefined) {
      const size = options.cacheSize || 100000;
      const ttl = options.cacheTTL || 24 * 60 * 60 * 1000;
      this.didDocumentCache = new LRUCache(size, ttl);
      this.handleCache = new LRUCache(size, ttl);
      smartConsole.log(`[DID_RESOLVER] Cache recreated with size: ${size}, TTL: ${ttl}ms`);
    }
  }

  /**
   * Check if circuit breaker is open
   */
  private isCircuitOpen(): boolean {
    if (!this.circuitOpen) {
      return false;
    }
    
    // Check if enough time has passed to try again
    if (Date.now() - this.lastFailureTime > this.circuitBreakerTimeout) {
      this.circuitOpen = false;
      this.failureCount = 0;
      smartConsole.log('[DID_RESOLVER] Circuit breaker reset, attempting resolution again');
      return false;
    }
    
    return true;
  }

  /**
   * Record a successful operation
   */
  private recordSuccess(): void {
    this.failureCount = 0;
    this.circuitOpen = false;
  }

  /**
   * Record a failed operation
   */
  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.circuitBreakerThreshold) {
      this.circuitOpen = true;
      smartConsole.warn(`[DID_RESOLVER] Circuit breaker opened after ${this.failureCount} consecutive failures`);
    }
  }

  /**
   * Retry utility with exponential backoff
   */
  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = this.maxRetries,
    baseDelay: number = this.retryDelay
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on the last attempt
        if (attempt === maxRetries) {
          throw lastError;
        }
        
        // Calculate delay with exponential backoff
        const delay = baseDelay * Math.pow(2, attempt);
        
        // Log specific error types
        if (error instanceof Error) {
          if (error.name === 'TimeoutError') {
            smartConsole.warn(`[DID_RESOLVER] Timeout on attempt ${attempt + 1}, retrying in ${delay}ms`);
          } else if (error.message.includes('fetch')) {
            smartConsole.warn(`[DID_RESOLVER] Network error on attempt ${attempt + 1}, retrying in ${delay}ms:`, error.message);
          } else {
            smartConsole.warn(`[DID_RESOLVER] Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error.message);
          }
        } else {
          smartConsole.warn(`[DID_RESOLVER] Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error);
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError!;
  }

  /**
   * Resolve a handle to a DID
   */
  async resolveHandle(handle: string): Promise<string | null> {
    try {
      // Try DNS TXT record first (more decentralized)
      const didFromDNS = await this.resolveHandleViaDNS(handle);
      if (didFromDNS) {
        return didFromDNS;
      }

      // Fallback to HTTPS well-known endpoint
      const didFromHTTPS = await this.resolveHandleViaHTTPS(handle);
      return didFromHTTPS;
    } catch (error) {
      smartConsole.error(`[DID_RESOLVER] Error resolving handle ${handle}:`, error);
      return null;
    }
  }

  private async resolveHandleViaDNS(handle: string): Promise<string | null> {
    try {
      // Resolve DNS TXT record for _atproto subdomain
      const txtRecords = await dnsPromises.resolveTxt(`_atproto.${handle}`);
      
      // TXT records come as arrays of strings (each record can have multiple parts)
      // We need to find the one that looks like a DID
      for (const record of txtRecords) {
        // Join the parts of the TXT record (usually just one part)
        const txtValue = Array.isArray(record) ? record.join('') : record;
        const did = txtValue.trim();
        
        // Validate DID format
        if (did.startsWith('did:')) {
          // Validate it's a supported DID method
          if (!did.startsWith('did:plc:') && !did.startsWith('did:web:')) {
            smartConsole.warn(`[DID_RESOLVER] Unsupported DID method in DNS for ${handle}: ${did}`);
          }
          return did;
        }
      }
      
      // No valid DID found in TXT records
      return null;
    } catch (error) {
      // DNS lookup errors are common for domains without _atproto records
      // Don't log these as errors - just return null and try HTTPS fallback
      if (error instanceof Error) {
        // Only log if it's not a NOTFOUND/NODATA error
        if (!error.message.includes('ENOTFOUND') && !error.message.includes('ENODATA')) {
          smartConsole.warn(`[DID_RESOLVER] DNS error for ${handle}:`, error.message);
        }
      }
      return null;
    }
  }

  private async resolveHandleViaHTTPS(handle: string): Promise<string | null> {
    try {
      const response = await fetch(`https://${handle}/.well-known/atproto-did`, {
        headers: { 
          'Accept': 'text/plain',
          'User-Agent': 'AT-Protocol-DID-Resolver/1.0'
        },
        signal: AbortSignal.timeout(this.baseTimeout),
      });

      if (!response.ok) {
        if (response.status === 404) {
          // 404 is expected for domains without AT Protocol configuration
          // Don't log warnings for this common case
          return null;
        }
        // Only log warnings for unexpected status codes (not 404)
        smartConsole.warn(`[DID_RESOLVER] HTTP ${response.status} for ${handle}/.well-known/atproto-did`);
        return null;
      }

      const contentType = response.headers.get('content-type') || '';
      const responseText = await response.text();
      const did = responseText.trim();
      
      // Check if response looks like HTML or JSON (common error case for misconfigured domains)
      // This happens when the domain has a website but no AT Protocol configuration
      if (did.startsWith('<') || did.startsWith('{') || contentType.includes('html') || contentType.includes('json')) {
        // Don't log warnings for every occurrence - this is a common configuration issue
        // that won't be fixed by retrying. Only log once at debug level.
        if (Math.random() < 0.01) { // Log 1% of occurrences to avoid spam
          smartConsole.warn(`[DID_RESOLVER] Domain ${handle} returns ${contentType} instead of AT Protocol DID (likely has website but no AT Protocol config)`);
        }
        return null;
      }
      
      // Validate DID format (must start with did: and have a method)
      if (!did.startsWith('did:')) {
        // Invalid format - don't log warning, just return null
        // This is a configuration issue, not a transient error
        return null;
      }
      
      // Validate it's a supported DID method
      if (!did.startsWith('did:plc:') && !did.startsWith('did:web:')) {
        smartConsole.warn(`[DID_RESOLVER] Unsupported DID method for ${handle}: ${did}`);
        // Don't throw - still return it as it might be valid
      }

      return did;
    } catch (error) {
      // Only log errors for network issues, not configuration problems
      if (error instanceof Error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
          smartConsole.warn(`[DID_RESOLVER] Timeout resolving ${handle}/.well-known/atproto-did`);
        } else if (error.message.includes('fetch') || error.message.includes('network')) {
          smartConsole.warn(`[DID_RESOLVER] Network error for ${handle}:`, error.message);
        }
        // Don't log other errors - they're likely configuration issues
      }
      return null;
    }
  }

  /**
   * Resolve a DID to its DID document
   */
  async resolveDID(did: string): Promise<DIDDocument | null> {
    // Check cache first
    const cached = this.didDocumentCache.get(did);
    if (cached) {
      this.cacheHits++;
      return cached;
    }
    
    this.cacheMisses++;
    
    try {
      let didDoc: DIDDocument | null = null;
      
      if (did.startsWith('did:plc:')) {
        didDoc = await this.resolvePLCDID(did);
      } else if (did.startsWith('did:web:')) {
        didDoc = await this.resolveWebDID(did);
      } else {
        smartConsole.error(`[DID_RESOLVER] Unsupported DID method: ${did}`);
        return null;
      }
      
      // Cache successful resolutions
      if (didDoc) {
        this.didDocumentCache.set(did, didDoc);
      }
      
      return didDoc;
    } catch (error) {
      smartConsole.error(`[DID_RESOLVER] Error resolving DID ${did}:`, error);
      return null;
    }
  }

  private async resolvePLCDID(did: string): Promise<DIDDocument | null> {
    // Check circuit breaker
    if (this.isCircuitOpen()) {
      smartConsole.warn(`[DID_RESOLVER] Circuit breaker is open, skipping PLC DID resolution for ${did}`);
      return null;
    }

    try {
      // Queue the request to limit concurrency
      const result = await this.requestQueue.enqueue(async () => {
        return await this.retryWithBackoff(async () => {
          const plcUrl = `${this.plcDirectory}/${did}`;
          const response = await fetch(plcUrl, {
            headers: { 
              'Accept': 'application/did+ld+json, application/json',
              'User-Agent': 'AT-Protocol-DID-Resolver/1.0'
            },
            signal: AbortSignal.timeout(this.baseTimeout),
          });

        if (!response.ok) {
          if (response.status === 404) {
            smartConsole.warn(`[DID_RESOLVER] DID not found in PLC directory: ${did}`);
            return null;
          }
          if (response.status >= 500) {
            throw new Error(`PLC directory server error ${response.status}: ${response.statusText}`);
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        // Accept both application/json and application/did+ld+json (official DID document media type)
        if (!contentType.includes('application/json') && !contentType.includes('application/did+ld+json')) {
          smartConsole.warn(`[DID_RESOLVER] Unexpected content type from PLC directory for ${did}: ${contentType}`);
        }

        const data = await response.json();
        
        // Validate the response is a proper DID document
        if (!data || typeof data !== 'object') {
          smartConsole.warn(`[DID_RESOLVER] Invalid DID document format from PLC for ${did}: not an object`);
          throw new Error('Invalid DID document format: not an object');
        }
        
        if (!data.id) {
          smartConsole.warn(`[DID_RESOLVER] Invalid DID document format from PLC for ${did}: missing id field`);
          throw new Error('Invalid DID document format: missing id');
        }
        
        // Verify the DID in the document matches what we requested
        if (data.id !== did) {
          smartConsole.warn(`[DID_RESOLVER] DID mismatch from PLC for ${did}: document contains ${data.id}`);
        }
        
          return data;
        });
      });
      
      // Record success
      this.recordSuccess();
      return result;
    } catch (error) {
      // Record failure
      this.recordFailure();
      
      if (error instanceof Error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
          smartConsole.error(`[DID_RESOLVER] Timeout resolving PLC DID ${did} after ${this.maxRetries + 1} attempts`);
        } else if (error.message.includes('fetch') || error.message.includes('network')) {
          smartConsole.error(`[DID_RESOLVER] Network error resolving PLC DID ${did}:`, error.message);
        } else {
          smartConsole.error(`[DID_RESOLVER] Error resolving PLC DID ${did}:`, error.message);
        }
      } else {
        smartConsole.error(`[DID_RESOLVER] Unknown error resolving PLC DID ${did}:`, error);
      }
      return null;
    }
  }

  private async resolveWebDID(did: string): Promise<DIDDocument | null> {
    try {
      return await this.retryWithBackoff(async () => {
        // Extract domain from did:web:example.com format
        // Support both simple domain (did:web:example.com) and path-based (did:web:example.com:path:to:did)
        const didParts = did.replace('did:web:', '').split(':');
        const domain = didParts[0];
        const path = didParts.length > 1 ? '/' + didParts.slice(1).join('/') : '';
        
        // Construct the URL for the DID document
        const didDocUrl = path 
          ? `https://${domain}${path}/did.json`
          : `https://${domain}/.well-known/did.json`;
        
        smartConsole.log(`[DID_RESOLVER] Resolving Web DID from: ${didDocUrl}`);
        
        const response = await fetch(didDocUrl, {
          headers: { 
            'Accept': 'application/did+ld+json, application/json',
            'User-Agent': 'AT-Protocol-DID-Resolver/1.0'
          },
          signal: AbortSignal.timeout(this.baseTimeout),
        });

        if (!response.ok) {
          if (response.status === 404) {
            smartConsole.warn(`[DID_RESOLVER] Web DID not found: ${did} at ${didDocUrl}`);
            return null;
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        // Accept both application/json and application/did+ld+json (official DID document media type)
        if (!contentType.includes('application/json') && !contentType.includes('application/did+ld+json')) {
          smartConsole.warn(`[DID_RESOLVER] Unexpected content type for Web DID ${did}: ${contentType}`);
        }

        const data = await response.json();
        
        // Validate the response is a proper DID document
        if (!data || typeof data !== 'object') {
          smartConsole.warn(`[DID_RESOLVER] Invalid DID document format for ${did}: not an object`);
          throw new Error('Invalid DID document format: not an object');
        }
        
        if (!data.id) {
          smartConsole.warn(`[DID_RESOLVER] Invalid DID document format for ${did}: missing id field`);
          throw new Error('Invalid DID document format: missing id');
        }
        
        // Verify the DID in the document matches what we requested
        if (data.id !== did) {
          smartConsole.warn(`[DID_RESOLVER] DID mismatch for ${did}: document contains ${data.id}`);
          // Don't throw - some implementations might use different formats
        }
        
        return data;
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'TimeoutError') {
          smartConsole.error(`[DID_RESOLVER] Timeout resolving Web DID ${did} after ${this.maxRetries + 1} attempts`);
        } else if (error.message.includes('fetch')) {
          smartConsole.error(`[DID_RESOLVER] Network error resolving Web DID ${did}:`, error.message);
        } else {
          smartConsole.error(`[DID_RESOLVER] Error resolving Web DID ${did}:`, error.message);
        }
      } else {
        smartConsole.error(`[DID_RESOLVER] Unknown error resolving Web DID ${did}:`, error);
      }
      return null;
    }
  }

  /**
   * Extract PDS endpoint from DID document
   * Supports both public and privately owned PDS instances
   */
  getPDSEndpoint(didDoc: DIDDocument): string | null {
    if (!didDoc.service || !Array.isArray(didDoc.service)) {
      smartConsole.warn(`[DID_RESOLVER] No services array found in DID document for ${didDoc.id}`);
      return null;
    }

    // Find the AtprotoPersonalDataServer service
    // Support multiple formats for compatibility with different PDS implementations
    const pdsService = didDoc.service.find(
      (service) =>
        service.id === '#atproto_pds' ||
        service.id === 'atproto_pds' ||
        service.type === 'AtprotoPersonalDataServer' ||
        service.type === 'AtProtoPersonalDataServer'
    );

    if (!pdsService) {
      smartConsole.warn(`[DID_RESOLVER] No PDS service found in DID document for ${didDoc.id}`);
      smartConsole.warn(`[DID_RESOLVER] Available services: ${didDoc.service.map(s => `${s.id}:${s.type}`).join(', ')}`);
      return null;
    }

    const endpoint = pdsService.serviceEndpoint;
    
    // Validate endpoint is a valid URL
    if (!endpoint || typeof endpoint !== 'string') {
      smartConsole.warn(`[DID_RESOLVER] Invalid PDS endpoint format for ${didDoc.id}: ${endpoint}`);
      return null;
    }
    
    // Ensure endpoint is a valid HTTPS URL (required for AT Protocol)
    if (!endpoint.startsWith('https://') && !endpoint.startsWith('http://')) {
      smartConsole.warn(`[DID_RESOLVER] PDS endpoint must be HTTP(S) URL for ${didDoc.id}: ${endpoint}`);
      return null;
    }

    // Validate URL to prevent SSRF attacks
    if (!isUrlSafeToFetch(endpoint)) {
      smartConsole.warn(`[DID_RESOLVER] PDS endpoint failed security validation for ${didDoc.id}: ${endpoint}`);
      return null;
    }

    return endpoint;
  }

  /**
   * Verify that a DID document confirms the handle
   */
  verifyHandle(didDoc: DIDDocument, handle: string): boolean {
    if (!didDoc.alsoKnownAs) {
      return false;
    }

    const expectedUri = `at://${handle}`;
    return didDoc.alsoKnownAs.includes(expectedUri);
  }

  /**
   * Full resolution: handle → DID → PDS endpoint
   */
  async resolveHandleToPDS(handle: string): Promise<{
    did: string;
    pdsEndpoint: string;
  } | null> {
    try {
      // Step 1: Resolve handle to DID
      const did = await this.resolveHandle(handle);
      if (!did) {
        smartConsole.error(`[DID_RESOLVER] Could not resolve handle ${handle} to DID`);
        return null;
      }

      // Step 2: Resolve DID to DID document
      const didDoc = await this.resolveDID(did);
      if (!didDoc) {
        smartConsole.error(`[DID_RESOLVER] Could not resolve DID ${did} to document`);
        return null;
      }

      // Step 3: Verify bidirectional mapping
      if (!this.verifyHandle(didDoc, handle)) {
        smartConsole.error(`[DID_RESOLVER] Handle ${handle} not confirmed in DID document`);
        return null;
      }

      // Step 4: Extract PDS endpoint
      const pdsEndpoint = this.getPDSEndpoint(didDoc);
      if (!pdsEndpoint) {
        smartConsole.error(`[DID_RESOLVER] No PDS endpoint found in DID document for ${did}`);
        return null;
      }

      return { did, pdsEndpoint };
    } catch (error) {
      smartConsole.error(`[DID_RESOLVER] Error resolving handle ${handle} to PDS:`, error);
      return null;
    }
  }

  /**
   * Resolve DID directly to PDS endpoint
   */
  async resolveDIDToPDS(did: string): Promise<string | null> {
    try {
      const didDoc = await this.resolveDID(did);
      if (!didDoc) {
        return null;
      }

      return this.getPDSEndpoint(didDoc);
    } catch (error) {
      smartConsole.error(`[DID_RESOLVER] Error resolving DID ${did} to PDS:`, error);
      return null;
    }
  }

  /**
   * Extract Feed Generator service endpoint from DID document
   */
  getFeedGeneratorEndpoint(didDoc: DIDDocument): string | null {
    if (!didDoc.service) {
      return null;
    }

    const feedService = didDoc.service.find(
      (service) =>
        service.id === '#bsky_fg' ||
        service.type === 'BskyFeedGenerator'
    );

    if (!feedService) {
      return null;
    }

    const endpoint = feedService.serviceEndpoint;
    
    // Validate endpoint format and security
    if (!endpoint || typeof endpoint !== 'string') {
      smartConsole.warn(`[DID_RESOLVER] Invalid Feed Generator endpoint format for ${didDoc.id}: ${endpoint}`);
      return null;
    }
    
    if (!endpoint.startsWith('https://') && !endpoint.startsWith('http://')) {
      smartConsole.warn(`[DID_RESOLVER] Feed Generator endpoint must be HTTP(S) URL for ${didDoc.id}: ${endpoint}`);
      return null;
    }

    // Validate URL to prevent SSRF attacks
    if (!isUrlSafeToFetch(endpoint)) {
      smartConsole.warn(`[DID_RESOLVER] Feed Generator endpoint failed security validation for ${didDoc.id}: ${endpoint}`);
      return null;
    }

    return endpoint;
  }

  /**
   * Resolve DID directly to Feed Generator service endpoint
   */
  async resolveDIDToFeedGenerator(did: string): Promise<string | null> {
    try {
      const didDoc = await this.resolveDID(did);
      if (!didDoc) {
        return null;
      }

      return this.getFeedGeneratorEndpoint(didDoc);
    } catch (error) {
      smartConsole.error(`[DID_RESOLVER] Error resolving DID ${did} to Feed Generator:`, error);
      return null;
    }
  }

  /**
   * Extract handle from DID document
   * Supports handles from both public and privately owned PDS instances
   */
  getHandleFromDIDDocument(didDoc: DIDDocument): string | null {
    if (!didDoc.alsoKnownAs || !Array.isArray(didDoc.alsoKnownAs) || didDoc.alsoKnownAs.length === 0) {
      return null;
    }

    // Find handle URI in alsoKnownAs field (format: at://username.domain)
    const handleUri = didDoc.alsoKnownAs.find(uri => 
      typeof uri === 'string' && uri.startsWith('at://')
    );
    
    if (handleUri) {
      const handle = handleUri.replace('at://', '');
      // Validate handle format (should be domain-like)
      if (handle && handle.includes('.')) {
        return handle;
      }
      smartConsole.warn(`[DID_RESOLVER] Invalid handle format in alsoKnownAs for ${didDoc.id}: ${handle}`);
    }

    // Log available alsoKnownAs values for debugging
    smartConsole.warn(`[DID_RESOLVER] No valid handle found in alsoKnownAs for ${didDoc.id}:`, didDoc.alsoKnownAs);
    return null;
  }

  /**
   * Get resolver status for monitoring
   */
  getStatus(): {
    circuitOpen: boolean;
    failureCount: number;
    lastFailureTime: number;
    maxRetries: number;
    baseTimeout: number;
    cache: {
      didDocuments: { size: number; maxSize: number; ttl: number };
      handles: { size: number; maxSize: number; ttl: number };
      hitRate: string;
      hits: number;
      misses: number;
    };
    queue: {
      queued: number;
      active: number;
      completed: number;
      failed: number;
      maxConcurrent: number;
    };
  } {
    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRate = totalRequests > 0 
      ? (this.cacheHits / totalRequests * 100).toFixed(2) + '%'
      : '0%';
    
    return {
      circuitOpen: this.circuitOpen,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      maxRetries: this.maxRetries,
      baseTimeout: this.baseTimeout,
      cache: {
        didDocuments: this.didDocumentCache.getStats(),
        handles: this.handleCache.getStats(),
        hitRate,
        hits: this.cacheHits,
        misses: this.cacheMisses,
      },
      queue: this.requestQueue.getStats(),
    };
  }

  /**
   * Reset circuit breaker (useful for testing or manual recovery)
   */
  resetCircuitBreaker(): void {
    this.circuitOpen = false;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    smartConsole.log('[DID_RESOLVER] Circuit breaker manually reset');
  }
  
  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.didDocumentCache.clear();
    this.handleCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    smartConsole.log('[DID_RESOLVER] Caches cleared');
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats(): {
    didDocuments: { size: number; maxSize: number; ttl: number };
    handles: { size: number; maxSize: number; ttl: number };
    hitRate: string;
    hits: number;
    misses: number;
  } {
    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRate = totalRequests > 0 
      ? (this.cacheHits / totalRequests * 100).toFixed(2) + '%'
      : '0%';
    
    return {
      didDocuments: this.didDocumentCache.getStats(),
      handles: this.handleCache.getStats(),
      hitRate,
      hits: this.cacheHits,
      misses: this.cacheMisses,
    };
  }

  /**
   * Resolve DID to handle
   */
  async resolveDIDToHandle(did: string): Promise<string | null> {
    // Check handle cache first
    const cachedHandle = this.handleCache.get(did);
    if (cachedHandle) {
      this.cacheHits++;
      return cachedHandle;
    }
    
    this.cacheMisses++;
    
    try {
      const didDoc = await this.resolveDID(did);
      if (!didDoc) {
        smartConsole.warn(`[DID_RESOLVER] Could not resolve DID document for ${did}`);
        return null;
      }

      const handle = this.getHandleFromDIDDocument(didDoc);
      if (!handle) {
        smartConsole.warn(`[DID_RESOLVER] No handle found in DID document for ${did}`);
        return null;
      }
      
      // Cache the handle mapping
      this.handleCache.set(did, handle);

      // Batch logging: only log every 5000 resolutions
      this.resolutionCount++;
      if (this.resolutionCount % this.BATCH_LOG_SIZE === 0) {
        const cacheHitRate = this.cacheHits / (this.cacheHits + this.cacheMisses) * 100;
        smartConsole.log(`[DID_RESOLVER] Resolved ${this.BATCH_LOG_SIZE} DIDs (total: ${this.resolutionCount}, cache hit rate: ${cacheHitRate.toFixed(1)}%)`);
      }
      
      return handle;
    } catch (error) {
      smartConsole.error(`[DID_RESOLVER] Error resolving DID ${did} to handle:`, error);
      return null;
    }
  }
}

export const didResolver = new DIDResolver();
