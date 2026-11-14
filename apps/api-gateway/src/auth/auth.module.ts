import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './auth.guard';
import { StreamTokenAliasController } from './stream-token.alias.controller';
import { StreamTokenStore } from './stream-token.store';

@Module({
  controllers: [AuthController, StreamTokenAliasController],
  providers: [AuthService, StreamTokenStore, JwtAuthGuard],
  exports: [AuthService, StreamTokenStore, JwtAuthGuard],
})
export class AuthModule {}
