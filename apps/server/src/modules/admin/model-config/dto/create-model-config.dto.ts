import { IsString, IsNotEmpty, MaxLength, IsOptional, IsBoolean, IsObject, IsIn } from 'class-validator';

export class CreateModelConfigDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  provider: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsIn(['chat', 'embedding'])
  type: 'chat' | 'embedding';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  baseUrl?: string;

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
