import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { validateGatewayEnv } from '../config/env';
import { ProxyModule } from '../proxy/proxy.module';
import { StreamModule } from '../stream/stream.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
      validate: validateGatewayEnv,
    }),
    AuthModule,
    ProxyModule,
    StreamModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule {}
