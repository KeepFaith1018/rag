import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { AdminAuth } from '../decorators/admin-auth.decorator';
import { CurrentAdmin } from '../decorators/admin-user.decorator';

@Controller('auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.adminAuthService.login(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.adminAuthService.refreshToken(dto);
  }

  @Post('logout')
  @UseGuards(AdminAuthGuard)
  @AdminAuth()
  logout(@CurrentAdmin('sub') adminId: string) {
    return this.adminAuthService.logout(adminId);
  }

  @Post('me')
  @UseGuards(AdminAuthGuard)
  @AdminAuth()
  getMe(@CurrentAdmin('sub') adminId: string) {
    return this.adminAuthService.getMe(adminId);
  }
}
