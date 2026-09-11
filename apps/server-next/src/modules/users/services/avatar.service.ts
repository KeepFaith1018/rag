import { Inject, Injectable, StreamableFile } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../platform/database/prisma.service';
import { RuntimeConfig } from '../../../platform/config/runtime-config.service';
import {
  STORAGE_ADAPTER,
  type StorageAdapter,
} from '../../../platform/object-storage/storage-adapter';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';
import { UserAccountsService } from './user-accounts.service';

const formats = [
  {
    mime: 'image/png',
    extension: '.png',
    matches: (b: Buffer) =>
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  {
    mime: 'image/jpeg',
    extension: '.jpg',
    matches: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/gif',
    extension: '.gif',
    matches: (b: Buffer) =>
      ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii')),
  },
  {
    mime: 'image/webp',
    extension: '.webp',
    matches: (b: Buffer) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

/** 负责头像格式嗅探、MinIO 写入、替换清理与读取。 */
@Injectable()
export class AvatarService {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly prisma: PrismaService,
    private readonly accounts: UserAccountsService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  async update(userId: bigint, buffer: Buffer) {
    const user = await this.accounts.requireActiveById(userId);
    // 以文件签名字节而非客户端声明的 MIME 类型确定实际图片格式。
    const format = formats.find((candidate) => candidate.matches(buffer));
    if (!format)
      throw new BusinessError(
        ErrorCode.PARAM_ERROR,
        '头像格式不支持',
        'validation',
      );
    const key = `avatars/${userId.toString()}/${randomUUID()}${format.extension}`;
    await this.storage.putObject({
      bucket: this.config.documentStorage.bucket,
      key,
      body: buffer,
      contentType: format.mime,
    });
    try {
      const updated = await this.prisma.b_users.update({
        where: { id: userId },
        data: { avatar_url: key },
      });
      if (user.avatar_url) await this.removeQuietly(user.avatar_url);
      return this.accounts.buildProfile(updated);
    } catch (error) {
      // 数据库更新失败时回滚新对象，避免产生无法引用的孤儿头像。
      await this.removeQuietly(key);
      throw error;
    }
  }

  async read(userId: bigint) {
    const user = await this.accounts.findById(userId);
    if (!user?.avatar_url || user.deleted_at || !user.is_active)
      throw new BusinessError(ErrorCode.NOT_FOUND, '头像不存在', 'not-found');
    try {
      const key = this.safeKey(user.avatar_url);
      const object = await this.storage.headObject({
        bucket: this.config.documentStorage.bucket,
        key,
      });
      const format = formats.find(
        (candidate) => candidate.mime === object.contentType,
      );
      if (!format) throw new Error('invalid avatar content type');
      const stream = await this.storage.readObject({
        bucket: this.config.documentStorage.bucket,
        key,
      });
      return new StreamableFile(stream, { type: format.mime });
    } catch {
      throw new BusinessError(ErrorCode.NOT_FOUND, '头像不存在', 'not-found');
    }
  }

  private safeKey(key: string) {
    // 数据库存储的对象 key 也视为不可信输入，只允许本服务生成的头像路径。
    if (!/^avatars\/\d+\/[0-9a-f-]{36}\.(png|jpg|gif|webp)$/.test(key))
      throw new Error('Invalid avatar key');
    return key;
  }

  private async removeQuietly(key: string) {
    try {
      await this.storage.deleteObject({
        bucket: this.config.documentStorage.bucket,
        key: this.safeKey(key),
      });
    } catch {
      /* already absent */
    }
  }
}
