/**
 * 稿件目录与 LaTeX 写作（WRITE-01..08）。
 *
 * 定位：只管理「稿件目录、文件读写、编译、错误解析、上下文解析、引用核对、
 * 草稿对比」等后台数据接口；不建立表单式论文编辑器（复用现有文本标签页，
 * WRITE-02），不设置科研流程门禁（WRITE-06：实验未完成允许自然语言占位，
 * 编译/写作照常进行）。
 *
 * 文件布局（最小可编译骨架，WRITE-01）：
 *   paper/
 *   ├── main.tex            # 主文件（\input{sections/introduction}）
 *   ├── sections/           # 章节目录（不强制齐全，按需添加）
 *   ├── references.bib      # BibTeX 参考文献
 *   └── figures/            # 图片目录
 *
 * 编译（WRITE-03/04）：
 * - 按 PATH 探测 latexmk/pdflatex/xelatex/lualatex（findExecutable/probeLatexTools）；
 * - 编译 stdout/stderr 完整落盘 <manuscript>/build.log；
 * - parseLatexErrors 纯函数把日志解析为 {file, line, message}（匹配
 *   "file.tex:12: error" 与 "! LaTeX Error" / "! ..." + "l.12" 两种模式）；
 * - 缺少工具时返回可操作提示（安装 TeX Live / MiKTeX 或 latexmk），不阻塞写作。
 *
 * 引用核对（WRITE-07）：quoteCheck 返回 原论文页 / 实验日志 / 结果文件 的定位结构，
 * 正式落稿前由 Agent 回查（Idea 讨论不要求引用，见 api-integration-lib2.md）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { normPath, projectDir } from './core/paths.js'
import { LibrarySearch } from './library/search.js'
import type { ResolvedLibraryRef } from './library/types.js'

// ── 类型 ────────────────────────────────────────────────────────────────────

/** 稿件信息。 */
export interface ManuscriptInfo {
  name: string
  dir: string
  mainTex: string
  bib: string
  sectionsDir: string
  figuresDir: string
  hasBuildLog: boolean
  buildLogPath?: string
}

export type LatexTool = 'latexmk' | 'pdflatex' | 'xelatex' | 'lualatex'

export type LatexTools = Record<LatexTool, string | null>

/** 解析出的 LaTeX 编译错误。 */
export interface LatexError {
  file: string
  line: number | null
  message: string
  raw: string
}

/** 编译结果。 */
export interface CompileResult {
  ok: boolean
  tool: LatexTool | null
  toolPath?: string
  exitCode: number | null
  /** build.log 绝对路径（工具缺失时为 null）。 */
  logPath: string | null
  /** 日志尾部（≤8KB，供即时展示）。 */
  logTail: string
  errors: LatexError[]
  /** 可操作的说明（工具缺失提示 / 成功 / 失败概览）。 */
  message: string
}

/** WRITE-05 写作上下文（Chat Graph 连接解析结果；只读数据接口）。 */
export interface ManuscriptContext {
  papers: ResolvedLibraryRef[]
  notes: Array<ResolvedLibraryRef & { preview: string }>
  /** 实验目录 / 结果文件等路径引用。 */
  files: Array<{ path: string }>
  /** 无法解析的引用（原样返回，不失败）。 */
  unresolved: unknown[]
}

/** WRITE-07 引用/数字核对输入（text 与 number 至少其一）。 */
export interface QuoteCheckInput {
  text?: string
  number?: string
  paperId?: string
  experimentDir?: string
  resultFile?: string
}

/** 文件中的命中（行号 + 片段）。 */
export interface FileQuoteHit {
  file: string
  relative: string
  line: number
  snippet: string
}

/** WRITE-07 引用核对结果（定位结构，不做自动判定）。 */
export interface QuoteCheckResult {
  query: string
  paperHits: Array<{ paperId: string; title: string; filePath: string; page: number; offset: number; snippet: string }>
  fileHits: FileQuoteHit[]
  message: string
}

/** WRITE-08 草稿对比（段落级；提示可能过期段落，绝不自动覆盖）。 */
export interface DraftDiff {
  oldFile: string
  unchanged: string[]
  changed: Array<{ oldText: string; newText: string }>
  added: string[]
  removed: string[]
}

export interface ManuscriptConfig {
  readonly dataRoot: string
}

