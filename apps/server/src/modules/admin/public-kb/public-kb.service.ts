import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { BusinessException, wrapBusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { ListPublicKbDto } from './dto/list-public-kb.dto';
import { UpdatePublicKbStatusDto } from './dto/update-public-kb-status.dto';

@Injectable()
export class PublicKbService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListPublicKbDto) {
    try {
      const { page = 1, pageSize = 20, name, status, isPublic } = query;
      const skip = (page - 1) * pageSize;

      const where: Record<string, unknown> = {
        visibility: 'public',
      };
      if (name) where.name = { contains: name };
      if (status) where.status = status;
      if (isPublic !== undefined) where.is_public = isPublic;

      const [kbs, total] = await Promise.all([
        this.prisma.b_knowledge_bases.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: { updated_at: 'desc' },
          include: {
            b_users: {
              select: {
                id: true,
                email: true,
                full_name: true,
                avatar_url: true,
              },
            },
            _count: {
              select: { documents: true },
            },
          },
        }),
        this.prisma.b_knowledge_bases.count({ where }),
      ]);

      return {
        list: kbs.map((kb) => ({
          id: kb.id.toString(),
          name: kb.name,
          description: kb.description,
          visibility: kb.visibility,
          status: kb.status,
          isPublic: kb.is_public,
          allowPublicDownload: kb.allow_public_download,
          owner: {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            id: String((kb.b_users as any).id),
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            email: String((kb.b_users as any).email),
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            fullName: String((kb.b_users as any).full_name),
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            avatarUrl: String((kb.b_users as any).avatar_url),
          },
          documentCount: kb._count.documents,
          createdAt: kb.created_at.toISOString(),
          updatedAt: kb.updated_at.toISOString(),
        })),
        total,
        page,
        pageSize,
      };
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'PublicKbService', action: 'findAll' },
      });
    }
  }

  async findOne(id: string) {
    try {
      const kb = await this.prisma.b_knowledge_bases.findUnique({
        where: { id: BigInt(id) },
        include: {
          b_users: {
            select: {
              id: true,
              email: true,
              full_name: true,
              avatar_url: true,
            },
          },
          _count: {
            select: { documents: true },
          },
        },
      });

      if (!kb) {
        throw new BusinessException(ErrorCode.NOT_FOUND);
      }

      return {
        id: kb.id.toString(),
        name: kb.name,
        description: kb.description,
        visibility: kb.visibility,
        status: kb.status,
        isPublic: kb.is_public,
        allowPublicDownload: kb.allow_public_download,
        owner: {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          id: String((kb.b_users as any).id),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          email: String((kb.b_users as any).email),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          fullName: String((kb.b_users as any).full_name),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          avatarUrl: String((kb.b_users as any).avatar_url),
        },
        documentCount: kb._count.documents,
        createdAt: kb.created_at.toISOString(),
        updatedAt: kb.updated_at.toISOString(),
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'PublicKbService', action: 'findOne', id },
      });
    }
  }

  async updateStatus(id: string, dto: UpdatePublicKbStatusDto) {
    try {
      const kb = await this.prisma.b_knowledge_bases.findUnique({
        where: { id: BigInt(id) },
      });

      if (!kb) {
        throw new BusinessException(ErrorCode.NOT_FOUND);
      }

      const updated = await this.prisma.b_knowledge_bases.update({
        where: { id: BigInt(id) },
        data: { status: dto.status },
      });

      return {
        id: updated.id.toString(),
        name: updated.name,
        status: updated.status,
        updatedAt: updated.updated_at.toISOString(),
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'PublicKbService', action: 'updateStatus', id },
      });
    }
  }
}
