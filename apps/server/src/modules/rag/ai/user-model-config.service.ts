import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';

/**
 * 用户自定义模型配置 CRUD 服务。
 *
 * 每个用户可以保存多个模型配置（provider + modelName + baseUrl），
 * api_key 不由服务端存储，由前端传入运行时。
 */
@Injectable()
export class UserModelConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取当前用户的所有模型配置（不含 api_key）。
   */
  async findAll(userId: number) {
    return this.prisma.b_user_model_configs.findMany({
      where: { user_id: BigInt(userId) },
      select: {
        id: true,
        provider: true,
        model_name: true,
        base_url: true,
        is_active: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * 获取单条模型配置。
   */
  async findOne(userId: number, id: number) {
    const config = await this.prisma.b_user_model_configs.findFirst({
      where: { id: BigInt(id), user_id: BigInt(userId) },
    });
    if (!config) {
      throw new BusinessException(ErrorCode.MODEL_NOT_FOUND);
    }
    return config;
  }

  /**
   * 创建模型配置。
   */
  async create(
    userId: number,
    dto: { provider: string; modelName: string; baseUrl?: string },
  ) {
    return this.prisma.b_user_model_configs.create({
      data: {
        user_id: BigInt(userId),
        provider: dto.provider,
        model_name: dto.modelName,
        base_url: dto.baseUrl || null,
      },
    });
  }

  /**
   * 更新模型配置。
   */
  async update(
    userId: number,
    id: number,
    dto: {
      provider?: string;
      modelName?: string;
      baseUrl?: string;
      isActive?: boolean;
    },
  ) {
    const config = await this.prisma.b_user_model_configs.findFirst({
      where: { id: BigInt(id), user_id: BigInt(userId) },
    });
    if (!config) {
      throw new BusinessException(ErrorCode.MODEL_NOT_FOUND);
    }

    return this.prisma.b_user_model_configs.update({
      where: { id: BigInt(id) },
      data: {
        ...(dto.provider && { provider: dto.provider }),
        ...(dto.modelName && { model_name: dto.modelName }),
        ...(dto.baseUrl !== undefined && { base_url: dto.baseUrl }),
        ...(dto.isActive !== undefined && { is_active: dto.isActive }),
      },
    });
  }

  /**
   * 删除模型配置。
   */
  async remove(userId: number, id: number) {
    const config = await this.prisma.b_user_model_configs.findFirst({
      where: { id: BigInt(id), user_id: BigInt(userId) },
    });
    if (!config) {
      throw new BusinessException(ErrorCode.MODEL_NOT_FOUND);
    }

    return this.prisma.b_user_model_configs.delete({
      where: { id: BigInt(id) },
    });
  }
}
