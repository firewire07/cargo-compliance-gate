import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './auth.guard';
import type { AccessTokenPayload } from './jwt';

/** Plan name: POST /stream-token. Same handler as POST /auth/stream-token. */
@Controller()
export class StreamTokenAliasController {
  constructor(private readonly auth: AuthService) {}

  @Post('stream-token')
  @UseGuards(JwtAuthGuard)
  streamToken(@Req() req: Request & { user?: AccessTokenPayload }) {
    return this.auth.issueStreamToken(req.user!);
  }
}
