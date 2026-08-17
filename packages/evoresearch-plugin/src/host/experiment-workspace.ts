/**
 * 实验工作区服务（§7 自由形式的实验管理；§15.7 EXP-02/03/04）。
 *
 * 与旧版 ExperimentService（manifest/phase/checkpoint/snapshot）并存：
 * - ExperimentService（host/experiments.ts）= 旧时间线（分支/阶段/检查点/快照），
 *   本服务不读取、不修改、不删除其任何数据；
 * - ExperimentWorkspaceService = 新体验：实验 = 项目下的一个自由目录 + LAB_NOTE.md。
 *
 * 目录布局选择（EXP-02）：
 * - 实验目录：<project>/experiments/<slug>/（用户可见，随项目一起迁移/备份）
 *   理由：§7.1 用户看到的是「实验目录 + LAB_NOTE.md + stdout.log + artifacts/」
 *   这类自然材料；放进 .evoresearch-data/ 会被 git exclude 且藏在内部数据目录，
 *   不符合自由笔记体验。旧 manifest 仍留在 <ws>/.evoresearch-data/experiments/
 *   <id>.json，两套命名空间互不冲突。
 * - 导入引用记录（侧车文件）：<expDir>/.evoresearch-import.json，随实验目录
 *   一起移动/复制，不依赖中心索引（目录即真相，零固定结构）。
 *
 * 设计取舍（EXP-04，引用优先）：
 * - importExisting 默认 mode=reference：只记录来源路径，不移动/复制任何文件。
 *   + 不占额外磁盘；来源目录原地更新时实验视图实时反映；
 *   - 来源被移动/删除后引用失效（listContents 返回 missingSource，不伪造内容）。
 * - copy 模式可选（opts.copy=true）：把来源目录复制进实验目录（跳过可重建目录），
 *   实验自包含、可在来源删除后继续查看，但占磁盘。
 *
 * 零固定字段（EXP-03）：LAB_NOTE.md 只是创建时的自然语言模板引导，任何 Markdown
 * 均可；readNote/writeNote 整文件读写，不解析 frontmatter、不解析任何字段；
 * 新实验不自动创建 phase-0（阶段/检查点属于旧时间线，是可选的整理工具）。
 *
 * EXP-09 补充：appendNote() 是「用户或 Agent 用自然语言补充实验解释」的追加入口
 * （只追加，绝不覆盖已有正文）；artifacts() 列出约定产物目录 artifacts/ 的树。
 *
 * EXP-12（§7.6）：实验运行期间不设置任何状态门禁——论文编辑/编译、其他聊天在
 * 实验 running 时完全可用；本服务与 host/experiment-process.ts 均不因实验状态
 * 拒绝任何读/写/编辑操作，状态只用于展示、复盘与进程管理。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  isValidProjectName,
  normPath,
  projectDir,
  slugifyProjectName,
  validateWorkspace,
} from './core/paths.js'

/** 实验目录集合名（<workspace>/experiments/）。 */
const EXP_DIR_NAME = 'experiments'
/** 实验笔记文件名。 */
const NOTE_NAME = 'LAB_NOTE.md'
/** 约定产物目录名（§7.1：artifacts/ 放图表、模型、结果文件）。 */
const ARTIFACTS_DIR_NAME = 'artifacts'
/** 导入引用侧车文件名（位于实验目录内）。 */
const SIDECAR_NAME = '.evoresearch-import.json'
/** 树列表默认最大深度 / 最大条目数（防止外部大目录拖垮接口）。 */
const TREE_MAX_DEPTH = 6
const TREE_MAX_ITEMS = 2000
/** 复制模式跳过的可重建/体积大目录。 */
const COPY_SKIP_DIRS = new Set(['.git', '.venv', 'node_modules', '.next', 'dist', '__pycache__', '.pytest_cache', '.ruff_cache'])

/** 工作区服务配置。 */
export interface ExperimentWorkspaceConfig {
  /** 部署根目录（projects/ 所在目录）。 */
  readonly dataRoot: string
}

