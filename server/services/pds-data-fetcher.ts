/**
 * PDS Data Fetcher Service
 * 
 * Fetches missing data from source PDS when Redis entries are incomplete
 * due to missing referenced users or posts.
 */

import { didResolver } from "./did-resolver";
import { pdsClient } from "./pds-client";
import { storage } from "../storage";
import { eventProcessor } from "./event-processor";
import { CID } from 'multiformats/cid';
import * as Digest from 'multiformats/hashes/digest';

interface PDSDataFetchResult {
  success: boolean;
  data?: any;
  error?: string;
}

interface IncompleteEntry {
  type:
    | 'user'
    | 'post'
    | 'like'
    | 'repost'
    | 'follow'
    | 'list'
    | 'listitem'
    | 'feedgen'
    | 'starterpack'
    | 'labeler'
    | 'record'; // generic record fetch by URI
  did: string;
  uri?: string;
  missingData?: any;
  retryCount: number;
  lastAttempt: number;
}

export class PDSDataFetcher {
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly RETRY_DELAY_MS = 30000; // 30 seconds
  private readonly FETCH_TIMEOUT_MS = 10000; // 10 seconds
  private readonly BATCH_LOG_SIZE = 5000; // Log every 5000 operations
  private incompleteEntries = new Map<string, IncompleteEntry>();
  private isProcessing = false;
  private fetchCount = 0;
  private updateCount = 0;
  private successCount = 0;
  private postCount = 0;

  constructor() {
    // Start periodic processing of incomplete entries
    this.startPeriodicProcessing();
  }

  /**
   * Sanitize and validate DID format
   */
  private sanitizeDID(did: string): string {
    if (!did) return '';
    
    const original = did;
    
    // Remove all whitespace (spaces, tabs, newlines, etc.)
    let cleaned = did.replace(/\s+/g, '');
    
    // Remove any duplicate colons (e.g., did::plc: becomes did:plc:)
    cleaned = cleaned.replace(/:+/g, ':');
    
    // Remove trailing colons, commas, and other punctuation
    cleaned = cleaned.replace(/[:;,._-]+$/g, '');
    
    // Remove leading colons, commas, and other punctuation  
    cleaned = cleaned.replace(/^[:;,._-]+/g, '');
    
    // Remove any trailing non-alphanumeric characters (except in the identifier itself)
    // This catches things like invisible characters, control characters, etc.
    cleaned = cleaned.replace(/[^a-zA-Z0-9]+$/g, '');
    
    // If cleaning changed the DID, log it with character codes for debugging
    if (cleaned !== original) {
      const originalBytes = Array.from(original).map(c => c.charCodeAt(0)).join(',');
      const cleanedBytes = Array.from(cleaned).map(c => c.charCodeAt(0)).join(',');
      console.warn(`[PDS_FETCHER] Cleaned malformed DID: "${original}" → "${cleaned}"`);
      console.warn(`[PDS_FETCHER] Character codes - Original: [${originalBytes}] Cleaned: [${cleanedBytes}]`);
    }
    
    // Ensure it starts with 'did:' and follows valid format
    if (!cleaned.startsWith('did:')) {
      console.warn(`[PDS_FETCHER] Invalid DID format (doesn't start with 'did:'): "${cleaned}"`);
    }
    
    // Validate the DID matches expected pattern: did:method:identifier
    // For did:plc: the identifier should be base32 lowercase (a-z, 2-7)
    // For did:web: the identifier should be a domain
    const didPattern = /^did:[a-z]+:[a-z0-9._:-]+$/i;
    if (!didPattern.test(cleaned)) {
      console.warn(`[PDS_FETCHER] DID doesn't match expected pattern: "${cleaned}"`);
    }
    
    return cleaned;
  }

