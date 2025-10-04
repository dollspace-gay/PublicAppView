import { Firehose } from '@skyware/firehose';
import WebSocket from 'ws';
import * as fs from 'fs';
import { InputAdapter, EventHandler, AdapterEvent } from './base-adapter';

// Make WebSocket available globally for @skyware/firehose in Node.js environment
if (typeof globalThis.WebSocket === 'undefined') {
  (global as any).WebSocket = WebSocket;
}

export interface FirehoseAdapterConfig {
  url: string;
  cursorFile?: string;
}

/**
 * Adapter that consumes events directly from AT Protocol firehose
 */
export class FirehoseAdapter implements InputAdapter {
  private firehose: Firehose | null = null;
  private config: FirehoseAdapterConfig;
  private currentCursor: string | null = null;
  private cursorSaveInterval: NodeJS.Timeout | null = null;

  constructor(config: FirehoseAdapterConfig) {
    this.config = config;
  }

  getName(): string {
    return 'FirehoseAdapter';
  }

  async start(eventHandler: EventHandler): Promise<void> {
    console.log(`[${this.getName()}] Starting firehose connection to ${this.config.url}...`);

    // Load saved cursor
    const savedCursor = this.loadCursor();
    
    // Create firehose client
    const firehoseOptions: any = {
      relay: this.config.url,
    };
    
    if (savedCursor) {
      firehoseOptions.cursor = savedCursor;
      console.log(`[${this.getName()}] Resuming from cursor: ${savedCursor.slice(0, 20)}...`);
    }
    
    this.firehose = new Firehose(firehoseOptions);

    // Handle commit events
    this.firehose.on('commit', async (commit) => {
      if (commit.seq) {
        this.currentCursor = String(commit.seq);
      }

      const event: AdapterEvent = {
        type: 'commit',
        did: commit.repo,
        data: {
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
        },
        seq: commit.seq ? String(commit.seq) : undefined,
      };

      await eventHandler(event);
    });

    // Handle identity events
    this.firehose.on('identity', async (identity) => {
      const event: AdapterEvent = {
        type: 'identity',
        did: identity.did,
        data: identity,
      };
      await eventHandler(event);
    });

    // Handle account events
    this.firehose.on('handle', async (handle) => {
      const event: AdapterEvent = {
        type: 'account',
        did: handle.did,
        data: handle,
      };
      await eventHandler(event);
    });

    this.firehose.on('open', () => {
      console.log(`[${this.getName()}] Connected to firehose`);
    });

    this.firehose.on('close', () => {
      console.log(`[${this.getName()}] Disconnected from firehose`);
    });

    this.firehose.on('error', (error: any) => {
      console.error(`[${this.getName()}] Firehose error:`, error);
    });

    // Start cursor persistence
    if (this.config.cursorFile) {
      this.startCursorPersistence();
    }

    console.log(`[${this.getName()}] Started successfully`);
  }

  async stop(): Promise<void> {
    console.log(`[${this.getName()}] Stopping...`);

    if (this.cursorSaveInterval) {
      clearInterval(this.cursorSaveInterval);
      this.cursorSaveInterval = null;
    }

    if (this.firehose) {
      this.firehose.close();
      this.firehose = null;
    }

    // Save final cursor
    if (this.currentCursor && this.config.cursorFile) {
      this.saveCursor(this.currentCursor);
    }

    console.log(`[${this.getName()}] Stopped`);
  }

  private loadCursor(): string | null {
    if (!this.config.cursorFile) {
      return null;
    }

    try {
      if (fs.existsSync(this.config.cursorFile)) {
        const cursor = fs.readFileSync(this.config.cursorFile, 'utf-8').trim();
        return cursor || null;
      }
    } catch (error) {
      console.error(`[${this.getName()}] Error loading cursor:`, error);
    }

    return null;
  }

  private saveCursor(cursor: string) {
    if (!this.config.cursorFile) {
      return;
    }

    try {
      fs.writeFileSync(this.config.cursorFile, cursor);
    } catch (error) {
      console.error(`[${this.getName()}] Error saving cursor:`, error);
    }
  }

  private startCursorPersistence() {
    this.cursorSaveInterval = setInterval(() => {
      if (this.currentCursor && this.config.cursorFile) {
        this.saveCursor(this.currentCursor);
      }
    }, 5000); // Save every 5 seconds
  }
}
