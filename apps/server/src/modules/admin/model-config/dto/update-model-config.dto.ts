import { IsString, MaxLength, IsOptional, IsBoolean, IsObject, IsIn } from 'class-validator';

export class UpdateModelConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['chat', 'embedding'])
  type?: 'chat' | 'embedding';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @IsOptional()
  @IsObject()
  configJson?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