/** 导入引用记录（侧车文件内容）。 */
export interface ExperimentWorkspaceSource {
  /** 来源目录绝对路径。 */
  readonly sourcePath: string
  /** reference=只记录引用（默认）；copy=已复制进实验目录。 */
  readonly mode: 'reference' | 'copy'
  readonly importedAt: number
}

/** 实验工作区摘要（列表项）。 */
export interface ExperimentWorkspaceInfo {
  /** 实验目录名（唯一标识；允许任意单段目录名，含手工创建的目录）。 */
  readonly slug: string
  /** 实验目录绝对路径。 */
  readonly dir: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly hasNote: boolean
  readonly noteBytes: number
  /** 导入引用记录（非导入实验为 null）。 */
  readonly source: ExperimentWorkspaceSource | null
}

/** 实验工作区详情（= 摘要；预留扩展位）。 */
export type ExperimentWorkspaceDetail = ExperimentWorkspaceInfo

/** 目录树条目（EXP-04）。 */
export interface ExperimentWorkspaceEntry {
  readonly name: string
  /** 相对根目录的路径（正斜杠）。 */
  readonly relPath: string
  readonly type: 'dir' | 'file' | 'symlink'
  /** 文件字节数（dir/symlink 为 0）。 */
  readonly size: number
  readonly children?: readonly ExperimentWorkspaceEntry[]
}

/** 目录树结果（EXP-04）。 */
export interface ExperimentWorkspaceTree {
  /** 实验目录绝对路径。 */
  readonly root: string
  /** reference 模式下列表实际来源于该来源目录（否则为 null）。 */
  readonly sourcePath: string | null
  /** 引用来源已不可访问（不伪造内容）。 */
  readonly missingSource: boolean
  readonly entries: readonly ExperimentWorkspaceEntry[]
  readonly dirs: number
  readonly files: number
  readonly totalBytes: number
  /** 达到 maxItems/depth 上限被截断。 */
  readonly truncated: boolean
}

/** 实验工作区服务。 */
export class ExperimentWorkspaceService {
  constructor(readonly config: ExperimentWorkspaceConfig) {}

  // ── 路径与校验 ──────────────────────────────────────────────────────────

  /** 工作区 = 部署根 或 projects/<name> 项目目录（读方法允许两者）。 */
  private assertWorkspace(workspaceDir: string): string {
    const v = validateWorkspace(this.config.dataRoot, workspaceDir)
    return v.kind === 'project' ? v.path : path.resolve(this.config.dataRoot)
  }

  /**
   * 解析 project 参数（createWorkspace/importExisting 专用）：
   * 接受项目名或项目目录绝对路径；必须已存在且是项目目录。
   */
  private resolveProject(project: string): string {
    const p = String(project ?? '').trim()
    if (p === '') throw new Error('缺少项目名')
    if (path.isAbsolute(p) || p.includes('/') || p.includes('\\') || p.startsWith('.')) {
      const v = validateWorkspace(this.config.dataRoot, p)
      if (v.kind !== 'project') throw new Error(`实验工作区需要项目目录: ${p}`)
      return v.path
    }
    if (!isValidProjectName(p)) throw new Error(`非法的项目名: ${p}`)
    const dir = projectDir(this.config.dataRoot, p)
    if (!fs.existsSync(dir)) throw new Error(`项目不存在: ${p}`)
    return dir
  }

  private experimentsRootOf(workspaceDir: string): string {
    return path.join(this.assertWorkspace(workspaceDir), EXP_DIR_NAME)
  }

  /** 实验目录名安全校验：任意单段名（含中文/手工目录），仅防路径穿越。 */
  private assertSlug(slug: string): string {
    const s = String(slug ?? '')
    if (s === '' || s === '.' || s === '..' || s.includes('/') || s.includes('\\') || s.includes('\0')) {
      throw new Error(`非法的实验目录名: ${slug}`)
    }
    return s
  }

  /** 名称 → 目录名 slug（ASCII，≤40 字符；无字母数字时回退时间戳）。 */
  private slugify(name: string): string {
    const slug = slugifyProjectName(name, 40)
    if (slug === 'project' && !/[a-z0-9]/.test(name)) return `exp-${Date.now().toString(36)}`
    return slug
  }

