import { Kafka, Producer, CompressionTypes } from 'kafkajs';

export interface KafkaConfig {
  brokers: string[];
  clientId: string;
  topic: string;
}

export class KafkaProducerClient {
  private kafka: Kafka;
  private producer: Producer;
  private topic: string;
  private isConnected = false;

  constructor(config: KafkaConfig) {
    this.kafka = new Kafka({
      clientId: config.clientId,
      brokers: config.brokers,
      retry: {
        initialRetryTime: 300,
        retries: 8,
      },
    });

    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
      compression: CompressionTypes.GZIP,
    });

    this.topic = config.topic;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    console.log('[KAFKA] Connecting to brokers...');
    await this.producer.connect();
    this.isConnected = true;
    console.log('[KAFKA] Connected successfully');
  }

  async publishEvent(event: any): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Kafka producer not connected');
    }

    try {
      await this.producer.send({
        topic: this.topic,
        compression: CompressionTypes.GZIP,
        messages: [
          {
            key: event.repo || event.did || undefined,
            value: JSON.stringify(event),
            timestamp: Date.now().toString(),
          },
        ],
      });
    } catch (error) {
      console.error('[KAFKA] Error publishing event:', error);
      throw error;
    }
  }

  async publishBatch(events: any[]): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Kafka producer not connected');
    }

    if (events.length === 0) {
      return;
    }

    try {
      await this.producer.send({
        topic: this.topic,
        compression: CompressionTypes.GZIP,
        messages: events.map(event => ({
          key: event.repo || event.did || undefined,
          value: JSON.stringify(event),
          timestamp: Date.now().toString(),
        })),
      });
    } catch (error) {
      console.error('[KAFKA] Error publishing batch:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      console.log('[KAFKA] Disconnecting...');
      await this.producer.disconnect();
      this.isConnected = false;
      console.log('[KAFKA] Disconnected');
    }
  }

  getStatus(): { connected: boolean; topic: string } {
    return {
      connected: this.isConnected,
      topic: this.topic,
    };
  }
}
