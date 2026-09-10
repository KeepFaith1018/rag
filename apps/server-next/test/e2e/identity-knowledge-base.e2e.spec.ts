import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac, randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { AppModule } from '@app/app.module';
import { PrismaService } from '@platform/database/prisma.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';

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

interface KnowledgeBase {
  id: string;
  visibility: 'private' | 'collaborative' | 'public';
  accessRole: string;
  name: string;
}

describe('M1 identity, users and knowledge-base flow', () => {
  let app: INestApplication;
  let db: PrismaService;
  let config: RuntimeConfig;
  let baseUrl: string;
  let schemaReady = false;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const emails = ['owner', 'member', 'visitor', 'contender'].map(
    (name) => `server-next-e2e-${name}-${suffix}@example.test`,
  );
  const password = 'M1-test-password-123';
  const code = '123456';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    db = app.get(PrismaService);
    config = app.get(RuntimeConfig);
    const tables = await db.$queryRaw<Array<{ table_count: bigint }>>`
      SELECT COUNT(*) AS table_count
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('b_users', 'b_user_sessions', 'sys_email_codes', 'b_knowledge_bases', 'b_kb_members', 'b_kb_invitations')
    `;
    schemaReady = Number(tables[0]?.table_count ?? 0) === 6;
    if (!schemaReady)
      throw new Error(
        'P2 E2E requires the six identity/knowledge-base tables in the configured database',
      );
  });

  afterAll(async () => {
    if (db && schemaReady) {
      const avatars = await db.b_users.findMany({
        where: { email: { in: emails } },
        select: { avatar_url: true },
      });
      await db.b_users.deleteMany({ where: { email: { in: emails } } });
      await db.sys_email_codes.deleteMany({ where: { email: { in: emails } } });
      const avatarRoot = isAbsolute(config.avatar.directory)
        ? config.avatar.directory
        : resolve(process.cwd(), config.avatar.directory);
      await Promise.all(
        avatars.map((item) =>
          item.avatar_url
            ? unlink(join(avatarRoot, item.avatar_url)).catch(() => undefined)
            : Promise.resolve(),
        ),
      );
    }
    await app?.close();
  });

  it('completes the authenticated collaboration boundary without downstream modules', async () => {
    const users: Tokens[] = [];
    for (const [index, email] of emails.entries()) {
      await insertVerificationCode(email, 1);
      const registered = await request<{ message: string }>('auth/register', {
        method: 'POST',
        body: {
          email,
          password,
          code,
          username: `M1 User ${index + 1}`,
        },
      });
      expect(registered.status).toBe(201);
      expect(registered.body.success).toBe(true);
      const persistedUser = await db.b_users.findUnique({ where: { email } });
      const persistedCode = await db.sys_email_codes.findFirst({
        where: { email, purpose: 1 },
        orderBy: { id: 'desc' },
      });
      expect(persistedUser?.email_verified_at).toBeInstanceOf(Date);
      expect(persistedCode?.used).toBe(true);
      expect(persistedCode?.code_hash).not.toBe(code);
      const login = await request<Tokens>('auth/login', {
        method: 'POST',
        body: { email, password },
      });
      expect(login.status).toBe(200);
      expect(login.body.data?.user.email).toBe(email);
      users.push(login.body.data as Tokens);
    }

    const owner = users[0];
    let member = users[1];
    let visitor = users[2];
    const contender = users[3];

    const me = await request<Tokens['user']>('auth/me', {
      token: owner.accessToken,
    });
    expect(me.body.data?.id).toBe(owner.user.id);

    const refreshCompetition = await Promise.all([
      request<Omit<Tokens, 'user'>>('auth/refresh', {
        method: 'POST',
        body: { refreshToken: member.refreshToken },
      }),
      request<Omit<Tokens, 'user'>>('auth/refresh', {
        method: 'POST',
        body: { refreshToken: member.refreshToken },
      }),
    ]);
    expect(refreshCompetition.map((item) => item.status).sort()).toEqual([
      200, 401,
    ]);
    const winningRefresh = refreshCompetition.find(
      (item) => item.status === 200,
    )?.body.data;
    const afterReplay = await request<Omit<Tokens, 'user'>>('auth/refresh', {
      method: 'POST',
      body: { refreshToken: winningRefresh?.refreshToken },
    });
    expect(afterReplay.status).toBe(200);
    member = { ...member, ...(afterReplay.body.data as Omit<Tokens, 'user'>) };

    const invalidPurpose = await request('auth/send-code', {
      method: 'POST',
      body: { email: emails[0], purpose: 3 },
    });
    expect(invalidPurpose.status).toBe(400);

    const collaborative = await createKnowledgeBase(
      owner.accessToken,
      'Collaborative M1',
      'collaborative',
    );
    const invitation = await request<{ inviteCode: string }>(
      `knowledge-bases/${collaborative.id}/invitations`,
      {
        method: 'POST',
        token: owner.accessToken,
        body: { role: 'member', expiredInHours: 1 },
      },
    );
    expect(invitation.body.data?.inviteCode).toBeTruthy();
    const invitations = await request<{ list: Array<Record<string, unknown>> }>(
      `knowledge-bases/${collaborative.id}/invitations`,
      { token: owner.accessToken },
    );
    expect(invitations.body.data?.list[0]).not.toHaveProperty('inviteCode');

    const joined = await request(`knowledge-bases/join`, {
      method: 'POST',
      token: member.accessToken,
      body: { inviteCode: invitation.body.data?.inviteCode },
    });
    expect(joined.status).toBe(200);
    const duplicateJoin = await request(`knowledge-bases/join`, {
      method: 'POST',
      token: member.accessToken,
      body: { inviteCode: invitation.body.data?.inviteCode },
    });
    expect(duplicateJoin.status).toBe(409);

    const forbidden = await request(`knowledge-bases/${collaborative.id}`, {
      token: visitor.accessToken,
    });
    expect(forbidden.status).toBe(403);
    const memberDetail = await request<KnowledgeBase>(
      `knowledge-bases/${collaborative.id}`,
      { token: member.accessToken },
    );
    expect(memberDetail.body.data?.accessRole).toBe('member');

    const promote = await request(
      `knowledge-bases/${collaborative.id}/members/${member.user.id}`,
      {
        method: 'PATCH',
        token: owner.accessToken,
        body: { role: 'manager' },
      },
    );
    expect(promote.status).toBe(200);
    const managerInvite = await request<{ inviteCode: string }>(
      `knowledge-bases/${collaborative.id}/invitations`,
      {
        method: 'POST',
        token: member.accessToken,
        body: { role: 'member' },
      },
    );
    expect(managerInvite.status).toBe(201);
    const visitorJoin = await request(`knowledge-bases/join`, {
      method: 'POST',
      token: visitor.accessToken,
      body: { inviteCode: managerInvite.body.data?.inviteCode },
    });
    expect(visitorJoin.status).toBe(200);

    const concurrentKb = await createKnowledgeBase(
      owner.accessToken,
      'Concurrent invitation M1',
      'collaborative',
    );
    const concurrentInvitation = await request<{ inviteCode: string }>(
      `knowledge-bases/${concurrentKb.id}/invitations`,
      {
        method: 'POST',
        token: owner.accessToken,
        body: { role: 'member' },
      },
    );
    const concurrentJoins = await Promise.all([
      request(`knowledge-bases/join`, {
        method: 'POST',
        token: visitor.accessToken,
        body: { inviteCode: concurrentInvitation.body.data?.inviteCode },
      }),
      request(`knowledge-bases/join`, {
        method: 'POST',
        token: contender.accessToken,
        body: { inviteCode: concurrentInvitation.body.data?.inviteCode },
      }),
    ]);
    expect(concurrentJoins.map((item) => item.status).sort()).toEqual([
      200, 409,
    ]);
    const losingUser = concurrentJoins[0].status === 409 ? visitor : contender;
    const cancelRaceInvitation = await request<{
      id: string;
      inviteCode: string;
    }>(`knowledge-bases/${concurrentKb.id}/invitations`, {
      method: 'POST',
      token: owner.accessToken,
      body: { role: 'member' },
    });
    const cancelAcceptRace = await Promise.all([
      request(
        `knowledge-bases/${concurrentKb.id}/invitations/${cancelRaceInvitation.body.data?.id}`,
        { method: 'DELETE', token: owner.accessToken },
      ),
      request(`knowledge-bases/join`, {
        method: 'POST',
        token: losingUser.accessToken,
        body: { inviteCode: cancelRaceInvitation.body.data?.inviteCode },
      }),
    ]);
    expect(cancelAcceptRace.filter((item) => item.status === 200)).toHaveLength(
      1,
    );
    const racedInvitation = await db.b_kb_invitations.findUnique({
      where: { id: BigInt(cancelRaceInvitation.body.data!.id) },
    });
    expect(
      Boolean(racedInvitation?.accepted_at) &&
        Boolean(racedInvitation?.cancelled_at),
    ).toBe(false);

    const memberCannotEdit = await request(
      `knowledge-bases/${collaborative.id}`,
      {
        method: 'PATCH',
        token: visitor.accessToken,
        body: { name: 'Forbidden rename' },
      },
    );
    expect(memberCannotEdit.status).toBe(403);

    const publicKb = await createKnowledgeBase(
      owner.accessToken,
      'Public M1',
      'public',
    );
    const publicDetail = await request<KnowledgeBase>(
      `knowledge-bases/${publicKb.id}`,
      { token: visitor.accessToken },
    );
    expect(publicDetail.body.data?.accessRole).toBe('publicVisitor');
    const publicInvitation = await request<{ inviteCode: string }>(
      `knowledge-bases/${publicKb.id}/invitations`,
      { method: 'POST', token: owner.accessToken, body: { role: 'member' } },
    );
    expect(publicInvitation.status).toBe(201);
    const publicJoin = await request(`knowledge-bases/${publicKb.id}/join`, {
      method: 'POST',
      token: visitor.accessToken,
    });
    expect(publicJoin.status).toBe(200);
    const publicToCollaborative = await request<KnowledgeBase>(
      `knowledge-bases/${publicKb.id}`,
      {
        method: 'PATCH',
        token: owner.accessToken,
        body: { visibility: 'collaborative' },
      },
    );
    expect(publicToCollaborative.status).toBe(200);
    expect(
      (
        await request(`knowledge-bases/${publicKb.id}`, {
          token: visitor.accessToken,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`knowledge-bases/${publicKb.id}`, {
          token: contender.accessToken,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('knowledge-bases/join', {
          method: 'POST',
          token: contender.accessToken,
          body: { inviteCode: publicInvitation.body.data?.inviteCode },
        })
      ).status,
    ).toBe(200);

    const privateKb = await createKnowledgeBase(
      owner.accessToken,
      'Private M1',
      'private',
    );
    const privateForbidden = await request(`knowledge-bases/${privateKb.id}`, {
      token: visitor.accessToken,
    });
    expect(privateForbidden.status).toBe(403);
    const privateTransition = await request(`knowledge-bases/${privateKb.id}`, {
      method: 'PATCH',
      token: owner.accessToken,
      body: { visibility: 'public' },
    });
    expect(privateTransition.status).toBe(409);
    const contradictoryDownload = await request('knowledge-bases', {
      method: 'POST',
      token: owner.accessToken,
      body: {
        name: 'Invalid download policy',
        visibility: 'private',
        allowPublicDownload: true,
      },
    });
    expect(contradictoryDownload.status).toBe(400);

    const ownerLeave = await request(`knowledge-bases/${privateKb.id}/leave`, {
      method: 'POST',
      token: owner.accessToken,
    });
    expect(ownerLeave.status).toBe(409);

    const nonEmptyKb = await createKnowledgeBase(
      owner.accessToken,
      'Non-empty M1',
      'private',
    );
    const uploadSession = await db.b_upload_sessions.create({
      data: {
        session_id: randomUUID(),
        kb_id: BigInt(nonEmptyKb.id),
        user_id: BigInt(owner.user.id),
        storage_bucket: 'server-next-e2e',
        storage_key: `server-next-e2e/${suffix}`,
        multipart_upload_id: `server-next-e2e-${suffix}`,
        file_name: 'fixture.txt',
        file_size: 1n,
        part_size: 1,
        total_parts: 1,
        expires_at: new Date(Date.now() + 60_000),
      },
    });
    expect(
      (
        await request(`knowledge-bases/${nonEmptyKb.id}`, {
          method: 'DELETE',
          token: owner.accessToken,
        })
      ).status,
    ).toBe(409);
    await db.b_upload_sessions.delete({ where: { id: uploadSession.id } });
    expect(
      (
        await request(`knowledge-bases/${nonEmptyKb.id}`, {
          method: 'DELETE',
          token: owner.accessToken,
        })
      ).status,
    ).toBe(200);

    const updatedProfile = await request<Tokens['user']>('users/me', {
      method: 'PATCH',
      token: visitor.accessToken,
      body: { full_name: 'Updated Visitor' },
    });
    expect(updatedProfile.body.data?.username).toBe('Updated Visitor');

    const invalidAvatar = new FormData();
    invalidAvatar.append(
      'file',
      new Blob(['not-an-image'], { type: 'image/png' }),
      'invalid.png',
    );
    expect(
      (
        await request('users/me/avatar', {
          method: 'POST',
          token: visitor.accessToken,
          body: invalidAvatar,
        })
      ).status,
    ).toBe(400);
    const validAvatar = new FormData();
    validAvatar.append(
      'file',
      new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], {
        type: 'image/png',
      }),
      'avatar.png',
    );
    const avatarUpdated = await request<Tokens['user']>('users/me/avatar', {
      method: 'POST',
      token: visitor.accessToken,
      body: validAvatar,
    });
    expect(avatarUpdated.status).toBe(200);
    const avatarResponse = await fetch(
      `${baseUrl}/api/users/avatar/${visitor.user.id}`,
    );
    expect(avatarResponse.status).toBe(200);
    expect(avatarResponse.headers.get('content-type')).toContain('image/png');

    const resetPassword = 'M1-test-password-reset-123';
    await insertVerificationCode(emails[2], 2);
    const wrongReset = await request('users/reset-password', {
      method: 'POST',
      body: { email: emails[2], code: '000000', new_password: resetPassword },
    });
    expect(wrongReset.status).toBe(400);
    expect(
      await db.sys_email_codes.findFirst({
        where: { email: emails[2], purpose: 2 },
        orderBy: { id: 'desc' },
      }),
    ).toMatchObject({ used: false });
    const reset = await request('users/reset-password', {
      method: 'POST',
      body: { email: emails[2], code, new_password: resetPassword },
    });
    expect(reset.status).toBe(200);
    expect(
      (await request('auth/me', { token: visitor.accessToken })).status,
    ).toBe(401);
    const resetLogin = await request<Tokens>('auth/login', {
      method: 'POST',
      body: { email: emails[2], password: resetPassword },
    });
    expect(resetLogin.status).toBe(200);
    visitor = resetLogin.body.data as Tokens;

    const changedPassword = 'M1-test-password-changed-123';
    const changePassword = await request('users/me/password', {
      method: 'POST',
      token: member.accessToken,
      body: { old_password: password, new_password: changedPassword },
    });
    expect(changePassword.status).toBe(200);
    expect(
      (await request('auth/me', { token: member.accessToken })).status,
    ).toBe(401);
    expect(
      (
        await request('auth/refresh', {
          method: 'POST',
          body: { refreshToken: member.refreshToken },
        })
      ).status,
    ).toBe(401);
    const changedLogin = await request<Tokens>('auth/login', {
      method: 'POST',
      body: { email: emails[1], password: changedPassword },
    });
    expect(changedLogin.status).toBe(200);
    member = changedLogin.body.data as Tokens;

    await db.b_users.update({
      where: { id: BigInt(contender.user.id) },
      data: { is_active: false },
    });
    expect(
      (await request('auth/me', { token: contender.accessToken })).status,
    ).toBe(401);
    expect(
      (
        await request('auth/login', {
          method: 'POST',
          body: { email: emails[3], password },
        })
      ).status,
    ).toBe(401);

    const logout = await request('auth/logout', {
      method: 'POST',
      token: member.accessToken,
    });
    expect(logout.status).toBe(200);
    const afterLogout = await request('auth/me', { token: member.accessToken });
    expect(afterLogout.status).toBe(401);
  });

  async function createKnowledgeBase(
    token: string,
    name: string,
    visibility: KnowledgeBase['visibility'],
  ) {
    const response = await request<KnowledgeBase>('knowledge-bases', {
      method: 'POST',
      token,
      body: { name, visibility },
    });
    expect(response.status).toBe(201);
    return response.body.data as KnowledgeBase;
  }

  async function insertVerificationCode(email: string, purpose: number) {
    const digest = createHmac('sha256', config.identity.verificationSecret)
      .update(`${purpose}:${email}:${code}`)
      .digest('hex');
    await db.sys_email_codes.create({
      data: {
        email,
        purpose,
        code_hash: digest,
        expired_at: new Date(Date.now() + 60_000),
      },
    });
  }

  async function request<T = unknown>(
    path: string,
    options: {
      method?: string;
      token?: string;
      body?: Record<string, unknown> | FormData;
    } = {},
  ) {
    const isFormData = options.body instanceof FormData;
    const requestBody: BodyInit | undefined = !options.body
      ? undefined
      : isFormData
        ? (options.body as FormData)
        : JSON.stringify(options.body);
    const response = await fetch(`${baseUrl}/api/${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.body && !isFormData
          ? { 'content-type': 'application/json' }
          : {}),
      },
      body: requestBody,
    });
    return {
      status: response.status,
      body: (await response.json()) as Envelope<T>,
    };
  }
});
