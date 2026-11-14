import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { validateShipmentEnv } from '../config/env';
import { HoldModule } from '../hold/hold.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ShipmentsModule } from '../shipments/shipments.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
      validate: validateShipmentEnv,
    }),
    ShipmentsModule,
    HoldModule,
    AuditModule,
    OutboxModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule {}
