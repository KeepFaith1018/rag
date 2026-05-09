/**
 * Agentic RAG 实验 — 顺序版，断点续跑，逐题可见。
 *
 * 命令行参数：
 *   npx tsx src/run-agentic.ts              # 跑所有未完成题目
 *   npx tsx src/run-agentic.ts 3            # 只跑第3题
 *   npx tsx src/run-agentic.ts 3-7          # 跑第3到7题
 *   npx tsx src/run-agentic.ts 1,5,10       # 跑第1,5,10题
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { TestData, ExperimentEntry, ExperimentReport } from './shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const Q_PATH = resolve(__dirname, '../experiment-results/test-questions.json');
const OUT = resolve(__dirname, '../experiment-results/agentic.json');
const BASE = 'http://localhost:3000/api';
const EMAIL = 'keepfaith1018@gmail.com';
const PASSWORD = '123456';

type R = { content: string; hitCount: number; sd: Record<string, number>; ms: number };

function now(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

/** 解析命令行参数为题目索引集合 (1-based → 0-based) */
function parseTargets(args: string[], total: number): number[] | null {
  if (args.length === 0) return null; // 全部
  const indices = new Set<number>();
  for (const arg of args) {
    if (arg.includes('-')) {
      const [a, b] = arg.split('-').map(Number);
      if (isNaN(a) || isNaN(b)) continue;
      for (let i = Math.max(1, a); i <= Math.min(total, b); i++) indices.add(i);
    } else if (arg.includes(',')) {
      for (const n of arg.split(',').map(Number)) {
        if (!isNaN(n) && n >= 1 && n <= total) indices.add(n);
      }
    } else {
      const n = Number(arg);
      if (!isNaN(n) && n >= 1 && n <= total) indices.add(n);
    }
  }
  return indices.size > 0 ? [...indices].sort((a, b) => a - b) : null;
}

async function login(): Promise<string> {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  const d = await r.json() as any;
  return d.data.accessToken;
}

async function createSession(token: string): Promise<string> {
  const r = await fetch(`${BASE}/chat/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ title: 'Agentic实验' }) });
  const d = await r.json() as any;
  return d.data.id;
}

async function streamOne(token: string, sid: string, q: string, kbIds: string[]): Promise<R> {
  const start = Date.now();
  console.log(`  [${now()}] 请求已发出`);
  const r = await fetch(`${BASE}/chat/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ sessionId: sid, chatMode: 'rag', message: q, selectedKbIds: kbIds }) });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '', content = '', hc = 0;
  const sd: Record<string, number> = {};
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const l of lines) {
      const t = l.trim(); if (!t.startsWith('data: ')) continue;
      try {
        const e = JSON.parse(t.slice(6));
        if (e.type === 'TEXT_MESSAGE_CONTENT') { content += e.delta || ''; process.stdout.write(e.delta as string); }
        else if (e.type === 'STEP_FINISHED') {
          if (e.durationMs) sd[e.stepName as string] = e.durationMs as number;
          console.log(`\n  [${now()}] ${e.stepName} ${e.durationMs ?? '?'}ms`);
        }
        else if (e.type === 'TOOL_CALL_RESULT' && e.toolCallName === 'search_knowledge_base') {
          const h = (e.output as any)?.hitCount ?? 0;
          hc += h;
          console.log(`  [${now()}] search: ${h} hits, ${e.durationMs}ms`);
        }
        else if (e.type === 'RUN_STARTED') {
          console.log(`  [${now()}] RUN_STARTED ${e.runId}`);
        }
        else if (e.type === 'RUN_FINISHED') {
          console.log(`  [${now()}] RUN_FINISHED`);
        }
        else if (e.type === 'RUN_ERROR') {
          console.log(`  [${now()}] RUN_ERROR: ${(e as any).error}`);
        }
      } catch { /* skip */ }
    }
  }
  return { content, hitCount: hc, sd, ms: Date.now() - start };
}

function loadResults(): ExperimentEntry[] {
  if (!existsSync(OUT)) return [];
  try { return (JSON.parse(readFileSync(OUT, 'utf-8')) as ExperimentReport).results ?? []; } catch { return []; }
}

function saveReport(results: ExperimentEntry[], kbIds: string[]) {
  const valid = results.filter(r => !r.error);
  const rpt: ExperimentReport = {
    experiment: 'agentic-rag', timestamp: new Date().toISOString(), kbIds,
    config: { mode: 'agentic-without-factcheck' },
    results,
    aggregation: {
      avgDurationMs: Math.round(valid.reduce((s, r) => s + r.totalDurationMs, 0) / (valid.length || 1)),
      avgHitCount: Math.round(valid.reduce((s, r) => s + r.hitCount, 0) / (valid.length || 1)),
      avgAnswerLength: Math.round(valid.reduce((s, r) => s + r.answer.length, 0) / (valid.length || 1)),
      totalErrors: results.length - valid.length,
    },
  };
  writeFileSync(OUT, JSON.stringify(rpt, null, 2), 'utf-8');
}

async function main() {
  const testData = JSON.parse(readFileSync(Q_PATH, 'utf-8')) as TestData;
  const qs = testData.questions;

  // 解析命令行参数
  const targets = parseTargets(process.argv.slice(2), qs.length);
  if (targets) {
    console.log(`指定题目: ${targets.join(', ')} (共 ${targets.length} 题)\n`);
  }

  const existing = loadResults();
  console.log(`已有 ${existing.length} 题结果\n`);

  const token = await login();
  const sid = await createSession(token);
  const results: ExperimentEntry[] = [...existing];
  // 补齐空位
  while (results.length < qs.length) results.push({} as ExperimentEntry);

  const toRun = targets
    ? targets.map(t => t - 1) // 1-based → 0-based
    : Array.from({ length: qs.length }, (_, i) => i).filter(i => !results[i]?.answer);

  if (toRun.length === 0) {
    console.log('所有题目已完成');
    return;
  }

  for (const i of toRun) {
    const q = qs[i];
    console.log(`\n── [${i + 1}/${qs.length}] ${q.id} (${q.type}) ── ${now()}`);
    console.log(`  问题: ${q.text.slice(0, 80)}...`);
    process.stdout.write('  答案: ');

    try {
      const r = await streamOne(token, sid, q.text, testData.kbIds);
      console.log('');
      results[i] = { questionId: q.id, question: q.text, questionType: q.type, answer: r.content, hitCount: r.hitCount, totalDurationMs: r.ms, stepDurations: r.sd };
      console.log(`  [${now()}] 完成: ${r.ms}ms | hits=${r.hitCount} | 答案=${r.content.length}字`);
    } catch (err) {
      results[i] = { questionId: q.id, question: q.text, questionType: q.type, answer: '', hitCount: 0, totalDurationMs: 0, stepDurations: {}, error: (err as Error).message };
      console.log(`\n  [${now()}] ✗ ${(err as Error).message}`);
    }
    saveReport(results.filter(r => r.questionId), testData.kbIds);
  }

  const valid = results.filter(r => r.questionId && !r.error);
  console.log(`\n\n═══ 完成 ═══`);
  console.log(`${valid.length}/${qs.length} 成功 | 平均 ${Math.round(valid.reduce((s,r)=>s+r.totalDurationMs,0)/(valid.length||1))}ms | 输出: ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
