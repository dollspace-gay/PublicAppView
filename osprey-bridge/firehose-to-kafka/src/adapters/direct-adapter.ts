import { InputAdapter, EventHandler, AdapterEvent } from './base-adapter';

/**
 * Adapter that receives events directly from in-process calls
 * Zero latency, no queue overhead - perfect for single-instance deployments
 *
 * Usage:
 *   const adapter = new DirectAdapter();
 *   await adapter.start(eventHandler);
 *
 *   // In your event processor:
 *   directAdapter.pushEvent({ type: 'commit', did: '...', data: {...} });
 */
export class DirectAdapter implements InputAdapter {
  private eventHandler: EventHandler | null = null;
  private isRunning = false;
  private eventQueue: AdapterEvent[] = [];
  private processingLoop: Promise<void> | null = null;

  getName(): string {
    return 'DirectAdapter';
  }

  async start(eventHandler: EventHandler): Promise<void> {
    console.log(`[${this.getName()}] Starting direct event adapter...`);

    this.eventHandler = eventHandler;
    this.isRunning = true;

    // Start processing loop
    this.processingLoop = this.runProcessingLoop();

    console.log(
      `[${this.getName()}] Started successfully (ready to receive events)`
    );
  }

  async stop(): Promise<void> {
    console.log(`[${this.getName()}] Stopping...`);

    this.isRunning = false;

    if (this.processingLoop) {
      await this.processingLoop;
      this.processingLoop = null;
    }

    this.eventHandler = null;
    this.eventQueue = [];

    console.log(`[${this.getName()}] Stopped`);
  }

  /**
   * Push an event to be processed
   * Called directly from the main app's event processor
   */
  pushEvent(event: AdapterEvent): void {
    if (!this.isRunning) {
      console.warn(
        `[${this.getName()}] Received event while not running, dropping`
      );
      return;
    }

    this.eventQueue.push(event);
  }

  /**
   * Push multiple events at once
   */
  pushEvents(events: AdapterEvent[]): void {
    if (!this.isRunning) {
      console.warn(
        `[${this.getName()}] Received ${events.length} events while not running, dropping`
      );
      return;
    }

    this.eventQueue.push(...events);
  }

  /**
   * Get current queue size (for monitoring)
   */
  getQueueSize(): number {
    return this.eventQueue.length;
  }

  private async runProcessingLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        if (this.eventQueue.length === 0) {
          // Wait a bit if queue is empty
          await new Promise((resolve) => setTimeout(resolve, 10));
          continue;
        }

        // Process events in batches
        const batchSize = Math.min(100, this.eventQueue.length);
        const batch = this.eventQueue.splice(0, batchSize);

        for (const event of batch) {
          try {
            if (this.eventHandler) {
              await this.eventHandler(event);
            }
          } catch (error) {
            console.error(`[${this.getName()}] Error processing event:`, error);
          }
        }
      } catch (error) {
        console.error(`[${this.getName()}] Error in processing loop:`, error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
}
