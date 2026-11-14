import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, EachMessagePayload, Kafka, logLevel } from 'kafkajs';
import {
  CORRELATION_ID_HEADER,
  SCREENING_EVENTS_TOPIC,
  decodeKafkaHeaders,
} from '@cargo-compliance-gate/contracts';
import { kafkaBrokers, type ShipmentEnv } from '../config/env';
import { HoldService } from './hold.service';

export const HOLD_CONSUMER_GROUP = 'shipment-svc-hold';

@Injectable()
export class HoldConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HoldConsumer.name);
  private consumer!: Consumer;

  constructor(
    private readonly holds: HoldService,
    private readonly config: ConfigService<ShipmentEnv, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    const brokers = kafkaBrokers(this.config.get('KAFKA_BROKERS', { infer: true }));
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
      const headers = decodeKafkaHeaders(message.headers);
      await this.holds.handleMessage(raw, headers[CORRELATION_ID_HEADER]);
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
