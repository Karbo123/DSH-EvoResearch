/**
 * 文献索引 领域类型（LIB-01..03 起步；LIB-04/05/07 预留字段）。
 *
 * 设计原则（§8.1）：原始 PDF 永远是主资料，本模块只维护「可删除重建的镜像索引」，
 * 不建立强制 Paper Record 表单；标题/作者自动识别仅用于搜索与显示，识别不到时
 * 论文仍可阅读、搜索、写笔记。
 *
 * 全部字段为纯 JSON 数据（wire 序列化安全），可经 Remote API 直接返回。
 */

/** 文献（Paper）镜像索引记录：原始 PDF 是主资料，本记录只是元数据镜像。 */
export interface PaperRecord {
  /** 稳定 ID（randomUUID）。 */
  paperId: string
  /** 规范化文件路径键（Windows 大小写不敏感），用于路径去重。 */
  fileKey: string
  /** 原始 PDF 的绝对路径（索引永不移动/复制/修改原文件）。 */
  filePath: string
  fileName: string
  fileSize: number
  /** 文件 mtime（毫秒），用于检测文件变化后增量重提取。 */
  fileMtime: number
  /** 原文件已被删除/移动：记录保留（笔记与 references 仍可搜索），不伪造文件存在。 */
  fileMissing: boolean
  /** 自动识别的标题；识别不到时回退为去扩展名文件名（§8.1）。 */
  title: string
  /** 自动识别的作者（尽力而为，允许为空）。 */
  authors: string[]
  year?: number
  /** 已建立页级文本索引的页数；0 = 无页级文本（提取失败/无提取器）。 */
  pageCount: number
  /**
   * 全文提取状态：
   * - 'none'：尚未尝试提取；
   * - 'ok'：提取成功，pages 表有页级文本；
   * - 'no-extractor'：无可用提取器（依赖未安装）；
   * - 'failed'：提取器可用但提取失败（错误记入 extractError）。
   * 后两者论文仍正常注册（文件名 + 元数据 + 笔记），可搜索（LIB-03）。
   */
  extractionStatus: 'none' | 'ok' | 'no-extractor' | 'failed'
  /** 使用的提取器名（'pdf-parse' / 'custom'）。 */
  extractor: string
  /** 提取失败时的错误信息。 */
  extractError: string
  /** 自由格式精读笔记（LIB-04/07：Markdown 文章，不是字段集合）。 */
  notes: string
  /** 原始参考文献清单（LIB-05/07：至少完整保留可识别的论文标题）。 */
  references: string[]
  /** BibTeX 原文（LIB-06：原样保存，Idea 讨论不要求引用）。 */
  bibtex: string
  createdAt: number
  updatedAt: number
}

/** 对外（Remote API / 搜索 / 列表）暴露的论文视图：与 PaperRecord 同构（纯 JSON）。 */
export type PaperSummary = PaperRecord

/** 页级文本索引行。 */
export interface PageRecord {
  paperId: string
  /** 页号（从 1 开始）。 */
  pageNo: number
  /** 清洗空白后的页文本（位置偏移以此为准）。 */
  text: string
}

/** 提取器结果：按页文本。 */
export interface ExtractedPdf {
  /** 数组下标 i 对应第 i+1 页。 */
  pages: string[]
  /** 提取器声明的总页数；缺省取 pages.length。 */
  pageCount?: number
}

/**
 * PDF 全文提取器（LIB-02 可插拔接口）。
 *
 * 契约：
 * - 返回 null：提取器不可用（依赖未安装）或不支持该文件 → 论文仍注册，
 *   extractionStatus='no-extractor'；
 * - 抛出 Error：提取器可用但提取失败 → 论文仍注册，
 *   extractionStatus='failed'（错误记入 extractError）。
 */
export type PdfExtractor = (filePath: string) => Promise<ExtractedPdf | null>

/** addPaper 的三种结局。 */
export type AddPaperStatus = 'added' | 'updated' | 'exists'

