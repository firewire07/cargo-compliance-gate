import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { requireAnalyst } from '../auth/actor';
import { RejectReleaseDto, UpdateChecklistDto } from './dto/update-checklist.dto';
import { HoldService } from './hold.service';

@Controller('holds')
export class HoldController {
  constructor(private readonly holds: HoldService) {}

  @Get()
  list() {
    return this.holds.listHolds();
  }

  @Get(':awb')
  get(@Param('awb') awb: string) {
    return this.holds.getHold(awb);
  }

  @Patch(':awb/checklist')
  updateChecklist(
    @Param('awb') awb: string,
    @Body() dto: UpdateChecklistDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-roles') roles?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const actor = requireAnalyst(userId, roles);
    return this.holds.updateChecklist(awb, dto.items, actor, correlationId);
  }

  @Post(':awb/release-requests')
  requestRelease(
    @Param('awb') awb: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-roles') roles?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const actor = requireAnalyst(userId, roles);
    return this.holds.requestRelease(awb, actor, correlationId);
  }

  @Post(':awb/release-approvals')
  approveRelease(
    @Param('awb') awb: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-roles') roles?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const actor = requireAnalyst(userId, roles);
    return this.holds.approveRelease(awb, actor, correlationId);
  }

  @Post(':awb/release-rejections')
  rejectRelease(
    @Param('awb') awb: string,
    @Body() dto: RejectReleaseDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-roles') roles?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const actor = requireAnalyst(userId, roles);
    return this.holds.rejectRelease(awb, actor, dto?.reason, correlationId);
  }
}
