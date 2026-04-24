import { Injectable } from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';

/**
 * 文件存储结果。
 */
export interface SavedFileDescriptor {
  relativePath: string;
  absolutePath: string;
}

/**
 * 提供本地文件存储能力，后续可平滑替换为对象存储实现。
 */
@Injectable()
export class FileStorageService {
  private readonly baseDirectory = resolve(process.cwd(), 'storage');

  /**
   * 将知识库文档保存到本地磁盘。
   */
  async saveKnowledgeBaseDocument(
    buffer: Buffer,
    options: {
      kbId: string;
      extension: string;
    },
  ): Promise<SavedFileDescriptor> {
    const relativeDirectory = join('documents', options.kbId);
    const absoluteDirectory = resolve(this.baseDirectory, relativeDirectory);
    await mkdir(absoluteDirectory, { recursive: true });

    const fileName = `${Date.now()}-${randomUUID()}${options.extension}`;
    const relativePath = join(relativeDirectory, fileName);
    const absolutePath = resolve(this.baseDirectory, relativePath);
    await writeFile(absolutePath, buffer);

    return {
      relativePath,
      absolutePath,
    };
  }

  /**
   * 解析相对存储路径对应的绝对路径。
   */
  resolveAbsolutePath(relativePath: string) {
    return resolve(this.baseDirectory, relativePath);
  }

  /**
   * 删除本地文件；若文件已不存在则直接忽略。
   */
  async deleteFile(relativePath: string) {
    const absolutePath = this.resolveAbsolutePath(relativePath);
    if (!existsSync(absolutePath)) {
      return;
    }

    await rm(absolutePath, { force: true });
  }

  /**
   * 创建文件读取流，供下载接口直接回传。
   */
  createFileReadStream(relativePath: string) {
    return createReadStream(this.resolveAbsolutePath(relativePath));
  }

  /**
   * 判断目标文件是否已存在于本地存储。
   */
  exists(relativePath: string) {
    return existsSync(this.resolveAbsolutePath(relativePath));
  }
}
