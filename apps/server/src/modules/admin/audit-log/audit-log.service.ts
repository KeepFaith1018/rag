import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { wrapBusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { ListAuditLogDto } from './dto/list-audit-log.dto';

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListAuditLogDto) {
    try {
      const { page = 1, pageSize = 20, action, module, adminUsername } = query;
      const skip = (page - 1) * pageSize;

      const where: Record<string, unknown> = {};

      if (action) where.action = { contains: action };
      if (module) where.module = module;

      if (adminUsername) {
        where.sys_admins = {
          username: { contains: adminUsername },
        };
      }

      const [logs, total] = await Promise.all([
        this.prisma.sys_audit_logs.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: { created_at: 'desc' },
          include: {
            sys_admins: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        }),
        this.prisma.sys_audit_logs.count({ where }),
      ]);

      return {
        list: logs.map((log) => ({
          id: log.id.toString(),
          action: log.action,
          module: log.module,
          ipAddress: log.ip_address,
          details: log.details,
          admin: log.sys_admins
            ? /* eslint-disable */
              {
                id: (log.sys_admins as any).id.toString() as string,
                username: (log.sys_admins as any).username,
              }
            : /* eslint-enable */
              null,
          createdAt: log.created_at.toISOString(),
        })),
        total,
        page,
        pageSize,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'AuditLogService', action: 'findAll' },
      });
    }
  }

  async findOne(id: string) {
    try {
      const log = await this.prisma.sys_audit_logs.findUnique({
        where: { id: BigInt(id) },
        include: {
          sys_admins: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      if (!log) {
        throw new BusinessException(ErrorCode.NOT_FOUND);
      }

      return {
        id: log.id.toString(),
        action: log.action,
        module: log.module,
        ipAddress: log.ip_address,
        details: log.details,
        admin: log.sys_admins
          ? /* eslint-disable */
            {
              id: String((log.sys_admins as any).id),
              username: String((log.sys_admins as any).username),
            }
          : /* eslint-enable */
            null,
        createdAt: log.created_at.toISOString(),
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'AuditLogService', action: 'findOne', id },
      });
    }
  }
}

import { BusinessException } from '@common/exception/businessException';
