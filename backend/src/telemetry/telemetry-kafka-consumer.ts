/**
 * TelemetryKafkaConsumer — consumes from the `telemetry.raw` Kafka topic
 * and feeds messages into TelemetryIngestService.
 *
 * Message format: JSON payload matching TelemetryPayloadSchema,
 * with the userId carried in the Kafka message key.
 */
import { Kafka, type Consumer, type EachMessagePayload } from 'kafkajs';
import type { TelemetryIngestService } from './telemetry-ingest-service.js';
import type { Logger } from 'pino';

export interface KafkaConsumerConfig {
  readonly brokers: string[];
  readonly topicName: string;
  readonly groupId: string;
}

export class TelemetryKafkaConsumer {
  private consumer: Consumer;
  private running = false;

  constructor(
    private readonly config: KafkaConsumerConfig,
    private readonly ingestService: TelemetryIngestService,
    private readonly logger: Logger,
  ) {
    const kafka = new Kafka({ brokers: config.brokers });
    this.consumer = kafka.consumer({ groupId: config.groupId });
  }

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: this.config.topicName,
      fromBeginning: false,
    });

    this.running = true;
    this.logger.info({ topic: this.config.topicName }, 'Kafka consumer started');

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        await this.handleMessage(payload);
      },
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.consumer.disconnect();
    this.logger.info('Kafka consumer stopped');
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async handleMessage({ topic, partition, message }: EachMessagePayload): Promise<void> {
    // userId is carried in the message key (set by the mobile client's HTTP handler)
    const userId = message.key?.toString();
    if (!userId) {
      this.logger.warn({ topic, partition }, 'Received telemetry message without userId key — skipping');
      return;
    }

    const rawValue = message.value?.toString();
    if (!rawValue) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      this.logger.warn({ topic, partition, offset: message.offset }, 'Failed to parse Kafka message as JSON');
      return;
    }

    // Handle both single point and batch array
    const rawPoints = Array.isArray(parsed) ? parsed : [parsed];

    const result = await this.ingestService.ingestBatch(userId, rawPoints);

    if (result.status === 'ok') {
      this.logger.debug(
        { userId, points: result.pointCount, clusters: result.clustersRefreshed },
        'Telemetry batch ingested',
      );
    } else {
      this.logger.warn({ result, userId }, 'Telemetry ingest non-ok result');
    }
  }
}
