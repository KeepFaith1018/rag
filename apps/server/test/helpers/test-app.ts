/// <reference types="jest" />

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';

/**
 * 创建用于 E2E 测试的最小 NestJS 应用实例。
 *
 * 不加载完整 AppModule，而是按需导入模块，避免外部依赖（数据库/Qdrant/Redis）阻断测试。
 * 每个 describe 中根据需要 override 具体 provider。
 */
export async function createTestApp(
  options: {
    imports?: any[];
    providers?: any[];
    override?: Array<{ provide: unknown; useValue: unknown }>;
  } = {},
): Promise<{ app: INestApplication; module: TestingModule }> {
  const builder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      EventEmitterModule.forRoot(),
      ScheduleModule.forRoot(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      ...(options.imports || []),
    ],
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    providers: [...(options.providers || [])],
  });

  if (options.override) {
    for (const item of options.override) {
      builder.overrideProvider(item.provide).useValue(item.useValue);
    }
  }

  const module = await builder.compile();
  const app = module.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  await app.init();
  return { app, module };
}
