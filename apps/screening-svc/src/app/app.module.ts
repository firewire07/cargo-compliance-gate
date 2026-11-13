import { Module } from '@nestjs/common';
import { KafkaConsumer } from '../kafka/kafka.consumer';
import { KafkaProducer } from '../kafka/kafka.producer';
import { OutboxRelay } from '../outbox/outbox.relay';
import { PrismaService } from '../prisma/prisma.service';
import { ScreeningController } from '../screening/screening.controller';
import { ScreeningHandler } from '../screening/screening.handler';

@Module({
  imports: [],
  controllers: [ScreeningController],
  providers: [
    PrismaService,
    ScreeningHandler,
    KafkaProducer,
    KafkaConsumer,
    OutboxRelay,
  ],
})
export class AppModule {}
