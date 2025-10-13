import { storage, type IStorage } from "../storage";
import { lexiconValidator } from "./lexicon-validator";
import { labelService } from "./label";
import { didResolver } from "./did-resolver";
import { pdsDataFetcher } from "./pds-data-fetcher";
import { smartConsole } from "./console-wrapper";
import { logAggregator } from "./log-aggregator";
import type { InsertUser, InsertPost, InsertLike, InsertRepost, InsertFollow, InsertBlock, InsertList, InsertListItem, InsertFeedGenerator, InsertStarterPack, InsertLabelerService, InsertFeedItem, InsertQuote, InsertVerification } from "@shared/schema";
import { CID } from 'multiformats/cid';
import * as Digest from 'multiformats/hashes/digest';

function sanitizeText(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  return text.replace(/\u0000/g, '');
}

function sanitizeRequiredText(text: string | undefined | null): string {
  if (!text) return '';
  return text.replace(/\u0000/g, '');
}

/**
 * Extract CID from various blob reference formats used in AT Protocol
 * Handles: 
 * - {ref: {$link: 'cid'}} (JSON format from API)
 * - {ref: {code, version, multihash}} (Binary CID object from CAR files)
 * - {cid: 'cid'} (Direct CID field)
 * - Direct CID string
 */
function extractBlobCid(blob: any): string | null {
  if (!blob) return null;
  
  // Handle direct string
  if (typeof blob === 'string') {
    return blob === 'undefined' ? null : blob;
  }
  
  // Handle blob.ref field
  if (blob.ref) {
    // String CID: {ref: {$link: 'cid'}} or {ref: 'cid'}
    if (typeof blob.ref === 'string') {
      return blob.ref !== 'undefined' ? blob.ref : null;
    }
    
    if (blob.ref.$link) {
      return blob.ref.$link !== 'undefined' ? blob.ref.$link : null;
    }
    
    // Binary CID object from CAR files: {ref: {code, version, multihash}}
    if (blob.ref.code !== undefined && blob.ref.multihash) {
      try {
        // If it's already a CID object with toString method, use it
        if (typeof blob.ref.toString === 'function' && blob.ref.toString !== Object.prototype.toString) {
          const cidString = blob.ref.toString();
          return cidString !== 'undefined' ? cidString : null;
        }
        
        // Otherwise, construct CID from the binary parts
        const mh = blob.ref.multihash;
        const digest = mh.digest;
        
        // Convert digest to Uint8Array if it's an object with numeric keys
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
        
        // Create a proper Multihash Digest
        const multihashDigest = Digest.create(mh.code, digestBytes);
        
        // Create CID from parts: version, codec, and multihash
        const cidObj = CID.create(
          blob.ref.version || 1,
          blob.ref.code,
          multihashDigest
        );
        
        return cidObj.toString();
      } catch (error) {
        console.error('[EXTRACT_CID] Error converting binary CID:', error);
        return null;
      }
    }
  }
  
  // Handle blob.cid field
  if (blob.cid) {
    return blob.cid !== 'undefined' ? blob.cid : null;
  }
  
  return null;
}

interface PendingOp {
  type: 'like' | 'repost';
  payload: InsertLike | InsertRepost;
  enqueuedAt: number;
}

interface PendingUserOp {
  type: 'follow' | 'block';
  payload: InsertFollow | InsertBlock;
  enqueuedAt: number;
}

interface PendingListItem {
  payload: InsertListItem;
  enqueuedAt: number;
}

interface PendingUserCreationOp {
  repo: string;
  op: any;
  enqueuedAt: number;
}

export class EventProcessor {
  private storage: IStorage;
  private pendingOps: Map<string, PendingOp[]> = new Map();
  private pendingOpIndex: Map<string, string> = new Map(); // opUri -> postUri
  private pendingUserOps: Map<string, PendingUserOp[]> = new Map(); // userDid -> pending ops
  private pendingUserOpIndex: Map<string, string> = new Map(); // opUri -> userDid
  private pendingListItems: Map<string, PendingListItem[]> = new Map(); // listUri -> pending list items
  private pendingListItemIndex: Map<string, string> = new Map(); // itemUri -> listUri
  private pendingUserCreationOps: Map<string, PendingUserCreationOp[]> = new Map(); // did -> ops
  private readonly TTL_MS = 24 * 60 * 60 * 1000; // 24 hour TTL for cleanup
  private totalPendingCount = 0; // Running counter for performance
  private totalPendingUserOps = 0; // Counter for pending user ops
  private totalPendingListItems = 0; // Counter for pending list items
  private totalPendingUserCreationOps = 0;
  private userCreationCount = 0; // Counter for batch logging
  private readonly USER_BATCH_LOG_SIZE = 5000; // Log every 5000 user creations
  private skipPdsFetching = false; // Flag to disable PDS fetching during bulk operations
  private metrics = {
    pendingQueued: 0,
    pendingFlushed: 0,
    pendingExpired: 0,
    pendingDropped: 0,
    pendingUserOpsQueued: 0,
    pendingUserOpsFlushed: 0,
    pendingUserOpsExpired: 0,
    pendingUserOpsDropped: 0,
    pendingListItemsQueued: 0,
    pendingListItemsFlushed: 0,
    pendingListItemsExpired: 0,
    pendingListItemsDropped: 0,
    pendingUserCreationOpsQueued: 0,
    pendingUserCreationOpsFlushed: 0,
    pendingUserCreationOpsExpired: 0,
  };
  private dataCollectionCache = new Map<string, boolean>(); // DID -> dataCollectionForbidden
  
  // Concurrent user creation limiting to prevent connection pool exhaustion
  private pendingUserCreations = new Map<string, Promise<boolean>>(); // did -> pending promise
  private activeUserCreations = 0;
  // Limit concurrent user creations to avoid overwhelming DB pool
  // Set to 2x pool size to allow some queuing while preventing timeout
  private readonly MAX_CONCURRENT_USER_CREATIONS = parseInt(process.env.MAX_CONCURRENT_USER_CREATIONS || '10');

  constructor(storageInstance: IStorage = storage) {
    this.storage = storageInstance;
    this.startTTLSweeper();
    // Clear cache periodically to respect setting updates
    setInterval(() => this.dataCollectionCache.clear(), 5 * 60 * 1000); // Clear every 5 minutes
  }

  /**
   * Enable/disable PDS fetching for incomplete data
   * Should be disabled during bulk CAR file imports
   */
  setSkipPdsFetching(skip: boolean) {
    this.skipPdsFetching = skip;
  }
  
  /**
   * Check if data collection is forbidden for a user
   * Returns true if collection is forbidden, false otherwise
   * Caches results to avoid repeated database queries
   */
  private async isDataCollectionForbidden(did: string): Promise<boolean> {
    // Check cache first
    if (this.dataCollectionCache.has(did)) {
      return this.dataCollectionCache.get(did)!;
    }
    
    // Query database
    const settings = await this.storage.getUserSettings(did);
    const forbidden = settings?.dataCollectionForbidden || false;
    
    // Cache the result
    this.dataCollectionCache.set(did, forbidden);
    
    return forbidden;
  }
  
