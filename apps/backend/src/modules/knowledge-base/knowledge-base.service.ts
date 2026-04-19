import { Inject, Injectable } from '@nestjs/common';
import { CreateKbDto } from './dto/create-kb.dto';
import { UpdateKbDto } from './dto/update-kb.dto';
import { QueryKbDto } from './dto/query-kb.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { Prisma } from '@prisma/client';

@Injectable()
export class KnowledgeBaseService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /**
   * 创建知识库
   * @param userId 当前登录用户ID
   * @param createKbDto 创建参数
   */
  async create(userId: number, createKbDto: CreateKbDto): Promise<any> {
    const kb = await this.prisma.knowledge_bases.create({
      data: {
        name: createKbDto.name,
        description: createKbDto.description ?? null,
        type: createKbDto.type,
        visibility: createKbDto.visibility,
        owner_id: BigInt(userId),
      },
    });

    this.logger.info('创建知识库', {
      kbId: Number(kb.id),
      ownerId: Number(kb.owner_id),
    });

    return {
      id: Number(kb.id),
      name: kb.name,
      type: kb.type,
      visibility: kb.visibility,
      owner_id: Number(kb.owner_id),
      created_at: kb.created_at,
    };
  }

  /**
   * 获取当前用户的知识库列表
   * @param userId 当前登录用户ID
   * @param query 查询参数
   */
  async findAll(userId: number, query: QueryKbDto): Promise<any> {
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Number(query.page_size) > 0 ? Number(query.page_size) : 10;
    const skip = (page - 1) * pageSize;

    const where: Prisma.knowledge_basesWhereInput = {
      OR: [
        { owner_id: BigInt(userId) },
        {
          kb_members: {
            some: {
              user_id: BigInt(userId),
            },
          },
        },
      ],
    };

    if (query.type) {
      where.type = query.type;
    }

    const [total, list] = await this.prisma.$transaction([
      this.prisma.knowledge_bases.count({ where }),
      this.prisma.knowledge_bases.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { created_at: 'desc' },
        include: {
          _count: {
            select: {
              documents: true,
            },
          },
          sys_users: {
            select: {
              full_name: true,
            },
          },
        },
      }),
    ]);

    const items = list.map((kb) => ({
      id: Number(kb.id),
      name: kb.name,
      type: kb.type,
      visibility: kb.visibility,
      owner_id: Number(kb.owner_id),
      owner_name: kb.sys_users?.full_name ?? null,
      doc_count: kb._count.documents,
      created_at: kb.created_at,
    }));

    return {
      items,
      total,
    };
  }

  /**
   * 获取公有知识库列表
   * @param query 查询参数（分页）
   */
  async findPublic(query: QueryKbDto): Promise<any> {
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Number(query.page_size) > 0 ? Number(query.page_size) : 10;
    const skip = (page - 1) * pageSize;

    const where = {
      visibility: 'public',
      type: 'shared',
    };

    const [total, list] = await this.prisma.$transaction([
      this.prisma.knowledge_bases.count({ where }),
      this.prisma.knowledge_bases.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { created_at: 'desc' },
        include: {
          _count: {
            select: {
              documents: true,
            },
          },
          sys_users: {
            select: {
              full_name: true,
            },
          },
        },
      }),
    ]);

    const items = list.map((kb) => ({
      id: Number(kb.id),
      name: kb.name,
      type: kb.type,
      visibility: kb.visibility,
      owner_id: Number(kb.owner_id),
      owner_name: kb.sys_users?.full_name ?? null,
      doc_count: kb._count.documents,
      created_at: kb.created_at,
    }));

    return {
      items,
      total,
    };
  }

  /**
   * 获取知识库详情
   * @param id 知识库ID
   * @param userId 当前登录用户ID
   */
  async findOne(id: number, userId: number): Promise<any> {
    const kb = await this.prisma.knowledge_bases.findUnique({
      where: { id: BigInt(id) },
      include: {
        kb_members: {
          where: {
            user_id: BigInt(userId),
          },
        },
      },
    });

    if (!kb) {
      throw new BusinessException(ErrorCode.KNOWLEDGE_NOT_FOUND);
    }

    let currentRole: string | null = null;
    if (kb.owner_id === BigInt(userId)) {
      currentRole = 'owner';
    } else if (kb.kb_members.length > 0) {
      currentRole = kb.kb_members[0].role;
    }

    if (kb.visibility === 'private' && !currentRole) {
      throw new BusinessException(ErrorCode.KNOWLEDGE_UNAUTHORIZED);
    }

    return {
      id: Number(kb.id),
      name: kb.name,
      description: kb.description,
      type: kb.type,
      visibility: kb.visibility,
      status: kb.status,
      owner_id: Number(kb.owner_id),
      created_at: kb.created_at,
      updated_at: kb.updated_at,
      current_role: currentRole,
    };
  }

  /**
   * 更新知识库
   * @param id 知识库ID
   * @param userId 当前登录用户ID
   * @param updateKbDto 更新参数
   */
  async update(
    id: number,
    userId: number,
    updateKbDto: UpdateKbDto,
  ): Promise<any> {
    const kb = await this.prisma.knowledge_bases.findUnique({
      where: { id: BigInt(id) },
    });

    if (!kb) {
      throw new BusinessException(ErrorCode.KNOWLEDGE_NOT_FOUND);
    }

    if (kb.owner_id !== BigInt(userId)) {
      throw new BusinessException(ErrorCode.KNOWLEDGE_UNAUTHORIZED);
    }

    const updated = await this.prisma.knowledge_bases.update({
      where: { id: BigInt(id) },
      data: {
        name: updateKbDto.name ?? kb.name,
        description: updateKbDto.description ?? kb.description,
        visibility: updateKbDto.visibility ?? kb.visibility,
      },
    });

    this.logger.info('更新知识库', {
      kbId: Number(updated.id),
      ownerId: Number(updated.owner_id),
    });

    return {
      id: Number(updated.id),
      name: updated.name,
      description: updated.description,
      type: updated.type,
      visibility: updated.visibility,
      status: updated.status,
      owner_id: Number(updated.owner_id),
      created_at: updated.created_at,
      updated_at: updated.updated_at,
      current_role: 'owner',
    };
  }

  /**
   * 删除知识库
   * @param id 知识库ID
   * @param userId 当前登录用户ID
   */
  async remove(id: number, userId: number): Promise<any> {
    const kb = await this.prisma.knowledge_bases.findUnique({
      where: { id: BigInt(id) },
    });

    if (!kb) {
      throw new BusinessException(ErrorCode.KNOWLEDGE_NOT_FOUND);
    }

    if (kb.owner_id !== BigInt(userId)) {
      throw new BusinessException(ErrorCode.KNOWLEDGE_UNAUTHORIZED);
    }

    await this.prisma.knowledge_bases.delete({
      where: { id: BigInt(id) },
    });

    this.logger.info('删除知识库', {
      kbId: id,
      ownerId: userId,
    });

    return {
      message: '知识库删除成功',
    };
  }
}
