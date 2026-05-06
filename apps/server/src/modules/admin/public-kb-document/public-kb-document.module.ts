import { Module } from '@nestjs/common';
import { PublicKbDocumentController } from './public-kb-document.controller';
import { PublicKbDocumentService } from './public-kb-document.service';

@Module({
  controllers: [PublicKbDocumentController],
  providers: [PublicKbDocumentService],
})
export class PublicKbDocumentModule {}
