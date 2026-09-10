import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from '../config/runtime-config.module';
import { ObservabilityModule } from '../observability/observability.module';
import { RedisService } from './redis.service';

@Module({
  imports: [RuntimeConfigModule, ObservabilityModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
