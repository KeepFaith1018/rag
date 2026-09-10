import { Test } from '@nestjs/testing';
import { AppModule } from '@app/app.module';
import { HealthController } from '@app/modules/health/health.controller';
import { WorkerModule } from '@app/worker.module';
import { PrismaService } from '@platform/database/prisma.service';
import { RedisService } from '@platform/redis/redis.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';

/**
 * 该测试只通过显式集成测试命令运行，会连接已配置的基础设施，但不会修改业务数据。
 */
describe('real infrastructure composition', () => {
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