  /**
   * Invalidate the data collection cache for a specific user
   * Called when user settings change to ensure immediate effect
   */
  invalidateDataCollectionCache(did: string) {
    this.dataCollectionCache.delete(did);
  }

  private startTTLSweeper() {
    setInterval(() => {
      this.sweepExpiredOps();
    }, 60000); // Run every minute
  }

  private sweepExpiredOps() {
    const now = Date.now();
    let expired = 0;
    let expiredListItems = 0;
    let expiredUserOps = 0;

    // Sweep pending likes/reposts
    for (const [postUri, ops] of Array.from(this.pendingOps.entries())) {
      const validOps = ops.filter((op: PendingOp) => {
        if (now - op.enqueuedAt > this.TTL_MS) {
          expired++;
          // Remove from index
          const opUri = op.payload.uri;
          this.pendingOpIndex.delete(opUri);
          return false;
        }
        return true;
      });

      if (validOps.length === 0) {
        this.pendingOps.delete(postUri);
      } else if (validOps.length < ops.length) {
        this.pendingOps.set(postUri, validOps);
      }
    }

    // Sweep pending user ops
    for (const [userDid, ops] of Array.from(this.pendingUserOps.entries())) {
      const validOps = ops.filter((op: PendingUserOp) => {
        if (now - op.enqueuedAt > this.TTL_MS) {
          expiredUserOps++;
          // Remove from index
          const opUri = op.payload.uri;
          this.pendingUserOpIndex.delete(opUri);
          return false;
        }
        return true;
      });

      if (validOps.length === 0) {
        this.pendingUserOps.delete(userDid);
      } else if (validOps.length < ops.length) {
        this.pendingUserOps.set(userDid, validOps);
      }
    }

    // Sweep pending list items
    for (const [listUri, items] of Array.from(this.pendingListItems.entries())) {
      const validItems = items.filter((item: PendingListItem) => {
        if (now - item.enqueuedAt > this.TTL_MS) {
          expiredListItems++;
          // Remove from index
          this.pendingListItemIndex.delete(item.payload.uri);
          return false;
        }
        return true;
      });

      if (validItems.length === 0) {
        this.pendingListItems.delete(listUri);
      } else if (validItems.length < items.length) {
        this.pendingListItems.set(listUri, validItems);
      }
    }

    if (expired > 0) {
      this.totalPendingCount -= expired;
      this.metrics.pendingExpired += expired;
      smartConsole.log(`[EVENT_PROCESSOR] Expired ${expired} pending operations (TTL exceeded)`);
    }

    if (expiredUserOps > 0) {
      this.totalPendingUserOps -= expiredUserOps;
      this.metrics.pendingUserOpsExpired += expiredUserOps;
      smartConsole.log(`[EVENT_PROCESSOR] Expired ${expiredUserOps} pending user operations (TTL exceeded)`);
    }

    if (expiredListItems > 0) {
      this.totalPendingListItems -= expiredListItems;
      this.metrics.pendingListItemsExpired += expiredListItems;
      smartConsole.log(`[EVENT_PROCESSOR] Expired ${expiredListItems} pending list items (TTL exceeded)`);
    }

    let expiredUserCreationOps = 0;
    for (const [did, ops] of Array.from(this.pendingUserCreationOps.entries())) {
      const validOps = ops.filter((op: PendingUserCreationOp) => {
        if (now - op.enqueuedAt > this.TTL_MS) {
          expiredUserCreationOps++;
          return false;
        }
        return true;
      });

      if (validOps.length === 0) {
        this.pendingUserCreationOps.delete(did);
      } else if (validOps.length < ops.length) {
        this.pendingUserCreationOps.set(did, validOps);
      }
    }

    if (expiredUserCreationOps > 0) {
      this.totalPendingUserCreationOps -= expiredUserCreationOps;
      this.metrics.pendingUserCreationOpsExpired += expiredUserCreationOps;
      smartConsole.log(`[EVENT_PROCESSOR] Expired ${expiredUserCreationOps} pending user creation operations (TTL exceeded)`);
    }
  }

  private enqueuePendingUserCreationOp(did: string, repo: string, op: any) {
    const queue = this.pendingUserCreationOps.get(did) || [];

    const pendingOp: PendingUserCreationOp = {
      repo,
      op,
      enqueuedAt: Date.now(),
    };

    queue.push(pendingOp);
    this.pendingUserCreationOps.set(did, queue);

    this.totalPendingUserCreationOps++;
    this.metrics.pendingUserCreationOpsQueued++;
    smartConsole.log(`[EVENT_PROCESSOR] Queued op for user creation: ${did}`);
  }

  private enqueuePending(postUri: string, op: PendingOp) {
    const opUri = op.payload.uri;
    
    // Check for duplicates
    if (this.pendingOpIndex.has(opUri)) {
      return; // Already pending, skip
    }

    // Get or create queue for this post (no limits)
    const queue = this.pendingOps.get(postUri) || [];
    
    queue.push(op);
    this.pendingOps.set(postUri, queue);
    
    // Add to index
    this.pendingOpIndex.set(opUri, postUri);
    
    this.totalPendingCount++;
    this.metrics.pendingQueued++;
  }

  private async flushPending(postUri: string) {
    // Atomically remove queue before processing to avoid race conditions
    const ops = this.pendingOps.get(postUri);
    if (!ops || ops.length === 0) {
      return;
    }
    
    // Delete immediately to prevent new ops from being lost
    this.pendingOps.delete(postUri);

    smartConsole.log(`[EVENT_PROCESSOR] Flushing ${ops.length} pending operations for ${postUri}`);

    for (const op of ops) {
      try {
        if (op.type === 'like') {
          await this.storage.createLike(op.payload as InsertLike);
          this.metrics.pendingFlushed++;
        } else if (op.type === 'repost') {
          await this.storage.createRepost(op.payload as InsertRepost);
          this.metrics.pendingFlushed++;
        }
        
        // Remove from index
        const opUri = op.payload.uri;
        this.pendingOpIndex.delete(opUri);
        this.totalPendingCount--;
      } catch (error: any) {
        // If still failing, skip it
        smartConsole.error(`[EVENT_PROCESSOR] Error flushing pending ${op.type}:`, error.message);
        // Still remove from index and count
        const opUri = op.payload.uri;
        this.pendingOpIndex.delete(opUri);
        this.totalPendingCount--;
      }
    }
  }

  private cancelPendingOp(opUri: string) {
    // Find and remove pending op from queue
    const postUri = this.pendingOpIndex.get(opUri);
    if (!postUri) {
      return; // Not pending
    }

    const queue = this.pendingOps.get(postUri);
    if (!queue) {
      return;
    }

    // Filter out the op and count removed
    const filteredQueue = queue.filter(op => op.payload.uri !== opUri);
    const removed = queue.length - filteredQueue.length;
    
    if (filteredQueue.length === 0) {
      this.pendingOps.delete(postUri);
    } else if (removed > 0) {
      this.pendingOps.set(postUri, filteredQueue);
    }
    
    // Update count and index
    if (removed > 0) {
      this.totalPendingCount -= removed;
      this.pendingOpIndex.delete(opUri);
    }
  }

