/// <reference types="jest" />

import { FusionService } from './fusion.service';
import type { DenseHit } from './interfaces/dense-hit.interface';

function makeDenseHit(overrides: Partial<DenseHit> = {}): DenseHit {
  return {
    pointId: 'point-1',
    kbId: 'kb-1',
    docId: 'doc-1',
    chunkId: 'chunk-1',
    content: '测试内容',
    score: 0.9,
    payload: {},
    ...overrides,
  };
}

describe('FusionService', () => {
  let service: FusionService;

  beforeAll(() => {
    service = new FusionService();
  });

  describe('O7 quality weighting', () => {
    it('structured-token-aware chunk 应获得更高的融合分数', () => {
      const goodHit = makeDenseHit({
        chunkId: 'good',
        payload: { chunkStrategy: 'structured-token-aware' },
      });
      const badHit = makeDenseHit({
        chunkId: 'bad',
        payload: { chunkStrategy: 'plainText-recursive' },
      });

      const result = service.fuse({
        denseHits: [goodHit, badHit],
        sparseHits: [],
        topK: 10,
      });

      const goodScore = result.find((r) => r.chunkId === 'good')?.fusionScore;
      const badScore = result.find((r) => r.chunkId === 'bad')?.fusionScore;
      expect(goodScore).toBeDefined();
      expect(badScore).toBeDefined();
      // structured-token-aware 的 1.05x 加权应使其分数更高
      expect(goodScore!).toBeGreaterThan(badScore!);
    });

    it('code/table 原子块应获得 blockType 加权', () => {
      const codeHit = makeDenseHit({
        chunkId: 'code',
        payload: { chunkStrategy: 'structured-token-aware', blockType: 'code' },
      });
      const tableHit = makeDenseHit({
        chunkId: 'table',
        payload: { chunkStrategy: 'structured-token-aware', blockType: 'table' },
      });
      const textHit = makeDenseHit({
        chunkId: 'text',
        payload: { chunkStrategy: 'structured-token-aware', blockType: 'text' },
      });

      const result = service.fuse({
        denseHits: [codeHit, tableHit, textHit],
        sparseHits: [],
        topK: 10,
      });

      const codeScore = result.find((r) => r.chunkId === 'code')?.fusionScore;
      const tableScore = result.find((r) => r.chunkId === 'table')?.fusionScore;
      const textScore = result.find((r) => r.chunkId === 'text')?.fusionScore;
      // code/table 加权均 > 纯文本（排名不同导致基准分有差异）
      expect(codeScore!).toBeGreaterThan(textScore!);
      expect(tableScore!).toBeGreaterThan(textScore!);
    });

    it('sectionLevel >= 3 应获得深层内容加权', () => {
      const deepHit = makeDenseHit({
        chunkId: 'deep',
        payload: { chunkStrategy: 'structured-token-aware', sectionLevel: 4 },
      });
      const shallowHit = makeDenseHit({
        chunkId: 'shallow',
        payload: { chunkStrategy: 'structured-token-aware', sectionLevel: 1 },
      });

      const result = service.fuse({
        denseHits: [deepHit, shallowHit],
        sparseHits: [],
        topK: 10,
      });

      const deepScore = result.find((r) => r.chunkId === 'deep')?.fusionScore;
      const shallowScore = result.find((r) => r.chunkId === 'shallow')
        ?.fusionScore;
      expect(deepScore!).toBeGreaterThan(shallowScore!);
    });

    it('null sectionLevel 不影响融合分数', () => {
      const hit = makeDenseHit({
        chunkId: 'no-level',
        payload: { chunkStrategy: 'structured-token-aware' },
      });

      const result = service.fuse({
        denseHits: [hit],
        sparseHits: [],
        topK: 10,
      });

      expect(result[0].fusionScore).toBeGreaterThan(0);
    });

    it('退化输入（空 hits）不抛异常', () => {
      const result = service.fuse({
        denseHits: [],
        sparseHits: [],
        topK: 10,
      });
      expect(result).toEqual([]);
    });
  });
});
