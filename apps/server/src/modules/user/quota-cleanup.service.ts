import { Injectable, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { PrismaService } from '@common/prisma/prisma.service';

/**
 * 定期清理历史用户每日配额记录。
 *
 * 每天凌晨 4:30 执行，删除超过 90 天的历史配额数据。
 * 分批删除避免长事务，与 SessionCleanupService 保持一致。
 */
@Injectable()
export class QuotaCleanupService {
  private readonly BATCH_SIZE = 1000;
  private readonly RETENTION_DAYS = 90;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  @Cron('30 4 * * *')
  async cleanupExpiredQuotas() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.RETENTION_DAYS);

    let total = 0;

    while (true) {
      const result = await this.prisma.b_user_daily_quotas.deleteMany({
        where: {
          quota_date: { lt: cutoffDate },
        },
        limit: this.BATCH_SIZE,
      });
      total += result.count;
      if (result.count < this.BATCH_SIZE) break;
    }

    if (total > 0) {
      this.logger.info(
        `[QuotaCleanup] Removed ${total} expired quota records (older than ${this.RETENTION_DAYS} days)`,
      );
    }
  }
}
