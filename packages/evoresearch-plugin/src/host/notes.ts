/**
 * 自由文本研究笔记服务（NOTE-01..09）。
 *
 * 存储形态（主存储永远是 Markdown 文件；索引只是可重建的镜像，绝不作为唯一副本）：
 * - 新笔记：<base>/memories/notes/<slug>-<8位hex>.md，零 frontmatter（NOTE-01）；
 * - 旧 Observation：<base>/memories/observations/{global,projects/<P-id>}/*.md
 *   继续可读（NOTE-03/04）：frontmatter 可解析但默认折叠、不要求用户维护；旧 Remote API 保留兼容别名；
 * - 研究近况页：<base>/memories/RESEARCH_MAP.md（可选，NOTE-07）；
 * - 背景资料：<base>/memories/{USER_PROFILE,RESEARCH_TASTE,PROJECT_PROFILE}.md
 *   （可选，NOTE-09；缺失时读取返回空对象且不抛错，按需参与上下文、绝不阻塞聊天）；
 * - 段落索引：<base>/memories/notes/.notes-index.json（NOTE-05，可删除重建）。
 *
 * 语义保证：
 * - 正文优先（NOTE-06）：索引/摘要/草稿永远不得改写用户正文；writeNote 是用户编辑入口，
 *   新笔记按原样写入，旧文件仅替换 frontmatter 之后的正文；
 * - AI 更新研究近况与资料走「草稿 → 用户确认」两段式（NOTE-08）：updateDraft 只落盘草稿，
 *   applyDraft 是唯一写目标文件的入口，并带 baseHash 冲突检测（目标文件被用户改过时拒绝
 *   静默整体覆盖，除非显式 force）；
 * - 长笔记按自然段建立索引（段落 → 文件 + 正文内字符偏移 + 段序号），读取按字符范围分页（NOTE-05）；
 * - 编辑文件后只重建受影响文件的索引（mtime+字节数指纹比对，NOTE-05）；
 * - 文件路径全部做名称白名单校验与根目录包含检查（与 core/paths.ts 同款护栏）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { workspaceDataDir } from './core/paths.js'
import { createHash, randomUUID } from 'node:crypto'

/** 背景资料文件名（memories 根目录）。 */
export const BACKGROUND_DOC_FILES = {
  researchMap: 'RESEARCH_MAP.md',
  /** 全局长期身份/协作方式；永远位于部署根而不是某个项目。 */
  soul: 'SOUL.md',
  userProfile: 'USER_PROFILE.md',
  researchTaste: 'RESEARCH_TASTE.md',
  projectProfile: 'PROJECT_PROFILE.md',
} as const

/** 背景资料种类。 */
export type BackgroundDocKind = keyof typeof BACKGROUND_DOC_FILES

/** 笔记来源：新笔记 or 旧 Observation。 */
export type NoteSource = 'note' | 'observation'

/** 一个自然段（正文内定位：字符偏移 + 长度 + 段序号）。 */
export interface NoteParagraph {
  readonly text: string
  /** 段落首字符在正文中的偏移。 */
  readonly offset: number
  readonly length: number
}

/** 笔记摘要（列表项，NOTE-01：用户看到标题与正文预览，不暴露内部结构）。 */
export interface NoteSummary {
  /** 稳定 id（= 文件名去掉 .md）。 */
  readonly noteId: string
  readonly fileName: string
  readonly title: string
  readonly bodyPreview: string
  readonly source: NoteSource
  /** 旧 Observation 是否带 frontmatter（UI 默认折叠，NOTE-04）。 */
  readonly hasFrontmatter: boolean
  /** 旧 Observation 所在子目录（global 或 projects/<P-id>）；新笔记无。 */
  readonly legacyDir?: string
  /** 文件 mtime（毫秒）。 */
  readonly updatedAt: number
  readonly byteSize: number
  /** 段落数（来自索引缓存；未索引/未刷新时为 0，调用 searchIndex 会刷新）。 */
  readonly paragraphCount: number
}

/** 笔记完整读取结果（长笔记按范围分页，NOTE-05）。 */
export interface NoteReadResult extends NoteSummary {
  /** 本次返回的正文片段（不含 frontmatter）。 */
  readonly body: string
  /** 正文总字符数。 */
  readonly totalLength: number
  /** 本次片段的起始字符偏移。 */
  readonly offset: number
  /** 下一页起始偏移；已到结尾为 null。 */
  readonly nextOffset: number | null
  /** 旧文件的 frontmatter（解析后的对象；新笔记无此字段）。 */
  readonly frontmatter?: Record<string, unknown>
}

/** 创建 / 写入结果。 */
export interface NoteMeta {
  readonly noteId: string
  readonly fileName: string
  readonly title: string
  /** 正文（不含 frontmatter）。 */
  readonly body: string
  readonly source: NoteSource
  readonly hasFrontmatter: boolean
  readonly updatedAt: number
  readonly byteSize: number
}

/** 段落级检索命中（NOTE-05）。 */
export interface NoteSearchHit {
  readonly noteId: string
  readonly fileName: string
  readonly title: string
  readonly source: NoteSource
  readonly paragraphIndex: number
  /** 段落首字符在正文中的偏移（可传给 readNote 精确定位）。 */
  readonly offset: number
  readonly snippet: string
  readonly score: number
  readonly updatedAt: number
}

/** 背景资料读取结果（NOTE-09：缺文件返回 exists=false 且不抛错）。 */
export interface BackgroundDoc {
  readonly kind: BackgroundDocKind
  readonly fileName: string
  /** 文档存储边界；默认项目文档，SOUL.md 固定为 global。 */
  readonly scope: 'project' | 'global'
  readonly exists: boolean
  readonly content: string
  readonly updatedAt: number
  readonly byteSize: number
}

