import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Principal } from '../contracts/principal';

type AuthenticatedRequest = Request & { principal?: Principal };

/** 读取由全局 AuthGuard 写入请求对象的已认证身份。 */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal) throw new Error('Authenticated principal missing');
    return request.principal;
  },
);