// ── 常量 ────────────────────────────────────────────────────────────────────

/** 最小骨架主文件（WRITE-01：可编译；章节按需添加，不要求齐全）。 */
const MAIN_TEX_TEMPLATE = `% EvoResearch manuscript（WRITE-01 最小可编译骨架）
% 章节按需添加/删除，不强制齐全（WRITE-06：无完成门禁）。
\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{graphicx}
\\title{}
\\author{}
\\date{}
\\begin{document}
\\maketitle
\\input{sections/introduction}
\\end{document}
`

const INTRODUCTION_TEX_TEMPLATE = `% 引言（占位）：写作时替换为真实内容。
% 允许保留自然语言占位（WRITE-06：实验未完成不阻止写作与编译）。
Introduction placeholder.
`

/** 编译时可扫描的实验/结果文件扩展名（quoteCheck）。 */
const QUOTE_SCAN_EXTS = new Set(['.txt', '.log', '.out', '.json', '.csv', '.md', '.tex', '.dat'])
const QUOTE_SCAN_MAX_BYTES = 5 * 1024 * 1024
const QUOTE_SCAN_MAX_FILES = 300

// ── 纯函数：工具探测 ─────────────────────────────────────────────────────────

/** 在 PATH 中查找可执行文件（Windows 兼容 PATHEXT 扩展名）。 */
export function findExecutable(name: string): string | null {
  const pathEnv = process.env.PATH ?? ''
  const exts = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
    .split(';').map((e) => e.trim()).filter(Boolean)
  for (const dirRaw of pathEnv.split(path.delimiter)) {
    const dir = dirRaw.trim()
    if (!dir) continue
    const base = path.join(dir, name)
    try {
      if (fs.existsSync(base) && fs.statSync(base).isFile()) return base
      for (const ext of exts) {
        const lower = `${base}${ext.toLowerCase()}`
        if (fs.existsSync(lower) && fs.statSync(lower).isFile()) return lower
        if (ext !== ext.toLowerCase()) {
          const upper = `${base}${ext}`
          if (fs.existsSync(upper) && fs.statSync(upper).isFile()) return upper
        }
      }
    } catch {
      // 单个目录不可读时继续
    }
  }
  return null
}

/** 探测本机 LaTeX 工具链（latexmk 优先）。 */
export function probeLatexTools(): LatexTools {
  return {
    latexmk: findExecutable('latexmk'),
    pdflatex: findExecutable('pdflatex'),
    xelatex: findExecutable('xelatex'),
    lualatex: findExecutable('lualatex'),
  }
}

/** LaTeX 环境检测结果（P2-3 wire JSON）。 */
export interface LatexEnvReport {
  /** 就绪 = 至少一个编译引擎可用。 */
  ready: boolean
  engines: Array<{ name: LatexTool; path: string | null }>
  /** kpsewhich 抽查的关键包（ctex/graphicx 等）；kpsewhich 不可用时为空数组 + note。 */
  packages: Array<{ name: string; found: boolean }>
  ctexAvailable: boolean | null
  kpsewhichPath: string | null
  /** 中文写作建议（ctex 缺失时提示 xelatex+ctex 组合）。 */
  advice: string[]
}

/**
 * P2-3：LaTeX 环境检测（纯函数）——探测编译引擎 + kpsewhich 抽查关键宏包，
 * 输出可操作建议。run 参数可注入（测试用假实现）；默认用 spawnSync 包装。
 * 结果不缓存（调用方决定缓存策略；本函数保持纯）。
 */