/** 草稿元数据（不含正文，列表用）。 */
export interface DraftMeta {
  readonly draftId: string
  readonly kind: BackgroundDocKind
  readonly fileName: string
  /** AI 附带的修改说明。 */
  readonly note: string
  /** 创建草稿时目标文件内容的 sha256；目标不存在为 null。 */
  readonly baseHash: string | null
  readonly targetExisted: boolean
  readonly createdAt: number
}

/** 草稿全文（预览用）。 */
export interface DraftDocument extends DraftMeta {
  readonly draft: string
}

/** 草稿应用结果。 */
export interface DraftApplyResult {
  readonly ok: boolean
  readonly target?: string
  /** 目标文件在草稿创建后被修改（需要 force 或重新生成草稿）。 */
  readonly conflict?: boolean
  readonly error?: string
}

/** 段落索引条目（持久化 JSON）。 */
interface IndexEntry {
  /** 相对 memories 根的路径（/ 分隔，稳定 key）。 */
  pathKey: string
  fileName: string
  source: NoteSource
  legacyDir?: string
  title: string
  hash: string
  mtimeMs: number
  byteSize: number
  updatedAt: number
  paragraphs: NoteParagraph[]
  /** 可重建的链接提示；正文始终是主资料。 */
  links?: string[]
}

interface NotesIndexFile {
  version: 1
  files: Record<string, IndexEntry>
}

/** 索引单文件大小上限（超过则跳过索引，避免超大文件拖垮检索）。 */
const MAX_INDEX_FILE_BYTES = 32 * 1024 * 1024

/** 规范化路径用于大小写不敏感比较（Windows，与 core/paths.ts 一致）。 */
function normPath(p: string): string {
  return path.normalize(p).toLowerCase()
}

/** 校验笔记 id（= 文件名去 .md；仅字母/数字/点/下划线/连字符，禁止路径分隔符与隐藏项）。 */
export function assertNoteId(noteId: string): string {
  const id = String(noteId ?? '')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(id)) {
    throw new Error(`非法的笔记 id: ${noteId}`)
  }
  return id
}

