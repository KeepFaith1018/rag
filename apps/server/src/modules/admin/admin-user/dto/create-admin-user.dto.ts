import { IsString, IsNotEmpty, MaxLength, MinLength, IsIn } from 'class-validator';

export class CreateAdminUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username: string;

  @IsString()
  @MinLength(6)
  @MaxLength(50)
  password: string;

  @IsString()
  @IsIn(['super_admin', 'operator'])
  role: 'super_admin' | 'operator';
}
