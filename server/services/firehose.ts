import { Firehose } from "@skyware/firehose";
import WebSocket from "ws";
import os from "os";
import { eventProcessor } from "./event-processor";
import { metricsService } from "./metrics";
import { logCollector } from "./log-collector";

type EventCallback = (event: any) => void;

export class FirehoseClient {
  private client: Firehose | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private url: string;
  private isConnected = false;
  private eventCallbacks: EventCallback[] = [];
  private recentEvents: any[] = []; // Keep last 50 events for dashboard
  
  // Concurrency control to prevent overwhelming the database connection pool
  private processingQueue: Array<() => Promise<void>> = [];
  private activeProcessing = 0;
  private readonly MAX_CONCURRENT_PROCESSING = 50; // Limit concurrent event processing
  private readonly MEMORY_THRESHOLD_PERCENT = 20; // Drop events when free memory < 20%
  private lastMemoryWarning = 0; // Throttle memory warnings

  constructor(url: string = process.env.RELAY_URL || "wss://bsky.network") {
    this.url = url;
  }

  private getMemoryStatus(): { freePercent: number; freeMB: number; totalMB: number; isLow: boolean } {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const freePercent = (freeMemory / totalMemory) * 100;
    const isLow = freePercent < this.MEMORY_THRESHOLD_PERCENT;
    
    return {
      freePercent,
      freeMB: Math.round(freeMemory / 1024 / 1024),
      totalMB: Math.round(totalMemory / 1024 / 1024),
      isLow
    };
  }

  private async processQueuedEvent(task: () => Promise<void>) {
    this.activeProcessing++;
    try {
      await task();
    } finally {
      this.activeProcessing--;
      this.processNextInQueue();
    }
  }

  private processNextInQueue() {
    if (this.activeProcessing < this.MAX_CONCURRENT_PROCESSING && this.processingQueue.length > 0) {
      const nextTask = this.processingQueue.shift();
      if (nextTask) {
        this.processQueuedEvent(nextTask);
      }
    }
  }

  private async queueEventProcessing(task: () => Promise<void>) {
    if (this.activeProcessing < this.MAX_CONCURRENT_PROCESSING) {
      this.processQueuedEvent(task);
    } else {
      this.processingQueue.push(task);
      
      // Check memory status before dropping events
      const memStatus = this.getMemoryStatus();
      
      // Only drop events when memory is critically low
      if (memStatus.isLow && this.processingQueue.length > 10000) {
        const dropped = this.processingQueue.shift(); // Remove oldest
        
        // Throttle warnings to every 30 seconds
        const now = Date.now();
        if (now - this.lastMemoryWarning > 30000) {
          console.error(
            `[FIREHOSE] ⚠️  CRITICAL: Low memory detected - dropping events to prevent crash!\n` +
            `  Memory: ${memStatus.freeMB}MB free (${memStatus.freePercent.toFixed(1)}%) of ${memStatus.totalMB}MB total\n` +
            `  Queue size: ${this.processingQueue.length} events\n` +
            `  Active processing: ${this.activeProcessing}/${this.MAX_CONCURRENT_PROCESSING}\n` +
            `  ACTION REQUIRED: This system needs more memory to process all events without dropping data.`
          );
          logCollector.error("Low memory - dropping firehose events", {
            freeMemoryMB: memStatus.freeMB,
            freeMemoryPercent: memStatus.freePercent.toFixed(1),
            queueSize: this.processingQueue.length,
            activeProcessing: this.activeProcessing
          });
          this.lastMemoryWarning = now;
        }
        metricsService.incrementError();
      }
      // If memory is sufficient, allow queue to grow without dropping events
      else if (!memStatus.isLow && this.processingQueue.length % 5000 === 0) {
        // Log queue growth periodically when memory is sufficient
        console.log(
          `[FIREHOSE] Queue growing (memory sufficient): ${this.processingQueue.length} events queued, ` +
          `${memStatus.freeMB}MB free (${memStatus.freePercent.toFixed(1)}%)`
        );
      }
    }
  }

  onEvent(callback: EventCallback) {
    this.eventCallbacks.push(callback);
  }

