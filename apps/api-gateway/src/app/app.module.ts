import { Module } from '@nestjs/common';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { StreamTokenAliasController } from '../auth/stream-token.alias.controller';
import { StreamTokenStore } from '../auth/stream-token.store';
import { ProxyController } from '../proxy/proxy.controller';
import { ProxyService } from '../proxy/proxy.service';
import { StreamConsumer } from '../stream/stream.consumer';
import { StreamController } from '../stream/stream.controller';
import { StreamHub } from '../stream/stream.hub';
import { AppController } from './app.controller';

@Module({
  imports: [],
  controllers: [
    AppController,
    AuthController,
    StreamTokenAliasController,
    StreamController,
    ProxyController,
  ],
  providers: [
    AuthService,
    StreamTokenStore,
    ProxyService,
    StreamHub,
    StreamConsumer,
  ],
})
export class AppModule {}
