import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Auth } from '@common/decorators/auth.decorator';
import { CurrentUser } from '@common/decorators/currentUser.decorator';
import { AuthGuard } from '@common/guards/auth.guard';
import { KbPermission } from '../knowledge-base/permission/kb-permission.decorator';
import { KbPermissionGuard } from '../knowledge-base/permission/kb-permission.guard';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitUploadDto } from './dto/init-upload.dto';
import { UploadChunkDto } from './dto/upload-chunk.dto';
import { UploadService } from './upload.service';

type UploadedChunkFile = {
  buffer: Buffer;
  size: number;
  originalname: string;
  mimetype: string;
};

/**
 * 分片上传接口控制器。
 */
@Controller()
@UseGuards(AuthGuard, KbPermissionGuard)
@Auth()
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  /**
   * 初始化上传会话，并返回断点续传所需状态。
   */
  @Post('knowledge-bases/:kbId/uploads/init')
  @KbPermission({ action: 'uploadDocument' })
  init(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
    @Body() dto: InitUploadDto,
  ) {
    return this.uploadService.init(Number(userId), kbId, dto);
  }

  /**
   * 上传单个分片。
   */
  @Post('knowledge-bases/:kbId/uploads/:uploadId/chunks')
  @KbPermission({ action: 'uploadDocument' })
  @UseInterceptors(FileInterceptor('file'))
  uploadChunk(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
    @Param('uploadId') uploadId: string,
    @UploadedFile() file: UploadedChunkFile | undefined,
    @Body() dto: UploadChunkDto,
  ) {
    return this.uploadService.uploadChunk(
      Number(userId),
      kbId,
      uploadId,
      file,
      dto,
    );
  }

  /**
   * 查询上传会话状态，用于断点续传恢复。
   */
  @Get('knowledge-bases/:kbId/uploads/:uploadId/status')
  @KbPermission({ action: 'uploadDocument' })
  getStatus(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
    @Param('uploadId') uploadId: string,
  ) {
    return this.uploadService.getStatus(Number(userId), kbId, uploadId);
  }

  /**
   * 完成上传并在服务端执行分片合并。
   */
  @Post('knowledge-bases/:kbId/uploads/:uploadId/complete')
  @KbPermission({ action: 'uploadDocument' })
  complete(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
    @Param('uploadId') uploadId: string,
    @Body() dto: CompleteUploadDto,
  ) {
    return this.uploadService.complete(Number(userId), kbId, uploadId, dto);
  }

  /**
   * 取消上传会话并清理临时文件。
   */
  @Delete('knowledge-bases/:kbId/uploads/:uploadId')
  @KbPermission({ action: 'uploadDocument' })
  cancel(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
    @Param('uploadId') uploadId: string,
  ) {
    return this.uploadService.cancel(Number(userId), kbId, uploadId);
  }
}
