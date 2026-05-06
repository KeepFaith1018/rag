import { IsString, MaxLength, IsOptional } from 'class-validator';

export class UpdateDictTypeDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string;
}
