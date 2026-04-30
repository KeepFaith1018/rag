import { Injectable } from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import { appendFile, mkdir, readFile, rm, writeFile } from 'fs/promises';
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
 * 上传分片保存结果。
 */
export interface SavedChunkDescriptor extends SavedFileDescriptor {
  relativeDirectory: string;
}

/**
 * 提供本地文件存储能力，后续可平滑替换为对象存储实现。
 */
@Injectable()
export class FileStorageService {
  private readonly baseDirectory = resolve(process.cwd(), 'storage');

  /**
   * 返回当前启用的存储类型，便于后续平滑切换对象存储实现。
   */
  getStorageType() {
    return 'local' as const;
  }

  /**
   * 将知识库文档保存到正式目录。
   */
  async saveKnowledgeBaseDocument(
    buffer: Buffer,
    options: {
      kbId: string;
      extension: string;
    },
  ): Promise<SavedFileDescriptor> {
    return this.writeFileToDirectory(buffer, {
      relativeDirectory: this.buildDocumentDirectory(options.kbId),
      extension: options.extension,
    });
  }

  /**
   * 按固定规则生成上传会话的临时目录。
   */
  buildUploadTempDirectory(kbId: string, uploadId: string) {
    return join('uploads', kbId, uploadId);
  }

  /**
   * 保存单个上传分片到临时目录。
   */
  async saveUploadChunk(
    buffer: Buffer,
    options: {
      kbId: string;
      uploadId: string;
      chunkIndex: number;
    },
  ): Promise<SavedChunkDescriptor> {
    const relativeDirectory = this.buildUploadTempDirectory(
      options.kbId,
      options.uploadId,
    );
    const absoluteDirectory = resolve(this.baseDirectory, relativeDirectory);
    await mkdir(absoluteDirectory, { recursive: true });

    const fileName = `${options.chunkIndex}.part`;
    const relativePath = join(relativeDirectory, fileName);
    const absolutePath = resolve(this.baseDirectory, relativePath);
    await writeFile(absolutePath, buffer);

    return {
      relativeDirectory,
      relativePath,
      absolutePath,
    };
  }

  /**
   * 将上传完成的分片按顺序合并为正式文件。
   */
  async mergeUploadChunks(options: {
    kbId: string;
    uploadId: string;
    totalChunks: number;
    extension: string;
  }): Promise<SavedFileDescriptor> {
    const relativeDirectory = this.buildDocumentDirectory(options.kbId);
    const absoluteDirectory = resolve(this.baseDirectory, relativeDirectory);
    await mkdir(absoluteDirectory, { recursive: true });

    const fileName = `${Date.now()}-${randomUUID()}${options.extension}`;
    const relativePath = join(relativeDirectory, fileName);
    const absolutePath = resolve(this.baseDirectory, relativePath);
    await writeFile(absolutePath, Buffer.alloc(0));

    for (let chunkIndex = 0; chunkIndex < options.totalChunks; chunkIndex += 1) {
      const chunkRelativePath = join(
        this.buildUploadTempDirectory(options.kbId, options.uploadId),
        `${chunkIndex}.part`,
      );
      const chunkAbsolutePath = this.resolveAbsolutePath(chunkRelativePath);
      const chunkBuffer = await readFile(chunkAbsolutePath);
      await appendFile(absolutePath, chunkBuffer);
    }

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
   * 删除目录及其所有内容；若目录不存在则直接忽略。
   */
  async deleteDirectory(relativePath: string) {
    const absolutePath = this.resolveAbsolutePath(relativePath);
    if (!existsSync(absolutePath)) {
      return;
    }

    await rm(absolutePath, { recursive: true, force: true });
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

  /**
   * 统一根据相对目录生成正式文件保存位置。
   */
  private async writeFileToDirectory(
    buffer: Buffer,
    options: {
      relativeDirectory: string;
      extension: string;
    },
  ): Promise<SavedFileDescriptor> {
    const absoluteDirectory = resolve(this.baseDirectory, options.relativeDirectory);
    await mkdir(absoluteDirectory, { recursive: true });

    const fileName = `${Date.now()}-${randomUUID()}${options.extension}`;
    const relativePath = join(options.relativeDirectory, fileName);
    const absolutePath = resolve(this.baseDirectory, relativePath);
    await writeFile(absolutePath, buffer);

    return {
      relativePath,
      absolutePath,
    };
  }

  /**
   * 生成知识库正式文档目录。
   */
  private buildDocumentDirectory(kbId: string) {
    return join('documents', kbId);
  }
}
