import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';

export enum VerificationPurpose {
  REGISTER = 1,
  RESET_PASSWORD = 2,
  LOGIN = 3,
}

export class SendVerificationCodeDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsEnum(VerificationPurpose)
  @IsNotEmpty()
  purpose: VerificationPurpose;
}
