import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { AppLogger } from './platform/observability/app-logger.service';

/**
 * 启动不监听 HTTP 端口的 Worker 应用上下文。
 * 统一日志和关闭钩子与 API 进程保持一致，便于后续安全接入队列消费者。
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
    abortOnError: false,
  });
  app.useLogger(app.get(AppLogger));
  app.enableShutdownHooks();
  app
    .get(AppLogger)
    .log('Worker context started; no business consumers registered in P1');
}

void bootstrap().catch(() => {
  /**
   * 与 API 启动失败策略一致，不直接输出可能包含基础设施凭证的原始异常。
   */
  process.stderr.write(
    'Worker startup failed; check configuration and infrastructure connectivity.\n',
  );
  process.exit(1);
});
