/**
 * 后端 SSE 流式输出抓包脚本
 *
 * 用途：模拟前端调用流式对话接口，将所有 SSE 事件写入本地文件，
 *       用于校验后端各 Agent 节点是否正确发送。
 *
 * 前置条件：
 *   1. Docker 基础设施已启动: docker compose up -d
 *   2. 后端开发服务器运行中: pnpm dev:server
 *
 * 使用方式：
 *   node capture-sse.mjs <email> <password> "<问题>" [<知识库ID>]
 *
 * 示例：
 *   node capture-sse.mjs test@test.com 123456 "Apache Doris 的列式存储引擎如何实现高效压缩？"
 *   node capture-sse.mjs test@test.com 123456 "介绍一下Doris" "kb_abc123"
 *
 * 输出：
 *   sse-capture-YYYYMMDD-HHmmss.txt   — 原始 SSE 事件
 *   sse-capture-YYYYMMDD-HHmmss.json  — 结构化事件列表（便于 diff 比对）
 */

const BASE_URL = process.env.API_BASE || 'http://localhost:3000/api'

async function main() {
  const args = process.argv.slice(2)
  if (args.length < 3) {
    console.error('用法: node capture-sse.mjs <email> <password> "<问题>" [<知识库ID>]')
    process.exit(1)
  }

  const [email, password, question, kbId] = args
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

  console.log('═══════════════════════════════════════════')
  console.log('  后端 SSE 流式输出 抓包脚本')
  console.log('═══════════════════════════════════════════')
  console.log(`  Base URL: ${BASE_URL}`)
  console.log(`  用户: ${email}`)
  console.log(`  问题: ${question}`)
  if (kbId) console.log(`  知识库: ${kbId}`)
  console.log('')

  // ═══ Step 1: 登录 ═══
  console.log('[1/3] 登录获取 JWT...')
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!loginRes.ok) {
    const err = await loginRes.text()
    console.error(`  登录失败 (${loginRes.status}): ${err}`)
    process.exit(1)
  }
  const loginData = await loginRes.json()
  const token = loginData.data?.accessToken
  if (!token) {
    console.error('  登录响应中未找到 accessToken:', JSON.stringify(loginData))
    process.exit(1)
  }
  console.log('  登录成功 ✓')

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }

  // ═══ Step 2: 创建会话 ═══
  console.log('[2/3] 创建对话会话...')
  const sessionRes = await fetch(`${BASE_URL}/chat/sessions`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ title: question.slice(0, 50) }),
  })
  if (!sessionRes.ok) {
    const err = await sessionRes.text()
    console.error(`  创建会话失败 (${sessionRes.status}): ${err}`)
    process.exit(1)
  }
  const sessionData = await sessionRes.json()
  const sessionId = sessionData.data?.id
  if (!sessionId) {
    console.error('  创建会话响应中未找到 id:', JSON.stringify(sessionData))
    process.exit(1)
  }
  console.log(`  会话创建成功: ${sessionId} ✓`)

  // ═══ Step 3: 发起流式对话并抓包 ═══
  console.log('[3/3] 发起流式对话，抓取 SSE 事件...')
  console.log('')

  const body = {
    sessionId,
    chatMode: kbId ? 'rag' : 'chat',
    message: question,
    ...(kbId ? { selectedKbIds: [kbId] } : {}),
  }

  const streamRes = await fetch(`${BASE_URL}/chat/stream`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(body),
  })

  if (!streamRes.ok) {
    const err = await streamRes.text()
    console.error(`  流式请求失败 (${streamRes.status}): ${err}`)
    process.exit(1)
  }

  // 读取 SSE 流
  const reader = streamRes.body.getReader()
  const decoder = new TextDecoder()
  const rawFile = `sse-capture-${timestamp}.txt`
  const jsonFile = `sse-capture-${timestamp}.json`

  const fs = await import('fs')
  const rawStream = fs.createWriteStream(rawFile, { encoding: 'utf-8' })
  const events = []
  let buffer = ''

  rawStream.write(`# SSE Capture — ${new Date().toISOString()}\n`)
  rawStream.write(`# Question: ${question}\n`)
  rawStream.write(`# Session: ${sessionId}\n`)
  rawStream.write(`# ChatMode: ${body.chatMode}\n`)
  rawStream.write(`# KB: ${kbId || 'none'}\n`)
  rawStream.write(`# ${'='.repeat(60)}\n\n`)

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        rawStream.write(trimmed + '\n')

        if (trimmed.startsWith('data: ')) {
          const json = trimmed.slice(6)
          if (json === '[DONE]') {
            events.push({ type: 'DONE' })
          } else {
            try {
              const event = JSON.parse(json)
              events.push(event)
              // 打印关键事件到终端
              if (event.type === 'RUN_STARTED') {
                console.log(`  ▶ RUN_STARTED  ${event.runId}`)
              } else if (event.type === 'RUN_FINISHED') {
                console.log(`  ✓ RUN_FINISHED`)
              } else if (event.type === 'STEP_STARTED') {
                console.log(`    ┌ STEP_STARTED   ${event.stepName}`)
              } else if (event.type === 'STEP_FINISHED') {
                const dur = event.durationMs ? ` (${event.durationMs}ms)` : ''
                console.log(`    └ STEP_FINISHED  ${event.stepName}${dur}`)
              } else if (event.type === 'TOOL_CALL_START') {
                console.log(`    │ TOOL_START     ${event.toolCallName}`)
              } else if (event.type === 'TOOL_CALL_RESULT') {
                const dur = event.durationMs ? ` (${event.durationMs}ms)` : ''
                console.log(`    │ TOOL_RESULT    ${event.toolCallName}${dur}`)
              } else if (event.type === 'TEXT_MESSAGE_START') {
                console.log(`    ~ TEXT_START`)
              } else if (event.type === 'TEXT_MESSAGE_END') {
                console.log(`    ~ TEXT_END`)
              } else if (event.type === 'RUN_ERROR') {
                console.log(`  ✗ RUN_ERROR: ${event.error}`)
              }
            } catch {
              // 非 JSON 数据行，记录原始文本
              events.push({ _raw: json })
            }
          }
        }
      }
    }
  } finally {
    rawStream.end()
  }

  // 写入结构化 JSON
  fs.writeFileSync(jsonFile, JSON.stringify(events, null, 2), 'utf-8')

  console.log('')
  console.log('═══════════════════════════════════════════')
  console.log('  抓包完成')
  console.log('═══════════════════════════════════════════')
  console.log(`  事件总数: ${events.length}`)
  console.log(`  事件类型分布:`)
  const typeCount = {}
  for (const e of events) {
    const t = e.type || (e._raw ? '_raw' : 'unknown')
    typeCount[t] = (typeCount[t] || 0) + 1
  }
  for (const [type, count] of Object.entries(typeCount).sort()) {
    console.log(`    ${type}: ${count}`)
  }
  console.log(`  原始文件: ${rawFile}`)
  console.log(`  JSON 文件: ${jsonFile}`)
}

main().catch((err) => {
  console.error('脚本异常:', err)
  process.exit(1)
})
