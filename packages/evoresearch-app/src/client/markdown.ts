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

// ── JSON 结构化渲染（§需求4）───────────────────────────────────────────────
// 纯 TS 自实现（无第三方依赖）：键名/字符串/数字/布尔/null 分色 + 缩进；
// 大 JSON（> ~2KB 或深度 > 4）默认折叠，点击「展开」后显示完整嵌套。
const JSON_COLLAPSE_BYTES = 2048
const JSON_COLLAPSE_DEPTH = 4

function escHtmlFragment(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 递归把 JSON 值渲染为带 token class 的缩进 HTML；顺带统计最大深度。 */
function renderJsonValue(value: unknown, depth: number, ctx: { depth: number }): string {
  if (depth > ctx.depth) ctx.depth = depth
  const indent = '    '.repeat(depth)
  const childIndent = '    '.repeat(depth + 1)
  if (value === null) return '<span class="evo-jnull">null</span>'
  if (typeof value === 'boolean') return `<span class="evo-jbool">${value}</span>`
  if (typeof value === 'number') {
    return Number.isFinite(value as number)
      ? `<span class="evo-jnum">${value}</span>`
      : `<span class="evo-jstr">${escHtmlFragment(JSON.stringify(value))}</span>`
  }
  if (typeof value === 'string') return `<span class="evo-jstr">${escHtmlFragment(JSON.stringify(value))}</span>`
  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="evo-jpunct">[</span><span class="evo-jpunct">]</span>'
    const items = value.map((c) => renderJsonValue(c, depth + 1, ctx))
    const multi = value.length > 1 || items.some((s) => /[\n\[\{]/.test(s))
    if (!multi) return `<span class="evo-jpunct">[</span>${items.join('<span class="evo-jpunct">, </span>')}<span class="evo-jpunct">]</span>`
    return `<span class="evo-jpunct">[</span>\n${items.map((s) => `${childIndent}${s}`).join(',\n')}\n${indent}<span class="evo-jpunct">]</span>`
  }
  const keys = Object.keys(value)
  if (keys.length === 0) return '<span class="evo-jpunct">{</span><span class="evo-jpunct">}</span>'
  const pairs = keys.map((k) => `<span class="evo-jkey">${escHtmlFragment(JSON.stringify(k))}</span><span class="evo-jpunct">: </span>${renderJsonValue((value as Record<string, unknown>)[k], depth + 1, ctx)}`)
  const multi = keys.length > 1 || pairs.some((p) => /[\n\[\{]/.test(p))
  if (!multi) return `<span class="evo-jpunct">{ </span>${pairs.join('<span class="evo-jpunct">, </span>')}<span class="evo-jpunct"> }</span>`
  return `<span class="evo-jpunct">{</span>\n${pairs.map((s) => `${childIndent}${s}`).join(',\n')}\n${indent}<span class="evo-jpunct">}</span>`
}

/** 文本是否可判定为 JSON（代码块 language=json 或内容看起来是对象/数组字面量）。 */
function looksLikeJson(s: string): boolean {
  const t = s.trim()
  if (t === '' || (t[0] !== '{' && t[0] !== '[')) return false
  try { JSON.parse(t); return true } catch { return false }
}

/** 渲染 code block 的 JSON：可折叠时返回带 data 前缀的 HTML，返回字符串由 highlight 使用。 */
function renderJsonBlock(lang: string, str: string): string | null {
  const text = lang.trim().toLowerCase()
  const isJsonLang = text === 'json' || text === 'json5' || text === 'jsonc'
  // 仅当显式 json 语言，或无语言标签且内容可解析为 JSON 时才走 JSON 渲染
  if (!isJsonLang && (text !== '' || !looksLikeJson(str))) return null
  let parsed: unknown
  try { parsed = JSON.parse(str) } catch { return null }
  const ctx = { depth: 0 }
  const html = renderJsonValue(parsed, 0, ctx)
  const bytes = str.length
  const large = bytes > JSON_COLLAPSE_BYTES || ctx.depth > JSON_COLLAPSE_DEPTH
  if (!large) {
    return `<pre class="evo-json"><code class="language-json">${html}</code></pre>`
  }
  const plain = html.replace(/<[^>]+>/g, '')
  const preview = plain.length > 160 ? `${plain.slice(0, 160)}…` : plain
  return `<pre class="evo-json evo-json-large" data-json-bytes="${bytes}" data-json-depth="${ctx.depth}">
  <span class="evo-json-toggle" role="button" tabindex="0" aria-expanded="false">
    <span class="evo-json-toggle-icon" aria-hidden="true">▸</span>
    <span class="evo-json-toggle-label">JSON · ${bytes} bytes · ${ctx.depth} levels · <span class="evo-json-toggle-preview">${escHtmlFragment(preview)}</span></span>
  </span>
  <code class="evo-json-hidden" hidden>${html}</code>
</pre>`
}

let jsonToggleBound = false
function bindJsonToggle(): void {
  if (jsonToggleBound || typeof document === 'undefined') return
  jsonToggleBound = true
  document.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as Element | null
    const btn = target?.closest?.('.evo-json-toggle')
    if (!btn) return
    const pre = btn.closest('.evo-json-large')
    if (!pre) return
    e.preventDefault()
    const hidden = pre.querySelector<HTMLElement>('.evo-json-hidden')
    pre.classList.add('evo-json-open')
    btn.setAttribute('hidden', '')
    if (hidden !== null) { hidden.hidden = false; hidden.setAttribute('data-open', '1') }
    btn.setAttribute('aria-expanded', 'true')
  })
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
    if (lang === 'mermaid') {
      // 占位容器：流式期间不渲染，回答结束后由 renderMermaidBlocks 惰性绘制（§31.5）。
      // 以 <pre 开头避免 markdown-it fence 渲染器再次包一层 pre/code。
      return `<pre class="evo-mermaid">${md.utils.escapeHtml(str)}</pre>`
    }
    const jsonHtml = renderJsonBlock(lang, str)
    if (jsonHtml !== null) {
      bindJsonToggle()
      return jsonHtml
    }
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

// ── Mermaid 惰性渲染（§31.5）─────────────────────────────────────────────
let mermaidLoading: Promise<unknown> | null = null
function loadMermaid(): Promise<unknown> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if ((window as any).__evoMermaid !== undefined) return Promise.resolve((window as any).__evoMermaid)
  if (mermaidLoading !== null) return mermaidLoading
  mermaidLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/assets/mermaid.js'
    script.onload = () => resolve((window as any).__evoMermaid)
    script.onerror = () => { mermaidLoading = null; reject(new Error('mermaid 加载失败')) }
    document.head.appendChild(script)
  })
  return mermaidLoading
}

