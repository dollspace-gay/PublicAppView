import { Firehose } from "@skyware/firehose";
import WebSocket from "ws";
import { eventProcessor } from "./event-processor";
import { metricsService } from "./metrics";
import { logCollector } from "./log-collector";
import { redisQueue } from "./redis-queue";

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
  private statusHeartbeat: NodeJS.Timeout | null = null;
  private lastEventTime: number = Date.now(); // Track last event for stall detection
  private readonly STALL_THRESHOLD = 2 * 60 * 1000; // 2 minutes without events = stalled
  
  // WebSocket ping/pong keepalive (production-grade zombie connection prevention)
  private pingInterval: NodeJS.Timeout | null = null;
  private lastPongTime: number = Date.now();
  private readonly PING_INTERVAL = 30000; // Send ping every 30s (Bluesky recommended)
  private readonly PONG_TIMEOUT = 45000; // Expect pong within 45s
  
  // Worker distribution for parallel processing
  private workerId: number = 0;
  private totalWorkers: number = 1;
  
  // Cursor persistence for restart recovery
  private currentCursor: string | null = null;
  private lastCursorSave = 0;
  private readonly CURSOR_SAVE_INTERVAL = 5000; // Save cursor every 5 seconds
  
  // Concurrency control to prevent database connection pool exhaustion
  // With pool size of 100 per worker, allow 80 concurrent operations per worker
  // This enables maximum throughput on high-memory VPS (47GB+)
  // 32 workers × 80 = 2560 total concurrent operations across cluster
  private processingQueue: Array<() => Promise<void>> = [];
  private activeProcessing = 0;
  private readonly MAX_CONCURRENT_PROCESSING = parseInt(process.env.MAX_CONCURRENT_OPS || '80');

  constructor(url: string = process.env.RELAY_URL || "wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos") {
    this.url = url;
  }
  
  // Simple hash function for consistent event distribution
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }
  
  // Check if this worker should process this event
  private shouldProcessEvent(eventId: string): boolean {
    if (this.totalWorkers === 1) return true;
    const hash = this.hashString(eventId);
    return (hash % this.totalWorkers) === this.workerId;
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
      // Add backpressure: limit queue size to prevent memory exhaustion
      const MAX_QUEUE_SIZE = 10000;
      
      if (this.processingQueue.length >= MAX_QUEUE_SIZE) {
        // Queue is full - log warning and drop oldest events to prevent memory exhaustion
        console.warn(`[FIREHOSE] Processing queue full (${this.processingQueue.length}), dropping old events to prevent OOM`);
        metricsService.incrementError();
        // Drop oldest 20% of queued events
        this.processingQueue.splice(0, Math.floor(MAX_QUEUE_SIZE * 0.2));
      }
      
      this.processingQueue.push(task);
    }
  }

  onEvent(callback: EventCallback) {
    this.eventCallbacks.push(callback);
  }

  offEvent(callback: EventCallback) {
    const index = this.eventCallbacks.indexOf(callback);
    if (index > -1) {
      this.eventCallbacks.splice(index, 1);
    }
  }

  private async broadcastEvent(event: any) {
    // Add to recent events history (keep last 50)
    this.recentEvents.unshift(event);
    if (this.recentEvents.length > 50) {
      this.recentEvents.pop();
    }

    // Store in Redis for cluster-wide visibility (non-blocking)
    redisQueue.setRecentEvents(this.recentEvents).catch(err => {
      console.error("[FIREHOSE] Error storing events in Redis:", err);
    });

    // Publish to Redis for cluster-wide broadcasting
    redisQueue.publishEvent(event).catch(err => {
      console.error("[FIREHOSE] Error publishing event to Redis:", err);
    });

    // Also call local callbacks
    this.eventCallbacks.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        console.error("[FIREHOSE] Error in event callback:", error);
      }
    });
  }

  private async updateRedisStatus() {
    // Store firehose status in Redis for cluster-wide visibility
    try {
      await redisQueue.setFirehoseStatus({
        connected: this.isConnected,
        url: this.url,
        currentCursor: this.currentCursor,
      });
      console.log(`[FIREHOSE] Status updated in Redis: connected=${this.isConnected}`);
    } catch (err) {
      console.error("[FIREHOSE] Error storing status in Redis:", err);
    }
  }

  private saveCursor(cursor: string) {
    // Update current cursor in memory immediately
    this.currentCursor = cursor;
    
    // Save to database periodically (every 5 seconds) to avoid excessive writes
    const now = Date.now();
    if (now - this.lastCursorSave > this.CURSOR_SAVE_INTERVAL) {
      this.lastCursorSave = now;
      
      // Queue cursor save through concurrency system to prevent timeout
      // Don't await - let it run in background without blocking event processing
      this.queueEventProcessing(async () => {
        try {
          const { storage } = await import("../storage");
          await storage.saveFirehoseCursor("firehose", cursor, new Date());
        } catch (error) {
          console.error("[FIREHOSE] Error saving cursor:", error);
        }
      });
    }
  }

  async connect(workerId: number = 0, totalWorkers: number = 1) {
    // Store worker info for event distribution
    this.workerId = workerId;
    this.totalWorkers = totalWorkers;
    
    // Close existing client before creating new one to prevent memory leaks
    if (this.client) {
      try {
        this.client.close();
      } catch (error) {
        console.error("[FIREHOSE] Error closing existing client:", error);
      }
      this.client = null;
    }
    
    // Load saved cursor for restart recovery (only worker 0 manages cursor)
    if (workerId === 0) {
      try {
        const { storage } = await import("../storage");
        const savedCursor = await storage.getFirehoseCursor("firehose");
        if (savedCursor && savedCursor.cursor) {
          this.currentCursor = savedCursor.cursor;
          console.log(`[FIREHOSE] Worker ${workerId} - Resuming from saved cursor: ${this.currentCursor.slice(0, 20)}...`);
          logCollector.info(`Worker ${workerId} - Resuming firehose from cursor: ${this.currentCursor.slice(0, 20)}...`);
        } else {
          console.log(`[FIREHOSE] Worker ${workerId} - No saved cursor found, starting from now`);
          logCollector.info(`Worker ${workerId} - No saved cursor - starting from current position`);
        }
      } catch (error) {
        console.error("[FIREHOSE] Error loading cursor:", error);
        logCollector.error("Failed to load firehose cursor", { error });
      }
    }
    
    console.log(`[FIREHOSE] Worker ${workerId}/${totalWorkers} - Connecting to ${this.url}...`);
    logCollector.info(`Worker ${workerId}/${totalWorkers} - Connecting to firehose at ${this.url}`);
    
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
        
        // Reset stall detection timer on new connection
        this.lastEventTime = Date.now();
        this.lastPongTime = Date.now();
        
        // Start WebSocket ping/pong keepalive (prevents zombie connections)
        this.startWebSocketKeepalive();
        
        // Update status immediately and start heartbeat
        this.updateRedisStatus();
        this.startStatusHeartbeat();
      });

      this.client.on("commit", async (commit) => {
        // Update last event time for stall detection
        this.lastEventTime = Date.now();
        
        metricsService.incrementEvent("#commit");
        
        // Save cursor for restart recovery (only worker 0)
        if (commit.seq && this.workerId === 0) {
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
        
        // Push to Redis queue for distributed processing
        try {
          await redisQueue.push({
            type: "commit",
            data: event,
            seq: commit.seq ? String(commit.seq) : undefined,
          });
        } catch (error) {
          console.error("[FIREHOSE] Error pushing to Redis:", error);
          metricsService.incrementError();
        }
      });

      this.client.on("identity", async (identity) => {
        // Update last event time for stall detection
        this.lastEventTime = Date.now();
        
        metricsService.incrementEvent("#identity");
        
        // Broadcast to WebSocket clients
        this.broadcastEvent({
          type: "#identity",
          lexicon: "com.atproto.identity",
          did: identity.did,
          action: identity.handle ? `→ ${identity.handle}` : "update",
          timestamp: new Date().toISOString().split('T')[1].slice(0, 8),
        });
        
        // Push to Redis queue for distributed processing
        try {
          await redisQueue.push({
            type: "identity",
            data: {
              did: identity.did,
              handle: identity.handle || identity.did,
            },
          });
        } catch (error) {
          console.error("[FIREHOSE] Error pushing to Redis:", error);
          metricsService.incrementError();
        }
      });

      this.client.on("account", async (account) => {
        // Update last event time for stall detection
        this.lastEventTime = Date.now();
        
        metricsService.incrementEvent("#account");
        
        // Broadcast to WebSocket clients
        this.broadcastEvent({
          type: "#account",
          lexicon: "com.atproto.account",
          did: account.did,
          action: account.active ? "active" : "inactive",
          timestamp: new Date().toISOString().split('T')[1].slice(0, 8),
        });
        
        // Push to Redis queue for distributed processing
        try {
          await redisQueue.push({
            type: "account",
            data: {
              did: account.did,
              active: account.active,
            },
          });
        } catch (error) {
          console.error("[FIREHOSE] Error pushing to Redis:", error);
          metricsService.incrementError();
        }
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
        
        // Stop heartbeat on error
        if (this.statusHeartbeat) {
          clearInterval(this.statusHeartbeat);
          this.statusHeartbeat = null;
        }
        
        this.updateRedisStatus();
        
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

  private startWebSocketKeepalive() {
    // Clear any existing ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    // Access underlying WebSocket from @skyware/firehose (exposed as .ws property)
    const socket = (this.client as any)?.ws;
    
    if (!socket || typeof socket.ping !== 'function') {
      console.warn("[FIREHOSE] Cannot access WebSocket for keepalive - ws not available yet");
      // Try again in 1 second after connection is fully established
      setTimeout(() => {
        const retrySocket = (this.client as any)?.ws;
        if (retrySocket && typeof retrySocket.ping === 'function') {
          this.setupWebSocketPingPong(retrySocket);
        }
      }, 1000);
      return;
    }
    
    this.setupWebSocketPingPong(socket);
  }
  
  private setupWebSocketPingPong(socket: any) {
    console.log("[FIREHOSE] Setting up WebSocket keepalive (ping every 30s, timeout 45s)");
    
    // Listen for pong responses from the server
    socket.on('pong', () => {
      this.lastPongTime = Date.now();
    });
    
    // Listen for unexpected close events (NAT timeout, TLS timeout, etc.)
    socket.on('unexpected-response', (req: any, res: any) => {
      console.error(`[FIREHOSE] Unexpected response from relay: ${res.statusCode}`);
      logCollector.error(`Firehose unexpected response: ${res.statusCode}`, { url: this.url });
      this.isConnected = false;
      this.reconnect();
    });
    
    // Send ping frames every 30s and check for pong responses
    this.pingInterval = setInterval(() => {
      if (!this.isConnected || !socket || socket.readyState !== 1) {
        return;
      }
      
      // Check if we received a pong recently
      const timeSinceLastPong = Date.now() - this.lastPongTime;
      
      if (timeSinceLastPong > this.PONG_TIMEOUT) {
        // No pong received within timeout - connection is dead (zombie)
        console.error(`[FIREHOSE] WebSocket zombie detected - no pong for ${Math.floor(timeSinceLastPong / 1000)}s, reconnecting...`);
        logCollector.error(`WebSocket keepalive failed - terminating zombie connection`, { 
          timeSinceLastPong: Math.floor(timeSinceLastPong / 1000) 
        });
        
        // Force terminate the dead socket
        this.isConnected = false;
        try {
          socket.terminate();
        } catch (error) {
          console.error("[FIREHOSE] Error terminating socket:", error);
        }
        
        // Reconnect
        this.reconnect();
        return;
      }
      
      // Send ping frame to keep connection alive
      try {
        socket.ping();
        // Ping sent successfully (no log to avoid clutter - only log issues)
      } catch (error) {
        console.error("[FIREHOSE] Error sending ping:", error);
        this.isConnected = false;
        this.reconnect();
      }
    }, this.PING_INTERVAL);
  }

  private startStatusHeartbeat() {
    // Clear existing heartbeat
    if (this.statusHeartbeat) {
      clearInterval(this.statusHeartbeat);
    }
    
    // Update status every 5 seconds to keep Redis key alive (10s TTL)
    // Also check for stalled connection (no events received)
    this.statusHeartbeat = setInterval(() => {
      if (this.isConnected) {
        this.updateRedisStatus();
        
        // Detect stalled connection: no events for STALL_THRESHOLD
        const timeSinceLastEvent = Date.now() - this.lastEventTime;
        if (timeSinceLastEvent > this.STALL_THRESHOLD) {
          console.warn(`[FIREHOSE] Connection stalled - no events for ${Math.floor(timeSinceLastEvent / 1000)}s, reconnecting...`);
          logCollector.error(`Firehose stalled - no events for ${Math.floor(timeSinceLastEvent / 60000)} minutes, auto-reconnecting`);
          
          // Force reconnection
          this.isConnected = false;
          if (this.client) {
            try {
              this.client.close();
            } catch (error) {
              console.error("[FIREHOSE] Error closing stalled client:", error);
            }
            this.client = null;
          }
          
          // Reset last event time to prevent immediate re-trigger
          this.lastEventTime = Date.now();
          
          // Reconnect
          this.reconnect();
        }
      }
    }, 5000);
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.statusHeartbeat) {
      clearInterval(this.statusHeartbeat);
      this.statusHeartbeat = null;
    }
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
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
    this.updateRedisStatus();
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

  async getStatus() {
    // If this worker has the firehose connected, return local status
    if (this.isConnected) {
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

    // Otherwise, read from Redis to get status from the worker that IS connected
    try {
      const redisStatus = await redisQueue.getFirehoseStatus();
      if (redisStatus) {
        return {
          isConnected: redisStatus.connected,
          connected: redisStatus.connected,
          url: redisStatus.url,
          currentCursor: redisStatus.currentCursor,
          queueDepth: this.processingQueue.length,
          activeProcessing: this.activeProcessing,
          reconnectDelay: this.reconnectDelay,
        };
      }
    } catch (error) {
      console.error("[FIREHOSE] Error reading status from Redis:", error);
    }

    // Fallback to local disconnected state
    return {
      isConnected: false,
      connected: false,
      url: this.url,
      currentCursor: null,
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
