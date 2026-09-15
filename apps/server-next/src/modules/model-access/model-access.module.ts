import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';
import { RuntimeConfigModule } from '../../platform/config/runtime-config.module';
import { ModelAccessService } from './model-access.service';

@Module({
  imports: [DatabaseModule, RuntimeConfigModule],
  providers: [ModelAccessService],
  exports: [ModelAccessService],
})
export class ModelAccessModule {}
