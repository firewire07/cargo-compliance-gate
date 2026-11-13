import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Consumer, EachMessagePayload, Kafka, logLevel } from 'kafkajs';
import { SCREENING_EVENTS_TOPIC } from '../events/envelope';
import { HoldService } from './hold.service';

export const HOLD_CONSUMER_GROUP = 'shipment-svc-hold';

@Injectable()
export class HoldConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HoldConsumer.name);
  private consumer!: Consumer;

  constructor(private readonly holds: HoldService) {}

  async onModuleInit(): Promise<void> {
    const brokers = (process.env.KAFKA_BROKERS ?? '127.0.0.1:9094')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    const kafka = new Kafka({
      clientId: 'shipment-svc-hold',
      brokers,
      logLevel: logLevel.WARN,
    });
    this.consumer = kafka.consumer({ groupId: HOLD_CONSUMER_GROUP });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: SCREENING_EVENTS_TOPIC,
      fromBeginning: false,
    });
    await this.consumer.run({
      autoCommit: false,
      eachMessage: async (payload) => this.onMessage(payload),
    });
    this.logger.log(
      `Consuming ${SCREENING_EVENTS_TOPIC} as group ${HOLD_CONSUMER_GROUP}`,
    );
  }

  private async onMessage({
    topic,
    partition,
    message,
  }: EachMessagePayload): Promise<void> {
    const raw = message.value?.toString();
    if (raw) {
      await this.holds.handleMessage(raw);
    }
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
