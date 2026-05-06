import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '@common/prisma/prisma.service';
import { BusinessException, wrapBusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';

@Injectable()
export class AdminUserService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(page = 1, pageSize = 20) {
    try {
      const skip = (page - 1) * pageSize;
      const [admins, total] = await Promise.all([
        this.prisma.sys_admins.findMany({
          skip,
          take: pageSize,
          orderBy: { created_at: 'desc' },
        }),
        this.prisma.sys_admins.count(),
      ]);

      return {
        list: admins.map((a) => ({
          id: a.id.toString(),
          username: a.username,
          role: a.role,
          isActive: a.is_active,
          createdAt: a.created_at.toISOString(),
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
      const admin = await this.prisma.sys_admins.findUnique({
        where: { id: BigInt(id) },
      });

      if (!admin) throw new BusinessException(ErrorCode.ADMIN_NOT_FOUND);

      return {
        id: admin.id.toString(),
        username: admin.username,
        role: admin.role,
        isActive: admin.is_active,
        createdAt: admin.created_at.toISOString(),
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'AdminUserService', action: 'findOne', id },
      });
    }
  }

  async create(dto: CreateAdminUserDto, _currentAdminId: string) {
    try {
      const existing = await this.prisma.sys_admins.findUnique({
        where: { username: dto.username },
      });

      if (existing) {
        throw new BusinessException(ErrorCode.ADMIN_USERNAME_EXISTS);
      }

      const salt = await bcrypt.genSalt();
      const hashedPassword = await bcrypt.hash(dto.password, salt);

      const admin = await this.prisma.sys_admins.create({
        data: {
          username: dto.username,
          password_hash: hashedPassword,
          role: dto.role,
          is_active: true,
        },
      });

      return {
        id: admin.id.toString(),
        username: admin.username,
        role: admin.role,
        isActive: admin.is_active,
        createdAt: admin.created_at.toISOString(),
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'AdminUserService', action: 'create', username: dto.username },
      });
    }
  }

  async update(id: string, dto: UpdateAdminUserDto, _currentAdminId: string) {
    try {
      const admin = await this.prisma.sys_admins.findUnique({
        where: { id: BigInt(id) },
      });

      if (!admin) throw new BusinessException(ErrorCode.ADMIN_NOT_FOUND);

      const data: Record<string, unknown> = {};
      if (dto.password) {
        const salt = await bcrypt.genSalt();
        data.password_hash = await bcrypt.hash(dto.password, salt);
      }
      if (dto.role !== undefined) data.role = dto.role;
      if (dto.isActive !== undefined) data.is_active = dto.isActive;

      const updated = await this.prisma.sys_admins.update({
        where: { id: BigInt(id) },
        data,
      });

      return {
        id: updated.id.toString(),
        username: updated.username,
        role: updated.role,
        isActive: updated.is_active,
        createdAt: updated.created_at.toISOString(),
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'AdminUserService', action: 'update', id },
      });
    }
  }

  async remove(id: string, currentAdminId: string) {
    try {
      if (id === currentAdminId) {
        throw new BusinessException(ErrorCode.ADMIN_CANNOT_DELETE_SELF);
      }

      await this.prisma.sys_admins.delete({ where: { id: BigInt(id) } });
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'AdminUserService', action: 'remove', id },
      });
    }
  }
}
