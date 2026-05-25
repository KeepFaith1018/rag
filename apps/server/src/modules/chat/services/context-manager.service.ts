import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { ChatMessageService } from './chat-message.service';
import { TokenService } from '@common/utils/token.service';

const CONTEXT_MAX_ROUNDS = 10;
const CONTEXT_MAX_HISTORY_TOKENS = 4000;

/**
 * 将 BaseMessage[] 格式化为纯文本，供 rewrite prompt 使用。
 * 作为独立导出函数，方便各节点零依赖调用。
 */
export function formatChatHistoryAsText(messages: BaseMessage[]): string {
  if (!messages || messages.length === 0) return '';
  return messages
    .map((m) => {
      const role = m._getType() === 'human' ? '用户' : '助手';
      const content =
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `${role}: ${content}`;
    })
    .join('\n');
}

@Injectable()
export class ContextManagerService {
  private readonly logger = new Logger(ContextManagerService.name);

  constructor(
    private readonly chatMessageService: ChatMessageService,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * 为指定会话构建 LangChain BaseMessage[] 上下文。
   * 查询已完成的 user/assistant 消息，配对为对话轮次，取最近 10 轮，
   * 并基于 token 数量截断（最多保留 4000 tokens）。
   * 加载失败时降级为空上下文而非抛出异常。
   */
  async buildContext(sessionId: string): Promise<BaseMessage[]> {
    try {
      const result = await this.chatMessageService.listMessages(sessionId, {
        pageSize: 20,
      });

      const completed = result.list
        .filter((m) => ['user', 'assistant'].includes(m.role))
        .filter((m) => m.messageStatus === 'completed');

      const rounds = this.pairToRounds(completed).slice(-CONTEXT_MAX_ROUNDS);

      const baseMessages = rounds.flatMap((round) => [
        new HumanMessage(round.user.content),
        new AIMessage(round.assistant.content),
      ]);

      return this.truncateByTokens(baseMessages);
    } catch (error) {
      this.logger.warn('[ContextManager] 加载历史失败，降级为空上下文', {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
      });
      return [];
    }
  }

  /**
   * 将扁平的消息列表配为 (user, assistant) 对话轮次。
   * 跳过无法配对的孤立消息。
   */
  private pairToRounds(
    messages: Array<{ role: string; content: string }>,
  ): Array<{ user: { role: string; content: string }; assistant: { role: string; content: string } }> {
    const rounds: Array<{ user: { role: string; content: string }; assistant: { role: string; content: string } }> = [];
    let i = 0;
    while (i < messages.length - 1) {
      const a = messages[i];
      const b = messages[i + 1];
      if (a.role === 'user' && b.role === 'assistant') {
        rounds.push({ user: a, assistant: b });
        i += 2;
      } else {
        i += 1;
      }
    }
    return rounds;
  }

  /**
   * 从最新消息开始累计 token 数，超出 CONTEXT_MAX_HISTORY_TOKENS 时截断。
   * 至少保留最后一轮对话。
   */
  private truncateByTokens(messages: BaseMessage[]): BaseMessage[] {
    if (messages.length === 0) return [];

    let total = 0;
    const result: BaseMessage[] = [];
    // 从最新到最旧累计，再反转
    for (let i = messages.length - 1; i >= 0; i--) {
      const content = typeof messages[i].content === 'string'
        ? messages[i].content
        : JSON.stringify(messages[i].content);
      const tokens = this.tokenService.tokenCount(content);
      if (total + tokens > CONTEXT_MAX_HISTORY_TOKENS && result.length >= 2) {
        break; // 至少保留最后一轮
      }
      total += tokens;
      result.unshift(messages[i]);
    }
    return result;
  }
}
