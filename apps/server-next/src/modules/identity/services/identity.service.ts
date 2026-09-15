import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../platform/database/prisma.service';
import { RuntimeConfig } from '../../../platform/config/runtime-config.service';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';
import type { Principal } from '../contracts/principal';

type AccessPayload = {
  sub?: string;
  sid?: string;
  typ?: string;
  exp?: number;
};

/** 校验访问令牌及其关联的服务端会话，并生成请求身份。 */
@Injectable()
export class IdentityService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: RuntimeConfig,
    private readonly prisma: PrismaService,
  ) {}

  async resolveAccessToken(token: string): Promise<Principal> {
    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token, {
        secret: this.config.identity.jwtSecret,
      });
      if (
        payload.typ !== 'access' ||
        !payload.sub ||
        !payload.sid ||
        !payload.exp
      )
        throw new Error('invalid token purpose');
      const userId = BigInt(payload.sub);
      // JWT 有效并不代表会话仍有效；登出、改密或封禁后必须立即拒绝访问。
      const active = await this.prisma.b_user_sessions.findFirst({
        where: {
          session_id: payload.sid,
          user_id: userId,
          revoked: false,
          expired_at: { gt: new Date() },
          b_users: { is_active: true, deleted_at: null },
        },
        select: { id: true },
      });
      if (!active) throw new Error('inactive session');
      return {
        userId: payload.sub,
        sessionId: payload.sid,
        expiresAt: payload.exp * 1000,
      };
    } catch {
      throw new BusinessError(
        ErrorCode.UNAUTHORIZED,
        '登录状态无效',
        'unauthenticated',
      );
    }
  }

  async assertPrincipalActive(principal: Principal): Promise<void> {
    if (principal.expiresAt <= Date.now()) throw this.unauthorized();
    const active = await this.prisma.b_user_sessions.findFirst({
      where: {
        session_id: principal.sessionId,
        user_id: BigInt(principal.userId),
        revoked: false,
        expired_at: { gt: new Date() },
        b_users: { is_active: true, deleted_at: null },
      },
      select: { id: true },
    });
    if (!active) throw this.unauthorized();
  }

  private unauthorized() {
    return new BusinessError(
      ErrorCode.UNAUTHORIZED,
      '登录状态无效',
      'unauthenticated',
    );
  }
}
