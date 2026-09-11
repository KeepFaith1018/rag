import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { BusinessError } from '../../shared/errors/business-error';
import { ErrorCode } from '../../shared/errors/error-code';
import { parseId } from '../../shared/parse-id';
import type { Principal } from '../identity/contracts/principal';
import { CurrentPrincipal } from '../identity/http/current-principal.decorator';
import { ConfirmPartDto } from './dto/confirm-part.dto';
import { InitUploadDto } from './dto/init-upload.dto';
import { ListDocumentsDto } from './dto/list-documents.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { DocumentsService } from './services/documents.service';
import { UploadsService } from './services/uploads.service';

@Controller()
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly uploads: UploadsService,
  ) {}

  @Post('knowledge-bases/:kbId/uploads')
  initUpload(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
    @Body() dto: InitUploadDto,
  ) {
    return this.uploads.init(parseId(principal.userId), kbId, dto);
  }

  @Get('knowledge-bases/:kbId/uploads/:sessionId')
  uploadStatus(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.uploads.status(parseId(principal.userId), kbId, sessionId);
  }

  @Post('knowledge-bases/:kbId/uploads/:sessionId/parts/:partNumber/sign')
  signPart(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
    @Param('sessionId') sessionId: string,
    @Param('partNumber') partNumber: string,
  ) {
    return this.uploads.signPart(
      parseId(principal.userId),
      kbId,
      sessionId,
      this.partNumber(partNumber),
    );
  }

  @Post('knowledge-bases/:kbId/uploads/:sessionId/parts/:partNumber/confirm')
  confirmPart(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
    @Param('sessionId') sessionId: string,
    @Param('partNumber') partNumber: string,
    @Body() dto: ConfirmPartDto,
  ) {
    return this.uploads.confirmPart(
      parseId(principal.userId),
      kbId,
      sessionId,
      this.partNumber(partNumber),
      dto,
    );
  }

  @Post('knowledge-bases/:kbId/uploads/:sessionId/complete')
  complete(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.uploads.complete(parseId(principal.userId), kbId, sessionId);
  }

  @Delete('knowledge-bases/:kbId/uploads/:sessionId')
  @HttpCode(200)
  abort(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.uploads.abort(parseId(principal.userId), kbId, sessionId);
  }

  @Get('knowledge-bases/:kbId/documents')
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
    @Query() query: ListDocumentsDto,
  ) {
    return this.documents.list(parseId(principal.userId), kbId, query);
  }

  @Get('knowledge-bases/:kbId/documents/:documentId')
  detail(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documents.detail(parseId(principal.userId), kbId, documentId);
  }

  @Patch('knowledge-bases/:kbId/documents/:documentId')
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
    @Param('documentId') documentId: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return this.documents.update(
      parseId(principal.userId),
      kbId,
      documentId,
      dto,
    );
  }

  @Get('knowledge-bases/:kbId/documents/:documentId/preview')
  async preview(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
    @Param('documentId') documentId: string,
  ) {
    const payload = await this.documents.preview(
      parseId(principal.userId),
      kbId,
      documentId,
    );
    return new StreamableFile(payload.stream, {
      type: payload.mimeType,
      disposition: payload.disposition,
    });
  }

  @Get('knowledge-bases/:kbId/documents/:documentId/download')
  async download(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
    @Param('documentId') documentId: string,
  ) {
    const payload = await this.documents.download(
      parseId(principal.userId),
      kbId,
      documentId,
    );
    return new StreamableFile(payload.stream, {
      type: payload.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(payload.fileName)}"`,
    });
  }

  @Delete('knowledge-bases/:kbId/documents/:documentId')
  @HttpCode(200)
  remove(
    @CurrentPrincipal() principal: Principal,
    @Param('kbId') kbId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documents.remove(parseId(principal.userId), kbId, documentId);
  }

  private partNumber(value: string) {
    if (!/^[1-9]\d{0,8}$/.test(value))
      throw new BusinessError(
        ErrorCode.DOCUMENT_UPLOAD_PART_INVALID,
        '分片编号不合法',
        'validation',
      );
    return Number(value);
  }
}
