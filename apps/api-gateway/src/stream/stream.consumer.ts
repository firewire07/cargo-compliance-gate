import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Consumer, EachMessagePayload, Kafka, logLevel } from 'kafkajs';
import { StreamHub, type StatusEvent } from './stream.hub';

export const GATEWAY_SSE_GROUP = 'api-gateway-sse';
const TOPICS = ['hold.events', 'shipment.events'];

@Injectable()
export class StreamConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StreamConsumer.name);
  private consumer?: Consumer;

  constructor(private readonly hub: StreamHub) {}

  async onModuleInit(): Promise<void> {
    const brokers = (process.env.KAFKA_BROKERS ?? '127.0.0.1:9094')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
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
