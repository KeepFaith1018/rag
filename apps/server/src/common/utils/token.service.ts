import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { get_encoding, TiktokenEncoding } from 'tiktoken';

/**
 * 统一的 Token 计数服务。
 *
 * 基于 OpenAI tiktoken cl100k_base 编码器，兼容百炼 text-embedding-v4 的
 * token 计算逻辑。单例持有编码器实例，避免频繁创建/销毁开销。
 */
@Injectable()
export class TokenService implements OnModuleDestroy {
  private encoding: ReturnType<typeof get_encoding> | null = null;

  /**
   * 计算文本的 token 数量。
   * 使用 cl100k_base 编码器（百炼 text-embedding-v4 兼容）。
   */
  tokenCount(text: string): number {
    if (!text) return 0;
    return this.getEncoding().encode(text).length;
  }

  /**
   * 批量计算多段文本的总 token 数量。
   */
  batchTokenCount(texts: string[]): number {
    return texts.reduce((sum, text) => sum + this.tokenCount(text), 0);
  }

  /**
   * 延迟初始化编码器实例，避免在模块加载阶段因 WASM 未就绪而失败。
   */
  private getEncoding() {
    if (!this.encoding) {
      this.encoding = get_encoding('cl100k_base' as TiktokenEncoding);
    }
    return this.encoding;
  }

  /**
   * 模块销毁时释放 tiktoken 编码器的原生内存。
   */
  onModuleDestroy() {
    if (this.encoding) {
      this.encoding.free();
      this.encoding = null;
    }
  }
}
