/**
 * 流式 Markdown 增量渲染 Composable
 *
 * 策略：逐 token 接收文本增量，块级 flush，通过 innerHTML 追加实现流畅渲染。
 * 参考 streamdown 分块 flush 思路，但为 Vue 3 自研实现。
 */
import { marked } from 'marked';
import hljs from 'highlight.js';

// 配置 marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

/**
 * HTML 实体编码
 */
function encodeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** 内部状态 */
interface StreamingMarkdownState {
  buffer: string;
  isInCodeBlock: boolean;
  codeBlockBuffer: string;
  codeBlockLang: string;
}

interface StreamingMarkdownOptions {
  /** 每次 flush 回调，接收增量 HTML 片段 */
  onFlush: (html: string) => void;
  /** 解析完成回调 */
  onComplete?: () => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
  /** 是否启用代码高亮，默认 true */
  highlight?: boolean;
  /** 强制 flush 的 buffer 大小阈值，默认 200 */
  flushThreshold?: number;
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
    flushThreshold = 200,
  } = options;

  /** 内部状态 */
  const state: StreamingMarkdownState = {
    buffer: '',
    isInCodeBlock: false,
    codeBlockBuffer: '',
    codeBlockLang: '',
  };

  /** 上一次 flush 后的 buffer 长度，用于检测新内容 */
  let lastFlushLen = 0;

  /**
   * 解析 Markdown 文本为 HTML
   */
  function parseMarkdown(text: string): string {
    try {
      // 使用 marked.parse 返回字符串
      const html = marked.parse(text, { async: false }) as string;
      return html;
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
      return encodeHTML(text);
    }
  }

  /**
   * 提取代码块信息
   */
  function extractCodeBlock(text: string): { lang: string; code: string } | null {
    const match = text.match(/^```(\w*)\n([\s\S]*?)```$/m);
    if (!match) return null;
    return {
      lang: match[1] || 'plaintext',
      code: match[2],
    };
  }

  /**
   * 语法高亮代码块
   */
  function highlightCode(code: string, lang: string): string {
    if (!highlight) {
      return encodeHTML(code);
    }
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return encodeHTML(code);
    }
  }

  /**
   * 处理代码块内容
   */
  function processCodeBlock(code: string, lang: string): string {
    const highlighted = highlightCode(code, lang);
    return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
  }

  /**
   * 尝试 flush 完整的块
   */
  function tryFlush(force = false): void {
    const { buffer } = state;

    // 检测代码块状态
    if (!state.isInCodeBlock && buffer.includes('```')) {
      const firstCodeIdx = buffer.indexOf('```');
      const lastCodeIdx = buffer.lastIndexOf('```');
      if (firstCodeIdx !== lastCodeIdx) {
        // 有完整的代码块
        const before = buffer.slice(0, firstCodeIdx);
        const codeBlock = buffer.slice(firstCodeIdx, lastCodeIdx + 3);
        const after = buffer.slice(lastCodeIdx + 3);

        if (before.trim()) {
          const html = parseMarkdown(before);
          if (html) onFlush(html);
        }

        const codeInfo = extractCodeBlock(codeBlock);
        if (codeInfo) {
          onFlush(processCodeBlock(codeInfo.code, codeInfo.lang));
        }

        state.buffer = after;
        return tryFlush();
      } else {
        // 只有一个 ```，进入代码块模式
        state.isInCodeBlock = true;
        state.codeBlockBuffer = buffer.slice(firstCodeIdx + 3);
        state.codeBlockLang = '';
        state.buffer = '';
        // 尝试提取语言标识
        const langMatch = state.codeBlockBuffer.match(/^(\w+)\n/);
        if (langMatch) {
          state.codeBlockLang = langMatch[1];
          state.codeBlockBuffer = state.codeBlockBuffer.slice(langMatch[0].length);
        }
        return;
      }
    }

    // 处理代码块内
    if (state.isInCodeBlock) {
      if (state.buffer.includes('```')) {
        const lastCodeIdx = state.buffer.lastIndexOf('```');
        const codeContent = state.buffer.slice(0, lastCodeIdx);
        const rest = state.buffer.slice(lastCodeIdx + 3);

        onFlush(processCodeBlock(state.codeBlockBuffer + codeContent, state.codeBlockLang));
        state.isInCodeBlock = false;
        state.codeBlockBuffer = '';
        state.codeBlockLang = '';
        state.buffer = rest;
        return tryFlush();
      }
      // 还在代码块内，累积
      state.codeBlockBuffer += state.buffer;
      state.buffer = '';
      return;
    }

    // 常规 flush：遇到空行或 buffer 过大
    const shouldFlush = force
      || (buffer.length > flushThreshold && lastFlushLen < buffer.length)
      || /\n\n/.test(buffer);

    if (!shouldFlush) return;

    // 找到最近的段落分隔位置
    let flushPoint = buffer.length;
    if (!force) {
      const lastDoubleNewline = buffer.lastIndexOf('\n\n');
      if (lastDoubleNewline > 0) {
        flushPoint = lastDoubleNewline;
      }
    }

    const toFlush = buffer.slice(0, flushPoint);
    const remaining = buffer.slice(flushPoint);

    if (toFlush.trim()) {
      const html = parseMarkdown(toFlush);
      if (html) onFlush(html);
    }

    lastFlushLen = remaining.length;
    state.buffer = remaining;
  }

  /**
   * 接收文本增量
   */
  function pushDelta(delta: string): void {
    if (!delta) return;

    // 处理特殊 XML 标签（如 <error> 等）
    if (delta.startsWith('<')) {
      // 累积直到遇到完整标签
      state.buffer += delta;
      tryFlush(true);
      return;
    }

    state.buffer += delta;
    tryFlush();
  }

  /**
   * 强制 flush 剩余 buffer
   */
  function flush(): void {
    tryFlush(true);

    // 处理剩余的代码块
    if (state.isInCodeBlock && state.codeBlockBuffer) {
      onFlush(processCodeBlock(state.codeBlockBuffer, state.codeBlockLang));
      state.isInCodeBlock = false;
      state.codeBlockBuffer = '';
      state.codeBlockLang = '';
    }

    // 处理剩余文本
    if (state.buffer.trim()) {
      const html = parseMarkdown(state.buffer);
      if (html) onFlush(html);
      state.buffer = '';
    }

    lastFlushLen = 0;
    onComplete?.();
  }

  /**
   * 获取当前 buffer 内容
   */
  function getBuffer(): string {
    return state.buffer;
  }

  /**
   * 重置状态
   */
  function reset(): void {
    state.buffer = '';
    state.isInCodeBlock = false;
    state.codeBlockBuffer = '';
    state.codeBlockLang = '';
    lastFlushLen = 0;
  }

  return {
    pushDelta,
    flush,
    getBuffer,
    reset,
  };
}
