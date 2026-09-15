import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type RuntimeLogLevel = 'error' | 'warn' | 'info' | 'debug' | 'silent';

export interface LoggingConfig {
  level: RuntimeLogLevel;
  includeStack: boolean;
  fileEnabled: boolean;
  directory: string;
  retentionDays: number;
}

export interface WorkerConfig {
  concurrency: number;
  batchSize: number;
  embeddingBatchTokens: number;
  providerRateLimitPerSecond: number;
  taskTimeoutMs: number;
  heartbeatIntervalMs: number;
  leaseSeconds: number;
  cleanupSafetyWindowMs: number;
  reconcileIntervalMs: number;
  outboxBatchSize: number;
}

/**
 * 应用运行时配置的类型化访问入口。
 *
 * 原始环境变量已由 validateEnvironment 校验和转换，因此这里使用 getOrThrow 尽早暴露
 * 装配错误，并按领域分组返回配置，避免业务代码依赖环境变量名称。
 */
@Injectable()
export class RuntimeConfig {
  constructor(private readonly config: ConfigService) {}

  get http() {
    return {
      host: this.config.getOrThrow<string>('HOST'),
      port: this.config.getOrThrow<number>('PORT'),
      origins: this.config
        .getOrThrow<string>('CORS_ORIGINS')
        .split(',')
        .map((s) => s.trim()),
    };
  }

  get databaseUrl() {
    return this.config.getOrThrow<string>('DATABASE_URL');
  }

  get logLevel(): RuntimeLogLevel {
    return this.config.getOrThrow<RuntimeLogLevel>('LOG_LEVEL');
  }

  get environment() {
    return this.config.getOrThrow<'development' | 'test' | 'production'>(
      'NODE_ENV',
    );
  }

  get logging(): LoggingConfig {
    const configuredIncludeStack =
      this.config.get<boolean>('LOG_INCLUDE_STACK');
    return {
      level: this.logLevel,
      includeStack:
        this.environment === 'production'
          ? false
          : (configuredIncludeStack ?? this.environment === 'development'),
      fileEnabled: this.config.getOrThrow<boolean>('LOG_FILE_ENABLED'),
      directory: this.config.getOrThrow<string>('LOG_DIRECTORY'),
      retentionDays: this.config.getOrThrow<number>('LOG_FILE_RETENTION_DAYS'),
    };
  }

  get redis() {
    return {
      url: this.config.getOrThrow<string>('REDIS_URL'),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      keyPrefix: this.config.getOrThrow<string>('REDIS_KEY_PREFIX'),
    };
  }

  get queue() {
    return {
      bullmqPrefix: this.config.getOrThrow<string>('BULLMQ_PREFIX'),
      processingChannelPrefix: this.config.getOrThrow<string>(
        'DOCUMENT_PROCESSING_CHANNEL_PREFIX',
      ),
    };
  }

  get processingSse() {
    return {
      perUserLimit: this.config.getOrThrow<number>(
        'DOCUMENT_PROCESSING_SSE_USER_LIMIT',
      ),
      instanceLimit: this.config.getOrThrow<number>(
        'DOCUMENT_PROCESSING_SSE_INSTANCE_LIMIT',
      ),
      heartbeatMs: this.config.getOrThrow<number>(
        'DOCUMENT_PROCESSING_SSE_HEARTBEAT_MS',
      ),
      maxDurationSeconds: this.config.getOrThrow<number>(
        'DOCUMENT_PROCESSING_SSE_MAX_DURATION_SECONDS',
      ),
    };
  }

  get embedding() {
    return {
      provider: this.config.getOrThrow<string>('EMBEDDING_PROVIDER'),
      apiKey: this.config.get<string>('EMBEDDING_API_KEY') || undefined,
      baseUrl: this.config.getOrThrow<string>('EMBEDDING_BASE_URL'),
    };
  }

  get qdrant() {
    return {
      url: this.config.getOrThrow<string>('QDRANT_URL'),
      apiKey: this.config.get<string>('QDRANT_API_KEY') || undefined,
    };
  }

  get elasticsearch() {
    return {
      url: this.config.getOrThrow<string>('ELASTICSEARCH_URL'),
      username: this.config.get<string>('ELASTICSEARCH_USERNAME') || undefined,
      password: this.config.get<string>('ELASTICSEARCH_PASSWORD') || undefined,
    };
  }

  get parser() {
    return {
      maxBytes: this.config.getOrThrow<number>('PARSER_MAX_BYTES'),
      maxZipFiles: this.config.getOrThrow<number>('PARSER_MAX_ZIP_FILES'),
      maxUncompressedBytes: this.config.getOrThrow<number>(
        'PARSER_MAX_UNCOMPRESSED_BYTES',
      ),
    };
  }

  get retention() {
    return {
      failedRunArtifactDays: this.config.getOrThrow<number>(
        'FAILED_RUN_ARTIFACT_RETENTION_DAYS',
      ),
      deletedDocumentDays: this.config.getOrThrow<number>(
        'DELETED_DOCUMENT_RETENTION_DAYS',
      ),
    };
  }

