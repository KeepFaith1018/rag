import { validateEnvironment } from '@platform/config/environment';

const required = {
  DATABASE_URL: 'mysql://user:secret@127.0.0.1/rag_kb',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
  VERIFICATION_CODE_SECRET: 'test-verification-secret-with-at-least-32-chars',
};
describe('environment boundaries', () => {
  it('starts with no downstream or SMTP credentials', () => {
    const config = validateEnvironment(required);
    expect(config.PORT).toBe(3001);
    expect(config.EMAIL_ENABLED).toBe(false);
    expect(config.REDIS_KEY_PREFIX).toBe('server-next:');
    expect(config.WORKER_CLEANUP_SAFETY_WINDOW_MS).toBe(60000);
  });
  it('校验清理安全窗口边界', () => {
    for (const value of [0, 999, 3600001])
      expect(() =>
        validateEnvironment({
          ...required,
          WORKER_CLEANUP_SAFETY_WINDOW_MS: value,
        }),
      ).toThrow('WORKER_CLEANUP_SAFETY_WINDOW_MS');
    expect(
      validateEnvironment({
        ...required,
        WORKER_CLEANUP_SAFETY_WINDOW_MS: 1000,
      }).WORKER_CLEANUP_SAFETY_WINDOW_MS,
    ).toBe(1000);
  });
  it('accepts the existing database but rejects a missing database or unisolated Redis prefix', () => {
    expect(validateEnvironment(required).DATABASE_URL).toBe(
      required.DATABASE_URL,
    );
    expect(() =>
      validateEnvironment({
        ...required,
        DATABASE_URL: 'mysql://user:secret@localhost/',
      }),
    ).toThrow('DATABASE_URL');
    expect(() =>
      validateEnvironment({ ...required, REDIS_KEY_PREFIX: 'rag:' }),
    ).toThrow('REDIS_KEY_PREFIX');
  });
  it('validates enabled mail and CORS without exposing secrets', () => {
    expect(() =>
      validateEnvironment({ ...required, EMAIL_ENABLED: true }),
    ).toThrow('EMAIL_HOST');
    expect(() =>
      validateEnvironment({ ...required, CORS_ORIGINS: '*' }),
    ).toThrow('CORS_ORIGINS');
    try {
      validateEnvironment({
        ...required,
        DATABASE_URL: 'sensitive-invalid-value',
      });
    } catch (error) {
      expect((error as Error).message).not.toContain('sensitive-invalid-value');
    }
  });
  it('生产环境要求对象存储使用 HTTPS', () => {
    expect(() =>
      validateEnvironment({
        ...required,
        NODE_ENV: 'production',
        DOCUMENT_STORAGE_ENDPOINT: 'http://storage.internal:9000',
      }),
    ).toThrow('DOCUMENT_STORAGE_ENDPOINT');
    expect(
      validateEnvironment({
        ...required,
        NODE_ENV: 'production',
        DOCUMENT_STORAGE_ENDPOINT: 'https://storage.example.com',
      }).DOCUMENT_STORAGE_ENDPOINT,
    ).toBe('https://storage.example.com');
  });
  it('拒绝不安全的对象存储地址和非法 Bucket 名称', () => {
    expect(() =>
      validateEnvironment({
        ...required,
        DOCUMENT_STORAGE_ENDPOINT: 'http://user:secret@localhost:9000',
      }),
    ).toThrow('DOCUMENT_STORAGE_ENDPOINT');
    expect(() =>
      validateEnvironment({
        ...required,
        DOCUMENT_STORAGE_BUCKET: 'invalid..bucket',
      }),
    ).toThrow('DOCUMENT_STORAGE_BUCKET');
    expect(() =>
      validateEnvironment({
        ...required,
        DOCUMENT_STORAGE_BUCKET: '127.0.0.1',
      }),
    ).toThrow('DOCUMENT_STORAGE_BUCKET');
  });
});
