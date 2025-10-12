/**
 * DID Resolution Service for AT Protocol
 * 
 * Resolves DIDs to PDS endpoints and verifies identity
 */

import { smartConsole } from './console-wrapper';

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

  /**
   * Configure resolver settings
   */
  configure(options: {
    maxRetries?: number;
    baseTimeout?: number;
    retryDelay?: number;
    circuitBreakerThreshold?: number;
    circuitBreakerTimeout?: number;
  }) {
    if (options.maxRetries !== undefined) this.maxRetries = options.maxRetries;
    if (options.baseTimeout !== undefined) this.baseTimeout = options.baseTimeout;
    if (options.retryDelay !== undefined) this.retryDelay = options.retryDelay;
    if (options.circuitBreakerThreshold !== undefined) this.circuitBreakerThreshold = options.circuitBreakerThreshold;
    if (options.circuitBreakerTimeout !== undefined) this.circuitBreakerTimeout = options.circuitBreakerTimeout;
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
    // DNS resolution requires a DNS library - skip for now
    // In production, use dns.promises.resolveTxt(`_atproto.${handle}`)
    return null;
  }

  private async resolveHandleViaHTTPS(handle: string): Promise<string | null> {
    try {
      return await this.retryWithBackoff(async () => {
        const response = await fetch(`https://${handle}/.well-known/atproto-did`, {
          headers: { 
            'Accept': 'text/plain',
            'User-Agent': 'AT-Protocol-DID-Resolver/1.0'
          },
          signal: AbortSignal.timeout(this.baseTimeout),
        });

        if (!response.ok) {
          if (response.status === 404) {
            smartConsole.warn(`[DID_RESOLVER] Handle not found: ${handle}`);
            return null;
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        const responseText = await response.text();
        const did = responseText.trim();
        
        // Check if response looks like HTML (common error case)
        if (did.startsWith('<') || did.startsWith('{') || contentType.includes('html') || contentType.includes('json')) {
          smartConsole.warn(`[DID_RESOLVER] Unexpected content type for ${handle}: ${contentType}`);
          smartConsole.warn(`[DID_RESOLVER] Response preview: ${did.substring(0, 200)}`);
          throw new Error(`Invalid response format: expected plain text DID, got ${contentType || 'unknown content type'}`);
        }
        
        // Validate DID format (must start with did: and have a method)
        if (!did.startsWith('did:')) {
          smartConsole.warn(`[DID_RESOLVER] Invalid DID format for ${handle}. Expected format: did:<method>:<identifier>`);
          smartConsole.warn(`[DID_RESOLVER] Received: "${did.substring(0, 100)}"`);
          throw new Error(`Invalid DID format in response: "${did.substring(0, 50)}"`);
        }
        
        // Validate it's a supported DID method
        if (!did.startsWith('did:plc:') && !did.startsWith('did:web:')) {
          smartConsole.warn(`[DID_RESOLVER] Unsupported DID method for ${handle}: ${did}`);
          // Don't throw - still return it as it might be valid
        }

        return did;
      });
    } catch (error) {
      smartConsole.warn(`[DID_RESOLVER] Error resolving handle via HTTPS ${handle}:`, error);
      return null;
    }
  }

  /**
   * Resolve a DID to its DID document
   */
  async resolveDID(did: string): Promise<DIDDocument | null> {
    try {
      if (did.startsWith('did:plc:')) {
        return await this.resolvePLCDID(did);
      } else if (did.startsWith('did:web:')) {
        return await this.resolveWebDID(did);
      } else {
        smartConsole.error(`[DID_RESOLVER] Unsupported DID method: ${did}`);
        return null;
      }
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
      const result = await this.retryWithBackoff(async () => {
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
    
    // Remove trailing slash for consistency
    return endpoint.replace(/\/$/, '');
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

    return feedService.serviceEndpoint;
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
   */
  getHandleFromDIDDocument(didDoc: DIDDocument): string | null {
    if (!didDoc.alsoKnownAs || didDoc.alsoKnownAs.length === 0) {
      return null;
    }

    // Find handle URI in alsoKnownAs field (format: at://username.domain)
    const handleUri = didDoc.alsoKnownAs.find(uri => uri.startsWith('at://'));
    if (handleUri) {
      return handleUri.replace('at://', '');
    }

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
  } {
    return {
      circuitOpen: this.circuitOpen,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      maxRetries: this.maxRetries,
      baseTimeout: this.baseTimeout,
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
   * Resolve DID to handle
   */
  async resolveDIDToHandle(did: string): Promise<string | null> {
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

      // Batch logging: only log every 5000 resolutions
      this.resolutionCount++;
      if (this.resolutionCount % this.BATCH_LOG_SIZE === 0) {
        smartConsole.log(`[DID_RESOLVER] Resolved ${this.BATCH_LOG_SIZE} DIDs (total: ${this.resolutionCount})`);
      }
      
      return handle;
    } catch (error) {
      smartConsole.error(`[DID_RESOLVER] Error resolving DID ${did} to handle:`, error);
      return null;
    }
  }
}

export const didResolver = new DIDResolver();
