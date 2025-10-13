import { AtpAgent } from "@atproto/api";
import { IdResolver } from "@atproto/identity";
import { readCar, MemoryBlockstore } from "@atproto/repo";
import { ReadableRepo } from "@atproto/repo/dist/readable-repo.js";
import { EventProcessor } from "./event-processor";
import { createStorage, type IStorage } from "../storage";
import { createDbPool } from "../db";
import { logCollector } from "./log-collector";
import { sanitizeObject } from "../utils/sanitize";
import { createHash } from "crypto";

// Create dedicated connection pool for repo backfill
const repoBackfillPoolSize = parseInt(process.env.BACKFILL_DB_POOL_SIZE || '2');
const repoBackfillDb = createDbPool(repoBackfillPoolSize, "repo-backfill");
const repoBackfillStorage = createStorage(repoBackfillDb);

// Create dedicated event processor for repo backfill
const repoEventProcessor = new EventProcessor(repoBackfillStorage);

// Create DID resolver for finding PDS endpoints
const didResolver = new IdResolver();

/**
 * Generate a synthetic CID for backfilled records
 * Creates a deterministic CID based on the record content using proper base32 encoding
 */
function generateSyntheticCid(record: any, did: string, path: string): string {
  // Create a deterministic hash from the record content
  const recordString = JSON.stringify({ record, did, path });
  const hashBuffer = createHash('sha256').update(recordString).digest();
  
  // Convert to proper base32 encoding (RFC4648) for CID
  // Base32 alphabet: ABCDEFGHIJKLMNOPQRSTUVWXYZ234567
  const base32Encode = (buffer: Buffer): string => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    let result = '';
    let bits = 0;
    let value = 0;
    
    for (let i = 0; i < buffer.length; i++) {
      value = (value << 8) | buffer[i];
      bits += 8;
      
      while (bits >= 5) {
        result += alphabet[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    
    if (bits > 0) {
      result += alphabet[(value << (5 - bits)) & 31];
    }
    
    return result;
  };
  
  const base32Hash = base32Encode(hashBuffer);
  return `bafyrei${base32Hash}`;
}

export interface RepoBackfillProgress {
  lastProcessedDid: string | null;
  totalReposProcessed: number;
  totalRecordsProcessed: number;
  totalRecordsSkipped: number;
  startTime: Date;
  lastUpdateTime: Date;
  isRunning: boolean;
}

export class RepoBackfillService {
  private agent: AtpAgent;
  private isRunning = false;
  private progress: RepoBackfillProgress = {
    lastProcessedDid: null,
    totalReposProcessed: 0,
    totalRecordsProcessed: 0,
    totalRecordsSkipped: 0,
    startTime: new Date(),
    lastUpdateTime: new Date(),
    isRunning: false,
  };
  
  private readonly CONCURRENT_FETCHES = 50; // Parallel repo fetches (increased for powerful production machines)
  private readonly backfillDays: number;
  private cutoffDate: Date | null = null;
  private readonly pdsHost: string;

  constructor(
    pdsHost: string = "https://bsky.network"
  ) {
    this.pdsHost = pdsHost;
    this.agent = new AtpAgent({ service: pdsHost });
    
    // Use same backfill days config as firehose backfill
    const backfillDaysRaw = parseInt(process.env.BACKFILL_DAYS || "0");
    this.backfillDays = !isNaN(backfillDaysRaw) && backfillDaysRaw >= -1 ? backfillDaysRaw : 0;
  }

  async backfillSingleRepo(did: string, days?: number): Promise<void> {
    // If 'days' is provided, use it. Otherwise, fall back to the instance-level setting.
    const backfillDuration = days !== undefined ? days : this.backfillDays;

    // Set cutoff date if needed
    if (backfillDuration > 0) {
      this.cutoffDate = new Date();
      this.cutoffDate.setDate(this.cutoffDate.getDate() - backfillDuration);
      console.log(`[REPO_BACKFILL] Cutoff date for ${did}: ${this.cutoffDate.toISOString()} (${backfillDuration} days)`);
    } else {
      this.cutoffDate = null;
      console.log(`[REPO_BACKFILL] No cutoff date for ${did} (fetching all records)`);
    }

    console.log(`[REPO_BACKFILL] Fetching complete repository for ${did}...`);
    
    try {
      await this.fetchAndProcessRepo(did);
      console.log(`[REPO_BACKFILL] ✓ Successfully processed ${did}`);
    } catch (error: any) {
      console.error(`[REPO_BACKFILL] Error processing ${did}:`, error.message);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error("Repo backfill is already running");
    }

    if (this.backfillDays === 0) {
      console.log("[REPO_BACKFILL] Backfill is disabled (BACKFILL_DAYS=0)");
      return;
    }

    // Configure backfill mode
    let backfillMode: string;
    if (this.backfillDays === -1) {
      backfillMode = "TOTAL (entire network history)";
      this.cutoffDate = null;
    } else {
      backfillMode = `${this.backfillDays} days`;
      this.cutoffDate = new Date();
      this.cutoffDate.setDate(this.cutoffDate.getDate() - this.backfillDays);
    }

    console.log(`[REPO_BACKFILL] Starting ${backfillMode} repository-based historical backfill...`);
    if (this.cutoffDate) {
      console.log(`[REPO_BACKFILL] Cutoff date: ${this.cutoffDate.toISOString()}`);
    }

    this.isRunning = true;
    this.progress = {
      lastProcessedDid: null,
      totalReposProcessed: 0,
      totalRecordsProcessed: 0,
      totalRecordsSkipped: 0,
      startTime: new Date(),
      lastUpdateTime: new Date(),
      isRunning: true,
    };

    try {
      await this.runRepoBackfill();
      console.log("[REPO_BACKFILL] Backfill completed successfully");
    } catch (error) {
      console.error("[REPO_BACKFILL] Error during backfill:", error);
      logCollector.error("Repo backfill error", { error });
      this.isRunning = false;
      this.progress.isRunning = false;
      throw error;
    }
  }

  private async runRepoBackfill(): Promise<void> {
    try {
      // Fetch ALL repos from the network at once (no batching)
      console.log('[REPO_BACKFILL] Fetching all repos from the network...');
      const response = await this.agent.com.atproto.sync.listRepos({
        limit: 10000, // Large limit to get all repos at once
      });

      const repos = response.data.repos;
      console.log(`[REPO_BACKFILL] Fetched ${repos.length} repos, processing all at once...`);

      // Process all repos in parallel batches
      const batches: string[][] = [];
      for (let i = 0; i < repos.length; i += this.CONCURRENT_FETCHES) {
        batches.push(repos.slice(i, i + this.CONCURRENT_FETCHES).map(r => r.did));
      }

      console.log(`[REPO_BACKFILL] Processing ${batches.length} batches with ${this.CONCURRENT_FETCHES} concurrent fetches per batch...`);

      for (const batch of batches) {
        await Promise.allSettled(
          batch.map(did => this.fetchAndProcessRepo(did))
        );

        // Log progress after each batch
        const elapsed = Date.now() - this.progress.startTime.getTime();
        const rate = this.progress.totalRecordsProcessed / (elapsed / 1000);
        console.log(
          `[REPO_BACKFILL] Progress: ${this.progress.totalReposProcessed} repos, ` +
          `${this.progress.totalRecordsProcessed} records processed, ` +
          `${this.progress.totalRecordsSkipped} skipped (${rate.toFixed(0)} rec/s)`
        );
      }

    } catch (error: any) {
      console.error("[REPO_BACKFILL] Error listing repos:", error);
      logCollector.error("Repo backfill list error", { error });
    }

    this.isRunning = false;
    this.progress.isRunning = false;
  }

  private async fetchAndProcessRepo(did: string): Promise<void> {
    try {
      // Resolve DID to find the PDS endpoint
      console.log(`[REPO_BACKFILL] Resolving DID ${did}...`);
      const didDoc = await didResolver.did.resolve(did);
      
      if (!didDoc || !didDoc.service) {
        console.warn(`[REPO_BACKFILL] Could not resolve DID document for ${did}`);
        return;
      }
      
      // Find the PDS service endpoint
      const pdsService = didDoc.service.find((s: any) => 
        s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
      );
      
      if (!pdsService || !pdsService.serviceEndpoint) {
        console.warn(`[REPO_BACKFILL] No PDS endpoint found for ${did}`);
        return;
      }
      
      const pdsUrl = pdsService.serviceEndpoint;
      if (typeof pdsUrl !== 'string') {
        console.warn(`[REPO_BACKFILL] Invalid PDS endpoint found for ${did}:`, pdsUrl);
        return;
      }
      console.log(`[REPO_BACKFILL] Resolved ${did} to PDS: ${pdsUrl}`);
      
      // Create agent for the user's PDS
      const pdsAgent = new AtpAgent({ service: pdsUrl });
      
      // Fetch complete repository as CAR file from the PDS
      const response = await pdsAgent.com.atproto.sync.getRepo({ did });
      
      const isUint8Array = (data: unknown): data is Uint8Array => {
        return data instanceof Uint8Array;
      }

      let dataLength = 'unknown';
      if (isUint8Array(response.data)) {
        dataLength = response.data.length.toString();
      }

      console.log(`[REPO_BACKFILL] Response for ${did}:`, {
        success: response.success,
        hasData: !!response.data,
        dataType: response.data ? typeof response.data : 'none',
        dataConstructor: response.data?.constructor?.name,
        dataLength: dataLength
      });
      
      if (!response.success || !isUint8Array(response.data)) {
        console.warn(`[REPO_BACKFILL] Failed to fetch repo or received invalid data for ${did}`);
        return;
      }

      // Parse CAR file
      const carBytes = response.data;
      const { roots, blocks } = await readCar(carBytes);

      console.log(`[REPO_BACKFILL] Parsing repo ${did} (${blocks.size} blocks, ${roots.length} roots)...`);

      if (roots.length === 0) {
        console.warn(`[REPO_BACKFILL] No root CID found in repo for ${did}`);
        return;
      }

      // Create a blockstore and load the repo
      const blockstore = new MemoryBlockstore(blocks);
      const repo = await ReadableRepo.load(blockstore, roots[0]);
      
      // PHASE 1: Extract all unique DIDs that will be referenced
      console.log(`[REPO_BACKFILL] Phase 1: Extracting all referenced users...`);
      const referencedDids = new Set<string>();
      referencedDids.add(did); // Add the repo owner
      
      // First pass: collect all DIDs without processing records
      for await (const { collection, record } of repo.walkRecords()) {
        try {
          // Check cutoff date if configured
          if (this.cutoffDate && (record as any).createdAt) {
            const recordDate = new Date((record as any).createdAt);
            if (recordDate < this.cutoffDate) {
              continue;
            }
          }

          // Extract DIDs based on record type
          if (collection === 'app.bsky.feed.like' || collection === 'app.bsky.feed.repost' || 
              collection === 'app.bsky.feed.post' || collection === 'app.bsky.bookmark') {
            // Extract subject URI DIDs
            if (record.subject?.uri) {
              const subjectDid = this.extractDidFromUri(record.subject.uri);
              if (subjectDid) referencedDids.add(subjectDid);
            }
            // Extract parent/root DIDs from replies
            if (record.reply?.parent?.uri) {
              const parentDid = this.extractDidFromUri(record.reply.parent.uri);
              if (parentDid) referencedDids.add(parentDid);
            }
            if (record.reply?.root?.uri) {
              const rootDid = this.extractDidFromUri(record.reply.root.uri);
              if (rootDid) referencedDids.add(rootDid);
            }
          } else if (collection === 'app.bsky.graph.follow' || collection === 'app.bsky.graph.block') {
            // Extract subject DID
            if (record.subject) {
              referencedDids.add(record.subject);
            }
          } else if (collection === 'app.bsky.graph.listitem') {
            // Extract subject DID
            if (record.subject) {
              referencedDids.add(record.subject);
            }
          }
        } catch (error: any) {
          // Ignore errors during DID extraction
        }
      }

      console.log(`[REPO_BACKFILL] Found ${referencedDids.size} unique users to pre-create`);

      // PHASE 2: Batch create all users upfront
      console.log(`[REPO_BACKFILL] Phase 2: Pre-creating users in batches...`);
      await this.batchCreateUsers(Array.from(referencedDids));

      // PHASE 3: Process all records (users already exist)
      console.log(`[REPO_BACKFILL] Phase 3: Processing records...`);
      
      // Disable PDS fetching during bulk import to prevent connection overload
      repoEventProcessor.setSkipPdsFetching(true);
      
      let recordsProcessed = 0;
      let recordsSkipped = 0;
      const collectionsFound = new Set<string>();
      const collectionCounts = new Map<string, number>();

      try {
        // Second pass: process records
        for await (const { collection, rkey, cid, record } of repo.walkRecords()) {
          try {
            collectionsFound.add(collection);
            collectionCounts.set(collection, (collectionCounts.get(collection) || 0) + 1);

            // Check cutoff date if configured
            if (this.cutoffDate && (record as any).createdAt) {
              const recordDate = new Date((record as any).createdAt);
              if (recordDate < this.cutoffDate) {
                recordsSkipped++;
                continue;
              }
            }

            // Process the record with its actual CID from the MST
            const path = `${collection}/${rkey}`;
            await this.processRecord(did, path, record, cid);
            recordsProcessed++;

            // Log progress every 100 records
            if (recordsProcessed % 100 === 0) {
              console.log(`[REPO_BACKFILL] Progress: ${recordsProcessed} records processed...`);
            }

          } catch (error: any) {
            // Skip unparseable records but provide better visibility
            if (error?.code === '23505') {
              // Silently ignore duplicates (common during reconnections)
              recordsSkipped++;
            } else {
              // Log other errors for debugging
              console.error(`[REPO_BACKFILL] Error processing ${collection}/${rkey}:`, error.message);
              recordsSkipped++;
            }
          }
        }

        console.log(`[REPO_BACKFILL] Extracted ${collectionsFound.size} collections from repo`);
        for (const [collection, count] of Array.from(collectionCounts.entries())) {
          console.log(`[REPO_BACKFILL]   - ${collection}: ${count} records`);
        }
      } finally {
        // Always re-enable PDS fetching, even if there was an error
        repoEventProcessor.setSkipPdsFetching(false);
      }

      // Update progress
      this.progress.totalReposProcessed++;
      this.progress.totalRecordsProcessed += recordsProcessed;
      this.progress.totalRecordsSkipped += recordsSkipped;
      this.progress.lastProcessedDid = did;
      this.progress.lastUpdateTime = new Date();

      console.log(`[REPO_BACKFILL] ✓ Processed ${did}: ${recordsProcessed} records, ${recordsSkipped} skipped`);

    } catch (error: any) {
      console.error(`[REPO_BACKFILL] Error fetching ${did}:`, {
        message: error.message,
        status: error.status,
        statusText: error.statusText,
        errorType: error.constructor.name,
        stack: error.stack?.split('\n').slice(0, 3).join('\n')
      });
      
      if (error?.status === 404 || error?.status === 400) {
        console.debug(`[REPO_BACKFILL] Repo not found or invalid: ${did}`);
      }
    }
  }

  /**
   * Extract DID from an AT-URI (at://did:plc:xxx/...)
   */
  private extractDidFromUri(uri: string): string | null {
    if (!uri || !uri.startsWith('at://')) return null;
    const parts = uri.slice(5).split('/'); // Remove 'at://' and split
    return parts[0] || null;
  }

  /**
   * Batch create users to avoid overwhelming the system
   */
  private async batchCreateUsers(dids: string[]): Promise<void> {
    const BATCH_SIZE = 50; // Process 50 users at a time
    let created = 0;
    let existing = 0;

    for (let i = 0; i < dids.length; i += BATCH_SIZE) {
      const batch = dids.slice(i, i + BATCH_SIZE);
      
      // Process batch in parallel
      const results = await Promise.allSettled(
        batch.map(async (userDid) => {
          try {
            // Check if user already exists
            const user = await repoBackfillStorage.getUser(userDid);
            if (user) {
              existing++;
              return;
            }

            // Create minimal user record with standard fallback handle
            // Use 'handle.invalid' as fallback (matches Bluesky's approach)
            await repoBackfillStorage.createUser({
              did: userDid,
              handle: 'handle.invalid', // Standard fallback, will be updated by PDS fetcher
            });
            created++;
          } catch (error: any) {
            // Ignore duplicate key errors (user was created by another process)
            if (error?.code !== '23505') {
              console.error(`[REPO_BACKFILL] Error creating user ${userDid}:`, error.message);
            }
          }
        })
      );

      // Log progress every few batches
      if ((i / BATCH_SIZE) % 10 === 0) {
        console.log(`[REPO_BACKFILL] Pre-created users: ${created} created, ${existing} existing (${i + batch.length}/${dids.length})`);
      }
    }

    console.log(`[REPO_BACKFILL] User pre-creation complete: ${created} created, ${existing} already existed`);
  }

  private async processRecord(did: string, path: string, record: any, cid: any): Promise<void> {
    if (!path) return;

    // Sanitize record before processing
    const sanitized = sanitizeObject(record);

    // Determine collection type from path
    const pathParts = path.split('/');
    const collection = pathParts[0];
    const rkey = pathParts[1];

    if (!collection || !rkey) return;

    // Use real CID from MST, or generate synthetic CID as fallback
    const finalCid = cid?.toString() || generateSyntheticCid(sanitized, did, path);

    // Create commit event structure with CID
    const commitEvent = {
      repo: did,
      ops: [{
        action: 'create' as const,
        path: `${collection}/${rkey}`,
        cid: finalCid,
        record: sanitized,
      }],
    };

    // Process through event processor
    await repoEventProcessor.processCommit(commitEvent);
  }

  async stop(): Promise<void> {
    console.log("[REPO_BACKFILL] Stopping repo backfill...");
    this.isRunning = false;
    this.progress.isRunning = false;
    console.log("[REPO_BACKFILL] Repo backfill stopped");
  }

  getProgress(): RepoBackfillProgress {
    return { ...this.progress };
  }
}

export const repoBackfillService = new RepoBackfillService();
