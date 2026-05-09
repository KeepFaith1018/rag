/**
 * 汇总报告：读取 naive.json / advanced.json / agentic.json → summary.md
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS = resolve(__dirname, '../experiment-results');

interface Entry {
  questionId: string; question: string; questionType: string;
  answer: string; hitCount: number; totalDurationMs: number; error?: string;
}
interface Report {
  experiment: string; kbIds: string[]; config: Record<string, unknown>;
  results: Entry[];
  aggregation: { avgDurationMs: number; avgHitCount: number; avgAnswerLength: number; totalErrors: number };
}

function read(name: string): Report {
  return JSON.parse(readFileSync(resolve(RESULTS, name), 'utf-8'));
}
function tLabel(t: string) {
  const m: Record<string, string> = { fact_lookup: '事实查询', compare_analysis: '对比分析', research_or_open_world: '开放研究', greeting: '问候' };
  return m[t] ?? t;
}
function avg(vals: number[]) { return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0; }

function main() {
  const naive = read('naive.json');
  const advanced = read('advanced.json');
  const agentic = read('agentic.json');

  const allTypes = [...new Set([...naive.results, ...advanced.results, ...agentic.results].map((r) => r.questionType))];
  const vN = naive.results.filter((r) => !r.error);
  const vA = advanced.results.filter((r) => !r.error);
  const vG = agentic.results.filter((r) => !r.error);

  const L: string[] = [];
  L.push('## RAG 对比实验报告\n');
  L.push('### 实验环境');
  L.push(`- 测试问题总数：**${naive.results.length}**`);
  L.push(`- 知识库 ID：${naive.kbIds.join(', ')}`);
  L.push(`- Naïve：Dense only / topK=${naive.config.topK}`);
  L.push(`- Advanced：改写 ${advanced.config.rewriteModel} + 混合检索 + RRF + Rerank / topN=${advanced.config.rerankTopN}`);
  L.push(`- Agentic：完整 Multi-Agent 编排（HTTP SSE）`);
  L.push(`- 测试日期：${new Date().toISOString().slice(0, 10)}\n`);

  L.push('### 总览\n');
  L.push('| 方案 | 平均耗时(ms) | 平均命中数 | 平均答案长度(字) | 错误数 |');
  L.push('|------|:---:|:---:|:---:|:---:|');
  L.push(`| Naïve RAG | ${naive.aggregation.avgDurationMs} | ${naive.aggregation.avgHitCount} | ${naive.aggregation.avgAnswerLength} | ${naive.aggregation.totalErrors} |`);
  L.push(`| Advanced RAG | ${advanced.aggregation.avgDurationMs} | ${advanced.aggregation.avgHitCount} | ${advanced.aggregation.avgAnswerLength} | ${advanced.aggregation.totalErrors} |`);
  L.push(`| Agentic RAG | ${agentic.aggregation.avgDurationMs} | ${agentic.aggregation.avgHitCount} | ${agentic.aggregation.avgAnswerLength} | ${agentic.aggregation.totalErrors} |\n`);

  L.push('### 按问题类型分组\n');
  L.push('| 类型 | Naïve(ms) | Advanced(ms) | Agentic(ms) | Naïve命中 | Advanced命中 | Agentic命中 |');
  L.push('|------|:---:|:---:|:---:|:---:|:---:|:---:|');

  const byType = (rs: Entry[]) => {
    const m = new Map<string, Entry[]>();
    for (const r of rs) { if (!m.has(r.questionType)) m.set(r.questionType, []); m.get(r.questionType)!.push(r); }
    return m;
  };
  const nT = byType(vN), aT = byType(vA), gT = byType(vG);
  for (const t of allTypes) {
    const ng = nT.get(t) ?? [], ag = aT.get(t) ?? [], gg = gT.get(t) ?? [];
    L.push(`| ${tLabel(t)} (${Math.max(ng.length, ag.length, gg.length)}题) | ${avg(ng.map((r) => r.totalDurationMs))} | ${avg(ag.map((r) => r.totalDurationMs))} | ${avg(gg.map((r) => r.totalDurationMs))} | ${avg(ng.map((r) => r.hitCount))} | ${avg(ag.map((r) => r.hitCount))} | ${avg(gg.map((r) => r.hitCount))} |`);
  }

  L.push('\n### 各问题详细对比\n');
  L.push('| ID | 类型 | Naïve(ms) | Advanced(ms) | Agentic(ms) | N答案 | A答案 | G答案 |');
  L.push('|----|------|:---:|:---:|:---:|:---:|:---:|:---:|');
  for (let i = 0; i < naive.results.length; i++) {
    const n = naive.results[i], a = advanced.results[i], g = agentic.results[i];
    if (!n || !a || !g) continue;
    L.push(`| ${n.questionId} | ${tLabel(n.questionType)} | ${n.totalDurationMs} | ${a.totalDurationMs} | ${g.totalDurationMs} | ${n.answer.length} | ${a.answer.length} | ${g.answer.length} |`);
  }

  const out = resolve(RESULTS, 'summary.md');
  writeFileSync(out, L.join('\n'), 'utf-8');
  console.log(`汇总报告 → ${out}`);
  console.log(L.join('\n'));
}

main();
