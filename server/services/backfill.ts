import { Firehose } from "@skyware/firehose";
import WebSocket from "ws";
import { eventProcessor } from "./event-processor";
import { storage } from "../storage";
import { logCollector } from "./log-collector";

export interface BackfillProgress {
  startCursor: string | null;
  currentCursor: string | null;
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
  
  private readonly BATCH_SIZE = 100; // Process in batches for memory efficiency
  private readonly PROGRESS_SAVE_INTERVAL = 1000; // Save progress every 1000 events
  private readonly MAX_EVENTS_PER_RUN = 100000; // Limit for safety
  private readonly backfillDays: number;
  private cutoffDate: Date | null = null;
  
  constructor(
    private relayUrl: string = process.env.RELAY_URL || "wss://bsky.network"
  ) {
    // 0 or not set = backfill disabled, >0 = backfill X days of historical data
    const backfillDaysRaw = parseInt(process.env.BACKFILL_DAYS || "0");
    this.backfillDays = !isNaN(backfillDaysRaw) && backfillDaysRaw >= 0 ? backfillDaysRaw : 0;
    
    if (process.env.BACKFILL_DAYS && isNaN(backfillDaysRaw)) {
      console.warn(`[BACKFILL] Invalid BACKFILL_DAYS value "${process.env.BACKFILL_DAYS}" - using default (0)`);
    }
  }

  async start(startCursor?: string): Promise<void> {
    if (this.isRunning) {
      throw new Error("Backfill is already running");
    }

    if (this.backfillDays === 0) {
      console.log("[BACKFILL] Backfill is disabled (BACKFILL_DAYS=0)");
      return;
    }

    // Calculate cutoff date - only backfill data from the last X days
    this.cutoffDate = new Date();
    this.cutoffDate.setDate(this.cutoffDate.getDate() - this.backfillDays);

    console.log(`[BACKFILL] Starting historical backfill for last ${this.backfillDays} days (since ${this.cutoffDate.toISOString()})...`);
    logCollector.info("Starting historical backfill", { 
      startCursor, 
      backfillDays: this.backfillDays,
      cutoffDate: this.cutoffDate.toISOString()
    });

    this.isRunning = true;
    this.progress = {
      startCursor: startCursor || null,
      currentCursor: startCursor || null,
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
        this.progress.currentCursor = savedProgress.currentCursor;
        this.progress.eventsProcessed = savedProgress.eventsProcessed;
        console.log(`[BACKFILL] Resuming from cursor: ${savedProgress.currentCursor}`);
      }

      console.log("[BACKFILL] About to call runBackfill()...");
      await this.runBackfill();
      console.log("[BACKFILL] runBackfill() completed");
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
      const config: any = {
        service: this.relayUrl,
        ws: WebSocket as any,
      };

      // Start from saved cursor if available
      if (this.progress.currentCursor) {
        config.cursor = this.progress.currentCursor;
      }

      this.client = new Firehose(config);
      console.log("[BACKFILL] Firehose client created, attempting to connect...");

      this.client.on("open", () => {
        console.log("[BACKFILL] Connected to relay for backfill");
      });

      this.client.on("commit", async (commit) => {
        try {
          // Save cursor position
          if ((commit as any).seq) {
            this.progress.currentCursor = String((commit as any).seq);
          }

          // Check if any record is older than cutoff date (stop backfilling if so)
          if (this.cutoffDate) {
            for (const op of commit.ops) {
              if (op.action !== 'delete' && 'record' in op && op.record) {
                const record = op.record as any;
                if (record.createdAt) {
                  const recordDate = new Date(record.createdAt);
                  if (recordDate < this.cutoffDate) {
                    console.log(`[BACKFILL] Reached cutoff date (${this.cutoffDate.toISOString()}). Stopping backfill.`);
                    logCollector.info("Backfill reached cutoff date", { 
                      recordDate: recordDate.toISOString(),
                      cutoffDate: this.cutoffDate.toISOString(),
                      eventsProcessed: this.progress.eventsProcessed
                    });
                    await this.stop();
                    resolve();
                    return;
                  }
                }
              }
            }
          }

          const event = {
            repo: commit.repo,
            ops: commit.ops.map((op) => {
              const baseOp: any = {
                action: op.action,
                path: op.path,
              };
              
              if (op.action !== 'delete' && 'cid' in op) {
                baseOp.cid = op.cid?.toString() || "";
              }
              if (op.action !== 'delete' && 'record' in op) {
                baseOp.record = op.record;
              }
              
              return baseOp;
            }),
          };

          await eventProcessor.processCommit(event);
          
          this.progress.eventsProcessed++;
          this.progress.lastUpdateTime = new Date();

          // Save progress periodically
          if (this.progress.eventsProcessed % this.PROGRESS_SAVE_INTERVAL === 0) {
            await this.saveProgress();
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
            console.log(`[BACKFILL] Skipped duplicate event`);
          } else {
            console.error("[BACKFILL] Error processing commit:", error);
          }
        }
      });

      this.client.on("identity", async (identity) => {
        try {
          if ((identity as any).seq) {
            this.progress.currentCursor = String((identity as any).seq);
          }

          await eventProcessor.processIdentity({
            did: identity.did,
            handle: identity.handle || identity.did,
          });
        } catch (error: any) {
          if (error?.code === '23505') {
            console.log(`[BACKFILL] Skipped duplicate identity`);
          } else {
            console.error("[BACKFILL] Error processing identity:", error);
          }
        }
      });

      this.client.on("account", async (account) => {
        try {
          if ((account as any).seq) {
            this.progress.currentCursor = String((account as any).seq);
          }

          await eventProcessor.processAccount({
            did: account.did,
            active: account.active,
          });
        } catch (error: any) {
          if (error?.code === '23505') {
            console.log(`[BACKFILL] Skipped duplicate account`);
          } else {
            console.error("[BACKFILL] Error processing account:", error);
          }
        }
      });

      this.client.on("error", (error) => {
        console.error("[BACKFILL] Firehose error:", error);
        logCollector.error("Backfill firehose error", { error });
        reject(error);
      });

      this.client.on("close", () => {
        console.log("[BACKFILL] Connection closed");
        this.isRunning = false;
        this.progress.isRunning = false;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    console.log("[BACKFILL] Stopping backfill...");
    
    if (this.client) {
      try {
        if (typeof (this.client as any).removeAllListeners === 'function') {
          (this.client as any).removeAllListeners();
        }
        if (typeof (this.client as any).close === 'function') {
          (this.client as any).close();
        }
      } catch (error) {
        console.error("[BACKFILL] Error closing client:", error);
      }
      this.client = null;
    }

    await this.saveProgress();
    this.isRunning = false;
    this.progress.isRunning = false;
    
    console.log("[BACKFILL] Backfill stopped");
    logCollector.info("Backfill stopped", { progress: this.progress });
  }

  private async saveProgress(): Promise<void> {
    try {
      await storage.saveBackfillProgress({
        currentCursor: this.progress.currentCursor,
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

  isBackfillRunning(): boolean {
    return this.isRunning;
  }
}

export const backfillService = new BackfillService();
