import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RuntimeConfig } from './platform/config/runtime-config.service';
import { AppLogger } from './platform/observability/app-logger.service';
import {
  shouldIncludeStack,
  writeStartupFailure,
} from './platform/observability/startup-log';

/**
 * 启动 API 进程并完成仅属于网络入口的配置。
 *
 * 日志在 Nest 初始化期间先缓冲，依赖注入容器就绪后切换为 AppLogger；异常路径会先关闭
 * 已创建的应用资源，再交由最外层启动失败处理器设置退出状态。
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    abortOnError: false,
  });
  try {
    const config = app.get(RuntimeConfig);
    app.useLogger(app.get(AppLogger));
    app.setGlobalPrefix('api');
    app.enableCors({
      origin: config.http.origins,
      credentials: true,
      exposedHeaders: ['x-request-id'],
    });
    app.enableShutdownHooks();
    await app.listen(config.http.port, config.http.host);
  } catch (error) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch((error) => {
  /**
   * 标准错误在开发环境附带堆栈，生产环境只输出固定提示；堆栈同时写入开发日志文件。
   */
  const message =
    'API startup failed; check configuration and infrastructure connectivity.';
  writeStartupFailure(message, error);
  const stack =
    shouldIncludeStack() && error instanceof Error && error.stack
      ? `\n${error.stack}`
      : '';
  process.stderr.write(`${message}${stack}\n`);
  process.exitCode = 1;
});
