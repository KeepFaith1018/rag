import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Auth } from '@common/decorators/auth.decorator';
import { CurrentUser } from '@common/decorators/currentUser.decorator';
import { AuthGuard } from '@common/guards/auth.guard';
import { KbPermission } from './permission/kb-permission.decorator';
import { KbPermissionGuard } from './permission/kb-permission.guard';
import { KnowledgeBaseService } from './knowledge-base.service';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import {
  ListKnowledgeBasesDto,
  ListPublicKnowledgeBasesDto,
} from './dto/list-knowledge-bases.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto';

/**
 * 知识库管理接口控制器。
 */
@Controller()
@UseGuards(AuthGuard, KbPermissionGuard)
@Auth()
export class KnowledgeBaseController {
  constructor(private readonly knowledgeBaseService: KnowledgeBaseService) {}

  /**
   * 创建知识库。
   */
  @Post('knowledge-bases')
  create(
    @CurrentUser('sub') userId: string,
    @Body() createKnowledgeBaseDto: CreateKnowledgeBaseDto,
  ) {
    return this.knowledgeBaseService.create(
      Number(userId),
      createKnowledgeBaseDto,
    );
  }

  /**
   * 获取当前登录用户可见的知识库列表。
   */
  @Get('knowledge-bases')
  listMine(
    @CurrentUser('sub') userId: string,
    @Query() query: ListKnowledgeBasesDto,
  ) {
    return this.knowledgeBaseService.listMine(Number(userId), query);
  }

  /**
   * 获取公开共享知识库列表。
   */
  @Get('public/knowledge-bases')
  listPublic(
    @CurrentUser('sub') userId: string,
    @Query() query: ListPublicKnowledgeBasesDto,
  ) {
    return this.knowledgeBaseService.listPublic(Number(userId), query);
  }

  /**
   * 获取单个知识库详情。
   */
  @Get('knowledge-bases/:kbId')
  @KbPermission({ action: 'read' })
  detail(@CurrentUser('sub') userId: string, @Param('kbId') kbId: string) {
    return this.knowledgeBaseService.detail(Number(userId), kbId);
  }

  /**
   * 更新知识库基础信息。
   */
  @Patch('knowledge-bases/:kbId')
  @KbPermission({ action: 'manageKnowledgeBase' })
  update(
    @CurrentUser('sub') userId: string,
    @Param('kbId') kbId: string,
    @Body() updateKnowledgeBaseDto: UpdateKnowledgeBaseDto,
  ) {
    return this.knowledgeBaseService.update(
      Number(userId),
      kbId,
      updateKnowledgeBaseDto,
    );
  }

  /**
   * 删除指定知识库。
   */
  @Delete('knowledge-bases/:kbId')
  @KbPermission({ action: 'manageKnowledgeBase' })
  remove(@CurrentUser('sub') userId: string, @Param('kbId') kbId: string) {
    return this.knowledgeBaseService.remove(Number(userId), kbId);
  }
}
