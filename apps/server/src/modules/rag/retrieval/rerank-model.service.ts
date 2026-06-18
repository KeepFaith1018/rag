import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';

export interface RerankParams {
  query: string;
  documents: string[];
  topN?: number;
}

export interface RerankResult {
  scores: number[];
}

interface BailianRerankResponse {
  results: Array<{
    index: number;
    relevance_score: number;
  }>;
}

@Injectable()
export class RerankModelService {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly topN: number;
  private readonly logger: Logger;

  constructor(
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
  ) {
    this.apiKey = this.configService.get<string>('BAILIAN_API_KEY') || '';
    this.model =
      this.configService.get<string>('BAILIAN_RERANK_MODEL') || 'qwen3-rerank';
    this.baseUrl =
      'https://dashscope.aliyuncs.com/compatible-api/v1';
    this.topN = this.configService.get<number>('BAILIAN_RERANK_TOP_N') || 10;
    this.logger = logger;
  }

  /**
   * 调用 qwen3-rerank API 获取相关性分数
   */
  async rerank(params: RerankParams): Promise<RerankResult> {
    const { query, documents, topN = this.topN } = params;

    if (!documents.length) {
      return { scores: [] };
    }

    const response = await this.callRerankApi(query, documents, topN);

    // 构建分数数组，与输入文档顺序对应
    const scores = new Array<number>(documents.length).fill(0);
    for (const item of response.results) {
      if (item.index >= 0 && item.index < documents.length) {
        scores[item.index] = item.relevance_score;
      }
    }

    return { scores };
  }

  /**
   * 调用百炼重排 API
   */
  private async callRerankApi(
    query: string,
    documents: string[],
    topN: number,
  ): Promise<BailianRerankResponse> {
    const url = `${this.baseUrl}/reranks`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        query,
        documents,
        top_n: topN,
        return_documents: false,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, {
        message: `qwen3-rerank API 调用失败: ${response.status}`,
        cause: new Error(errorText),
        context: {
          status: response.status,
          statusText: response.statusText,
        },
      });
    }

    try {
      const data = (await response.json()) as BailianRerankResponse;
      return data;
    } catch (error) {
      throw new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, {
        message: 'qwen3-rerank API 响应格式错误',
        cause: error,
      });
    }
  }
}
