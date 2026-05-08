/**
 * Shiki 代码高亮器模块
 *
 * 单例模式，全局复用高亮器实例。使用动态 import 实现语言包 code-split，
 * 仅在实际使用时按需加载。JavaScript 正则引擎避免浏览器端加载 WASM。
 */
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { HighlighterCore } from 'shiki/core'

let highlighterPromise: Promise<HighlighterCore> | null = null

/**
 * 获取全局 Shiki 高亮器实例（懒加载 + 单例）。
 * 语言和主题使用动态 import，Vite 会自动 code-split 到独立 chunk。
 */
export function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [
        import('@shikijs/themes/github-dark'),
        import('@shikijs/themes/github-light'),
      ],
      langs: [
        import('@shikijs/langs/javascript'),
        import('@shikijs/langs/typescript'),
        import('@shikijs/langs/python'),
        import('@shikijs/langs/shellscript'),
        import('@shikijs/langs/json'),
        import('@shikijs/langs/markdown'),
        import('@shikijs/langs/sql'),
        import('@shikijs/langs/yaml'),
        import('@shikijs/langs/css'),
        import('@shikijs/langs/html'),
        import('@shikijs/langs/xml'),
      ],
      engine: createJavaScriptRegexEngine(),
    })
  }
  return highlighterPromise
}
