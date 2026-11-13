import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('verify')
  verify() {
    return this.audit.verify();
  }

  @Get(':awb')
  async listByAwb(@Param('awb') awb: string) {
    const entries = await this.audit.listByAwb(awb);
    if (entries.length === 0) {
      throw new NotFoundException(`No audit entries for ${awb}`);
    }
    return entries;
  }
}
