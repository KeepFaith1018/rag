import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { PrismaService } from '@common/prisma/prisma.service';
import { QdrantService } from '@common/vector/qdrant.service';
import { ElasticsearchService } from '@common/vector/elasticsearch.service';
import { FileStorageService } from '@common/storage/file-storage.service';
import { UploadService } from '../upload/upload.service';

/**
 * 负责定时清理过期上传会话与孤立数据（向量、ES 文档、本地文件）。
 */
@Injectable()
export class CleanupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qdrantService: QdrantService,
    private readonly elasticsearchService: ElasticsearchService,
    private readonly fileStorageService: FileStorageService,
    private readonly uploadService: UploadService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /**
   * 每 6 小时清理过期上传会话。
   */
  @Cron('0 */6 * * *')
  async cleanupExpiredUploads() {
    try {
      const result = await this.uploadService.cleanupExpiredSessions();
      if (result.cleanedCount > 0) {
        this.logger.info(
          `[Cleanup] 清理了 ${result.cleanedCount} 个过期上传会话`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[Cleanup] 清理过期上传会话失败: ${String(err)}`,
      );
    }
  }

  /**
   * 每天凌晨 3 点扫描并清理孤立数据。
   */
  @Cron('0 3 * * *')
  async cleanupOrphanedData() {
    this.logger.info('[Cleanup] 开始扫描孤立数据...');
    await this.cleanupOrphanedQdrantVectors();
    await this.cleanupOrphanedEsDocuments();
    await this.cleanupOrphanedFiles();
    this.logger.info('[Cleanup] 孤立数据扫描完成');
  }

  /**
   * 扫描 Qdrant 中引用已不存在文档的孤立向量。
   */
  private async cleanupOrphanedQdrantVectors() {
    try {
      const orphanDocIds = await this.qdrantService.findOrphanDocIds(
        async (docIds: string[]) => this.filterMissingDocIds(docIds),
      );

      for (const docId of orphanDocIds) {
        await this.qdrantService.deleteByDocument(docId);
        this.logger.info(`[Cleanup] 已清理 Qdrant 孤立向量 docId=${docId}`);
      }

      if (orphanDocIds.length > 0) {
        this.logger.info(
          `[Cleanup] Qdrant 孤立向量清理完成，共清理 ${orphanDocIds.length} 个文档的向量`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[Cleanup] 清理 Qdrant 孤立向量失败: ${String(err)}`,
      );
    }
  }

  /**
   * 扫描 ES 中引用已不存在文档的孤立索引文档。
   */
  private async cleanupOrphanedEsDocuments() {
    try {
      const orphanDocIds = await this.elasticsearchService.findOrphanDocIds(
        async (docIds: string[]) => this.filterMissingDocIds(docIds),
      );

      for (const docId of orphanDocIds) {
        await this.elasticsearchService.deleteByDocument(docId);
        this.logger.info(
          `[Cleanup] 已清理 ES 孤立文档 docId=${docId}`,
        );
      }

      if (orphanDocIds.length > 0) {
        this.logger.info(
          `[Cleanup] ES 孤立文档清理完成，共清理 ${orphanDocIds.length} 个文档的索引`,
        );
      }
    } catch (err) {
      this.logger.error(
        `[Cleanup] 清理 ES 孤立文档失败: ${String(err)}`,
      );
    }
  }

  /**
   * 扫描本地存储中文档目录对应知识库已不存在的孤立文件。
   */
  private async cleanupOrphanedFiles() {
    try {
      const baseDir = resolve(process.cwd(), 'storage', 'documents');
      if (!existsSync(baseDir)) {
        return;
      }

      const entries = await readdir(baseDir, { withFileTypes: true });
      const kbDirs = entries.filter((e) => e.isDirectory());

      for (const dir of kbDirs) {
        const kbId = dir.name;
        const kbExists = await this.prisma.b_knowledge_bases.findUnique({
          where: { id: BigInt(kbId) },
          select: { id: true },
        });

        if (!kbExists) {
          await this.fileStorageService.deleteDirectory(`documents/${kbId}`);
          this.logger.info(
            `[Cleanup] 已清理孤立文件目录 documents/${kbId}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `[Cleanup] 清理孤立文件失败: ${String(err)}`,
      );
    }
  }

  /**
   * 传入 docId 列表，返回其中在 b_documents 表中不存在的 docId。
   */
  private async filterMissingDocIds(docIds: string[]): Promise<string[]> {
    if (docIds.length === 0) {
      return [];
    }

    const bigIntIds = docIds
      .map((id) => {
        try {
          return BigInt(id);
        } catch {
          return null;
        }
      })
      .filter((id): id is bigint => id !== null);

    if (bigIntIds.length === 0) {
      return [];
    }

    const existing = await this.prisma.b_documents.findMany({
      where: { id: { in: bigIntIds } },
      select: { id: true },
    });

    const existingSet = new Set(existing.map((d) => d.id.toString()));
    return docIds.filter((id) => !existingSet.has(id));
  }
}
