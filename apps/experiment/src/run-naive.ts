/**
 * RAG 对比实验 — Naïve RAG（稠密检索 + 直接生成）
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { denseRetrieve } from './shared/dense-retrieval.js';
import { streamGenerate as llmStream } from './shared/llm.js';
import { buildContext, sleep } from './shared/utils.js';
import type { TestData, ExperimentEntry, ExperimentReport } from './shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUESTIONS_PATH = resolve(__dirname, '../experiment-results/test-questions.json');
const OUTPUT_PATH = resolve(__dirname, '../experiment-results/naive.json');
const RATE_LIMIT_MS = 6000;
const TOP_K = 10;
const SCORE_THRESHOLD = 0.3;

async function runOne(
  q: { id: string; text: string; type: string },
  kbIds: string[],
): Promise<ExperimentEntry> {
  const totalStart = Date.now();
  try {
    if (q.type === 'greeting') {
      const genStart = Date.now();
      const answer = await llmStream(
        '你是 Linsor AI 的智能助手，请友好地回答用户的问题。',
        q.text,
      );
      return {
        questionId: q.id, question: q.text, questionType: q.type, answer,
        hitCount: 0, totalDurationMs: Date.now() - totalStart,
        stepDurations: { retrieval: 0, generation: Date.now() - genStart },
      };
    }

    const retrievalStart = Date.now();
    const hits = await denseRetrieve({
      queries: [q.text], kbIds, topK: TOP_K, scoreThreshold: SCORE_THRESHOLD,
    });
    const retrievalDuration = Date.now() - retrievalStart;

    const context = buildContext(hits);
    const genStart = Date.now();
    const prompt = `基于以下上下文回答问题。如果上下文中没有相关信息，请如实说明。\n\n上下文：\n${context}\n\n问题：${q.text}`;
    const answer = await llmStream(prompt, q.text);
    const genDuration = Date.now() - genStart;

    return {
      questionId: q.id, question: q.text, questionType: q.type, answer,
      hitCount: hits.length, totalDurationMs: Date.now() - totalStart,
      stepDurations: { retrieval: retrievalDuration, generation: genDuration },
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
  console.log('  Naïve RAG 对比实验');
  console.log('═══════════════════════════════════════════\n');

  const testData = JSON.parse(readFileSync(QUESTIONS_PATH, 'utf-8')) as TestData;
  console.log(`  问题总数: ${testData.questions.length}`);
  console.log(`  知识库: ${testData.kbIds.join(', ')}\n`);

  const results: ExperimentEntry[] = [];
  for (let i = 0; i < testData.questions.length; i++) {
    const q = testData.questions[i];
    process.stdout.write(`  [${i + 1}/${testData.questions.length}] ${q.id} (${q.type})... `);
    const entry = await runOne(q, testData.kbIds);
    results.push(entry);
    const icon = entry.error ? '✗' : '✓';
    console.log(`${icon} ${entry.totalDurationMs}ms answer=${entry.answer.length}chars hits=${entry.hitCount}`);
    if (entry.error) console.log(`    错误: ${entry.error}`);
    if (i < testData.questions.length - 1) await sleep(RATE_LIMIT_MS);
  }

  const valid = results.filter((r) => !r.error);
  const report: ExperimentReport = {
    experiment: 'naive-rag',
    timestamp: new Date().toISOString(),
    kbIds: testData.kbIds,
    config: { topK: TOP_K, scoreThreshold: SCORE_THRESHOLD },
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
