/// <reference types="jest" />

import { buildContextText } from './multi-agent-orchestrator.service';
import type { RerankedHit } from '../../rag/retrieval/interfaces/reranked-hit.interface';
import type { WebSearchResult } from '../../rag/web-search/web-search.service';

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
  it('无知识库和联网结果时返回明确的无上下文提示', () => {
    expect(buildContextText([], [])).toBe('（知识库中未检索到相关上下文）');
  });

  it('同时存在知识库和联网结果时分区拼接', () => {
    const webResult: WebSearchResult = {
      title: '联网结果',
      url: 'https://example.com',
      content: '联网补充内容',
    };

    const text = buildContextText([makeHit()], [webResult]);

    expect(text).toContain('【知识库检索结果】');
    expect(text).toContain('[KB-1] 文档: 测试文档');
    expect(text).toContain('知识库内容');
    expect(text).toContain('【联网搜索结果】');
    expect(text).toContain('[Web-1] 联网结果');
  });
});
