/**
 * 文献索引服务（LIB-01/LIB-02）—— 原文件为主，镜像可删除重建。
 *
 * 职责：
 * - addPaper：注册单个 PDF（原文件原地保留，只写镜像索引）；
 * - indexLibrary：递归扫描目录批量注册/增量更新/标记缺失；
 * - 可插拔 PDF 提取器（PdfExtractor）：默认 defaultPdfExtractor 动态加载
 *   pdf-parse（未安装时返回 null → 论文以 'no-extractor' 状态注册，不崩溃）；
 * - 标题/作者/年份启发式识别（§8.1：尽力而为，识别不到不影响使用）。
 *
 * 依赖说明：本模块不修改 package.json。默认提取器依赖可选的 pdf-parse；
 * 安装建议见 LIBRARY_DEPENDENCY_SUGGESTIONS 与 api-integration-lib.md。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { normPath, projectDir } from '../core/paths.js'
import { LibraryStore } from './store.js'
import { parseBibtex, parseBibAuthorNames, bibYear, normalizeBibTitle } from './bibtex.js'
import type {
  AddPaperResult,
  BibEntry,
  ExtractedPdf,
  IndexLibraryResult,
  PaperRecord,
  PaperSummary,
  PdfExtractor,
} from './types.js'

/** 文献索引服务配置。 */
export interface LibraryIndexerConfig {
  readonly dataRoot: string
  /** 可插拔 PDF 提取器；缺省 defaultPdfExtractor（pdf-parse 动态加载）。 */
  readonly extractor?: PdfExtractor
}

/** 扫描时跳过的可重建/隐藏目录（对齐 workspace.ts 的 SKIP_DIRS）。 */
const SKIP_SCAN_DIRS = new Set([
  '.git',
  '.evoresearch-data',
  'node_modules',
  '.venv',
  'dist',
  '__pycache__',
  '.pytest_cache',
  '.ruff_cache',
  '.next',
])

/**
 * 文献模块的可选依赖建议（未安装时自动降级为「文件名/标题/笔记」索引，
 * 注册与搜索不受影响；安装后重新 addPaper/indexLibrary 即补全文）。
 */
export const LIBRARY_DEPENDENCY_SUGGESTIONS = [
  {
    package: 'pdf-parse',
    version: '^1.1.1',
    purpose: 'PDF 全文提取（默认提取器 defaultPdfExtractor 使用；动态 require，未安装不崩溃）',
    install: 'pnpm --filter @evoresearch/dsh-plugin add pdf-parse',
    note: 'pdf-parse 原版年久失修（含 ReDoS 告警）；因提取逻辑被 PdfExtractor 接口隔离，后续可平替为 pdfjs-dist legacy 或新版 fork，仅需改 defaultPdfExtractor。',
  },
] as const

// ── pdf-parse 动态加载（未安装 → undefined，绝不抛错） ─────────────────────

interface PdfJsTextItem {
  str?: string
}

interface PdfJsTextContent {
  items?: PdfJsTextItem[]
}

interface PdfJsPageLike {
  getTextContent(options?: unknown): Promise<PdfJsTextContent>
}

type PdfParseModule = (
  buffer: Buffer,
  options?: { pagerender?: (page: PdfJsPageLike) => Promise<string> | string },
) => Promise<{ text?: string; numpages?: number }>

/** 动态加载 pdf-parse（CJS 互操作：兼容函数直出与 default 包装）。 */
function tryRequirePdfParse(): PdfParseModule | undefined {
  try {
    const require = createRequire(import.meta.url)
    const resolved = require.resolve('pdf-parse')
    const mod = require(resolved) as PdfParseModule | { default?: PdfParseModule } | undefined
    if (typeof mod === 'function') return mod
    if (mod && typeof mod.default === 'function') return mod.default
    return undefined
  } catch {
    return undefined
  }
}

/**
 * 默认 PDF 提取器（pdf-parse）：
 * - pdf-parse 未安装 → 返回 null（注册为 'no-extractor'）；
 * - 提取失败 → 抛错（注册为 'failed'，错误记入 extractError）。
 * 通过 pagerender 逐页收集文本；若安装的版本不支持 pagerender，
 * 回退为整篇文本单页（pageCount 用 numpages 声明）。
 */
