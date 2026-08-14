/**
 * Markdown 渲染管线（对齐移植规范 §31.5）：
 * markdown-it（GFM 表格/删除线内建）+ 任务列表 + KaTeX 数学 + DOMPurify
 * 白名单净化 + highlight.js 常用科研语言子集。
 *
 * 行为要点：
 * - 段落保留源文本单换行（softbreak 输出 \n，配合 white-space: pre-wrap）；
 * - 原始 HTML 必须经 DOMPurify 净化后才进入 DOM；
 * - 代码块使用 hljs 高亮，未知语言退化为转义原文；
 * - 数学公式使用 KaTeX（块级 $$...$$ 与行内 $...$；CSS/字体由构建期
 *   生成的内联样式提供）。行内 $ 带货币/数字规避：开闭符两侧不能是空格
 *   或数字，避免把 "$5 and $3" 当公式。
 */
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import katex from 'katex'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import sql from 'highlight.js/lib/languages/sql'
import markdown from 'highlight.js/lib/languages/markdown'
import yaml from 'highlight.js/lib/languages/yaml'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import diff from 'highlight.js/lib/languages/diff'
import plaintext from 'highlight.js/lib/languages/plaintext'

const LANGUAGES: Array<[string, unknown]> = [
  ['javascript', javascript],
  ['typescript', typescript],
  ['python', python],
  ['json', json],
  ['bash', bash],
  ['sh', bash],
  ['shell', bash],
  ['sql', sql],
  ['markdown', markdown],
  ['yaml', yaml],
  ['yml', yaml],
  ['xml', xml],
  ['html', xml],
  ['css', css],
  ['rust', rust],
  ['go', go],
  ['java', java],
  ['cpp', cpp],
  ['c', cpp],
  ['diff', diff],
  ['text', plaintext],
  ['plaintext', plaintext],
]
for (const [name, lang] of LANGUAGES) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, lang as never)
}

/** 块级 $$...$$（markdown-it 15 下 texmath 1.0.0 的行内规则已失效，自实现）。 */
function mathBlockRule(state: any, startLine: number, endLine: number, silent: boolean): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine]
  if (state.src.slice(start, start + 2) !== '$$') return false
  if (silent) return true
  let closeLine = -1
  let contentEnd = -1
  for (let line = startLine + 1; line < endLine; line += 1) {
    const s = state.bMarks[line] + state.tShift[line]
    const e = state.eMarks[line]
    const idx = state.src.indexOf('$$', s)
    if (idx !== -1 && idx < e) { closeLine = line; contentEnd = idx; break }
  }
  if (closeLine === -1) return false
  const content = state.src.slice(start + 2, contentEnd).trim()
  if (content === '') return false
  const token = state.push('math_block', 'div', 0)
  token.block = true
  token.content = content
  token.map = [startLine, closeLine + 1]
  state.line = closeLine + 1
  return true
}

/** 行内 $...$。 */
function mathInlineRule(state: any, silent: boolean): boolean {
  const src = state.src
  const start = state.pos
  if (src[start] !== '$') return false
  if (src[start + 1] === '$' || src[start + 1] === ' ' || src[start + 1] === '\n') return false
  let pos = start + 1
  while (pos < state.posMax) {
    if (src[pos] === '\\') { pos += 2; continue }
    if (src[pos] === '$') break
    pos += 1
  }
  if (pos >= state.posMax) return false
  const content = src.slice(start + 1, pos)
  // 开闭符邻接检查：避免货币与普通数字（$5、5$、$ 5$、10$ each）
  // 只拒绝：开 $ 后接空白/数字，闭 $ 前接空白、闭 $ 后接数字。
  if (/[\s\d]/.test(src[start + 1] ?? '')) return false
  if (/\s/.test(src[pos - 1] ?? '')) return false
  if (/[\d]/.test(src[pos + 1] ?? '')) return false
  if (content.trim() === '') return false
  if (silent) return false
  const token = state.push('math_inline', 'span', 0)
  token.content = content
  token.markup = '$'
  state.pos = pos + 1
  return true
}

function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, output: 'html', displayMode, strict: false })
  } catch {
    return `<code>${tex}</code>`
  }
}

/** KaTeX 数学插件（块级 + 行内）。 */
function mathPlugin(md: MarkdownIt): void {
  md.block.ruler.before('fence', 'math_block', mathBlockRule)
  md.inline.ruler.after('escape', 'math_inline', mathInlineRule)
  md.renderer.rules.math_block = (tokens: any[], idx: number) => `<div class="katex-display">${renderMath(tokens[idx].content, true)}</div>`
  md.renderer.rules.math_inline = (tokens: any[], idx: number) => renderMath(tokens[idx].content, false)
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  highlight(str: string, lang: string): string {
    if (lang !== '' && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code class="language-${lang}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch { /* 退化为转义原文 */ }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`
  },
})
md.use(taskLists, { enabled: true, label: true })
md.use(mathPlugin)

/**
 * DOMPurify 白名单：允许 markdown 语义标签与类名；style 属性保留
 * （KaTeX 布局必需，DOMPurify 自带 CSS 值净化），事件属性与危险标签禁掉。
 */
const SANITIZE_OPTS = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['class', 'colspan', 'rowspan', 'start', 'checked', 'disabled'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'button', 'textarea', 'select', 'link', 'meta', 'base'],
  FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onmouseout', 'onkeydown', 'onkeyup', 'onfocus', 'onblur'],
}

/** 渲染并净化一段 Markdown（返回可直接 innerHTML 的字符串）。 */
export function renderMarkdown(text: string): string {
  if (text === '') return ''
  const html = md.render(text)
  return DOMPurify.sanitize(html, SANITIZE_OPTS)
}
