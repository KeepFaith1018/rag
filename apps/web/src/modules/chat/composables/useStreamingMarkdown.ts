/**
 * 流式 Markdown 增量渲染 Composable（带打字机效果）
 *
 * 三层架构：IncremarkParser（增量解析）→ BlockTransformer（打字机控制）→ onBlocks 回调
 *
 * BlockTransformer 内置 requestAnimationFrame 驱动，自动帧率对齐。
 * 通过 DisplayBlock.displayNode（截断 AST）实现 AST 级别的逐字打字效果，
 * 保证 Markdown 语法完整性，不会出现闪烁的半成品标记。
 */
import {
  createIncremarkParser,
  createBlockTransformer,
  defaultPlugins,
  codeBlockPlugin,
} from '@incremark/core'
import type {
  IncremarkParser,
  ParsedBlock,
  BlockTransformer,
  DisplayBlock,
} from '@incremark/core'

interface StreamingMarkdownOptions {
  /** 每次 transformer tick 时回调（DisplayBlock 数组） */
  onBlocks: (blocks: DisplayBlock<ParsedBlock | undefined>[]) => void
  /** 全部动画完成回调 */
  onComplete?: () => void
  /** 错误回调 */
  onError?: (error: Error) => void
  /** 打字速度配置 */
  typewriter?: {
    /** 每帧字符数，支持固定值或随机区间，默认 [1, 3] */
    charsPerTick?: number | [number, number]
    /** 帧间隔 ms，默认 25 */
    tickInterval?: number
    /** 动画效果，默认 'typing' */
    effect?: 'typing' | 'fade-in'
    /** 代码块是否逐字显示，默认 false（整体显示） */
    codeBlockTypewriter?: boolean
  }
}

/**
 * 预处理文本，修复 CommonMark 分界符 flanking 失效的边缘情况。
 */
function normalizeEmphasis(text: string): string {
  const ch = '[^\\s]'
  const q = '["\\u201c\\u201d\\u2018\\u2019\\u300c\\u300d\\u300e\\u300f\\u300a\\u300b\\u3008\\u3009\\u3010\\u3011]'
  const e = '\\'

  return text
    .replace(new RegExp(`(${ch})${e}*${e}*(${q})`, 'g'), '$1 **$2')
    .replace(new RegExp(`(${q})${e}*${e}*(${ch})`, 'g'), '$1** $2')
    .replace(new RegExp(`(${ch})${e}*(?!${e}*)(${q})`, 'g'), '$1 *$2')
    .replace(new RegExp(`(${q})${e}*(?!${e}*)(${ch})`, 'g'), '$1* $2')
    .replace(new RegExp(`(${ch})~~(${q})`, 'g'), '$1 ~~$2')
    .replace(new RegExp(`(${q})~~(${ch})`, 'g'), '$1~~ $2')
}

export function useStreamingMarkdown(options: StreamingMarkdownOptions) {
  const { onBlocks, onComplete, onError, typewriter } = options

  let parser: IncremarkParser | null = null
  let transformer: BlockTransformer<ParsedBlock | undefined> | null = null

  try {
    parser = createIncremarkParser({ gfm: true })

    const plugins = [
      ...defaultPlugins,
      ...(typewriter?.codeBlockTypewriter ? [] : [codeBlockPlugin]),
    ]

    transformer = createBlockTransformer({
      charsPerTick: typewriter?.charsPerTick ?? [1, 3],
      tickInterval: typewriter?.tickInterval ?? 25,
      effect: typewriter?.effect ?? 'typing',
      pauseOnHidden: true,
      plugins,
      onChange: ((displayBlocks) => {
        // 跳过空数组：transformer 全部处理完后 processNext 会 emit 空结果，
        // 直接应用会导致已显示内容被清空
        if (displayBlocks.length > 0) {
          onBlocks(displayBlocks as DisplayBlock<ParsedBlock | undefined>[]);
        }
      }) as (displayBlocks: DisplayBlock<unknown>[]) => void,
      onAllComplete: () => {
        onComplete?.()
      },
    } as Parameters<typeof createBlockTransformer>[0])
  } catch (err) {
    onError?.(err instanceof Error ? err : new Error(String(err)))
  }

  /**
   * 接收文本增量。
   *
   * 关键：每次 push 必须传入 parser 的全部已完成 block，
   * 因为 BlockTransformer.push() 会按输入的 id 集合过滤内部 completedBlocks，
   * 只传增量会导致之前已完成的 block 被移除。
   */
  function pushDelta(delta: string): void {
    if (!delta || !parser || !transformer) return

    const needsNormalize = delta.includes('*') || delta.includes('~')
    const normalized = needsNormalize ? normalizeEmphasis(delta) : delta

    try {
      const update = parser.append(normalized)
      // 必须传入 parser 全部已完成 block + 本次 updated block，
      // 否则 transformer 内部会移除不在 id 集合中的已完成 block
      const allBlocks = [
        ...parser.getCompletedBlocks(),
        ...update.updated,
      ] as ParsedBlock[]

      if (allBlocks.length === 0) return

      transformer.push(allBlocks)
      const displayBlocks = transformer.getDisplayBlocks() as DisplayBlock<ParsedBlock | undefined>[]

      if (displayBlocks.length > 0) {
        onBlocks(displayBlocks)
      } else {
        onBlocks(allBlocks as unknown as DisplayBlock<ParsedBlock | undefined>[])
      }
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  }

  /**
   * 强制 flush：finalize parser → push 最终 blocks 到 transformer。
   */
  function flush(): void {
    if (!parser || !transformer) {
      onComplete?.()
      return
    }

    try {
      const update = parser.finalize()
      const allBlocks = [
        ...parser.getCompletedBlocks(),
        ...update.pending,
      ] as ParsedBlock[]
      if (allBlocks.length > 0) {
        transformer.push(allBlocks)
      }
      // finalize 后 transformer 可能已无待处理 block，直接触发完成
      if (!transformer.isProcessing()) {
        onComplete?.()
      }
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)))
      onComplete?.()
    }
  }

  /**
   * 跳过动画，立即显示全部已解析内容。
   */
  function skip(): void {
    transformer?.skip()
  }

  /**
   * 重置解析器（流结束后调用）。
   *
   * 注意：不重置 transformer — transformer 持有最终的 display blocks，
   * 重置会导致 emit 空数组，使已显示的内容消失。
   * 在新消息开始时，composable 会重新创建全新鲜 parser + transformer。
   */
  function reset(): void {
    if (parser) parser.reset()
  }

  /**
   * 完全重置解析器和 transformer（仅在新消息开始时调用）。
   */
  function resetAll(): void {
    if (parser) parser.reset()
    if (transformer) transformer.reset()
  }

  /**
   * 是否正在播放打字机动画。
   */
  function isProcessing(): boolean {
    return transformer?.isProcessing() ?? false
  }

  return {
    pushDelta,
    flush,
    skip,
    reset,
    resetAll,
    isProcessing,
  }
}
