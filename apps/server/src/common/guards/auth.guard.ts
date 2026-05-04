import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { JwtUser } from '@app/modules/auth/interface/jwtUser';
import { AUTH_KEY } from '../decorators/auth.decorator';

/**
 * 统一处理登录鉴权，并将解析后的 JWT 用户信息写入请求上下文。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  /**
   * 对声明了 @Auth() 的接口执行登录校验。
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    // 同时兼容方法级和类级的 @Auth() 声明。
    const needAuth = this.reflector.getAllAndOverride<boolean>(AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!needAuth) {
      return true;
    }

    const authHeader = request.headers['authorization'];
    // EventSource API 不支持自定义请求头，通过查询参数降级
    const queryToken =
      typeof request.query?.token === 'string'
        ? request.query.token
        : undefined;

    const bearerToken = authHeader
      ? authHeader.replace('Bearer ', '')
      : queryToken;

    if (!bearerToken) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED);
    }

    try {
      const user = this.jwtService.verify<JwtUser>(bearerToken);
      request.user = user;
      return true;
    } catch {
      throw new BusinessException(ErrorCode.UNAUTHORIZED_EXPIRED);
    }
  }
}
