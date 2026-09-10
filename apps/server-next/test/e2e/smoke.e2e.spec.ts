import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '@app/app.module';
import { VerificationPurpose } from '@app/modules/identity/dto/identity.dto';
import { PrismaService } from '@platform/database/prisma.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';
import { RedisService } from '@platform/redis/redis.service';
import { cleanupTestRun } from '../support/cleanup';
import { createTestVerificationCode } from '../support/test-verification';
import { configureTestEnvironment, createTestRun } from '../support/test-run';
import { TestHttpClient } from '../support/test-http';
import { prepareTestStorage } from '../support/test-storage';

interface Envelope<T> {
  success: boolean;
  code: number;
  message: string;
  data?: T;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; username: string };
}

describe('server-next smoke flow', () => {
  const run = createTestRun();
  configureTestEnvironment(run);
  const password = 'server-next-smoke-password-123';
  let app: INestApplication;
  let db: PrismaService;
  let redis: RedisService;
  let config: RuntimeConfig;
  let client: TestHttpClient;

  beforeAll(async () => {
    await prepareTestStorage(run);
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    client = new TestHttpClient(await app.getUrl());
    db = app.get(PrismaService);
    redis = app.get(RedisService);
    config = app.get(RuntimeConfig);
  });

  afterAll(async () => {
    try {
      if (db) await cleanupTestRun(db, run, redis);
    } finally {
      await app?.close();
    }
  });

  it('checks health and completes the minimum authenticated collaboration path', async () => {
    const live =
      await client.request<Envelope<{ status: string }>>('health/live');
    expect(live.status).toBe(200);
    expect(live.body.data?.status).toBe('ok');

    const ready =
      await client.request<Envelope<{ status: string }>>('health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.data?.status).toBe('ok');

    const ownerEmail = run.email('owner');
    const memberEmail = run.email('member');
    await register(ownerEmail, 'Smoke Owner');
    await register(memberEmail, 'Smoke Member');

    const owner = await login(ownerEmail);
    const member = await login(memberEmail);
    run.registerUser(BigInt(owner.user.id), ownerEmail);
    run.registerUser(BigInt(member.user.id), memberEmail);

    const me = await client.request<Envelope<Tokens['user']>>('auth/me', {
      token: owner.accessToken,
    });
    expect(me.status).toBe(200);
    expect(me.body.data?.id).toBe(owner.user.id);

    const created = await client.request<Envelope<{ id: string }>>(
      'knowledge-bases',
      {
        method: 'POST',
        token: owner.accessToken,
        body: {
          name: run.knowledgeBaseName('Smoke knowledge base'),
          visibility: 'collaborative',
        },
      },
    );
    expect(created.status).toBe(201);
    const knowledgeBaseId = created.body.data!.id;
    run.registerKnowledgeBase(BigInt(knowledgeBaseId));

    const listed = await client.request<
      Envelope<{ list: Array<{ id: string }> }>
    >('knowledge-bases', { token: owner.accessToken });
    expect(listed.status).toBe(200);
    expect(listed.body.data?.list.map((item) => item.id)).toContain(
      knowledgeBaseId,
    );

    const invitation = await client.request<Envelope<{ inviteCode: string }>>(
      `knowledge-bases/${knowledgeBaseId}/invitations`,
      {
        method: 'POST',
        token: owner.accessToken,
        body: { role: 'member', expiredInHours: 1 },
      },
    );
    expect(invitation.status).toBe(201);
    expect(invitation.body.data?.inviteCode).toBeTruthy();

    const joined = await client.request('knowledge-bases/join', {
      method: 'POST',
      token: member.accessToken,
      body: { inviteCode: invitation.body.data?.inviteCode },
    });
    expect(joined.status).toBe(200);

    const memberDetail = await client.request<Envelope<{ accessRole: string }>>(
      `knowledge-bases/${knowledgeBaseId}`,
      { token: member.accessToken },
    );
    expect(memberDetail.status).toBe(200);
    expect(memberDetail.body.data?.accessRole).toBe('member');

    const logout = await client.request('auth/logout', {
      method: 'POST',
      token: owner.accessToken,
    });
    expect(logout.status).toBe(200);
    const revoked = await client.request('auth/me', {
      token: owner.accessToken,
      expectedStatus: 401,
    });
    expect(revoked.status).toBe(401);
  });

  async function register(email: string, username: string) {
    await createTestVerificationCode(db, config, run, {
      email,
      purpose: VerificationPurpose.REGISTER,
    });
    const response = await client.request('auth/register', {
      method: 'POST',
      body: { email, password, code: '123456', username },
    });
    expect(response.status).toBe(201);
  }

  async function login(email: string) {
    const response = await client.request<Envelope<Tokens>>('auth/login', {
      method: 'POST',
      body: { email, password },
    });
    expect(response.status).toBe(200);
    return response.body.data!;
  }
});
