import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, EachMessagePayload, Kafka, logLevel } from 'kafkajs';
import { HOLD_EVENTS_TOPIC, SHIPMENT_EVENTS_TOPIC } from '@cargo-compliance-gate/contracts';
import { kafkaBrokers, type GatewayEnv } from '../config/env';
import { StreamHub, type StatusEvent } from './stream.hub';

export const GATEWAY_SSE_GROUP = 'api-gateway-sse';
const TOPICS = [HOLD_EVENTS_TOPIC, SHIPMENT_EVENTS_TOPIC];

@Injectable()
export class StreamConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StreamConsumer.name);
  private consumer?: Consumer;

  constructor(
    private readonly hub: StreamHub,
    private readonly config: ConfigService<GatewayEnv, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    const brokers = kafkaBrokers(this.config.get('KAFKA_BROKERS', { infer: true }));
    const kafka = new Kafka({
      clientId: 'api-gateway-sse',
      brokers,
      logLevel: logLevel.WARN,
    });
    this.consumer = kafka.consumer({ groupId: GATEWAY_SSE_GROUP });
    await this.consumer.connect();
    for (const topic of TOPICS) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
    }
    await this.consumer.run({
      autoCommit: true,
      eachMessage: async (payload) => this.onMessage(payload),
    });
    this.logger.log(
      `Consuming ${TOPICS.join(', ')} as group ${GATEWAY_SSE_GROUP}`,
    );
  }

  private onMessage({ message }: EachMessagePayload): void {
    const raw = message.value?.toString();
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<StatusEvent>;
      if (!parsed?.id || !parsed?.type || !parsed?.awb) {
        return;
      }
      this.hub.publish({
        id: parsed.id,
        type: parsed.type,
        awb: parsed.awb,
        shipmentVersion: parsed.shipmentVersion,
        occurredAt: parsed.occurredAt,
        correlationId: parsed.correlationId,
        payload: parsed.payload,
      });
    } catch {
      this.logger.warn('Ignoring malformed Kafka event on the SSE consumer');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
    }
  }
}
