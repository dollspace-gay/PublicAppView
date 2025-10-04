import { AtpAgent } from "@atproto/api";
import { IdResolver } from "@atproto/identity";
import { readCar, MemoryBlockstore } from "@atproto/repo";
import { ReadableRepo } from "@atproto/repo/dist/readable-repo";
import { EventProcessor } from "./event-processor";
import { createStorage, type IStorage } from "../storage";
import { createDbPool } from "../db";
import { logCollector } from "./log-collector";
import { sanitizeObject } from "../utils/sanitize";

// Create dedicated connection pool for repo backfill
const repoBackfillPoolSize = parseInt(process.env.BACKFILL_DB_POOL_SIZE || '2');
const repoBackfillDb = createDbPool(repoBackfillPoolSize, "repo-backfill");
const repoBackfillStorage = createStorage(repoBackfillDb);

// Create dedicated event processor for repo backfill
const repoEventProcessor = new EventProcessor(repoBackfillStorage);

// Create DID resolver for finding PDS endpoints
const didResolver = new IdResolver();

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
  
  private readonly BATCH_SIZE = 100; // Process this many repos before saving progress
  private readonly CONCURRENT_FETCHES = 5; // Parallel repo fetches
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

  async backfillSingleRepo(did: string, skipDateCheck: boolean = false): Promise<void> {
    // Set cutoff date if needed (unless skipped for testing)
    if (!skipDateCheck && this.backfillDays > 0) {
      this.cutoffDate = new Date();
      this.cutoffDate.setDate(this.cutoffDate.getDate() - this.backfillDays);
      console.log(`[REPO_BACKFILL] Cutoff date: ${this.cutoffDate.toISOString()}`);
    } else {
      this.cutoffDate = null;
      console.log(`[REPO_BACKFILL] No cutoff date (fetching all records)`);
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
    let cursor: string | undefined = undefined;
    let hasMore = true;

    while (hasMore && this.isRunning) {
      try {
        // List repos from the network
        const response = await this.agent.com.atproto.sync.listRepos({
          limit: this.BATCH_SIZE,
          cursor,
        });

        const repos = response.data.repos;
        console.log(`[REPO_BACKFILL] Fetched ${repos.length} repos (cursor: ${cursor || 'start'})`);

        // Process repos in parallel batches
        const batches: string[][] = [];
        for (let i = 0; i < repos.length; i += this.CONCURRENT_FETCHES) {
          batches.push(repos.slice(i, i + this.CONCURRENT_FETCHES).map(r => r.did));
        }

        for (const batch of batches) {
          await Promise.allSettled(
            batch.map(did => this.fetchAndProcessRepo(did))
          );
        }

        // Update cursor
        cursor = response.data.cursor;
        hasMore = !!cursor && repos.length > 0;

        // Log progress
        const elapsed = Date.now() - this.progress.startTime.getTime();
        const rate = this.progress.totalRecordsProcessed / (elapsed / 1000);
        console.log(
          `[REPO_BACKFILL] Progress: ${this.progress.totalReposProcessed} repos, ` +
          `${this.progress.totalRecordsProcessed} records processed, ` +
          `${this.progress.totalRecordsSkipped} skipped (${rate.toFixed(0)} rec/s)`
        );

      } catch (error: any) {
        console.error("[REPO_BACKFILL] Error listing repos:", error);
        logCollector.error("Repo backfill list error", { error });
        break;
      }
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
      console.log(`[REPO_BACKFILL] Resolved ${did} to PDS: ${pdsUrl}`);
      
      // Create agent for the user's PDS
      const pdsAgent = new AtpAgent({ service: pdsUrl });
      
      // Fetch complete repository as CAR file from the PDS
      const response = await pdsAgent.com.atproto.sync.getRepo({ did });
      
      console.log(`[REPO_BACKFILL] Response for ${did}:`, {
        success: response.success,
        hasData: !!response.data,
        dataType: response.data ? typeof response.data : 'none',
        dataConstructor: response.data?.constructor?.name,
        dataLength: response.data instanceof Uint8Array ? response.data.length : 
                    response.data instanceof ArrayBuffer ? response.data.byteLength : 
                    Buffer.isBuffer(response.data) ? response.data.length : 'unknown'
      });
      
      if (!response.success || !response.data) {
        console.warn(`[REPO_BACKFILL] Failed to fetch repo for ${did}`);
        return;
      }

      // Parse CAR file
      const carBytes = new Uint8Array(response.data as ArrayBuffer);
      const { roots, blocks } = await readCar(carBytes);

      console.log(`[REPO_BACKFILL] Parsing repo ${did} (${blocks.size} blocks, ${roots.length} roots)...`);

      if (roots.length === 0) {
        console.warn(`[REPO_BACKFILL] No root CID found in repo for ${did}`);
        return;
      }

      // Create a blockstore from the blocks
      const blockstore = new MemoryBlockstore(blocks);
      
      // Load the repo using the root CID
      const repo = await ReadableRepo.load(blockstore, roots[0]);
      
      // Get all contents organized by collection
      const contents = await repo.getContents();

      console.log(`[REPO_BACKFILL] Extracted ${Object.keys(contents).length} collections from repo`);

      // Extract and process records from contents
      let recordsProcessed = 0;
      let recordsSkipped = 0;

      for (const [collection, records] of Object.entries(contents)) {
        const collectionRecordCount = Object.keys(records).length;
        console.log(`[REPO_BACKFILL] Processing collection ${collection} (${collectionRecordCount} records)...`);
        
        for (const [rkey, record] of Object.entries(records)) {
          try {
            // Check cutoff date if configured
            if (this.cutoffDate && (record as any).createdAt) {
              const recordDate = new Date((record as any).createdAt);
              if (recordDate < this.cutoffDate) {
                recordsSkipped++;
                continue;
              }
            }

            // Process the record
            const path = `${collection}/${rkey}`;
            await this.processRecord(did, path, record);
            recordsProcessed++;

            // Log progress every 100 records
            if (recordsProcessed % 100 === 0) {
              console.log(`[REPO_BACKFILL] Progress: ${recordsProcessed} records processed...`);
            }

          } catch (error: any) {
            // Skip unparseable records
            if (error?.code !== '23505') { // Ignore duplicates
              console.error(`[REPO_BACKFILL] Error processing ${collection}/${rkey}:`, error.message);
            }
          }
        }
        
        console.log(`[REPO_BACKFILL] ✓ Completed collection ${collection}`);
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

  private async processRecord(did: string, path: string, record: any): Promise<void> {
    if (!path) return;

    // Sanitize record before processing
    const sanitized = sanitizeObject(record);

    // Determine collection type from path
    const pathParts = path.split('/');
    const collection = pathParts[0];
    const rkey = pathParts[1];

    if (!collection || !rkey) return;

    // Create commit event structure
    const commitEvent = {
      repo: did,
      ops: [{
        action: 'create' as const,
        path: `${collection}/${rkey}`,
        cid: null,
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
