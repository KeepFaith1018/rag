import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AdminJwtUser } from '../interfaces/admin-jwt-user.interface';
import { Request } from 'express';

export const CurrentAdmin = createParamDecorator(
  <K extends keyof AdminJwtUser>(
    key: K,
    ctx: ExecutionContext,
  ): AdminJwtUser[K] | AdminJwtUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as AdminJwtUser;
    return key ? user[key] : user;
  },
);
