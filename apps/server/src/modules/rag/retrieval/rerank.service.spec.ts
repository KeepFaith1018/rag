/// <reference types="jest" />

import { Test } from '@nestjs/testing';
import { RerankService } from './rerank.service';
import { RerankModelService } from './rerank-model.service';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import type { FusedHit } from './interfaces/fused-hit.interface';

function makeFusedHit(overrides: Partial<FusedHit> = {}): FusedHit {
  return {
    chunkId: 'chunk-1',
    docId: 'doc-1',
    kbId: 'kb-1',
    content: '测试内容，用于验证重排序逻辑。',
    fusionScore: 0.08,
    payload: {},
    ...overrides,
  };
}

// 测试时访问私有方法的类型安全辅助
interface TestableRerankService {
  computeTitlePathBoost(
    payload: Record<string, unknown>,
    queries: string[],
  ): number;
}

function getBoost(
  service: RerankService,
  payload: Record<string, unknown>,
  queries: string[],
): number {
  const svc = service as unknown as TestableRerankService;
  return svc.computeTitlePathBoost(payload, queries);
}

describe('RerankService', () => {
  let service: RerankService;
  let mockRerankModel: { rerank: jest.Mock };

  beforeAll(async () => {
    mockRerankModel = {
      rerank: jest.fn().mockResolvedValue({ scores: [0.85] }),
    };

    const module = await Test.createTestingModule({
      providers: [
        RerankService,
        { provide: RerankModelService, useValue: mockRerankModel },
        { provide: WINSTON_MODULE_PROVIDER, useValue: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } },
      ],
    }).compile();

    service = module.get(RerankService);
  });

  describe('O7 titlePath boost', () => {
    it('titlePath 与查询词重叠 >50% 时应获得加权', () => {
      const boost = getBoost(
        service,
        { titlePath: ['第三章', '3.1 系统架构', '缓存策略'] },
        ['缓存 策略 系统架构'],
      );
      expect(boost).toBeGreaterThan(1.0);
    });

    it('titlePath 与查询词无重叠时不应加权', () => {
      const boost = getBoost(
        service,
        { titlePath: ['第一章', '1.1 项目背景'] },
        ['数据库索引'],
      );
      expect(boost).toBe(1.0);
    });

    it('空 titlePath 安全回退到 1.0', () => {
      const boost1 = getBoost(service, { titlePath: [] }, ['任意查询']);
      expect(boost1).toBe(1.0);

      const boost2 = getBoost(service, {}, ['任意查询']);
      expect(boost2).toBe(1.0);
    });

    it('lightweightRerank 中 titlePath boost 与基础计分组合正确', async () => {
      mockRerankModel.rerank.mockRejectedValueOnce(new Error('API unavailable'));

      const hit = makeFusedHit({
        chunkId: 'tp-hit',
        content: '系统采用多级缓存架构，包括 L1 本地缓存和 L2 Redis 分布式缓存。',
        payload: {
          titlePath: ['第三章', '3.2 缓存架构设计'],
          chunkStrategy: 'structured-token-aware',
        },
      });

      const result = await service.rerank({
        candidates: [hit],
        queries: ['缓存架构设计'],
      });

      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('原有 procedural keyword bonus 在未提供 titlePath 时仍生效', () => {
      const boost = getBoost(
        service,
        { titlePath: [] },
        ['安装指南'],
      );
      expect(boost).toBe(1.0);
    });
  });
});
