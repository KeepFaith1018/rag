import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/currentUser.decorator';
import { Auth } from '../../common/decorators/auth.decorator';
import { ResetPasswordDto } from './dto/reset-password.dto';

type UploadedAvatarFile = {
  buffer: Buffer;
  originalname: string;
};

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

  // 上传/更新当前用户头像
  @Post('me/avatar')
  @UseGuards(AuthGuard)
  @Auth()
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @CurrentUser('sub') userId: string,
    @UploadedFile() file: UploadedAvatarFile | undefined,
  ): Promise<any> {
    if (!file) {
      return { success: false, message: '未上传文件' };
    }
    return this.userService.updateAvatar(Number(userId), file);
  }

  // 获取用户头像（公开访问）
  @Get('avatar/:userId')
  async getAvatar(
    @Param('userId') userId: string,
    @Res() res: Response,
  ) {
    const avatarPath = await this.userService.getAvatarPath(Number(userId));
    if (!avatarPath) {
      res.status(404).send();
      return;
    }
    res.sendFile(avatarPath);
  }
}
