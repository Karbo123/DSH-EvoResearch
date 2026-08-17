/**
 * 文献检索服务（LIB-03）—— 覆盖 文件名 / 标题(与作者) / 全文 / 笔记 / references。
 *
 * - search：FTS5（trigram）优先，查询词过短时 LIKE 子串回退；命中附
 *   「原文位置」（页号 + 段偏移 + 片段，§8.3）与 matchedFields；
 * - getTextRange：按 文件路径 + 页号 + 偏移 + 长度 返回原文精确片段
 *   （offset/length 是索引文本——清洗空白后的页文本——中的字符偏移）；
 * - listPapers / getPaper：论文列表与详情（含 notes/references，供 LIB-07 使用）。
 *
 * 笔记与 references 字段在本任务中只搭结构（schema + 索引 + 搜索覆盖）；
 * 写入入口在 indexer.ts（setNotes / setReferences）。
 */
import * as path from 'node:path'
import { normPath, projectDir } from '../core/paths.js'
import { LibraryStore, toFtsTokens } from './store.js'
import type {
  LibraryRef,
  PaperRecord,
  PaperSummary,
  ResolvedLibraryRef,
  SearchField,
  SearchHit,
  SearchOptions,
  TextLocation,
  TextRange,
} from './types.js'

/** 检索服务配置。 */
export interface LibrarySearchConfig {
  readonly dataRoot: string
}

/** 字段 → FTS5 列组（title 同时覆盖作者列；refs 因 references 是 SQLite 关键字）。 */
const FIELD_COLUMNS: Record<SearchField, readonly string[]> = {
  filename: ['file_name'],
  title: ['title', 'authors'],
  fulltext: ['body'],
  notes: ['notes'],
  references: ['refs'],
}

const ALL_FIELDS: readonly SearchField[] = ['filename', 'title', 'fulltext', 'notes', 'references']

/** 把 token 列表组装成列限定的 FTS5 MATCH 串。 */
function buildFieldMatch(tokens: readonly string[], fields: readonly SearchField[]): string {
  const parts: string[] = []
  for (const field of fields) {
    for (const column of FIELD_COLUMNS[field]) {
      for (const token of tokens) {
        parts.push(`${column}: "${token}"`)
      }
    }
  }
  return parts.length > 0 ? `(${parts.join(' OR ')})` : ''
}

/** 文本是否命中任一检索词（大小写不敏感，≥2 字符）。 */
function textHasAny(text: string, terms: readonly string[]): boolean {
  const lower = text.toLowerCase()
  return terms.some((term) => term.length >= 2 && lower.includes(term.toLowerCase()))
}

/** 子串验证各字段是否真实命中（matchedFields 精确化）。 */
function matchedFieldsOf(
  store: LibraryStore,
  paper: PaperRecord,
  terms: readonly string[],
  fields: readonly SearchField[],
): SearchField[] {
  const matched: SearchField[] = []
  if (fields.includes('filename') && textHasAny(paper.fileName, terms)) matched.push('filename')
  if (fields.includes('title') && (textHasAny(paper.title, terms) || paper.authors.some((a) => textHasAny(a, terms)))) {
    matched.push('title')
  }
  if (fields.includes('notes') && textHasAny(paper.notes, terms)) matched.push('notes')
  if (fields.includes('references') && paper.references.some((r) => textHasAny(r, terms))) matched.push('references')
  if (fields.includes('fulltext') && store.pagesContainAny(paper.paperId, terms)) matched.push('fulltext')
  return matched
}

/** 在页文本中定位检索词（每页取最早命中，页序升序，限数）。 */
function locateInPaper(store: LibraryStore, paperId: string, terms: readonly string[], limit: number): TextLocation[] {
  if (limit <= 0) return []
  const locations: TextLocation[] = []
  for (const page of store.listPages(paperId)) {
    if (locations.length >= limit) break
    const lower = page.text.toLowerCase()
    let best: { offset: number; length: number } | undefined
    for (const term of terms) {
      if (term.length < 2) continue
      const index = lower.indexOf(term.toLowerCase())
      if (index >= 0 && (!best || index < best.offset)) best = { offset: index, length: term.length }
    }
    if (best) {
      locations.push({
        page: page.pageNo,
        offset: best.offset,
        length: best.length,
        snippet: makeSnippet(page.text, best.offset, best.length),
      })
    }
  }
  return locations
}

