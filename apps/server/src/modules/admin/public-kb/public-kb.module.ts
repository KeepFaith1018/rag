import { Module } from '@nestjs/common';
import { PublicKbController } from './public-kb.controller';
import { PublicKbService } from './public-kb.service';

@Module({
  controllers: [PublicKbController],
  providers: [PublicKbService],
})
export class PublicKbModule {}
