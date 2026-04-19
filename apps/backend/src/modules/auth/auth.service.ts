import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { UserService } from '../user/user.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { EmailService } from '../email/email.service';
import {
  SendVerificationCodeDto,
  VerificationPurpose,
} from './dto/send-verification-code.dto';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { PrismaService } from '@common/prisma/prisma.service';
import { JwtUser } from './interface/jwtUser';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private emailService: EmailService,
    private prisma: PrismaService,
  ) {}

  async sendVerificationCode(dto: SendVerificationCodeDto) {
    // 如果是注册，校验用户是否已存在
    if (dto.purpose === VerificationPurpose.REGISTER) {
      const existingUser = await this.userService.findByEmail(dto.email);
      if (existingUser) {
        throw new BusinessException(ErrorCode.AUTH_USER_EXISTS);
      }
      // 如果是重置密码或登录，校验用户是否存在
    } else if (
      dto.purpose === VerificationPurpose.RESET_PASSWORD ||
      dto.purpose === VerificationPurpose.LOGIN
    ) {
      const existingUser = await this.userService.findByEmail(dto.email);
      if (!existingUser) {
        throw new BusinessException(ErrorCode.AUTH_USER_NOT_FOUND);
      }
    }
    await this.emailService.sendVerificationCode(dto.email, dto.purpose);
    return { message: 'Verification code sent' };
  }

  async register(registerDto: RegisterDto) {
    // 校验验证码
    await this.emailService.verifyCode(
      registerDto.email,
      registerDto.code,
      VerificationPurpose.REGISTER,
    );

    const existingUser = await this.userService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new BusinessException(ErrorCode.AUTH_USER_EXISTS);
    }

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(registerDto.password, salt);

    await this.userService.create({
      ...registerDto,
      password: hashedPassword,
    });

    return { message: 'Register success' };
  }

  async login(loginDto: LoginDto) {
    const user = await this.userService.findByEmail(loginDto.email);
    if (!user) {
      throw new BusinessException(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    const isMatch = await bcrypt.compare(loginDto.password, user.password_hash);
    if (!isMatch) {
      throw new BusinessException(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }
    const payload = {
      sub: user.id.toString(),
      email: user.email,
      username: user.full_name ?? user.email,
      isAdmin: false,
    };
    const accessToken = await this.jwtService.signAsync(payload); // Default 30m from module config
    const refreshToken = await this.jwtService.signAsync(payload, {
      expiresIn: '7d',
    });
    const refreshTokenHash = this.hashToken(refreshToken);
    const sessionId = this.generateSessionId();
    const now = new Date();

    await this.prisma.b_user_sessions.create({
      data: {
        session_id: sessionId,
        user_id: user.id,
        refresh_token_hash: refreshTokenHash,
        user_agent: null,
        revoked: false,
        expired_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      user: this.userService.buildUserProfile(user),
    };
  }

  async refreshToken(refreshTokenDto: RefreshTokenDto) {
    const hash = this.hashToken(refreshTokenDto.refreshToken);
    const now = new Date();

    const session = await this.prisma.b_user_sessions.findFirst({
      where: {
        refresh_token_hash: hash,
        revoked: false,
        expired_at: { gt: now },
      },
    });

    if (!session) {
      throw new BusinessException(ErrorCode.AUTH_INVALID_REFRESH_TOKEN);
    }

    try {
      const payload: JwtUser = await this.jwtService.verifyAsync(
        refreshTokenDto.refreshToken,
      );

      const user = await this.userService.findById(session.user_id);
      if (!user || user.id.toString() !== String(payload.sub)) {
        throw new BusinessException(ErrorCode.AUTH_USER_NOT_FOUND);
      }

      const newPayload = {
        sub: user.id.toString(),
        email: user.email,
        username: user.full_name ?? user.email,
        isAdmin: false,
      };

      const accessToken = await this.jwtService.signAsync(newPayload);

      return {
        accessToken,
      };
    } catch (e) {
      throw new BusinessException(ErrorCode.AUTH_INVALID_REFRESH_TOKEN);
    }
  }

  // 将token加密为16进制64位字符串
  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private generateSessionId() {
    return randomBytes(18).toString('hex').slice(0, 36);
  }

  async me(userId: number) {
    const user = await this.userService.findById(userId);
    if (!user) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED);
    }
    return this.userService.buildUserProfile(user);
  }
}
