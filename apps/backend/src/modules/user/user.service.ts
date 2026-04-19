import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RegisterDto } from '../auth/dto/register.dto';
import * as bcrypt from 'bcrypt';
import { BusinessException } from '@common/exception/businessException';
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
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  // 创建用户（注册时使用）
  async create(registerDto: RegisterDto) {
    const { email, password, username } = registerDto;
    const user = await this.prisma.sys_users.create({
      data: {
        email,
        password_hash: password,
        full_name: username,
      },
    });
    this.logger.info('创建用户', { userId: user.id, email: user.email });
    return user;
  }

  // 根据邮箱查询用户
  async findByEmail(email: string) {
    return this.prisma.sys_users.findUnique({
      where: { email },
    });
  }

  // 根据ID查询用户
  async findById(id: number | bigint) {
    return this.prisma.sys_users.findUnique({
      where: { id: BigInt(id) },
    });
  }

  // 更新当前登录用户的个人资料
  async updateProfile(userId: number, updateUserDto: UpdateUserDto) {
    const user = await this.prisma.sys_users.findUnique({
      where: { id: BigInt(userId) },
    });
    if (!user) {
      throw new BusinessException(ErrorCode.AUTH_USER_NOT_FOUND);
    }

    const updated = await this.prisma.sys_users.update({
      where: { id: BigInt(userId) },
      data: {
        full_name: updateUserDto.full_name ?? user.full_name,
        avatar_url: updateUserDto.avatar_url ?? user.avatar_url,
      },
    });

    this.logger.info('更新用户资料', { userId: updated.id });

    return {
      id: updated.id.toString(),
      email: updated.email,
      full_name: updated.full_name,
      avatar_url: updated.avatar_url,
    };
  }

  // 修改当前登录用户的密码
  async changePassword(userId: number, changePasswordDto: ChangePasswordDto) {
    const user = await this.prisma.sys_users.findUnique({
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

    await this.prisma.sys_users.update({
      where: { id: BigInt(userId) },
      data: {
        password_hash: newHashedPassword,
      },
    });

    this.logger.info('用户修改密码', { userId });

    return {
      message: '密码修改成功',
    };
  }

  // 通过邮箱验证码重置密码
  async resetPassword(dto: ResetPasswordDto) {
    await this.emailService.verifyCode(
      dto.email,
      dto.code,
      VerificationPurpose.RESET_PASSWORD,
    );

    const user = await this.prisma.sys_users.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      throw new BusinessException(ErrorCode.AUTH_USER_NOT_FOUND);
    }

    const salt = await bcrypt.genSalt();
    const newHashedPassword = await bcrypt.hash(dto.new_password, salt);

    await this.prisma.sys_users.update({
      where: { id: user.id },
      data: {
        password_hash: newHashedPassword,
      },
    });

    this.logger.info('用户重置密码', { userId: user.id, email: user.email });

    return {
      message: '密码重置成功',
    };
  }
}
