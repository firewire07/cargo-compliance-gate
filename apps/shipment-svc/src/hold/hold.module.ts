import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { HoldConsumer } from './hold.consumer';
import { HoldController } from './hold.controller';
import { HoldService } from './hold.service';
import { HoldSweeper } from './hold.sweeper';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [HoldController],
  providers: [HoldService, HoldConsumer, HoldSweeper],
  exports: [HoldService],
})
export class HoldModule {}