/** addPaper 返回值。 */
export interface AddPaperResult {
  paperId: string
  filePath: string
  status: AddPaperStatus
  extractionStatus: PaperRecord['extractionStatus']
  extractError?: string
  title: string
  pageCount: number
}

/** indexLibrary 汇总。 */
export interface IndexLibraryResult {
  project: string
  scanDir: string
  added: number
  updated: number
  /** 文件未变化、未重新提取的文献数。 */
  unchanged: number
  extractionFailed: number
  noExtractor: number
  /** 扫描目录下原文件已消失、被标记 file_missing 的文献数。 */
  missing: number
  /** 项目文献总数。 */
  total: number
}

/** LIB-03 搜索覆盖的字段；'title' 同时覆盖标题与作者。 */
export type SearchField = 'filename' | 'title' | 'fulltext' | 'notes' | 'references'

/** 搜索选项。 */
export interface SearchOptions {
  /** 返回条数上限（默认 20，最大 100）。 */
  limit?: number
  /** 限定搜索字段（默认全部字段）。 */
  fields?: SearchField[]
  /** 是否计算原文位置（默认 true）。 */
  includeLocations?: boolean
  /** 每篇最多返回的原文位置数（默认 5，最大 20）。 */
  locationsPerPaper?: number
}

/**
 * 原文位置：文件路径 + 页号 + 段偏移（§8.3）。
 * offset/length 是「索引文本」（清洗空白后的页文本）中的字符偏移。
 */
export interface TextLocation {
  page: number
  offset: number
  length: number
  snippet: string
}

/** 单条搜索命中。 */
export interface SearchHit {
  paper: PaperSummary
  /** bm25 分数（LIKE 回退路径恒为 0）。 */
  score: number
  /** 实际命中的字段（子串验证）。 */
  matchedFields: SearchField[]
  /** 原文位置（命中 fulltext 时计算）。 */
  locations: TextLocation[]
}

/** getTextRange 返回值：原文精确片段。 */
export interface TextRange {
  paperId: string
  filePath: string
  page: number
  offset: number
  length: number
  text: string
}

// ── LIB-06 BibTeX ───────────────────────────────────────────────────────────

/** 解析自 .bib 文件/文本的 BibTeX 条目（raw 原样保留）。 */
export interface BibEntry {
  /** 条目 key（@article{key, ...）。 */
  key: string
  /** 条目类型（article/inproceedings/book/...，小写）。 */
  type: string
  /** 解析出的标题（花括号已展开、空白已折叠；可能为空串）。 */
  title: string
  /** 解析出的作者字段原文（and 分隔；可能为空串）。 */
  author: string
  year?: string
  /** 条目完整原文（含 @type{...} 整段，原样保存用）。 */
  raw: string
}

// ── LIB-08 图引用数据接口 ───────────────────────────────────────────────────

/**
 * 文献引用数据接口（LIB-08）：供 Chat Graph / 写作上下文引用文献。
 * 节点只保存 ref（不复制正文）。接线点：chat-graph.ts 的 GraphNodeRef
 * （kind 'pdf' + path=论文原路径 即可直接引用 PDF；kind 'note' 时 notes 存于
 * 镜像，由 resolveRef 返回 notes 内容，落成独立笔记文件后接 kind 'note' + path）。
 */
export interface LibraryRef {
  /** 'paper'=整篇论文；'note'=该论文的精读笔记。 */
  kind: 'paper' | 'note'
  /** 文献 ID（优先）；缺省时用 path。 */
  paperId?: string
  /** 论文 PDF 绝对路径（或相对项目目录的路径）。 */
  path?: string
}

/** resolveRef 的解析结果（纯 JSON，可序列化）。 */
export interface ResolvedLibraryRef {
  kind: 'paper' | 'note'
  paperId: string
  /** 论文原 PDF 路径（kind='note' 时也是论文路径，笔记内容在 notes 字段）。 */
  path: string
  title: string
  notes: string
  references: string[]
}
