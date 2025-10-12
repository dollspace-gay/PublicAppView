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
  private incompleteEntries = new Map<string, IncompleteEntry>();
  private isProcessing = false;

  constructor() {
    // Start periodic processing of incomplete entries
    this.startPeriodicProcessing();
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
    const key = `${type}:${did}:${uri || ''}`;
    const existing = this.incompleteEntries.get(key);
    
    if (existing) {
      existing.retryCount++;
      existing.lastAttempt = Date.now();
      existing.missingData = missingData || existing.missingData;
    } else {
      this.incompleteEntries.set(key, {
        type,
        did,
        uri,
        missingData,
        retryCount: 0,
        lastAttempt: Date.now()
      });
    }

    console.log(`[PDS_FETCHER] Marked ${type} as incomplete: ${did} (${this.incompleteEntries.size} total incomplete)`);
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
          console.warn(`[PDS_FETCHER] Max retries exceeded for ${key}, removing`);
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
          console.log(`[PDS_FETCHER] Successfully fetched data for ${key}`);
        } else {
          console.warn(`[PDS_FETCHER] Failed to fetch data for ${key}: ${result.error}`);
        }
        
        processed++;
      } catch (error) {
        console.error(`[PDS_FETCHER] Error processing ${key}:`, error);
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
      // Resolve DID to PDS endpoint
      const pdsEndpoint = await didResolver.resolveDIDToPDS(entry.did);
      if (!pdsEndpoint) {
        return {
          success: false,
          error: `Could not resolve PDS endpoint for DID: ${entry.did}`
        };
      }

      console.log(`[PDS_FETCHER] Fetching data for ${entry.type} ${entry.did} from ${pdsEndpoint}`);

      switch (entry.type) {
        case 'user':
          return await this.fetchUserData(entry.did, pdsEndpoint);
        case 'post':
          return await this.fetchPostData(entry.did, entry.uri!, pdsEndpoint);
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
          return await this.fetchUserData(entry.did, pdsEndpoint);
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
      // Fetch the profile record directly from PDS using com.atproto.repo.getRecord
      // This is a PDS endpoint and doesn't require authentication
      const profileResponse = await fetch(
        `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=app.bsky.actor.profile&rkey=self`,
        {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(this.FETCH_TIMEOUT_MS)
        }
      );

      if (!profileResponse.ok) {
        return {
          success: false,
          error: `Profile fetch failed: ${profileResponse.status}`
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
        
        console.log(`[PDS_FETCHER] Updated user ${did} - handle: ${handle || did}, avatar: ${avatarCid ? 'YES' : 'NO'}, banner: ${bannerCid ? 'YES' : 'NO'}`);
        
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

      // Fetch the post record
      const recordResponse = await fetch(
        `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${authorDid}&collection=${collection}&rkey=${rkey}`,
        {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(this.FETCH_TIMEOUT_MS)
        }
      );

      if (!recordResponse.ok) {
        return {
          success: false,
          error: `Record fetch failed: ${recordResponse.status}`
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
        
        console.log(`[PDS_FETCHER] Fetched and processed post ${postUri}`);
        
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

      const recordResponse = await fetch(
        `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${repo}&collection=${collection}&rkey=${rkey}`,
        {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(this.FETCH_TIMEOUT_MS),
        },
      );

      if (!recordResponse.ok) {
        return { success: false, error: `Record fetch failed: ${recordResponse.status}` };
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