export const defaultPdfExtractor: PdfExtractor = async (filePath) => {
  const mod = tryRequirePdfParse()
  if (!mod) return null
  const buffer = await fs.promises.readFile(filePath)
  const pages: string[] = []
  let data: { text?: string; numpages?: number }
  try {
    data = await mod(buffer, {
      pagerender: async (page) => {
        const content = await page.getTextContent()
        const text = (content.items ?? []).map((item) => item?.str ?? '').join(' ')
        pages.push(text)
        return text
      },
    })
  } catch (error) {
    throw new Error(`pdf-parse 提取失败: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof data.text === 'string' && data.text.trim().length > 0) {
    if (pages.length === 0) pages.push(data.text)
    return {
      pages,
      pageCount: typeof data.numpages === 'number' && data.numpages > 0 ? data.numpages : undefined,
    }
  }
  if (pages.length > 0) return { pages }
  return null
}

// ── 元数据启发式识别（§8.1：尽力而为，识别不到不影响使用） ─────────────────

/** 文件名 → 可读标题回退（去扩展名、下划线/连字符转空格）。 */
function titleFromFileName(base: string): string {
  const cleaned = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned || base || 'Untitled'
}

/** 判断一行是否「像标题」（排除摘要/关键词/页眉页脚等行）。 */
function looksLikeTitleLine(line: string): boolean {
  if (line.length < 8 || line.length > 300) return false
  if (/^(abstract|contents|keywords?|introduction|doi:|http|arxiv|©|received|submitted|accepted|published|references|acknowledg)/i.test(line)) return false
  if (/^\d{1,4}\s*$/.test(line)) return false
  if (/^\d{1,4}\s*[/\-]\s*\d{1,4}\s*$/.test(line)) return false
  return true
}

/** 判断一行是否「像作者行」（2+ 段、绝大多数以大写字母开头；容忍行尾年份）。 */
function looksLikeAuthorLine(line: string): boolean {
  const candidate = line.replace(/\s+(?:19|20)\d{2}\s*$/, '').trim()
  if (candidate.length < 3 || candidate.length > 400) return false
  if (/\d{3}/.test(candidate)) return false
  if (/[。！？：；《》]/.test(candidate)) return false
  const parts = candidate.split(/\s*(?:,|;| and | & )\s*/).filter((t) => t.length > 1)
  if (parts.length < 2) return false
  const upper = parts.filter((p) => /^\p{Lu}/u.test(p))
  return upper.length >= Math.max(2, Math.ceil(parts.length * 0.6))
}

/** 作者行拆分为姓名列表（先剥行尾年份，去重、限 12 人）。 */
function splitAuthors(line: string): string[] {
  const cleaned = line.replace(/\s+(?:19|20)\d{2}\s*$/, '').trim()
  const parts = cleaned
    .split(/\s*(?:,|;| and | & )\s*/)
    .map((t) => t.trim())
    .filter((t) => /^\p{Lu}/u.test(t) && t.length <= 80)
  const seen = new Set<string>()
  return parts
    .filter((part) => {
      const key = part.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 12)
}

/**
 * 从文件名与首页文本启发式识别 标题/作者/年份。
 * 任何一项识别不到都返回回退值（标题回退文件名，作者为空），不阻断注册。
 */
export function guessMetadata(
  fileName: string,
  pages: readonly string[],
): { title: string; authors: string[]; year?: number } {
  const base = fileName.replace(/\.pdf$/i, '').trim()
  const head = (pages[0] ?? '').replace(/\r/g, '')
  const yearMatch = /\b(19|20)\d{2}\b/.exec(base) ?? /\b(19|20)\d{2}\b/.exec(head.slice(0, 4000))
  const yearText = yearMatch?.[0]
  const year = yearText ? Number(yearText) : undefined
  const lines = head.split('\n').map((line) => line.trim()).filter(Boolean)
  const titleLine = lines.find((line) => looksLikeTitleLine(line))
  const title = titleLine
    ? titleLine.replace(/\s+/g, ' ').trim().replace(/[.。]+$/u, '')
    : titleFromFileName(base)
  const authorLine = lines.slice(0, 20).find((line) => looksLikeAuthorLine(line))
  const authors = authorLine ? splitAuthors(authorLine) : []
  return { title, authors, year }
}

// ── 扫描 ────────────────────────────────────────────────────────────────────

/** 递归收集目录下的全部 PDF（跳过 SKIP_SCAN_DIRS，深度上限 32）。 */
function collectPdfs(root: string): string[] {
  const result: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 32) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_SCAN_DIRS.has(entry.name)) walk(path.join(dir, entry.name), depth + 1)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        result.push(path.join(dir, entry.name))
      }
    }
  }
  walk(root, 0)
  result.sort()
  return result
}

/** 文献索引服务。 */
export class LibraryIndexer {
  private readonly stores = new Map<string, LibraryStore>()

  constructor(readonly config: LibraryIndexerConfig) {}

  /**
   * 注册一篇 PDF（LIB-01）：原文件原地保留，只写镜像索引。
   * - 已注册且文件未变化 → 'exists'（不重新提取）；
   * - 文件变化/曾被标记 missing → 重新提取并更新（保留既有笔记与 references）；
   * - 提取失败或无提取器 → 论文仍注册（文件名 + 元数据 + 笔记可搜索）。
   */
  async addPaper(project: string, pdfPath: string): Promise<AddPaperResult> {
    const projectPath = projectDir(this.config.dataRoot, project)
    const filePath = path.resolve(pdfPath)
    let stat: fs.Stats
    try {
      stat = fs.statSync(filePath)
      if (!stat.isFile()) throw new Error('不是文件')
    } catch {
      throw new Error(`PDF 文件不存在或不可读: ${pdfPath}`)
    }
    if (path.extname(filePath).toLowerCase() !== '.pdf') {
      throw new Error(`仅支持 PDF 文件: ${pdfPath}`)
    }
    const store = this.storeFor(projectPath)
    const fileKey = normPath(filePath)
    const existing = store.getPaperByKey(fileKey)
    // 文件变化 / 曾被标记缺失 / 上次未提取成功（安装提取器后可重试修复）→ 重新提取
    const changed =
      !existing ||
      existing.fileMissing ||
      existing.extractionStatus === 'no-extractor' ||
      existing.extractionStatus === 'failed' ||
      existing.fileSize !== stat.size ||
      existing.fileMtime !== stat.mtimeMs
    if (existing && !changed) {
      return {
        paperId: existing.paperId,
        filePath: existing.filePath,
        status: 'exists',
        extractionStatus: existing.extractionStatus,
        extractError: existing.extractError || undefined,
        title: existing.title,
        pageCount: existing.pageCount,
      }
    }

    // LIB-02：可插拔提取器（默认 pdf-parse 动态加载，失败不阻断注册）。
    const extractor = this.config.extractor ?? defaultPdfExtractor
    const extractorName = this.config.extractor ? 'custom' : 'pdf-parse'
    let pages: string[] = []
    let pageCount = 0
    let extractionStatus: PaperRecord['extractionStatus'] = 'none'
    let extractError = ''
    try {
      const result = await extractor(filePath)
      if (result) {
        pages = [...result.pages]
        pageCount = Math.max(result.pageCount ?? pages.length, pages.length)
        extractionStatus = 'ok'
      } else {
        extractionStatus = 'no-extractor'
      }
    } catch (error) {
      extractionStatus = 'failed'
      extractError = error instanceof Error ? error.message : String(error)
    }

    const meta = guessMetadata(path.basename(filePath), pages)
    const record = store.replacePaper(
      {
        paperId: existing?.paperId ?? randomUUID(),
        fileKey,
        filePath,
        fileName: path.basename(filePath),
        fileSize: stat.size,
        fileMtime: stat.mtimeMs,
        title: meta.title || existing?.title || titleFromFileName(path.basename(filePath)),
        authors: meta.authors.length > 0 ? meta.authors : (existing?.authors ?? []),
        year: meta.year ?? existing?.year,
        pageCount,
        extractionStatus,
        extractor: extractorName,
        extractError,
        notes: existing?.notes ?? '',
        references: existing?.references ?? [],
      },
      pages,
    )
    return {
      paperId: record.paperId,
      filePath: record.filePath,
      status: existing ? 'updated' : 'added',
      extractionStatus: record.extractionStatus,
      extractError: record.extractError || undefined,
      title: record.title,
      pageCount: record.pageCount,
    }
  }

  /**
   * 扫描目录批量索引（LIB-01）：递归发现 PDF → addPaper 增量更新；
   * 扫描范围内原文件已消失的论文标记 file_missing（记录保留，笔记仍可搜索）。
   */
  async indexLibrary(project: string, scanDir: string): Promise<IndexLibraryResult> {
    const projectPath = projectDir(this.config.dataRoot, project)
    const scanRoot = path.resolve(scanDir)
    if (!fs.existsSync(scanRoot) || !fs.statSync(scanRoot).isDirectory()) {
      throw new Error(`扫描目录不存在或不是文件夹: ${scanDir}`)
    }
    const pdfs = collectPdfs(scanRoot)
    let added = 0
    let updated = 0
    let unchanged = 0
    let extractionFailed = 0
    let noExtractor = 0
    for (const pdf of pdfs) {
      const result = await this.addPaper(project, pdf)
      if (result.status === 'added') added += 1
      else if (result.status === 'updated') updated += 1
      else unchanged += 1
      if (result.extractionStatus === 'failed') extractionFailed += 1
      else if (result.extractionStatus === 'no-extractor') noExtractor += 1
    }
    const store = this.storeFor(projectPath)
    const missing = store.markMissingUnder(scanRoot)
    return {
      project,
      scanDir: scanRoot,
      added,
      updated,
      unchanged,
      extractionFailed,
      noExtractor,
      missing,
      total: store.countPapers(),
    }
  }

  /** 设置自由格式精读笔记（LIB-04/07；覆盖式写入，任意结构 Markdown）。 */
  setNotes(project: string, paperId: string, notes: string): PaperSummary {
    const store = this.storeFor(projectDir(this.config.dataRoot, project))
    const record = store.updateNotes(paperId, notes)
    if (!record) throw new Error(`文献不存在: ${paperId}`)
    return record
  }

  /** 读取精读笔记（LIB-04）。 */
  getNotes(project: string, paperId: string): string {
    const record = this.requirePaper(project, paperId)
    return record.notes
  }

  /** 设置原始参考文献清单（LIB-05/07；至少完整保留可识别的论文标题）。 */
  setReferences(project: string, paperId: string, references: readonly string[]): PaperSummary {
    const store = this.storeFor(projectDir(this.config.dataRoot, project))
    const record = store.updateReferences(paperId, references)
    if (!record) throw new Error(`文献不存在: ${paperId}`)
    return record
  }

  /** 读取原始参考文献清单（LIB-05）。 */
  getReferences(project: string, paperId: string): string[] {
    const record = this.requirePaper(project, paperId)
    return record.references
  }

  /** 保存 BibTeX 原文（LIB-06：原样保存，不解析不压缩；可覆盖）。 */
  setBibtex(project: string, paperId: string, bibtex: string): PaperSummary {
    const store = this.storeFor(projectDir(this.config.dataRoot, project))
    const record = store.updateBibtex(paperId, bibtex)
    if (!record) throw new Error(`文献不存在: ${paperId}`)
    return record
  }

  /** 读取 BibTeX 原文（LIB-06）。 */
  getBibtex(project: string, paperId: string): string {
    const record = this.requirePaper(project, paperId)
    return record.bibtex
  }

  /**
   * 导入 BibTeX 文本（LIB-06）：
   * - parseBibtex 解析出条目（标题/作者/年份抽取 + raw 原样保留）；
   * - 按归一化标题挂接已有论文（bibtex 原文追加保存；论文标题/作者/年份为空时回填）；
   * - 未匹配条目原样返回给调用方（可让用户手动挂接或后续处理）。
   * @returns attached 已挂接的论文；unmatched 未匹配的条目。
   */
  importBibtex(project: string, bibtexText: string): { attached: Array<{ paperId: string; title: string }>; unmatched: BibEntry[] } {
    const store = this.storeFor(projectDir(this.config.dataRoot, project))
    const entries = parseBibtex(bibtexText)
    const candidates = store.listPapers({ includeMissing: true, limit: 500 })
    const byTitle = new Map<string, PaperRecord>()
    for (const paper of candidates) {
      const key = normalizeBibTitle(paper.title)
      if (key && !byTitle.has(key)) byTitle.set(key, paper)
    }
    const attached: Array<{ paperId: string; title: string }> = []
    const unmatched: BibEntry[] = []
    for (const entry of entries) {
      const key = normalizeBibTitle(entry.title)
      const paper = key ? byTitle.get(key) : undefined
      if (!paper) {
        unmatched.push(entry)
        continue
      }
      const bibtex = paper.bibtex ? `${paper.bibtex}\n\n${entry.raw}` : entry.raw
      const authors = paper.authors.length > 0 ? paper.authors : parseBibAuthorNames(entry.author)
      store.patchPaper(paper.paperId, {
        title: paper.title || entry.title,
        authors,
        year: paper.year ?? bibYear(entry.year),
        bibtex,
      })
      attached.push({ paperId: paper.paperId, title: paper.title || entry.title })
    }
    return { attached, unmatched }
  }

  /** 读取论文（不存在抛错）。 */
  private requirePaper(project: string, paperId: string): PaperRecord {
    const store = this.storeFor(projectDir(this.config.dataRoot, project))
    const record = store.getPaper(paperId)
    if (!record) throw new Error(`文献不存在: ${paperId}`)
    return record
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