  private enqueuePendingUserOp(userDid: string, op: PendingUserOp) {
    const opUri = op.payload.uri;

    if (this.pendingUserOpIndex.has(opUri)) {
      return;
    }

    const queue = this.pendingUserOps.get(userDid) || [];
    queue.push(op);
    this.pendingUserOps.set(userDid, queue);
    this.pendingUserOpIndex.set(opUri, userDid);
    this.totalPendingUserOps++;
    this.metrics.pendingUserOpsQueued++;
  }

  private async flushPendingUserOps(userDid: string) {
    const ops = this.pendingUserOps.get(userDid);
    if (!ops || ops.length === 0) {
      return;
    }

    this.pendingUserOps.delete(userDid);

    for (const op of ops) {
      try {
        if (op.type === 'follow') {
          await this.storage.createFollow(op.payload as InsertFollow);
        } else if (op.type === 'block') {
          await this.storage.createBlock(op.payload as InsertBlock);
        }
        this.metrics.pendingUserOpsFlushed++;
        this.pendingUserOpIndex.delete(op.payload.uri);
        this.totalPendingUserOps--;
      } catch (error) {
        // Skip on error
      }
    }
  }

  private cancelPendingUserOp(opUri: string) {
    const userDid = this.pendingUserOpIndex.get(opUri);
    if (!userDid) return;

    const queue = this.pendingUserOps.get(userDid);
    if (!queue) return;

    const filteredQueue = queue.filter(op => op.payload.uri !== opUri);
    const removed = queue.length - filteredQueue.length;

    if (filteredQueue.length === 0) {
      this.pendingUserOps.delete(userDid);
    } else if (removed > 0) {
      this.pendingUserOps.set(userDid, filteredQueue);
    }

    if (removed > 0) {
      this.totalPendingUserOps -= removed;
      this.pendingUserOpIndex.delete(opUri);
    }
  }

  private enqueuePendingListItem(listUri: string, item: PendingListItem) {
    const itemUri = item.payload.uri;
    
    // Check for duplicates
    if (this.pendingListItemIndex.has(itemUri)) {
      return; // Already pending, skip
    }

    // Get or create queue for this list (no limits)
    const queue = this.pendingListItems.get(listUri) || [];
    
    queue.push(item);
    this.pendingListItems.set(listUri, queue);
    
    // Add to index
    this.pendingListItemIndex.set(itemUri, listUri);
    
    this.totalPendingListItems++;
    this.metrics.pendingListItemsQueued++;
  }

  private async flushPendingListItems(listUri: string) {
    // Atomically remove queue before processing to avoid race conditions
    const items = this.pendingListItems.get(listUri);
    if (!items || items.length === 0) {
      return;
    }
    
    // Delete immediately to prevent new items from being lost
    this.pendingListItems.delete(listUri);

    smartConsole.log(`[EVENT_PROCESSOR] Flushing ${items.length} pending list items for ${listUri}`);

    for (const item of items) {
      try {
        await this.storage.createListItem(item.payload);
        this.metrics.pendingListItemsFlushed++;
        
        // Remove from index
        this.pendingListItemIndex.delete(item.payload.uri);
        this.totalPendingListItems--;
      } catch (error: any) {
        // If still failing, skip it
        smartConsole.error(`[EVENT_PROCESSOR] Error flushing pending list item:`, error.message);
        // Still remove from index and count
        this.pendingListItemIndex.delete(item.payload.uri);
        this.totalPendingListItems--;
      }
    }
  }

  private async flushPendingUserCreationOps(did: string) {
    const ops = this.pendingUserCreationOps.get(did);
    if (!ops || ops.length === 0) {
      return;
    }

    this.pendingUserCreationOps.delete(did);

    smartConsole.log(`[EVENT_PROCESSOR] Flushing ${ops.length} pending user creation operations for ${did}`);

    for (const pendingOp of ops) {
      // Reprocess the original commit operation
      await this.processCommit({ repo: pendingOp.repo, ops: [pendingOp.op] });
      this.totalPendingUserCreationOps--;
      this.metrics.pendingUserCreationOpsFlushed++;
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      pendingCount: this.totalPendingCount,
      pendingUserOpsCount: this.totalPendingUserOps,
      pendingListItemsCount: this.totalPendingListItems,
      pendingUserCreationOpsCount: this.totalPendingUserCreationOps,
      activeUserCreations: this.activeUserCreations,
      pendingUserCreationDeduplication: this.pendingUserCreations.size,
    };
  }

  /**
   * Retry processing pending operations for users that might now have their data available
   */
  async retryPendingOperations() {
    smartConsole.log(`[EVENT_PROCESSOR] Retrying pending operations...`);
    
    let retriedCount = 0;
    
    // Retry pending user creation operations
    for (const [did, ops] of Array.from(this.pendingUserCreationOps.entries())) {
      try {
        // Check if user now exists
        const user = await this.storage.getUser(did);
        if (user) {
          // User exists, flush the operations
          await this.flushPendingUserCreationOps(did);
          retriedCount += ops.length;
        }
      } catch (error) {
        smartConsole.error(`[EVENT_PROCESSOR] Error retrying user creation ops for ${did}:`, error);
      }
    }
    
    // Retry pending user operations
    for (const [userDid, ops] of Array.from(this.pendingUserOps.entries())) {
      try {
        // Check if user now exists
        const user = await this.storage.getUser(userDid);
        if (user) {
          // User exists, flush the operations
          await this.flushPendingUserOps(userDid);
          retriedCount += ops.length;
        }
      } catch (error) {
        smartConsole.error(`[EVENT_PROCESSOR] Error retrying user ops for ${userDid}:`, error);
      }
    }
    
    // Retry pending list items
    for (const [listUri, items] of Array.from(this.pendingListItems.entries())) {
      try {
        // Check if list now exists
        const list = await this.storage.getList(listUri);
        if (list) {
          // List exists, flush the items
          await this.flushPendingListItems(listUri);
          retriedCount += items.length;
        }
      } catch (error) {
        smartConsole.error(`[EVENT_PROCESSOR] Error retrying list items for ${listUri}:`, error);
      }
    }
    
    // Retry pending likes/reposts
    for (const [postUri, ops] of Array.from(this.pendingOps.entries())) {
      try {
        // Check if post now exists
        const post = await this.storage.getPost(postUri);
        if (post) {
          // Post exists, flush the operations
          await this.flushPending(postUri);
          retriedCount += ops.length;
        }
      } catch (error) {
        smartConsole.error(`[EVENT_PROCESSOR] Error retrying pending ops for ${postUri}:`, error);
      }
    }
    
    if (retriedCount > 0) {
      smartConsole.log(`[EVENT_PROCESSOR] Successfully retried ${retriedCount} pending operations`);
    }
    
    return retriedCount;
  }

