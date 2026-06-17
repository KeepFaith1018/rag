import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { PrismaService } from '@common/prisma/prisma.service';
import { SecurityAuditService } from '@common/security/security-audit.service';
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
 * 支持 fallback 动作：主权限失败时尝试备选权限（如 deleteOwnDocument）。
 */
@Injectable()
export class KbPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly kbPermissionService: KbPermissionService,
    private readonly prisma: PrismaService,
    private readonly securityAudit: SecurityAuditService,
  ) {}

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

    // 尝试主权限
    try {
      request.kbPermission = await this.kbPermissionService.authorize(
        Number(userId),
        kbId,
        requirement.action,
      );
      return true;
    } catch (err) {
      // 无 fallback，直接抛出原始错误
      if (!requirement.fallback) {
        throw err;
      }
    }

    // 尝试 fallback 权限
    request.kbPermission = await this.kbPermissionService.authorize(
      Number(userId),
      kbId,
      requirement.fallback,
    );

    // 对于 own-document 动作，验证文档所有者
    if (
      requirement.fallback === 'deleteOwnDocument' ||
      requirement.fallback === 'reparseOwnDocument'
    ) {
      const docIdParam = requirement.documentIdParam ?? 'documentId';
      const documentId = String(request.params?.[docIdParam] ?? '');
      if (!documentId) {
        throw new BusinessException(ErrorCode.PARAM_ERROR, '缺少文档 ID 参数');
      }

      const document = await this.prisma.b_documents.findUnique({
        where: { id: BigInt(documentId) },
        select: { uploader_id: true },
      });

      if (!document || !document.uploader_id || document.uploader_id.toString() !== userId) {
        this.securityAudit.logPermissionDenied(
          userId,
          `document:${String(documentId)}`,
          requirement.fallback,
        );
        throw new BusinessException(ErrorCode.KNOWLEDGE_UNAUTHORIZED);
      }
    }

    return true;
  }
}
