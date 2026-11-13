import { Controller, Get } from '@nestjs/common';
import { HoldService } from './hold.service';

@Controller('holds')
export class HoldController {
  constructor(private readonly holds: HoldService) {}

  @Get()
  list() {
    return this.holds.listHolds();
  }
}
