import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ChecklistItemUpdateDto {
  @IsString()
  id!: string;

  @IsBoolean()
  done!: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateChecklistDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemUpdateDto)
  items!: ChecklistItemUpdateDto[];
}

export class RejectReleaseDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