  /** 碰撞追加数字后缀（不复用已有实验目录）。 */
  private uniqueSlug(root: string, base: string): string {
    if (!fs.existsSync(path.join(root, base))) return base
    let n = 2
    while (fs.existsSync(path.join(root, `${base}-${n}`))) n += 1
    return `${base}-${n}`
  }

  // ── 侧车与元数据 ────────────────────────────────────────────────────────

  private sidecarFile(dir: string): string {
    return path.join(dir, SIDECAR_NAME)
  }

  private readSidecar(dir: string): ExperimentWorkspaceSource | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.sidecarFile(dir), 'utf8')) as Partial<ExperimentWorkspaceSource>
      if (typeof raw?.sourcePath !== 'string' || (raw.mode !== 'reference' && raw.mode !== 'copy')) return null
      return {
        sourcePath: raw.sourcePath,
        mode: raw.mode,
        importedAt: typeof raw.importedAt === 'number' ? raw.importedAt : 0,
      }
    } catch {
      return null
    }
  }

  private writeSidecar(dir: string, record: ExperimentWorkspaceSource): void {
    const file = this.sidecarFile(dir)
    const tmp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  }

  private infoOf(dir: string, slug: string): ExperimentWorkspaceInfo {
    const stat = fs.statSync(dir)
    let hasNote = false
    let noteBytes = 0
    const note = path.join(dir, NOTE_NAME)
    try {
      const ns = fs.statSync(note)
      hasNote = ns.isFile()
      noteBytes = ns.size
    } catch {
      // 笔记不存在或不可读
    }
    return {
      slug,
      dir,
      createdAt: stat.birthtimeMs || stat.ctimeMs,
      updatedAt: stat.mtimeMs,
      hasNote,
      noteBytes,
      source: this.readSidecar(dir),
    }
  }

  // ── 创建 / 导入（EXP-02）───────────────────────────────────────────────

  /**
   * 在项目下创建实验目录：<project>/experiments/<slug>/ + 自由格式 LAB_NOTE.md。
   * 不创建 phase-0、不写 manifest、不要求任何表单字段。
   * @param project 项目名 或 项目目录绝对路径（须已存在）。
   * @param name 实验显示名（用于 slug 与笔记模板标题）。
   */
  createWorkspace(project: string, name: string): ExperimentWorkspaceInfo {
    const ws = this.resolveProject(project)
    const root = path.join(ws, EXP_DIR_NAME)
    fs.mkdirSync(root, { recursive: true })
    const trimmed = String(name ?? '').trim()
    if (trimmed === '') throw new Error('实验名称不能为空')
    const slug = this.uniqueSlug(root, this.slugify(trimmed))
    const dir = path.join(root, slug)
    fs.mkdirSync(dir, { recursive: true })
    const note = path.join(dir, NOTE_NAME)
    if (!fs.existsSync(note)) fs.writeFileSync(note, noteTemplate(trimmed), 'utf8')
    return this.infoOf(dir, slug)
  }

  /**
   * 把已有日志/结果目录加入项目实验视图（EXP-04）。
   * 默认 mode=reference：只记录来源路径，不移动/不复制文件；
   * opts.copy=true 时复制目录树进实验目录（跳过可重建目录）。
   * 引用失效（来源被移动/删除）时 listContents 返回 missingSource，不伪造内容。
   */
  importExisting(project: string, sourceDir: string, opts?: { name?: string; copy?: boolean }): ExperimentWorkspaceInfo {
    const ws = this.resolveProject(project)
    const root = path.join(ws, EXP_DIR_NAME)
    const source = path.resolve(String(sourceDir ?? ''))
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
      throw new Error(`源目录不存在或不是文件夹: ${sourceDir}`)
    }
    // 自引用/嵌套防护：项目根、实验视图内、项目数据目录内均拒绝
    if (normPath(source) === normPath(ws)) throw new Error('不能把项目根目录本身作为实验导入')
    if (isInside(source, root)) throw new Error(`源目录已在实验视图内: ${source}`)
    if (isInside(source, path.join(ws, '.evoresearch-data'))) throw new Error(`源目录位于项目数据目录内: ${source}`)
    fs.mkdirSync(root, { recursive: true })
    const base = typeof opts?.name === 'string' && opts.name.trim() !== '' ? opts.name.trim() : path.basename(source)
    const slug = this.uniqueSlug(root, this.slugify(base))
    const dir = path.join(root, slug)
    fs.mkdirSync(dir, { recursive: true })
    const mode: 'reference' | 'copy' = opts?.copy === true ? 'copy' : 'reference'
    if (mode === 'copy') copyTree(source, dir)
    this.writeSidecar(dir, { sourcePath: source, mode, importedAt: Date.now() })
    const note = path.join(dir, NOTE_NAME)
    if (!fs.existsSync(note)) fs.writeFileSync(note, importNoteTemplate(base, source, mode), 'utf8')
    return this.infoOf(dir, slug)
  }

  // ── 读取（EXP-02/03/04）────────────────────────────────────────────────

  /** 列出工作区全部实验目录（任意目录即实验，零固定结构；按更新时间倒序）。 */
  list(workspaceDir: string): ExperimentWorkspaceInfo[] {
    const root = this.experimentsRootOf(workspaceDir)
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      return []
    }
    const out: ExperimentWorkspaceInfo[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        out.push(this.infoOf(path.join(root, entry.name), entry.name))
      } catch {
        // 跳过不可读目录
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** 实验详情（目录不存在或非法名抛错）。 */
  listDetail(workspaceDir: string, slug: string): ExperimentWorkspaceDetail {
    const root = this.experimentsRootOf(workspaceDir)
    const s = this.assertSlug(slug)
    const dir = path.join(root, s)
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`实验不存在: ${slug}`)
    return this.infoOf(dir, s)
  }

  /** 读取 LAB_NOTE.md 原文（整文件，不解析 frontmatter/字段）。 */
  readNote(workspaceDir: string, slug: string): string {
    const detail = this.listDetail(workspaceDir, slug)
    const note = path.join(detail.dir, NOTE_NAME)
    if (!fs.existsSync(note)) throw new Error(`实验笔记不存在: ${slug}`)
    return fs.readFileSync(note, 'utf8')
  }

  /**
   * 写 LAB_NOTE.md：默认整文件替换；append=true 时只追加（不解析内容）。
   * 纯文件操作，不解析 frontmatter、不校验任何字段。
   */
  writeNote(workspaceDir: string, slug: string, content: string, opts?: { append?: boolean }): { ok: true; bytes: number } {
    const detail = this.listDetail(workspaceDir, slug)
    const note = path.join(detail.dir, NOTE_NAME)
    const text = String(content ?? '')
    if (opts?.append === true) {
      fs.appendFileSync(note, text, 'utf8')
    } else {
      const tmp = `${note}.tmp-${process.pid}`
      fs.writeFileSync(tmp, text, 'utf8')
      fs.renameSync(tmp, note)
    }
    return { ok: true, bytes: fs.statSync(note).size }
  }

  /**
   * 追加自然语言实验解释（EXP-09/EXP-10）：只追加、绝不覆盖已有正文。
   * @param text 追加的 Markdown 文本（可含复盘/说明）。
   * @param opts.heading 可选：非空时先写一行「## <heading>（yyyy-mm-dd HH:MM）」，
   *   再追加正文（复盘草稿经用户确认后即经此入口落笔记）。
   */
  appendNote(workspaceDir: string, slug: string, text: string, opts?: { heading?: string }): { ok: true; bytes: number } {
    const content = String(text ?? '')
    const heading = String(opts?.heading ?? '').trim()
    const block = heading === ''
      ? content
      : `\n## ${heading}（${formatStamp(Date.now())}）\n\n${content}`
    return this.writeNote(workspaceDir, slug, block, { append: true })
  }

  /**
   * 删除一次科学循环追加的标记块（SCI-09）。只接受由调用方生成的
   * marker，不按自然语言猜测要删哪一段；因此用户手工文字和其它循环的
   * 追加内容不会被误删。找不到 marker 时返回 ok=false，原文保持不变。
   */
  rollbackNoteAppend(workspaceDir: string, slug: string, marker: string): { ok: boolean; bytes?: number; error?: string } {
    const detail = this.listDetail(workspaceDir, slug)
    const note = path.join(detail.dir, NOTE_NAME)
    const startMarker = String(marker ?? '').trim()
    if (startMarker === '' || startMarker.length > 200 || !/^<!--\s*evoresearch-loop:[^>]+-->$/.test(startMarker)) {
      return { ok: false, error: '非法循环追加标记' }
    }
    const endMarker = startMarker.replace(/\s*-->$/, ' /-->')
    const original = fs.readFileSync(note, 'utf8')
    const start = original.indexOf(startMarker)
    if (start < 0) return { ok: false, error: '找不到循环追加标记，未修改实验笔记' }
    const end = original.indexOf(endMarker, start + startMarker.length)
    if (end < 0) return { ok: false, error: '循环追加块缺少结束标记，未修改实验笔记' }
    let from = start
    if (from > 0 && original[from - 1] === '\n') from -= 1
    let to = end + endMarker.length
    if (original[to] === '\r' && original[to + 1] === '\n') to += 2
    else if (original[to] === '\n') to += 1
    const next = `${original.slice(0, from)}${original.slice(to)}`
    const tmp = `${note}.rollback-${process.pid}-${Date.now().toString(36)}`
    fs.writeFileSync(tmp, next, 'utf8')
    try {
      fs.renameSync(tmp, note)
    } catch (error) {
      try { fs.rmSync(tmp, { force: true }) } catch { /* best effort cleanup */ }
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    return { ok: true, bytes: Buffer.byteLength(next, 'utf8') }
  }

  /** 约定产物目录名。 */
  artifactDirName(): string {
    return ARTIFACTS_DIR_NAME
  }

  /**
   * 列出实验产物目录 artifacts/ 的树（EXP-09；目录不存在时 exists=false 空树）。
   * 脚本/Agent 把图表、模型、结果文件写进 artifacts/ 后即可在实验视图展示。
   */
  artifacts(workspaceDir: string, slug: string): { dir: string; exists: boolean; entries: ExperimentWorkspaceEntry[]; dirs: number; files: number; totalBytes: number } {
    const detail = this.listDetail(workspaceDir, slug)
    const dir = path.join(detail.dir, ARTIFACTS_DIR_NAME)
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return { dir, exists: false, entries: [], dirs: 0, files: 0, totalBytes: 0 }
    }
    const state = { items: 0, dirs: 0, files: 0, bytes: 0, truncated: false }
    const entries = walkTree(dir, dir, TREE_MAX_DEPTH, TREE_MAX_ITEMS, state)
    return { dir, exists: true, entries, dirs: state.dirs, files: state.files, totalBytes: state.bytes }
  }

  /**
   * 实验目录树列表（EXP-04）：reference 导入列出来源目录的实时内容；
   * 其余列出实验目录自身。跳过 .git，深度/条目数有上限。
   */
  listContents(workspaceDir: string, slug: string, opts?: { depth?: number; maxItems?: number }): ExperimentWorkspaceTree {
    const detail = this.listDetail(workspaceDir, slug)
    const source = detail.source
    const walkRoot = source !== null && source.mode === 'reference' ? source.sourcePath : detail.dir
    const depth = clampInt(opts?.depth, 1, 12, TREE_MAX_DEPTH)
    const maxItems = clampInt(opts?.maxItems, 1, 10000, TREE_MAX_ITEMS)
    const state = { items: 0, dirs: 0, files: 0, bytes: 0, truncated: false }
    let entries: ExperimentWorkspaceEntry[] = []
    let missingSource = false
    if (!fs.existsSync(walkRoot) || !fs.statSync(walkRoot).isDirectory()) {
      missingSource = true
    } else {
      entries = walkTree(walkRoot, walkRoot, depth, maxItems, state)
    }
    return {
      root: detail.dir,
      sourcePath: source !== null && source.mode === 'reference' ? source.sourcePath : null,
      missingSource,
      entries,
      dirs: state.dirs,
      files: state.files,
      totalBytes: state.bytes,
      truncated: state.truncated,
    }
  }
}

