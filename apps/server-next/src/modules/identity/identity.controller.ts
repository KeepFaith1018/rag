import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Post,
} from '@nestjs/common';
import type { Principal } from './contracts/principal';
import {
  ChangePasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
  SendVerificationCodeDto,
} from './dto/identity.dto';
import { CurrentPrincipal } from './http/current-principal.decorator';
import { Public } from './http/public.decorator';
import { AuthenticationService } from './services/authentication.service';
import { PasswordService } from './services/password.service';
import { VerificationService } from './services/verification.service';

/** 身份认证、当前用户身份与密码操作的 HTTP 入口。 */
@Controller()
export class IdentityController {
  constructor(
    private readonly authentication: AuthenticationService,
    private readonly verification: VerificationService,
    private readonly passwords: PasswordService,
  ) {}

  @Public()
  @Post('auth/send-code')
  @HttpCode(200)
  sendCode(@Body() dto: SendVerificationCodeDto, @Ip() ip: string) {
    return this.verification.send(dto.email, dto.purpose, ip);
  }

  @Public()
  @Post('auth/register')
  register(@Body() dto: RegisterDto) {
    return this.authentication.register(dto);
  }

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authentication.login(dto.email, dto.password, ip, userAgent);
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  refresh(
    @Body() dto: RefreshTokenDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authentication.refresh(dto.refreshToken, userAgent);
  }

  @Post('auth/logout')
  @HttpCode(200)
  logout(@CurrentPrincipal() principal: Principal) {
    return this.authentication.logout(principal);
  }

  @Get('auth/me')
  me(@CurrentPrincipal() principal: Principal) {
    return this.authentication.me(principal.userId);
  }

  @Post('users/me/password')
  @HttpCode(200)
  changePassword(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.passwords.change(
      BigInt(principal.userId),
      dto.old_password,
      dto.new_password,
    );
  }

  @Public()
  @Post('users/reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.passwords.reset(dto.email, dto.code, dto.new_password);
  }
}