/** 生成命中片段（命中词前后保留上下文，超界加省略号）。 */
function makeSnippet(text: string, offset: number, length: number, before = 60, after = 140): string {
  const start = Math.max(0, offset - before)
  const end = Math.min(text.length, offset + length + after)
  const core = text.slice(start, end).replace(/\s+/g, ' ')
  return `${start > 0 ? '…' : ''}${core}${end < text.length ? '…' : ''}`
}

/** 文献检索服务。 */
export class LibrarySearch {
  private readonly stores = new Map<string, LibraryStore>()

  constructor(readonly config: LibrarySearchConfig) {}

  /**
   * 文献搜索（LIB-03）：FTS5 全文优先（trigram，token ≥3 字符），
   * 查询词过短时自动 LIKE 子串回退（单字符中文/短英文仍可命中文件名与标题）。
   */
  search(project: string, query: string, options: SearchOptions = {}): SearchHit[] {
    const store = this.storeFor(projectDir(this.config.dataRoot, project))
    const q = query.trim()
    if (!q) return []
    const fields: readonly SearchField[] = options.fields && options.fields.length > 0 ? options.fields : ALL_FIELDS
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 20), 1), 100)
    const tokens = toFtsTokens(q)
    const results = tokens.length > 0
      ? store.searchFts(buildFieldMatch(tokens, fields), limit)
      : store.searchLike(q, fields, limit)
    const terms = tokens.length > 0 ? tokens : [q]
    const locationsPerPaper = Math.min(Math.max(Math.floor(options.locationsPerPaper ?? 5), 0), 20)
    const includeLocations = options.includeLocations !== false
    return results.map(({ paper, score }) => {
      const matchedFields = matchedFieldsOf(store, paper, terms, fields)
      const hit: SearchHit = { paper, score, matchedFields, locations: [] }
      if (includeLocations && matchedFields.includes('fulltext')) {
        hit.locations = locateInPaper(store, paper.paperId, terms, locationsPerPaper)
      }
      return hit
    })
  }

  /**
   * 返回原文精确片段（§8.3）：文件路径 + 页号 + 段偏移 + 长度。
   * @throws 论文不存在或该页无索引文本时抛错。
   */
  getTextRange(project: string, paperId: string, page: number, offset: number, length: number): TextRange {
    const store = this.storeFor(projectDir(this.config.dataRoot, project))
    const paper = store.getPaper(paperId)
    if (!paper) throw new Error(`文献不存在: ${paperId}`)
    const pageText = store.getPageText(paperId, page)
    if (pageText === undefined) {
      throw new Error(`文献 ${paperId} 没有第 ${page} 页的索引文本（pageCount=${paper.pageCount}）`)
    }
    const start = Math.max(0, Math.floor(offset))
    const end = Math.min(pageText.length, start + Math.max(0, Math.floor(length)))
    return { paperId, filePath: paper.filePath, page, offset: start, length: end - start, text: pageText.slice(start, end) }
  }

  /** 读取某页完整索引文本（供 PDF 阅读器定位页使用）。 */
  getPageText(project: string, paperId: string, page: number): { filePath: string; page: number; text: string } | undefined {
    const store = this.storeFor(projectDir(this.config.dataRoot, project))
    const paper = store.getPaper(paperId)
    if (!paper) return undefined
    const text = store.getPageText(paperId, page)
    return text === undefined ? undefined : { filePath: paper.filePath, page, text }
  }

  /** 列出论文（默认只出原文件仍在的；含 notes/references）。 */
  listPapers(project: string, options: { includeMissing?: boolean; limit?: number; offset?: number } = {}): PaperSummary[] {
    const store = this.storeFor(projectDir(this.config.dataRoot, project))
    return store.listPapers(options)
  }

  /** 单篇论文详情。 */
  getPaper(project: string, paperId: string): PaperSummary | undefined {
    const store = this.storeFor(projectDir(this.config.dataRoot, project))
    return store.getPaper(paperId)
  }

  /**
   * 原文子串扫描（WRITE-07 quoteCheck 用）：直接对页文本做大小写不敏感子串
   * 匹配（数字/短串比 FTS 更可靠），每页取最早命中，返回原文位置。
   * @param options.paperId 限定单篇；缺省扫描全部论文（上限 200 篇）。
   */
  scanPages(
    project: string,
    query: string,
    options: { paperId?: string; paperLimit?: number; perPaper?: number; hitLimit?: number } = {},
  ): Array<{ paperId: string; title: string; filePath: string; page: number; offset: number; snippet: string }> {
    const store = this.storeFor(projectDir(this.config.dataRoot, project))
    const q = query.trim()
    if (!q) return []
    const perPaper = Math.min(Math.max(Math.floor(options.perPaper ?? 5), 1), 20)
    const hitLimit = Math.min(Math.max(Math.floor(options.hitLimit ?? 30), 1), 200)
    const hits: Array<{ paperId: string; title: string; filePath: string; page: number; offset: number; snippet: string }> = []
    const lowerQuery = q.toLowerCase()
    const papers = options.paperId
      ? (store.getPaper(options.paperId) ? [store.getPaper(options.paperId)!] : [])
      : store.listPapers({ includeMissing: true, limit: Math.min(Math.max(Math.floor(options.paperLimit ?? 200), 1), 500) })
    for (const paper of papers) {
      if (hits.length >= hitLimit) break
      const pages = store.listPages(paper.paperId)
      for (const page of pages) {
        if (hits.length >= hitLimit) break
        const index = page.text.toLowerCase().indexOf(lowerQuery)
        if (index >= 0) {
          hits.push({
            paperId: paper.paperId,
            title: paper.title,
            filePath: paper.filePath,
            page: page.pageNo,
            offset: index,
            snippet: makeSnippet(page.text, index, q.length),
          })
          if (hits.filter((h) => h.paperId === paper.paperId).length >= perPaper) break
        }
      }
    }
    return hits
  }

  /**
   * 解析文献引用数据接口（LIB-08）：{kind:'paper'|'note', paperId|path} →
   * 规范化的论文/笔记引用（纯 JSON）。节点只存 ref，不复制正文；
   * 接线点：chat-graph.ts GraphNodeRef（kind 'pdf' + path 即可引用原 PDF）。
   */
  resolveRef(project: string, ref: LibraryRef): ResolvedLibraryRef | undefined {
    const store = this.storeFor(projectDir(this.config.dataRoot, project))
    let paper = ref.paperId ? store.getPaper(ref.paperId) : undefined
    if (!paper && ref.path) {
      const resolved = path.isAbsolute(ref.path)
        ? ref.path
        : path.join(projectDir(this.config.dataRoot, project), ref.path)
      paper = store.getPaperByKey(normPath(resolved))
    }
    if (!paper) return undefined
    return {
      kind: ref.kind === 'note' ? 'note' : 'paper',
      paperId: paper.paperId,
      path: paper.filePath,
      title: paper.title,
      notes: paper.notes,
      references: paper.references,
    }
  }

  /**
   * 文献 ref → chat-graph 的 GraphNodeRef（LIB-08 接线辅助）：
   * paper → {kind:'pdf', path: 原 PDF 绝对路径}（graph previewOf 可直接展示）；
   * note 返回 undefined（当前笔记存于镜像，无独立文件路径；落成 Markdown 文件后
   * 再接 kind 'note'）。
   */
  toGraphRef(project: string, ref: LibraryRef): { kind: 'pdf'; path: string } | undefined {
    const resolved = this.resolveRef(project, ref)
    if (!resolved || resolved.kind !== 'paper') return undefined
    return { kind: 'pdf', path: resolved.path }
  }

  /** 获取（或打开并缓存）项目 store。 */
  private storeFor(projectPath: string): LibraryStore {
    const key = normPath(projectPath)
    let store = this.stores.get(key)
    if (!store) {
      store = LibraryStore.open(projectPath)
      this.stores.set(key, store)
    }
    return store
  }

  /** 关闭全部缓存连接（插件生命周期释放时调用）。 */
  dispose(): void {
    for (const store of this.stores.values()) store.close()
    this.stores.clear()
  }
}
