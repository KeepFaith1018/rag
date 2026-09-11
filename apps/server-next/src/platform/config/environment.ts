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
    .pattern(/^[a-z0-9][a-z0-9.-]{2,62}$/)
    .default('rag-documents'),
  DOCUMENT_STORAGE_REGION: Joi.string().default('us-east-1'),
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
  return value;
}
