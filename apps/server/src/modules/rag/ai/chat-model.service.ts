import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';

/** 模型能力开关 */
export interface ModelCapabilities {
  /** 深度思考/推理 */
  thinking: boolean;
  /** 多模态视觉 */
  vision: boolean;
  /** 工具/函数调用 */
  toolCalling: boolean;
  /** 流式输出 */
  streaming: boolean;
}

/** 创建模型实例的运行时选项，未传入的字段回退到环境变量默认值 */
export interface ChatModelOptions {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
  /** 请求超时（毫秒），默认 60 秒 */
  timeout?: number;
}

/**
 * 对话模型服务。
 *
 * 负责根据运行时选项创建 ChatOpenAI 实例，使得同一会话内
 * 不同请求可使用不同模型，同时也为后续 Chain 编排预留扩展点。
 *
 * 模型选择优先级：调用方传入参数 > 环境变量 > 硬编码兜底值
 */
@Injectable()
export class ChatModelService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * 根据运行时选项创建对话模型实例。
   *
   * 未传入的选项将依次回退到环境变量、硬编码默认值，
   * 因此同一会话中不同请求可使用不同模型。
   */
  createModel(options: ChatModelOptions = {}): ChatOpenAI {
    const modelName =
      options.model ||
      this.getDefaultModelName();

    const apiKey =
      options.apiKey || this.configService.get<string>('BAILIAN_API_KEY');

    const baseURL =
      options.baseURL || this.configService.get<string>('BAILIAN_BASE_URL');

    return new ChatOpenAI({
      model: modelName,
      apiKey,
      configuration: baseURL ? { baseURL } : undefined,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens,
      streaming: options.streaming ?? true,
      timeout: options.timeout ?? 60000,
    });
  }

  /**
   * 获取系统默认模型名称。
   */
  getDefaultModelName(): string {
    return this.configService.get<string>('BAILIAN_LLM_MODEL') || 'qwen-turbo';
  }

  /**
   * 获取轻量快速模型名称，用于路由/改写/审计等非生成节点。
   */
  getLightModelName(): string {
    return this.configService.get<string>('BAILIAN_LLM_LIGHT_MODEL') || 'qwen-turbo';
  }

  /**
   * 获取指定模型的能力开关。
   *
   * 当前阶段基于模型名称前缀做简单推断，
   * 后续可扩展为从 sys_model_configs.config_json 读取。
   */
  getModelCapabilities(modelName: string): ModelCapabilities {
    const lower = modelName.toLowerCase();
    const isGPT = lower.includes('gpt');
    const isClaude = lower.includes('claude');
    const isDeepseek = lower.includes('deepseek');

    return {
      thinking: isGPT || isClaude || isDeepseek,
      vision: isGPT || isClaude,
      toolCalling: true,
      streaming: true,
    };
  }

  /**
   * 判断指定能力是否开启。
   */
  isCapabilityEnabled(
    modelName: string,
    capability: keyof ModelCapabilities,
  ): boolean {
    return this.getModelCapabilities(modelName)[capability];
  }

  /**
   * 测试模型连通性。
   *
   * 使用给定的模型配置向模型服务商发起一次简单调用，
   * 验证 API Key、模型名、Base URL 等配置是否有效，
   * 并返回请求延迟。
   */
  async testConnectivity(dto: {
    provider: string;
    modelName: string;
    baseUrl?: string;
    apiKey: string;
  }): Promise<{ success: boolean; latencyMs: number }> {
    const startedAt = Date.now();
    try {
      const model = this.createModel({
        model: dto.modelName,
        apiKey: dto.apiKey,
        baseURL: dto.baseUrl,
        temperature: 0,
        maxTokens: 10,
        streaming: false,
        timeout: 10000,
      });
      await model.invoke('ping');
      return { success: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new BusinessException(
        ErrorCode.MODEL_CONNECTION_FAILED,
        `模型连接失败：${errMsg}`,
      );
    }
  }
}