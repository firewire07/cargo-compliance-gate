import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, logLevel, Producer, ProducerRecord } from 'kafkajs';
import { kafkaBrokers, type ShipmentEnv } from '../config/env';

@Injectable()
export class KafkaProducer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducer.name);
  private producer!: Producer;

  constructor(private readonly config: ConfigService<ShipmentEnv, true>) {}

  async onModuleInit(): Promise<void> {
    const brokers = kafkaBrokers(this.config.get('KAFKA_BROKERS', { infer: true }));
    const kafka = new Kafka({
      clientId: 'shipment-svc',
      brokers,
      logLevel: logLevel.WARN,
    });
    this.producer = kafka.producer();
    await this.producer.connect();
    this.logger.log(`Kafka producer connected (${brokers.join(', ')})`);
  }

  async send(record: ProducerRecord): Promise<void> {
    await this.producer.send(record);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
    }
  }
}
