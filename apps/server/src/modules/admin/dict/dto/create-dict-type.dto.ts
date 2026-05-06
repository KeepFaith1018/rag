import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';

export class CreateDictTypeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string;
}
