import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RuntimeConfig } from './platform/config/runtime-config.service';
import { AppLogger } from './platform/observability/app-logger.service';

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

void bootstrap().catch(() => {
  /**
   * 启动异常可能携带数据库或 Redis 连接串，因此标准错误只输出固定提示，不直接打印
   * 原始异常、配置值或堆栈。
   */
  process.stderr.write(
    'API startup failed; check configuration and infrastructure connectivity.\n',
  );
  process.exitCode = 1;
});
