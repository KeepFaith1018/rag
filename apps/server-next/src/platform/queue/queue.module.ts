import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from '../config/runtime-config.module';
import { ProcessingQueueService } from './queue.service';
import { ProcessingPubSubService } from './pubsub.service';

@Module({
  imports: [RuntimeConfigModule],
  providers: [ProcessingQueueService, ProcessingPubSubService],
  exports: [ProcessingQueueService, ProcessingPubSubService],
})
export class ProcessingQueueModule {}
