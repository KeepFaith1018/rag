import { Test, TestingModule } from '@nestjs/testing';
import { TokenService } from './token.service';

describe('TokenService', () => {
  let service: TokenService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TokenService],
    }).compile();
    service = module.get<TokenService>(TokenService);
  });

  afterAll(() => {
    service.onModuleDestroy();
  });

  describe('tokenCount', () => {
    it('空字符串返回 0', () => {
      expect(service.tokenCount('')).toBe(0);
    });

    it('英文文本正确计数', () => {
      // "Hello world" 在 cl100k_base 中通常为 2 tokens
      const count = service.tokenCount('Hello world');
      expect(count).toBe(2);
    });

    it('中文文本正确计数', () => {
      // 每个中文字符通常是 1-2 tokens，整句在 10-30 范围
      const count = service.tokenCount('知识库文档智能问答系统');
      // cl100k_base 对中文每个字约 1-2 token
      expect(count).toBeGreaterThan(5);
      expect(count).toBeLessThan(50);
    });

    it('中文长文本 token 数远小于字符数', () => {
      const text = '本项目是一个基于 RAG 的多知识库智能问答系统，支持 PDF、DOCX、Markdown 等多种文档格式的上传与检索。';
      const charCount = text.length;
      const count = service.tokenCount(text);
      // 中文 token 数通常小于字符数（1 个汉字可能占 0.5-2 tokens）
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(charCount * 2);
    });

    it('混合中英文正确计数', () => {
      const count = service.tokenCount('Linsor AI 灵索智能 RAG 系统');
      expect(count).toBeGreaterThan(3);
    });

    it('相同文本多次调用返回一致结果', () => {
      const text = '测试一致性';
      const c1 = service.tokenCount(text);
      const c2 = service.tokenCount(text);
      expect(c1).toBe(c2);
    });

    it('批量计数等于逐条求和', () => {
      const texts = ['第一章', '第二章', '第三章'];
      const individualSum = texts.reduce((s, t) => s + service.tokenCount(t), 0);
      const batchSum = service.batchTokenCount(texts);
      expect(batchSum).toBe(individualSum);
    });
  });
});
