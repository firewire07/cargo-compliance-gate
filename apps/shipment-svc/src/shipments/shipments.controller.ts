import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { ShipmentsService } from './shipments.service';

@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Body() dto: CreateShipmentDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.shipments.create(dto, correlationId);
  }

  @Get()
  list() {
    return this.shipments.list();
  }

  @Get(':awb')
  findByAwb(@Param('awb') awb: string) {
    return this.shipments.findByAwb(awb);
  }
}
