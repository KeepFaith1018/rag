import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { BusinessException, wrapBusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { ListUserDto } from './dto/list-user.dto';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListUserDto) {
    try {
      const { page = 1, pageSize = 20, email, isActive } = query;
      const skip = (page - 1) * pageSize;

      const where: Record<string, unknown> = {};
      if (email) where.email = { contains: email };
      if (isActive !== undefined) where.is_active = isActive;

      const [users, total] = await Promise.all([
        this.prisma.b_users.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            email: true,
            full_name: true,
            avatar_url: true,
            is_active: true,
            created_at: true,
          },
        }),
        this.prisma.b_users.count({ where }),
      ]);

      return {
        list: users.map((u) => ({
          id: u.id.toString(),
          email: u.email,
          fullName: u.full_name,
          avatarUrl: u.avatar_url,
          isActive: u.is_active,
          createdAt: u.created_at.toISOString(),
        })),
        total,
        page,
        pageSize,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'AdminUserService', action: 'findAll' },
      });
    }
  }

  async findOne(id: string) {
    try {
      const user = await this.prisma.b_users.findUnique({
        where: { id: BigInt(id) },
        select: {
          id: true,
          email: true,
          full_name: true,
          avatar_url: true,
          is_active: true,
          created_at: true,
        },
      });

      if (!user) {
        throw new BusinessException(ErrorCode.NOT_FOUND);
      }

      return {
        id: user.id.toString(),
        email: user.email,
        fullName: user.full_name,
        avatarUrl: user.avatar_url,
        isActive: user.is_active,
        createdAt: user.created_at.toISOString(),
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'AdminUserService', action: 'findOne', id },
      });
    }
  }

  async disable(id: string) {
    try {
      const user = await this.prisma.b_users.findUnique({ where: { id: BigInt(id) } });
      if (!user) throw new BusinessException(ErrorCode.NOT_FOUND);

      await this.prisma.b_users.update({
        where: { id: BigInt(id) },
        data: { is_active: false },
      });
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'AdminUserService', action: 'disable', id },
      });
    }
  }

  async enable(id: string) {
    try {
      const user = await this.prisma.b_users.findUnique({ where: { id: BigInt(id) } });
      if (!user) throw new BusinessException(ErrorCode.NOT_FOUND);

      await this.prisma.b_users.update({
        where: { id: BigInt(id) },
        data: { is_active: true },
      });
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'AdminUserService', action: 'enable', id },
      });
    }
  }
}
