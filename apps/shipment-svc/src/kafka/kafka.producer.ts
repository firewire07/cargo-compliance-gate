import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Kafka, logLevel, Producer, ProducerRecord } from 'kafkajs';

@Injectable()
export class KafkaProducer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducer.name);
  private producer!: Producer;

  async onModuleInit(): Promise<void> {
    const brokers = (process.env.KAFKA_BROKERS ?? '127.0.0.1:9094')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
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
