import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Auth } from '@common/decorators/auth.decorator';
import { CurrentUser } from '@common/decorators/currentUser.decorator';
import { AuthGuard } from '@common/guards/auth.guard';
import { KbPermission } from '../knowledge-base/permission/kb-permission.decorator';
import { KbPermissionGuard } from '../knowledge-base/permission/kb-permission.guard';
import { ListDocumentProcessingTasksDto } from './dto/list-document-processing-tasks.dto';
import { ListDocumentsDto } from './dto/list-documents.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { DocumentService } from './document.service';

type UploadedDocumentFile = {
  buffer: Buffer;
  size: number;
  originalname: string;
  mimetype: string;
};

/**
 * 知识库文档管理接口控制器。
 */
@Controller()
@UseGuards(AuthGuard, KbPermissionGuard)
@Auth()
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  /**
   * 上传知识库文档。
   */
  @Post('knowledge-bases/:kbId/documents')
  @KbPermission({ action: 'uploadDocument' })
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @Body() uploadDocumentDto: UploadDocumentDto,
  ) {
    return this.documentService.upload(
      Number(userId),
      kbId,
      file,
      uploadDocumentDto,
    );
  }

  /**
   * 获取知识库文档列表。
   */
  @Get('knowledge-bases/:kbId/documents')
  @KbPermission({ action: 'read' })
  list(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
    @Query() query: ListDocumentsDto,
  ) {
    return this.documentService.list(Number(userId), kbId, query);
  }

  /**
   * 获取单个文档详情。
   */
  @Get('knowledge-bases/:kbId/documents/:documentId')
  @KbPermission({ action: 'read' })
  detail(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documentService.detail(Number(userId), kbId, documentId);
  }

  /**
   * 获取指定文档的处理任务记录。
   */
  @Get('knowledge-bases/:kbId/documents/:documentId/processing-tasks')
  @KbPermission({ action: 'read' })
  listProcessingTasks(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
    @Param('documentId') documentId: string,
    @Query() query: ListDocumentProcessingTasksDto,
  ) {
    return this.documentService.listProcessingTasks(
      Number(userId),
      kbId,
      documentId,
      query,
    );
  }

  /**
   * 下载知识库文档原文件。
   */
  @Get('knowledge-bases/:kbId/documents/:documentId/download')
  @KbPermission({ action: 'downloadDocument' })
  async download(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
    @Param('documentId') documentId: string,
    @Res() response: Response,
  ) {
    const payload = await this.documentService.getDownloadPayload(
      Number(userId),
      kbId,
      documentId,
    );

    response.setHeader('Content-Type', payload.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(payload.fileName)}"`,
    );
    payload.stream.pipe(response);
  }

  /**
   * 预览知识库文档（浏览器内渲染）。
   *
   * PDF 使用浏览器原生阅读器，TXT/MD 直接显示文本内容，
   * DOCX 等二进制格式降级为下载。
   */
  @Get('knowledge-bases/:kbId/documents/:documentId/preview')
  @KbPermission({ action: 'read' })
  async preview(
    @Param('kbId') kbId: string,
    @Param('documentId') documentId: string,
    @Res() response: Response,
  ) {
    const payload = await this.documentService.getPreviewPayload(
      kbId,
      documentId,
    );

    response.setHeader('Content-Type', payload.mimeType);
    response.setHeader('Content-Disposition', payload.disposition);
    response.setHeader('Cache-Control', 'private, max-age=3600');
    payload.stream.pipe(response);
  }

  /**
   * 删除知识库文档。
   */
  @Delete('knowledge-bases/:kbId/documents/:documentId')
  @KbPermission({ action: 'deleteAnyDocument', fallback: 'deleteOwnDocument' })
  remove(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documentService.remove(Number(userId), kbId, documentId);
  }

  /**
   * 手动触发文档重解析。
   */
  @Post('knowledge-bases/:kbId/documents/:documentId/reparse')
  @KbPermission({ action: 'reparseAnyDocument', fallback: 'reparseOwnDocument' })
  reparse(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documentService.reparse(Number(userId), kbId, documentId);
  }
}
