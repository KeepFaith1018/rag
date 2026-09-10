import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { IdentityService } from '@app/modules/identity/services/identity.service';
import { validateEnvironment } from '@platform/config/environment';
import { RuntimeConfig } from '@platform/config/runtime-config.service';

describe('access token identity boundary', () => {
  const values = validateEnvironment({
    DATABASE_URL: 'mysql://test:test@localhost/rag_kb',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
    VERIFICATION_CODE_SECRET: 'test-verification-secret-with-at-least-32-chars',
  });
  const config = new RuntimeConfig(new ConfigService(values));
  const jwt = new JwtService();
  const sessions = { findFirst: jest.fn() };
  const service = new IdentityService(jwt, config, {
    b_user_sessions: sessions,
  } as never);

  beforeEach(() => sessions.findFirst.mockReset());

  it('accepts only access tokens backed by an active session', async () => {
    sessions.findFirst.mockResolvedValue({ id: 1n });
    const token = await jwt.signAsync(
      { sub: '9007199254740993', sid: 'session', typ: 'access' },
      { secret: config.identity.jwtSecret, expiresIn: 60 },
    );
    await expect(service.resolveAccessToken(token)).resolves.toEqual({
      userId: '9007199254740993',
      sessionId: 'session',
    });
    expect(sessions.findFirst).toHaveBeenCalledTimes(1);
  });

  it('rejects refresh tokens and revoked sessions at the HTTP boundary', async () => {
    const refresh = await jwt.signAsync(
      { sub: '1', sid: 'session', typ: 'refresh' },
      { secret: config.identity.jwtSecret, expiresIn: 60 },
    );
    await expect(service.resolveAccessToken(refresh)).rejects.toMatchObject({
      code: 40100,
    });
    sessions.findFirst.mockResolvedValue(null);
    const access = await jwt.signAsync(
      { sub: '1', sid: 'session', typ: 'access' },
      { secret: config.identity.jwtSecret, expiresIn: 60 },
    );
    await expect(service.resolveAccessToken(access)).rejects.toMatchObject({
      code: 40100,
    });
  });
});
