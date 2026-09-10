import { hash } from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '@platform/database/prisma.service';
import type { KnowledgeBaseMemberRole } from '@app/modules/knowledge-bases/contracts/knowledge-base-access';
import type { KnowledgeBaseVisibility } from '@app/modules/knowledge-bases/contracts/knowledge-base-access';
import { TestRun } from './test-run';

export interface TestUserOptions {
  password?: string;
  verified?: boolean;
  active?: boolean;
}

export async function createTestUser(
  db: PrismaService,
  run: TestRun,
  role: string,
  options: TestUserOptions = {},
) {
  const email = run.email(role);
  const password = options.password ?? 'server-next-test-password-123';
  const user = await db.b_users.create({
    data: {
      email,
      password_hash: await hash(password, 4),
      full_name: run.username(role),
      is_active: options.active ?? true,
      email_verified_at: options.verified === false ? null : new Date(),
    },
  });
  run.registerUser(user.id, email);
  return { user, email, password };
}

export function createVerifiedUser(
  db: PrismaService,
  run: TestRun,
  role: string,
  options: Omit<TestUserOptions, 'verified'> = {},
) {
  return createTestUser(db, run, role, { ...options, verified: true });
}

export async function createTestKnowledgeBase(
  db: PrismaService,
  run: TestRun,
  ownerId: bigint,
  options: {
    name?: string;
    visibility?: KnowledgeBaseVisibility;
    allowPublicDownload?: boolean;
  } = {},
) {
  const knowledgeBase = await db.b_knowledge_bases.create({
    data: {
      owner_id: ownerId,
      name: run.knowledgeBaseName(options.name ?? '测试知识库'),
      visibility: options.visibility ?? 'private',
      allow_public_download:
        options.visibility === 'public' && options.allowPublicDownload === true,
    },
  });
  run.registerKnowledgeBase(knowledgeBase.id);
  return knowledgeBase;
}

export async function createTestMember(
  db: PrismaService,
  run: TestRun,
  knowledgeBaseId: bigint,
  userId: bigint,
  role: KnowledgeBaseMemberRole = 'member',
) {
  return db.b_kb_members.create({
    data: { kb_id: knowledgeBaseId, user_id: userId, role },
  });
}

export async function createTestInvitation(
  db: PrismaService,
  run: TestRun,
  knowledgeBaseId: bigint,
  inviterId: bigint,
  role: KnowledgeBaseMemberRole = 'member',
) {
  const inviteCode = randomBytes(24).toString('base64url');
  const invitation = await db.b_kb_invitations.create({
    data: {
      kb_id: knowledgeBaseId,
      inviter_id: inviterId,
      invite_code_hash: createHash('sha256').update(inviteCode).digest('hex'),
      role,
      expired_at: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return { invitation, inviteCode };
}
