import { IsString, MaxLength, IsOptional, IsInt, IsBoolean } from 'class-validator';

export class UpdateDictItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsInt()
  sort?: number;

  @IsOptional()
  @IsBoolean()
  status?: boolean;
}
