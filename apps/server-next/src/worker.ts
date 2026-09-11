import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { AppLogger } from './platform/observability/app-logger.service';
import {
  shouldIncludeStack,
  writeStartupFailure,
} from './platform/observability/startup-log';

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

void bootstrap().catch((error) => {
  /**
   * 与 API 启动失败策略一致：开发环境在终端和日志文件显示堆栈，生产环境不记录原始异常。
   */
  const message =
    'Worker startup failed; check configuration and infrastructure connectivity.';
  writeStartupFailure(message, error);
  const stack =
    shouldIncludeStack() && error instanceof Error && error.stack
      ? `\n${error.stack}`
      : '';
  process.stderr.write(`${message}${stack}\n`);
  process.exit(1);
});
