import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface WebSearchResponse {
  results: WebSearchResult[];
}

/**
 * 联网搜索服务。
 *
 * 使用 Tavily Search API 进行网络搜索，专为 AI Agent 设计，
 * 返回清洗后的结构化内容，无需额外解析 HTML。
 *
 * 当 TAVILY_API_KEY 未配置时，服务降级为空搜索（不阻塞主流程）。
 */
@Injectable()
export class WebSearchService {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.tavily.com/search';

  constructor(
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {
    this.apiKey = this.configService.get<string>('TAVILY_API_KEY') || '';
  }

  /** 是否可用 */
  isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * 执行网络搜索，返回结构化结果。
   *
   * @param query 搜索查询
   * @param maxResults 最大返回条数（默认 5）
   */
  async search(query: string, maxResults = 5): Promise<WebSearchResult[]> {
    if (!this.isAvailable()) {
      this.logger.warn('[WebSearch] TAVILY_API_KEY 未配置，跳过联网搜索');
      return [];
    }

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          search_depth: 'basic',
          max_results: maxResults,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `[WebSearch] Tavily API 调用失败: ${response.status} ${errorText}`,
        );
        return [];
      }

      const data = (await response.json()) as WebSearchResponse;
      return data.results ?? [];
    } catch (error) {
      this.logger.error(
        `[WebSearch] 联网搜索异常: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }
}
