import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';

export interface OspreyLabel {
  ver: number;
  src: string;  // DID of labeler
  uri: string;  // Subject AT-URI
  cid?: string; // Optional CID
  val: string;  // Label value (spam, porn, etc.)
  neg?: boolean; // Negation flag
  cts: string;  // Created timestamp
  exp?: string; // Optional expiration
  sig?: Uint8Array; // Optional signature
}

export class LabelConsumer {
  private kafka: Kafka;
  private consumer: Consumer;
  private connected: boolean = false;
  private messagesProcessed: number = 0;
  private lastMessageTime: Date | null = null;

  constructor(
    private brokers: string[],
    private topic: string,
    private groupId: string,
    private onLabel: (label: OspreyLabel) => Promise<void>
  ) {
    this.kafka = new Kafka({
      clientId: 'osprey-label-effector',
      brokers: this.brokers,
      retry: {
        initialRetryTime: 100,
        retries: 8,
      },
    });

    this.consumer = this.kafka.consumer({
      groupId: this.groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });
  }

  async connect(): Promise<void> {
    console.log(`[KAFKA] Connecting to Kafka at ${this.brokers.join(', ')}...`);
    
    await this.consumer.connect();
    this.connected = true;
    
    console.log(`[KAFKA] Connected successfully`);
    console.log(`[KAFKA] Subscribing to topic: ${this.topic}`);
    
    await this.consumer.subscribe({
      topic: this.topic,
      fromBeginning: false, // Only consume new labels
    });
    
    console.log(`[KAFKA] Subscribed successfully`);
  }

  async start(): Promise<void> {
    console.log(`[KAFKA] Starting label consumer...`);
    
    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        await this.processMessage(payload);
      },
    });
  }

  private async processMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;
    
    if (!message.value) {
      console.warn('[KAFKA] Received message with no value');
      return;
    }

    try {
      const labelData = JSON.parse(message.value.toString());
      
      // Validate label format
      if (!this.isValidLabel(labelData)) {
        console.warn('[KAFKA] Invalid label format:', labelData);
        return;
      }

      const label: OspreyLabel = labelData;
      
      console.log(`[KAFKA] Received label from ${label.src}: ${label.val} → ${label.uri}`, {
        partition,
        offset: message.offset,
        neg: label.neg || false,
      });

      // Apply label via callback
      await this.onLabel(label);
      
      this.messagesProcessed++;
      this.lastMessageTime = new Date();
      
    } catch (error) {
      console.error('[KAFKA] Error processing message:', error);
      console.error('[KAFKA] Message value:', message.value.toString());
    }
  }

  private isValidLabel(data: any): boolean {
    return (
      typeof data === 'object' &&
      typeof data.ver === 'number' &&
      typeof data.src === 'string' &&
      typeof data.uri === 'string' &&
      typeof data.val === 'string' &&
      typeof data.cts === 'string' &&
      (data.neg === undefined || typeof data.neg === 'boolean')
    );
  }

  async disconnect(): Promise<void> {
    console.log('[KAFKA] Disconnecting...');
    await this.consumer.disconnect();
    this.connected = false;
    console.log('[KAFKA] Disconnected');
  }

  getMetrics() {
    return {
      connected: this.connected,
      messagesProcessed: this.messagesProcessed,
      lastMessageTime: this.lastMessageTime,
    };
  }
}
