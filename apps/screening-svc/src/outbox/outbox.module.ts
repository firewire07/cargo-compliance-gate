import { Module } from '@nestjs/common';
import { KafkaModule } from '../kafka/kafka.module';
import { PrismaModule } from '../prisma/prisma.module';
import { OutboxRelay } from './outbox.relay';

@Module({
  imports: [PrismaModule, KafkaModule],
  providers: [OutboxRelay],
})
export class OutboxModule {}
