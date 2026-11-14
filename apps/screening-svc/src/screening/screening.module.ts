import { Module } from '@nestjs/common';
import { KafkaConsumer } from '../kafka/kafka.consumer';
import { PrismaModule } from '../prisma/prisma.module';
import { ScreeningController } from './screening.controller';
import { ScreeningHandler } from './screening.handler';

@Module({
  imports: [PrismaModule],
  controllers: [ScreeningController],
  providers: [ScreeningHandler, KafkaConsumer],
  exports: [ScreeningHandler],
})
export class ScreeningModule {}
