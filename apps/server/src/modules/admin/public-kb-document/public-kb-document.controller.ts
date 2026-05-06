import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { PublicKbDocumentService } from './public-kb-document.service';
import { ListPublicKbDocumentsDto } from './dto/list-public-kb-documents.dto';
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { AdminAuth } from '../decorators/admin-auth.decorator';

@Controller('public-kb/:kbId/documents')
@UseGuards(AdminAuthGuard)
@AdminAuth()
export class PublicKbDocumentController {
  constructor(private readonly publicKbDocumentService: PublicKbDocumentService) {}

  @Get()
  findByKbId(
    @Param('kbId') kbId: string,
    @Query() query: ListPublicKbDocumentsDto,
  ) {
    return this.publicKbDocumentService.findByKbId(kbId, query);
  }
}