  /**
   * Mark an entry as incomplete and needing data fetch
   */
  markIncomplete(
    type:
      | 'user'
      | 'post'
      | 'like'
      | 'repost'
      | 'follow'
      | 'list'
      | 'listitem'
      | 'feedgen'
      | 'starterpack'
      | 'labeler'
      | 'record',
    did: string,
    uri?: string,
    missingData?: any,
  ) {
    // Sanitize DID before storing
    const cleanDid = this.sanitizeDID(did);
    // Build key without trailing colons when uri is empty
    const key = uri ? `${type}:${cleanDid}:${uri}` : `${type}:${cleanDid}`;
    const existing = this.incompleteEntries.get(key);
    
    if (existing) {
      existing.retryCount++;
      existing.lastAttempt = Date.now();
      existing.missingData = missingData || existing.missingData;
    } else {
      this.incompleteEntries.set(key, {
        type,
        did: cleanDid,
        uri,
        missingData,
        retryCount: 0,
        lastAttempt: Date.now()
      });
    }

    // Only log when the queue is getting large (every 100 entries)
    if (this.incompleteEntries.size % 100 === 0) {
      console.log(`[PDS_FETCHER] Queue size: ${this.incompleteEntries.size} incomplete entries`);
    }
  }

  /**
   * Start periodic processing of incomplete entries
   */
  private startPeriodicProcessing() {
    // Process every 30 seconds
    setInterval(async () => {
      if (this.isProcessing) return;
      
      try {
        await this.processIncompleteEntries();
      } catch (error) {
        console.error('[PDS_FETCHER] Error processing incomplete entries:', error);
      }
    }, 30000);
  }

  /**
   * Process all incomplete entries
   */
  private async processIncompleteEntries() {
    if (this.incompleteEntries.size === 0) return;
    
    this.isProcessing = true;
    console.log(`[PDS_FETCHER] Processing ${this.incompleteEntries.size} incomplete entries...`);

    const entries = Array.from(this.incompleteEntries.entries());
    let processed = 0;
    let success = 0;

    for (const [key, entry] of entries) {
      try {
        // Skip if too many retries
        if (entry.retryCount >= this.MAX_RETRY_ATTEMPTS) {
          const identifier = entry.uri || this.sanitizeDID(entry.did);
          console.warn(`[PDS_FETCHER] Max retries exceeded for ${entry.type} ${identifier} - removing`);
          this.incompleteEntries.delete(key);
          continue;
        }

        // Skip if recently attempted
        const timeSinceLastAttempt = Date.now() - entry.lastAttempt;
        if (timeSinceLastAttempt < this.RETRY_DELAY_MS) {
          continue;
        }

        const result = await this.fetchMissingData(entry);
        if (result.success) {
          success++;
          this.incompleteEntries.delete(key);
          // Batch logging: only log every 5000 successful fetches
          this.successCount++;
          if (this.successCount % this.BATCH_LOG_SIZE === 0) {
            console.log(`[PDS_FETCHER] ${this.BATCH_LOG_SIZE} successful fetches (total: ${this.successCount})`);
          }
        } else {
          // Show cleaner error message with just the DID/URI
          const identifier = entry.uri || this.sanitizeDID(entry.did);
          console.warn(`[PDS_FETCHER] Failed to fetch ${entry.type} ${identifier}: ${result.error}`);
        }
        
        processed++;
      } catch (error) {
        const identifier = entry.uri || this.sanitizeDID(entry.did);
        console.error(`[PDS_FETCHER] Error processing ${entry.type} ${identifier}:`, error);
      }
    }

    console.log(`[PDS_FETCHER] Processed ${processed} entries, ${success} successful, ${this.incompleteEntries.size} remaining`);
    this.isProcessing = false;
  }