  private async ensureUser(did: string): Promise<boolean> {
    // Check if there's already a pending creation for this user
    // This prevents duplicate concurrent operations for the same user
    const existingCreation = this.pendingUserCreations.get(did);
    if (existingCreation) {
      return existingCreation;
    }
    
    // Create the promise and store it
    const creationPromise = this.ensureUserInternal(did);
    this.pendingUserCreations.set(did, creationPromise);
    
    // Clean up after completion
    creationPromise.finally(() => {
      this.pendingUserCreations.delete(did);
    });
    
    return creationPromise;
  }
  
  private async ensureUserInternal(did: string): Promise<boolean> {
    try {
      // First check if user exists - quick DB query
      const user = await this.storage.getUser(did);
      
      if (!user) {
        // Wait if we're at the concurrent creation limit
        // This prevents overwhelming the database with too many concurrent user creations
        while (this.activeUserCreations >= this.MAX_CONCURRENT_USER_CREATIONS) {
          await new Promise(resolve => setTimeout(resolve, 10)); // Wait 10ms before checking again
        }
        
        this.activeUserCreations++;
        
        try {
          // User doesn't exist - we need to create them
          // CRITICAL: We skip DID resolution during initial creation to avoid holding DB connections
          // for extended periods, which would exhaust the connection pool
          // The user will be marked for profile fetching to get the proper handle later
          
          // Use 'handle.invalid' as a temporary fallback (matches Bluesky's approach)
          // This will be updated when the profile is fetched with the actual handle
          const INVALID_HANDLE = 'handle.invalid';
          
          // Create user with fallback handle - will be updated when profile is fetched
          // This keeps the DB operation fast
          try {
            await this.storage.createUser({
              did,
              handle: INVALID_HANDLE, // Use standard fallback handle
            });
            
            // Mark user for profile fetching to get proper handle and avatar/banner data
            // Skip during bulk operations to avoid overwhelming the system
            if (!this.skipPdsFetching) {
              pdsDataFetcher.markIncomplete('user', did);
            }
            
            // Batch logging: only log every 5000 user creations
            this.userCreationCount++;
            if (this.userCreationCount % this.USER_BATCH_LOG_SIZE === 0) {
              smartConsole.log(`[EVENT_PROCESSOR] Created ${this.USER_BATCH_LOG_SIZE} users (total: ${this.userCreationCount})`);
            }
          } catch (createError: any) {
            // If createUser resulted in a unique constraint violation, it means the user was created
            // by a parallel process. This is fine - we can continue.
            if (createError.code !== '23505') {
              throw createError;
            }
          }
        } finally {
          this.activeUserCreations--;
        }
      } else if (!user.avatarUrl && !user.displayName) {
        // User exists but has no profile data - mark for fetching
        // Skip during bulk operations to avoid overwhelming the system
        if (!this.skipPdsFetching) {
          pdsDataFetcher.markIncomplete('user', did);
        }
      }
      
      // If we reach here, the user *should* exist, either from before or from creation.
      // Now, flush all pending operations for this user.
      await this.flushPendingUserOps(did);
      await this.flushPendingUserCreationOps(did);
      return true;
    } catch (error: any) {
      // If createUser resulted in a unique constraint violation, it means the user was created
      // by a parallel process. We can treat this as a success and flush the queues.
      if (error.code === '23505') {
        await this.flushPendingUserOps(did);
        await this.flushPendingUserCreationOps(did);
        return true;
      }
      smartConsole.error(`[EVENT_PROCESSOR] Error ensuring user ${did}:`, error);
      return false;
    }
  }

  /**
   * Mark an entry as incomplete for PDS data fetching
   */
  private markIncompleteForFetch(action: string, uri: string, constraint?: string) {
    try {
      // Extract DID from URI
      const uriParts = uri.split('/');
      if (uriParts.length < 3) return;
      
      const did = uriParts[2]; // at://did:plc:xxx/collection/rkey
      
      // Determine the type based on the action and constraint
      let type: 'user' | 'post' | 'like' | 'repost' | 'follow' | 'list' | 'listitem' | 'feedgen' | 'starterpack' | 'labeler' | 'record' = 'user';
      
      if (action === 'create' || action === 'update') {
        if (uri.includes('/app.bsky.feed.post/')) {
          type = 'post';
        } else if (uri.includes('/app.bsky.feed.like/')) {
          type = 'like';
        } else if (uri.includes('/app.bsky.feed.repost/')) {
          type = 'repost';
        } else if (uri.includes('/app.bsky.graph.follow/')) {
          type = 'follow';
        } else if (uri.includes('/app.bsky.graph.listitem/')) {
          type = 'listitem';
        } else if (uri.includes('/app.bsky.graph.list/')) {
          type = 'list';
        } else if (uri.includes('/app.bsky.feed.generator/')) {
          type = 'feedgen';
        } else if (uri.includes('/app.bsky.graph.starterpack/')) {
          type = 'starterpack';
        } else if (uri.includes('/app.bsky.labeler.service/')) {
          type = 'labeler';
        } else {
          type = 'record';
        }
      }
      
      pdsDataFetcher.markIncomplete(type, did, uri, { action, constraint });
    } catch (error) {
      smartConsole.error(`[EVENT_PROCESSOR] Error marking incomplete entry:`, error);
    }
  }

  /**
   * Process a record (used by PDS data fetcher)
   */
  async processRecord(uri: string, cid: string, authorDid: string, record: any) {
    try {
      const recordType = record.$type;
      
      switch (recordType) {
        case "app.bsky.feed.post":
          await this.processPost(uri, cid, authorDid, record);
          break;
        case "app.bsky.feed.like":
          await this.processLike(authorDid, { uri, cid, record });
          break;
        case "app.bsky.feed.repost":
          await this.processRepost(uri, authorDid, record);
          break;
        case "app.bsky.graph.follow":
          await this.processFollow(authorDid, { path: uri.split('at://')[1].split(authorDid + '/')[1], record });
          break;
        case "app.bsky.graph.block":
          await this.processBlock(uri, authorDid, record);
          break;
        case "app.bsky.graph.list":
          await this.processList(uri, cid, authorDid, record);
          break;
        case "app.bsky.graph.listitem":
          await this.processListItem(uri, cid, authorDid, record);
          break;
        case "app.bsky.feed.generator":
          await this.processFeedGenerator(uri, cid, authorDid, record);
          break;
        case "app.bsky.graph.starterpack":
          await this.processStarterPack(authorDid, { path: uri.split('at://')[1].split(authorDid + '/')[1], cid, record });
          break;
        case "app.bsky.labeler.service":
          await this.processLabelerService(uri, cid, authorDid, record);
          break;
        default:
          smartConsole.log(`[EVENT_PROCESSOR] Unknown record type: ${recordType}`);
      }
    } catch (error: any) {
      // Handle duplicate key errors gracefully (common during firehose reconnections)
      // Silently skip duplicates as they don't matter
      if (error?.code === '23505') {
        // Silently skip duplicates
        return;
      }
      smartConsole.error(`[EVENT_PROCESSOR] Error processing record ${uri}:`, error);
    }
  }

