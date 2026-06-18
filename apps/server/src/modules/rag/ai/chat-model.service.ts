import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

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
  constructor(
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

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
   * 测试模型连通性（两步验证）。
   *
   * Step 1 — GET /models：零成本验证网络可达 + API Key 有效
   * Step 2 — POST /chat/completions (max_tokens=1)：验证模型名存在 + 全链路通
   *
   * 三种失败原因会被精确区分：
   * - 网络不通：ConnectionError / Timeout / DNS 失败
   * - 认证失败：/models 返回 401
   * - 模型不存在：/models 正常但 /chat/completions 返回 404
   */
  async testConnectivity(dto: {
    provider: string;
    modelName: string;
    baseUrl?: string;
    apiKey: string;
  }): Promise<{ success: boolean; latencyMs: number }> {
    const base = (dto.baseUrl || '').replace(/\/+$/, '');
    if (!base) {
      throw new BusinessException(
        ErrorCode.PARAM_ERROR,
        'Base URL 不能为空',
      );
    }

    this.logger.debug('开始模型连通性测试', {
      provider: dto.provider,
      modelName: dto.modelName,
      baseUrl: base,
      apiKeyPrefix: dto.apiKey.slice(0, 8) + '***',
    });

    const headers: Record<string, string> = {
      Authorization: `Bearer ${dto.apiKey}`,
      'Content-Type': 'application/json',
    };

    const startedAt = Date.now();

    // Step 1: 验证网络 + API Key（GET /models，零 token 消耗）
    const modelsUrl = `${base}/models`;
    this.logger.debug('Step 1: GET /models', { url: modelsUrl });

    try {
      const modelsResp = await this.safeFetch(modelsUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(8000),
      });

      if (modelsResp === 'timeout') {
        this.logger.warn('Step 1 失败: 超时', { url: modelsUrl });
        throw new BusinessException(
          ErrorCode.MODEL_CONNECTION_FAILED,
          '网络连接超时，请检查 Base URL 是否可达',
        );
      }
      if (modelsResp === 'network-error') {
        this.logger.warn('Step 1 失败: 网络错误', { url: modelsUrl });
        throw new BusinessException(
          ErrorCode.MODEL_CONNECTION_FAILED,
          `无法连接到 ${base}，请检查 Base URL 是否正确、网络是否可达`,
        );
      }

      this.logger.debug('Step 1: GET /models 响应', {
        url: modelsUrl,
        status: modelsResp.status,
        ok: modelsResp.ok,
      });

      if (modelsResp.status === 401 || modelsResp.status === 403) {
        this.logger.warn('Step 1 失败: API Key 无效', { status: modelsResp.status });
        throw new BusinessException(
          ErrorCode.MODEL_CONNECTION_FAILED,
          'API Key 无效（401），请检查密钥是否正确',
        );
      }
      // 部分厂商不实现 /models 端点，返回 404 不代表不可用，继续 Step 2
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      this.logger.warn('Step 1 异常，继续 Step 2', { error: String(error) });
      // 其他未知错误也继续尝试 Step 2
    }

    // Step 2: 验证模型名（POST /chat/completions，max_tokens=1）
    const chatUrl = `${base}/chat/completions`;
    const chatBody = {
      model: dto.modelName,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    };
    this.logger.debug('Step 2: POST /chat/completions', { url: chatUrl, body: chatBody });

    try {
      const chatResp = await this.safeFetch(chatUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(chatBody),
        signal: AbortSignal.timeout(15000),
      });

      if (chatResp === 'timeout') {
        this.logger.warn('Step 2 失败: 超时', { url: chatUrl });
        throw new BusinessException(
          ErrorCode.MODEL_CONNECTION_FAILED,
          '模型响应超时，请检查模型名是否正确或稍后重试',
        );
      }
      if (chatResp === 'network-error') {
        this.logger.warn('Step 2 失败: 网络错误', { url: chatUrl });
        throw new BusinessException(
          ErrorCode.MODEL_CONNECTION_FAILED,
          `无法连接到 ${chatUrl}，请检查 Base URL`,
        );
      }

      const latencyMs = Date.now() - startedAt;
      this.logger.debug('Step 2: POST /chat/completions 响应', {
        url: chatUrl,
        status: chatResp.status,
        ok: chatResp.ok,
        latencyMs,
      });

      if (chatResp.status === 401 || chatResp.status === 403) {
        this.logger.warn('Step 2 失败: 认证/模型名无效', { status: chatResp.status });
        throw new BusinessException(
          ErrorCode.MODEL_CONNECTION_FAILED,
          '认证失败或模型不存在（模型名无效时某些网关也会返回 401），请检查模型名和 API Key',
        );
      }
      if (chatResp.status === 404) {
        this.logger.warn('Step 2 失败: 模型不存在', { modelName: dto.modelName });
        throw new BusinessException(
          ErrorCode.MODEL_CONNECTION_FAILED,
          `模型 "${dto.modelName}" 不存在（404），请检查模型名是否正确`,
        );
      }
      if (!chatResp.ok) {
        const body = await chatResp.text().catch(() => '');
        this.logger.warn('Step 2 失败: 异常响应', {
          status: chatResp.status,
          body: body.slice(0, 200),
        });
        throw new BusinessException(
          ErrorCode.MODEL_CONNECTION_FAILED,
          `模型返回异常 HTTP ${chatResp.status}：${body.slice(0, 200)}`,
        );
      }

      this.logger.info('模型连通性测试通过', {
        provider: dto.provider,
        modelName: dto.modelName,
        baseUrl: base,
        latencyMs,
      });

      return { success: true, latencyMs };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw new BusinessException(
        ErrorCode.MODEL_CONNECTION_FAILED,
        `模型连接失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 带错误分类的安全 fetch。
   *
   * 返回值：
   * - Response 对象  — 收到了 HTTP 响应（含错误状态码）
   * - 'timeout'      — 超时
   * - 'network-error' — DNS/连接拒绝/TLS 等网络层错误
   */
  private async safeFetch(
    url: string,
    init: RequestInit,
  ): Promise<Response | 'timeout' | 'network-error'> {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
          return 'timeout';
        }
        // TypeError 通常是 fetch 无法到达（DNS/连接拒绝/TLS）
        if (error instanceof TypeError) {
          return 'network-error';
        }
      }
      return 'network-error';
    }
  }
}