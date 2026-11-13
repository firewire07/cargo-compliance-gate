import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('screenings')
export class ScreeningController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':awb')
  async findByAwb(@Param('awb') awb: string) {
    const results = await this.prisma.screeningResult.findMany({
      where: { awb },
      orderBy: [{ shipmentVersion: 'asc' }, { check: 'asc' }],
    });
    if (results.length === 0) {
      throw new NotFoundException(`No screening results for ${awb}`);
    }
    return results;
  }
}
