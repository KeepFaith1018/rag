import { IsString, IsNotEmpty, MaxLength, IsInt, IsOptional, IsBoolean } from 'class-validator';

export class CreateDictItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  typeCode: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  value: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label: string;

  @IsOptional()
  @IsInt()
  sort?: number;

  @IsOptional()
  @IsBoolean()
  status?: boolean;
}
