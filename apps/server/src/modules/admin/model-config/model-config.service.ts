import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { wrapBusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { CreateModelConfigDto } from './dto/create-model-config.dto';
import { UpdateModelConfigDto } from './dto/update-model-config.dto';
import { ListModelConfigDto } from './dto/list-model-config.dto';

@Injectable()
export class ModelConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListModelConfigDto) {
    try {
      const { page = 1, pageSize = 20, provider, type, isActive } = query;
      const skip = (page - 1) * pageSize;

      const where: Record<string, unknown> = {};
      if (provider) where.provider = { contains: provider };
      if (type) where.type = type;
      if (isActive !== undefined) where.is_active = isActive;

      const [configs, total] = await Promise.all([
        this.prisma.sys_model_configs.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: { created_at: 'desc' },
        }),
        this.prisma.sys_model_configs.count({ where }),
      ]);

      return {
        list: configs.map((c) => ({
          id: c.id.toString(),
          provider: c.provider,
          name: c.name,
          type: c.type,
          baseUrl: c.base_url,
          isDefault: c.is_default,
          isActive: c.is_active,
          createdAt: c.created_at.toISOString(),
        })),
        total,
        page,
        pageSize,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'ModelConfigService', action: 'findAll' },
      });
    }
  }

  async findOne(id: string) {
    try {
      const config = await this.prisma.sys_model_configs.findUnique({
        where: { id: BigInt(id) },
      });

      if (!config) {
        throw new BusinessException(ErrorCode.NOT_FOUND);
      }

      return {
        id: config.id.toString(),
        provider: config.provider,
        name: config.name,
        type: config.type,
        baseUrl: config.base_url,
        configJson: config.config_json,
        isDefault: config.is_default,
        isActive: config.is_active,
        createdAt: config.created_at.toISOString(),
        updatedAt: config.updated_at.toISOString(),
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'ModelConfigService', action: 'findOne', id },
      });
    }
  }

  async create(dto: CreateModelConfigDto) {
    try {
      if (dto.isDefault) {
        await this.prisma.sys_model_configs.updateMany({
          where: { type: dto.type, is_default: true },
          data: { is_default: false },
        });
      }

      const config = await this.prisma.sys_model_configs.create({
        data: {
          provider: dto.provider,
          name: dto.name,
          type: dto.type,
          base_url: dto.baseUrl,
          config_json: dto.configJson as Prisma.InputJsonValue,
          is_default: dto.isDefault ?? false,
          is_active: dto.isActive ?? true,
        },
      });

      return {
        id: config.id.toString(),
        provider: config.provider,
        name: config.name,
        type: config.type,
        baseUrl: config.base_url,
        isDefault: config.is_default,
        isActive: config.is_active,
        createdAt: config.created_at.toISOString(),
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'ModelConfigService', action: 'create' },
      });
    }
  }

  async update(id: string, dto: UpdateModelConfigDto) {
    try {
      const existing = await this.prisma.sys_model_configs.findUnique({
        where: { id: BigInt(id) },
      });

      if (!existing) {
        throw new BusinessException(ErrorCode.NOT_FOUND);
      }

      if (dto.isDefault && !existing.is_default) {
        await this.prisma.sys_model_configs.updateMany({
          where: { type: existing.type, is_default: true, id: { not: BigInt(id) } },
          data: { is_default: false },
        });
      }

      const config = await this.prisma.sys_model_configs.update({
        where: { id: BigInt(id) },
        data: {
          ...(dto.provider !== undefined && { provider: dto.provider }),
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.baseUrl !== undefined && { base_url: dto.baseUrl }),
          ...(dto.configJson !== undefined && { config_json: dto.configJson as Prisma.InputJsonValue }),
          ...(dto.isDefault !== undefined && { is_default: dto.isDefault }),
          ...(dto.isActive !== undefined && { is_active: dto.isActive }),
        },
      });

      return {
        id: config.id.toString(),
        provider: config.provider,
        name: config.name,
        type: config.type,
        baseUrl: config.base_url,
        isDefault: config.is_default,
        isActive: config.is_active,
        createdAt: config.created_at.toISOString(),
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'ModelConfigService', action: 'update', id },
      });
    }
  }

  async toggle(id: string) {
    try {
      const existing = await this.prisma.sys_model_configs.findUnique({
        where: { id: BigInt(id) },
      });

      if (!existing) {
        throw new BusinessException(ErrorCode.NOT_FOUND);
      }

      const config = await this.prisma.sys_model_configs.update({
        where: { id: BigInt(id) },
        data: { is_active: !existing.is_active },
      });

      return {
        id: config.id.toString(),
        provider: config.provider,
        name: config.name,
        type: config.type,
        isDefault: config.is_default,
        isActive: config.is_active,
        createdAt: config.created_at.toISOString(),
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'ModelConfigService', action: 'toggle', id },
      });
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.sys_model_configs.delete({ where: { id: BigInt(id) } });
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'ModelConfigService', action: 'remove', id },
      });
    }
  }
}

import { BusinessException } from '@common/exception/businessException';
