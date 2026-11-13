import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { StreamHub } from './stream.hub';

@Controller()
export class StreamController {
  constructor(
    private readonly auth: AuthService,
    private readonly hub: StreamHub,
  ) {}

  @Get('stream')
  stream(
    @Query('token') token: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    const user = this.auth.authenticateStream(token, req.headers.cookie);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(
      `event: ready\ndata: ${JSON.stringify({ userId: user.sub, roles: user.roles })}\n\n`,
    );

    const id = this.hub.subscribe((event) => {
      res.write(`id: ${event.id}\n`);
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);
    const close = () => {
      clearInterval(heartbeat);
      this.hub.unsubscribe(id);
    };
    req.on('close', close);
    res.on('close', close);
  }
}
