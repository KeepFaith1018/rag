import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import {
  DOCUMENT_EMBEDDING_CONFIG_ERROR_CODE,
  DOCUMENT_EMBEDDING_ERROR_CODE,
} from '../document/document-processing.constants';

interface EmbeddingRuntimeConfig {
  apiKey: string;
  model: string;
  modelType: 'text' | 'vision';
  baseUrl: string;
  dimensions?: number;
  batchSize: number;
  retryCount: number;
  requestIntervalMs: number;
}

/**
 * 负责统一封装阿里云百炼 Embedding 调用能力。
 */
@Injectable()
export class EmbeddingService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * 批量获取文本向量，内部自动做分批、限频与重试。
   */
  async embedDocuments(texts: string[]) {
    if (texts.length === 0) {
      return {
        vectors: [],
        totalTokens: 0,
      };
    }

    const config = this.getEmbeddingConfig();
    const embeddings = this.createEmbeddingsClient(config);
    const vectors: number[][] = [];
    let totalTokens = 0;

    for (let index = 0; index < texts.length; index += config.batchSize) {
      const batch = texts.slice(index, index + config.batchSize);
      const result = await this.embedBatchWithRetry(batch, embeddings, config);
      vectors.push(...result.vectors);
      totalTokens += result.promptTokens;

      if (index + config.batchSize < texts.length) {
        await this.sleep(config.requestIntervalMs);
      }
    }

    return {
      vectors,
      totalTokens,
    };
  }

  /**
   * 带重试策略执行单批次向量化请求。
   */
  private async embedBatchWithRetry(
    texts: string[],
    embeddings: OpenAIEmbeddings,
    config: EmbeddingRuntimeConfig,
  ) {
    let lastError: unknown;

    for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
      try {
        return await this.embedBatch(texts, embeddings);
      } catch (error) {
        lastError = error;
        if (attempt >= config.retryCount || !this.isRetryableError(error)) {
          break;
        }

        const delayMs = config.requestIntervalMs * Math.pow(2, attempt + 1);
        await this.sleep(delayMs);
      }
    }

    throw lastError;
  }

  /**
   * 执行单批次 LangChain Embedding 请求。
   */
  private async embedBatch(texts: string[], embeddings: OpenAIEmbeddings) {
    try {
      const vectors = await embeddings.embedDocuments(texts);
      if (
        vectors.length !== texts.length ||
        vectors.some((item) => item.length === 0)
      ) {
        throw new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, {
          message: 'LangChain Embedding 返回结果不完整',
          context: {
            internalErrorCode: DOCUMENT_EMBEDDING_ERROR_CODE,
            expectedSize: texts.length,
            actualSize: vectors.length,
          },
        });
      }

      return {
        vectors,
        promptTokens: this.estimateBatchTokenCount(texts),
      };
    } catch (error) {
      throw this.wrapEmbeddingError(error, texts.length);
    }
  }

  /**
   * 解析并校验百炼 Embedding 运行配置。
   */
  getEmbeddingConfig(): EmbeddingRuntimeConfig {
    const apiKey = this.configService.get<string>('BAILIAN_API_KEY');
    const modelType =
      this.configService.get<'text' | 'vision'>(
        'BAILIAN_DOCUMENT_EMBEDDING_TYPE',
      ) || 'text';
    const model =
      modelType === 'vision'
        ? this.configService.get<string>('BAILIAN_VISION_EMBEDDING_MODEL') ||
          this.configService.get<string>('BAILIAN_EMBEDDING_MODEL')
        : this.configService.get<string>('BAILIAN_TEXT_EMBEDDING_MODEL') ||
          this.configService.get<string>('BAILIAN_EMBEDDING_MODEL');
    if (!apiKey || !model) {
      throw new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, {
        message: '百炼 Embedding 配置缺失，请补充标准环境变量后再执行向量化',
        context: {
          internalErrorCode: DOCUMENT_EMBEDDING_CONFIG_ERROR_CODE,
          requiredEnv:
            modelType === 'vision'
              ? ['BAILIAN_API_KEY', 'BAILIAN_VISION_EMBEDDING_MODEL']
              : ['BAILIAN_API_KEY', 'BAILIAN_TEXT_EMBEDDING_MODEL'],
        },
      });
    }

    return {
      apiKey,
      model,
      modelType,
      baseUrl:
        this.configService.get<string>('BAILIAN_BASE_URL') ||
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
      dimensions: this.getNumberConfig('BAILIAN_EMBEDDING_DIMENSIONS'),
      batchSize: this.getNumberConfig('BAILIAN_EMBED_BATCH_SIZE') ?? 10,
      retryCount: this.getNumberConfig('BAILIAN_EMBED_RETRY_COUNT') ?? 3,
      requestIntervalMs:
        this.getNumberConfig('BAILIAN_EMBED_REQUEST_INTERVAL_MS') ?? 1000,
    };
  }

  /**
   * 基于 LangChain 构建 Embeddings 客户端。
   */
  private createEmbeddingsClient(config: EmbeddingRuntimeConfig) {
    if (config.modelType !== 'text') {
      throw new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, {
        message:
          '当前 LangChain Embedding 编排仅支持文本向量模型，请将 BAILIAN_DOCUMENT_EMBEDDING_TYPE 设置为 text',
        context: {
          internalErrorCode: DOCUMENT_EMBEDDING_CONFIG_ERROR_CODE,
          modelType: config.modelType,
        },
      });
    }

    return new OpenAIEmbeddings({
      model: config.model,
      apiKey: config.apiKey,
      dimensions: config.dimensions,
      batchSize: config.batchSize,
      maxRetries: 0,
      configuration: {
        baseURL: config.baseUrl,
      },
    });
  }

  /**
   * 输出当前 Embedding 运行配置摘要，用于联调排查。
   */
  getDebugSummary() {
    const config = this.getEmbeddingConfig();
    return {
      modelType: config.modelType,
      model: config.model,
      baseUrl: config.baseUrl,
      dimensions: config.dimensions,
      batchSize: config.batchSize,
      retryCount: config.retryCount,
      requestIntervalMs: config.requestIntervalMs,
      hasApiKey: Boolean(config.apiKey),
    };
  }

  /**
   * 判定当前错误是否适合自动重试。
   */
  private isRetryableError(error: unknown) {
    if (!(error instanceof BusinessException)) {
      return false;
    }

    const httpStatus = error.context?.httpStatus;
    return (
      httpStatus === 429 ||
      httpStatus === 500 ||
      httpStatus === 502 ||
      httpStatus === 503
    );
  }

  /**
   * 将 LangChain 或 OpenAI 兼容错误统一包装为业务异常。
   */
  private wrapEmbeddingError(error: unknown, batchSize: number) {
    if (error instanceof BusinessException) {
      return error;
    }

    const detail = this.extractProviderErrorDetail(error);
    return new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, {
      message: detail.message || '百炼 Embedding 调用失败',
      cause: error,
      context: {
        internalErrorCode: DOCUMENT_EMBEDDING_ERROR_CODE,
        httpStatus: detail.httpStatus,
        providerCode: detail.providerCode,
        batchSize,
      },
    });
  }

  /**
   * 统一封装睡眠等待。
   */
  private async sleep(delayMs: number) {
    await new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  /**
   * 将环境变量中的数值配置安全转换为 number。
   */
  private getNumberConfig(key: string) {
    const rawValue = this.configService.get<string | number>(key);
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return undefined;
    }

    const parsedValue =
      typeof rawValue === 'number' ? rawValue : Number(rawValue);
    return Number.isNaN(parsedValue) ? undefined : parsedValue;
  }

  /**
   * 轻量估算当前批次的 token 数量，用于治理字段与调试输出。
   */
  private estimateBatchTokenCount(texts: string[]) {
    return texts.reduce(
      (total, item) => total + this.estimateTokenCount(item),
      0,
    );
  }

  /**
   * 当前阶段尚未直接接入 provider token usage，先用轻量估算值兜底。
   */
  private estimateTokenCount(content: string) {
    return Math.max(1, Math.ceil(content.length / 4));
  }

  /**
   * 从 LangChain/OpenAI 兼容异常中提取状态码与错误码。
   */
  private extractProviderErrorDetail(error: unknown) {
    if (!error || typeof error !== 'object') {
      return {
        message: undefined,
        httpStatus: undefined,
        providerCode: undefined,
      };
    }

    const record = error as Record<string, unknown>;
    const nestedError =
      record.error && typeof record.error === 'object'
        ? (record.error as Record<string, unknown>)
        : undefined;
    const httpStatus =
      typeof record.status === 'number'
        ? record.status
        : typeof record.statusCode === 'number'
          ? record.statusCode
          : undefined;
    const providerCode =
      typeof record.code === 'string'
        ? record.code
        : typeof nestedError?.code === 'string'
          ? nestedError.code
          : undefined;
    const message =
      typeof nestedError?.message === 'string'
        ? nestedError.message
        : typeof record.message === 'string'
          ? record.message
          : undefined;

    return {
      message,
      httpStatus,
      providerCode,
    };
  }
}
