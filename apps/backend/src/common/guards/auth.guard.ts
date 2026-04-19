import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { BusinessException } from "@common/exception/businessException";
import { ErrorCode } from "@common/utils/errorCodeMap";
import { Reflector } from "@nestjs/core";
import { AUTH_KEY } from "../decorators/auth.decorator";
import { JwtUser } from "@app/modules/auth/interface/jwtUser";
// auth.guard.ts
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService, private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    // 没有Auth()的接口直接放行
    const needAuth = this.reflector.get<boolean>(
      AUTH_KEY,
      context.getHandler(),
    );
    if (!needAuth) {
      return true;
    }

    const authHeader = request.headers['authorization'];
    if (!authHeader) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED);
    }



    const token = authHeader.replace('Bearer ', '');

    try {
      const user = this.jwtService.verify<JwtUser>(token);
      request.user = user;
      return true;
    } catch (e) {  
      throw new BusinessException(ErrorCode.UNAUTHORIZED_EXPIRED);
    }
  }
}
