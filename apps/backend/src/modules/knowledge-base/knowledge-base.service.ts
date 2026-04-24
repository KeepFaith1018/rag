import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma-client';
import { PrismaService } from '@common/prisma/prisma.service';
import {
  BusinessException,
  wrapBusinessException,
} from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto';
import {
  ListKnowledgeBasesDto,
  ListPublicKnowledgeBasesDto,
} from './dto/list-knowledge-bases.dto';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto';
import {
  KnowledgeBaseAccessRole,
  KnowledgeBasePermissionFlags,
} from './interfaces/knowledge-base-access.interface';
import { KbPermissionService } from './permission/kb-permission.service';

type KnowledgeBaseWithRelations = Prisma.b_knowledge_basesGetPayload<{
  include: {
    kb_members: true;
    _count: {
      select: {
        documents: true;
        kb_members: true;
      };
    };
  };
}>;

type ListOwnership = 'owned' | 'joined' | 'all';
type KnowledgeBaseVisibility = 'private' | 'shared';
type PublicSortBy = 'latest' | 'hot';

/**
 * 负责知识库管理相关核心业务逻辑。
 */
@Injectable()
export class KnowledgeBaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kbPermissionService: KbPermissionService,
  ) {}

  /**
   * 创建知识库并返回详情结果。
   */
  async create(userId: number, dto: CreateKnowledgeBaseDto) {
    try {
      const payload = this.normalizeCreatePayload(dto);

      const knowledgeBase = await this.prisma.b_knowledge_bases.create({
        data: {
          name: payload.name,
          description: payload.description,
          visibility: payload.visibility,
          is_public: payload.isPublic,
          allow_public_download: payload.allowPublicDownload,
          owner_id: BigInt(userId),
          status: 'normal',
        },
        include: {
          kb_members: true,
          _count: {
            select: {
              documents: true,
              kb_members: true,
            },
          },
        },
      });

      return this.buildKnowledgeBaseDetail(knowledgeBase, BigInt(userId));
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'KnowledgeBaseService',
          action: 'create',
          userId,
        },
      });
    }
  }

  /**
   * 获取当前用户的知识库列表，兼容 owned / joined / all 三种视图。
   */
  async listMine(userId: number, query: ListKnowledgeBasesDto) {
    try {
      const normalized = this.normalizeListQuery(query);
      const pagination = this.buildPagination(
        normalized.page,
        normalized.pageSize,
      );
      const where = this.buildMineWhere(BigInt(userId), normalized);

      const [items, total] = await this.prisma.$transaction([
        this.prisma.b_knowledge_bases.findMany({
          where,
          include: {
            kb_members: {
              where: {
                user_id: BigInt(userId),
              },
            },
            _count: {
              select: {
                documents: true,
                kb_members: true,
              },
            },
          },
          orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
          skip: pagination.skip,
          take: pagination.take,
        }),
        this.prisma.b_knowledge_bases.count({ where }),
      ]);

      return {
        list: items.map((item) =>
          this.buildKnowledgeBaseListItem(item, BigInt(userId)),
        ),
        pagination: {
          page: normalized.page,
          pageSize: normalized.pageSize,
          total,
        },
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'KnowledgeBaseService',
          action: 'listMine',
          userId,
        },
      });
    }
  }

  /**
   * 获取可公开访问的共享知识库列表。
   */
  async listPublic(userId: number, query: ListPublicKnowledgeBasesDto) {
    try {
      const normalized = this.normalizePublicListQuery(query);
      const pagination = this.buildPagination(
        normalized.page,
        normalized.pageSize,
      );
      const where = this.buildPublicWhere(normalized);
      const orderBy =
        normalized.sortBy === 'hot'
          ? [
              { documents: { _count: 'desc' as const } },
              { updated_at: 'desc' as const },
            ]
          : [{ updated_at: 'desc' as const }, { id: 'desc' as const }];

      const [items, total] = await this.prisma.$transaction([
        this.prisma.b_knowledge_bases.findMany({
          where,
          include: {
            kb_members: {
              where: {
                user_id: BigInt(userId),
              },
            },
            _count: {
              select: {
                documents: true,
                kb_members: true,
              },
            },
          },
          orderBy,
          skip: pagination.skip,
          take: pagination.take,
        }),
        this.prisma.b_knowledge_bases.count({ where }),
      ]);

      return {
        list: items.map((item) =>
          this.buildKnowledgeBaseListItem(item, BigInt(userId)),
        ),
        pagination: {
          page: normalized.page,
          pageSize: normalized.pageSize,
          total,
        },
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'KnowledgeBaseService',
          action: 'listPublic',
          userId,
        },
      });
    }
  }

  /**
   * 获取知识库详情，并校验当前用户是否具有读取权限。
   */
  async detail(userId: number, kbId: string) {
    try {
      const knowledgeBase = await this.getKnowledgeBaseForRead(
        kbId,
        BigInt(userId),
      );
      return this.buildKnowledgeBaseDetail(knowledgeBase, BigInt(userId));
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'KnowledgeBaseService',
          action: 'detail',
          userId,
          kbId,
        },
      });
    }
  }

  /**
   * 更新知识库基础信息。
   */
  async update(userId: number, kbId: string, dto: UpdateKnowledgeBaseDto) {
    try {
      const kbBigIntId = this.parseKnowledgeBaseId(kbId);
      const existing = await this.prisma.b_knowledge_bases.findUnique({
        where: { id: kbBigIntId },
        include: {
          kb_members: true,
          _count: {
            select: {
              documents: true,
              kb_members: true,
            },
          },
        },
      });

      if (!existing) {
        throw new BusinessException(ErrorCode.KNOWLEDGE_NOT_FOUND);
      }

      this.assertOwner(existing.owner_id, BigInt(userId));

      const payload = this.normalizeUpdatePayload(dto, existing);
      // 共享库切回私有库时，需要先保证没有协作者残留。
      if (
        payload.visibility === 'private' &&
        existing.visibility === 'shared' &&
        existing._count.kb_members > 0
      ) {
        throw new BusinessException(
          ErrorCode.PARAM_ERROR,
          '共享知识库存在成员时不能直接切换为私有知识库',
        );
      }

      const updated = await this.prisma.b_knowledge_bases.update({
        where: { id: kbBigIntId },
        data: {
          name: payload.name,
          description: payload.description,
          visibility: payload.visibility,
          is_public: payload.isPublic,
          allow_public_download: payload.allowPublicDownload,
          updated_at: new Date(),
        },
        include: {
          kb_members: true,
          _count: {
            select: {
              documents: true,
              kb_members: true,
            },
          },
        },
      });

      return this.buildKnowledgeBaseDetail(updated, BigInt(userId));
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'KnowledgeBaseService',
          action: 'update',
          userId,
          kbId,
        },
      });
    }
  }

  /**
   * 删除知识库。
   */
  async remove(userId: number, kbId: string) {
    try {
      const kbBigIntId = this.parseKnowledgeBaseId(kbId);
      const existing = await this.prisma.b_knowledge_bases.findUnique({
        where: { id: kbBigIntId },
      });

      if (!existing) {
        throw new BusinessException(ErrorCode.KNOWLEDGE_NOT_FOUND);
      }

      this.assertOwner(existing.owner_id, BigInt(userId));

      await this.prisma.b_knowledge_bases.delete({
        where: { id: kbBigIntId },
      });

      return {
        id: kbId,
        deleted: true,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: {
          module: 'KnowledgeBaseService',
          action: 'remove',
          userId,
          kbId,
        },
      });
    }
  }

  /**
   * 将路由参数中的知识库 ID 转为数据库层统一使用的 bigint。
   */
  private parseKnowledgeBaseId(kbId: string) {
    try {
      return BigInt(kbId);
    } catch {
      throw new BusinessException(
        ErrorCode.PARAM_ERROR,
        '知识库 ID 格式不正确',
      );
    }
  }

  /**
   * 归一化创建入参，并处理私有库场景下的公开字段。
   */
  private normalizeCreatePayload(dto: CreateKnowledgeBaseDto) {
    const visibility = dto.visibility;
    const isPrivate = visibility === 'private';

    return {
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      visibility,
      isPublic: isPrivate ? false : (dto.isPublic ?? false),
      allowPublicDownload: isPrivate
        ? false
        : (dto.allowPublicDownload ?? false),
    };
  }

  /**
   * 归一化更新入参，并延续已有配置的默认值。
   */
  private normalizeUpdatePayload(
    dto: UpdateKnowledgeBaseDto,
    existing: {
      name: string;
      description: string | null;
      visibility: string;
      is_public: boolean;
      allow_public_download: boolean;
    },
  ) {
    const visibility = (dto.visibility ??
      existing.visibility) as KnowledgeBaseVisibility;
    const isPrivate = visibility === 'private';

    return {
      name: dto.name?.trim() ?? existing.name,
      description:
        dto.description !== undefined
          ? dto.description.trim() || null
          : existing.description,
      visibility,
      isPublic: isPrivate ? false : (dto.isPublic ?? existing.is_public),
      allowPublicDownload: isPrivate
        ? false
        : (dto.allowPublicDownload ?? existing.allow_public_download),
    };
  }

  /**
   * 归一化“我的知识库”列表查询参数。
   */
  private normalizeListQuery(query: ListKnowledgeBasesDto) {
    return {
      ownership: (query.ownership ?? 'all') as ListOwnership,
      visibility: query.visibility as KnowledgeBaseVisibility | undefined,
      keyword: query.keyword?.trim(),
      page: query.page ?? 1,
      pageSize: Math.min(query.pageSize ?? 10, 100),
    };
  }

  /**
   * 归一化公开知识库列表查询参数。
   */
  private normalizePublicListQuery(query: ListPublicKnowledgeBasesDto) {
    return {
      keyword: query.keyword?.trim(),
      page: query.page ?? 1,
      pageSize: Math.min(query.pageSize ?? 10, 100),
      sortBy: (query.sortBy ?? 'latest') as PublicSortBy,
    };
  }

  /**
   * 计算分页偏移量。
   */
  private buildPagination(page: number, pageSize: number) {
    return {
      skip: (page - 1) * pageSize,
      take: pageSize,
    };
  }

  private buildMineWhere(
    userId: bigint,
    query: ReturnType<typeof this.normalizeListQuery>,
  ) {
    const conditions: Prisma.b_knowledge_basesWhereInput[] = [];

    // all 视图需要同时覆盖“我创建的”和“我加入的”共享库。
    if (query.ownership === 'owned') {
      conditions.push({ owner_id: userId });
    } else if (query.ownership === 'joined') {
      conditions.push({
        visibility: 'shared',
        kb_members: {
          some: {
            user_id: userId,
          },
        },
      });
    } else {
      conditions.push({
        OR: [
          { owner_id: userId },
          {
            visibility: 'shared',
            kb_members: {
              some: {
                user_id: userId,
              },
            },
          },
        ],
      });
    }

    if (query.visibility) {
      conditions.push({
        visibility: query.visibility,
      });
    }

    // 关键字同时匹配知识库名称和描述字段。
    if (query.keyword) {
      conditions.push({
        OR: [
          {
            name: {
              contains: query.keyword,
            },
          },
          {
            description: {
              contains: query.keyword,
            },
          },
        ],
      });
    }

    return {
      AND: conditions,
    } satisfies Prisma.b_knowledge_basesWhereInput;
  }

  private buildPublicWhere(
    query: ReturnType<typeof this.normalizePublicListQuery>,
  ): Prisma.b_knowledge_basesWhereInput {
    const conditions: Prisma.b_knowledge_basesWhereInput[] = [
      { visibility: 'shared' },
      { is_public: true },
      { status: 'normal' },
    ];

    // 公开检索只允许在公开共享库范围内做名称和描述筛选。
    if (query.keyword) {
      conditions.push({
        OR: [
          {
            name: {
              contains: query.keyword,
            },
          },
          {
            description: {
              contains: query.keyword,
            },
          },
        ],
      });
    }

    return {
      AND: conditions,
    };
  }

  /**
   * 查询详情前统一校验知识库存在性与可读权限。
   */
  private async getKnowledgeBaseForRead(kbId: string, userId: bigint) {
    const knowledgeBase = await this.prisma.b_knowledge_bases.findUnique({
      where: {
        id: this.parseKnowledgeBaseId(kbId),
      },
      include: {
        kb_members: {
          where: {
            user_id: userId,
          },
        },
        _count: {
          select: {
            documents: true,
            kb_members: true,
          },
        },
      },
    });

    if (!knowledgeBase) {
      throw new BusinessException(ErrorCode.KNOWLEDGE_NOT_FOUND);
    }

    const access = this.resolveAccessRole(knowledgeBase, userId);
    if (!access) {
      throw new BusinessException(ErrorCode.KNOWLEDGE_UNAUTHORIZED);
    }

    return knowledgeBase;
  }

  /**
   * 仅允许 owner 执行写操作。
   */
  private assertOwner(ownerId: bigint, userId: bigint) {
    if (ownerId !== userId) {
      throw new BusinessException(ErrorCode.KNOWLEDGE_UNAUTHORIZED);
    }
  }

  /**
   * 根据 owner / manager / collaborator / member / publicVisitor 解析当前用户的访问角色。
   */
  private resolveAccessRole(
    knowledgeBase: {
      owner_id: bigint;
      visibility: string;
      is_public: boolean;
      kb_members: Array<{ user_id: bigint; role: string }>;
    },
    userId: bigint,
  ): KnowledgeBaseAccessRole | null {
    return this.kbPermissionService.resolveAccessRole(knowledgeBase, userId);
  }

  /**
   * 组装列表接口返回的知识库基础信息与权限标记。
   */
  private buildKnowledgeBaseListItem(
    knowledgeBase: KnowledgeBaseWithRelations,
    userId: bigint,
  ) {
    const accessRole = this.resolveListAccessRole(knowledgeBase, userId);
    const visibility = this.normalizeVisibility(knowledgeBase.visibility);
    const isPublic = knowledgeBase.is_public === true;
    const allowPublicDownload = knowledgeBase.allow_public_download === true;
    const memberRole =
      accessRole === 'owner' || accessRole === 'publicVisitor'
        ? null
        : accessRole;

    return {
      id: knowledgeBase.id.toString(),
      name: knowledgeBase.name,
      description: knowledgeBase.description,
      visibility,
      status: knowledgeBase.status,
      isPublic,
      allowPublicDownload,
      ownerId: knowledgeBase.owner_id.toString(),
      documentCount: knowledgeBase._count.documents,
      memberCount: knowledgeBase._count.kb_members + 1,
      createdAt: knowledgeBase.created_at,
      updatedAt: knowledgeBase.updated_at,
      accessRole,
      memberRole,
      permissions: this.buildPermissions(
        accessRole,
        visibility,
        allowPublicDownload,
      ),
    };
  }

  /**
   * 在列表结构基础上补全详情接口的角色与权限信息。
   */
  private buildKnowledgeBaseDetail(
    knowledgeBase: KnowledgeBaseWithRelations,
    userId: bigint,
  ) {
    const accessRole = this.resolveReadableAccessRole(knowledgeBase, userId);
    const visibility = this.normalizeVisibility(knowledgeBase.visibility);
    const allowPublicDownload = knowledgeBase.allow_public_download === true;

    return {
      ...this.buildKnowledgeBaseListItem(knowledgeBase, userId),
      accessRole,
      permissions: this.buildPermissions(
        accessRole,
        visibility,
        allowPublicDownload,
      ),
    };
  }

  /**
   * 按访问角色生成前端可直接消费的权限集合。
   */
  private buildPermissions(
    accessRole: KnowledgeBaseAccessRole,
    visibility: KnowledgeBaseVisibility,
    allowPublicDownload: boolean,
  ): KnowledgeBasePermissionFlags {
    return this.kbPermissionService.buildPermissions(
      accessRole,
      visibility,
      allowPublicDownload,
    );
  }

  /**
   * 将 Prisma 返回的可见性字段收敛为服务层稳定使用的字符串值。
   */
  private normalizeVisibility(value: unknown): KnowledgeBaseVisibility {
    return this.kbPermissionService.normalizeVisibility(value);
  }

  /**
   * 列表接口中的数据来源已提前受查询条件约束，因此这里兜底收敛为可展示角色。
   */
  private resolveListAccessRole(
    knowledgeBase: KnowledgeBaseWithRelations,
    userId: bigint,
  ): KnowledgeBaseAccessRole {
    return this.resolveAccessRole(knowledgeBase, userId) ?? 'publicVisitor';
  }

  /**
   * 详情接口在返回前必须明确访问角色，避免后续权限派生出现空值分支。
   */
  private resolveReadableAccessRole(
    knowledgeBase: KnowledgeBaseWithRelations,
    userId: bigint,
  ): KnowledgeBaseAccessRole {
    const accessRole = this.resolveAccessRole(knowledgeBase, userId);
    if (!accessRole) {
      throw new BusinessException(ErrorCode.KNOWLEDGE_UNAUTHORIZED);
    }

    return accessRole;
  }
}
