/**
 * BibTeX 解析与生成（LIB-06）—— 纯函数，无 IO，可独立测试。
 *
 * 语义：
 * - parseBibtex：容错解析（@comment/@string/@preamble 跳过；花括号计数配平；
 *   支持 {value} 与 "value" 两种字段写法）；raw 原样保留，标题/作者/年份
 *   抽取用于匹配与搜索显示；
 * - generateBibtex：由论文元数据生成最小条目（Idea 讨论不要求引用——
 *   引用只在正式写作时使用，见 api-integration-lib2.md）；
 * - normalizeBibTitle：标题归一化（小写、去标点），用于「按标题挂接 BibTeX
 *   到已有论文」。
 */
import type { BibEntry } from './types.js'

/** 找 text[openIndex] 处左花括号的配对右括号（容忍嵌套与引号内花括号）。 */
export function findClosingBrace(text: string, openIndex: number): number {
  let depth = 0
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** 解析条目内字段（key = {value} | key = "value" | key = value）。 */
function parseBibFields(inner: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const fieldRe = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*/g
  let match: RegExpExecArray | null
  while ((match = fieldRe.exec(inner)) !== null) {
    const name = match[1]!.toLowerCase()
    const start = fieldRe.lastIndex
    const ch = inner[start]
    if (ch === '{') {
      const end = findClosingBrace(inner, start)
      if (end < 0) break
      fields[name] = inner.slice(start + 1, end)
      fieldRe.lastIndex = end + 1
    } else if (ch === '"') {
      const end = inner.indexOf('"', start + 1)
      if (end < 0) break
      fields[name] = inner.slice(start + 1, end)
      fieldRe.lastIndex = end + 1
    } else {
      const end = inner.indexOf(',', start)
      const value = (end < 0 ? inner.slice(start) : inner.slice(start, end)).trim()
      fields[name] = value
      fieldRe.lastIndex = end < 0 ? inner.length : end + 1
    }
  }
  return fields
}

/** 展开花括号并折叠空白（用于标题/作者抽取）。 */
function flattenValue(value: string): string {
  return value.replace(/[{}]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * 解析 BibTeX 文本为条目列表（LIB-06）。
 * 容错：无法配平的条目跳过；@comment/@string/@preamble 忽略；
 * 条目顺序与原文一致，raw 为原样文本。
 */
export function parseBibtex(text: string): BibEntry[] {
  const entries: BibEntry[] = []
  const entryRe = /@([a-zA-Z]+)\s*\{/g
  let match: RegExpExecArray | null
  while ((match = entryRe.exec(text)) !== null) {
    const type = match[1]!.toLowerCase()
    if (type === 'comment' || type === 'string' || type === 'preamble') continue
    const startBrace = match.index + match[0].length - 1
    const end = findClosingBrace(text, startBrace)
    if (end < 0) continue
    const raw = text.slice(match.index, end + 1)
    const inner = text.slice(startBrace + 1, end)
    const keyMatch = /^\s*([^,\s{}]+)/.exec(inner)
    const fields = parseBibFields(inner)
    const year = fields.year?.trim() || undefined
    entries.push({
      key: keyMatch?.[1] ?? '',
      type,
      title: flattenValue(fields.title ?? ''),
      author: flattenValue(fields.author ?? ''),
      year,
      raw,
    })
    entryRe.lastIndex = end + 1
  }
  return entries
}

/** 标题归一化（小写、去非字母数字、折叠空白）——按标题匹配 BibTeX 用。 */
export function normalizeBibTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 把 BibTeX 作者字段拆成姓名列表（and 分隔，去重，限 12 人）。 */
export function parseBibAuthorNames(authorField: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const part of authorField.split(/\s+and\s+/i)) {
    const name = flattenValue(part)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
    if (names.length >= 12) break
  }
  return names
}

/** 从年份字段/文本抽取 4 位年份。 */
export function bibYear(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match = /(?:19|20)\d{2}/.exec(value)
  return match ? Number(match[0]) : undefined
}

/** 默认 BibTeX key：第一作者姓 + 年份后两位（无作者回退 anon）。 */
export function defaultBibKey(meta: { authors: readonly string[]; year?: number }): string {
  const last = meta.authors[0]?.split(/\s+/).pop() ?? 'anon'
  const slug = last.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') || 'anon'
  return `${slug}${meta.year ? String(meta.year).slice(2) : ''}`
}

/**
 * 由论文元数据生成最小 BibTeX 条目（LIB-06：导入或生成）。
 * @param meta 标题/作者/年份（作者可能为空）。
 * @param options key 与条目类型覆盖；缺省 key=defaultBibKey，type='article'。
 */
export function generateBibtex(
  meta: { title: string; authors: readonly string[]; year?: number },
  options: { key?: string; type?: string } = {},
): string {
  const type = options.type ?? 'article'
  const key = options.key ?? defaultBibKey(meta)
  const author = meta.authors.map((a) => flattenValue(a)).filter(Boolean).join(' and ')
  const lines = [
    `@${type}{${key},`,
    meta.title ? `  title = {${flattenValue(meta.title)}},` : '  title = {},',
    author ? `  author = {${author}},` : '',
    meta.year ? `  year = {${meta.year}},` : '',
    '}',
  ].filter((line) => line !== '')
  return lines.join('\n')
}
