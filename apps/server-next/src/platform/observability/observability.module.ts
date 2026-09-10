import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from '../config/runtime-config.module';
import { AppLogger } from './app-logger.service';
import { ExecutionContextStore } from './execution-context.service';

/**
 * 可观测性基础模块。
 *
 * 统一导出日志服务和异步执行上下文，供 HTTP、数据库、Redis、Worker 及业务模块共享。
 */
@Module({
  imports: [RuntimeConfigModule],
  providers: [AppLogger, ExecutionContextStore],
  exports: [AppLogger, ExecutionContextStore],
})
export class ObservabilityModule {}
