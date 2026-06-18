import { Test, TestingModule } from '@nestjs/testing';
import { ContextManagerService, formatChatHistoryAsText } from './context-manager.service';
import { ChatMessageService } from './chat-message.service';
import { TokenService } from '@common/utils/token.service';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

describe('ContextManagerService', () => {
  let service: ContextManagerService;
  let chatMessageService: jest.Mocked<Pick<ChatMessageService, 'listMessages'>>;
  let tokenService: jest.Mocked<Pick<TokenService, 'tokenCount'>>;

  beforeEach(async () => {
    chatMessageService = { listMessages: jest.fn() };
    tokenService = { tokenCount: jest.fn((text: string) => text.length) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContextManagerService,
        { provide: ChatMessageService, useValue: chatMessageService },
        { provide: TokenService, useValue: tokenService },
      ],
    }).compile();

    service = module.get(ContextManagerService);
  });

  describe('buildContext', () => {
    it('空历史返回空数组', async () => {
      chatMessageService.listMessages.mockResolvedValue({
        list: [],
        total: 0,
      });

      const result = await service.buildContext('session-1');
      expect(result).toEqual([]);
    });

    it('正常历史返回配对的 BaseMessage[]', async () => {
      chatMessageService.listMessages.mockResolvedValue({
        list: [
          { role: 'user', content: '问题1', messageStatus: 'completed' },
          { role: 'assistant', content: '回答1', messageStatus: 'completed' },
          { role: 'user', content: '问题2', messageStatus: 'completed' },
          { role: 'assistant', content: '回答2', messageStatus: 'completed' },
        ],
        total: 4,
      });

      const result = await service.buildContext('session-1');
      expect(result).toHaveLength(4);
      expect(result[0]).toBeInstanceOf(HumanMessage);
      expect(result[0].content).toBe('问题1');
      expect(result[1]).toBeInstanceOf(AIMessage);
      expect(result[1].content).toBe('回答1');
      expect(result[2]).toBeInstanceOf(HumanMessage);
      expect(result[2].content).toBe('问题2');
      expect(result[3]).toBeInstanceOf(AIMessage);
      expect(result[3].content).toBe('回答2');
    });

    it('过滤 streaming/aborted 状态的消息', async () => {
      chatMessageService.listMessages.mockResolvedValue({
        list: [
          { role: 'user', content: '问题1', messageStatus: 'completed' },
          { role: 'assistant', content: '回答1', messageStatus: 'completed' },
          { role: 'user', content: '问题2', messageStatus: 'completed' },
          { role: 'assistant', content: '', messageStatus: 'streaming' },
        ],
        total: 4,
      });

      const result = await service.buildContext('session-1');
      expect(result).toHaveLength(2); // 只保留第一轮
    });

    it('超出 token 上限时截断旧消息', async () => {
      chatMessageService.listMessages.mockResolvedValue({
        list: [
          { role: 'user', content: '短问题', messageStatus: 'completed' },
          { role: 'assistant', content: '短回答', messageStatus: 'completed' },
          { role: 'user', content: 'A'.repeat(5000), messageStatus: 'completed' },
          { role: 'assistant', content: 'B'.repeat(5000), messageStatus: 'completed' },
        ],
        total: 4,
      });

      const result = await service.buildContext('session-1');
      // 旧的小消息应该被截断（超出上限时从旧到新删除）
      expect(result.every((m) => m.content === '短问题' || m.content === '短回答')).toBe(false);
    });

    it('DB 异常时降级返回空数组', async () => {
      chatMessageService.listMessages.mockRejectedValue(new Error('DB down'));

      const result = await service.buildContext('session-1');
      expect(result).toEqual([]);
    });
  });

  describe('formatChatHistoryAsText', () => {
    it('空数组返回空字符串', () => {
      expect(formatChatHistoryAsText([])).toBe('');
    });

    it('格式化历史为文本', () => {
      const messages = [
        new HumanMessage('你好'),
        new AIMessage('你好！有什么可以帮助你的？'),
        new HumanMessage('介绍React'),
      ];
      const text = formatChatHistoryAsText(messages);
      expect(text).toContain('用户: 你好');
      expect(text).toContain('助手: 你好！有什么可以帮助你的？');
      expect(text).toContain('用户: 介绍React');
    });
  });
});
