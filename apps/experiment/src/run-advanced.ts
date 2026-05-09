/**
 * RAG 对比实验 — Advanced RAG（改写 + 混合检索 + RRF + Rerank + 生成）
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { denseRetrieve } from './shared/dense-retrieval.js';
import { retrieve as esRetrieve } from './shared/es-sparse.js';
import { fuse } from './shared/fusion.js';
import { rerank } from './shared/rerank.js';
import { invoke as llmInvoke, streamGenerate as llmStream, getLightModel } from './shared/llm.js';
import { buildContext, sleep } from './shared/utils.js';
import type { TestData, ExperimentEntry, ExperimentReport, QuestionType } from './shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUESTIONS_PATH = resolve(__dirname, '../experiment-results/test-questions.json');
const OUTPUT_PATH = resolve(__dirname, '../experiment-results/advanced.json');
const RATE_LIMIT_MS = 6000;
const DENSE_TOPK = 25;
const SPARSE_TOPK = 25;
const FUSION_TOPK = 50;
const RERANK_TOPN = 15;

const REWRITE_PROMPT = `你是一个搜索查询改写器。根据用户问题，生成1-3条适合知识库检索的查询。
规则：去除口语化表达，保留核心信息；对比分析类拆解为每个对象的独立查询；仅输出 JSON 数组。
示例输入: "Apache Doris 和 ClickHouse 在查询性能上有什么区别？"
示例输出: ["Apache Doris 查询性能特点","ClickHouse 查询性能特点","OLAP 数据库查询性能对比"]`;

function extractJsonArray(text: string): string[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]);
    return Array.isArray(arr) ? arr.map(String).filter((s) => s.trim()) : [];
  } catch { return []; }
}

async function rewriteQuery(question: string, lightModel: string): Promise<string[]> {
  try {
    const text = await llmInvoke(REWRITE_PROMPT, question, { model: lightModel, temperature: 0.3, timeout: 15000 });
    const queries = extractJsonArray(text);
    return queries.length > 0 ? queries : [question];
  } catch { return [question]; }
}

async function runOne(
  q: { id: string; text: string; type: string },
  kbIds: string[],
  lightModel: string,
): Promise<ExperimentEntry> {
  const totalStart = Date.now();
  try {
    if (q.type === 'greeting') {
      const genStart = Date.now();
      const answer = await llmStream('你是 Linsor AI 的智能助手，请友好地回答用户的问题。', q.text);
      return {
        questionId: q.id, question: q.text, questionType: q.type, answer,
        hitCount: 0, totalDurationMs: Date.now() - totalStart,
        stepDurations: { rewrite: 0, retrieval: 0, generation: Date.now() - genStart },
      };
    }

    // ① Query Rewrite
    const rewriteStart = Date.now();
    const queries = await rewriteQuery(q.text, lightModel);
    const rewriteDuration = Date.now() - rewriteStart;

    // ② Dense + Sparse 并行检索
    const retrievalStart = Date.now();
    const [denseHits, sparseHits] = await Promise.all([
      denseRetrieve({ queries, kbIds, topK: DENSE_TOPK, scoreThreshold: 0.15 }),
      esRetrieve({ queries, kbIds, topK: SPARSE_TOPK }),
    ]);
    const retrievalDuration = Date.now() - retrievalStart;

    // ③ RRF 融合
    const fusionStart = Date.now();
    const fusedHits = fuse({ denseHits, sparseHits, topK: FUSION_TOPK });
    const fusionDuration = Date.now() - fusionStart;

    // ④ Rerank
    const rerankStart = Date.now();
    const rerankedHits = await rerank({
      candidates: fusedHits,
      queries,
      questionType: (q.type === 'greeting' ? 'fact_lookup' : q.type) as QuestionType,
      topN: RERANK_TOPN,
    });
    const rerankDuration = Date.now() - rerankStart;

    // ⑤ Generate
    const context = buildContext(rerankedHits.slice(0, RERANK_TOPN));
    const genStart = Date.now();
    const prompt = `基于以下上下文回答问题。如果上下文中没有相关信息，请如实说明。\n\n上下文：\n${context}\n\n问题：${q.text}`;
    const answer = await llmStream(prompt, q.text);
    const genDuration = Date.now() - genStart;

    return {
      questionId: q.id, question: q.text, questionType: q.type, answer,
      hitCount: rerankedHits.length, totalDurationMs: Date.now() - totalStart,
      stepDurations: { rewrite: rewriteDuration, retrieval: retrievalDuration, fusion: fusionDuration, rerank: rerankDuration, generation: genDuration },
    };
  } catch (err) {
    return {
      questionId: q.id, question: q.text, questionType: q.type, answer: '',
      hitCount: 0, totalDurationMs: Date.now() - totalStart,
      stepDurations: {}, error: (err as Error).message,
    };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Advanced RAG 对比实验');
  console.log('═══════════════════════════════════════════\n');

  const lightModel = getLightModel();
  console.log(`  改写模型: ${lightModel}`);

  const testData = JSON.parse(readFileSync(QUESTIONS_PATH, 'utf-8')) as TestData;
  console.log(`  问题总数: ${testData.questions.length}`);
  console.log(`  知识库: ${testData.kbIds.join(', ')}\n`);

  const results: ExperimentEntry[] = [];
  for (let i = 0; i < testData.questions.length; i++) {
    const q = testData.questions[i];
    process.stdout.write(`  [${i + 1}/${testData.questions.length}] ${q.id} (${q.type})... `);
    const entry = await runOne(q, testData.kbIds, lightModel);
    results.push(entry);
    const icon = entry.error ? '✗' : '✓';
    console.log(`${icon} ${entry.totalDurationMs}ms answer=${entry.answer.length}chars hits=${entry.hitCount}`);
    if (entry.error) console.log(`    错误: ${entry.error}`);
    if (i < testData.questions.length - 1) await sleep(RATE_LIMIT_MS);
  }

  const valid = results.filter((r) => !r.error);
  const report: ExperimentReport = {
    experiment: 'advanced-rag',
    timestamp: new Date().toISOString(),
    kbIds: testData.kbIds,
    config: { rewriteModel: lightModel, denseTopK: DENSE_TOPK, sparseTopK: SPARSE_TOPK, fusionTopK: FUSION_TOPK, rerankTopN: RERANK_TOPN },
    results,
    aggregation: {
      avgDurationMs: Math.round(valid.reduce((s, r) => s + r.totalDurationMs, 0) / (valid.length || 1)),
      avgHitCount: Math.round(valid.reduce((s, r) => s + r.hitCount, 0) / (valid.length || 1)),
      avgAnswerLength: Math.round(valid.reduce((s, r) => s + r.answer.length, 0) / (valid.length || 1)),
      totalErrors: results.length - valid.length,
    },
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n  完成 → ${OUTPUT_PATH}`);
  console.log(`  平均耗时: ${report.aggregation.avgDurationMs}ms | 平均命中: ${report.aggregation.avgHitCount} | 错误: ${report.aggregation.totalErrors}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
