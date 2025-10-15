import { Firehose, MemoryRunner } from '@atproto/sync';
import { IdResolver } from '@atproto/identity';
import { EventProcessor } from './event-processor';
import { storage } from '../storage';
import { logCollector } from './log-collector';

// Use the main application storage instead of creating a separate connection
// This ensures backfilled records are stored in the same database as the web view

// Create dedicated event processor for backfill using main storage
const backfillEventProcessor = new EventProcessor(storage);

export interface BackfillProgress {
  startCursor: number | null;
  currentCursor: number | null;
  eventsProcessed: number;
  eventsSkipped: number;
  eventsReceived: number;
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
    eventsSkipped: 0,
    eventsReceived: 0,
    startTime: new Date(),
    lastUpdateTime: new Date(),
    estimatedCompletion: null,
    isRunning: false,
  };

  private readonly PROGRESS_SAVE_INTERVAL = 1000; // Save progress every 1000 events
  private readonly MAX_EVENTS_PER_RUN = 1000000; // Increased safety limit for total backfill

  // Configurable resource throttling for background processing
  // These defaults make backfill a true background task that won't overwhelm the system
  private readonly BATCH_SIZE: number; // Process this many events before delay
  private readonly BATCH_DELAY_MS: number; // Wait this long between batches (milliseconds)
  private readonly MAX_CONCURRENT_PROCESSING: number; // Max concurrent event processing
  private readonly MEMORY_CHECK_INTERVAL = 100; // Check memory every N events
  private readonly MAX_MEMORY_MB: number; // Pause processing if memory exceeds this
  private readonly USE_IDLE_PROCESSING: boolean; // Use setImmediate for idle-time processing

  // Memory and concurrency tracking
  private activeProcessing = 0;
  private processingQueue: Array<() => Promise<void>> = [];
  private lastMemoryCheck = 0;
  private memoryPaused = false;
  private readonly backfillDays: number;
  private cutoffDate: Date | null = null;
  private idResolver: IdResolver;
  private batchCounter = 0;

  constructor(
    private relayUrl: string = process.env.RELAY_URL ||
      'wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos'
  ) {
    // 0 = backfill disabled, -1 = total backfill (all available history), >0 = backfill X days
    const backfillDaysRaw = parseInt(process.env.BACKFILL_DAYS || '0');
    this.backfillDays =
      !isNaN(backfillDaysRaw) && backfillDaysRaw >= -1 ? backfillDaysRaw : 0;

    if (process.env.BACKFILL_DAYS && isNaN(backfillDaysRaw)) {
      console.warn(
        `[BACKFILL] Invalid BACKFILL_DAYS value "${process.env.BACKFILL_DAYS}" - using default (0)`
      );
    }

    // Configure resource throttling for background processing
    // Defaults are VERY conservative to ensure backfill is truly a background task
    this.BATCH_SIZE = parseInt(process.env.BACKFILL_BATCH_SIZE || '5'); // Small batches (default: 5)
    this.BATCH_DELAY_MS = parseInt(
      process.env.BACKFILL_BATCH_DELAY_MS || '2000'
    ); // Long delays (default: 2s)
    this.MAX_CONCURRENT_PROCESSING = parseInt(
      process.env.BACKFILL_MAX_CONCURRENT || '2'
    ); // Low concurrency (default: 2)
    this.MAX_MEMORY_MB = parseInt(process.env.BACKFILL_MAX_MEMORY_MB || '512'); // Memory limit (default: 512MB)
    this.USE_IDLE_PROCESSING = process.env.BACKFILL_USE_IDLE !== 'false'; // Use idle processing (default: true)

    console.log(`[BACKFILL] Resource throttling config:`);
    console.log(`  - Batch size: ${this.BATCH_SIZE} events`);
    console.log(`  - Batch delay: ${this.BATCH_DELAY_MS}ms`);
    console.log(`  - Max concurrent: ${this.MAX_CONCURRENT_PROCESSING}`);
    console.log(`  - Memory limit: ${this.MAX_MEMORY_MB}MB`);
    console.log(`  - Idle processing: ${this.USE_IDLE_PROCESSING}`);

    this.idResolver = new IdResolver();
  }

  async start(startCursor?: number): Promise<void> {
    if (this.isRunning) {
      throw new Error('Backfill is already running');
    }

    if (this.backfillDays === 0) {
      console.log('[BACKFILL] Backfill is disabled (BACKFILL_DAYS=0)');
      return;
    }

    // Configure backfill mode
    let backfillMode: string;
    if (this.backfillDays === -1) {
      backfillMode = 'TOTAL (entire available history)';
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

    logCollector.info('Starting historical backfill', {
      startCursor,
      backfillDays: this.backfillDays,
      cutoffDate: this.cutoffDate?.toISOString() || 'none (total backfill)',
      mode: backfillMode,
    });

    this.isRunning = true;
    this.batchCounter = 0; // Reset batch counter for new run
    this.progress = {
      startCursor: startCursor ?? null,
      currentCursor: startCursor ?? null,
      eventsProcessed: 0,
      eventsSkipped: 0,
      eventsReceived: 0,
      startTime: new Date(),
      lastUpdateTime: new Date(),
      estimatedCompletion: null,
      isRunning: true,
    };

    try {
      // Clear any saved progress when starting a new backfill
      // This ensures we always start from cursor 0 to get full historical data
      // Progress will be saved during the run for crash recovery
      console.log(
        '[BACKFILL] Starting fresh backfill from cursor 0 to fetch full historical window'
      );
      this.progress.currentCursor = null;
      this.progress.eventsProcessed = 0;

      console.log('[BACKFILL] Initializing @atproto/sync Firehose client...');
      await this.runBackfill();
      console.log('[BACKFILL] Backfill completed successfully');
    } catch (error) {
      console.error('[BACKFILL] Error during backfill:', error);
      logCollector.error('Backfill error', { error });
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
        console.log(
          '[BACKFILL] Using startCursor=0 for total backfill (entire rollback window)'
        );
      } else if (this.progress.currentCursor !== null) {
        // Resume from saved position
        startCursor = this.progress.currentCursor;
        console.log(`[BACKFILL] Resuming from saved cursor: ${startCursor}`);
      } else {
        // Start from oldest available within server's rollback window
        startCursor = 0;
        console.log(
          '[BACKFILL] Using startCursor=0 to fetch available history'
        );
      }

      // MemoryRunner handles cursor persistence and provides it to Firehose
      const runner = new MemoryRunner({
        startCursor,
        setCursor: async (cursor: number) => {
          this.progress.currentCursor = cursor;
          // Save to database periodically
          if (
            this.progress.eventsProcessed % this.PROGRESS_SAVE_INTERVAL ===
            0
          ) {
            await this.saveProgress();
          }
        },
      });

      console.log('[BACKFILL] Creating Firehose with @atproto/sync...');

      this.client = new Firehose({
        idResolver: this.idResolver,
        runner,
        service: this.relayUrl,
        unauthenticatedCommits: true, // Disable signature verification for faster backfill
        unauthenticatedHandles: true, // Disable handle verification for faster backfill
        excludeIdentity: true, // Skip identity events - suspended accounts cause DID resolution failures
        excludeAccount: false, // Keep account events to track suspensions
        handleEvent: async (evt) => {
          try {
            // Track all received events
            this.progress.eventsReceived++;

            // Track sequence number
            if ('seq' in evt && typeof evt.seq === 'number') {
              this.progress.currentCursor = evt.seq;
            }

            // Handle different event types
            if (evt.event === 'create' || evt.event === 'update') {
              // Check cutoff date if configured (skip events before cutoff, keep recent ones)
              if (
                this.cutoffDate &&
                evt.record &&
                typeof evt.record === 'object'
              ) {
                const record = evt.record as any;
                if (record.createdAt) {
                  const recordDate = new Date(record.createdAt);
                  if (recordDate < this.cutoffDate) {
                    // Skip events older than cutoff - don't process or count them
                    this.progress.eventsSkipped++;
                    return;
                  }
                }
              }

              // Process create/update as commit event
              const commitEvent = {
                repo: evt.did,
                ops: [
                  {
                    action: evt.event === 'create' ? 'create' : 'update',
                    path: `${evt.collection}/${evt.rkey}`,
                    cid: evt.cid?.toString() || '',
                    record: evt.record,
                  },
                ],
              };

              await backfillEventProcessor.processCommit(commitEvent);
            } else if (evt.event === 'delete') {
              // Process delete event
              const commitEvent = {
                repo: evt.did,
                ops: [
                  {
                    action: 'delete',
                    path: `${evt.collection}/${evt.rkey}`,
                  },
                ],
              };

              await backfillEventProcessor.processCommit(commitEvent);
            } else if (evt.event === 'account') {
              // Process account status change
              await backfillEventProcessor.processAccount({
                did: evt.did,
                active: evt.active,
              });
            }

            this.progress.eventsProcessed++;
            this.progress.lastUpdateTime = new Date();
            this.batchCounter++;

            // Memory check and throttling
            if (
              this.progress.eventsProcessed % this.MEMORY_CHECK_INTERVAL ===
              0
            ) {
              await this.checkMemoryAndThrottle();
            }

            // Batch delay to prevent resource overload
            if (this.batchCounter >= this.BATCH_SIZE) {
              if (this.USE_IDLE_PROCESSING) {
                // Use setImmediate to yield to other tasks (non-blocking idle processing)
                await new Promise((resolve) => setImmediate(resolve));
              }
              // Always add the configured delay for background processing
              await new Promise((resolve) =>
                setTimeout(resolve, this.BATCH_DELAY_MS)
              );
              this.batchCounter = 0;
            }

            // Log progress periodically
            if (
              this.progress.eventsReceived % this.PROGRESS_SAVE_INTERVAL ===
              0
            ) {
              const elapsed = Date.now() - this.progress.startTime.getTime();
              const rate = this.progress.eventsReceived / (elapsed / 1000);
              console.log(
                `[BACKFILL] Progress: ${this.progress.eventsReceived} received, ${this.progress.eventsProcessed} processed, ${this.progress.eventsSkipped} skipped (${rate.toFixed(0)} evt/s)`
              );
            }

            // Check if we've hit the safety limit
            if (this.progress.eventsProcessed >= this.MAX_EVENTS_PER_RUN) {
              console.log(
                `[BACKFILL] Reached safety limit of ${this.MAX_EVENTS_PER_RUN} events`
              );
              await this.stop();
              resolve();
            }
          } catch (error: any) {
            if (error?.code === '23505') {
              // Duplicate key - skip silently
            } else {
              console.error('[BACKFILL] Error processing event:', error);
              logCollector.error('Backfill event processing error', {
                error,
                event: evt,
              });
            }
          }
        },
        onError: (err: any) => {
          // Check if this is a DID resolution timeout error
          const errorName = err?.name || '';
          const causeName =
            err?.cause?.name || err?.cause?.constructor?.name || '';
          const isDidResolutionTimeout =
            errorName === 'FirehoseParseError' &&
            (causeName === 'AbortError' || causeName === 'DOMException');

          if (isDidResolutionTimeout) {
            // DID resolution timeouts are expected during backfill of suspended/deleted accounts
            // These events existed historically but the DIDs no longer resolve
            console.warn(
              `[BACKFILL] Skipping event due to DID resolution timeout (seq: ${err?.event?.seq}):`,
              {
                type: err?.event?.['$type'],
                did: err?.event?.did,
                handle: err?.event?.handle,
                causeName,
              }
            );
            // Don't reject - continue processing other events
          } else {
            // Other errors should stop the backfill for investigation
            console.error('[BACKFILL] Fatal Firehose error:', err);
            logCollector.error('Backfill firehose error', {
              error: err,
              errorName,
              causeName,
            });
            reject(err);
          }
        },
      });

      console.log('[BACKFILL] Starting Firehose client...');
      this.client.start();
      console.log('[BACKFILL] ✓ Connected to relay for backfill');
      logCollector.success('Backfill connected to relay', {
        relayUrl: this.relayUrl,
      });

      // Note: We do NOT register SIGINT/SIGTERM handlers for backfill
      // because server restarts would prematurely stop the backfill.
      // The backfill will naturally stop when it reaches the cutoff date
      // or when the Firehose connection closes.
    });
  }

  async stop(): Promise<void> {
    console.log('[BACKFILL] Stopping backfill...');

    if (this.client) {
      try {
        await this.client.destroy();
      } catch (error) {
        console.error('[BACKFILL] Error destroying client:', error);
      }
      this.client = null;
    }

    await this.saveProgress();
    this.isRunning = false;
    this.progress.isRunning = false;

    console.log('[BACKFILL] Backfill stopped');
    logCollector.info('Backfill stopped', {
      progress: this.progress,
      eventsProcessed: this.progress.eventsProcessed,
    });
  }

  private async checkMemoryAndThrottle(): Promise<void> {
    try {
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      // Check if we're exceeding memory limit
      if (heapUsedMB > this.MAX_MEMORY_MB) {
        if (!this.memoryPaused) {
          console.warn(
            `[BACKFILL] Memory usage high (${heapUsedMB}MB > ${this.MAX_MEMORY_MB}MB), pausing for GC...`
          );
          this.memoryPaused = true;
        }

        // Force garbage collection if available (node --expose-gc)
        if (global.gc) {
          global.gc();
        }

        // Wait longer to allow memory to be freed
        await new Promise((resolve) => setTimeout(resolve, 5000));

        const newMemUsage = process.memoryUsage();
        const newHeapUsedMB = Math.round(newMemUsage.heapUsed / 1024 / 1024);

        if (newHeapUsedMB < this.MAX_MEMORY_MB) {
          console.log(
            `[BACKFILL] Memory recovered (${newHeapUsedMB}MB), resuming...`
          );
          this.memoryPaused = false;
        } else {
          // Still high, wait even longer
          console.warn(
            `[BACKFILL] Memory still high (${newHeapUsedMB}MB), waiting longer...`
          );
          await new Promise((resolve) => setTimeout(resolve, 10000));
          this.memoryPaused = false;
        }
      } else if (this.memoryPaused) {
        // Memory back to normal
        console.log(
          `[BACKFILL] Memory usage normal (${heapUsedMB}MB), resuming...`
        );
        this.memoryPaused = false;
      }

      // Log memory usage periodically (every 100 checks = every 10k events by default)
      if (
        this.progress.eventsProcessed % (this.MEMORY_CHECK_INTERVAL * 100) ===
        0
      ) {
        console.log(
          `[BACKFILL] Memory: ${heapUsedMB}MB / ${this.MAX_MEMORY_MB}MB limit`
        );
      }
    } catch (error) {
      console.error('[BACKFILL] Error checking memory:', error);
    }
  }

  private async queueEventProcessing(task: () => Promise<void>): Promise<void> {
    // If under concurrency limit, process immediately
    if (this.activeProcessing < this.MAX_CONCURRENT_PROCESSING) {
      return this.processQueuedEvent(task);
    }

    // Otherwise, queue and wait for slot
    return new Promise((resolve, reject) => {
      this.processingQueue.push(async () => {
        try {
          await task();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private async processQueuedEvent(task: () => Promise<void>): Promise<void> {
    this.activeProcessing++;
    try {
      await task();
    } finally {
      this.activeProcessing--;
      this.processNextInQueue();
    }
  }

  private processNextInQueue(): void {
    if (
      this.activeProcessing < this.MAX_CONCURRENT_PROCESSING &&
      this.processingQueue.length > 0
    ) {
      const nextTask = this.processingQueue.shift();
      if (nextTask) {
        this.processQueuedEvent(nextTask);
      }
    }
  }

  private async saveProgress(): Promise<void> {
    try {
      await storage.saveBackfillProgress({
        currentCursor: this.progress.currentCursor?.toString() || null,
        eventsProcessed: this.progress.eventsProcessed,
        lastUpdateTime: this.progress.lastUpdateTime,
      });
    } catch (error) {
      console.error('[BACKFILL] Error saving progress:', error);
    }
  }

  getProgress(): BackfillProgress {
    return {
      ...this.progress,
      // Add queue status for monitoring
      queueDepth: this.processingQueue.length,
      activeProcessing: this.activeProcessing,
    } as any;
  }
}

export const backfillService = new BackfillService();
