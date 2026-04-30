import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { JwtUser } from '@app/modules/auth/interface/jwtUser';
import { KB_PERMISSION_KEY } from './kb-permission.decorator';
import {
  KbPermissionContext,
  KbPermissionRequirement,
} from '../interfaces/kb-permission.interface';
import { KbPermissionService } from './kb-permission.service';

type KnowledgeBasePermissionRequest = Request & {
  user?: JwtUser;
  kbPermission?: KbPermissionContext;
};

/**
 * 基于声明式权限动作完成知识库级权限拦截。
 */
@Injectable()
export class KbPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly kbPermissionService: KbPermissionService,
  ) {}

  /**
   * 按接口声明的权限动作校验当前用户是否可访问指定知识库。
   */
  async canActivate(context: ExecutionContext) {
    const requirement = this.reflector.getAllAndOverride<
      KbPermissionRequirement | undefined
    >(KB_PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    if (!requirement) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<KnowledgeBasePermissionRequest>();
    const userId = request.user?.sub;
    if (!userId) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED);
    }

    const kbIdParam = requirement.kbIdParam ?? 'kbId';
    const rawKbId = request.params?.[kbIdParam];
    const kbId = Array.isArray(rawKbId) ? rawKbId[0] : rawKbId;
    if (!kbId) {
      throw new BusinessException(ErrorCode.PARAM_ERROR, '缺少知识库 ID 参数');
    }

    request.kbPermission = await this.kbPermissionService.authorize(
      Number(userId),
      kbId,
      requirement.action,
    );

    return true;
  }
}