  async processCommit(event: any) {
    const { repo, ops } = event;

    for (const op of ops) {
      const { action, path, cid } = op;
      const collection = path.split("/")[0];
      const uri = `at://${repo}/${path}`;

      try {
        if (action === "create" || action === "update") {
          const record = op.record;
          const recordType = record.$type;

          // Validate record
          if (!lexiconValidator.validate(recordType, record)) {
            smartConsole.log(`[VALIDATOR] Invalid record: ${recordType} at ${uri}`);
            continue;
          }

          switch (recordType) {
            case "app.bsky.feed.post":
              await this.processPost(uri, cid, repo, record);
              break;
            case "app.bsky.feed.like":
              await this.processLike(repo, op);
              break;
            case "app.bsky.feed.repost":
              await this.processRepost(uri, repo, record, cid);
              break;
            case "app.bsky.bookmark":
              await this.processBookmark(uri, repo, record, cid);
              break;
            case "app.bsky.actor.profile":
              await this.processProfile(repo, record);
              break;
            case "app.bsky.graph.follow":
              await this.processFollow(repo, op);
              break;
            case "app.bsky.graph.block":
              await this.processBlock(uri, repo, record);
              break;
            case "app.bsky.graph.list":
              await this.processList(uri, cid, repo, record);
              break;
            case "app.bsky.graph.listitem":
              await this.processListItem(uri, cid, repo, record);
              break;
            case "app.bsky.feed.generator":
              await this.processFeedGenerator(uri, cid, repo, record);
              break;
            case "app.bsky.graph.starterpack":
              await this.processStarterPack(repo, op);
              break;
            case "app.bsky.labeler.service":
              await this.processLabelerService(uri, cid, repo, record);
              break;
            case "com.atproto.label.label":
              await this.processLabel(uri, repo, record);
              break;
            case "app.bsky.graph.verification":
              await this.processVerification(uri, cid, repo, record);
              break;
          }
        } else if (action === "delete") {
          await this.processDelete(uri, collection);
        }
      } catch (error: any) {
        // Handle duplicate key errors gracefully (common during firehose reconnections)
        if (error?.code === '23505') {
          // Silently skip duplicates
        } 
        // Handle foreign key constraint violations (record references missing data)
        else if (error?.code === '23503') {
          smartConsole.log(`[EVENT_PROCESSOR] Skipped ${action} ${uri} - referenced record not yet indexed (${error.constraint || 'unknown constraint'})`);
          
          // Mark as incomplete for PDS data fetching
          this.markIncompleteForFetch(action, uri, error.constraint);
        } 
        else {
          smartConsole.error(`[EVENT_PROCESSOR] Error processing ${action} ${uri}:`, error);
        }
      }
    }
  }

  async processIdentity(event: any) {
    const { did, handle } = event;
    
    try {
      await this.storage.upsertUserHandle(did, handle);
      smartConsole.log(`[IDENTITY] Upserted handle for ${did} to ${handle}`);
    } catch (error) {
      smartConsole.error(`[EVENT_PROCESSOR] Error processing identity for ${did}:`, error);
    }
  }

  async processAccount(event: any) {
    const { did, active } = event;
    smartConsole.log(`[ACCOUNT] Account status change: ${did} - active: ${active}`);
  }

  private async processPost(uri: string, cid: string, authorDid: string, record: any) {
    const authorReady = await this.ensureUser(authorDid);
    if (!authorReady) {
      smartConsole.warn(`[EVENT_PROCESSOR] Skipping post ${uri} - author not ready`);
      return;
    }
    
    // Check if data collection is forbidden for this user
    if (await this.isDataCollectionForbidden(authorDid)) {
      return;
    }

    const post: InsertPost = {
      uri,
      cid,
      authorDid,
      text: sanitizeRequiredText(record.text),
      parentUri: record.reply?.parent.uri,
      rootUri: record.reply?.root.uri,
      embed: record.embed,
      createdAt: this.safeDate(record.createdAt),
    };

    await this.storage.createPost(post);
    
    // Create post aggregation record
    try {
      await this.storage.createPostAggregation({
        postUri: uri,
        likeCount: 0,
        repostCount: 0,
        replyCount: 0,
        bookmarkCount: 0,
        quoteCount: 0,
      });
    } catch (error: any) {
      // Ignore duplicate key errors (23505) - aggregation already exists
      if (error?.code !== '23505') {
        throw error;
      }
    }
    
    // If this is a reply, increment the parent post's reply count and create thread context
    if (record.reply?.parent.uri) {
      await this.storage.incrementPostAggregation(record.reply.parent.uri, 'replyCount', 1);
      
      // Create thread context for the reply
      const rootUri = record.reply.root?.uri || record.reply.parent.uri;
      const rootPost = await this.storage.getPost(rootUri);
      if (rootPost) {
        // Check if the root author has liked this post (for thread context)
        const rootAuthorLikeUri = await this.storage.getLikeUri(rootPost.authorDid, uri);
        
        await this.storage.createThreadContext({
          postUri: uri,
          rootAuthorLikeUri: rootAuthorLikeUri || undefined,
        });
      }
    }
    
    // Create feed item for the post
    const feedItem: InsertFeedItem = {
      uri: uri,
      postUri: uri,
      originatorDid: authorDid,
      type: 'post',
      sortAt: this.safeDate(record.createdAt),
      cid: cid,
      createdAt: this.safeDate(record.createdAt),
    };
    await this.storage.createFeedItem(feedItem);
    
    // Create notification for reply
    if (record.reply?.parent.uri) {
      try {
        const parentPost = await this.storage.getPost(record.reply.parent.uri);
        if (parentPost && parentPost.authorDid !== authorDid) {
          await this.storage.createNotification({
            uri: `at://${uri.replace('at://', '')}#notification/reply`,
            recipientDid: parentPost.authorDid,
            authorDid,
            reason: 'reply',
            reasonSubject: uri,
            cid: cid,
            isRead: false,
            createdAt: new Date(record.createdAt),
          });
        }
      } catch (error) {
        smartConsole.error(`[NOTIFICATION] Error creating reply notification:`, error);
      }
    }

    // Check for mentions in text
    try {
      const mentions = record.text?.match(/@([a-zA-Z0-9.-]+)/g) || [];
      const processedMentions = new Set<string>();
      
      for (const mention of mentions) {
        const handle = mention.substring(1);
        
        // Skip if we've already processed this handle in this post
        if (processedMentions.has(handle)) {
          continue;
        }
        
        const mentionedUser = await this.storage.getUserByHandle(handle);
        if (mentionedUser && mentionedUser.did !== authorDid) {
          await this.storage.createNotification({
            uri: `at://${uri.replace('at://', '')}#notification/mention/${mentionedUser.did}`,
            recipientDid: mentionedUser.did,
            authorDid,
            reason: 'mention',
            reasonSubject: uri,
            cid: cid,
            isRead: false,
            createdAt: new Date(record.createdAt),
          });
          processedMentions.add(handle);
        }
      }
    } catch (error) {
        smartConsole.error(`[NOTIFICATION] Error creating mention notifications:`, error);
    }
    
    // Handle quote posts (embed.record or embed.recordWithMedia)
    try {
      let quotedUri: string | null = null;
      let quotedCid: string | null = null;
      
      if (record.embed?.$type === 'app.bsky.embed.record') {
        quotedUri = record.embed.record.uri;
        quotedCid = record.embed.record.cid;
      } else if (record.embed?.$type === 'app.bsky.embed.recordWithMedia') {
        quotedUri = record.embed.record.record.uri;
        quotedCid = record.embed.record.record.cid;
      }
      
      if (quotedUri) {
        await this.storage.createQuote({
          uri: `${uri}#quote`,
          cid,
          postUri: uri,
          quotedUri,
          quotedCid: quotedCid || undefined,
          createdAt: this.safeDate(record.createdAt),
        });
        
        // Increment quoted post's quote count
        await this.storage.incrementPostAggregation(quotedUri, 'quoteCount', 1);
        
        // Create notification for quote
        const quotedPost = await this.storage.getPost(quotedUri);
        if (quotedPost && quotedPost.authorDid !== authorDid) {
          await this.storage.createNotification({
            uri: `at://${uri.replace('at://', '')}#notification/quote`,
            recipientDid: quotedPost.authorDid,
            authorDid,
            reason: 'quote',
            reasonSubject: uri,
            cid: cid,
            isRead: false,
            createdAt: new Date(record.createdAt),
          });
        }
      }
    } catch (error) {
      smartConsole.error(`[QUOTE] Error processing quote:`, error);
    }
    
    // Flush any pending operations for this post
    await this.flushPending(uri);
  }

