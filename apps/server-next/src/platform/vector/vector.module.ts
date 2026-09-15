import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from '../config/runtime-config.module';
import { QdrantService } from './vector.service';

@Module({
  imports: [RuntimeConfigModule],
  providers: [QdrantService],
  exports: [QdrantService],
})
export class VectorModule {}
