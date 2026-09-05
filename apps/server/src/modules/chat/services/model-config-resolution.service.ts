import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@common/prisma/prisma.service';
import { CryptoService } from '@common/utils/crypto.service';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';

export interface ResolvedModelParams {
  provider: string;
  modelName: string;
  apiKey: string;
  baseURL: string;
}

/**
 * 模型配置解析服务。
 *
 * 根据前端传来的 modelConfigId + modelSource 解析出运行时模型参数：
 * - system: 查 sys_model_configs 表，按 provider 取环境变量中的 API Key
 * - user:   查 b_user_model_configs 表，解密 api_key_encrypted
 *
 * 替代此前仅依赖 HTTP Headers / .env 默认值的单一模型选择路径。
 */
@Injectable()
export class ModelConfigResolutionService {
  /** provider → 环境变量 API Key 映射 */
  private readonly PROVIDER_KEY_MAP: Record<string, string> = {
    bailian: 'AI_API_KEY',
    openai: 'OPENAI_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    zhipu: 'ZHIPU_API_KEY',
  };

  /** provider → 环境变量 Base URL 映射（未配置的 provider 回退 AI_BASE_URL） */
  private readonly PROVIDER_URL_MAP: Record<string, string> = {
    bailian: 'AI_BASE_URL',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 解析模型配置为运行时参数。
   *
   * @param userId 当前用户 ID（仅 user 模型需要校验归属）
   * @param modelConfigId 前端传来的 configId（system: "sys_3" / user: "5"）
   * @param modelSource "system" | "user"
   */
  async resolve(
    userId: number,
    modelConfigId: string,
    modelSource: 'system' | 'user',
  ): Promise<ResolvedModelParams> {
    if (modelSource === 'system') {
      return this.resolveSystem(modelConfigId);
    }
    return this.resolveUser(userId, modelConfigId);
  }

  private async resolveSystem(configId: string): Promise<ResolvedModelParams> {
    // DB 无数据时的兜底哨兵值
    if (configId === 'system-default') {
      return {
        provider: 'openai-compatible',
        modelName:
          this.configService.get<string>('AI_LLM_MODEL') || 'qwen-turbo',
        apiKey: this.configService.get<string>('AI_API_KEY') || '',
        baseURL: this.configService.get<string>('AI_BASE_URL') || '',
      };
    }

    const row = await this.prisma.sys_model_configs.findUnique({
      where: { id: BigInt(configId) },
    });

    if (!row) {
      throw new BusinessException(
        ErrorCode.MODEL_NOT_FOUND,
        `系统模型配置未找到: ${configId}`,
      );
    }

    const envKeyVar = this.PROVIDER_KEY_MAP[row.provider];
    const envUrlVar = this.PROVIDER_URL_MAP[row.provider] ?? 'AI_BASE_URL';

    return {
      provider: row.provider,
      modelName: row.model_name,
      apiKey:
        (envKeyVar ? this.configService.get<string>(envKeyVar) : undefined) ||
        this.configService.get<string>('AI_API_KEY') ||
        '',
      baseURL: row.base_url || this.configService.get<string>(envUrlVar) || '',
    };
  }

  private async resolveUser(
    userId: number,
    configId: string,
  ): Promise<ResolvedModelParams> {
    const numericId = BigInt(configId);

    const row = await this.prisma.b_user_model_configs.findFirst({
      where: { id: numericId, user_id: BigInt(userId) },
    });

    if (!row) {
      throw new BusinessException(
        ErrorCode.MODEL_NOT_FOUND,
        `用户模型配置未找到: ${configId}`,
      );
    }

    if (!row.api_key_encrypted) {
      throw new BusinessException(
        ErrorCode.PARAM_ERROR,
        '该模型配置未保存 API Key，请在设置中重新编辑并填写 API Key',
      );
    }

    return {
      provider: row.provider,
      modelName: row.model_name,
      apiKey: this.crypto.decrypt(row.api_key_encrypted),
      baseURL: row.base_url || '',
    };
  }
}
