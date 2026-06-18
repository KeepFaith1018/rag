import { Injectable, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { PrismaService } from '@common/prisma/prisma.service';

/**
 * 定时清理过期和已吊销的用户/管理员会话。
 *
 * 每天凌晨 4:00 执行，分批删除避免长事务。
 * 清理条件：
 * - expired_at < NOW() （已过期）
 * - revoked = true 且 updated_at < 30天前 （已吊销超过 30 天）
 */
@Injectable()
export class SessionCleanupService {
  private readonly BATCH_SIZE = 1000;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  @Cron('0 4 * * *')
  async cleanupExpiredSessions() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    let total = 0;

    // 清理用户会话
    total += await this.cleanupUserSessions(thirtyDaysAgo);

    // 清理管理员会话
    total += await this.cleanupAdminSessions(thirtyDaysAgo);

    this.logger.info(`[SessionCleanup] Removed ${total} expired session records`);
  }

  private async cleanupUserSessions(thirtyDaysAgo: Date): Promise<number> {
    let total = 0;

    while (true) {
      const result = await this.prisma.b_user_sessions.deleteMany({
        where: {
          OR: [
            { expired_at: { lt: new Date() } },
            { revoked: true, updated_at: { lt: thirtyDaysAgo } },
          ],
        },
        limit: this.BATCH_SIZE,
      });
      total += result.count;
      if (result.count < this.BATCH_SIZE) break;
    }

    return total;
  }

  private async cleanupAdminSessions(thirtyDaysAgo: Date): Promise<number> {
    let total = 0;

    while (true) {
      const result = await this.prisma.sys_admin_sessions.deleteMany({
        where: {
          OR: [
            { expired_at: { lt: new Date() } },
            { revoked: true, updated_at: { lt: thirtyDaysAgo } },
          ],
        },
        limit: this.BATCH_SIZE,
      });
      total += result.count;
      if (result.count < this.BATCH_SIZE) break;
    }

    return total;
  }
}
