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

    try {
      const update = parser.append(delta)
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
