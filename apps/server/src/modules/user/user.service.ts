import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { FileStorageService } from '@common/storage/file-storage.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RegisterDto } from '../auth/dto/register.dto';
import * as bcrypt from 'bcrypt';
import {
  BusinessException,
  wrapBusinessException,
} from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { EmailService } from '../email/email.service';
import { VerificationPurpose } from '../auth/dto/send-verification-code.dto';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly fileStorage: FileStorageService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  // 创建用户（注册时使用）
  async create(registerDto: RegisterDto) {
    try {
      const { email, password, username } = registerDto;
      const user = await this.prisma.b_users.create({
        data: {
          email,
          password_hash: password,
          full_name: username,
        },
      });
      this.logger.info('创建用户', { userId: user.id, email: user.email });
      return user;
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'UserService',
          action: 'create',
          email: registerDto.email,
        },
      });
    }
  }

  /**
   * 统一组装对外暴露的用户信息结构，避免各接口返回字段不一致。
   */
  buildUserProfile(user: {
    id: bigint;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
  }) {
    return {
      id: user.id.toString(),
      email: user.email,
      username: user.full_name ?? user.email,
      avatar: user.avatar_url,
      roles: ['user'],
    };
  }

  // 根据邮箱查询用户
  async findByEmail(email: string) {
    return this.prisma.b_users.findUnique({
      where: { email },
    });
  }

  // 根据ID查询用户
  async findById(id: number | bigint) {
    return this.prisma.b_users.findUnique({
      where: { id: BigInt(id) },
    });
  }

  // 更新当前登录用户的个人资料
  async updateProfile(userId: number, updateUserDto: UpdateUserDto) {
    try {
      const user = await this.prisma.b_users.findUnique({
        where: { id: BigInt(userId) },
      });
      if (!user) {
        throw new BusinessException(ErrorCode.AUTH_USER_NOT_FOUND);
      }

      const updated = await this.prisma.b_users.update({
        where: { id: BigInt(userId) },
        data: {
          full_name: updateUserDto.full_name ?? user.full_name,
          avatar_url: updateUserDto.avatar_url ?? user.avatar_url,
        },
      });

      this.logger.info('更新用户资料', { userId: updated.id });

      return this.buildUserProfile(updated);
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'UserService',
          action: 'updateProfile',
          userId,
        },
      });
    }
  }

  // 修改当前登录用户的密码
  async changePassword(userId: number, changePasswordDto: ChangePasswordDto) {
    try {
      const user = await this.prisma.b_users.findUnique({
        where: { id: BigInt(userId) },
      });
      if (!user) {
        throw new BusinessException(ErrorCode.AUTH_USER_NOT_FOUND);
      }

      const isMatch = await bcrypt.compare(
        changePasswordDto.old_password,
        user.password_hash,
      );
      if (!isMatch) {
        throw new BusinessException(ErrorCode.AUTH_INVALID_CREDENTIALS);
      }

      const salt = await bcrypt.genSalt();
      const newHashedPassword = await bcrypt.hash(
        changePasswordDto.new_password,
        salt,
      );

      await this.prisma.b_users.update({
        where: { id: BigInt(userId) },
        data: {
          password_hash: newHashedPassword,
        },
      });

      this.logger.info('用户修改密码', { userId });

      return {
        message: '密码修改成功',
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'UserService',
          action: 'changePassword',
          userId,
        },
      });
    }
  }

  // 通过邮箱验证码重置密码
  async resetPassword(dto: ResetPasswordDto) {
    try {
      await this.emailService.verifyCode(
        dto.email,
        dto.code,
        VerificationPurpose.RESET_PASSWORD,
      );

      const user = await this.prisma.b_users.findUnique({
        where: { email: dto.email },
      });
      if (!user) {
        throw new BusinessException(ErrorCode.AUTH_USER_NOT_FOUND);
      }

      const salt = await bcrypt.genSalt();
      const newHashedPassword = await bcrypt.hash(dto.new_password, salt);

      await this.prisma.b_users.update({
        where: { id: user.id },
        data: {
          password_hash: newHashedPassword,
        },
      });

      this.logger.info('用户重置密码', { userId: user.id, email: user.email });

      return {
        message: '密码重置成功',
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'UserService',
          action: 'resetPassword',
          email: dto.email,
        },
      });
    }
  }

  /**
   * 上传并更新用户头像，将文件存储到 avatars 目录并更新 avatar_url。
   */
  async updateAvatar(
    userId: number,
    file: { buffer: Buffer; originalname: string },
  ) {
    try {
      const user = await this.prisma.b_users.findUnique({
        where: { id: BigInt(userId) },
      });
      if (!user) {
        throw new BusinessException(ErrorCode.AUTH_USER_NOT_FOUND);
      }

      const ext = this.extractExtension(file.originalname);
      const relativePath = `avatars/${userId}${ext}`;

      // 如果旧头像存在则删除
      if (user.avatar_url) {
        await this.fileStorage.deleteFile(user.avatar_url);
      }

      await this.fileStorage.saveFile(file.buffer, relativePath);

      const updated = await this.prisma.b_users.update({
        where: { id: BigInt(userId) },
        data: { avatar_url: relativePath },
      });

      this.logger.info('用户更新头像', { userId, path: relativePath });

      return this.buildUserProfile(updated);
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'UserService',
          action: 'updateAvatar',
          userId,
        },
      });
    }
  }

  /**
   * 根据用户 ID 获取头像文件的绝对路径，不存在则返回 null。
   */
  async getAvatarPath(userId: number): Promise<string | null> {
    const user = await this.findById(userId);
    if (!user?.avatar_url) return null;
    const absolute = this.fileStorage.resolveAbsolutePath(user.avatar_url);
    if (this.fileStorage.exists(user.avatar_url)) return absolute;
    return null;
  }

  private extractExtension(filename: string): string {
    const dot = filename.lastIndexOf('.');
    return dot > 0 ? filename.slice(dot) : '';
  }
}
