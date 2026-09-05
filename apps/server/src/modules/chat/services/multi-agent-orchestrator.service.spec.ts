/// <reference types="jest" />

import { buildContextText } from './multi-agent-orchestrator.service';
import type { RerankedHit } from '../../rag/retrieval/interfaces/reranked-hit.interface';

function makeHit(overrides: Partial<RerankedHit> = {}): RerankedHit {
  return {
    chunkId: 'chunk-1',
    docId: 'doc-1',
    kbId: 'kb-1',
    content: '知识库内容',
    title: '测试文档',
    fusionScore: 0.8,
    rerankScore: 0.9,
    payload: {},
    ...overrides,
  };
}

describe('buildContextText', () => {
  it('无知识库结果时返回明确的无上下文提示', () => {
    expect(buildContextText([])).toBe('（知识库中未检索到相关上下文）');
  });

  it('存在知识库结果时拼接检索上下文', () => {
    const text = buildContextText([makeHit()]);

    expect(text).toContain('【知识库检索结果】');
    expect(text).toContain('[KB-1] 文档: 测试文档');
    expect(text).toContain('知识库内容');
  });
});