  /**
   * Fetch missing data from PDS
   */
  private async fetchMissingData(entry: IncompleteEntry): Promise<PDSDataFetchResult> {
    try {
      // Sanitize the DID before using it
      const cleanDid = this.sanitizeDID(entry.did);
      
      // Validate DID format
      if (!cleanDid.startsWith('did:plc:') && !cleanDid.startsWith('did:web:')) {
        return {
          success: false,
          error: `Invalid DID format: ${cleanDid}`
        };
      }
      
      // Resolve DID to PDS endpoint
      const pdsEndpoint = await didResolver.resolveDIDToPDS(cleanDid);
      if (!pdsEndpoint) {
        return {
          success: false,
          error: `Could not resolve PDS endpoint for DID: ${cleanDid}`
        };
      }

      // Batch logging: only log every 5000 fetches
      this.fetchCount++;
      if (this.fetchCount % this.BATCH_LOG_SIZE === 0) {
        console.log(`[PDS_FETCHER] Fetched data for ${this.BATCH_LOG_SIZE} entries (total: ${this.fetchCount})`);
      }

      switch (entry.type) {
        case 'user':
          return await this.fetchUserData(cleanDid, pdsEndpoint);
        case 'post':
          return await this.fetchPostData(cleanDid, entry.uri!, pdsEndpoint);
        case 'list':
        case 'listitem':
        case 'feedgen':
        case 'starterpack':
        case 'labeler':
        case 'record':
          return await this.fetchRecordByUri(entry.uri!, pdsEndpoint);
        case 'like':
        case 'repost':
        case 'follow':
          // Ensure the actor exists first; referenced subject fetch is handled via 'post'/'record' marks
          return await this.fetchUserData(cleanDid, pdsEndpoint);
        default:
          return {
            success: false,
            error: `Unknown entry type: ${entry.type}`
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Fetch user data from PDS
   */
  private async fetchUserData(did: string, pdsEndpoint: string): Promise<PDSDataFetchResult> {
    try {
      // URL encode the DID to handle any special characters
      const encodedDid = encodeURIComponent(did);
      const url = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodedDid}&collection=app.bsky.actor.profile&rkey=self`;
      
      // Fetch the profile record directly from PDS using com.atproto.repo.getRecord
      // This is a PDS endpoint and doesn't require authentication
      const profileResponse = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(this.FETCH_TIMEOUT_MS)
      });

      if (!profileResponse.ok) {
        // Get response body for better error diagnostics
        let errorDetails = '';
        let isRecordNotFound = false;
        try {
          const errorBody = await profileResponse.text();
          errorDetails = errorBody.substring(0, 200);
          isRecordNotFound = errorBody.includes('RecordNotFound');
        } catch (e) {
          // Ignore if we can't read the body
        }
        
        // If record not found at PDS, try the AppView as fallback
        // This handles cases where the profile exists but isn't at this PDS endpoint
        if (profileResponse.status === 400 && isRecordNotFound) {
          console.warn(`[PDS_FETCHER] Profile not found at PDS for ${did}, trying AppView fallback...`);
          return await this.fetchUserDataFromAppView(did);
        }
        
        const errorMsg = `Profile fetch failed: ${profileResponse.status}${errorDetails ? ` - ${errorDetails}` : ''}`;
        console.warn(`[PDS_FETCHER] ${errorMsg} for ${did} at ${pdsEndpoint}`);
        
        return {
          success: false,
          error: errorMsg
        };
      }

      const response = await profileResponse.json();
      const profile = response.value; // The actual profile record is in .value
      
      if (profile) {
        // Resolve handle from DID
        const handle = await didResolver.resolveDIDToHandle(did);
        
        // Extract avatar and banner CIDs from blob references (same logic as event processor)
        const extractBlobCid = (blob: any): string | null => {
          if (!blob) return null;
          
          if (typeof blob === 'string') {
            return blob === 'undefined' ? null : blob;
          }
          
          if (blob.ref) {
            if (typeof blob.ref === 'string') {
              return blob.ref !== 'undefined' ? blob.ref : null;
            }
            
            if (blob.ref.$link) {
              return blob.ref.$link !== 'undefined' ? blob.ref.$link : null;
            }
            
            // Binary CID object from PDS
            if (blob.ref.code !== undefined && blob.ref.multihash) {
              try {
                if (typeof blob.ref.toString === 'function' && blob.ref.toString !== Object.prototype.toString) {
                  const cidString = blob.ref.toString();
                  return cidString !== 'undefined' ? cidString : null;
                }
                
                const mh = blob.ref.multihash;
                const digest = mh.digest;
                
                let digestBytes: Uint8Array;
                if (digest && typeof digest === 'object' && !ArrayBuffer.isView(digest)) {
                  const size = mh.size || Object.keys(digest).length;
                  digestBytes = new Uint8Array(size);
                  for (let i = 0; i < size; i++) {
                    digestBytes[i] = digest[i];
                  }
                } else if (ArrayBuffer.isView(digest)) {
                  digestBytes = new Uint8Array(digest.buffer, digest.byteOffset, digest.byteLength);
                } else {
                  return null;
                }
                
                const multihashDigest = Digest.create(mh.code, digestBytes);
                const cidObj = CID.create(blob.ref.version || 1, blob.ref.code, multihashDigest);
                return cidObj.toString();
              } catch (error) {
                console.error('[PDS_FETCHER] Error converting binary CID:', error);
                return null;
              }
            }
          }
          
          if (blob.cid) {
            return blob.cid !== 'undefined' ? blob.cid : null;
          }
          
          return null;
        };
        
        const avatarCid = extractBlobCid(profile.avatar);
        const bannerCid = extractBlobCid(profile.banner);
        
        // Update user with full profile data
        await storage.updateUser(did, {
          handle: handle || did,
          displayName: profile.displayName || null,
          description: profile.description || null,
          avatarUrl: avatarCid,
          bannerUrl: bannerCid,
        });
        
        // Batch logging: only log every 5000 updates
        this.updateCount++;
        if (this.updateCount % this.BATCH_LOG_SIZE === 0) {
          console.log(`[PDS_FETCHER] Updated ${this.BATCH_LOG_SIZE} users (total: ${this.updateCount})`);
        }
        
        // Flush any pending operations for this user
        await eventProcessor.flushPendingUserOps(did);
        await eventProcessor.flushPendingUserCreationOps(did);
        
        return {
          success: true,
          data: { did, handle: handle || did, profile }
        };
      } else {
        return {
          success: false,
          error: 'No profile record found'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Fetch post data from PDS
   */
  private async fetchPostData(authorDid: string, postUri: string, pdsEndpoint: string): Promise<PDSDataFetchResult> {
    try {
      // Extract the record key from the URI
      const uriParts = postUri.split('/');
      const collection = uriParts[uriParts.length - 2];
      const rkey = uriParts[uriParts.length - 1];

      // URL encode parameters
      const encodedDid = encodeURIComponent(authorDid);
      const encodedCollection = encodeURIComponent(collection);
      const encodedRkey = encodeURIComponent(rkey);

      // Fetch the post record
      const recordResponse = await fetch(
        `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodedDid}&collection=${encodedCollection}&rkey=${encodedRkey}`,
        {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(this.FETCH_TIMEOUT_MS)
        }
      );

      if (!recordResponse.ok) {
        let errorDetails = '';
        let isRecordNotFound = false;
        try {
          const errorBody = await recordResponse.text();
          errorDetails = errorBody.substring(0, 200);
          isRecordNotFound = errorBody.includes('RecordNotFound');
        } catch (e) {
          // Ignore
        }
        
        // If record not found, stop retrying - the post was deleted
        if ((recordResponse.status === 400 || recordResponse.status === 404) && isRecordNotFound) {
          console.warn(`[PDS_FETCHER] Post not found (deleted): ${postUri}`);
          return {
            success: true, // Treat as success to stop retrying
            data: null
          };
        }
        
        const errorMsg = `Record fetch failed: ${recordResponse.status}${errorDetails ? ` - ${errorDetails}` : ''}`;
        console.warn(`[PDS_FETCHER] ${errorMsg} for ${postUri}`);
        
        return {
          success: false,
          error: errorMsg
        };
      }

      const recordData = await recordResponse.json();
      
      if (recordData.uri && recordData.cid && recordData.value) {
        // Process the post record
        await eventProcessor.processRecord(
          recordData.uri,
          recordData.cid,
          authorDid,
          recordData.value
        );
        
        // Batch logging: only log every 5000 posts
        this.postCount++;
        if (this.postCount % this.BATCH_LOG_SIZE === 0) {
          console.log(`[PDS_FETCHER] Fetched and processed ${this.BATCH_LOG_SIZE} posts (total: ${this.postCount})`);
        }
        
        return {
          success: true,
          data: { uri: recordData.uri, cid: recordData.cid, record: recordData.value }
        };
      } else {
        return {
          success: false,
          error: 'Record response missing required fields'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Fetch any record by its AT URI and process it through the event processor
   */
  private async fetchRecordByUri(uri: string, pdsEndpoint: string): Promise<PDSDataFetchResult> {
    try {
      const { repo, collection, rkey } = this.parseAtUri(uri);

      // URL encode parameters
      const encodedRepo = encodeURIComponent(repo);
      const encodedCollection = encodeURIComponent(collection);
      const encodedRkey = encodeURIComponent(rkey);

      const recordResponse = await fetch(
        `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodedRepo}&collection=${encodedCollection}&rkey=${encodedRkey}`,
        {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(this.FETCH_TIMEOUT_MS),
        },
      );

      if (!recordResponse.ok) {
        let errorDetails = '';
        let isRecordNotFound = false;
        try {
          const errorBody = await recordResponse.text();
          errorDetails = errorBody.substring(0, 200);
          isRecordNotFound = errorBody.includes('RecordNotFound');
        } catch (e) {
          // Ignore
        }
        
        // If record not found, stop retrying - the record was deleted
        if ((recordResponse.status === 400 || recordResponse.status === 404) && isRecordNotFound) {
          console.warn(`[PDS_FETCHER] Record not found (deleted): ${uri}`);
          return {
            success: true, // Treat as success to stop retrying
            data: null
          };
        }
        
        const errorMsg = `Record fetch failed: ${recordResponse.status}${errorDetails ? ` - ${errorDetails}` : ''}`;
        console.warn(`[PDS_FETCHER] ${errorMsg} for ${uri}`);
        
        return { success: false, error: errorMsg };
      }

      const recordData = await recordResponse.json();

      if (recordData.uri && recordData.cid && recordData.value) {
        await eventProcessor.processRecord(recordData.uri, recordData.cid, repo, recordData.value);
        return { success: true, data: recordData };
      }

      return { success: false, error: 'Record response missing required fields' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Parse AT URI of the form at://did:.../collection/rkey
   */
  private parseAtUri(uri: string): { repo: string; collection: string; rkey: string } {
    const parts = uri.split('/');
    if (parts.length < 5) {
      throw new Error(`Invalid AT URI: ${uri}`);
    }
    // parts: ['at:', '', 'did:plc:...', 'app.bsky.collection', 'rkey']
    const repo = parts[2];
    const collection = parts[3];
    const rkey = parts[4];
    return { repo, collection, rkey };
  }

  /**
   * Get statistics about incomplete entries
   */
  getStats() {
    const stats = {
      total: this.incompleteEntries.size,
      byType: {} as Record<string, number>,
      byRetryCount: {} as Record<string, number>,
      oldestEntry: 0
    };

    let oldestTime = Date.now();

    for (const entry of this.incompleteEntries.values()) {
      // Count by type
      stats.byType[entry.type] = (stats.byType[entry.type] || 0) + 1;
      
      // Count by retry count
      stats.byRetryCount[entry.retryCount] = (stats.byRetryCount[entry.retryCount] || 0) + 1;
      
      // Find oldest entry
      if (entry.lastAttempt < oldestTime) {
        oldestTime = entry.lastAttempt;
      }
    }

    stats.oldestEntry = Date.now() - oldestTime;

    return stats;
  }

  /**
   * Clear all incomplete entries (for testing or manual reset)
   */
  clearAll() {
    const count = this.incompleteEntries.size;
    this.incompleteEntries.clear();
    console.log(`[PDS_FETCHER] Cleared ${count} incomplete entries`);
  }
}

export const pdsDataFetcher = new PDSDataFetcher();