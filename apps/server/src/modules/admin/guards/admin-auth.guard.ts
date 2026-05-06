import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { AdminJwtUser } from '../interfaces/admin-jwt-user.interface';
import { ADMIN_AUTH_KEY, ADMIN_ROLE_KEY } from '../decorators/admin-auth.decorator';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    const needAdminAuth = this.reflector.getAllAndOverride<boolean>(ADMIN_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!needAdminAuth) {
      return true;
    }

    const authHeader = request.headers['authorization'];
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

    let user: AdminJwtUser;
    try {
      user = this.jwtService.verify<AdminJwtUser>(bearerToken);
    } catch {
      throw new BusinessException(ErrorCode.UNAUTHORIZED_EXPIRED);
    }

    if (!user.isAdmin) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED);
    }

    const requiredRole = this.reflector.getAllAndOverride<'super_admin' | 'operator'>(
      ADMIN_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredRole && user.role !== requiredRole) {
      throw new BusinessException(ErrorCode.ADMIN_FORBIDDEN);
    }

    request.user = user;
    return true;
  }
}
