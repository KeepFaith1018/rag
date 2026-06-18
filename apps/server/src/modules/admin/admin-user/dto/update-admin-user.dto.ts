import { IsString, MaxLength, MinLength, IsOptional, IsBoolean, IsIn } from 'class-validator';

export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(50)
  password?: string;

  @IsOptional()
  @IsString()
  @IsIn(['super_admin', 'operator'])
  role?: 'super_admin' | 'operator';

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
