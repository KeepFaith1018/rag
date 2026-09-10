import { Test } from '@nestjs/testing';
import { AppModule } from '@app/app.module';
import { HealthController } from '@app/modules/health/health.controller';
import { WorkerModule } from '@app/worker.module';
import { PrismaService } from '@platform/database/prisma.service';
import { RedisService } from '@platform/redis/redis.service';

describe('API/Worker composition without downstream modules', () => {
  it.each([AppModule, WorkerModule])(
    'initializes and releases %p independently',
    async (rootModule) => {
      const database = {
        ping: jest.fn().mockResolvedValue(undefined),
        onModuleDestroy: jest.fn(),
      };
      const redis = {
        ping: jest.fn().mockResolvedValue(undefined),
        onModuleDestroy: jest.fn(),
      };
      const context = await Test.createTestingModule({ imports: [rootModule] })
        .overrideProvider(PrismaService)
        .useValue(database)
        .overrideProvider(RedisService)
        .useValue(redis)
        .compile();
      try {
        await context.init();
        if (rootModule === AppModule) {
          const health = context.get(HealthController);
          expect(health.live()).toMatchObject({ status: 'ok' });
          expect(await health.ready()).toMatchObject({
            checks: { database: 'up', redis: 'up' },
          });
          redis.ping.mockRejectedValueOnce(new Error('redis down'));
          await expect(health.ready()).rejects.toMatchObject({
            code: 50300,
            kind: 'unavailable',
          });
        } else {
          expect(() => context.get(HealthController)).toThrow();
        }
      } finally {
        await context.close();
      }
      expect(database.onModuleDestroy).toHaveBeenCalledTimes(1);
      expect(redis.onModuleDestroy).toHaveBeenCalledTimes(1);
    },
  );
});
