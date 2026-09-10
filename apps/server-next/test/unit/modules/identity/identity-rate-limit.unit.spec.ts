import { ConfigService } from '@nestjs/config';
import { IdentityRateLimitService } from '@app/modules/identity/services/identity-rate-limit.service';
import { validateEnvironment } from '@platform/config/environment';
import { RuntimeConfig } from '@platform/config/runtime-config.service';

describe('identity unauthenticated rate limits', () => {
  const config = new RuntimeConfig(
    new ConfigService(
      validateEnvironment({
        DATABASE_URL: 'mysql://test:test@localhost/rag_kb',
        REDIS_URL: 'redis://localhost:6379',
        JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
        VERIFICATION_CODE_SECRET:
          'test-verification-secret-with-at-least-32-chars',
        LOGIN_RATE_LIMIT_MAX: 2,
        LOGIN_RATE_LIMIT_WINDOW_SECONDS: 60,
        VERIFICATION_IP_LIMIT_MAX: 1,
        VERIFICATION_IP_WINDOW_SECONDS: 60,
      }),
    ),
  );
  const incrementWithExpiry = jest.fn();
  const service = new IdentityRateLimitService(
    { incrementWithExpiry } as never,
    config,
  );

  beforeEach(() => incrementWithExpiry.mockReset());

  it('checks both normalized email and IP without embedding raw values in keys', async () => {
    incrementWithExpiry.mockResolvedValue(1);
    await expect(
      service.assertLoginAllowed('person@example.test', '127.0.0.1'),
    ).resolves.toBeUndefined();
    expect(incrementWithExpiry).toHaveBeenCalledTimes(2);
    for (const [key, ttl] of incrementWithExpiry.mock.calls as Array<
      [string, number]
    >) {
      expect(key).not.toContain('person@example.test');
      expect(key).not.toContain('127.0.0.1');
      expect(ttl).toBe(60);
    }
  });

  it('rejects login or verification traffic above its configured window', async () => {
    incrementWithExpiry.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    await expect(
      service.assertLoginAllowed('person@example.test', '127.0.0.1'),
    ).rejects.toMatchObject({ code: 42900, kind: 'rate-limit' });

    incrementWithExpiry.mockResolvedValueOnce(2);
    await expect(
      service.assertVerificationIpAllowed('127.0.0.1'),
    ).rejects.toMatchObject({ code: 46005, kind: 'rate-limit' });
  });
});
