import { Firehose } from "@skyware/firehose";
import WebSocket from "ws";
import { eventProcessor } from "./event-processor";
import { metricsService } from "./metrics";
import { logCollector } from "./log-collector";

// Make WebSocket available globally for @skyware/firehose in Node.js environment
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as any).WebSocket = WebSocket;
}

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
  
  // Cursor persistence for restart recovery
  private currentCursor: string | null = null;
  private lastCursorSave = 0;
  private readonly CURSOR_SAVE_INTERVAL = 5000; // Save cursor every 5 seconds
  
  // Concurrency control to prevent database connection pool exhaustion
  // With pool size of 300, allow 1500 concurrent operations for extreme throughput
  private processingQueue: Array<() => Promise<void>> = [];
  private activeProcessing = 0;
  private readonly MAX_CONCURRENT_PROCESSING = 1500; // Balanced with pool size of 300

  constructor(url: string = process.env.RELAY_URL || "wss://bsky.network") {
    this.url = url;
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
    // Process as many queued events as concurrency allows
    if (this.activeProcessing < this.MAX_CONCURRENT_PROCESSING && this.processingQueue.length > 0) {
      const nextTask = this.processingQueue.shift();
      if (nextTask) {
        this.processQueuedEvent(nextTask);
      }
    }
  }

  private async queueEventProcessing(task: () => Promise<void>) {
    // Process immediately if under concurrency limit, otherwise queue
    if (this.activeProcessing < this.MAX_CONCURRENT_PROCESSING) {
      this.processQueuedEvent(task);
    } else {
      // Queue without any memory checks or event dropping - let it grow unlimited
      this.processingQueue.push(task);
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

  private async saveCursor(cursor: string) {
    // Update current cursor
    this.currentCursor = cursor;
    
    // Save to database periodically (every 5 seconds) to avoid excessive writes
    const now = Date.now();
    if (now - this.lastCursorSave > this.CURSOR_SAVE_INTERVAL) {
      try {
        const { storage } = await import("../storage");
        await storage.saveFirehoseCursor("firehose", cursor, new Date());
        this.lastCursorSave = now;
      } catch (error) {
        console.error("[FIREHOSE] Error saving cursor:", error);
      }
    }
  }

  async connect() {
    // Close existing client before creating new one to prevent memory leaks
    if (this.client) {
      try {
        this.client.close();
      } catch (error) {
        console.error("[FIREHOSE] Error closing existing client:", error);
      }
      this.client = null;
    }
    
    // Load saved cursor for restart recovery
    try {
      const { storage } = await import("../storage");
      const savedCursor = await storage.getFirehoseCursor("firehose");
      if (savedCursor && savedCursor.cursor) {
        this.currentCursor = savedCursor.cursor;
        console.log(`[FIREHOSE] Resuming from saved cursor: ${this.currentCursor.slice(0, 20)}...`);
        logCollector.info(`Resuming firehose from cursor: ${this.currentCursor.slice(0, 20)}...`);
      } else {
        console.log(`[FIREHOSE] No saved cursor found, starting from now`);
        logCollector.info("No saved cursor - starting firehose from current position");
      }
    } catch (error) {
      console.error("[FIREHOSE] Error loading cursor:", error);
      logCollector.error("Failed to load firehose cursor", { error });
    }
    
    console.log(`[FIREHOSE] Connecting to ${this.url}...`);
    logCollector.info(`Connecting to firehose at ${this.url}`);
    
    try {
      // Configure options for Firehose constructor
      const options: any = {
        relay: this.url
      };
      
      // Resume from saved cursor if available
      if (this.currentCursor) {
        options.cursor = this.currentCursor;
      }
      
      // WebSocket is now available globally, so library will detect it automatically
      this.client = new Firehose(options);

      this.client.on("open", () => {
        console.log("[FIREHOSE] Connected to relay");
        logCollector.success(`Firehose connected to ${this.url}`);
        this.isConnected = true;
        this.reconnectDelay = 1000;
        metricsService.updateFirehoseStatus("connected");
      });

      this.client.on("commit", (commit) => {
        metricsService.incrementEvent("#commit");
        
        // Save cursor for restart recovery
        if (commit.seq) {
          this.saveCursor(String(commit.seq));
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
        
        // Note: Identity events don't have seq, cursor management handled by commit events
        
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
        
        // Note: Account events don't have seq, cursor management handled by commit events
        
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

      this.client.on("error", ({ cursor, error }) => {
        console.error("[FIREHOSE] WebSocket error:", error);
        
        // Categorize errors for better monitoring
        const errorType = this.categorizeError(error);
        logCollector.error(`Firehose ${errorType} error`, { 
          error: error instanceof Error ? error.message : String(error),
          type: errorType,
          url: this.url,
          cursor
        });
        
        this.isConnected = false;
        metricsService.updateFirehoseStatus("error");
        metricsService.incrementError();
        
        // Attempt reconnection for recoverable errors
        if (errorType !== "fatal") {
          this.reconnect();
        }
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
        this.client.close();
      } catch (error) {
        console.error("[FIREHOSE] Error during disconnect:", error);
      }
      this.client = null;
    }

    this.isConnected = false;
    metricsService.updateFirehoseStatus("disconnected");
  }

  private categorizeError(error: any): string {
    const message = error?.message?.toLowerCase() || "";
    
    if (message.includes("econnrefused") || message.includes("enotfound")) {
      return "network";
    } else if (message.includes("timeout")) {
      return "timeout";
    } else if (message.includes("authentication") || message.includes("unauthorized")) {
      return "auth";
    } else if (message.includes("rate limit")) {
      return "rate-limit";
    } else if (message.includes("protocol") || message.includes("parse")) {
      return "protocol";
    }
    
    return "unknown";
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      connected: this.isConnected,
      url: this.url,
      currentCursor: this.currentCursor,
      queueDepth: this.processingQueue.length,
      activeProcessing: this.activeProcessing,
      reconnectDelay: this.reconnectDelay,
    };
  }

  getRecentEvents(limit = 10) {
    return this.recentEvents.slice(0, limit);
  }
}

export const firehoseClient = new FirehoseClient();