/** 规范化后判断 a 是否位于 b 内（含等于 b 本身）。 */
function isInside(a: string, b: string): boolean {
  const na = normPath(a)
  const nb = normPath(b)
  return na === nb || na.startsWith(nb.endsWith(path.sep) ? nb : `${nb}${path.sep}`)
}

/** 数值夹取（undefined → 默认值）。 */
function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

/** 本地时间戳（yyyy-mm-dd HH:MM），用于笔记追加标题。 */
function formatStamp(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 递归收集目录树（.git 跳过；达到上限截断）。 */
function walkTree(
  root: string,
  dir: string,
  depth: number,
  maxItems: number,
  state: { items: number; dirs: number; files: number; bytes: number; truncated: boolean },
): ExperimentWorkspaceEntry[] {
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: ExperimentWorkspaceEntry[] = []
  for (const entry of entries) {
    if (state.truncated) break
    if (state.items >= maxItems) {
      state.truncated = true
      break
    }
    if (entry.isDirectory() && entry.name === '.git') continue
    const full = path.join(dir, entry.name)
    const rel = path.relative(root, full).split(path.sep).join('/')
    state.items += 1
    if (entry.isDirectory()) {
      state.dirs += 1
      const children = depth > 1 ? walkTree(root, full, depth - 1, maxItems, state) : []
      out.push({ name: entry.name, relPath: rel, type: 'dir', size: 0, children })
    } else if (entry.isSymbolicLink()) {
      state.files += 1
      out.push({ name: entry.name, relPath: rel, type: 'symlink', size: 0 })
    } else if (entry.isFile()) {
      state.files += 1
      let size = 0
      try {
        size = fs.statSync(full).size
      } catch {
        // 不可读按 0 字节
      }
      state.bytes += size
      out.push({ name: entry.name, relPath: rel, type: 'file', size })
    }
  }
  out.sort((a, b) =>
    a.type === 'dir' && b.type !== 'dir' ? -1
      : b.type === 'dir' && a.type !== 'dir' ? 1
        : a.name.localeCompare(b.name))
  return out
}

/** 递归复制目录树（跳过 COPY_SKIP_DIRS）。 */
function copyTree(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (COPY_SKIP_DIRS.has(entry.name)) continue
    const src = path.join(source, entry.name)
    const dst = path.join(target, entry.name)
    if (entry.isDirectory()) {
      copyTree(src, dst)
    } else if (entry.isSymbolicLink()) {
      try {
        fs.symlinkSync(fs.readlinkSync(src), dst)
      } catch {
        // 符号链接失败跳过
      }
    } else {
      fs.copyFileSync(src, dst)
    }
  }
}

