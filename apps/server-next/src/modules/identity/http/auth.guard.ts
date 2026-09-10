import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';
import type { Principal } from '../contracts/principal';
import { IdentityService } from '../services/identity.service';
import { IS_PUBLIC } from './public.decorator';

type AuthenticatedRequest = Request & { principal?: Principal };

/**
 * 默认保护全部 HTTP 路由，并把有效访问令牌解析为 Principal。
 * 只有显式使用 @Public() 的路由会跳过认证。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identity: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.get('authorization');
    // 严格要求单个 Bearer 凭证，避免接受含空白或附加内容的模糊格式。
    const match = authorization?.match(/^Bearer ([^\s]+)$/);
    if (!match)
      throw new BusinessError(
        ErrorCode.UNAUTHORIZED,
        '请先登录',
        'unauthenticated',
      );
    request.principal = await this.identity.resolveAccessToken(match[1]);
    return true;
  }
}
