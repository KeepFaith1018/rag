import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from '../config/runtime-config.module';
import { ElasticsearchService } from './search.service';

@Module({
  imports: [RuntimeConfigModule],
  providers: [ElasticsearchService],
  exports: [ElasticsearchService],
})
export class SearchModule {}
