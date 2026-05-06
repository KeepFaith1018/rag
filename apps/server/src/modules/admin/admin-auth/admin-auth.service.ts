import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '@common/prisma/prisma.service';
import { BusinessException, wrapBusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { AdminJwtUser } from '../interfaces/admin-jwt-user.interface';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    try {
      const admin = await this.prisma.sys_admins.findUnique({
        where: { username: dto.username },
      });

      if (!admin) {
        throw new BusinessException(ErrorCode.ADMIN_INVALID_CREDENTIALS);
      }

      if (!admin.is_active) {
        throw new BusinessException(ErrorCode.ADMIN_INVALID_CREDENTIALS, '账号已被禁用');
      }

      const isMatch = await bcrypt.compare(dto.password, admin.password_hash);
      if (!isMatch) {
        throw new BusinessException(ErrorCode.ADMIN_INVALID_CREDENTIALS);
      }

      const payload: AdminJwtUser = {
        sub: admin.id.toString(),
        username: admin.username,
        role: admin.role as 'super_admin' | 'operator',
        isAdmin: true,
      };

      const accessToken = await this.jwtService.signAsync(payload, {
        expiresIn: '30m',
      });
      const refreshToken = await this.jwtService.signAsync(payload, {
        expiresIn: '7d',
      });

      const refreshTokenHash = this.hashToken(refreshToken);
      const sessionId = this.generateSessionId();
      const now = new Date();

      await this.prisma.sys_admin_sessions.create({
        data: {
          session_id: sessionId,
          admin_id: admin.id,
          refresh_token_hash: refreshTokenHash,
          user_agent: null,
          revoked: false,
          expired_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      return {
        accessToken,
        refreshToken,
        admin: {
          id: admin.id.toString(),
          username: admin.username,
          role: admin.role,
          isActive: admin.is_active,
        },
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'AdminAuthService', action: 'login', username: dto.username },
      });
    }
  }

  async refreshToken(dto: RefreshTokenDto) {
    try {
      const hash = this.hashToken(dto.refreshToken);
      const now = new Date();

      const session = await this.prisma.sys_admin_sessions.findFirst({
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
        const payload: AdminJwtUser = await this.jwtService.verifyAsync(
          dto.refreshToken,
        );

        if (!payload.isAdmin) {
          throw new BusinessException(ErrorCode.AUTH_INVALID_REFRESH_TOKEN);
        }

        const admin = await this.prisma.sys_admins.findUnique({
          where: { id: session.admin_id },
        });

        if (!admin || !admin.is_active) {
          throw new BusinessException(ErrorCode.ADMIN_NOT_FOUND);
        }

        const newPayload: AdminJwtUser = {
          sub: admin.id.toString(),
          username: admin.username,
          role: admin.role as 'super_admin' | 'operator',
          isAdmin: true,
        };

        const accessToken = await this.jwtService.signAsync(newPayload, {
          expiresIn: '30m',
        });

        return { accessToken };
      } catch {
        throw new BusinessException(ErrorCode.AUTH_INVALID_REFRESH_TOKEN);
      }
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'AdminAuthService', action: 'refreshToken' },
      });
    }
  }

  async logout(adminId: string) {
    try {
      await this.prisma.sys_admin_sessions.updateMany({
        where: { admin_id: BigInt(adminId), revoked: false },
        data: { revoked: true },
      });
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'AdminAuthService', action: 'logout', adminId },
      });
    }
  }

  async getMe(adminId: string) {
    try {
      const admin = await this.prisma.sys_admins.findUnique({
        where: { id: BigInt(adminId) },
      });

      if (!admin) {
        throw new BusinessException(ErrorCode.ADMIN_NOT_FOUND);
      }

      return {
        id: admin.id.toString(),
        username: admin.username,
        role: admin.role,
        isActive: admin.is_active,
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'AdminAuthService', action: 'getMe', adminId },
      });
    }
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private generateSessionId() {
    return randomBytes(18).toString('hex').slice(0, 36);
  }
}
