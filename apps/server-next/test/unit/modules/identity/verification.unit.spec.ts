import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from '@platform/config/environment';
import { RuntimeConfig } from '@platform/config/runtime-config.service';
import { VerificationService } from '@app/modules/identity/services/verification.service';
import { VerificationPurpose } from '@app/modules/identity/dto/identity.dto';

describe('verification code consumption', () => {
  const email = 'person@example.test';
  const code = '123456';
  const config = new RuntimeConfig(
    new ConfigService(
      validateEnvironment({
        DATABASE_URL: 'mysql://test:test@localhost/rag_kb_next',
        REDIS_URL: 'redis://localhost:6379',
        JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
        VERIFICATION_CODE_SECRET:
          'test-verification-secret-with-at-least-32-chars',
      }),
    ),
  );
  const findFirst = jest.fn();
  const updateMany = jest.fn();
  const db = { sys_email_codes: { findFirst, updateMany } };
  const service = new VerificationService(
    db as never,
    {} as never,
    {} as never,
    config,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    findFirst.mockReset();
    updateMany.mockReset();
  });

  it('consumes a matching code exactly once', async () => {
    const id = 1n;
    findFirst.mockResolvedValue({
      id,
      code_hash: hash(code),
    });
    updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.consume(email, VerificationPurpose.REGISTER, code, db as never),
    ).resolves.toBeUndefined();
    const calls = (updateMany as unknown as jest.Mock<unknown, [unknown]>).mock
      .calls;
    const call = calls[0]?.[0] as {
      where: { id: bigint; used: boolean };
      data: { used: boolean };
    };
    expect(call.where).toEqual(expect.objectContaining({ id, used: false }));
    expect(call.data).toEqual({ used: true });
  });

  it.each([
    ['wrong code', '000000', { id: 1n, code_hash: hash(code) }],
    ['missing or expired code', code, null],
  ])(
    'rejects %s without marking a code used',
    async (_label, input, record) => {
      findFirst.mockResolvedValue(record);
      await expect(
        service.consume(
          email,
          VerificationPurpose.RESET_PASSWORD,
          input,
          db as never,
        ),
      ).rejects.toMatchObject({ code: 46003 });
      expect(updateMany).not.toHaveBeenCalled();
    },
  );

  it('rejects a concurrent second consumer', async () => {
    findFirst.mockResolvedValue({ id: 1n, code_hash: hash(code) });
    updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.consume(email, VerificationPurpose.REGISTER, code, db as never),
    ).rejects.toMatchObject({ code: 46003 });
  });

  function hash(value: string) {
    return createHmac('sha256', config.identity.verificationSecret)
      .update(`${VerificationPurpose.REGISTER}:${email}:${value}`)
      .digest('hex');
  }
});
