import { Module } from '@nestjs/common';
import { HoldConsumer } from '../hold/hold.consumer';
import { HoldController } from '../hold/hold.controller';
import { HoldService } from '../hold/hold.service';
import { HoldSweeper } from '../hold/hold.sweeper';
import { KafkaProducer } from '../kafka/kafka.producer';
import { OutboxRelay } from '../outbox/outbox.relay';
import { PrismaService } from '../prisma/prisma.service';
import { ShipmentsController } from '../shipments/shipments.controller';
import { ShipmentsService } from '../shipments/shipments.service';

@Module({
  imports: [],
  controllers: [ShipmentsController, HoldController],
  providers: [
    PrismaService,
    ShipmentsService,
    HoldService,
    HoldConsumer,
    HoldSweeper,
    KafkaProducer,
    OutboxRelay,
  ],
})
export class AppModule {}
