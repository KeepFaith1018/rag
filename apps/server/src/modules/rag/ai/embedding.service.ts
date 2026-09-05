import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { TokenService } from '@common/utils/token.service';
import { RedisCacheService } from '@common/cache/redis-cache.service';
import {
  DOCUMENT_EMBEDDING_CONFIG_ERROR_CODE,
  DOCUMENT_EMBEDDING_ERROR_CODE,
} from '../../document/document-processing.constants';

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
 * 负责统一封装 OpenAI 兼容的 Embedding 调用能力。
 */
@Injectable()
export class EmbeddingService {
  constructor(
    private readonly configService: ConfigService,
    private readonly tokenService: TokenService,
    private readonly cacheService: RedisCacheService,
  ) {}

  /**
   * 批量获取文本向量，内部自动做分批、限频与重试。
   */
  async embedDocuments(texts: string[]) {
    const startedAt = Date.now();

    if (texts.length === 0) {
      return {
        vectors: [],
        totalTokens: 0,
        cacheHits: 0,
        apiCallCount: 0,
        durationMs: 0,
      };
    }

    const config = this.getEmbeddingConfig();
    const embeddings = this.createEmbeddingsClient(config);

    // E3: 缓存层 — 按 content SHA-256 查 Redis，命中跳过 API 调用
    const vectors: (number[] | undefined)[] = new Array<number[]>(texts.length);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    for (let i = 0; i < texts.length; i++) {
      const hash = this.hashContent(texts[i]);
      const cached = await this.cacheService.get(`embed:${hash}`);
      if (cached) {
        try {
          vectors[i] = JSON.parse(cached) as number[];
          continue;
        } catch { /* 反序列化失败视为未命中 */ }
      }
      uncachedIndices.push(i);
      uncachedTexts.push(texts[i]);
    }

    let totalTokens = 0;
    const cacheHits = texts.length - uncachedTexts.length;
    let apiCallCount = 0;

    if (uncachedTexts.length > 0) {
      // E4: Token-count-based 动态批次 — 按 token 累积分组，最大化每批吞吐
      const MAX_TOKENS_PER_BATCH = 7500; // 百炼 text-embedding-v4 安全上限 ~8100
      const batches: { indices: number[]; texts: string[]; tokenCount: number }[] = [];
      let currentIndices: number[] = [];
      let currentTexts: string[] = [];
      let currentTokens = 0;

      for (let i = 0; i < uncachedTexts.length; i++) {
        const tokens = this.tokenService.tokenCount(uncachedTexts[i]);
        // 单条超限：独立成批，让 API 自行处理
        if (tokens > MAX_TOKENS_PER_BATCH && currentTexts.length === 0) {
          batches.push({ indices: [uncachedIndices[i]], texts: [uncachedTexts[i]], tokenCount: tokens });
          continue;
        }
        // token 累积超限：关闭当前批次，开启新批次
        if (currentTokens + tokens > MAX_TOKENS_PER_BATCH && currentTexts.length > 0) {
          batches.push({ indices: currentIndices, texts: currentTexts, tokenCount: currentTokens });
          currentIndices = [];
          currentTexts = [];
          currentTokens = 0;
        }
        currentIndices.push(uncachedIndices[i]);
        currentTexts.push(uncachedTexts[i]);
        currentTokens += tokens;
      }
      if (currentTexts.length > 0) {
        batches.push({ indices: currentIndices, texts: currentTexts, tokenCount: currentTokens });
      }

      for (let b = 0; b < batches.length; b++) {
        const batch = batches[b];
        apiCallCount++;
        const result = await this.embedBatchWithRetry(batch.texts, embeddings, config);

        for (let j = 0; j < result.vectors.length; j++) {
          const originalIndex = batch.indices[j];
          vectors[originalIndex] = result.vectors[j];
          const hash = this.hashContent(batch.texts[j]);
          this.cacheService.set(`embed:${hash}`, JSON.stringify(result.vectors[j]))
            .catch(() => { /* 缓存写入失败不影响主流程 */ });
        }
        totalTokens += batch.tokenCount;

        if (b < batches.length - 1) {
          await this.sleep(config.requestIntervalMs);
        }
      }
    }

    return {
      vectors,
      totalTokens,
      cacheHits,
      apiCallCount,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * 带重试策略执行单批次向量化请求。
   */
  private async embedBatchWithRetry(
    texts: string[],
    embeddings: OpenAIEmbeddings,
    config: EmbeddingRuntimeConfig,
  ): Promise<{ vectors: number[][] }> {
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
   * 解析并校验 Embedding 运行配置。
   */
  getEmbeddingConfig(): EmbeddingRuntimeConfig {
    const apiKey = this.configService.get<string>('AI_API_KEY');
    const modelType =
      this.configService.get<'text' | 'vision'>(
        'AI_DOCUMENT_EMBEDDING_TYPE',
      ) || 'text';
    const model =
      modelType === 'vision'
        ? this.configService.get<string>('AI_VISION_EMBEDDING_MODEL') ||
          this.configService.get<string>('AI_EMBEDDING_MODEL')
        : this.configService.get<string>('AI_EMBEDDING_MODEL');
    if (!apiKey || !model) {
      throw new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, {
        message: 'Embedding 配置缺失，请补充标准环境变量后再执行向量化',
        context: {
          internalErrorCode: DOCUMENT_EMBEDDING_CONFIG_ERROR_CODE,
          requiredEnv:
            modelType === 'vision'
              ? ['AI_API_KEY', 'AI_VISION_EMBEDDING_MODEL']
              : ['AI_API_KEY', 'AI_EMBEDDING_MODEL'],
        },
      });
    }

    return {
      apiKey,
      model,
      modelType,
      baseUrl:
        this.configService.get<string>('AI_BASE_URL') ||
        'https://dashscope.aliyuncs.com/compatible-api/v1',
      dimensions: this.getNumberConfig('AI_EMBEDDING_DIMENSIONS'),
      batchSize: this.getNumberConfig('AI_EMBED_BATCH_SIZE') ?? 50,
      retryCount: this.getNumberConfig('AI_EMBED_RETRY_COUNT') ?? 3,
      requestIntervalMs:
        this.getNumberConfig('AI_EMBED_REQUEST_INTERVAL_MS') ?? 1000,
    };
  }

  /**
   * 基于 LangChain 构建 Embeddings 客户端。
   */
  private createEmbeddingsClient(config: EmbeddingRuntimeConfig) {
    if (config.modelType !== 'text') {
      throw new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, {
        message:
          '当前 LangChain Embedding 编排仅支持文本向量模型，请将 AI_DOCUMENT_EMBEDDING_TYPE 设置为 text',
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
      message: detail.message || 'Embedding 调用失败',
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
   * 对文本内容做 SHA-256 哈希，作为缓存键。
   */
  private hashContent(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  /**
   * 基于 tiktoken 计算当前批次的真实 token 数量。
   */
  private estimateBatchTokenCount(texts: string[]) {
    return this.tokenService.batchTokenCount(texts);
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
