import { All, Controller, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/auth.guard';
import { ProxyService } from './proxy.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class ProxyController {
  constructor(private readonly proxy: ProxyService) {}

  @All([
    'shipments',
    'shipments/*path',
    'holds',
    'holds/*path',
    'audit',
    'audit/*path',
    'screenings',
    'screenings/*path',
  ])
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.proxy.forward(req, res);
  }
}