  private async processLike(repo: string, op: any) {
    const { path, record, cid } = op;
    const uri = `at://${repo}/${path}`;
    const userDid = repo;

    const userReady = await this.ensureUser(userDid);
    if (!userReady) {
      smartConsole.warn(`[EVENT_PROCESSOR] Skipping like ${uri} - user not ready, enqueuing`);
      this.enqueuePendingUserCreationOp(userDid, repo, op);
      return;
    }
    
    // Check if data collection is forbidden for this user
    if (await this.isDataCollectionForbidden(userDid)) {
      return;
    }

    const postUri = record.subject.uri;
    const like: InsertLike = {
      uri,
      userDid,
      postUri,
      createdAt: this.safeDate(record.createdAt),
    };

    // Insert like directly - foreign key constraints removed for federated data
    try {
      await this.storage.createLike(like);
      
      // Increment post aggregation like count
      await this.storage.incrementPostAggregation(postUri, 'likeCount', 1);
      
      // Create viewer state for the like
      await this.storage.createPostViewerState({
        postUri,
        viewerDid: userDid,
        likeUri: uri,
        bookmarked: false,
        threadMuted: false,
        replyDisabled: false,
        embeddingDisabled: false,
        pinned: false,
      });
      
      // Try to create notification if post exists locally
      const post = await this.storage.getPost(postUri);
      if (post && post.authorDid !== userDid) {
        try {
          await this.storage.createNotification({
            uri: `at://${uri.replace('at://', '')}#notification`,
            recipientDid: post.authorDid,
            authorDid: userDid,
            reason: 'like',
            reasonSubject: postUri,
            cid: cid,
            isRead: false,
            createdAt: new Date(record.createdAt),
          });
        } catch (error) {
          smartConsole.error(`[NOTIFICATION] Error creating like notification:`, error);
        }
      }
    } catch (error: any) {
      // Ignore duplicate key errors (23505)
      if (error.code === '23505') {
        return;
      }
      throw error;
    }
  }

  private async processRepost(uri: string, userDid: string, record: any, cid?: string) {
    const userReady = await this.ensureUser(userDid);
    if (!userReady) {
      smartConsole.warn(`[EVENT_PROCESSOR] Skipping repost ${uri} - user not ready`);
      return;
    }
    
    // Check if data collection is forbidden for this user
    if (await this.isDataCollectionForbidden(userDid)) {
      return;
    }

    const postUri = record.subject.uri;
    const repost: InsertRepost = {
      uri,
      userDid,
      postUri,
      createdAt: this.safeDate(record.createdAt),
    };

    // Insert repost directly - foreign key constraints removed for federated data
    try {
      await this.storage.createRepost(repost);
      
      // Increment post aggregation repost count
      await this.storage.incrementPostAggregation(postUri, 'repostCount', 1);
      
      // Create or update viewer state for the repost
      await this.storage.createPostViewerState({
        postUri,
        viewerDid: userDid,
        repostUri: uri,
        bookmarked: false,
        threadMuted: false,
        replyDisabled: false,
        embeddingDisabled: false,
        pinned: false,
      });
      
      // Create feed item for the repost
      const feedItem: InsertFeedItem = {
        uri: uri,
        postUri: postUri,
        originatorDid: userDid,
        type: 'repost',
        sortAt: this.safeDate(record.createdAt),
        cid: cid || uri, // Use CID if available, otherwise use URI
        createdAt: this.safeDate(record.createdAt),
      };
      await this.storage.createFeedItem(feedItem);
      
      // Try to create notification if post exists locally
      const post = await this.storage.getPost(postUri);
      if (post && post.authorDid !== userDid) {
        try {
          await this.storage.createNotification({
            uri: `at://${uri.replace('at://', '')}#notification`,
            recipientDid: post.authorDid,
            authorDid: userDid,
            reason: 'repost',
            reasonSubject: postUri,
            cid: cid,
            isRead: false,
            createdAt: new Date(record.createdAt),
          });
        } catch (error) {
          smartConsole.error(`[NOTIFICATION] Error creating repost notification:`, error);
        }
      }
    } catch (error: any) {
      // Ignore duplicate key errors (23505)
      if (error.code === '23505') {
        return;
      }
      throw error;
    }
  }

  private async processBookmark(uri: string, userDid: string, record: any, cid?: string) {
    const userReady = await this.ensureUser(userDid);
    if (!userReady) {
      smartConsole.warn(`[EVENT_PROCESSOR] Skipping bookmark ${uri} - user not ready`);
      return;
    }
    
    // Check if data collection is forbidden for this user
    if (await this.isDataCollectionForbidden(userDid)) {
      return;
    }

    const postUri = record.subject.uri;
    const bookmark = {
      uri,
      userDid,
      postUri,
      createdAt: this.safeDate(record.createdAt),
    };

    // Insert bookmark directly - foreign key constraints removed for federated data
    try {
      await this.storage.createBookmark(bookmark);
      
      // Increment post aggregation bookmark count
      await this.storage.incrementPostAggregation(postUri, 'bookmarkCount', 1);
      
      // Create or update viewer state for the bookmark
      await this.storage.createPostViewerState({
        postUri,
        viewerDid: userDid,
        bookmarked: true,
        threadMuted: false,
        replyDisabled: false,
        embeddingDisabled: false,
        pinned: false,
      });
    } catch (error: any) {
      // Ignore duplicate key errors (23505)
      if (error.code === '23505') {
        return;
      }
      throw error;
    }
  }

