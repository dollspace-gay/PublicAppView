import { Firehose, MemoryRunner } from "@atproto/sync";
import { IdResolver } from "@atproto/identity";
import { eventProcessor } from "./event-processor";
import { storage } from "../storage";
import { logCollector } from "./log-collector";

export interface BackfillProgress {
  startCursor: number | null;
  currentCursor: number | null;
  eventsProcessed: number;
  startTime: Date;
  lastUpdateTime: Date;
  estimatedCompletion: Date | null;
  isRunning: boolean;
}

export class BackfillService {
  private client: Firehose | null = null;
  private isRunning = false;
  private progress: BackfillProgress = {
    startCursor: null,
    currentCursor: null,
    eventsProcessed: 0,
    startTime: new Date(),
    lastUpdateTime: new Date(),
    estimatedCompletion: null,
    isRunning: false,
  };
  
  private readonly PROGRESS_SAVE_INTERVAL = 1000; // Save progress every 1000 events
  private readonly MAX_EVENTS_PER_RUN = 1000000; // Increased safety limit for total backfill
  private readonly backfillDays: number;
  private cutoffDate: Date | null = null;
  private idResolver: IdResolver;
  
  constructor(
    private relayUrl: string = process.env.RELAY_URL || "wss://bsky.network"
  ) {
    // 0 = backfill disabled, -1 = total backfill (all available history), >0 = backfill X days
    const backfillDaysRaw = parseInt(process.env.BACKFILL_DAYS || "0");
    this.backfillDays = !isNaN(backfillDaysRaw) && backfillDaysRaw >= -1 ? backfillDaysRaw : 0;
    
    if (process.env.BACKFILL_DAYS && isNaN(backfillDaysRaw)) {
      console.warn(`[BACKFILL] Invalid BACKFILL_DAYS value "${process.env.BACKFILL_DAYS}" - using default (0)`);
    }
    
    this.idResolver = new IdResolver();
  }

  async start(startCursor?: number): Promise<void> {
    if (this.isRunning) {
      throw new Error("Backfill is already running");
    }

    if (this.backfillDays === 0) {
      console.log("[BACKFILL] Backfill is disabled (BACKFILL_DAYS=0)");
      return;
    }

    // Configure backfill mode
    let backfillMode: string;
    if (this.backfillDays === -1) {
      backfillMode = "TOTAL (entire available history)";
      this.cutoffDate = null; // No cutoff for total backfill
    } else {
      backfillMode = `${this.backfillDays} days`;
      this.cutoffDate = new Date();
      this.cutoffDate.setDate(this.cutoffDate.getDate() - this.backfillDays);
    }

    console.log(`[BACKFILL] Starting ${backfillMode} historical backfill...`);
    if (this.cutoffDate) {
      console.log(`[BACKFILL] Cutoff date: ${this.cutoffDate.toISOString()}`);
    }
    
    logCollector.info("Starting historical backfill", { 
      startCursor, 
      backfillDays: this.backfillDays,
      cutoffDate: this.cutoffDate?.toISOString() || "none (total backfill)",
      mode: backfillMode
    });

    this.isRunning = true;
    this.progress = {
      startCursor: startCursor ?? null,
      currentCursor: startCursor ?? null,
      eventsProcessed: 0,
      startTime: new Date(),
      lastUpdateTime: new Date(),
      estimatedCompletion: null,
      isRunning: true,
    };

    try {
      // Load progress from database if resuming
      const savedProgress = await storage.getBackfillProgress();
      if (savedProgress && !startCursor) {
        const savedCursor = savedProgress.currentCursor ? parseInt(savedProgress.currentCursor) : null;
        if (savedCursor) {
          this.progress.currentCursor = savedCursor;
          this.progress.eventsProcessed = savedProgress.eventsProcessed;
          console.log(`[BACKFILL] Resuming from cursor: ${savedCursor}`);
        }
      }

      console.log("[BACKFILL] Initializing @atproto/sync Firehose client...");
      await this.runBackfill();
      console.log("[BACKFILL] Backfill completed successfully");
    } catch (error) {
      console.error("[BACKFILL] Error during backfill:", error);
      logCollector.error("Backfill error", { error });
      this.isRunning = false;
      this.progress.isRunning = false;
      throw error;
    }
  }