/** 新实验的 LAB_NOTE.md 模板（自然语言，零固定字段，明确不创建 phase-0）。 */
function noteTemplate(name: string): string {
  return `# ${name}

这是自由格式实验笔记（LAB_NOTE.md）：任何 Markdown 都可以写在这里，
没有固定字段，不需要填写 seed / dataset / status / phase 等表单。

系统不会自动创建 phase-0 或其他阶段——阶段、检查点只是可选的整理工具
（旧实验面板可继续使用），实验目录和这本笔记本身就是实验的载体。

## 目标
（这个实验想验证什么？）

## 想法与进展
（按时间顺序自由记录：尝试了什么、为什么、结果如何……）

## 产物位置
- 日志：stdout.log / stderr.log（运行后出现）
- 产物：artifacts/（图表、模型、结果文件）
`
}

/** 导入实验的 LAB_NOTE.md 模板（记录来源路径与模式）。 */
function importNoteTemplate(name: string, sourcePath: string, mode: 'reference' | 'copy'): string {
  const sourceText = mode === 'reference'
    ? `本实验引用已有目录（未复制/移动文件）：\n\n\`${sourcePath}\`\n\n实验视图列出的是该目录的实时内容；若原目录被移动或删除，树列表会标记来源缺失（不会伪造内容）。`
    : `本实验已从已有目录复制材料（原目录未改动）：\n\n\`${sourcePath}\``
  return `# ${name}

${sourceText}

这是自由格式实验笔记（LAB_NOTE.md）：任何 Markdown 都可以写在这里，
没有固定字段；系统不会自动创建 phase-0 或其他阶段。

## 来源材料说明
（对导入的日志/结果目录做补充解释……）

## 想法与进展
（按时间顺序自由记录……）

## 下一步
（……）
`
}
