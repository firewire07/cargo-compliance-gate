import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StreamConsumer } from './stream.consumer';
import { StreamController } from './stream.controller';
import { StreamHub } from './stream.hub';

@Module({
  imports: [AuthModule],
  controllers: [StreamController],
  providers: [StreamHub, StreamConsumer],
})
export class StreamModule {}
