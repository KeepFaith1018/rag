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
import { KnowledgeBaseService } from './knowledge-base.service';
import { CreateKbDto } from './dto/create-kb.dto';
import { UpdateKbDto } from './dto/update-kb.dto';
import { QueryKbDto } from './dto/query-kb.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/currentUser.decorator';
import { Auth } from '../../common/decorators/auth.decorator';

@Controller('knowledge-bases')
@UseGuards(AuthGuard)
export class KnowledgeBaseController {
  constructor(private readonly knowledgeBaseService: KnowledgeBaseService) {}

  /**
   * 创建知识库
   * @param userId 当前登录用户ID
   * @param createKbDto 创建参数
   */
  @Post()
  @Auth()
  async create(
    @CurrentUser('sub') userId: string,
    @Body() createKbDto: CreateKbDto,
  ): Promise<any> {
    return this.knowledgeBaseService.create(Number(userId), createKbDto);
  }

  /**
   * 获取当前用户的知识库列表
   * @param userId 当前登录用户ID
   * @param query 查询参数
   */
  @Get()
  @Auth()
  async findAll(
    @CurrentUser('sub') userId: string,
    @Query() query: QueryKbDto,
  ): Promise<any> {
    return this.knowledgeBaseService.findAll(Number(userId), query);
  }

  /**
   * 获取公有知识库列表（无需登录）
   * @param query 查询参数
   */
  @Get('public')
  async findPublic(@Query() query: QueryKbDto): Promise<any> {
    return this.knowledgeBaseService.findPublic(query);
  }

  /**
   * 获取知识库详情
   * @param id 知识库ID
   * @param userId 当前登录用户ID
   */
  @Get(':id')
  @Auth()
  async findOne(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
  ): Promise<any> {
    return this.knowledgeBaseService.findOne(Number(id), Number(userId));
  }

  /**
   * 更新知识库
   * @param id 知识库ID
   * @param userId 当前登录用户ID
   * @param updateKbDto 更新参数
   */
  @Patch(':id')
  @Auth()
  async update(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body() updateKbDto: UpdateKbDto,
  ): Promise<any> {
    return this.knowledgeBaseService.update(
      Number(id),
      Number(userId),
      updateKbDto,
    );
  }

  /**
   * 删除知识库
   * @param id 知识库ID
   * @param userId 当前登录用户ID
   */
  @Delete(':id')
  @Auth()
  async remove(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
  ): Promise<any> {
    return this.knowledgeBaseService.remove(Number(id), Number(userId));
  }
}