  private async processProfile(did: string, record: any) {
    // Resolve DID to get handle from DID document
    const handle = await didResolver.resolveDIDToHandle(did);
    
    const existingUser = await this.storage.getUser(did);

    const profileData = {
      handle: handle || 'handle.invalid', // Use resolved handle or standard fallback
      displayName: sanitizeText(record.displayName),
      description: sanitizeText(record.description),
      avatarUrl: extractBlobCid(record.avatar),
      bannerUrl: extractBlobCid(record.banner),
      profileRecord: record,
    };

    if (existingUser) {
      await this.storage.updateUser(did, profileData);
      if (handle) {
        smartConsole.log(`[EVENT_PROCESSOR] Updated user ${did} with handle ${handle}`);
      }
    } else {
      await this.storage.createUser({ did, ...profileData });
      if (handle) {
        // Batch logging: only log every 5000 user creations
        this.userCreationCount++;
        if (this.userCreationCount % this.USER_BATCH_LOG_SIZE === 0) {
          smartConsole.log(`[EVENT_PROCESSOR] Created ${this.USER_BATCH_LOG_SIZE} users (total: ${this.userCreationCount})`);
        }
      } else {
        smartConsole.warn(`[EVENT_PROCESSOR] Created user ${did} without handle (DID resolution failed)`);
      }
    }
  }

  private async processFollow(repo: string, op: any) {
    const { path, record, cid } = op;
    const uri = `at://${repo}/${path}`;
    const followerDid = repo;

    // Ensure the user performing the action exists
    const followerReady = await this.ensureUser(followerDid);
    if (!followerReady) {
      smartConsole.warn(`[EVENT_PROCESSOR] Skipping follow ${uri} - follower not ready, enqueuing`);
      this.enqueuePendingUserCreationOp(followerDid, repo, op);
      return;
    }

    // Check if data collection is forbidden for this user
    if (await this.isDataCollectionForbidden(followerDid)) {
      return;
    }

    const followingDid = record.subject;
    const follow: InsertFollow = {
      uri,
      followerDid,
      followingDid,
      createdAt: this.safeDate(record.createdAt),
    };

    // Insert follow directly - foreign key constraints removed for federated data
    try {
      await this.storage.createFollow(follow);
      
      // Try to create notification if target user exists locally
      const followingUser = await this.storage.getUser(followingDid);
      if (followingUser) {
        try {
          await this.storage.createNotification({
            uri: `at://${uri.replace('at://', '')}#notification`,
            recipientDid: followingDid,
            authorDid: followerDid,
            reason: 'follow',
            reasonSubject: undefined,
            cid: cid,
            isRead: false,
            createdAt: new Date(record.createdAt),
          });
        } catch (error) {
          smartConsole.error(`[NOTIFICATION] Error creating follow notification:`, error);
        }
      }
    } catch (error: any) {
      // Ignore duplicate key errors (23505)
      if (error.code === '23505') {
        return;
      }
      smartConsole.error(`[EVENT_PROCESSOR] Error creating follow ${uri}:`, error);
    }
  }

  private async processBlock(uri: string, blockerDid: string, record: any) {
    // Ensure the user performing the action exists
    const blockerReady = await this.ensureUser(blockerDid);
    if (!blockerReady) {
      smartConsole.warn(`[EVENT_PROCESSOR] Skipping block ${uri} - blocker not ready`);
      return;
    }

    // Check if data collection is forbidden for this user
    if (await this.isDataCollectionForbidden(blockerDid)) {
      return;
    }

    const blockedDid = record.subject;
    const block: InsertBlock = {
      uri,
      blockerDid,
      blockedDid,
      createdAt: this.safeDate(record.createdAt),
    };

    // Insert block directly - foreign key constraints removed for federated data
    try {
      await this.storage.createBlock(block);
    } catch (error: any) {
      // Ignore duplicate key errors (23505)
      if (error.code === '23505') {
        return;
      }
      smartConsole.error(`[EVENT_PROCESSOR] Error creating block ${uri}:`, error);
    }
  }

  private async processList(uri: string, cid: string, creatorDid: string, record: any) {
    const creatorReady = await this.ensureUser(creatorDid);
    if (!creatorReady) {
      smartConsole.warn(`[EVENT_PROCESSOR] Skipping list ${uri} - creator not ready`);
      return;
    }
    
    // Check if data collection is forbidden for this user
    if (await this.isDataCollectionForbidden(creatorDid)) {
      return;
    }

    const list: InsertList = {
      uri,
      cid,
      creatorDid,
      name: sanitizeRequiredText(record.name),
      purpose: record.purpose,
      description: sanitizeText(record.description),
      avatarUrl: extractBlobCid(record.avatar),
      createdAt: this.safeDate(record.createdAt),
    };

    await this.storage.createList(list);
    
    // Flush any pending list items that were waiting for this list
    await this.flushPendingListItems(uri);
  }

  private async processListItem(uri: string, cid: string, creatorDid: string, record: any) {
    const creatorReady = await this.ensureUser(creatorDid);
    const subjectReady = await this.ensureUser(record.subject);
    
    if (!creatorReady || !subjectReady) {
      smartConsole.warn(`[EVENT_PROCESSOR] Skipping list item ${uri} - users not ready`);
      return;
    }
    
    // Check if data collection is forbidden for this user
    if (await this.isDataCollectionForbidden(creatorDid)) {
      return;
    }

    const listItem: InsertListItem = {
      uri,
      cid,
      listUri: record.list,
      subjectDid: record.subject,
      createdAt: this.safeDate(record.createdAt),
    };

    // Check if parent list exists before attempting insert (prevents FK errors in logs)
    const parentList = await this.storage.getList(record.list);
    if (!parentList) {
      // Queue the list item to be processed when the list arrives
      this.enqueuePendingListItem(record.list, {
        payload: listItem,
        enqueuedAt: Date.now(),
      });
      return;
    }

    try {
      await this.storage.createListItem(listItem);
    } catch (error: any) {
      // Fallback: if FK error still happens (race condition), queue it
      if (error.code === '23503') {
        this.enqueuePendingListItem(record.list, {
          payload: listItem,
          enqueuedAt: Date.now(),
        });
      } else {
        throw error;
      }
    }
  }

  private async processLabel(uri: string, src: string, record: any) {
    try {
      await labelService.applyLabel({
        src,
        subject: record.uri || record.did,
        val: record.val,
        neg: record.neg || false,
        createdAt: new Date(record.cid ? record.createdAt : Date.now()),
      });
      smartConsole.log(`[LABEL] Applied label ${record.val} to ${record.uri || record.did} from ${src}`);
    } catch (error: any) {
      if (error?.code === '23505') {
        smartConsole.log(`[EVENT_PROCESSOR] Skipped duplicate label ${record.val} for ${record.uri || record.did}`);
      } else {
        smartConsole.error(`[EVENT_PROCESSOR] Error processing label:`, error);
      }
    }
  }

