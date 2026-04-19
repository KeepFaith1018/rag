import { Body, Controller, Patch, Post, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/currentUser.decorator';
import { Auth } from '../../common/decorators/auth.decorator';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // 更新当前登录用户的个人信息
  @Patch('me')
  @UseGuards(AuthGuard)
  @Auth()
  async updateProfile(
    @CurrentUser('sub') userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<any> {
    return this.userService.updateProfile(Number(userId), updateUserDto);
  }

  // 修改当前登录用户的密码
  @Post('me/password')
  @UseGuards(AuthGuard)
  @Auth()
  async changePassword(
    @CurrentUser('sub') userId: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ): Promise<any> {
    return this.userService.changePassword(Number(userId), changePasswordDto);
  }

  // 通过邮箱验证码重置密码（无需登录）
  @Post('reset-password')
  async resetPassword(
    @Body() resetPasswordDto: ResetPasswordDto,
  ): Promise<any> {
    return this.userService.resetPassword(resetPasswordDto);
  }
}
