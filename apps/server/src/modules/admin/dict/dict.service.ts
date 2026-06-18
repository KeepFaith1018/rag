import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { BusinessException, wrapBusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { CreateDictTypeDto } from './dto/create-dict-type.dto';
import { UpdateDictTypeDto } from './dto/update-dict-type.dto';
import { CreateDictItemDto } from './dto/create-dict-item.dto';
import { UpdateDictItemDto } from './dto/update-dict-item.dto';

@Injectable()
export class DictService {
  constructor(private readonly prisma: PrismaService) {}

  // ========== 字典类型 ==========

  async findAllTypes() {
    try {
      const types = await this.prisma.sys_dict_type.findMany({
        orderBy: { created_at: 'asc' },
        include: {
          _count: {
            select: { items: true },
          },
        },
      });

      return types.map((t) => ({
        id: t.id.toString(),
        code: t.code,
        name: t.name,
        remark: t.remark,
        itemCount: t._count.items,
        createdAt: t.created_at.toISOString(),
      }));
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'DictService', action: 'findAllTypes' },
      });
    }
  }

  async findTypeByCode(code: string) {
    try {
      const type = await this.prisma.sys_dict_type.findUnique({
        where: { code },
        include: {
          items: {
            orderBy: { sort: 'asc' },
          },
        },
      });

      if (!type) {
        throw new BusinessException(ErrorCode.NOT_FOUND);
      }

      return {
        id: type.id.toString(),
        code: type.code,
        name: type.name,
        remark: type.remark,
        items: type.items.map((item) => ({
          id: String(item.id),
          value: String(item.value),
          label: String(item.label),
          sort: Number(item.sort),
          status: Boolean(item.status),
          createdAt: item.created_at?.toISOString() ?? '',
        })),
        createdAt: type.created_at.toISOString(),
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'DictService', action: 'findTypeByCode', code },
      });
    }
  }

  async createType(dto: CreateDictTypeDto) {
    try {
      const existing = await this.prisma.sys_dict_type.findUnique({
        where: { code: dto.code },
      });

      if (existing) {
        throw new BusinessException(ErrorCode.PARAM_ERROR, '字典编码已存在');
      }

      const type = await this.prisma.sys_dict_type.create({
        data: {
          code: dto.code,
          name: dto.name,
          remark: dto.remark,
        },
      });

      return {
        id: type.id.toString(),
        code: type.code,
        name: type.name,
        remark: type.remark,
        createdAt: type.created_at.toISOString(),
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'DictService', action: 'createType', code: dto.code },
      });
    }
  }

  async updateType(code: string, dto: UpdateDictTypeDto) {
    try {
      const type = await this.prisma.sys_dict_type.findUnique({ where: { code } });
      if (!type) throw new BusinessException(ErrorCode.NOT_FOUND);

      const updated = await this.prisma.sys_dict_type.update({
        where: { code },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.remark !== undefined && { remark: dto.remark }),
        },
      });

      return {
        id: updated.id.toString(),
        code: updated.code,
        name: updated.name,
        remark: updated.remark,
        createdAt: updated.created_at.toISOString(),
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'DictService', action: 'updateType', code },
      });
    }
  }

  async deleteType(code: string) {
    try {
      await this.prisma.sys_dict_type.delete({ where: { code } });
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'DictService', action: 'deleteType', code },
      });
    }
  }

  // ========== 字典项 ==========

  async createItem(dto: CreateDictItemDto) {
    try {
      const type = await this.prisma.sys_dict_type.findUnique({
        where: { code: dto.typeCode },
      });
      if (!type) throw new BusinessException(ErrorCode.NOT_FOUND, '字典类型不存在');

      const existing = await this.prisma.sys_dict_item.findUnique({
        where: { type_code_value: { type_code: dto.typeCode, value: dto.value } },
      });
      if (existing) {
        throw new BusinessException(ErrorCode.PARAM_ERROR, '字典项值已存在');
      }

      const item = await this.prisma.sys_dict_item.create({
        data: {
          type_code: dto.typeCode,
          value: dto.value,
          label: dto.label,
          sort: dto.sort ?? 0,
          status: dto.status ?? true,
        },
      });

      return {
        id: item.id.toString(),
        typeCode: item.type_code,
        value: item.value,
        label: item.label,
        sort: item.sort,
        status: item.status,
        createdAt: item.created_at.toISOString(),
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'DictService', action: 'createItem', typeCode: dto.typeCode },
      });
    }
  }

  async updateItem(id: string, dto: UpdateDictItemDto) {
    try {
      const item = await this.prisma.sys_dict_item.findUnique({
        where: { id: BigInt(id) },
      });
      if (!item) throw new BusinessException(ErrorCode.NOT_FOUND);

      const updated = await this.prisma.sys_dict_item.update({
        where: { id: BigInt(id) },
        data: {
          ...(dto.label !== undefined && { label: dto.label }),
          ...(dto.sort !== undefined && { sort: dto.sort }),
          ...(dto.status !== undefined && { status: dto.status }),
        },
      });

      return {
        id: updated.id.toString(),
        typeCode: updated.type_code,
        value: updated.value,
        label: updated.label,
        sort: updated.sort,
        status: updated.status,
        createdAt: updated.created_at.toISOString(),
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'DictService', action: 'updateItem', id },
      });
    }
  }

  async deleteItem(id: string) {
    try {
      await this.prisma.sys_dict_item.delete({ where: { id: BigInt(id) } });
    } catch (error) {
      throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
        context: { module: 'DictService', action: 'deleteItem', id },
      });
    }
  }
}
