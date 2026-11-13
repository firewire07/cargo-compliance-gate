import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Consumer, EachMessagePayload, Kafka, logLevel } from 'kafkajs';
import { ScreeningHandler } from '../screening/screening.handler';

export const SHIPMENT_EVENTS_TOPIC = 'shipment.events';
export const SCREENING_CONSUMER_GROUP = 'screening-svc';

@Injectable()
export class KafkaConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumer.name);
  private consumer!: Consumer;

  constructor(private readonly handler: ScreeningHandler) {}

  async onModuleInit(): Promise<void> {
    const brokers = (process.env.KAFKA_BROKERS ?? '127.0.0.1:9094')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    const kafka = new Kafka({
      clientId: 'screening-svc-consumer',
      brokers,
      logLevel: logLevel.WARN,
    });
    this.consumer = kafka.consumer({ groupId: SCREENING_CONSUMER_GROUP });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: SHIPMENT_EVENTS_TOPIC,
      fromBeginning: false,
    });
    await this.consumer.run({
      autoCommit: false,
      eachMessage: async (payload) => this.onMessage(payload),
    });
    this.logger.log(
      `Consuming ${SHIPMENT_EVENTS_TOPIC} as group ${SCREENING_CONSUMER_GROUP}`,
    );
  }

  private async onMessage({
    topic,
    partition,
    message,
  }: EachMessagePayload): Promise<void> {
    const raw = message.value?.toString();
    if (raw) {
      const headers: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(message.headers ?? {})) {
        headers[key] = Buffer.isBuffer(value)
          ? value.toString()
          : Array.isArray(value)
            ? value[0]?.toString()
            : value?.toString();
      }
      await this.handler.handleMessage(raw, headers);
    }
    // Commit only after the handler (and its DB transaction) succeeds.
    await this.consumer.commitOffsets([
      {
        topic,
        partition,
        offset: (Number(message.offset) + 1).toString(),
      },
    ]);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
    }
  }
}
