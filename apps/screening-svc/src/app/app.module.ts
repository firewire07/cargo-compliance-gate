import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { validateScreeningEnv } from '../config/env';
import { OutboxModule } from '../outbox/outbox.module';
import { ScreeningModule } from '../screening/screening.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
      validate: validateScreeningEnv,
    }),
    ScreeningModule,
    OutboxModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule {}
