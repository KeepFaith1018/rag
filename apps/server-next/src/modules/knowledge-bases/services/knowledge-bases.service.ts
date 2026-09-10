import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../platform/database/prisma.service';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';
import type {
  KnowledgeBaseAccessRole,
  KnowledgeBaseMemberRole,
  KnowledgeBaseVisibility,
} from '../contracts/knowledge-base-access';
import type {
  CreateKnowledgeBaseDto,
  ListKnowledgeBasesDto,
  ListPublicKnowledgeBasesDto,
  UpdateKnowledgeBaseDto,
} from '../dto/knowledge-base.dto';
import { KnowledgeBaseAccessService } from './knowledge-base-access.service';

type Summary = Prisma.b_knowledge_basesGetPayload<{
  include: {
    kb_members: true;
    _count: { select: { documents: true; kb_members: true } };
  };
}>;

/** 负责知识库生命周期、列表查询及对外摘要映射。 */
@Injectable()
export class KnowledgeBasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: KnowledgeBaseAccessService,
  ) {}

  async create(userId: bigint, dto: CreateKnowledgeBaseDto) {
    this.requireDownloadPolicy(dto.visibility, dto.allowPublicDownload);
    const item = await this.prisma.b_knowledge_bases.create({
      data: {
        owner_id: userId,
        name: dto.name,
        description: dto.description || null,
        visibility: dto.visibility,
        allow_public_download:
          dto.visibility === 'public' && dto.allowPublicDownload === true,
      },
      include: this.summaryInclude(userId),
    });
    return this.map(item, userId);
  }

  async listMine(userId: bigint, query: ListKnowledgeBasesDto) {
    const ownership: Prisma.b_knowledge_basesWhereInput =
      query.ownership === 'owned'
        ? { owner_id: userId }
        : query.ownership === 'joined'
          ? { kb_members: { some: { user_id: userId } } }
          : {
              OR: [
                { owner_id: userId },
                { kb_members: { some: { user_id: userId } } },
              ],
            };
    const where: Prisma.b_knowledge_basesWhereInput = {
      AND: [
        { deleted_at: null },
        ownership,
        ...(query.visibility ? [{ visibility: query.visibility }] : []),
        ...(query.keyword
          ? [
              {
                OR: [
                  { name: { contains: query.keyword } },
                  { description: { contains: query.keyword } },
                ],
              },
            ]
          : []),
      ],
    };
    return this.list(
      userId,
      where,
      query.page,
      query.pageSize,
      this.mineOrder(query.sortBy),
    );
  }

  async listPublic(userId: bigint, query: ListPublicKnowledgeBasesDto) {
    const where: Prisma.b_knowledge_basesWhereInput = {
      deleted_at: null,
      visibility: 'public',
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword } },
              { description: { contains: query.keyword } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.b_knowledge_basesOrderByWithRelationInput[] =
      query.sortBy === 'hot'
        ? [{ documents: { _count: 'desc' } }, { id: 'desc' }]
        : [{ updated_at: 'desc' }, { id: 'desc' }];
    return this.list(userId, where, query.page, query.pageSize, orderBy);
  }

  async detail(userId: bigint, kbId: string) {
    const subject = await this.access.subject(kbId);
    this.access.requireRead(subject, userId);
    const item = await this.prisma.b_knowledge_bases.findUniqueOrThrow({
      where: { id: subject.id },
      include: this.summaryInclude(userId),
    });
    return this.map(item, userId);
  }

  async update(userId: bigint, kbId: string, dto: UpdateKnowledgeBaseDto) {
    return this.prisma.$transaction(async (tx) => {
      const subject = await this.access.subjectForUpdate(kbId, tx);
      this.access.requireOwner(subject, userId);
      const visibility = dto.visibility ?? subject.visibility;
      if (
        dto.visibility &&
        dto.visibility !== subject.visibility &&
        (dto.visibility === 'private' || subject.visibility === 'private')
      )
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_VISIBILITY_CONFLICT,
          '私有知识库创建后不能转换可见性',
          'conflict',
        );
      this.requireDownloadPolicy(visibility, dto.allowPublicDownload);
      const item = await tx.b_knowledge_bases.update({
        where: { id: subject.id },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name }),
          ...(dto.description === undefined
            ? {}
            : { description: dto.description || null }),
          visibility,
          allow_public_download:
            visibility === 'public'
              ? (dto.allowPublicDownload ?? subject.allow_public_download)
              : false,
        },
        include: this.summaryInclude(userId),
      });
      return this.map(item, userId);
    });
  }

  async remove(userId: bigint, kbId: string) {
    return this.prisma.$transaction(async (tx) => {
      const subject = await this.access.subjectForUpdate(kbId, tx);
      this.access.requireOwner(subject, userId);
      const [documents, uploads] = await Promise.all([
        tx.b_documents.count({ where: { kb_id: subject.id } }),
        tx.b_upload_sessions.count({ where: { kb_id: subject.id } }),
      ]);
      if (documents > 0 || uploads > 0)
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_NOT_EMPTY,
          '非空知识库尚不支持删除',
          'conflict',
        );
      const deleted = await tx.b_knowledge_bases.updateMany({
        where: { id: subject.id, owner_id: userId, deleted_at: null },
        data: { deleted_at: new Date() },
      });
      if (deleted.count !== 1)
        throw new BusinessError(
          ErrorCode.KNOWLEDGE_NOT_FOUND,
          '知识库不存在',
          'not-found',
        );
      return { id: kbId, deleted: true };
    });
  }

  private async list(
    userId: bigint,
    where: Prisma.b_knowledge_basesWhereInput,
    page: number,
    pageSize: number,
    orderBy: Prisma.b_knowledge_basesOrderByWithRelationInput[],
  ) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.b_knowledge_bases.findMany({
        where,
        include: this.summaryInclude(userId),
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.b_knowledge_bases.count({ where }),
    ]);
    return {
      list: items.map((item) => this.map(item, userId)),
      pagination: { page, pageSize, total },
    };
  }

  private summaryInclude(userId: bigint) {
    // 仅加载当前用户的成员记录；完整成员列表并非摘要接口所需。
    return {
      kb_members: { where: { user_id: userId } },
      _count: { select: { documents: true, kb_members: true } },
    } satisfies Prisma.b_knowledge_basesInclude;
  }

  private map(item: Summary, userId: bigint) {
    // 未匹配所有者或成员时，本方法只会用于已筛选为公开的记录。
    const accessRole: KnowledgeBaseAccessRole =
      item.owner_id === userId
        ? 'owner'
        : ((item.kb_members[0]?.role as KnowledgeBaseMemberRole | undefined) ??
          'publicVisitor');
    const visibility = item.visibility as KnowledgeBaseVisibility;
    return {
      id: item.id.toString(),
      name: item.name,
      description: item.description,
      visibility,
      allowPublicDownload: item.allow_public_download,
      ownerId: item.owner_id.toString(),
      documentCount: item._count.documents,
      memberCount: item._count.kb_members + 1,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      accessRole,
      memberRole:
        accessRole === 'owner' || accessRole === 'publicVisitor'
          ? null
          : accessRole,
      permissions: this.access.permissions(
        accessRole,
        visibility,
        item.allow_public_download,
      ),
    };
  }

  private requireDownloadPolicy(
    visibility: KnowledgeBaseVisibility,
    allowPublicDownload: boolean | undefined,
  ) {
    if (allowPublicDownload === true && visibility !== 'public')
      throw new BusinessError(
        ErrorCode.PARAM_ERROR,
        '仅公开知识库可以允许公开下载',
        'validation',
      );
  }

  private mineOrder(sort: ListKnowledgeBasesDto['sortBy']) {
    const orders: Record<
      ListKnowledgeBasesDto['sortBy'],
      Prisma.b_knowledge_basesOrderByWithRelationInput[]
    > = {
      updated_desc: [{ updated_at: 'desc' }, { id: 'desc' }],
      updated_asc: [{ updated_at: 'asc' }, { id: 'asc' }],
      documents_desc: [{ documents: { _count: 'desc' } }, { id: 'desc' }],
      name_asc: [{ name: 'asc' }, { id: 'asc' }],
    };
    return orders[sort];
  }
}