export function detectLatexEnv(run?: (exe: string, args: string[], timeoutMs?: number) => { status: number | null; stdout: string }): LatexEnvReport {
  const exec = run ?? ((exe: string, args: string[], timeoutMs?: number) => {
    const result = spawnSync(exe, args, { encoding: 'utf8', timeout: timeoutMs ?? 5000, windowsHide: true })
    return { status: result.status, stdout: typeof result.stdout === 'string' ? result.stdout : '' }
  })
  // 引擎探测
  const tools = probeLatexTools()
  const engines = (['latexmk', 'pdflatex', 'xelatex', 'lualatex'] as const).map((name) => ({ name, path: tools[name] }))
  const ready = engines.some((engine) => engine.path !== null)
  // kpsewhich 宏包抽查
  const kpsewhichPath = findExecutable('kpsewhich')
  const packages: Array<{ name: string; found: boolean }> = []
  let ctexAvailable: boolean | null = null
  if (kpsewhichPath !== null) {
    for (const pkg of ['article.cls', 'ctex.sty', 'graphicx.sty', 'amsmath.sty', 'booktabs.sty', 'hyperref.sty']) {
      let found = false
      try {
        const result = exec(kpsewhichPath, [pkg])
        found = result.status === 0 && result.stdout.trim() !== ''
      } catch {
        found = false
      }
      packages.push({ name: pkg, found })
      if (pkg === 'ctex.sty') ctexAvailable = found
    }
  }
  // 建议规则
  const advice: string[] = []
  if (!ready) {
    advice.push('未找到 LaTeX 引擎，建议安装 TeX Live 或 MiKTeX（Windows 可 winget install MiKTeX.MiKTeX）')
  }
  if (ctexAvailable === false && tools.xelatex !== null) {
    advice.push('中文论文建议使用 xelatex + ctex 宏包；当前 ctex 缺失，可在 MiKTeX Console 安装 ctex')
  }
  if (kpsewhichPath === null) {
    advice.push('kpsewhich 不可用，跳过宏包检查（不影响编译）')
  }
  return { ready, engines, packages, ctexAvailable, kpsewhichPath, advice }
}

// ── 纯函数：编译错误解析（WRITE-04） ───────────────────────────────────────

/**
 * 把 LaTeX 编译日志解析为结构化错误列表（纯函数）。
 * 支持两种模式：
 * - 行内：`file.tex:12: message`（含 ./ 前缀）；
 * - 块式：`! LaTeX Error: ...` / `! Undefined control sequence.` 后跟 `l.12 ...`。
 * 去重（file:line:message 相同只保留首个）。
 */
