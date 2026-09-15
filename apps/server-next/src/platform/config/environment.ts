import Joi from 'joi';

/**
 * 应用启动所需的原始环境变量约束。
 *
 * 所有进程都应先通过此 Schema 完成类型转换和边界校验，再由
 * RuntimeConfig 向业务代码暴露结构化配置，避免业务模块直接读取 process.env。
 */
const schema = Joi.object({
  // 身份认证
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().min(60).default(1800),
  JWT_REFRESH_TTL_SECONDS: Joi.number().integer().min(300).default(604800),

  // 验证码
  VERIFICATION_CODE_SECRET: Joi.string().min(32).required(),
  VERIFICATION_CODE_TTL_SECONDS: Joi.number().integer().min(60).default(600),
  VERIFICATION_CODE_COOLDOWN_SECONDS: Joi.number().integer().min(1).default(60),
  VERIFICATION_IP_LIMIT_MAX: Joi.number().integer().min(1).default(20),
  VERIFICATION_IP_WINDOW_SECONDS: Joi.number().integer().min(60).default(3600),
  LOGIN_RATE_LIMIT_MAX: Joi.number().integer().min(1).default(10),
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: Joi.number().integer().min(60).default(300),

  // 头像存储
  AVATAR_MAX_BYTES: Joi.number().integer().min(1024).default(5242880),

  // 文档对象存储（MinIO/S3-compatible）
  DOCUMENT_STORAGE_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('http://127.0.0.1:19000'),
  DOCUMENT_STORAGE_ACCESS_KEY: Joi.string().allow('').default(''),
  DOCUMENT_STORAGE_SECRET_KEY: Joi.string().allow('').default(''),
  DOCUMENT_STORAGE_BUCKET: Joi.string()
    .pattern(/^[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])$/)
    .default('rag-documents'),
  DOCUMENT_STORAGE_REGION: Joi.string().default('us-east-1'),
  DOCUMENT_STORAGE_REQUEST_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(300000)
    .default(30000),
  DOCUMENT_STORAGE_STREAM_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(3600000)
    .default(300000),
  DOCUMENT_STORAGE_PART_SIZE: Joi.number()
    .integer()
    .min(5242880)
    .default(5242880),
  DOCUMENT_STORAGE_SESSION_TTL_SECONDS: Joi.number()
    .integer()
    .min(300)
    .default(259200),

  // 应用配置
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  HOST: Joi.string().default('127.0.0.1'),
  PORT: Joi.number().integer().min(1).max(65535).default(3001),
  CORS_ORIGINS: Joi.string().default('http://localhost:5173'),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'silent')
    .default('info'),
  // 未配置时 development 开启堆栈，test/production 关闭；可显式覆盖。
  LOG_INCLUDE_STACK: Joi.boolean().optional(),
  LOG_FILE_ENABLED: Joi.boolean().default(true),
  LOG_DIRECTORY: Joi.string().default('logs'),
  LOG_FILE_RETENTION_DAYS: Joi.number().integer().min(1).max(3650).default(14),

  // 数据库
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['mysql'] })
    .required(),

  // Redis 缓存
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  REDIS_KEY_PREFIX: Joi.string()
    .pattern(/^server-next:[a-zA-Z0-9:_-]*$/)
    .default('server-next:'),

  // 队列与处理状态通知
  BULLMQ_PREFIX: Joi.string()
    .pattern(/^server-next:[a-zA-Z0-9:_-]*$/)
    .default('server-next:bullmq'),
  DOCUMENT_PROCESSING_CHANNEL_PREFIX: Joi.string()
    .pattern(/^server-next:[a-zA-Z0-9:_-]*$/)
    .default('server-next:documents:processing'),
  DOCUMENT_PROCESSING_SSE_USER_LIMIT: Joi.number()
    .integer()
    .min(1)
    .max(32)
    .default(4),
  DOCUMENT_PROCESSING_SSE_INSTANCE_LIMIT: Joi.number()
    .integer()
    .min(1)
    .max(10000)
    .default(200),
  DOCUMENT_PROCESSING_SSE_HEARTBEAT_MS: Joi.number()
    .integer()
    .min(5000)
    .max(300000)
    .default(15000),
  DOCUMENT_PROCESSING_SSE_MAX_DURATION_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(86400)
    .default(1500),

  // Embedding Provider；密钥只从环境变量读取
  EMBEDDING_PROVIDER: Joi.string().allow('').default(''),
  EMBEDDING_API_KEY: Joi.string().allow('').default(''),
  EMBEDDING_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow('')
    .default(''),

  // Qdrant
  QDRANT_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow('')
    .default(''),
  QDRANT_API_KEY: Joi.string().allow('').default(''),

  // Elasticsearch
  ELASTICSEARCH_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .allow('')
    .default(''),
  ELASTICSEARCH_USERNAME: Joi.string().allow('').default(''),
  ELASTICSEARCH_PASSWORD: Joi.string().allow('').default(''),

  // 解析资源限制
  PARSER_MAX_BYTES: Joi.number()
    .integer()
    .min(1024)
    .max(1073741824)
    .default(52428800),
  PARSER_MAX_ZIP_FILES: Joi.number()
    .integer()
    .min(1)
    .max(100000)
    .default(10000),
  PARSER_MAX_UNCOMPRESSED_BYTES: Joi.number()
    .integer()
    .min(1024)
    .max(2147483648)
    .default(524288000),
  // 派生产物与 tombstone 保留
  FAILED_RUN_ARTIFACT_RETENTION_DAYS: Joi.number()
    .integer()
    .min(1)
    .max(3650)
    .default(7),
  DELETED_DOCUMENT_RETENTION_DAYS: Joi.number()
    .integer()
    .min(1)
    .max(3650)
    .default(30),

  // Worker 并发、批次、租约与对账周期
  WORKER_CONCURRENCY: Joi.number().integer().min(1).max(32).default(2),
  WORKER_BATCH_SIZE: Joi.number().integer().min(1).max(256).default(32),
  WORKER_EMBEDDING_BATCH_TOKENS: Joi.number()
    .integer()
    .min(1)
    .max(32768)
    .default(8192),
  WORKER_PROVIDER_RATE_LIMIT_PER_SECOND: Joi.number()
    .min(0.1)
    .max(1000)
    .default(10),
  WORKER_TASK_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(3600000)
    .default(600000),
  WORKER_HEARTBEAT_INTERVAL_MS: Joi.number()
    .integer()
    .min(1000)
    .max(300000)
    .default(10000),
  WORKER_LEASE_SECONDS: Joi.number().integer().min(10).max(3600).default(60),
  WORKER_CLEANUP_SAFETY_WINDOW_MS: Joi.number()
    .integer()
    .min(1000)
    .max(3600000)
    .default(60000),
  WORKER_RECONCILE_INTERVAL_MS: Joi.number()
    .integer()
    .min(1000)
    .max(3600000)
    .default(30000),
  WORKER_OUTBOX_BATCH_SIZE: Joi.number().integer().min(1).max(256).default(50),

  // 邮件服务（可选）
  EMAIL_ENABLED: Joi.boolean().default(false),
  EMAIL_HOST: Joi.when('EMAIL_ENABLED', {
    is: true,
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  EMAIL_PORT: Joi.number().integer().min(1).max(65535).default(465),
  EMAIL_USER: Joi.when('EMAIL_ENABLED', {
    is: true,
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  EMAIL_PASS: Joi.when('EMAIL_ENABLED', {
    is: true,
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  EMAIL_FROM: Joi.when('EMAIL_ENABLED', {
    is: true,
    then: Joi.string().email().required(),
    otherwise: Joi.string().allow('').default(''),
  }),
});

/**
 * 校验并规范化进程环境变量。
 *
 * 错误信息只包含无效字段名，不包含 Joi 保存的原始值或上下文，防止数据库地址、
 * Redis 密码、JWT 密钥等敏感配置在启动失败时写入控制台或日志采集系统。
 */
export function validateEnvironment(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const result = schema.validate(input, {
    abortEarly: false,
    allowUnknown: true,
  });
  if (result.error) {
    throw new Error(
      `Invalid configuration: ${result.error.details.map((d) => d.path.join('.')).join(', ')}`,
    );
  }
  const value = result.value as Record<string, unknown>;
  /**
   * URI 格式校验只能保证 DATABASE_URL 是合法 MySQL 地址，这里额外要求路径中包含
   * 明确的数据库名，避免服务意外连接到实例但未选择业务数据库。
   */
  if (
    !/^\/[a-zA-Z0-9_]+$/.test(new URL(value.DATABASE_URL as string).pathname)
  ) {
    throw new Error('DATABASE_URL must select a database');
  }
  const origins = (value.CORS_ORIGINS as string)
    .split(',')
    .map((origin) => origin.trim());
  /**
   * CORS 只接受完整且规范化的 HTTP(S) Origin，不允许路径、查询参数或通配字符串，
   * 以保证后续可以直接交给 Nest CORS 配置使用。
   */
  if (
    origins.some((origin) => {
      try {
        const url = new URL(origin);
        return (
          !['http:', 'https:'].includes(url.protocol) || url.origin !== origin
        );
      } catch {
        return true;
      }
    })
  ) {
    throw new Error('CORS_ORIGINS must contain explicit HTTP(S) origins');
  }
  const storageEndpoint = new URL(value.DOCUMENT_STORAGE_ENDPOINT as string);
  if (
    storageEndpoint.username ||
    storageEndpoint.password ||
    storageEndpoint.search ||
    storageEndpoint.hash
  )
    throw new Error(
      'DOCUMENT_STORAGE_ENDPOINT must not contain credentials, query or fragment',
    );
  if (value.NODE_ENV === 'production' && storageEndpoint.protocol !== 'https:')
    throw new Error('DOCUMENT_STORAGE_ENDPOINT must use HTTPS in production');
  const storageBucket = value.DOCUMENT_STORAGE_BUCKET as string;
  if (
    storageBucket.includes('..') ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(storageBucket)
  )
    throw new Error('DOCUMENT_STORAGE_BUCKET is not a valid S3 bucket name');
  return value;
}
