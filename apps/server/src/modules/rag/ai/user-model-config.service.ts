import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { CryptoService } from '@common/utils/crypto.service';

/**
 * 用户自定义模型配置 CRUD 服务。
 *
 * 每个用户可以保存多个模型配置（provider + modelName + baseUrl + apiKey），
 * apiKey 使用 AES-256-GCM 加密后存储于数据库，查询时按需解密。
 */
@Injectable()
export class UserModelConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * 获取当前用户的所有模型配置（不含 api_key）。
   */
  async findAll(userId: number) {
    const rows = await this.prisma.b_user_model_configs.findMany({
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
    return rows.map((r) => ({
      ...r,
      id: Number(r.id),
    }));
  }

  /**
   * 获取单条模型配置（含解密后的 api_key，仅用于运行时注入 LLM）。
   */
  async findOne(userId: number, id: number) {
    const config = await this.prisma.b_user_model_configs.findFirst({
      where: { id: BigInt(id), user_id: BigInt(userId) },
    });
    if (!config) {
      throw new BusinessException(ErrorCode.MODEL_NOT_FOUND);
    }
    return { ...config, id: Number(config.id) };
  }

  /**
   * 获取并解密 API Key，用于注入 ChatModelService。
   */
  async getDecryptedApiKey(userId: number, id: number): Promise<{
    provider: string;
    modelName: string;
    apiKey: string;
    baseUrl: string;
  }> {
    const config = await this.prisma.b_user_model_configs.findFirst({
      where: { id: BigInt(id), user_id: BigInt(userId) },
      select: {
        provider: true,
        model_name: true,
        api_key_encrypted: true,
        base_url: true,
      },
    });
    if (!config) {
      throw new BusinessException(ErrorCode.MODEL_NOT_FOUND);
    }
    if (!config.api_key_encrypted) {
      throw new BusinessException(ErrorCode.PARAM_ERROR, '该模型配置未保存 API Key');
    }
    return {
      provider: config.provider,
      modelName: config.model_name,
      apiKey: this.crypto.decrypt(config.api_key_encrypted),
      baseUrl: config.base_url ?? '',
    };
  }

  /**
   * 创建模型配置，apiKey 加密后入库。
   */
  async create(
    userId: number,
    dto: { provider: string; modelName: string; baseUrl?: string; apiKey?: string },
  ) {
    const config = await this.prisma.b_user_model_configs.create({
      data: {
        user_id: BigInt(userId),
        provider: dto.provider,
        model_name: dto.modelName,
        base_url: dto.baseUrl || null,
        api_key_encrypted: dto.apiKey ? this.crypto.encrypt(dto.apiKey) : null,
      },
      select: {
        id: true,
        provider: true,
        model_name: true,
        base_url: true,
        is_active: true,
        created_at: true,
      },
    });
    return { ...config, id: Number(config.id) };
  }

  /**
   * 更新模型配置，apiKey 若传入则加密后覆盖。
   */
  async update(
    userId: number,
    id: number,
    dto: {
      provider?: string;
      modelName?: string;
      baseUrl?: string;
      apiKey?: string;
      isActive?: boolean;
    },
  ) {
    const config = await this.prisma.b_user_model_configs.findFirst({
      where: { id: BigInt(id), user_id: BigInt(userId) },
    });
    if (!config) {
      throw new BusinessException(ErrorCode.MODEL_NOT_FOUND);
    }

    const updated = await this.prisma.b_user_model_configs.update({
      where: { id: BigInt(id) },
      data: {
        ...(dto.provider && { provider: dto.provider }),
        ...(dto.modelName && { model_name: dto.modelName }),
        ...(dto.baseUrl !== undefined && { base_url: dto.baseUrl }),
        ...(dto.apiKey !== undefined && {
          api_key_encrypted: dto.apiKey ? this.crypto.encrypt(dto.apiKey) : null,
        }),
        ...(dto.isActive !== undefined && { is_active: dto.isActive }),
      },
      select: {
        id: true,
        provider: true,
        model_name: true,
        base_url: true,
        is_active: true,
        created_at: true,
      },
    });
    return { ...updated, id: Number(updated.id) };
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
