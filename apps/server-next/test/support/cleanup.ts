import { PrismaService } from '@platform/database/prisma.service';
import { RedisService } from '@platform/redis/redis.service';
import { TestRun } from './test-run';

/** 只删除本次运行登记的资源，失败时保留 runId 供后续定位。 */
export async function cleanupTestRun(
  db: PrismaService,
  run: TestRun,
  redis?: RedisService,
) {
  try {
    const knowledgeBaseIds = [...run.resources.knowledgeBaseIds];
    const userIds = [...run.resources.userIds];
    if (knowledgeBaseIds.length) {
      await db.b_kb_invitations.deleteMany({
        where: { kb_id: { in: knowledgeBaseIds } },
      });
      await db.b_kb_members.deleteMany({
        where: { kb_id: { in: knowledgeBaseIds } },
      });
      await db.b_upload_sessions.deleteMany({
        where: { kb_id: { in: knowledgeBaseIds } },
      });
      await db.b_knowledge_bases.deleteMany({
        where: { id: { in: knowledgeBaseIds } },
      });
    }
    if (userIds.length) {
      await db.b_user_sessions.deleteMany({
        where: { user_id: { in: userIds } },
      });
      await db.b_users.deleteMany({ where: { id: { in: userIds } } });
    }
    const emails = [...run.resources.emailAddresses];
    if (emails.length)
      await db.sys_email_codes.deleteMany({ where: { email: { in: emails } } });
    if (redis) {
      for (const key of run.resources.redisKeys) await redis.delete(key);
    }
  } catch (error) {
    console.error(
      `[server-next test] cleanup failed; runId=${run.runId}. ` +
        'Only this run resource registry was targeted.',
    );
    throw error;
  }
}
