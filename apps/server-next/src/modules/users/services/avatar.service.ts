import { Injectable, StreamableFile } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { PrismaService } from '../../../platform/database/prisma.service';
import { RuntimeConfig } from '../../../platform/config/runtime-config.service';
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

/** 负责头像格式嗅探、安全落盘、替换清理与读取。 */
@Injectable()
export class AvatarService {
  private readonly root: string;
  constructor(
    config: RuntimeConfig,
    private readonly prisma: PrismaService,
    private readonly accounts: UserAccountsService,
  ) {
    const configured = config.avatar.directory;
    this.root = isAbsolute(configured)
      ? configured
      : resolve(process.cwd(), configured);
  }

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
    await mkdir(this.root, { recursive: true });
    const filename = `${userId.toString()}-${randomUUID()}${format.extension}`;
    const target = this.safePath(filename);
    await writeFile(target, buffer, { flag: 'wx' });
    try {
      const updated = await this.prisma.b_users.update({
        where: { id: userId },
        data: { avatar_url: filename },
      });
      if (user.avatar_url) await this.removeQuietly(user.avatar_url);
      return this.accounts.buildProfile(updated);
    } catch (error) {
      // 数据库更新失败时回滚新文件，避免产生无法引用的孤儿头像。
      await this.removeQuietly(filename);
      throw error;
    }
  }

  async read(userId: bigint) {
    const user = await this.accounts.findById(userId);
    if (!user?.avatar_url || user.deleted_at || !user.is_active)
      throw new BusinessError(ErrorCode.NOT_FOUND, '头像不存在', 'not-found');
    try {
      const data = await readFile(this.safePath(user.avatar_url));
      const format = formats.find((candidate) => candidate.matches(data));
      if (!format) throw new Error('invalid avatar');
      return new StreamableFile(data, { type: format.mime });
    } catch {
      throw new BusinessError(ErrorCode.NOT_FOUND, '头像不存在', 'not-found');
    }
  }

  private safePath(filename: string) {
    const path = join(this.root, filename);
    // 数据库存储的文件名也视为不可信输入，始终限制在头像根目录内。
    if (!path.startsWith(`${this.root}${sep}`))
      throw new Error('Invalid avatar path');
    return path;
  }

  private async removeQuietly(filename: string) {
    try {
      await unlink(this.safePath(filename));
    } catch {
      /* already absent */
    }
  }
}