let mermaidSeq = 0

/**
 * 将容器内未渲染的 .evo-mermaid 占位块绘制为 SVG。
 * 惰性加载 /assets/mermaid.js（首屏不携带）；失败时占位替换为提示文本。
 */
export async function renderMermaidBlocks(root: HTMLElement): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>('.evo-mermaid:not([data-done])')]
  if (blocks.length === 0) return
  let mermaid: any
  try {
    mermaid = await loadMermaid()
  } catch {
    for (const block of blocks) {
      block.setAttribute('data-done', '1')
      block.textContent = '（Mermaid 渲染库加载失败）'
    }
    return
  }
  if (mermaid === undefined || mermaid === null) return
  for (const block of blocks) {
    block.setAttribute('data-done', '1')
    const code = block.textContent ?? ''
    if (code.trim() === '') continue
    try {
      mermaidSeq += 1
      const { svg } = await mermaid.render(`evo-mmd-${mermaidSeq}-${Date.now()}`, code)
      block.innerHTML = svg
    } catch {
      block.textContent = '（Mermaid 渲染失败：请检查图表语法）'
    }
  }
}

/**
 * DOMPurify 白名单：允许 markdown 语义标签与类名；style 属性保留
 * （KaTeX 布局必需，DOMPurify 自带 CSS 值净化），事件属性与危险标签禁掉。
 */
const SANITIZE_OPTS = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['class', 'colspan', 'rowspan', 'start', 'checked', 'disabled'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'button', 'textarea', 'select', 'link', 'meta', 'base'],
  FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onmouseout', 'onkeydown', 'onkeyup', 'onfocus', 'onblur'],
  // 允许 http/https/mailto 与自定义 evo-file（项目文件预览链接）、data:image 图片缩放。
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  ADD_DATA_URI_TAGS: ['img'],
}

/** 渲染并净化一段 Markdown（返回可直接 innerHTML 的字符串）。 */
export function renderMarkdown(text: string): string {
  if (text === '') return ''
  const html = md.render(linkifyProjectFiles(text))
  return DOMPurify.sanitize(wrapCodeFileLinks(html), SANITIZE_OPTS)
}

