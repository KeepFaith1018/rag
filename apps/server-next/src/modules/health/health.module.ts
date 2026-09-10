import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';
import { RedisModule } from '../../platform/redis/redis.module';
import { HealthController } from './health.controller';

/** 组装 API 健康检查及其基础设施依赖。 */
@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [HealthController],
})
export class HealthModule {}
