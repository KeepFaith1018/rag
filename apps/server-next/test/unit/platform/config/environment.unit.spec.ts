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
});