  private async runBackfill(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Configure start cursor
      // startCursor: 0 = fetch entire rollback window (total backfill)
      // startCursor: number = resume from that sequence
      // startCursor: undefined = start from current position
      let startCursor: number | undefined;
      
      if (this.backfillDays === -1) {
        // Total backfill: start from oldest available (seq 0)
        startCursor = 0;
        console.log("[BACKFILL] Using startCursor=0 for total backfill (entire rollback window)");
      } else if (this.progress.currentCursor !== null) {
        // Resume from saved position
        startCursor = this.progress.currentCursor;
        console.log(`[BACKFILL] Resuming from saved cursor: ${startCursor}`);
      } else {
        // Start from oldest available within server's rollback window
        startCursor = 0;
        console.log("[BACKFILL] Using startCursor=0 to fetch available history");
      }

      // MemoryRunner handles cursor persistence and provides it to Firehose
      const runner = new MemoryRunner({
        startCursor,
        setCursor: async (cursor: number) => {
          this.progress.currentCursor = cursor;
          // Save to database periodically
          if (this.progress.eventsProcessed % this.PROGRESS_SAVE_INTERVAL === 0) {
            await this.saveProgress();
          }
        },
      });

      console.log("[BACKFILL] Creating Firehose with @atproto/sync...");

      this.client = new Firehose({
        idResolver: this.idResolver,
        runner,
        service: this.relayUrl,
        unauthenticatedCommits: true, // Disable signature verification for faster backfill
        unauthenticatedHandles: true, // Disable handle verification for faster backfill
        handleEvent: async (evt) => {
          try {
            // Track sequence number
            if ('seq' in evt && typeof evt.seq === 'number') {
              this.progress.currentCursor = evt.seq;
            }

            // Handle different event types
            if (evt.event === 'create' || evt.event === 'update') {
              // Check cutoff date if configured
              if (this.cutoffDate && evt.record && typeof evt.record === 'object') {
                const record = evt.record as any;
                if (record.createdAt) {
                  const recordDate = new Date(record.createdAt);
                  if (recordDate < this.cutoffDate) {
                    console.log(`[BACKFILL] Reached cutoff date (${this.cutoffDate.toISOString()}). Stopping backfill.`);
                    await this.stop();
                    resolve();
                    return;
                  }
                }
              }

              // Process create/update as commit event
              const commitEvent = {
                repo: evt.did,
                ops: [{
                  action: evt.event === 'create' ? 'create' : 'update',
                  path: `${evt.collection}/${evt.rkey}`,
                  cid: evt.cid?.toString() || "",
                  record: evt.record,
                }],
              };
              
              await eventProcessor.processCommit(commitEvent);
            } else if (evt.event === 'delete') {
              // Process delete event
              const commitEvent = {
                repo: evt.did,
                ops: [{
                  action: 'delete',
                  path: `${evt.collection}/${evt.rkey}`,
                }],
              };
              
              await eventProcessor.processCommit(commitEvent);
            } else if (evt.event === 'identity') {
              // Process identity update
              await eventProcessor.processIdentity({
                did: evt.did,
                handle: evt.handle || evt.did,
              });
            } else if (evt.event === 'account') {
              // Process account status change
              await eventProcessor.processAccount({
                did: evt.did,
                active: evt.active,
              });
            }

            this.progress.eventsProcessed++;
            this.progress.lastUpdateTime = new Date();

            // Log progress periodically
            if (this.progress.eventsProcessed % this.PROGRESS_SAVE_INTERVAL === 0) {
              console.log(`[BACKFILL] Progress: ${this.progress.eventsProcessed} events processed`);
            }

            // Check if we've hit the safety limit
            if (this.progress.eventsProcessed >= this.MAX_EVENTS_PER_RUN) {
              console.log(`[BACKFILL] Reached safety limit of ${this.MAX_EVENTS_PER_RUN} events`);
              await this.stop();
              resolve();
            }
          } catch (error: any) {
            if (error?.code === '23505') {
              // Duplicate key - skip silently
            } else {
              console.error("[BACKFILL] Error processing event:", error);
              logCollector.error("Backfill event processing error", { error, event: evt });
            }
          }
        },
        onError: (err) => {
          console.error("[BACKFILL] Firehose error:", err);
          logCollector.error("Backfill firehose error", { error: err });
          reject(err);
        },
      });

      console.log("[BACKFILL] Starting Firehose client...");
      this.client.start();
      console.log("[BACKFILL] ✓ Connected to relay for backfill");
      logCollector.success("Backfill connected to relay", { relayUrl: this.relayUrl });

      // Handle cleanup on process exit
      const cleanup = async () => {
        await this.stop();
        resolve();
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    });
  }

  async stop(): Promise<void> {
    console.log("[BACKFILL] Stopping backfill...");
    
    if (this.client) {
      try {
        await this.client.destroy();
      } catch (error) {
        console.error("[BACKFILL] Error destroying client:", error);
      }
      this.client = null;
    }

    await this.saveProgress();
    this.isRunning = false;
    this.progress.isRunning = false;
    
    console.log("[BACKFILL] Backfill stopped");
    logCollector.info("Backfill stopped", { 
      progress: this.progress,
      eventsProcessed: this.progress.eventsProcessed
    });
  }

  private async saveProgress(): Promise<void> {
    try {
      await storage.saveBackfillProgress({
        currentCursor: this.progress.currentCursor?.toString() || null,
        eventsProcessed: this.progress.eventsProcessed,
        lastUpdateTime: this.progress.lastUpdateTime,
      });
    } catch (error) {
      console.error("[BACKFILL] Error saving progress:", error);
    }
  }

  getProgress(): BackfillProgress {
    return { ...this.progress };
  }
}

export const backfillService = new BackfillService();