/** sha256 十六进制指纹。 */
function hashOf(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function extractLinkHints(content: string): string[] {
  const values = new Set<string>()
  const markdown = /!?(?:\[[^\]]*\])\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g
  const bare = /(?:https?:\/\/[^\s<>"')\]]+|(?:chat|session|note|paper|experiment|run|log|file|code|latex|result|manuscript):[^\s<>"')\]]+)/gi
  let match: RegExpExecArray | null
  while ((match = markdown.exec(content)) !== null && values.size < 64) values.add(match[1]!)
  while ((match = bare.exec(content)) !== null && values.size < 64) values.add(match[0]!)
  return [...values]
}

/**
 * 解析 Markdown 头部 frontmatter（YAML 子集，与旧 Observation 兼容；NOTE-04）。
 * 行级解析：第一行必须恰好是 `---`，其后第一个恰好为 `---` 的行是结束行。
 * body = 结束行之后、跳过行尾符与至多一个空白行；header = body 之前的原始前缀
 * （字节级保留，writeNote 写旧文件时原样还原，用户 frontmatter 一个字都不改）。
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>
  body: string
  hasFrontmatter: boolean
  header: string
} {
  const firstEnd = content.indexOf('\n')
  const firstLine = firstEnd < 0 ? content : content.slice(0, firstEnd)
  if (firstLine.replace(/\r$/, '') !== '---') {
    return { frontmatter: {}, body: content, hasFrontmatter: false, header: '' }
  }
  // 从第二行起找结束行（恰好为 '---'）
  let pos = firstEnd + 1
  let closeStart = -1
  while (pos <= content.length) {
    const nextEnd = content.indexOf('\n', pos)
    const line = nextEnd < 0 ? content.slice(pos) : content.slice(pos, nextEnd)
    if (line.replace(/\r$/, '') === '---') {
      closeStart = pos
      break
    }
    if (nextEnd < 0) break
    pos = nextEnd + 1
  }
  if (closeStart < 0) {
    // 只有开头 `---` 没有结束行：不是 frontmatter，整体视为正文
    return { frontmatter: {}, body: content, hasFrontmatter: false, header: '' }
  }
  const closeEnd = content.indexOf('\n', closeStart)
  let bodyStart = closeEnd < 0 ? content.length : closeEnd + 1
  // 跳过行尾符（\r\n 或 \n）与至多一个空白行
  if (bodyStart < content.length) {
    if (content[bodyStart] === '\r' && content[bodyStart + 1] === '\n') bodyStart += 2
    else if (content[bodyStart] === '\n') bodyStart += 1
    const blankEnd = content.indexOf('\n', bodyStart)
    if (blankEnd >= 0 && content.slice(bodyStart, blankEnd).trim().length === 0) {
      bodyStart = blankEnd + 1
    }
  }
  const header = content.slice(0, bodyStart)
  const frontmatter: Record<string, unknown> = {}
  for (const line of content.slice(firstEnd + 1, closeStart).split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    const raw = line.slice(colon + 1).trim()
    let value: unknown = raw
    try {
      value = raw.startsWith('[') ? (JSON.parse(raw) as unknown) : raw.replace(/^["']|["']$/g, '')
    } catch {
      // 非法 JSON 数组保持字符串
    }
    frontmatter[key] = value
  }
  return { frontmatter, body: content.slice(bodyStart), hasFrontmatter: true, header }
}

/** 从正文推导标题：frontmatter title → 首个 H1 → 首个非空行 → 文件名。 */
export function titleOf(fileName: string, body: string, frontmatterTitle?: string): string {
  if (frontmatterTitle && frontmatterTitle.trim().length > 0) return frontmatterTitle.trim()
  const lines = body.split(/\r?\n/).map((l) => l.trim())
  let firstNonEmpty = ''
  for (const line of lines) {
    if (line.length === 0) continue
    if (firstNonEmpty === '') firstNonEmpty = line
    if (line.startsWith('# ')) return line.slice(2).trim().slice(0, 120)
  }
  return (firstNonEmpty || fileName).slice(0, 120)
}

/** 正文预览（压平空白，截断加省略号）。 */
function previewOf(body: string, max = 240): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** 按自然段切分正文（连续非空行一组），返回段落与正文内字符偏移（NOTE-05）。 */
function splitParagraphs(body: string): NoteParagraph[] {
  const paragraphs: NoteParagraph[] = []
  const pieces = body.split(/(?<=\n)/)
  let offset = 0
  let current: string[] = []
  let currentStart = -1
  const flush = () => {
    if (current.length === 0) return
    const text = current.join('\n').replace(/\s+$/g, '').trimEnd()
    if (text.length > 0) {
      paragraphs.push({ text, offset: currentStart, length: text.length })
    }
    current = []
    currentStart = -1
  }
  for (const piece of pieces) {
    const line = piece.endsWith('\n') ? piece.slice(0, -1) : piece
    if (line.trim().length === 0) {
      flush()
    } else if (currentStart < 0) {
      currentStart = offset
      current.push(line)
    } else {
      current.push(line)
    }
    offset += piece.length
  }
  flush()
  return paragraphs
}

/** 检索 token：按空白/标点切分，保留字母数字与 CJK 连续串，上限 16 个。 */
function tokenizeQuery(query: string): string[] {
  return String(query ?? '')
    .split(/[\s\p{P}\p{S}]+/u)
    .map((t) => t.replace(/[^\p{L}\p{N}]+/gu, ''))
    .filter((t) => t.length > 0)
    .slice(0, 16)
}

/** 命中片段：围绕首个命中 token 截取。 */
function snippetAround(text: string, matchedTokens: readonly string[], max = 240): string {
  let idx = -1
  for (const token of matchedTokens) {
    const at = text.indexOf(token)
    if (at >= 0 && (idx < 0 || at < idx)) idx = at
  }
  const start = idx < 0 ? 0 : Math.max(0, idx - 40)
  const slice = text.slice(start, start + max)
  return `${start > 0 ? '…' : ''}${slice}${start + max < text.length ? '…' : ''}`
}

/** 笔记文件名 slug（仅 ASCII：小写字母/数字/连字符，其余转连字符；无内容回退 note）。 */
function slugifyNote(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return /[a-z0-9]/.test(slug) ? slug : 'note'
}

/** 原子写（临时文件 + rename，避免半成品）。 */
function atomicWrite(target: string, content: string): void {
  const tmp = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`
  fs.writeFileSync(tmp, content, 'utf8')
  try {
    fs.renameSync(tmp, target)
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}

/** 安全读文件；失败或二进制探测返回 null。 */
function readFileSafe(file: string): string | null {
  try {
    const content = fs.readFileSync(file, 'utf8')
    return content.includes('\u0000') ? null : content
  } catch {
    return null
  }
}

/** 读文件头部（列表/标题推导用，避免整读超大文件）。 */
function readHeadSafe(file: string, maxBytes: number): string | null {
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const size = fs.statSync(file).size
      const buf = Buffer.alloc(Math.min(maxBytes, size))
      fs.readSync(fd, buf, 0, buf.length, 0)
      return buf.toString('utf8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
}

/** 列出目录下全部 .md 的相对路径（/ 分隔；跳过隐藏项，深度受限）。 */
function listMarkdownRelative(root: string, maxDepth: number): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), depth + 1)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/'))
      }
    }
  }
  walk(root, 0)
  return out
}

/** 安全列目录。 */
function readdirSafe(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/** 自由文本研究笔记服务。 */
export class NotesService {
  constructor(readonly dataRoot: string) {}

  private readonly indexCache = new Map<string, NotesIndexFile>()

  /** 记忆根目录（workspace 数据目录下的 memories；根工作区时落在 <dataRoot>/plugins）。 */
  private memoriesDir(workspaceDir: string | undefined): string {
    return path.join(workspaceDataDir(this.dataRoot, workspaceDir), 'memories')
  }

  /** 全局记忆根目录（跨项目可见，但不会因为可见而自动注入全文）。 */
  globalMemoriesDir(): string {
    return path.join(this.dataRoot, 'plugins', 'memories')
  }

  /** 返回背景资料的实际作用域；SOUL.md 永远是全局文档。 */
  backgroundScope(kind: BackgroundDocKind, requested?: 'project' | 'global'): 'project' | 'global' {
    if (kind === 'soul') return 'global'
    return requested ?? 'project'
  }

  private backgroundPath(input: { workspaceDir?: string; kind: BackgroundDocKind; scope?: 'project' | 'global' }): { fileName: string; scope: 'project' | 'global'; full: string } {
    const fileName = BACKGROUND_DOC_FILES[input.kind]
    const scope = this.backgroundScope(input.kind, input.scope)
    const root = scope === 'global' ? this.globalMemoriesDir() : this.memoriesDir(input.workspaceDir)
    return { fileName, scope, full: path.join(root, fileName) }
  }

  /** 新笔记目录（公开：供 read_memory 等路径解析复用）。 */
  notesDirOf(workspaceDir: string | undefined): string {
    return path.join(this.memoriesDir(workspaceDir), 'notes')
  }

  /** 旧 Observation 目录（公开：兼容别名）。 */
  observationsDirOf(workspaceDir: string | undefined): string {
    return path.join(this.memoriesDir(workspaceDir), 'observations')
  }

  private draftsDir(workspaceDir: string | undefined): string {
    return path.join(this.memoriesDir(workspaceDir), 'drafts')
  }

  private indexFile(workspaceDir: string | undefined): string {
    return path.join(this.notesDirOf(workspaceDir), '.notes-index.json')
  }

  // ── 笔记 CRUD（NOTE-01/02/06）──────────────────────────────────────────────

  /**
   * 创建自由文本笔记（NOTE-01/02）：正文必需，标题可选；分类/实体/来源全部可省略
   * （本服务根本不接收这些字段）。有标题且正文首个非空行不是 H1 时，把标题写成
   * 正文首行 `# <title>`——笔记零 frontmatter，标题与正文完全由用户 Markdown 决定。
   */
  createNote(input: { workspaceDir?: string; title?: string; body: string }): NoteMeta {
    const title = String(input.title ?? '').trim()
    const body = String(input.body ?? '')
    if (body.trim().length === 0) throw new Error('笔记正文不能为空')
    const hasH1 = body.split(/\r?\n/).some((line) => /^#\s+\S/.test(line.trim()))
    const content = title && !hasH1 ? `# ${title}\n\n${body}` : body
    const notesRoot = this.notesDirOf(input.workspaceDir)
    fs.mkdirSync(notesRoot, { recursive: true })
    // 文件名 = slug + 短随机 id（稳定且不冲突，NOTE-01）
    const base = slugifyNote(title || body.slice(0, 40))
    let fileName = ''
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = randomUUID().replace(/-/g, '').slice(0, 8)
      const candidate = `${base}-${id}.md`
      if (!fs.existsSync(path.join(notesRoot, candidate))) {
        fileName = candidate
        break
      }
    }
    if (!fileName) throw new Error('无法生成不冲突的笔记文件名')
    const full = path.join(notesRoot, fileName)
    atomicWrite(full, content)
    const stat = fs.statSync(full)
    const parsed = parseFrontmatter(content)
    const index = this.loadIndex(input.workspaceDir)
    this.indexOneFile(index, { pathKey: path.posix.join('notes', fileName), absPath: full, fileName, source: 'note' })
    this.saveIndex(input.workspaceDir, index)
    return {
      noteId: fileName.slice(0, -3),
      fileName,
      title: titleOf(fileName, parsed.body),
      body: parsed.body,
      source: 'note',
      hasFrontmatter: false,
      updatedAt: stat.mtimeMs,
      byteSize: stat.size,
    }
  }

  /**
   * 写入（用户编辑）一条已有笔记：正文按原样落盘（NOTE-06 正文优先）。
   * 旧 Observation 文件保留原 frontmatter 块，只替换其后的正文（NOTE-04）。
   */
  writeNote(input: { workspaceDir?: string; noteId: string; body: string }): NoteMeta {
    const resolved = this.resolveNoteFile(input.workspaceDir, input.noteId)
    if (!resolved) throw new Error(`笔记不存在: ${input.noteId}`)
    const body = String(input.body ?? '')
    if (body.trim().length === 0) throw new Error('笔记正文不能为空')
    const current = readFileSafe(resolved.file) ?? ''
    const parsed = parseFrontmatter(current)
    const content = parsed.hasFrontmatter ? `${parsed.header}${body}` : body
    atomicWrite(resolved.file, content)
    const stat = fs.statSync(resolved.file)
    const index = this.loadIndex(input.workspaceDir)
    this.indexOneFile(index, {
      pathKey: path.relative(this.memoriesDir(input.workspaceDir), resolved.file).split(path.sep).join('/'),
      absPath: resolved.file,
      fileName: resolved.fileName,
      source: resolved.source,
      legacyDir: resolved.legacyDir,
    })
    this.saveIndex(input.workspaceDir, index)
    const fmTitle = typeof parsed.frontmatter['title'] === 'string' ? parsed.frontmatter['title'] : undefined
    return {
      noteId: resolved.fileName.slice(0, -3),
      fileName: resolved.fileName,
      title: titleOf(resolved.fileName, body, fmTitle),
      body,
      source: resolved.source,
      hasFrontmatter: parsed.hasFrontmatter,
      updatedAt: stat.mtimeMs,
      byteSize: stat.size,
    }
  }

  /** 删除一条笔记（新笔记或旧 Observation；同时清理索引条目）。 */
  deleteNote(input: { workspaceDir?: string; noteId: string }): { ok: boolean } {
    const resolved = this.resolveNoteFile(input.workspaceDir, input.noteId)
    if (!resolved) return { ok: false }
    fs.rmSync(resolved.file, { force: true })
    const index = this.loadIndex(input.workspaceDir)
    const key = path.relative(this.memoriesDir(input.workspaceDir), resolved.file).split(path.sep).join('/')
    if (index.files[key] !== undefined) {
      delete index.files[key]
      this.saveIndex(input.workspaceDir, index)
    }
    return { ok: true }
  }

  /**
   * 列出笔记（NOTE-01/03）：新笔记 + 旧 Observation（includeLegacy 默认 true，
   * 旧文件带 hasFrontmatter/legacyDir 供 UI 默认折叠）。最新优先，分页。
   */
  listNotes(input: {
    workspaceDir?: string
    includeLegacy?: boolean
    source?: NoteSource
    limit?: number
    offset?: number
  } = {}): NoteSummary[] {
    const summaries: NoteSummary[] = []
    if (input.source === undefined || input.source === 'note') {
      for (const rel of listMarkdownRelative(this.notesDirOf(input.workspaceDir), 1)) {
        const summary = this.summaryOf(input.workspaceDir, path.join(this.notesDirOf(input.workspaceDir), rel), path.posix.basename(rel), 'note', undefined)
        if (summary) summaries.push(summary)
      }
    }
    if ((input.source === undefined || input.source === 'observation') && input.includeLegacy !== false) {
      for (const rel of listMarkdownRelative(this.observationsDirOf(input.workspaceDir), 3)) {
        const summary = this.summaryOf(
          input.workspaceDir,
          path.join(this.observationsDirOf(input.workspaceDir), rel),
          path.posix.basename(rel),
          'observation',
          path.posix.dirname(rel),
        )
        if (summary) summaries.push(summary)
      }
    }
    summaries.sort((a, b) => b.updatedAt - a.updatedAt)
    const offset = Math.max(0, Math.trunc(input.offset ?? 0))
    const limit = Math.min(Math.trunc(input.limit ?? 200) || 200, 500)
    return summaries.slice(offset, offset + limit)
  }

  /** NOTE-03/04 兼容别名：只列旧 Observation（旧 API memoryObservations 语义）。 */
  listLegacyObservations(workspaceDir?: string): NoteSummary[] {
    return this.listNotes({ workspaceDir, source: 'observation' })
  }

  /** 读取一条笔记（长笔记按字符范围分页；旧文件 frontmatter 单独返回，默认折叠）。 */
  readNote(input: { workspaceDir?: string; noteId: string; offset?: number; limit?: number }): NoteReadResult {
    const resolved = this.resolveNoteFile(input.workspaceDir, input.noteId)
    if (!resolved) throw new Error(`笔记不存在: ${input.noteId}`)
    const content = readFileSafe(resolved.file) ?? ''
    const stat = fs.statSync(resolved.file)
    const parsed = parseFrontmatter(content)
    const body = parsed.body
    const offset = Math.max(0, Math.trunc(input.offset ?? 0))
    const limit = input.limit === undefined || input.limit <= 0 ? body.length : Math.trunc(input.limit)
    const slice = body.slice(offset, offset + limit)
    const fmTitle = typeof parsed.frontmatter['title'] === 'string' ? parsed.frontmatter['title'] : undefined
    return {
      noteId: resolved.fileName.slice(0, -3),
      fileName: resolved.fileName,
      title: titleOf(resolved.fileName, body, fmTitle),
      bodyPreview: previewOf(body),
      body: slice,
      totalLength: body.length,
      offset,
      nextOffset: offset + slice.length < body.length ? offset + slice.length : null,
      source: resolved.source,
      hasFrontmatter: parsed.hasFrontmatter,
      ...(resolved.legacyDir === undefined ? {} : { legacyDir: resolved.legacyDir }),
      ...(parsed.hasFrontmatter ? { frontmatter: parsed.frontmatter } : {}),
      updatedAt: stat.mtimeMs,
      byteSize: stat.size,
      paragraphCount: this.paragraphCountOf(input.workspaceDir, resolved.file, stat),
    }
  }

  // ── 段落索引（NOTE-05）─────────────────────────────────────────────────────

  /**
   * 重建索引（全部或指定笔记）：从 Markdown 文件重新切分段落。索引只是镜像，
   * 删除索引文件后调用本方法即可恢复，不依赖它作为唯一副本。
   */
  rebuildIndex(input: { workspaceDir?: string; noteIds?: string[] } = {}): { ok: boolean; indexed: number } {
    const index = this.loadIndex(input.workspaceDir)
    let indexed = 0
    const files = this.collectFiles(input.workspaceDir)
    const want = input.noteIds && input.noteIds.length > 0
      ? new Set(input.noteIds.map((id) => `${assertNoteId(id)}.md`))
      : undefined
    for (const file of files) {
      if (want && !want.has(file.fileName)) continue
      if (this.indexOneFile(index, file)) indexed += 1
    }
    if (want) {
      // 指定重建时，其余文件条目保留；仅移除已消失文件
      for (const key of Object.keys(index.files)) {
        if (!files.some((f) => f.pathKey === key)) delete index.files[key]
      }
    }
    this.saveIndex(input.workspaceDir, index)
    return { ok: true, indexed }
  }

  /** 删除索引文件（可随时重建；清空内存缓存）。 */
  clearIndex(input: { workspaceDir?: string } = {}): { ok: boolean } {
    const memories = this.memoriesDir(input.workspaceDir)
    this.indexCache.delete(memories)
    try {
      fs.rmSync(this.indexFile(input.workspaceDir), { force: true })
    } catch {
      // 忽略
    }
    return { ok: true }
  }

  /**
   * 段落级检索（NOTE-05）：先按 mtime+字节数指纹只重建被编辑过的文件索引，
   * 再对自然段做 token 子串匹配（支持中文连续串），按命中 token 数排序。
   */
  searchIndex(input: { workspaceDir?: string; query: string; limit?: number; noteIds?: string[] }): NoteSearchHit[] {
    this.refreshIndex(input.workspaceDir)
    const index = this.loadIndex(input.workspaceDir)
    const tokens = tokenizeQuery(input.query)
    if (tokens.length === 0) return []
    const allow = input.noteIds && input.noteIds.length > 0
      ? new Set(input.noteIds.map((id) => `${assertNoteId(id)}.md`))
      : undefined
    const hits: NoteSearchHit[] = []
    for (const entry of Object.values(index.files)) {
      if (allow && !allow.has(entry.fileName)) continue
      for (let i = 0; i < entry.paragraphs.length; i += 1) {
        const paragraph = entry.paragraphs[i]!
        const matched = tokens.filter((t) => paragraph.text.includes(t))
        if (matched.length === 0) continue
        hits.push({
          noteId: entry.fileName.slice(0, -3),
          fileName: entry.fileName,
          title: entry.title,
          source: entry.source,
          paragraphIndex: i,
          offset: paragraph.offset,
          snippet: snippetAround(paragraph.text, matched),
          score: matched.length,
          updatedAt: entry.updatedAt,
        })
      }
    }
    hits.sort((a, b) => b.score - a.score || a.paragraphIndex - b.paragraphIndex)
    const limit = Math.min(Math.trunc(input.limit ?? 20) || 20, 100)
    return hits.slice(0, limit)
  }

  /** 刷新索引：仅重建 mtime/字节数变化的文件，删除已消失文件的条目（NOTE-05）。 */
  refreshIndex(workspaceDir: string | undefined): { ok: boolean; changed: number } {
    const index = this.loadIndex(workspaceDir)
    const current = this.collectFiles(workspaceDir)
    const byKey = new Set(current.map((f) => f.pathKey))
    let changed = 0
    for (const file of current) {
      const entry = index.files[file.pathKey]
      let mtimeMs = 0
      let byteSize = 0
      try {
        const stat = fs.statSync(file.absPath)
        mtimeMs = stat.mtimeMs
        byteSize = stat.size
      } catch {
        continue
      }
      if (entry && entry.mtimeMs === mtimeMs && entry.byteSize === byteSize) continue
      if (this.indexOneFile(index, file)) changed += 1
    }
    for (const key of Object.keys(index.files)) {
      if (!byKey.has(key)) {
        delete index.files[key]
        changed += 1
      }
    }
    if (changed > 0) this.saveIndex(workspaceDir, index)
    return { ok: true, changed }
  }

  // ── 研究近况页与背景资料（NOTE-07/09）─────────────────────────────────────

  /** 读取背景资料（RESEARCH_MAP / USER_PROFILE / RESEARCH_TASTE / PROJECT_PROFILE）。 */
  readBackgroundDoc(input: { workspaceDir?: string; kind: BackgroundDocKind; scope?: 'project' | 'global' }): BackgroundDoc {
    const { fileName, scope, full } = this.backgroundPath(input)
    try {
      const stat = fs.statSync(full)
      if (!stat.isFile()) throw new Error('not a file')
      const content = fs.readFileSync(full, 'utf8')
      return { kind: input.kind, fileName, scope, exists: true, content, updatedAt: stat.mtimeMs, byteSize: stat.size }
    } catch {
      // NOTE-09：缺文件返回空且不报错
      return { kind: input.kind, fileName, scope, exists: false, content: '', updatedAt: 0, byteSize: 0 }
    }
  }

  /** 一次读齐全部背景资料（上下文组装用；缺失项为空，绝不阻塞聊天）。 */
  readAllBackgroundDocs(input: { workspaceDir?: string } = {}): Record<BackgroundDocKind, BackgroundDoc> {
    return {
      researchMap: this.readBackgroundDoc({ ...input, kind: 'researchMap' }),
      soul: this.readBackgroundDoc({ ...input, kind: 'soul', scope: 'global' }),
      userProfile: this.readBackgroundDoc({ ...input, kind: 'userProfile' }),
      researchTaste: this.readBackgroundDoc({ ...input, kind: 'researchTaste' }),
      projectProfile: this.readBackgroundDoc({ ...input, kind: 'projectProfile' }),
    }
  }

  /** 直接写入背景资料（仅用户确认过的编辑入口；AI 路径请走 updateDraft）。 */
  writeBackgroundDoc(input: { workspaceDir?: string; kind: BackgroundDocKind; content: string; scope?: 'project' | 'global' }): { ok: boolean; fileName: string; scope: 'project' | 'global' } {
    const { fileName, scope, full } = this.backgroundPath(input)
    const dir = path.dirname(full)
    fs.mkdirSync(dir, { recursive: true })
    atomicWrite(full, String(input.content ?? ''))
    return { ok: true, fileName, scope }
  }

  // ── 草稿 → 确认（NOTE-08）──────────────────────────────────────────────────

  /**
   * 生成局部更新草稿：只落盘草稿文件，绝不触碰目标文件（AI 用此入口提出修改）。
   * 记录创建时目标文件的 baseHash，应用时校验冲突，防止静默整体覆盖用户文字。
   */
  updateDraft(input: { workspaceDir?: string; kind: BackgroundDocKind; draft: string; note?: string; scope?: 'project' | 'global' }): DraftMeta {
    const { fileName, scope, full: target } = this.backgroundPath(input)
    const baseHash = fs.existsSync(target) ? hashOf(readFileSafe(target) ?? '') : null
    const draftId = randomUUID().replace(/-/g, '').slice(0, 12)
    const createdAt = Date.now()
    const meta: DraftMeta = {
      draftId,
      kind: input.kind,
      fileName,
      note: String(input.note ?? ''),
      baseHash,
      targetExisted: baseHash !== null,
      createdAt,
    }
    const draftDir = path.join(scope === 'global' ? this.globalMemoriesDir() : this.memoriesDir(input.workspaceDir), 'drafts')
    fs.mkdirSync(draftDir, { recursive: true })
    atomicWrite(path.join(draftDir, `${fileName}.${draftId}.json`), JSON.stringify({ ...meta, draft: String(input.draft ?? '') }, null, 2))
    return meta
  }

  /** 列出草稿（按创建时间倒序；不含正文，预览请 readDraft）。 */
  listDrafts(input: { workspaceDir?: string; kind?: BackgroundDocKind; scope?: 'project' | 'global' } = {}): DraftMeta[] {
    const dir = input.scope === 'global' ? path.join(this.globalMemoriesDir(), 'drafts') : this.draftsDir(input.workspaceDir)
    const out: DraftMeta[] = []
    for (const entry of readdirSafe(dir)) {
      if (!entry.endsWith('.json')) continue
      const doc = this.parseDraftFile(path.join(dir, entry))
      if (!doc) continue
      if (input.kind !== undefined && doc.kind !== input.kind) continue
      out.push(this.toDraftMeta(doc))
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  }

  /** 读取草稿全文（AI 修改预览 / UI 展示用）。 */
  readDraft(input: { workspaceDir?: string; draftId: string; scope?: 'project' | 'global' }): DraftDocument {
    const file = input.scope === 'global'
      ? this.findDraftFile(path.join(this.globalMemoriesDir(), 'drafts'), input.draftId)
      : this.draftFile(input.workspaceDir, input.draftId)
    const doc = file ? this.parseDraftFile(file) : undefined
    if (!doc) throw new Error(`草稿不存在: ${input.draftId}`)
    return doc
  }

  /**
   * 应用草稿（用户确认后的唯一写入入口）。目标文件在草稿创建后若被改动 →
   * 返回 conflict 拒绝覆盖（force 显式确认除外）。
   */
  applyDraft(input: { workspaceDir?: string; draftId: string; force?: boolean; scope?: 'project' | 'global' }): DraftApplyResult {
    const file = input.scope === 'global'
      ? this.findDraftFile(path.join(this.globalMemoriesDir(), 'drafts'), input.draftId)
      : this.draftFile(input.workspaceDir, input.draftId)
    const doc = file ? this.parseDraftFile(file) : undefined
    if (!file || !doc) return { ok: false, error: `草稿不存在: ${input.draftId}` }
    if (!(Object.values(BACKGROUND_DOC_FILES) as readonly string[]).includes(doc.fileName)) {
      return { ok: false, error: `非法草稿目标: ${doc.fileName}` }
    }
    const target = path.join(input.scope === 'global' ? this.globalMemoriesDir() : this.memoriesDir(input.workspaceDir), doc.fileName)
    const currentHash = fs.existsSync(target) ? hashOf(readFileSafe(target) ?? '') : null
    if (currentHash !== doc.baseHash && input.force !== true) {
      return {
        ok: false,
        conflict: true,
        error: '目标文件在草稿创建后已被修改：请先读取最新内容确认，或显式 force 覆盖',
      }
    }
    const dir = path.dirname(target)
    fs.mkdirSync(dir, { recursive: true })
    atomicWrite(target, doc.draft)
    fs.rmSync(file, { force: true })
    return { ok: true, target: doc.fileName }
  }

  /** 丢弃草稿（不触碰目标文件）。 */
  discardDraft(input: { workspaceDir?: string; draftId: string; scope?: 'project' | 'global' }): { ok: boolean } {
    const file = input.scope === 'global'
      ? this.findDraftFile(path.join(this.globalMemoriesDir(), 'drafts'), input.draftId)
      : this.draftFile(input.workspaceDir, input.draftId)
    if (file) fs.rmSync(file, { force: true })
    return { ok: true }
  }

  // ── 内部实现 ───────────────────────────────────────────────────────────────

  /** 收集当前全部笔记文件（新笔记 + 旧 Observation，递归深度受限）。
   * pathKey 统一为相对 memories 根的 / 分隔路径（'notes/x.md'、'observations/global/O.md'），
   * 与 createNote/writeNote/deleteNote/paragraphCountOf 写入索引的 key 完全一致，
   * 保证 refreshIndex 的 mtime+size 指纹比对只重建真正被编辑的文件（NOTE-05）。 */
  private collectFiles(workspaceDir: string | undefined): Array<{
    pathKey: string
    absPath: string
    fileName: string
    source: NoteSource
    legacyDir?: string
  }> {
    const out: Array<{ pathKey: string; absPath: string; fileName: string; source: NoteSource; legacyDir?: string }> = []
    const memories = this.memoriesDir(workspaceDir)
    const notesRoot = this.notesDirOf(workspaceDir)
    for (const rel of listMarkdownRelative(notesRoot, 1)) {
      const absPath = path.join(notesRoot, rel)
      out.push({ pathKey: path.relative(memories, absPath).split(path.sep).join('/'), absPath, fileName: path.posix.basename(rel), source: 'note' })
    }
    const obsRoot = this.observationsDirOf(workspaceDir)
    for (const rel of listMarkdownRelative(obsRoot, 3)) {
      const absPath = path.join(obsRoot, rel)
      out.push({
        pathKey: path.relative(memories, absPath).split(path.sep).join('/'),
        absPath,
        fileName: path.posix.basename(rel),
        source: 'observation',
        legacyDir: path.posix.dirname(rel),
      })
    }
    return out
  }

  /** 重建单个文件的索引条目；返回是否发生重建。 */
  private indexOneFile(
    index: NotesIndexFile,
    file: { pathKey: string; absPath: string; fileName: string; source: NoteSource; legacyDir?: string },
  ): boolean {
    let stat: fs.Stats
    try {
      stat = fs.statSync(file.absPath)
    } catch {
      return false
    }
    if (!stat.isFile()) return false
    const content = readFileSafe(file.absPath)
    if (content === null) return false
    const parsed = parseFrontmatter(content)
    const fmTitle = typeof parsed.frontmatter['title'] === 'string' ? parsed.frontmatter['title'] : undefined
    const paragraphs = stat.size > MAX_INDEX_FILE_BYTES ? [] : splitParagraphs(parsed.body)
    index.files[file.pathKey] = {
      pathKey: file.pathKey,
      fileName: file.fileName,
      source: file.source,
      ...(file.legacyDir === undefined ? {} : { legacyDir: file.legacyDir }),
      title: titleOf(file.fileName, parsed.body, fmTitle),
      hash: hashOf(content),
      mtimeMs: stat.mtimeMs,
      byteSize: stat.size,
      updatedAt: stat.mtimeMs,
      paragraphs,
      links: extractLinkHints(parsed.body),
    }
    return true
  }

  /** 列表摘要（只读文件头，避免整读超大文件）。 */
  private summaryOf(
    workspaceDir: string | undefined,
    file: string,
    fileName: string,
    source: NoteSource,
    legacyDir: string | undefined,
  ): NoteSummary | undefined {
    let stat: fs.Stats
    try {
      stat = fs.statSync(file)
    } catch {
      return undefined
    }
    if (!stat.isFile()) return undefined
    const head = readHeadSafe(file, 64 * 1024)
    if (head === null) return undefined
    const parsed = parseFrontmatter(head)
    const fmTitle = typeof parsed.frontmatter['title'] === 'string' ? parsed.frontmatter['title'] : undefined
    return {
      noteId: fileName.slice(0, -3),
      fileName,
      title: titleOf(fileName, parsed.body, fmTitle),
      bodyPreview: previewOf(parsed.body),
      source,
      hasFrontmatter: parsed.hasFrontmatter,
      ...(legacyDir === undefined ? {} : { legacyDir }),
      updatedAt: stat.mtimeMs,
      byteSize: stat.size,
      paragraphCount: this.paragraphCountOf(workspaceDir, file, stat),
    }
  }

  /** 段落数（索引缓存命中且指纹一致时返回；否则 0，不强制刷新）。 */
  private paragraphCountOf(workspaceDir: string | undefined, absPath: string, stat: fs.Stats): number {
    const index = this.loadIndex(workspaceDir)
    const key = path.relative(this.memoriesDir(workspaceDir), absPath).split(path.sep).join('/')
    const entry = index.files[key]
    if (entry && entry.mtimeMs === stat.mtimeMs) return entry.paragraphs.length
    return 0
  }

  /** 加载索引（内存缓存 + 磁盘 JSON；损坏/缺失视为空索引）。 */
  private loadIndex(workspaceDir: string | undefined): NotesIndexFile {
    const cacheKey = this.memoriesDir(workspaceDir)
    const cached = this.indexCache.get(cacheKey)
    if (cached) return cached
    let index: NotesIndexFile = { version: 1, files: {} }
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexFile(workspaceDir), 'utf8')) as Partial<NotesIndexFile>
      if (raw?.version === 1 && typeof raw.files === 'object' && raw.files !== null) {
        index = { version: 1, files: raw.files as Record<string, IndexEntry> }
      }
    } catch {
      // 无索引或损坏：重建
    }
    this.indexCache.set(cacheKey, index)
    return index
  }

  /** 保存索引（原子写 + 更新缓存）。 */
  private saveIndex(workspaceDir: string | undefined, index: NotesIndexFile): void {
    fs.mkdirSync(path.dirname(this.indexFile(workspaceDir)), { recursive: true })
    atomicWrite(this.indexFile(workspaceDir), JSON.stringify(index, null, 2))
    this.indexCache.set(this.memoriesDir(workspaceDir), index)
  }

  /** 按 noteId 解析文件（新笔记目录优先，其次旧 observations 递归；路径双重护栏）。 */
  private resolveNoteFile(
    workspaceDir: string | undefined,
    noteId: string,
  ): { file: string; fileName: string; source: NoteSource; legacyDir?: string } | undefined {
    const id = assertNoteId(noteId)
    const fileName = `${id}.md`
    const notesRoot = this.notesDirOf(workspaceDir)
    const direct = path.join(notesRoot, fileName)
    if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
      return { file: direct, fileName, source: 'note' }
    }
    const obsRoot = this.observationsDirOf(workspaceDir)
    const obsRootResolved = path.resolve(obsRoot)
    for (const rel of listMarkdownRelative(obsRoot, 3)) {
      if (path.posix.basename(rel) !== fileName) continue
      const full = path.resolve(obsRoot, rel)
      if (normPath(full).startsWith(normPath(obsRootResolved) + path.sep)) {
        return { file: full, fileName, source: 'observation', legacyDir: path.posix.dirname(rel) }
      }
    }
    return undefined
  }

  /** 按 draftId 定位草稿文件（仅允许 12 位 hex，防止路径穿越）。 */
  private draftFile(workspaceDir: string | undefined, draftId: string): string | undefined {
    if (!/^[a-f0-9]{12}$/.test(String(draftId ?? ''))) return undefined
    const dir = this.draftsDir(workspaceDir)
    return this.findDraftFile(dir, draftId)
  }

  /** 在指定 drafts 目录查找草稿；目录由调用方选择 project/global。 */
  private findDraftFile(dir: string, draftId: string): string | undefined {
    if (!/^[a-f0-9]{12}$/.test(String(draftId ?? ''))) return undefined
    for (const entry of readdirSafe(dir)) {
      if (entry.endsWith(`.${draftId}.json`)) return path.join(dir, entry)
    }
    return undefined
  }

  /** 解析草稿 JSON（损坏返回 undefined）。 */
  private parseDraftFile(file: string): DraftDocument | undefined {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
      const kind = String(raw['kind'] ?? '')
      if (!(kind in BACKGROUND_DOC_FILES)) return undefined
      return {
        draftId: String(raw['draftId'] ?? ''),
        kind: kind as BackgroundDocKind,
        fileName: String(raw['fileName'] ?? BACKGROUND_DOC_FILES[kind as BackgroundDocKind]),
        note: String(raw['note'] ?? ''),
        baseHash: typeof raw['baseHash'] === 'string' ? raw['baseHash'] : null,
        targetExisted: raw['targetExisted'] === true,
        createdAt: typeof raw['createdAt'] === 'number' ? raw['createdAt'] : 0,
        draft: String(raw['draft'] ?? ''),
      }
    } catch {
      return undefined
    }
  }

  private toDraftMeta(doc: DraftDocument): DraftMeta {
    return {
      draftId: doc.draftId,
      kind: doc.kind,
      fileName: doc.fileName,
      note: doc.note,
      baseHash: doc.baseHash,
      targetExisted: doc.targetExisted,
      createdAt: doc.createdAt,
    }
  }
}
