import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './auth.guard';
import { authCookieHeader } from './cookies';
import { LoginDto } from './dto/login.dto';
import type { AccessTokenPayload } from './jwt';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = this.auth.login(dto.username, dto.password);
    res.setHeader('Set-Cookie', authCookieHeader(result.accessToken, result.expiresIn));
    return result;
  }

  @Post('stream-token')
  @UseGuards(JwtAuthGuard)
  streamToken(@Req() req: Request & { user?: AccessTokenPayload }) {
    return this.auth.issueStreamToken(req.user!);
  }
}
