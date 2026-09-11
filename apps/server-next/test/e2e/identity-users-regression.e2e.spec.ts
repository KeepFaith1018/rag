import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '@app/app.module';
import { VerificationPurpose } from '@app/modules/identity/dto/identity.dto';
import { PrismaService } from '@platform/database/prisma.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';
import { cleanupTestRun } from '../support/cleanup';
import { createTestUser, createVerifiedUser } from '../support/fixtures';
import { TestHttpClient } from '../support/test-http';
import { createTestVerificationCode } from '../support/test-verification';
import { configureTestEnvironment, createTestRun } from '../support/test-run';
import { loginAsOwner } from '../support/test-auth';

describe('P1 identity and user regression', () => {
  const run = createTestRun();
  configureTestEnvironment(run);
  const oldPassword = 'p1-old-password-123';
  const newPassword = 'p1-new-password-123';
  let app: INestApplication;
  let db: PrismaService;
  let config: RuntimeConfig;
  let client: TestHttpClient;
  let owner: Awaited<ReturnType<typeof createVerifiedUser>>;
  let profileUser: Awaited<ReturnType<typeof createVerifiedUser>>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    client = new TestHttpClient(await app.getUrl());
    db = app.get(PrismaService);
    config = app.get(RuntimeConfig);
    owner = await createVerifiedUser(db, run, 'p1-owner', {
      password: oldPassword,
    });
    profileUser = await createVerifiedUser(db, run, 'p1-profile', {
      password: oldPassword,
    });
  });

  afterAll(async () => {
    try {
      if (db) await cleanupTestRun(db, run);
    } finally {
      await app?.close();
    }
  });

  it('rejects wrong, expired, reused and duplicate registration codes', async () => {
    const email = run.email('p1-register');
    await createTestVerificationCode(db, config, run, {
      email,
      purpose: VerificationPurpose.REGISTER,
    });
    const wrong = await client.request('auth/register', {
      method: 'POST',
      body: {
        email,
        password: oldPassword,
        code: '000000',
        username: 'P1 Register',
      },
      expectedStatus: 400,
    });
    expect(wrong.status).toBe(400);

    const registered = await client.request('auth/register', {
      method: 'POST',
      body: {
        email,
        password: oldPassword,
        code: '123456',
        username: 'P1 Register',
      },
    });
    expect(registered.status).toBe(201);
    const reused = await client.request('auth/register', {
      method: 'POST',
      body: {
        email,
        password: oldPassword,
        code: '123456',
        username: 'P1 Register Again',
      },
      expectedStatus: 400,
    });
    expect(reused.status).toBe(400);

    const expiredEmail = run.email('p1-expired-register');
    await createTestVerificationCode(db, config, run, {
      email: expiredEmail,
      purpose: VerificationPurpose.REGISTER,
      expiresInMs: -60_000,
    });
    const expired = await client.request('auth/register', {
      method: 'POST',
      body: {
        email: expiredEmail,
        password: oldPassword,
        code: '123456',
        username: 'P1 Expired',
      },
      expectedStatus: 400,
    });
    expect(expired.status).toBe(400);

    await createTestVerificationCode(db, config, run, {
      email: owner.email,
      purpose: VerificationPurpose.REGISTER,
    });
    const duplicate = await client.request('auth/register', {
      method: 'POST',
      body: {
        email: owner.email,
        password: oldPassword,
        code: '123456',
        username: 'P1 Duplicate',
      },
      expectedStatus: 409,
    });
    expect(duplicate.status).toBe(409);
  });

  it('keeps multiple sessions independent and revokes all after password change', async () => {
    const first = await loginAsOwner(client, owner.email, oldPassword);
    const second = await loginAsOwner(client, owner.email, oldPassword);
    expect(
      (await client.request('auth/me', { token: second.accessToken })).status,
    ).toBe(200);

    const samePassword = await client.request('users/me/password', {
      method: 'POST',
      token: first.accessToken,
      body: { old_password: oldPassword, new_password: oldPassword },
      expectedStatus: 400,
    });
    expect(samePassword.status).toBe(400);
    const wrongOldPassword = await client.request('users/me/password', {
      method: 'POST',
      token: first.accessToken,
      body: { old_password: 'wrong-password-123', new_password: newPassword },
      expectedStatus: 401,
    });
    expect(wrongOldPassword.status).toBe(401);

    const changed = await client.request('users/me/password', {
      method: 'POST',
      token: first.accessToken,
      body: { old_password: oldPassword, new_password: newPassword },
    });
    expect(changed.status).toBe(200);
    expect(
      (
        await client.request('auth/me', {
          token: first.accessToken,
          expectedStatus: 401,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await client.request('auth/me', {
          token: second.accessToken,
          expectedStatus: 401,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await client.request('auth/refresh', {
          method: 'POST',
          body: { refreshToken: first.refreshToken },
          expectedStatus: 401,
        })
      ).status,
    ).toBe(401);
    const relogin = await loginAsOwner(client, owner.email, newPassword);
    expect(relogin.user.email).toBe(owner.email);
  });

  it('validates profile fields and supports all avatar signatures', async () => {
    const tokens = await loginAsOwner(client, profileUser.email, oldPassword);
    const empty = await client.request('users/me', {
      method: 'PATCH',
      token: tokens.accessToken,
      body: { full_name: '' },
      expectedStatus: 400,
    });
    expect(empty.status).toBe(400);
    const tooLong = await client.request('users/me', {
      method: 'PATCH',
      token: tokens.accessToken,
      body: { full_name: 'x'.repeat(101) },
      expectedStatus: 400,
    });
    expect(tooLong.status).toBe(400);
    expect(
      (
        await client.request('users/me', {
          method: 'PATCH',
          body: { full_name: 'anonymous' },
          expectedStatus: 401,
        })
      ).status,
    ).toBe(401);

    for (const [name, bytes, mime] of [
      ['png', png(), 'image/png'],
      ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg'],
      ['gif', Buffer.from('GIF89a'), 'image/gif'],
      ['webp', webp(), 'image/webp'],
    ] as const) {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: mime }), `${name}.img`);
      const response = await client.request('users/me/avatar', {
        method: 'POST',
        token: tokens.accessToken,
        body: form,
      });
      expect(response.status).toBe(200);
    }
    const avatar = await client.request(`users/avatar/${profileUser.user.id}`);
    expect(avatar.status).toBe(200);

    await db.b_users.update({
      where: { id: BigInt(profileUser.user.id) },
      data: { avatar_url: '../outside.png' },
    });
    const traversal = await client.request(
      `users/avatar/${profileUser.user.id}`,
      { expectedStatus: 404 },
    );
    expect(traversal.status).toBe(404);
  });

  it('does not allow unverified or inactive accounts to log in', async () => {
    const unverified = await createTestUser(db, run, 'p1-unverified', {
      password: oldPassword,
      verified: false,
    });
    const inactive = await createVerifiedUser(db, run, 'p1-inactive', {
      password: oldPassword,
      active: false,
    });
    for (const email of [unverified.email, inactive.email]) {
      const response = await client.request('auth/login', {
        method: 'POST',
        body: { email, password: oldPassword },
        expectedStatus: 401,
      });
      expect(response.status).toBe(401);
    }
  });

  it('rejects an expired reset code and consumes a valid reset code once', async () => {
    await createTestVerificationCode(db, config, run, {
      email: profileUser.email,
      purpose: VerificationPurpose.RESET_PASSWORD,
      expiresInMs: -60_000,
    });
    const expired = await client.request('users/reset-password', {
      method: 'POST',
      body: {
        email: profileUser.email,
        code: '123456',
        new_password: newPassword,
      },
      expectedStatus: 400,
    });
    expect(expired.status).toBe(400);

    await createTestVerificationCode(db, config, run, {
      email: profileUser.email,
      purpose: VerificationPurpose.RESET_PASSWORD,
    });
    const reset = await client.request('users/reset-password', {
      method: 'POST',
      body: {
        email: profileUser.email,
        code: '123456',
        new_password: newPassword,
      },
    });
    expect(reset.status).toBe(200);
    const reused = await client.request('users/reset-password', {
      method: 'POST',
      body: {
        email: profileUser.email,
        code: '123456',
        new_password: oldPassword,
      },
      expectedStatus: 400,
    });
    expect(reused.status).toBe(400);
    expect(
      (await loginAsOwner(client, profileUser.email, newPassword)).user.email,
    ).toBe(profileUser.email);
  });

  function png() {
    return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  }

  function webp() {
    const bytes = new Uint8Array(12);
    bytes.set([82, 73, 70, 70], 0);
    bytes.set([87, 69, 66, 80], 8);
    return bytes;
  }
});
