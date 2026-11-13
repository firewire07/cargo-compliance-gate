import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class PartyDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  country!: string;
}

export class CreateShipmentDto {
  @IsString()
  @IsNotEmpty()
  awb!: string;

  @IsString()
  @IsNotEmpty()
  origin!: string;

  @IsString()
  @IsNotEmpty()
  destination!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  pieces!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  weight!: number;

  @IsString()
  @IsNotEmpty()
  goodsDescription!: string;

  @IsOptional()
  @IsString()
  hsCode?: string;

  @IsOptional()
  @IsString()
  unNumber?: string;

  @IsString()
  @IsNotEmpty()
  routing!: string;

  @ValidateNested()
  @Type(() => PartyDto)
  shipper!: PartyDto;

  @ValidateNested()
  @Type(() => PartyDto)
  consignee!: PartyDto;
}
