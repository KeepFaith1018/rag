import { JwtUser } from '@app/modules/auth/interface/jwtUser';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export const CurrentUser = createParamDecorator(
  <K extends keyof JwtUser>(
    key: K,
    ctx: ExecutionContext,
  ): JwtUser[K] | JwtUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as JwtUser;
    return key ? user[key] : user;
  },
);

