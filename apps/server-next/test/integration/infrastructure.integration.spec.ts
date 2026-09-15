import { Test } from '@nestjs/testing';
import { AppModule } from '@app/app.module';
import { HealthController } from '@app/modules/health/health.controller';
import { WorkerModule } from '@app/worker.module';
import { PrismaService } from '@platform/database/prisma.service';
import { RedisService } from '@platform/redis/redis.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';
import { ModelAccessService } from '@app/modules/model-access/model-access.service';
import { OutboxDispatcherService } from '@app/modules/ingestion/jobs/outbox-dispatcher.service';
import { ProcessingTaskWorkerService } from '@app/modules/ingestion/jobs/processing-task-worker.service';
import { CleanupWorkerService } from '@app/modules/ingestion/cleanup/cleanup-worker.service';
import { ProcessingReconcilerService } from '@app/modules/ingestion/jobs/processing-reconciler.service';
import { UploadCompletionRecoveryService } from '@app/modules/ingestion/jobs/upload-completion-recovery.service';
import { RetentionReconcilerService } from '@app/modules/ingestion/cleanup/retention-reconciler.service';

/**
 * 该测试只通过显式集成测试命令运行，会连接已配置的基础设施，但不会修改业务数据。
 */
describe('real infrastructure composition', () => {
  beforeEach(() => {
    // 组合测试只验证真实依赖与装配，不领取或清理已有业务任务。
    for (const service of [
      OutboxDispatcherService,
      ProcessingTaskWorkerService,
      CleanupWorkerService,
      ProcessingReconcilerService,
      UploadCompletionRecoveryService,
      RetentionReconcilerService,
    ])
      jest
        .spyOn(service.prototype, 'onModuleInit')
        .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  it.each([AppModule, WorkerModule])(
    'initializes and closes %p',
    async (rootModule) => {
      const app = await Test.createTestingModule({
        imports: [rootModule],
      }).compile();
      try {
        await app.init();
        const db = app.get(PrismaService);
        await db.ping();
        await app.get(RedisService).ping();
        const rows = await db.$queryRaw<
          Array<{ database_name: string }>
        >`SELECT DATABASE() AS database_name`;
        expect(rows[0].database_name).toBe(
          new URL(app.get(RuntimeConfig).databaseUrl).pathname.slice(1),
        );
        const embedding = await app.get(ModelAccessService).defaultEmbedding();
        expect(embedding.config.dimension).toBeGreaterThan(0);
        expect(embedding.apiKey).toBeTruthy();
        expect(embedding.baseUrl).toBeTruthy();
        if (rootModule === AppModule)
          expect(await app.get(HealthController).ready()).toMatchObject({
            status: 'ok',
          });
      } finally {
        await app.close();
      }
    },
  );
});
