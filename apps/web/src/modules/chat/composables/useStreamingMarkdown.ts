/**
 * 流式 Markdown 增量渲染 Composable
 *
 * 策略：逐 token 接收文本增量，块级 flush，通过 innerHTML 追加实现流畅渲染。
 * 代码高亮使用 Shiki + shiki-stream，替换原先的 highlight.js。
 */
import { marked } from 'marked'
import { getHighlighter } from '../utils/shiki'
import type { HighlighterCore } from 'shiki/core'

marked.setOptions({
  breaks: true,
  gfm: true,
})

/**
 * HTML 实体编码
 */
function encodeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** 内部状态 */
interface StreamingMarkdownState {
  buffer: string
  isInCodeBlock: boolean
  codeBlockBuffer: string
  codeBlockLang: string
}

interface StreamingMarkdownOptions {
  /** 每次 flush 回调，接收增量 HTML 片段 */
  onFlush: (html: string) => void
  /** 解析完成回调 */
  onComplete?: () => void
  /** 错误回调 */
  onError?: (error: Error) => void
  /** 是否启用代码高亮，默认 true */
  highlight?: boolean
  /** 强制 flush 的 buffer 大小阈值，默认 80 */
  flushThreshold?: number
}

/**
 * 创建流式 Markdown 渲染器
 */