// 识别的项目文件扩展名（AI 回复里的产出物引用 → 可点击预览链接）
const PROJECT_FILE_EXTS = new Set(['md', 'markdown', 'txt', 'py', 'json', 'csv', 'tex', 'pdf', 'ipynb', 'yaml', 'yml'])
// 行内裸文件名/相对路径（反引号外）→ markdown 链接（[name](evo-file://path)）。
// 排除：已出现在 [..](..) 链接内（前导 [ 或 (）、后续闭 `) 或 ]（链接语法一部分）。
// 反引号内的行内 code 引用由 htmlFileLinks 在渲染后的 HTML 层补齐（见下）。
const FILE_REF_RE = /(?<![[`(])([\w.-]+(?:\/[\w.-]+)*\.(?:md|markdown|txt|py|json|csv|tex|pdf|ipynb|yaml|yml))(?![\])`])/g

/** 渲染后的 HTML 层：单反引号行内 code 里的纯文件名 → <a>（如 `` `xx.md` ``、
 * 产出文件列表 `` **产出文件**：`xx.md` ``）。markdown-it 把反引号内内容转义为
 * <code>xx.md</code>，此处把"内部恰为单个文件名"的 code 替换为含链接的 code。
 */
const CODE_FILE_RE = /<code>([\w.-]+(?:\/[\w.-]+)*\.(?:md|markdown|txt|py|json|csv|tex|pdf|ipynb|yaml|yml))<\/code>/g
function wrapCodeFileLinks(html: string): string {
  return html.replace(CODE_FILE_RE, (_m, name: string) => `<code><a class="evo-code-filelink" href="evo-file://${name}">${name}</a></code>`)
}

/** 把文本中的裸项目文件名/相对路径转成可点击的 evo-file 链接。 */
export function linkifyProjectFiles(text: string): string {
  if (text === '') return ''
  return text.replace(FILE_REF_RE, (whole, name: string) => `[${name}](evo-file://${name})`)
}

/**
 * 输入框实时样式化装饰层（Typora 式"输入即所见"）：
 * 渲染后可见字符数与源 Markdown 完全一致——语法标记（`**`、`#`、`- ` 等）
 * 用 visibility:hidden 隐藏但保留占位，使下层 textarea 的光标/选区映射零偏移；
 * 行内样式（加粗/斜体/删除线/行内代码/链接）与行级结构（标题/列表/引用/
 * 代码围栏/分割线）即时呈现。仅作显示层，不参与提交（提交仍用 markdown 原文）。
 */
export function renderComposerDeco(text: string): string {
  const esc = (s: string): string => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // 隐藏但占位的语法标记（visibility:hidden 保留布局空间）
  const M = (s: string): string => `<span class="evod-m">${esc(s)}</span>`
  // 行内样式（逐行处理；所有替换保持可见字符数不变）
  const inline = (line: string): string => {
    let out = line
    // 行内代码（最先处理，避免内部再被样式化）
    out = out.replace(/(`+)([^`\n]*?)(\1)/g, (_m, ticks: string, inner: string) =>
      `<code class="evod-code">${M(ticks)}${esc(inner)}${M(ticks)}</code>`)
    // 链接 [text](url)
    out = out.replace(/\[([^\[\]\n]*)\]\(([^()\n\s]+)\)/g, (_m, t: string, u: string) =>
      `<a class="evod-link">${M('[')}${esc(t)}${M(`](${u})`)}</a>`)
    // 加粗
    out = out.replace(/\*\*([^*\n]+)\*\*/g, (_m, t: string) =>
      `<b>${M('**')}${esc(t)}${M('**')}</b>`)
    // 斜体（前置非 * 锚点，避免与加粗残留冲突）
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, (_m, pre: string, t: string) =>
      `${pre}<i>${M('*')}${esc(t)}${M('*')}</i>`)
    // 删除线
    out = out.replace(/~~([^~\n]+)~~/g, (_m, t: string) =>
      `<s>${M('~~')}${esc(t)}${M('~~')}</s>`)
    return out
  }
  const lines = text.split('\n')
  let inFence = false
  const out: string[] = []
  for (const line of lines) {
    // 代码围栏（``` / ~~~，允许语言后缀）
    if (/^(`{3,}|~{3,})[^`~\n]*$/.test(line)) {
      inFence = !inFence
      out.push(`<div class="evod-fence-line">${M(line)}</div>`)
      continue
    }
    if (inFence) {
      out.push(`<div class="evod-fence-body">${esc(line)}</div>`)
      continue
    }
    // 标题
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      const n = heading[1]!.length
      out.push(`<div class="evod-h evod-h${n}">${M(`${heading[1]} `)}${inline(heading[2] ?? '')}</div>`)
      continue
    }
    // 列表（- * + 或 1. 1)）
    const listItem = /^([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (listItem !== null) {
      const marker = listItem[1]!
      out.push(`<div class="evod-li${/^\d/.test(marker) ? ' evod-ol' : ' evod-ul'}">${M(`${marker} `)}${inline(listItem[2] ?? '')}</div>`)
      continue
    }
    // 引用
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote !== null) {
      const content = quote[1] ?? ''
      const marker = line.slice(0, line.length - content.length)
      out.push(`<div class="evod-quote">${M(marker)}${inline(content)}</div>`)
      continue
    }
    // 分割线
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push(`<div class="evod-hr">${M(line)}</div>`)
      continue
    }
    out.push(inline(line))
  }
  return out.join('\n')
}
