import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcrypt';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../platform/database/prisma.service';
import { RuntimeConfig } from '../../../platform/config/runtime-config.service';
import {
  lockUserByEmail,
  lockUserById,
} from '../../../platform/database/transaction-locks';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';
import { UserAccountsService } from '../../users/services/user-accounts.service';
import { UserProfilesService } from '../../users/services/user-profiles.service';
import type { Principal } from '../contracts/principal';
import { VerificationPurpose } from '../dto/identity.dto';
import { VerificationService } from './verification.service';
import { IdentityRateLimitService } from './identity-rate-limit.service';

type RefreshPayload = { sub?: string; sid?: string; typ?: string };

/** 负责注册、登录、令牌轮换及会话撤销的认证应用服务。 */
@Injectable()
export class AuthenticationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: RuntimeConfig,
    private readonly users: UserAccountsService,
    private readonly profiles: UserProfilesService,
    private readonly verification: VerificationService,
    private readonly rateLimit: IdentityRateLimitService,
  ) {}

  async register(input: {
    email: string;
    password: string;
    code: string;
    username: string;
  }) {
    const passwordHash = await hash(input.password, 12);
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.verification.consume(
          input.email,
          VerificationPurpose.REGISTER,
          input.code,
          tx,
        );
        const existing = await this.users.findByEmail(input.email, tx);
        if (existing)
          throw new BusinessError(
            ErrorCode.AUTH_USER_EXISTS,
            '该邮箱已注册',
            'conflict',
          );
        await this.users.createVerified(
          {
            email: input.email,
            passwordHash,
            fullName: input.username,
          },
          tx,
        );
      });
    } catch (error) {
      if (this.isUniqueConflict(error))
        throw new BusinessError(
          ErrorCode.AUTH_USER_EXISTS,
          '该邮箱已注册',
          'conflict',
        );
      throw error;
    }
    return { message: '注册成功' };
  }

  async login(
    emailInput: string,
    password: string,
    ip: string,
    userAgent?: string,
  ) {
    const email = emailInput.trim().toLowerCase();
    await this.rateLimit.assertLoginAllowed(email, ip);
    return this.prisma.$transaction(async (tx) => {
      await lockUserByEmail(tx, email);
      const user = await this.users.findByEmail(email, tx);
      if (
        !user ||
        user.deleted_at ||
        !user.is_active ||
        !user.email_verified_at ||
        !(await compare(password, user.password_hash))
      )
        throw new BusinessError(
          ErrorCode.AUTH_INVALID_CREDENTIALS,
          '邮箱或密码错误',
          'unauthenticated',
        );
      const sessionId = randomUUID();
      const tokens = await this.issueTokens(user.id.toString(), sessionId);
      await tx.b_user_sessions.create({
        data: {
          session_id: sessionId,
          user_id: user.id,
          refresh_token_hash: this.tokenHash(tokens.refreshToken),
          user_agent: userAgent?.slice(0, 255) || null,
          expired_at: new Date(
            Date.now() + this.config.identity.refreshTtlSeconds * 1000,
          ),
        },
      });
      return { ...tokens, user: this.users.buildProfile(user) };
    });
  }

  async refresh(refreshToken: string, userAgent?: string) {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.config.identity.jwtSecret,
      });
      if (payload.typ !== 'refresh' || !payload.sub || !payload.sid)
        throw new Error('invalid token purpose');
    } catch {
      throw this.invalidRefresh();
    }
    const refreshHash = this.tokenHash(refreshToken);
    let userId: bigint;
    try {
      userId = BigInt(payload.sub);
      if (userId < 1n) throw new Error('invalid user id');
    } catch {
      throw this.invalidRefresh();
    }
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockUserById(tx, userId))) throw this.invalidRefresh();
      const existing = await tx.b_user_sessions.findUnique({
        where: { refresh_token_hash: refreshHash },
        include: { b_users: true },
      });
      if (
        !existing ||
        existing.session_id !== payload.sid ||
        existing.user_id !== userId ||
        existing.revoked ||
        existing.expired_at <= new Date() ||
        !existing.b_users.is_active ||
        existing.b_users.deleted_at
      )
        throw this.invalidRefresh();

      const nextSessionId = randomUUID();
      const tokens = await this.issueTokens(userId.toString(), nextSessionId);
      // 条件更新使刷新令牌只能成功消费一次，并阻止并发请求重复创建新会话。
      const revoked = await tx.b_user_sessions.updateMany({
        where: {
          id: existing.id,
          revoked: false,
          refresh_token_hash: refreshHash,
          expired_at: { gt: new Date() },
        },
        data: {
          revoked: true,
          revoked_at: new Date(),
          last_used_at: new Date(),
        },
      });
      if (revoked.count !== 1) throw this.invalidRefresh();
      await tx.b_user_sessions.create({
        data: {
          session_id: nextSessionId,
          user_id: existing.user_id,
          refresh_token_hash: this.tokenHash(tokens.refreshToken),
          user_agent: userAgent?.slice(0, 255) || null,
          expired_at: new Date(
            Date.now() + this.config.identity.refreshTtlSeconds * 1000,
          ),
        },
      });
      return tokens;
    });
  }

  async logout(principal: Principal) {
    const userId = BigInt(principal.userId);
    await this.prisma.$transaction(async (tx) => {
      await lockUserById(tx, userId);
      await tx.b_user_sessions.updateMany({
        where: {
          session_id: principal.sessionId,
          user_id: userId,
          revoked: false,
        },
        data: { revoked: true, revoked_at: new Date() },
      });
    });
    return { message: '已退出登录' };
  }

  me(userId: string) {
    return this.profiles.get(BigInt(userId));
  }

  private async issueTokens(userId: string, sessionId: string) {
    const base = { sub: userId, sid: sessionId };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { ...base, typ: 'access', jti: randomUUID() },
        {
          secret: this.config.identity.jwtSecret,
          expiresIn: this.config.identity.accessTtlSeconds,
        },
      ),
      this.jwt.signAsync(
        { ...base, typ: 'refresh', jti: randomUUID() },
        {
          secret: this.config.identity.jwtSecret,
          expiresIn: this.config.identity.refreshTtlSeconds,
        },
      ),
    ]);
    return { accessToken, refreshToken };
  }

  private tokenHash(token: string) {
    // 数据库只保存不可逆摘要，避免会话表泄露后可直接使用刷新令牌。
    return createHash('sha256').update(token).digest('hex');
  }

  private invalidRefresh() {
    return new BusinessError(
      ErrorCode.AUTH_INVALID_REFRESH_TOKEN,
      '刷新凭证无效',
      'unauthenticated',
    );
  }

  private isUniqueConflict(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
