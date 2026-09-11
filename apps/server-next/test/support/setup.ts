/**
 * 单元和契约测试使用隔离的无效基础设施地址及固定测试密钥，确保测试不会连接开发环境，
 * 也不会读取开发者的真实凭证。
 */
process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:1/rag_kb_next';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.REDIS_KEY_PREFIX = 'server-next:test:';
process.env.LOG_LEVEL = 'silent';
process.env.LOG_FILE_ENABLED = 'false';
process.env.EMAIL_ENABLED = 'false';
process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters';
process.env.JWT_ACCESS_TTL_SECONDS = '1800';
process.env.JWT_REFRESH_TTL_SECONDS = '604800';
process.env.VERIFICATION_CODE_SECRET =
  'test-verification-secret-with-at-least-32-chars';
process.env.VERIFICATION_CODE_TTL_SECONDS = '600';
process.env.VERIFICATION_CODE_COOLDOWN_SECONDS = '60';
process.env.VERIFICATION_IP_LIMIT_MAX = '20';
process.env.VERIFICATION_IP_WINDOW_SECONDS = '3600';
process.env.LOGIN_RATE_LIMIT_MAX = '10';
process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS = '300';
process.env.AVATAR_MAX_BYTES = '5242880';
