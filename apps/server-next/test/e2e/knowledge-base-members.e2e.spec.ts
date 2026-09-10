import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '@app/app.module';
import { PrismaService } from '@platform/database/prisma.service';
import { cleanupTestRun } from '../support/cleanup';
import { createVerifiedUser } from '../support/fixtures';
import { loginAsMember, loginAsOwner } from '../support/test-auth';
import { TestHttpClient } from '../support/test-http';
import { configureTestEnvironment, createTestRun } from '../support/test-run';

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
  name: string;
  visibility: 'private' | 'collaborative' | 'public';
  accessRole: string;
}

describe('P2 knowledge-base members and permission regression', () => {
  const run = createTestRun();
  configureTestEnvironment(run);
  const password = 'p2-test-password-123';
  let app: INestApplication;
  let db: PrismaService;
  let client: TestHttpClient;
  let owner: Awaited<ReturnType<typeof createVerifiedUser>>;
  let manager: Awaited<ReturnType<typeof createVerifiedUser>>;
  let collaborator: Awaited<ReturnType<typeof createVerifiedUser>>;
  let member: Awaited<ReturnType<typeof createVerifiedUser>>;
  let outsider: Awaited<ReturnType<typeof createVerifiedUser>>;
  let ownerTokens: Tokens;
  let managerTokens: Tokens;
  let collaboratorTokens: Tokens;
  let memberTokens: Tokens;
  let outsiderTokens: Tokens;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    client = new TestHttpClient(await app.getUrl());
    db = app.get(PrismaService);
    owner = await createVerifiedUser(db, run, 'p2-owner', { password });
    manager = await createVerifiedUser(db, run, 'p2-manager', { password });
    collaborator = await createVerifiedUser(db, run, 'p2-collaborator', {
      password,
    });
    member = await createVerifiedUser(db, run, 'p2-member', { password });
    outsider = await createVerifiedUser(db, run, 'p2-outsider', { password });
    ownerTokens = await loginAsOwner(client, owner.email, password);
    managerTokens = await loginAsMember(client, manager.email, password);
    collaboratorTokens = await loginAsMember(
      client,
      collaborator.email,
      password,
    );
    memberTokens = await loginAsMember(client, member.email, password);
    outsiderTokens = await loginAsMember(client, outsider.email, password);
  });

  afterAll(async () => {
    try {
      if (db) await cleanupTestRun(db, run);
    } finally {
      await app?.close();
    }
  });

  it('covers invitation, list, role update, removal, leave and cancellation', async () => {
    const kb = await createKnowledgeBase('P2 collaborative', 'collaborative');
    const managerInvite = await createInvitation(kb.id, ownerTokens, 'manager');
    expect(
      (
        await client.request('knowledge-bases/join', {
          method: 'POST',
          token: managerTokens.accessToken,
          body: { inviteCode: managerInvite.inviteCode },
        })
      ).status,
    ).toBe(200);
    const collaboratorInvite = await createInvitation(
      kb.id,
      ownerTokens,
      'collaborator',
    );
    expect(
      (
        await client.request('knowledge-bases/join', {
          method: 'POST',
          token: collaboratorTokens.accessToken,
          body: { inviteCode: collaboratorInvite.inviteCode },
        })
      ).status,
    ).toBe(200);
    const memberInvite = await createInvitation(kb.id, ownerTokens, 'member');
    expect(
      (
        await client.request('knowledge-bases/join', {
          method: 'POST',
          token: memberTokens.accessToken,
          body: { inviteCode: memberInvite.inviteCode },
        })
      ).status,
    ).toBe(200);

    for (const token of [ownerTokens, managerTokens]) {
      const members = await client.request<Envelope<{ list: unknown[] }>>(
        `knowledge-bases/${kb.id}/members`,
        { token: token.accessToken },
      );
      expect(members.status).toBe(200);
      expect(members.body.data?.list.length).toBe(4);
    }
    expect(
      (
        await client.request(`knowledge-bases/${kb.id}/members`, {
          token: collaboratorTokens.accessToken,
          expectedStatus: 403,
        })
      ).status,
    ).toBe(403);

    const promoted = await client.request(
      `knowledge-bases/${kb.id}/members/${member.user.id}`,
      {
        method: 'PATCH',
        token: managerTokens.accessToken,
        body: { role: 'collaborator' },
      },
    );
    expect(promoted.status).toBe(200);
    const collaboratorCannotPromote = await client.request(
      `knowledge-bases/${kb.id}/members/${collaborator.user.id}`,
      {
        method: 'PATCH',
        token: collaboratorTokens.accessToken,
        body: { role: 'manager' },
        expectedStatus: 403,
      },
    );
    expect(collaboratorCannotPromote.status).toBe(403);

    const ownerRoleChange = await client.request(
      `knowledge-bases/${kb.id}/members/${owner.user.id}`,
      {
        method: 'PATCH',
        token: managerTokens.accessToken,
        body: { role: 'member' },
        expectedStatus: 409,
      },
    );
    expect(ownerRoleChange.status).toBe(409);
    const removed = await client.request(
      `knowledge-bases/${kb.id}/members/${member.user.id}`,
      {
        method: 'DELETE',
        token: managerTokens.accessToken,
      },
    );
    expect(removed.status).toBe(200);
    const removedLeave = await client.request(
      `knowledge-bases/${kb.id}/leave`,
      {
        method: 'POST',
        token: memberTokens.accessToken,
        expectedStatus: 409,
      },
    );
    expect(removedLeave.status).toBe(409);
    expect(
      (
        await client.request(`knowledge-bases/${kb.id}/leave`, {
          method: 'POST',
          token: collaboratorTokens.accessToken,
        })
      ).status,
    ).toBe(200);

    const outsiderInvite = await createInvitation(kb.id, ownerTokens, 'member');
    const cancelled = await client.request(
      `knowledge-bases/${kb.id}/invitations/${outsiderInvite.id}`,
      { method: 'DELETE', token: managerTokens.accessToken },
    );
    expect(cancelled.status).toBe(200);
    const cancelledJoin = await client.request('knowledge-bases/join', {
      method: 'POST',
      token: outsiderTokens.accessToken,
      body: { inviteCode: outsiderInvite.inviteCode },
      expectedStatus: 409,
    });
    expect(cancelledJoin.status).toBe(409);
    const memberList = await client.request(
      `knowledge-bases/${kb.id}/invitations`,
      { token: collaboratorTokens.accessToken, expectedStatus: 403 },
    );
    expect(memberList.status).toBe(403);
  });

  it('enforces private and public membership boundaries', async () => {
    const privateKb = await createKnowledgeBase('P2 private', 'private');
    const privateInvite = await client.request(
      `knowledge-bases/${privateKb.id}/invitations`,
      {
        method: 'POST',
        token: ownerTokens.accessToken,
        body: { role: 'member' },
        expectedStatus: 409,
      },
    );
    expect(privateInvite.status).toBe(409);
    const privateMembers = await client.request(
      `knowledge-bases/${privateKb.id}/members`,
      { token: ownerTokens.accessToken, expectedStatus: 409 },
    );
    expect(privateMembers.status).toBe(409);

    const publicKb = await createKnowledgeBase('P2 public', 'public');
    const joined = await client.request(`knowledge-bases/${publicKb.id}/join`, {
      method: 'POST',
      token: outsiderTokens.accessToken,
    });
    expect(joined.status).toBe(200);
    const duplicate = await client.request(
      `knowledge-bases/${publicKb.id}/join`,
      {
        method: 'POST',
        token: outsiderTokens.accessToken,
        expectedStatus: 409,
      },
    );
    expect(duplicate.status).toBe(409);
  });

  it('supports list filters, keyword search and pagination', async () => {
    const first = await createKnowledgeBase(
      'P2 searchable alpha',
      'collaborative',
    );
    await createKnowledgeBase('P2 searchable beta', 'collaborative');
    run.registerKnowledgeBase(BigInt(first.id));
    const list = await client.request<
      Envelope<{
        list: Array<{ id: string; name: string }>;
        pagination: { page: number; pageSize: number; total: number };
      }>
    >(
      'knowledge-bases?ownership=owned&visibility=collaborative&keyword=searchable&page=1&pageSize=1&sortBy=name_asc',
      {
        token: ownerTokens.accessToken,
      },
    );
    expect(list.status).toBe(200);
    expect(list.body.data?.pagination).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
    });
    expect(list.body.data?.list).toHaveLength(1);
    const publicList = await client.request<
      Envelope<{ list: Array<{ id: string }> }>
    >(
      'public/knowledge-bases?keyword=P2%20public&page=1&pageSize=10&sortBy=latest',
      { token: outsiderTokens.accessToken },
    );
    expect(publicList.status).toBe(200);
    expect(publicList.body.data?.list).toHaveLength(1);
  });

  async function createKnowledgeBase(
    name: string,
    visibility: KnowledgeBase['visibility'],
  ) {
    const response = await client.request<Envelope<KnowledgeBase>>(
      'knowledge-bases',
      {
        method: 'POST',
        token: ownerTokens.accessToken,
        body: { name: run.knowledgeBaseName(name), visibility },
      },
    );
    expect(response.status).toBe(201);
    const data = response.body.data!;
    run.registerKnowledgeBase(BigInt(data.id));
    return data;
  }

  async function createInvitation(
    kbId: string,
    tokens: Tokens,
    role: 'manager' | 'collaborator' | 'member',
  ) {
    const response = await client.request<
      Envelope<{ id: string; inviteCode: string }>
    >(`knowledge-bases/${kbId}/invitations`, {
      method: 'POST',
      token: tokens.accessToken,
      body: { role, expiredInHours: 1 },
    });
    expect(response.status).toBe(201);
    return response.body.data!;
  }
});
