/**
 * 文献索引 存储层 —— 每个科研项目独立的 library.db（<project>/.evoresearch-data/library/）。
 *
 * 镜像语义（LIB-01）：原始 PDF 是主资料，本库只是可搜索镜像。
 * - 删除 .evoresearch-data/library/ 目录即可整体重建（重新 indexLibrary 扫描）；
 * - 索引永不修改、移动、复制原文件；
 * - .evoresearch-data/ 已被 workspace 服务写入项目 git exclude，镜像不进版本库。
 *
 * 表结构：
 * - papers：一篇文献一条（元数据 + 自动识别标题/作者/年份 + 笔记/参考文献预留字段；
 *   参考文献列名 refs 因 references 是 SQLite 关键字）；
 * - pages：按页文本（页号 + 字符偏移定位原文位置，LIB-02/03）；
 * - library_fts：FTS5（trigram）独立表，覆盖文件名/标题/作者/笔记/参考文献/全文，
 *   paper_id 为 UNINDEXED 存值列，用于按论文重建索引行。
 *
 * 检索约定（对齐 memory/store.ts）：
 * - trigram tokenizer：中英文子串级匹配，查询 token 至少 3 字符；
 * - 时间戳全部为毫秒 epoch；
 * - 页文本与 FTS 内容统一经 cleanForIndex 清洗空白，位置偏移以清洗后文本为准。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { evoresearchDb, type Migration, cleanForIndex } from '../core/db.js'
import { normPath } from '../core/paths.js'
import type { PageRecord, PaperRecord, SearchField } from './types.js'

/** library.db 的全部迁移。 */
export const LIBRARY_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE papers (
          paper_id TEXT PRIMARY KEY,
          file_key TEXT NOT NULL UNIQUE,
          file_path TEXT NOT NULL,
          file_name TEXT NOT NULL,
          file_size INTEGER NOT NULL DEFAULT 0,
          file_mtime INTEGER NOT NULL DEFAULT 0,
          file_missing INTEGER NOT NULL DEFAULT 0,
          title TEXT NOT NULL DEFAULT '',
          authors TEXT NOT NULL DEFAULT '[]',
          year INTEGER,
          page_count INTEGER NOT NULL DEFAULT 0,
          extraction_status TEXT NOT NULL DEFAULT 'none',
          extractor TEXT NOT NULL DEFAULT '',
          extract_error TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          refs TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_papers_missing ON papers(file_missing, updated_at);

        CREATE TABLE pages (
          paper_id TEXT NOT NULL REFERENCES papers(paper_id) ON DELETE CASCADE,
          page_no INTEGER NOT NULL,
          text TEXT NOT NULL,
          PRIMARY KEY (paper_id, page_no)
        );

        CREATE VIRTUAL TABLE library_fts USING fts5(
          file_name, title, authors, notes, refs, body,
          paper_id UNINDEXED,
          tokenize = 'trigram'
        );
      `)
    },
  },
  {
    // LIB-06：BibTeX 原样保存（references 是标题清单，bibtex 是完整条目原文）。
    version: 2,
    up(db) {
      db.exec(`ALTER TABLE papers ADD COLUMN bibtex TEXT NOT NULL DEFAULT '';`)
    },
  },
]

/** 数据库行（宽松类型，读取后立即转换为领域对象）。 */
type Row = Record<string, unknown>

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function parseJsonArray<T>(value: unknown): T[] {
  try {
    const parsed = JSON.parse(asString(value, '[]')) as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

/** 项目文献镜像目录（<project>/.evoresearch-data/library/）。 */
export function projectLibraryDir(projectDirPath: string): string {
  return path.join(projectDirPath, '.evoresearch-data', 'library')
}

/** 把用户查询拆成 trigram FTS5 安全 token（<3 字符 token 被过滤，上限 16）。 */
export function toFtsTokens(query: string, maxTokens = 16): string[] {
  return query
    .split(/[\s\p{P}\p{S}]+/u)
    .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter((t) => t.length >= 3)
    .slice(0, maxTokens)
}

/** LIKE 模式转义（配合 ESCAPE '\'）。 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/** 从数据库行还原 PaperRecord。 */
function paperFromRow(row: Row): PaperRecord {
  const year = row.year
  return {
    paperId: asString(row.paper_id),
    fileKey: asString(row.file_key),
    filePath: asString(row.file_path),
    fileName: asString(row.file_name),
    fileSize: asNumber(row.file_size),
    fileMtime: asNumber(row.file_mtime),
    fileMissing: asNumber(row.file_missing) === 1,
    title: asString(row.title),
    authors: parseJsonArray<string>(row.authors),
    year: year === null || year === undefined ? undefined : asNumber(year),
    pageCount: asNumber(row.page_count),
    extractionStatus: asString(row.extraction_status, 'none') as PaperRecord['extractionStatus'],
    extractor: asString(row.extractor),
    extractError: asString(row.extract_error),
    notes: asString(row.notes),
    references: parseJsonArray<string>(row.refs),
    bibtex: asString(row.bibtex),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
  }
}

/** 判断 filePath 是否位于 rootNorm（已 normPath 化的根目录）之下。 */
function isPathUnder(filePath: string, rootNorm: string): boolean {
  const normalized = normPath(filePath)
  return normalized === rootNorm || normalized.startsWith(rootNorm + path.sep)
}

/** 文献镜像存储门面：封装 library.db 的全部读写。 */
export class LibraryStore {
  readonly db: evoresearchDb

  private constructor(db: evoresearchDb) {
    this.db = db
  }

  /** 打开项目文献镜像库（目录不存在时自动创建）。 */
  static open(projectDirPath: string): LibraryStore {
    const file = path.join(projectLibraryDir(projectDirPath), 'library.db')
    return new LibraryStore(evoresearchDb.open(file, LIBRARY_MIGRATIONS))
  }

  /** 内存库（测试用）。 */
  static openMemory(): LibraryStore {
    return new LibraryStore(evoresearchDb.openMemory(LIBRARY_MIGRATIONS))
  }

  // ── papers ────────────────────────────────────────────────────────────────

  /** 按 id 读取论文。 */
  getPaper(paperId: string): PaperRecord | undefined {
    const row = this.db.db.prepare('SELECT * FROM papers WHERE paper_id = ?').get(paperId) as Row | undefined
    return row ? paperFromRow(row) : undefined
  }

  /** 按规范化路径键读取论文（addPaper 幂等去重）。 */
  getPaperByKey(fileKey: string): PaperRecord | undefined {
    const row = this.db.db.prepare('SELECT * FROM papers WHERE file_key = ?').get(fileKey) as Row | undefined
    return row ? paperFromRow(row) : undefined
  }

  /** 列出论文（默认只出 file_missing=0，最新更新优先）。 */
  listPapers(options: { includeMissing?: boolean; limit?: number; offset?: number } = {}): PaperRecord[] {
    const where = options.includeMissing === true ? '' : 'WHERE file_missing = 0'
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 100), 1), 500)
    const offset = Math.max(Math.floor(options.offset ?? 0), 0)
    const rows = this.db.db
      .prepare(`SELECT * FROM papers ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as Row[]
    return rows.map(paperFromRow)
  }

  /** 论文总数。 */
  countPapers(): number {
    const row = this.db.db.prepare('SELECT COUNT(*) AS n FROM papers').get() as Row
    return asNumber(row.n)
  }

  /**
   * 把扫描目录下已消失（file_missing=0 且文件不存在）的论文标记为 missing。
   * 记录保留（笔记/references 仍可搜索），不删除索引。
   * @returns 本次新标记的数量。
   */
  markMissingUnder(scanRoot: string): number {
    const rootNorm = normPath(path.resolve(scanRoot))
    const rows = this.db.db.prepare('SELECT paper_id, file_path FROM papers WHERE file_missing = 0').all() as Row[]
    const update = this.db.db.prepare('UPDATE papers SET file_missing = 1, updated_at = ? WHERE paper_id = ?')
    let count = 0
    for (const row of rows) {
      const filePath = asString(row.file_path)
      if (!isPathUnder(filePath, rootNorm)) continue
      if (!fs.existsSync(filePath)) {
        update.run(Date.now(), asString(row.paper_id))
        count += 1
      }
    }
    return count
  }

  /**
   * 整篇替换论文镜像（元数据 + 页文本 + FTS 重建），事务内完成。
   * 保留原 created_at 与既有 notes/references（调用方负责从 existing 携带）。
   */
  replacePaper(
    input: {
      paperId: string
      fileKey: string
      filePath: string
      fileName: string
      fileSize: number
      fileMtime: number
      title: string
      authors: readonly string[]
      year?: number
      pageCount: number
      extractionStatus: PaperRecord['extractionStatus']
      extractor: string
      extractError?: string
      notes: string
      references: readonly string[]
    },
    pages: readonly string[],
  ): PaperRecord {
    const existing = this.getPaper(input.paperId) ?? this.getPaperByKey(input.fileKey)
    const now = Date.now()
    const record: PaperRecord = {
      paperId: input.paperId,
      fileKey: input.fileKey,
      filePath: input.filePath,
      fileName: input.fileName,
      fileSize: input.fileSize,
      fileMtime: input.fileMtime,
      fileMissing: false,
      title: input.title,
      authors: [...input.authors],
      year: input.year,
      pageCount: input.pageCount,
      extractionStatus: input.extractionStatus,
      extractor: input.extractor,
      extractError: input.extractError ?? '',
      notes: input.notes,
      references: [...input.references],
      bibtex: existing?.bibtex ?? '',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    this.db.transaction(() => {
      this.db.db
        .prepare(
          `INSERT INTO papers
             (paper_id, file_key, file_path, file_name, file_size, file_mtime, file_missing,
              title, authors, year, page_count, extraction_status, extractor, extract_error,
              notes, refs, bibtex, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(paper_id) DO UPDATE SET
             file_key = excluded.file_key, file_path = excluded.file_path,
             file_name = excluded.file_name, file_size = excluded.file_size,
             file_mtime = excluded.file_mtime, file_missing = 0,
             title = excluded.title, authors = excluded.authors, year = excluded.year,
             page_count = excluded.page_count, extraction_status = excluded.extraction_status,
             extractor = excluded.extractor, extract_error = excluded.extract_error,
             notes = excluded.notes, refs = excluded.refs, bibtex = excluded.bibtex,
             updated_at = excluded.updated_at`,
        )
        .run(
          record.paperId,
          record.fileKey,
          record.filePath,
          record.fileName,
          record.fileSize,
          record.fileMtime,
          record.title,
          JSON.stringify(record.authors),
          record.year ?? null,
          record.pageCount,
          record.extractionStatus,
          record.extractor,
          record.extractError,
          record.notes,
          JSON.stringify(record.references),
          record.bibtex,
          record.createdAt,
          record.updatedAt,
        )
      this.db.db.prepare('DELETE FROM pages WHERE paper_id = ?').run(record.paperId)
      const insertPage = this.db.db.prepare('INSERT INTO pages (paper_id, page_no, text) VALUES (?, ?, ?)')
      pages.forEach((text, index) => {
        insertPage.run(record.paperId, index + 1, cleanForIndex(text))
      })
      this.rebuildFts(record)
    })
    return record
  }

  /** 更新自由格式精读笔记（LIB-07 预留；FTS 同步重建）。 */
  updateNotes(paperId: string, notes: string): PaperRecord | undefined {
    const existing = this.getPaper(paperId)
    if (!existing) return undefined
    const now = Date.now()
    this.db.transaction(() => {
      this.db.db.prepare('UPDATE papers SET notes = ?, updated_at = ? WHERE paper_id = ?').run(notes, now, paperId)
      this.rebuildFts({ ...existing, notes, updatedAt: now })
    })
    return this.getPaper(paperId)
  }

  /** 更新原始参考文献清单（LIB-07 预留；FTS 同步重建）。 */
  updateReferences(paperId: string, references: readonly string[]): PaperRecord | undefined {
    const existing = this.getPaper(paperId)
    if (!existing) return undefined
    const now = Date.now()
    this.db.transaction(() => {
      this.db.db
        .prepare('UPDATE papers SET refs = ?, updated_at = ? WHERE paper_id = ?')
        .run(JSON.stringify(references), now, paperId)
      this.rebuildFts({ ...existing, references: [...references], updatedAt: now })
    })
    return this.getPaper(paperId)
  }

  /**
   * 定点修补论文元数据（LIB-06 导入 BibTeX 时回填标题/作者/年份；不触碰页文本）。
   * title/authors 变化时同步重建 FTS。
   */
  patchPaper(
    paperId: string,
    patch: { title?: string; authors?: readonly string[]; year?: number | null; bibtex?: string },
  ): PaperRecord | undefined {
    const existing = this.getPaper(paperId)
    if (!existing) return undefined
    const now = Date.now()
    const next: PaperRecord = {
      ...existing,
      title: patch.title ?? existing.title,
      authors: patch.authors ? [...patch.authors] : existing.authors,
      year: patch.year === undefined ? existing.year : (patch.year ?? undefined),
      bibtex: patch.bibtex ?? existing.bibtex,
      updatedAt: now,
    }
    this.db.transaction(() => {
      this.db.db
        .prepare(
          'UPDATE papers SET title = ?, authors = ?, year = ?, bibtex = ?, updated_at = ? WHERE paper_id = ?',
        )
        .run(next.title, JSON.stringify(next.authors), next.year ?? null, next.bibtex, now, paperId)
      if (patch.title !== undefined || patch.authors !== undefined) this.rebuildFts(next)
    })
    return this.getPaper(paperId)
  }

  /** 更新 BibTeX 原文（LIB-06：原样保存，不解析不压缩；不进 FTS）。 */
  updateBibtex(paperId: string, bibtex: string): PaperRecord | undefined {
    const existing = this.getPaper(paperId)
    if (!existing) return undefined
    this.db.db
      .prepare('UPDATE papers SET bibtex = ?, updated_at = ? WHERE paper_id = ?')
      .run(bibtex, Date.now(), paperId)
    return this.getPaper(paperId)
  }

  // ── pages ─────────────────────────────────────────────────────────────────

  /** 读取某页索引文本（页号从 1 开始）。 */
  getPageText(paperId: string, pageNo: number): string | undefined {
    const row = this.db.db
      .prepare('SELECT text FROM pages WHERE paper_id = ? AND page_no = ?')
      .get(paperId, pageNo) as Row | undefined
    return row ? asString(row.text) : undefined
  }

  /** 按页号升序列出某论文的全部页文本。 */
  listPages(paperId: string): PageRecord[] {
    const rows = this.db.db
      .prepare('SELECT paper_id, page_no, text FROM pages WHERE paper_id = ? ORDER BY page_no ASC')
      .all(paperId) as Row[]
    return rows.map((row) => ({ paperId: asString(row.paper_id), pageNo: asNumber(row.page_no), text: asString(row.text) }))
  }

  /** 任一检索词出现在任一页文本中（子串匹配，大小写不敏感）。 */
  pagesContainAny(paperId: string, terms: readonly string[]): boolean {
    const check = this.db.db.prepare("SELECT 1 FROM pages WHERE paper_id = ? AND text LIKE ? ESCAPE '\\' LIMIT 1")
    for (const term of terms) {
      if (term.length < 2) continue
      const row = check.get(paperId, `%${escapeLike(term)}%`) as Row | undefined
      if (row) return true
    }
    return false
  }

  // ── 检索（FTS5 + LIKE 回退） ──────────────────────────────────────────────

  /** FTS5 检索论文（matchQuery 为列限定 MATCH 串，score 为 bm25）。 */
  searchFts(matchQuery: string, limit: number): Array<{ paper: PaperRecord; score: number }> {
    const rows = this.db.db
      .prepare(
        `SELECT p.*, bm25(library_fts) AS score
         FROM library_fts f
         JOIN papers p ON p.paper_id = f.paper_id
         WHERE library_fts MATCH ?
         ORDER BY score LIMIT ?`,
      )
      .all(matchQuery, limit) as Row[]
    return rows.map((row) => ({ paper: paperFromRow(row), score: asNumber(row.score) }))
  }

  /**
   * LIKE 子串检索回退（查询词过短无法 trigram 时使用；filename/title 单字符
   * 中文或 1-2 字符英文查询仍可命中）。score 恒为 0。
   */
  searchLike(rawQuery: string, fields: readonly SearchField[], limit: number): Array<{ paper: PaperRecord; score: number }> {
    const pattern = `%${escapeLike(rawQuery)}%`
    const clauses: string[] = []
    const params: Array<string | number> = []
    for (const field of fields) {
      if (field === 'filename') {
        clauses.push("p.file_name LIKE ? ESCAPE '\\'")
        params.push(pattern)
      } else if (field === 'title') {
        clauses.push("(p.title LIKE ? ESCAPE '\\' OR p.authors LIKE ? ESCAPE '\\')")
        params.push(pattern, pattern)
      } else if (field === 'notes') {
        clauses.push("p.notes LIKE ? ESCAPE '\\'")
        params.push(pattern)
      } else if (field === 'references') {
        clauses.push("p.refs LIKE ? ESCAPE '\\'")
        params.push(pattern)
      } else if (field === 'fulltext') {
        clauses.push("EXISTS (SELECT 1 FROM pages pg WHERE pg.paper_id = p.paper_id AND pg.text LIKE ? ESCAPE '\\')")
        params.push(pattern)
      }
    }
    if (clauses.length === 0) return []
    const rows = this.db.db
      .prepare(`SELECT p.* FROM papers p WHERE ${clauses.join(' OR ')} ORDER BY p.updated_at DESC LIMIT ?`)
      .all(...params, limit) as Row[]
    return rows.map((row) => ({ paper: paperFromRow(row), score: 0 }))
  }

  /** 重建某论文的 FTS 行（删除 + 插入，事务内由调用方保证）。 */
  private rebuildFts(paper: PaperRecord): void {
    const pageRows = this.listPages(paper.paperId)
    const body = cleanForIndex(pageRows.map((p) => p.text).join('\n\n'))
    this.db.db.prepare('DELETE FROM library_fts WHERE paper_id = ?').run(paper.paperId)
    this.db.db
      .prepare(
        `INSERT INTO library_fts (file_name, title, authors, notes, refs, body, paper_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        cleanForIndex(paper.fileName),
        cleanForIndex(paper.title),
        cleanForIndex(paper.authors.join(', ')),
        cleanForIndex(paper.notes),
        cleanForIndex(paper.references.join('\n')),
        body,
        paper.paperId,
      )
  }

  /** 关闭数据库。 */
  close(): void {
    this.db.close()
  }
}
