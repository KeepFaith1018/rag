/**
 * RAG 批量质量评估脚本
 *
 * 批量跑测试问题，收集 fact_check / completeness_check / relevance_check 输出，
 * 生成 JSON 格式的质量基线报告。
 *
 * 前置: Docker + 后端 dev:server 运行中
 * 使用: EVAL_EMAIL=x EVAL_PASSWORD=y node scripts/evaluate.mjs
 *
 * 输出: evaluation-report-YYYYMMDD-HHmmss.json
 */

import { readFileSync, writeFileSync } from 'fs'

const BASE_URL = process.env.API_BASE || 'http://localhost:3000/api'
const EVAL_EMAIL = process.env.EVAL_EMAIL
const EVAL_PASSWORD = process.env.EVAL_PASSWORD

if (!EVAL_EMAIL || !EVAL_PASSWORD) {
  console.error('请设置环境变量: EVAL_EMAIL EVAL_PASSWORD')
  process.exit(1)
}

const QUESTIONS_PATH = process.env.QUESTIONS_PATH || 'docs/06-优化/RAG全链路优化/test-questions.json'

async function login() {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EVAL_EMAIL, password: EVAL_PASSWORD }),
  })
  const data = await res.json()
  return data.data?.accessToken
}

async function createSession(token, title) {
  const res = await fetch(`${BASE_URL}/chat/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title }),
  })
  const data = await res.json()
  return data.data?.id
}

async function streamChat(token, sessionId, question, kbIds) {
  const res = await fetch(`${BASE_URL}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ sessionId, chatMode: 'rag', message: question, selectedKbIds: kbIds }),
  })
  return res.body.getReader()
}

function extractMetrics(events) {
  const metrics = {
    factCheckRisk: null,
    factCheckItemCount: 0,
    completenessCoverage: null,
    relevanceVerdicts: [],
    auditVerdicts: [],
    retryCount: 0,
    totalDurationMs: 0,
    answerLength: 0,
    supplementAdded: false,
    error: null,
  }

  const errorEvent = events.find(e => e.type === 'RUN_ERROR')
  if (errorEvent) {
    metrics.error = errorEvent.error
    return metrics
  }

  // 用各步骤耗时累加估算总耗时（SSE 事件无统一 timestamp）
  for (const e of events) {
    if (e.type === 'STEP_FINISHED' && e.durationMs) {
      metrics.totalDurationMs += e.durationMs
    }
  }

  for (const e of events) {
    if (e.type === 'STEP_FINISHED') {
      switch (e.stepName) {
        case 'fact_check':
          metrics.factCheckRisk = e.output?.skipped ? 'skipped' : (e.output?.overallRisk || null)
          metrics.factCheckItemCount = e.output?.itemCount || 0
          break
        case 'completeness_check':
          metrics.completenessCoverage = e.output?.coverage
          break
        case 'relevance_check':
          metrics.relevanceVerdicts.push(e.output?.verdict || 'unknown')
          break
        case 'audit':
          metrics.auditVerdicts.push(e.output?.verdict || 'unknown')
          break
        case 'rewrite_fallback':
          metrics.retryCount++
          break
        case 'writer':
          metrics.answerLength = e.output?.answerLength || 0
          break
      }
    }
    if (e.type === 'VALIDATION_COMPLETED') {
      metrics.supplementAdded = e.supplementAdded || false
    }
  }

  return metrics
}

async function evaluateOne(token, q, idx, total) {
  console.log(`\n[${idx + 1}/${total}] ${q.id}: ${q.question.slice(0, 50)}...`)

  const sessionId = await createSession(token, q.question.slice(0, 50))
  const reader = await streamChat(token, sessionId, q.question, q.kbIds)
  const decoder = new TextDecoder()

  const events = []
  let buffer = ''
  let streamStart = Date.now()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const json = trimmed.slice(6)
      if (json === '[DONE]') { events.push({ type: 'DONE' }); continue }
      try { events.push(JSON.parse(json)) } catch {}
    }
  }

  const metrics = extractMetrics(events)
  const elapsed = ((Date.now() - streamStart) / 1000).toFixed(1)

  const icon = metrics.error ? '✗' : metrics.factCheckRisk === 'low' ? '✓' : '⚠'
  console.log(`  ${icon} risk=${metrics.factCheckRisk || 'skipped'} coverage=${metrics.completenessCoverage != null ? Math.round(metrics.completenessCoverage * 100) + '%' : 'N/A'} retries=${metrics.retryCount} supplement=${metrics.supplementAdded} ${elapsed}s`)

  return {
    id: q.id,
    question: q.question,
    category: q.category,
    ...metrics,
  }
}

async function main() {
  const questions = JSON.parse(readFileSync(QUESTIONS_PATH, 'utf-8'))
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

  console.log('═══════════════════════════════════════════')
  console.log('  RAG 质量基线批量评估')
  console.log('═══════════════════════════════════════════')
  console.log(`  题目数: ${questions.length}`)
  console.log(`  Base URL: ${BASE_URL}`)

  console.log('\n[0] 登录...')
  const token = await login()
  if (!token) { console.error('登录失败'); process.exit(1) }
  console.log('  登录成功 ✓')

  const results = []
  let totalDuration = 0

  for (let i = 0; i < questions.length; i++) {
    const result = await evaluateOne(token, questions[i], i, questions.length)
    results.push(result)
    totalDuration += result.totalDurationMs
  }

  // ── 汇总 ──
  const factCheckLows = results.filter(r => r.factCheckRisk === 'low').length
  const factCheckMediums = results.filter(r => r.factCheckRisk === 'medium').length
  const factCheckHighs = results.filter(r => r.factCheckRisk === 'high').length
  const coverages = results.filter(r => r.completenessCoverage != null).map(r => r.completenessCoverage)
  const avgCoverage = coverages.length > 0
    ? Math.round(coverages.reduce((a, b) => a + b, 0) / coverages.length * 100)
    : null
  const supplementCount = results.filter(r => r.supplementAdded).length
  const errorCount = results.filter(r => r.error).length
  const avgDuration = Math.round(totalDuration / results.length / 1000)

  const summary = {
    timestamp: new Date().toISOString(),
    totalQuestions: questions.length,
    errorCount,
    factCheckDistribution: { low: factCheckLows, medium: factCheckMediums, high: factCheckHighs },
    avgCompletenessCoverage: avgCoverage != null ? avgCoverage / 100 : null,
    supplementRate: `${supplementCount}/${questions.length}`,
    avgDurationSeconds: avgDuration,
    avgRetryCount: (results.reduce((a, b) => a + b.retryCount, 0) / results.length).toFixed(1),
    details: results,
  }

  const reportFile = `evaluation-report-${timestamp}.json`
  writeFileSync(reportFile, JSON.stringify(summary, null, 2), 'utf-8')

  console.log('\n═══════════════════════════════════════════')
  console.log('  评估完成')
  console.log('═══════════════════════════════════════════')
  console.log(`  总题数:       ${questions.length}`)
  console.log(`  错误数:       ${errorCount}`)
  console.log(`  fact_check:   low=${factCheckLows} medium=${factCheckMediums} high=${factCheckHighs}`)
  console.log(`  平均覆盖率:   ${avgCoverage != null ? avgCoverage + '%' : 'N/A'}`)
  console.log(`  补充触发率:   ${supplementCount}/${questions.length}`)
  console.log(`  平均耗时:     ${avgDuration}s`)
  console.log(`  平均重试:     ${summary.avgRetryCount} 次`)
  console.log(`  报告文件:     ${reportFile}`)
}

main().catch(err => { console.error('评估异常:', err); process.exit(1) })