export function useStreamingMarkdown(options: StreamingMarkdownOptions) {
  const {
    onFlush,
    onComplete,
    onError,
    highlight = true,
    flushThreshold = 80,
  } = options

  const state: StreamingMarkdownState = {
    buffer: '',
    isInCodeBlock: false,
    codeBlockBuffer: '',
    codeBlockLang: '',
  }

  let lastFlushLen = 0
  let highlighter: HighlighterCore | null = null
  let isFlushing = false

  // 预加载 Shiki 高亮器
  getHighlighter().then((h) => {
    highlighter = h
  })

  /**
   * 解析 Markdown 文本为 HTML
   */
  function parseMarkdown(text: string): string {
    try {
      return marked.parse(text, { async: false }) as string
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)))
      return encodeHTML(text)
    }
  }

  /**
   * 提取代码块信息
   */
  function extractCodeBlock(text: string): { lang: string; code: string } | null {
    const match = text.match(/^```(\w*)\n([\s\S]*?)```$/m)
    if (!match) return null
    return {
      lang: match[1] || 'plaintext',
      code: match[2],
    }
  }

  /**
   * 使用 Shiki 语法高亮代码块。
   * 高亮器被预加载，通常调用时已完成初始化。
   */
  async function highlightCode(code: string, lang: string): Promise<string> {
    if (!highlight) {
      return encodeHTML(code)
    }

    if (!highlighter) {
      // 高亮器尚未初始化完成，回退纯文本
      return encodeHTML(code)
    }

    try {
      const langName = lang || 'text'
      const theme = 'github-dark'
      const loadedLangs = highlighter.getLoadedLanguages()

      if (loadedLangs.includes(langName as string)) {
        return highlighter.codeToHtml(code.trimEnd(), {
          lang: langName,
          theme,
        })
      }

      // 语言未注册则回退纯文本
      return highlighter.codeToHtml(code.trimEnd(), { lang: 'text', theme })
    } catch {
      return `<pre><code>${encodeHTML(code)}</code></pre>`
    }
  }

  /**
   * 处理代码块内容为 HTML
   */
  async function processCodeBlock(code: string, lang: string): Promise<string> {
    return highlightCode(code, lang)
  }

  /**
   * 执行一次 flush：检测缓冲中的完整块并输出 HTML。
   */
  async function doFlush(force: boolean): Promise<void> {
    const { buffer } = state

    // 检测代码块状态
    if (!state.isInCodeBlock && buffer.includes('```')) {
      const firstCodeIdx = buffer.indexOf('```')
      const lastCodeIdx = buffer.lastIndexOf('```')
      if (firstCodeIdx !== lastCodeIdx) {
        // 有完整的代码块
        const before = buffer.slice(0, firstCodeIdx)
        const codeBlock = buffer.slice(firstCodeIdx, lastCodeIdx + 3)
        const after = buffer.slice(lastCodeIdx + 3)

        if (before.trim()) {
          const html = parseMarkdown(before)
          if (html) onFlush(html)
        }

        const codeInfo = extractCodeBlock(codeBlock)
        if (codeInfo) {
          const html = await processCodeBlock(codeInfo.code, codeInfo.lang)
          onFlush(html)
        }

        state.buffer = after
        return doFlush(force)
      } else {
        // 只有一个 ```，进入代码块模式
        state.isInCodeBlock = true
        state.codeBlockBuffer = buffer.slice(firstCodeIdx + 3)
        state.codeBlockLang = ''
        state.buffer = ''
        // 尝试提取语言标识
        const langMatch = state.codeBlockBuffer.match(/^(\w+)\n/)
        if (langMatch) {
          state.codeBlockLang = langMatch[1]
          state.codeBlockBuffer = state.codeBlockBuffer.slice(langMatch[0].length)
        }
        return
      }
    }

    // 处理代码块内
    if (state.isInCodeBlock) {
      if (state.buffer.includes('```')) {
        const lastCodeIdx = state.buffer.lastIndexOf('```')
        const codeContent = state.buffer.slice(0, lastCodeIdx)
        const rest = state.buffer.slice(lastCodeIdx + 3)

        const html = await processCodeBlock(
          state.codeBlockBuffer + codeContent,
          state.codeBlockLang,
        )
        onFlush(html)
        state.isInCodeBlock = false
        state.codeBlockBuffer = ''
        state.codeBlockLang = ''
        state.buffer = rest
        return doFlush(force)
      }
      // 还在代码块内，累积
      state.codeBlockBuffer += state.buffer
      state.buffer = ''
      return
    }

    // 常规 flush：遇到空行、buffer 过大或单行标题
    const shouldFlush =
      force ||
      (buffer.length > flushThreshold && lastFlushLen < buffer.length) ||
      /\n\n/.test(buffer) ||
      /^#{1,6}\s.+$/m.test(buffer)

    if (!shouldFlush) return

    // 找到最近的段落分隔位置
    let flushPoint = buffer.length
    if (!force) {
      const lastDoubleNewline = buffer.lastIndexOf('\n\n')
      if (lastDoubleNewline > 0) {
        flushPoint = lastDoubleNewline
      }
    }

    const toFlush = buffer.slice(0, flushPoint)
    const remaining = buffer.slice(flushPoint)

    if (toFlush.trim()) {
      const html = parseMarkdown(toFlush)
      if (html) onFlush(html)
    }

    lastFlushLen = remaining.length
    state.buffer = remaining
  }

  /**
   * 入队 flush 操作，确保同一时间只有一个 flush 在执行。
   */
  function tryFlush(force = false): void {
    if (isFlushing) return // 已有 flush 在执行，新数据会在当前 flush 完成后处理
    isFlushing = true
    const bufferLenBefore = state.buffer.length
    doFlush(force)
      .finally(() => {
        isFlushing = false
      })
      .then(() => {
        // 仅在 buffer 有新数据（长度变化）时继续处理，防止无限微任务循环
        if (state.buffer.length > 0 && state.buffer.length !== bufferLenBefore) {
          tryFlush()
        }
      })
  }

  /**
   * 接收文本增量
   */
  function pushDelta(delta: string): void {
    if (!delta) return

    if (delta.startsWith('<')) {
      state.buffer += delta
      tryFlush(true)
      return
    }

    state.buffer += delta

    // 检测单行完整标题并立即 flush
    const lastLine = state.buffer.split('\n').pop() || ''
    if (/^#{1,6}\s/.test(lastLine) && lastLine.length > 2) {
      tryFlush(true)
      return
    }

    tryFlush()
  }

  /**
   * 强制 flush 剩余 buffer
   */
  async function flush(): Promise<void> {
    // 等待当前 flush 完成后再执行最终 flush
    isFlushing = true
    try {
      await doFlush(true)

      // 处理剩余的代码块
      if (state.isInCodeBlock && state.codeBlockBuffer) {
        const html = await processCodeBlock(
          state.codeBlockBuffer,
          state.codeBlockLang,
        )
        onFlush(html)
        state.isInCodeBlock = false
        state.codeBlockBuffer = ''
        state.codeBlockLang = ''
      }

      // 处理剩余文本
      if (state.buffer.trim()) {
        const html = parseMarkdown(state.buffer)
        if (html) onFlush(html)
        state.buffer = ''
      }

      lastFlushLen = 0
      onComplete?.()
    } finally {
      isFlushing = false
    }
  }

  /**
   * 获取当前 buffer 内容
   */
  function getBuffer(): string {
    return state.buffer
  }

  /**
   * 重置状态
   */
  function reset(): void {
    state.buffer = ''
    state.isInCodeBlock = false
    state.codeBlockBuffer = ''
    state.codeBlockLang = ''
    lastFlushLen = 0
    isFlushing = false
  }

  return {
    pushDelta,
    flush,
    getBuffer,
    reset,
  }
}