  private broadcastEvent(event: any) {
    // Add to recent events history (keep last 50)
    this.recentEvents.unshift(event);
    if (this.recentEvents.length > 50) {
      this.recentEvents.pop();
    }

    this.eventCallbacks.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        console.error("[FIREHOSE] Error in event callback:", error);
      }
    });
  }

  connect() {
    // Close existing client before creating new one to prevent memory leaks
    if (this.client) {
      try {
        this.client.removeAllListeners();
        // @ts-ignore - close method exists but not in types
        if (typeof this.client.close === 'function') {
          this.client.close();
        }
      } catch (error) {
        console.error("[FIREHOSE] Error closing existing client:", error);
      }
      this.client = null;
    }
    
    console.log(`[FIREHOSE] Connecting to ${this.url}...`);
    logCollector.info(`Connecting to firehose at ${this.url}`);
    
    try {
      this.client = new Firehose({
        service: this.url,
        ws: WebSocket as any,
      });

      this.client.on("open", () => {
        console.log("[FIREHOSE] Connected to relay");
        logCollector.success(`Firehose connected to ${this.url}`);
        this.isConnected = true;
        this.reconnectDelay = 1000;
        metricsService.updateFirehoseStatus("connected");
      });

      this.client.on("commit", (commit) => {
        metricsService.incrementEvent("#commit");
        
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
        
        // Broadcast to WebSocket clients (synchronous, non-blocking)
        const firstOp = commit.ops[0];
        if (firstOp) {
          const lexicon = firstOp.path.split('/')[0];
          this.broadcastEvent({
            type: "#commit",
            lexicon: lexicon,
            did: commit.repo,
            action: firstOp.action,
            timestamp: new Date().toISOString().split('T')[1].slice(0, 8),
          });
        }
        
        // Queue the database processing with concurrency control
        this.queueEventProcessing(async () => {
          try {
            await eventProcessor.processCommit(event);
          } catch (error) {
            console.error("[FIREHOSE] Error processing commit:", error);
            metricsService.incrementError();
          }
        });
      });

      this.client.on("identity", (identity) => {
        metricsService.incrementEvent("#identity");
        
        // Broadcast to WebSocket clients
        this.broadcastEvent({
          type: "#identity",
          lexicon: "com.atproto.identity",
          did: identity.did,
          action: identity.handle ? `→ ${identity.handle}` : "update",
          timestamp: new Date().toISOString().split('T')[1].slice(0, 8),
        });
        
        // Queue the database processing
        this.queueEventProcessing(async () => {
          try {
            await eventProcessor.processIdentity({
              did: identity.did,
              handle: identity.handle || identity.did,
            });
          } catch (error) {
            console.error("[FIREHOSE] Error processing identity:", error);
            metricsService.incrementError();
          }
        });
      });

      this.client.on("account", (account) => {
        metricsService.incrementEvent("#account");
        
        // Broadcast to WebSocket clients
        this.broadcastEvent({
          type: "#account",
          lexicon: "com.atproto.account",
          did: account.did,
          action: account.active ? "active" : "inactive",
          timestamp: new Date().toISOString().split('T')[1].slice(0, 8),
        });
        
        // Queue the database processing
        this.queueEventProcessing(async () => {
          try {
            await eventProcessor.processAccount({
              did: account.did,
              active: account.active,
            });
          } catch (error) {
            console.error("[FIREHOSE] Error processing account:", error);
            metricsService.incrementError();
          }
        });
      });

      this.client.on("error", (error) => {
        console.error("[FIREHOSE] WebSocket error:", error);
        logCollector.error("Firehose WebSocket error", { error: error.message });
        this.isConnected = false;
        metricsService.updateFirehoseStatus("error");
      });

      this.client.start();
    } catch (error) {
      console.error("[FIREHOSE] Failed to create client:", error);
      this.isConnected = false;
      metricsService.updateFirehoseStatus("error");
      this.reconnect();
    }
  }

  private reconnect() {
    if (this.reconnectTimeout) {
      return;
    }

    console.log(`[FIREHOSE] Reconnecting in ${this.reconnectDelay}ms...`);
    
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.client) {
      try {
        // @skyware/firehose doesn't have removeAllListeners, just close the connection
        // @ts-ignore - close method exists but not in types
        if (typeof this.client.close === 'function') {
          this.client.close();
        }
      } catch (error) {
        console.error("[FIREHOSE] Error during disconnect:", error);
      }
      this.client = null;
    }

    this.isConnected = false;
    metricsService.updateFirehoseStatus("disconnected");
  }

  getStatus() {
    return {
      connected: this.isConnected,
      url: this.url,
    };
  }

  getRecentEvents(limit = 10) {
    return this.recentEvents.slice(0, limit);
  }
}

export const firehoseClient = new FirehoseClient();