export function parseLatexErrors(logText: string): LatexError[] {
  const errors: LatexError[] = []
  const lines = logText.split(/\r?\n/)
  let currentFile = 'main.tex'
  let open: { message: string; raw: string[] } | null = null

  const pushOpen = (): void => {
    if (open) {
      errors.push({ file: currentFile, line: null, message: open.message, raw: open.raw.join('\n') })
      open = null
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    // 文件上下文：`(./main.tex` 或 `(/path/x.tex`
    const fileCtx = /^\(([^\s()]*\.tex)/.exec(trimmed)
    if (fileCtx) {
      currentFile = fileCtx[1]!.replace(/^\.\//, '')
      continue
    }
    // 行内错误：file.tex:LINE: message
    const inline = /^([^\s:()]+\.tex):(\d+):\s*(.+)$/.exec(trimmed)
    if (inline) {
      pushOpen()
      errors.push({
        file: inline[1]!.replace(/^\.\//, ''),
        line: Number(inline[2]),
        message: inline[3]!.trim(),
        raw: trimmed,
      })
      continue
    }
    // 新错误块
    if (line.startsWith('! ')) {
      pushOpen()
      open = { message: line.slice(2).trim(), raw: [line] }
      continue
    }
    if (open) {
      open.raw.push(line)
      const lineNo = /^l\.(\d+)\s*(.*)$/.exec(trimmed)
      if (lineNo) {
        errors.push({ file: currentFile, line: Number(lineNo[1]), message: open.message, raw: open.raw.join('\n') })
        open = null
      } else if (/^\?$/.test(trimmed)) {
        pushOpen()
      } else if (open.raw.length > 12) {
        pushOpen()
      }
    }
  }
  pushOpen()

  const seen = new Set<string>()
  return errors.filter((e) => {
    const key = `${e.file}:${e.line ?? -1}:${e.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── 纯函数：草稿对比（WRITE-08） ────────────────────────────────────────────

/** 按空行切分段落（空白段落丢弃）。 */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
}

function normalizeBlock(block: string): string {
  return block.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** 段落首句（前 60 字符，归一化）——用于「同一段落被改写」的配对。 */
function leadOf(block: string): string {
  const first = block.split('\n')[0]?.trim() ?? ''
  return first.replace(/\s+/g, ' ').toLowerCase().slice(0, 60)
}

/**
 * 段落级草稿对比（纯函数）：相同段落归 unchanged；仅新出现归 added；
 * 仅旧存在归 removed；首句相同但内容变化的段落归 changed（提示可能过期段落）。
 * 只返回对比结果，绝不写入文件（WRITE-08：不自动覆盖）。
 */
export function diffDraftTexts(oldText: string, newText: string): Omit<DraftDiff, 'oldFile'> {
  const oldBlocks = splitParagraphs(oldText)
  const newBlocks = splitParagraphs(newText)
  const oldNorm = new Map(oldBlocks.map((block) => [normalizeBlock(block), block]))
  const newNorm = new Map(newBlocks.map((block) => [normalizeBlock(block), block]))

  const unchanged: string[] = []
  const removed: string[] = []
  const added: string[] = []
  const changed: Array<{ oldText: string; newText: string }> = []

  for (const [key, block] of oldNorm) {
    if (newNorm.has(key)) unchanged.push(block)
    else removed.push(block)
  }
  for (const [key, block] of newNorm) {
    if (!oldNorm.has(key)) added.push(block)
  }
  // 首句配对：改写段落从 removed/added 中挪到 changed
  for (const [newKey, newBlock] of newNorm) {
    if (oldNorm.has(newKey)) continue
    const lead = leadOf(newBlock)
    if (!lead) continue
    for (const [oldKey, oldBlock] of oldNorm) {
      if (newNorm.has(oldKey)) continue
      if (leadOf(oldBlock) === lead) {
        changed.push({ oldText: oldBlock, newText: newBlock })
        const ri = removed.indexOf(oldBlock)
        if (ri >= 0) removed.splice(ri, 1)
        const ai = added.indexOf(newBlock)
        if (ai >= 0) added.splice(ai, 1)
        break
      }
    }
  }
  return { unchanged, changed, added, removed }
}

// ── 服务 ────────────────────────────────────────────────────────────────────

/** 稿件目录服务（WRITE-01..08）。 */
export class ManuscriptService {
  private readonly librarySearch: LibrarySearch

  constructor(readonly config: ManuscriptConfig) {
    this.librarySearch = new LibrarySearch({ dataRoot: config.dataRoot })
  }

  /** 校验稿件目录名（仅允许简单目录名，防路径穿越）。 */
  private validateDirName(dirName: string): void {
    if (!/^[a-zA-Z0-9._-]+$/.test(dirName)) {
      throw new Error(`非法的稿件目录名: ${dirName}`)
    }
  }

  /** 项目根 + 稿件目录 → 绝对路径（目录名或绝对/相对路径均可，校验必须在项目内）。 */
  private resolveManuscriptDir(project: string, dir?: string): string {
    const projectPath = projectDir(this.config.dataRoot, project)
    if (!dir) return path.join(projectPath, 'paper')
    const resolved = path.isAbsolute(dir) ? dir : path.join(projectPath, dir)
    if (!normPath(resolved).startsWith(normPath(projectPath) + path.sep)) {
      throw new Error(`稿件目录必须在项目内: ${dir}`)
    }
    return resolved
  }

  /**
   * 创建最小稿件目录（WRITE-01）：paper/{main.tex, sections/, references.bib, figures/}。
   * 幂等：已存在的文件不覆盖。
   */
  createManuscript(project: string, dirName = 'paper'): ManuscriptInfo {
    this.validateDirName(dirName)
    const projectPath = projectDir(this.config.dataRoot, project)
    const dir = path.join(projectPath, dirName)
    fs.mkdirSync(path.join(dir, 'sections'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'figures'), { recursive: true })
    const mainTex = path.join(dir, 'main.tex')
    if (!fs.existsSync(mainTex)) fs.writeFileSync(mainTex, MAIN_TEX_TEMPLATE, 'utf8')
    const intro = path.join(dir, 'sections', 'introduction.tex')
    if (!fs.existsSync(intro)) fs.writeFileSync(intro, INTRODUCTION_TEX_TEMPLATE, 'utf8')
    const bib = path.join(dir, 'references.bib')
    if (!fs.existsSync(bib)) fs.writeFileSync(bib, '% EvoResearch references（可导入 BibTeX 或手写；Idea 讨论不要求引用）\n', 'utf8')
    return this.getManuscript(project, dirName)
  }

  /** 列出项目内全部稿件（含 main.tex 的目录）。 */
  listManuscripts(project: string): ManuscriptInfo[] {
    const projectPath = projectDir(this.config.dataRoot, project)
    let entries: import('node:fs').Dirent[]
    try {
      entries = fs.readdirSync(projectPath, { withFileTypes: true })
    } catch {
      return []
    }
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .filter((e) => fs.existsSync(path.join(projectPath, e.name, 'main.tex')))
      .map((e) => this.getManuscript(project, e.name))
  }

  /** 读取稿件信息（选择已有稿件目录；缺 main.tex 抛错并给出可操作提示）。 */
  getManuscript(project: string, dir?: string): ManuscriptInfo {
    const dirPath = this.resolveManuscriptDir(project, dir)
    const mainTex = path.join(dirPath, 'main.tex')
    if (!fs.existsSync(mainTex)) {
      throw new Error(`不是稿件目录（缺少 main.tex）: ${dirPath}（可用 manuscriptCreate 创建最小 paper/ 骨架）`)
    }
    const buildLogPath = path.join(dirPath, 'build.log')
    const hasBuildLog = fs.existsSync(buildLogPath)
    return {
      name: path.basename(dirPath),
      dir: dirPath,
      mainTex,
      bib: path.join(dirPath, 'references.bib'),
      sectionsDir: path.join(dirPath, 'sections'),
      figuresDir: path.join(dirPath, 'figures'),
      hasBuildLog,
      buildLogPath: hasBuildLog ? buildLogPath : undefined,
    }
  }

  /** 校验相对路径在稿件目录内（防穿越），返回绝对路径。 */
  private safeResolve(manuscriptDir: string, relPath: string): string {
    const resolved = path.resolve(manuscriptDir, relPath)
    if (!normPath(resolved).startsWith(normPath(manuscriptDir) + path.sep)) {
      throw new Error(`路径越界（必须位于稿件目录内）: ${relPath}`)
    }
    return resolved
  }

  /** 列出稿件目录内全部文件（相对路径（/ 分隔），含 sections/figures 递归，上限 500）。 */
  listFiles(project: string, dir?: string, sub?: string): string[] {
    const manuscript = this.getManuscript(project, dir)
    const root = sub ? this.safeResolve(manuscript.dir, sub) : manuscript.dir
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`目录不存在: ${sub ?? manuscript.dir}`)
    }
    const result: string[] = []
    const walk = (current: string): void => {
      if (result.length >= 500) return
      let entries: import('node:fs').Dirent[]
      try {
        entries = fs.readdirSync(current, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (result.length >= 500) return
        if (entry.name.startsWith('.')) continue
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.isFile()) result.push(path.relative(manuscript.dir, full).split(path.sep).join('/'))
      }
    }
    walk(root)
    return result
  }

  /** 读取稿件内文本文件（WRITE-02；≤2MB，utf8）。 */
  readFile(project: string, dir: string | undefined, relPath: string): { path: string; content: string } {
    const manuscript = this.getManuscript(project, dir)
    const target = this.safeResolve(manuscript.dir, relPath)
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error(`文件不存在: ${relPath}`)
    }
    if (fs.statSync(target).size > 2 * 1024 * 1024) {
      throw new Error(`文件过大（>2MB），请在编辑器/标签页中打开: ${relPath}`)
    }
    return { path: target, content: fs.readFileSync(target, 'utf8') }
  }

  /** 写入稿件内文本文件（WRITE-02；原子写：临时文件 + 改名）。 */
  writeFile(project: string, dir: string | undefined, relPath: string, content: string): { path: string } {
    const manuscript = this.getManuscript(project, dir)
    const target = this.safeResolve(manuscript.dir, relPath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const tmp = `${target}.tmp-${process.pid}`
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, target)
    return { path: target }
  }

  /**
   * 编译稿件（WRITE-03）：探测 latexmk/pdflatex/xelatex/lualatex，
   * 以稿件目录为工作目录运行，stdout/stderr 完整落盘 build.log，
   * 日志解析出结构化错误（WRITE-04）。缺少工具返回可操作提示，不抛错。
   */
  async compileManuscript(
    project: string,
    dir?: string,
    options: { tool?: LatexTool; timeoutMs?: number } = {},
  ): Promise<CompileResult> {
    const manuscript = this.getManuscript(project, dir)
    const tools = probeLatexTools()
    const prefer = options.tool
    const tool: LatexTool | null = prefer
      ? (tools[prefer] ? prefer : null)
      : (tools.latexmk ? 'latexmk' : tools.pdflatex ? 'pdflatex' : tools.xelatex ? 'xelatex' : tools.lualatex ? 'lualatex' : null)
    if (!tool) {
      return {
        ok: false,
        tool: null,
        exitCode: null,
        logPath: null,
        logTail: '',
        errors: [],
        message: `未找到 LaTeX 工具（latexmk/pdflatex/xelatex/lualatex）。请安装 TeX Live 或 MiKTeX 并将可执行文件加入 PATH；安装后重新调用编译即可。写作与占位不受影响（WRITE-06 无门禁）。`,
      }
    }
    const toolPath = tools[tool]!
    const args = tool === 'latexmk'
      ? ['-pdf', '-interaction=nonstopmode', '-halt-on-error', 'main.tex']
      : ['-interaction=nonstopmode', '-halt-on-error', 'main.tex']
    const timeoutMs = Math.min(Math.max(Math.floor(options.timeoutMs ?? 180_000), 5_000), 600_000)
    const { exitCode, stdout, stderr, timedOut } = await runCommand(toolPath, args, manuscript.dir, timeoutMs)
    const fullLog = `${stdout}${stderr ? `\n${stderr}` : ''}`
    const logPath = path.join(manuscript.dir, 'build.log')
    const tmp = `${logPath}.tmp-${process.pid}`
    fs.writeFileSync(tmp, fullLog, 'utf8')
    fs.renameSync(tmp, logPath)
    const errors = parseLatexErrors(fullLog)
    const ok = exitCode === 0 && !timedOut
    return {
      ok,
      tool,
      toolPath,
      exitCode,
      logPath,
      logTail: fullLog.slice(-8000),
      errors,
      message: timedOut
        ? `编译超时（>${Math.round(timeoutMs / 1000)}s），已终止；完整日志: ${logPath}`
        : ok
          ? `编译成功（${tool}，main.pdf 已生成）；日志: ${logPath}`
          : `编译失败（exit ${exitCode ?? '?'}，${errors.length} 处错误）；完整日志: ${logPath}`,
    }
  }

  /**
   * P2-3：LaTeX 环境检测（薄包装 detectLatexEnv 纯函数）——
   * 引擎 + 宏包就绪状态与中文写作建议；api 层统一入口用。
   */
  detectLatexEnv(): LatexEnvReport {
    return detectLatexEnv()
  }

  /**
   * 写作上下文解析（WRITE-05）：给定 Chat Graph 连接（refs 列表），列出相连的
   * 论文/精读笔记/实验与结果文件。只读数据接口；接线点：api.ts 把图节点的
   * ref 列表传进来（chat-graph GraphNodeRef 转 LibraryRef 或直接传 {kind,path}）。
   */
  resolveManuscriptContext(project: string, refs: readonly unknown[]): ManuscriptContext {
    const papers: ResolvedLibraryRef[] = []
    const notes: Array<ResolvedLibraryRef & { preview: string }> = []
    const files: Array<{ path: string }> = []
    const unresolved: unknown[] = []
    for (const raw of refs) {
      if (typeof raw !== 'object' || raw === null) {
        unresolved.push(raw)
        continue
      }
      const ref = raw as { kind?: unknown; paperId?: unknown; path?: unknown }
      if (ref.kind === 'paper' || ref.kind === 'note') {
        const resolved = this.librarySearch.resolveRef(project, {
          kind: ref.kind,
          paperId: typeof ref.paperId === 'string' ? ref.paperId : undefined,
          path: typeof ref.path === 'string' ? ref.path : undefined,
        })
        if (!resolved) {
          unresolved.push(raw)
          continue
        }
        if (ref.kind === 'note') notes.push({ ...resolved, preview: resolved.notes.slice(0, 300) })
        else papers.push(resolved)
        continue
      }
      if (typeof ref.path === 'string') {
        const resolvedPath = path.isAbsolute(ref.path)
          ? ref.path
          : path.join(projectDir(this.config.dataRoot, project), ref.path)
        if (fs.existsSync(resolvedPath)) files.push({ path: resolvedPath })
        else unresolved.push(raw)
        continue
      }
      unresolved.push(raw)
    }
    return { papers, notes, files, unresolved }
  }

  /**
   * 引用/数字核对（WRITE-07）：给定引用文本或数字，返回定位结构——
   * 原论文页（library 页文本子串扫描）+ 实验日志/结果文件（行号 + 片段）。
   * 只定位不判定；正式落稿前由 Agent 回查原始证据。
   */
  quoteCheck(project: string, input: QuoteCheckInput): QuoteCheckResult {
    const query = (input.text ?? input.number ?? '').trim()
    if (!query) throw new Error('quoteCheck 需要 text 或 number')
    const paperHits = this.librarySearch.scanPages(project, query, { paperId: input.paperId, hitLimit: 30 })
    const fileHits: FileQuoteHit[] = []
    const scanFile = (file: string, relative: string): void => {
      if (fileHits.length >= 30) return
      try {
        if (fs.statSync(file).size > QUOTE_SCAN_MAX_BYTES) return
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
        const lower = query.toLowerCase()
        for (let i = 0; i < lines.length && fileHits.length < 30; i += 1) {
          const index = lines[i]!.toLowerCase().indexOf(lower)
          if (index >= 0) {
            fileHits.push({ file, relative, line: i + 1, snippet: snippetAround(lines[i]!, index, query.length) })
          }
        }
      } catch {
        // 单个文件不可读时跳过
      }
    }
    if (input.resultFile) {
      const target = path.isAbsolute(input.resultFile)
        ? input.resultFile
        : path.join(projectDir(this.config.dataRoot, project), input.resultFile)
      if (fs.existsSync(target) && fs.statSync(target).isFile()) scanFile(target, path.basename(target))
    }
    if (input.experimentDir) {
      const root = path.isAbsolute(input.experimentDir)
        ? input.experimentDir
        : path.join(projectDir(this.config.dataRoot, project), input.experimentDir)
      if (fs.existsSync(root) && fs.statSync(root).isDirectory()) {
        const files: string[] = []
        const walk = (current: string, depth: number): void => {
          if (depth > 4 || files.length >= QUOTE_SCAN_MAX_FILES) return
          let entries: import('node:fs').Dirent[]
          try {
            entries = fs.readdirSync(current, { withFileTypes: true })
          } catch {
            return
          }
          for (const entry of entries) {
            if (files.length >= QUOTE_SCAN_MAX_FILES) return
            const full = path.join(current, entry.name)
            if (entry.isDirectory()) {
              if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(full, depth + 1)
            } else if (entry.isFile() && QUOTE_SCAN_EXTS.has(path.extname(entry.name).toLowerCase())) {
              files.push(full)
            }
          }
        }
        walk(root, 0)
        for (const file of files) scanFile(file, path.relative(projectDir(this.config.dataRoot, project), file))
      }
    }
    const message = paperHits.length + fileHits.length === 0
      ? `未找到「${query}」的定位（原论文无索引文本或实验文件不含该串）`
      : `找到 ${paperHits.length} 处论文定位、${fileHits.length} 处文件定位`
    return { query, paperHits, fileHits, message }
  }

  /**
   * 草稿对比（WRITE-08）：以当前 main.tex 为基线，与 newContent 做段落级对比，
   * 提示可能过期的段落（首句相同但内容变化的段落）。绝不自动覆盖稿件。
   */
  diffDraft(project: string, dir: string | undefined, newContent: string): DraftDiff {
    const manuscript = this.getManuscript(project, dir)
    const current = fs.readFileSync(manuscript.mainTex, 'utf8')
    return { oldFile: manuscript.mainTex, ...diffDraftTexts(current, newContent) }
  }

  /** 关闭内部资源（library search 连接缓存）。 */
  dispose(): void {
    this.librarySearch.dispose()
  }
}

// ── 内部工具 ────────────────────────────────────────────────────────────────

/** 运行外部命令，收集 stdout/stderr（超时终止；spawn 失败走 error 事件）。 */
function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ exitCode: null, stdout, stderr: `${stderr}\n[spawn 失败] ${error.message}`, timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code, stdout, stderr, timedOut })
    })
  })
}

/** 生成命中片段（行内上下文）。 */
function snippetAround(line: string, offset: number, length: number, before = 40, after = 120): string {
  const start = Math.max(0, offset - before)
  const end = Math.min(line.length, offset + length + after)
  return `${start > 0 ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}`
}
