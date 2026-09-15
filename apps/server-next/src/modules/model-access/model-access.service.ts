import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../../prisma/generated/client';
import { PrismaService } from '../../platform/database/prisma.service';
import { RuntimeConfig } from '../../platform/config/runtime-config.service';
import { BusinessError } from '../../shared/errors/business-error';
import { ErrorCode } from '../../shared/errors/error-code';
import {
  EmbeddingConfigSchema,
  type EmbeddingConfig,
} from '../ingestion/contracts/schemas';

export interface EmbeddingModelSnapshot {
  config: EmbeddingConfig;
  hash: string;
  apiKey: string;
  baseUrl: string;
}

@Injectable()
export class ModelAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: RuntimeConfig,
  ) {}

  async defaultEmbedding(): Promise<EmbeddingModelSnapshot> {
    const rows = await this.prisma.sys_model_configs.findMany({
      where: { type: 'embedding', is_active: true, is_default: true },
      orderBy: { id: 'asc' },
    });
    if (rows.length === 0)
      throw new BusinessError(
        ErrorCode.DOCUMENT_MODEL_CONFIG_UNAVAILABLE,
        '默认向量模型不可用',
        'conflict',
      );
    if (rows.length !== 1)
      throw new BusinessError(
        ErrorCode.DOCUMENT_MODEL_CONFIG_CONFLICT,
        '默认向量模型配置冲突',
        'conflict',
      );
    return this.snapshot(rows[0]);
  }

  private snapshot(row: {
    provider: string;
    model_name: string;
    base_url: string | null;
    config_json: Prisma.JsonValue | null;
  }): EmbeddingModelSnapshot {
    const source = isRecord(row.config_json) ? row.config_json : {};
    const parsed = EmbeddingConfigSchema.safeParse({
      schemaVersion: 1,
      provider: row.provider,
      model: row.model_name,
      revision: stringValue(source.revision, 'stable'),
      dimension: numberValue(source.dimension, 1024),
      inputMode: source.inputMode === 'query' ? 'query' : 'document',
      normalization: {
        normalize:
          source.normalization && isRecord(source.normalization)
            ? source.normalization.normalize !== false
            : true,
      },
      parameters:
        source.parameters && isRecord(source.parameters)
          ? source.parameters
          : {},
    });
    if (!parsed.success)
      throw new BusinessError(
        ErrorCode.DOCUMENT_MODEL_CONFIG_UNAVAILABLE,
        '默认向量模型配置无效',
        'conflict',
        { cause: parsed.error },
      );
    const config = parsed.data;
    const hash = createHash('sha256').update(stableJson(config)).digest('hex');
    const apiKey = this.providerKey(row.provider);
    return {
      config,
      hash,
      apiKey,
      baseUrl: row.base_url || this.runtime.embedding.baseUrl,
    };
  }

  private providerKey(provider: string) {
    if (
      provider === this.runtime.embedding.provider ||
      !this.runtime.embedding.provider
    )
      return this.runtime.embedding.apiKey ?? '';
    return '';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
