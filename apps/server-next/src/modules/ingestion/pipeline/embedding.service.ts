import { Injectable } from '@nestjs/common';
import { RuntimeConfig } from '../../../platform/config/runtime-config.service';
import { EmbeddingConfigSchema } from '../contracts/schemas';
import { setTimeout as delay } from 'node:timers/promises';
import { countTokens } from './chunker.service';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';

@Injectable()
export class EmbeddingService {
  private nextCallAt = 0;
  private rateGate: Promise<void> = Promise.resolve();
  constructor(private readonly runtime: RuntimeConfig) {}

  async embed(
    configInput: unknown,
    texts: string[],
    signal?: AbortSignal,
  ): Promise<number[][]> {
    const config = EmbeddingConfigSchema.parse(configInput);
    if (!texts.length) return [];
    if (
      texts.length > this.runtime.worker.batchSize ||
      texts.reduce((total, text) => total + countTokens(text), 0) >
        this.runtime.worker.embeddingBatchTokens
    )
      throw new BusinessError(
        ErrorCode.DOCUMENT_PROCESSING_RESOURCE_LIMIT,
        'Embedding 请求超过条数或 Token 上限',
        'validation',
      );
    const requestSignal = signal
      ? AbortSignal.any([
          signal,
          AbortSignal.timeout(this.runtime.worker.taskTimeoutMs),
        ])
      : AbortSignal.timeout(this.runtime.worker.taskTimeoutMs);
    await this.acquireProviderSlot(requestSignal);
    const embedding = this.runtime.embedding;
    if (!embedding.baseUrl || !embedding.apiKey)
      throw new Error('EMBEDDING_NOT_CONFIGURED');
    const response = await fetch(
      `${embedding.baseUrl.replace(/\/$/, '')}/embeddings`,
      {
        method: 'POST',
        signal: requestSignal,
        headers: {
          authorization: `Bearer ${embedding.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          input: texts,
          dimensions: config.dimension,
        }),
      },
    );
    if (!response.ok) throw new Error(`EMBEDDING_HTTP_${response.status}`);
    const json = (await response.json()) as {
      data?: Array<{ embedding?: unknown; index?: number }>;
    };
    const rows = [...(json.data ?? [])].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    );
    if (rows.length !== texts.length)
      throw new Error('EMBEDDING_COUNT_MISMATCH');
    const vectors = rows.map((row) => {
      if (
        !Array.isArray(row.embedding) ||
        row.embedding.length !== config.dimension
      )
        throw new Error('EMBEDDING_DIMENSION_MISMATCH');
      const vector = row.embedding.map(Number);
      if (vector.some((value) => !Number.isFinite(value)))
        throw new Error('EMBEDDING_NON_FINITE');
      return config.normalization.normalize ? normalize(vector) : vector;
    });
    return vectors;
  }

  private async acquireProviderSlot(signal: AbortSignal) {
    const previous = this.rateGate;
    let release!: () => void;
    this.rateGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      signal.throwIfAborted();
      const waitMs = Math.max(0, this.nextCallAt - Date.now());
      if (waitMs) await delay(waitMs, undefined, { signal });
      signal.throwIfAborted();
      this.nextCallAt =
        Date.now() + 1000 / this.runtime.worker.providerRateLimitPerSecond;
    } finally {
      release();
    }
  }
}

function normalize(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  return norm === 0 ? vector : vector.map((item) => item / norm);
}