  private async processFeedGenerator(uri: string, cid: string, creatorDid: string, record: any) {
    const creatorReady = await this.ensureUser(creatorDid);
    if (!creatorReady) {
      smartConsole.warn(`[EVENT_PROCESSOR] Skipping feed generator ${uri} - creator not ready`);
      return;
    }
    
    // Check if data collection is forbidden for this user
    if (await this.isDataCollectionForbidden(creatorDid)) {
      return;
    }

    const feedGenerator: InsertFeedGenerator = {
      uri,
      cid,
      creatorDid,
      did: record.did,
      displayName: sanitizeRequiredText(record.displayName),
      description: sanitizeText(record.description),
      avatarUrl: extractBlobCid(record.avatar),
      createdAt: this.safeDate(record.createdAt),
    };

    await this.storage.createFeedGenerator(feedGenerator);
  }

  private async processStarterPack(repo: string, op: any) {
    const { path, cid, record } = op;
    const uri = `at://${repo}/${path}`;
    const creatorDid = repo;

    const creatorReady = await this.ensureUser(creatorDid);
    if (!creatorReady) {
      smartConsole.warn(`[EVENT_PROCESSOR] Skipping starter pack ${uri} - creator not ready, enqueuing`);
      this.enqueuePendingUserCreationOp(creatorDid, repo, op);
      return;
    }
    
    // Check if data collection is forbidden for this user
    if (await this.isDataCollectionForbidden(creatorDid)) {
      return;
    }

    const starterPack: InsertStarterPack = {
      uri,
      cid,
      creatorDid,
      name: sanitizeRequiredText(record.name),
      description: sanitizeText(record.description),
      listUri: record.list,
      feeds: record.feeds?.map((f: any) => f.uri) || [],
      createdAt: this.safeDate(record.createdAt),
    };

    await this.storage.createStarterPack(starterPack);
  }

  private async processLabelerService(uri: string, cid: string, creatorDid: string, record: any) {
    const creatorReady = await this.ensureUser(creatorDid);
    if (!creatorReady) {
      smartConsole.warn(`[EVENT_PROCESSOR] Skipping labeler service ${uri} - creator not ready`);
      return;
    }
    
    // Check if data collection is forbidden for this user
    if (await this.isDataCollectionForbidden(creatorDid)) {
      return;
    }

    const labelerService: InsertLabelerService = {
      uri,
      cid,
      creatorDid,
      policies: record.policies || { labelValues: [], labelValueDefinitions: [] },
      createdAt: this.safeDate(record.createdAt),
    };

    await this.storage.createLabelerService(labelerService);
    smartConsole.log(`[LABELER_SERVICE] Processed labeler service ${uri} for ${creatorDid}`);
  }

  private async processVerification(uri: string, cid: string, creatorDid: string, record: any) {
    const creatorReady = await this.ensureUser(creatorDid);
    if (!creatorReady) {
      smartConsole.warn(`[EVENT_PROCESSOR] Skipping verification ${uri} - creator not ready`);
      return;
    }
    
    // Check if data collection is forbidden for this user
    if (await this.isDataCollectionForbidden(creatorDid)) {
      return;
    }

    const verification: InsertVerification = {
      uri,
      cid,
      subjectDid: record.subject || creatorDid,
      handle: record.handle || '',
      verifiedAt: this.safeDate(record.verifiedAt),
      createdAt: this.safeDate(record.createdAt),
    };

    await this.storage.createVerification(verification);
    smartConsole.log(`[VERIFICATION] Processed verification ${uri} for ${verification.subjectDid}`);
  }

  // Guard against invalid or missing dates in upstream records
  private safeDate(value: string | Date | undefined): Date {
    if (!value) return new Date();
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? new Date() : d;
  }

  private async processDelete(uri: string, collection: string) {
    // Cancel pending op if it's a like/repost being deleted
    if (collection === "app.bsky.feed.like" || collection === "app.bsky.feed.repost") {
      this.cancelPendingOp(uri);
    } else if (collection === "app.bsky.graph.follow" || collection === "app.bsky.graph.block") {
      this.cancelPendingUserOp(uri);
    }
    
    // If it's a post being deleted, clear all pending likes/reposts for it
    if (collection === "app.bsky.feed.post") {
      const ops = this.pendingOps.get(uri);
      if (ops && ops.length > 0) {
        // Remove from index and update count
        for (const op of ops) {
          this.pendingOpIndex.delete(op.payload.uri);
          this.totalPendingCount--;
        }
        this.pendingOps.delete(uri);
        smartConsole.log(`[EVENT_PROCESSOR] Cleared ${ops.length} pending operations for deleted post ${uri}`);
      }
    }
    
    switch (collection) {
      case "app.bsky.feed.post":
        await this.storage.deletePost(uri);
        await this.storage.deleteFeedItem(uri); // Delete corresponding feed item
        break;
      case "app.bsky.feed.like":
        const like = await this.storage.getLike(uri);
        if (like) {
          await this.storage.deleteLike(uri, like.userDid);
          await this.storage.incrementPostAggregation(like.postUri, 'likeCount', -1);
          await this.storage.deletePostViewerState(like.postUri, like.userDid);
        }
        break;
      case "app.bsky.feed.repost":
        const repost = await this.storage.getRepost(uri);
        if (repost) {
          await this.storage.deleteRepost(uri);
          await this.storage.deleteFeedItem(uri); // Delete corresponding feed item
          await this.storage.incrementPostAggregation(repost.postUri, 'repostCount', -1);
          await this.storage.deletePostViewerState(repost.postUri, repost.userDid);
        }
        break;
      case "app.bsky.bookmark":
        const bookmark = await this.storage.getBookmark(uri);
        if (bookmark) {
          await this.storage.deleteBookmark(uri);
          await this.storage.incrementPostAggregation(bookmark.postUri, 'bookmarkCount', -1);
          await this.storage.deletePostViewerState(bookmark.postUri, bookmark.userDid);
        }
        break;
      case "app.bsky.graph.follow":
        try {
          const follow = await this.storage.getFollow(uri);
          if (follow) {
            await this.storage.deleteFollow(uri, follow.followerDid);
          }
        } catch (error: any) {
          // Fallback: extract followerDid from URI (at://did/collection/rkey)
          const uriParts = uri.replace('at://', '').split('/');
          if (uriParts.length >= 1) {
            const followerDid = uriParts[0];
            try {
              await this.storage.deleteFollow(uri, followerDid);
            } catch (deleteError: any) {
              smartConsole.error(`[EVENT_PROCESSOR] Error deleting follow ${uri}:`, deleteError);
            }
          }
        }
        break;
      case "app.bsky.graph.block":
        await this.storage.deleteBlock(uri);
        break;
      case "app.bsky.graph.list":
        await this.storage.deleteList(uri);
        break;
      case "app.bsky.graph.listitem":
        await this.storage.deleteListItem(uri);
        break;
      case "app.bsky.feed.generator":
        await this.storage.deleteFeedGenerator(uri);
        break;
      case "app.bsky.graph.starterpack":
        await this.storage.deleteStarterPack(uri);
        break;
      case "app.bsky.labeler.service":
        await this.storage.deleteLabelerService(uri);
        break;
      case "com.atproto.label.label":
        await labelService.removeLabel(uri);
        break;
    }
  }
}

export const eventProcessor = new EventProcessor();
