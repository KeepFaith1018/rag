import { Controller, Param, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthGuard } from '@common/guards/auth.guard';
import { Auth } from '@common/decorators/auth.decorator';
import { SkipResponseTransform } from '@common/decorators/skip-response-transform.decorator';
import { KbPermissionGuard } from '../knowledge-base/permission/kb-permission.guard';
import { KbPermission } from '../knowledge-base/permission/kb-permission.decorator';
import { DocumentSseService } from './services/document-sse.service';

/**
 * SSE 端点控制器，用于实时推送文档处理状态变更。
 * GET /api/knowledge-bases/:kbId/documents/stream?token=<jwt>
 */
@Controller()
@UseGuards(AuthGuard, KbPermissionGuard)
@Auth()
@SkipResponseTransform()
export class DocumentSseController {
  constructor(private readonly documentSseService: DocumentSseService) {}

  @Sse('knowledge-bases/:kbId/documents/stream')
  @KbPermission({ action: 'read' })
  streamDocuments(
    @Param('kbId') kbId: string,
  ): Observable<MessageEvent> {
    return this.documentSseService.subscribe(kbId);
  }
}
