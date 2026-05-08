/**
 * 流式 Markdown 增量渲染 Composable
 *
 * 策略：Incremark 内部缓冲 + 判定稳定边界，
 * 我们只消费 completed/updated blocks 并通过 onBlocks 回调输出。
 * 代码高亮由下游 CodeBlock 组件负责。
 */
import { createIncremarkParser } from '@incremark/core'
import type { IncremarkParser, ParsedBlock } from '@incremark/core'

interface StreamingMarkdownOptions {
  /** 每次有新的已完成 blocks 时回调 */
  onBlocks: (blocks: ParsedBlock[]) => void
  /** 解析完成回调 */
  onComplete?: () => void
  /** 错误回调 */
  onError?: (error: Error) => void
}

/**
 * 预处理文本，修复 CommonMark 分界符 flanking 失效的边缘情况。
 *
 * 当 ** / * / ~~ 紧邻非空白字符且内侧为标点符号时，
 * 分界符的 flanking 判定失败 → 整个加粗/斜体/删除线不生效。
 * 此处补一个空格使分界符成为合法 flanking。
 */
function normalizeEmphasis(text: string): string {
  // 非空白字符（触碰分界符的那一侧）
  const ch = '[^\\s]'
  // 内侧标点：中英文引号 + 书名号等（CommonMark 归为 punctuation）
  const q = '["\\u201c\\u201d\\u2018\\u2019\\u300c\\u300d\\u300e\\u300f\\u300a\\u300b\\u3008\\u3009\\u3010\\u3011]'
  const e = '\\'

  return text
    // **bold** — 左侧触碰 + 内侧标点 → 在 ** 前补空格
    .replace(new RegExp(`(${ch})${e}*${e}*(${q})`, 'g'), '$1 **$2')
    // **bold** — 标点 + ** + 右侧触碰 → 在 ** 后补空格
    .replace(new RegExp(`(${q})${e}*${e}*(${ch})`, 'g'), '$1** $2')
    // *italic* — 同上（确保不是 ** 的一部分）
    .replace(new RegExp(`(${ch})${e}*(?!${e}*)(${q})`, 'g'), '$1 *$2')
    .replace(new RegExp(`(${q})${e}*(?!${e}*)(${ch})`, 'g'), '$1* $2')
    // ~~strikethrough~~ — 同上
    .replace(new RegExp(`(${ch})~~(${q})`, 'g'), '$1 ~~$2')
    .replace(new RegExp(`(${q})~~(${ch})`, 'g'), '$1~~ $2')
}

export function useStreamingMarkdown(options: StreamingMarkdownOptions) {
  const { onBlocks, onComplete, onError } = options

  let parser: IncremarkParser | null = null

  try {
    parser = createIncremarkParser({ gfm: true })
  } catch (err) {
    onError?.(err instanceof Error ? err : new Error(String(err)))
  }

  /**
   * 接收文本增量。
   */
  function pushDelta(delta: string): void {
    if (!delta || !parser) return

    const normalized = normalizeEmphasis(delta)

    try {
      const update = parser.append(normalized)
      const blocks = [...update.completed, ...update.updated]
      if (blocks.length > 0) {
        onBlocks(blocks)
      }
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  }

  /**
   * 强制 flush：标记解析完成，输出所有剩余内容。
   */
  function flush(): void {
    if (!parser) {
      onComplete?.()
      return
    }

    try {
      const update = parser.finalize()
      const blocks = [...update.completed, ...update.pending]
      if (blocks.length > 0) {
        onBlocks(blocks)
      }
      onComplete?.()
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)))
      onComplete?.()
    }
  }

  /**
   * 重置解析器状态。
   */
  function reset(): void {
    if (parser) {
      parser.reset()
    }
  }

  return {
    pushDelta,
    flush,
    reset,
  }
}
