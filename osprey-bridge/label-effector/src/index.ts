import 'dotenv/config';
import { LabelConsumer } from './kafka-consumer';
import { LabelApplier } from './label-applier';
import { HealthServer, type HealthStatus } from './health';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'kafka:9092').split(',');
const KAFKA_LABEL_TOPIC = process.env.KAFKA_LABEL_TOPIC || 'osprey.labels';
const KAFKA_CONSUMER_GROUP = process.env.KAFKA_CONSUMER_GROUP || 'label-effector';
const DATABASE_URL = process.env.DATABASE_URL || '';
const OSPREY_LABELER_DID = process.env.OSPREY_LABELER_DID || 'did:plc:osprey-moderation';
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3002', 10);

const startTime = Date.now();

async function main() {
  console.log('='.repeat(60));
  console.log('Osprey Label Effector');
  console.log('='.repeat(60));
  console.log(`Kafka Brokers: ${KAFKA_BROKERS.join(', ')}`);
  console.log(`Kafka Topic: ${KAFKA_LABEL_TOPIC}`);
  console.log(`Consumer Group: ${KAFKA_CONSUMER_GROUP}`);
  console.log(`Database: ${DATABASE_URL.split('@')[1] || 'local'}`);
  console.log(`Osprey Labeler DID: ${OSPREY_LABELER_DID}`);
  console.log(`Health Port: ${HEALTH_PORT}`);
  console.log('='.repeat(60));

  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  // Initialize label applier
  const labelApplier = new LabelApplier(DATABASE_URL, OSPREY_LABELER_DID);
  await labelApplier.connect();

  // Initialize Kafka consumer
  const consumer = new LabelConsumer(
    KAFKA_BROKERS,
    KAFKA_LABEL_TOPIC,
    KAFKA_CONSUMER_GROUP,
    async (label) => {
      await labelApplier.applyLabel(label);
    }
  );

  await consumer.connect();

  // Start health server
  const healthServer = new HealthServer(HEALTH_PORT, (): HealthStatus => {
    const kafkaMetrics = consumer.getMetrics();
    const labelMetrics = labelApplier.getMetrics();
    const uptime = Math.floor((Date.now() - startTime) / 1000);

    const dbHealthy = labelApplier.isHealthy();
    const isHealthy = kafkaMetrics.connected && dbHealthy;

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      kafka: kafkaMetrics,
      database: {
        connected: dbHealthy,
      },
      labels: labelMetrics,
      uptime,
      timestamp: new Date().toISOString(),
    };
  });

  healthServer.start();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[SHUTDOWN] Received ${signal}, shutting down gracefully...`);
    
    healthServer.stop();
    await consumer.disconnect();
    await labelApplier.disconnect();
    
    console.log('[SHUTDOWN] Cleanup complete, exiting');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start consuming labels
  console.log('\n[MAIN] Starting label consumer...\n');
  await consumer.start();
}

main().catch((error) => {
  console.error('[FATAL] Unhandled error:', error);
  process.exit(1);
});
