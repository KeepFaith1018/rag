import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from './platform/config/runtime-config.module';
import { DatabaseModule } from './platform/database/database.module';
import { ObservabilityModule } from './platform/observability/observability.module';
import { RedisModule } from './platform/redis/redis.module';

/**
 * Worker 进程的根组合模块。
 *
 * 当前只装配配置、日志、数据库和 Redis 基础设施，为后续队列消费者及后台任务提供独立
 * 进程边界；尚未注册定时器或业务消费者。
 */
@Module({
  imports: [
    RuntimeConfigModule,
    ObservabilityModule,
    DatabaseModule,
    RedisModule,
  ],
})
export class WorkerModule {}