  get worker(): WorkerConfig {
    return {
      concurrency: this.config.getOrThrow<number>('WORKER_CONCURRENCY'),
      batchSize: this.config.getOrThrow<number>('WORKER_BATCH_SIZE'),
      embeddingBatchTokens: this.config.getOrThrow<number>(
        'WORKER_EMBEDDING_BATCH_TOKENS',
      ),
      providerRateLimitPerSecond: this.config.getOrThrow<number>(
        'WORKER_PROVIDER_RATE_LIMIT_PER_SECOND',
      ),
      taskTimeoutMs: this.config.getOrThrow<number>('WORKER_TASK_TIMEOUT_MS'),
      heartbeatIntervalMs: this.config.getOrThrow<number>(
        'WORKER_HEARTBEAT_INTERVAL_MS',
      ),
      leaseSeconds: this.config.getOrThrow<number>('WORKER_LEASE_SECONDS'),
      cleanupSafetyWindowMs: this.config.getOrThrow<number>(
        'WORKER_CLEANUP_SAFETY_WINDOW_MS',
      ),
      reconcileIntervalMs: this.config.getOrThrow<number>(
        'WORKER_RECONCILE_INTERVAL_MS',
      ),
      outboxBatchSize: this.config.getOrThrow<number>(
        'WORKER_OUTBOX_BATCH_SIZE',
      ),
    };
  }

  /** Worker 专用配置 fail-fast；API 不调用此方法。 */
  assertWorkerRequirements() {
    const missing: string[] = [];
    if (!this.embedding.provider || !this.embedding.apiKey)
      missing.push('EMBEDDING');
    if (!this.qdrant.url) missing.push('QDRANT');
    if (!this.elasticsearch.url) missing.push('ELASTICSEARCH');
    if (missing.length)
      throw new Error(`Missing worker configuration: ${missing.join(', ')}`);
    if (this.environment === 'production') {
      const insecure = [
        ['EMBEDDING_BASE_URL', this.embedding.baseUrl],
        ['QDRANT_URL', this.qdrant.url],
        ['ELASTICSEARCH_URL', this.elasticsearch.url],
      ].filter(([, value]) => !value.startsWith('https://'));
      if (insecure.length)
        throw new Error(
          `Worker endpoints must use HTTPS in production: ${insecure.map(([name]) => name).join(', ')}`,
        );
    }
  }

  get mail() {
    return {
      enabled: this.config.getOrThrow<boolean>('EMAIL_ENABLED'),
      host: this.config.getOrThrow<string>('EMAIL_HOST'),
      port: this.config.getOrThrow<number>('EMAIL_PORT'),
      user: this.config.getOrThrow<string>('EMAIL_USER'),
      password: this.config.getOrThrow<string>('EMAIL_PASS'),
      from: this.config.getOrThrow<string>('EMAIL_FROM'),
    };
  }

  get identity() {
    return {
      jwtSecret: this.config.getOrThrow<string>('JWT_SECRET'),
      accessTtlSeconds: this.config.getOrThrow<number>(
        'JWT_ACCESS_TTL_SECONDS',
      ),
      refreshTtlSeconds: this.config.getOrThrow<number>(
        'JWT_REFRESH_TTL_SECONDS',
      ),
      verificationSecret: this.config.getOrThrow<string>(
        'VERIFICATION_CODE_SECRET',
      ),
      verificationTtlSeconds: this.config.getOrThrow<number>(
        'VERIFICATION_CODE_TTL_SECONDS',
      ),
      verificationCooldownSeconds: this.config.getOrThrow<number>(
        'VERIFICATION_CODE_COOLDOWN_SECONDS',
      ),
      verificationIpLimitMax: this.config.getOrThrow<number>(
        'VERIFICATION_IP_LIMIT_MAX',
      ),
      verificationIpWindowSeconds: this.config.getOrThrow<number>(
        'VERIFICATION_IP_WINDOW_SECONDS',
      ),
      loginRateLimitMax: this.config.getOrThrow<number>('LOGIN_RATE_LIMIT_MAX'),
      loginRateLimitWindowSeconds: this.config.getOrThrow<number>(
        'LOGIN_RATE_LIMIT_WINDOW_SECONDS',
      ),
    };
  }

  get avatar() {
    return {
      maxBytes: this.config.getOrThrow<number>('AVATAR_MAX_BYTES'),
    };
  }

  get documentStorage() {
    return {
      endpoint: this.config.getOrThrow<string>('DOCUMENT_STORAGE_ENDPOINT'),
      accessKey: this.config.getOrThrow<string>('DOCUMENT_STORAGE_ACCESS_KEY'),
      secretKey: this.config.getOrThrow<string>('DOCUMENT_STORAGE_SECRET_KEY'),
      bucket: this.config.getOrThrow<string>('DOCUMENT_STORAGE_BUCKET'),
      region: this.config.getOrThrow<string>('DOCUMENT_STORAGE_REGION'),
      requestTimeoutMs: this.config.getOrThrow<number>(
        'DOCUMENT_STORAGE_REQUEST_TIMEOUT_MS',
      ),
      streamTimeoutMs: this.config.getOrThrow<number>(
        'DOCUMENT_STORAGE_STREAM_TIMEOUT_MS',
      ),
      partSize: this.config.getOrThrow<number>('DOCUMENT_STORAGE_PART_SIZE'),
      sessionTtlSeconds: this.config.getOrThrow<number>(
        'DOCUMENT_STORAGE_SESSION_TTL_SECONDS',
      ),
    };
  }
}
