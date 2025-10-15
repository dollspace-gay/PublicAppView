/**
 * Base adapter interface for input sources to Osprey bridge
 * Adapters can consume events from firehose, Redis, or direct in-process calls
 */
export interface InputAdapter {
  /**
   * Connect to the input source and start listening for events
   */
  start(eventHandler: EventHandler): Promise<void>;

  /**
   * Stop consuming events and clean up resources
   */
  stop(): Promise<void>;

  /**
   * Get the adapter name for logging
   */
  getName(): string;
}

/**
 * Event handler callback for adapters
 */
export type EventHandler = (event: AdapterEvent) => Promise<void>;

/**
 * Normalized event structure across all adapters
 */
export interface AdapterEvent {
  type: 'commit' | 'identity' | 'account';
  did: string;
  data: unknown;
  seq?: string;
}
