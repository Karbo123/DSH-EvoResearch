/**
 * 论文图片生成工作流后端（P2-1）：FigureService + 三个模型工具。
 *
 * 职责：
 * - 在项目虚拟环境（<projectDir>/.venv）的 Python 解释器下运行绘图脚本；
 *   脚本经环境变量 FIGURE_OUT_DIR 拿到本次输出目录，把 PNG/SVG/PDF/JPG 写进去。
 * - 每次渲染（含失败尝试）都追加一个版本：<workspaceDir>/figures/<figureId>/v<N>/，
 *   历史永不覆盖；manifest.json（原子写 tmp+rename）记录元数据与最新成功版本，
 *   history.jsonl 逐行追加每版 FigureVersion 记录。
 * - 注册模型工具 render_figure / list_figures / critique_figure
 *   （critique 复用注入的视觉评审函数——host 接线 vision.analyzeImage；
 *   未配置视觉模型时不注册该工具）。
 *
 * 关键决策：
 * - figureId 含随机后缀（slug-6位随机 / f-8位随机），但同一脚本重跑时按
 *   manifest.script_path 匹配复用既有 figureId——「同一 figureId 重跑产生新版本」
 *   与随机 id 两者兼得；换脚本同标题会得到新图纸。
 * - 注入 runner（测试替身）时跳过解释器磁盘存在性检查（假路径无需真实存在）；
 *   默认真实 spawn 前仍校验，缺失即失败且不落任何版本记录。
 * - manifest.latest_version/latest_path 只在「成功且有产物」的版本上推进；
 *   失败版本仅进 history，便于追溯但不污染「最新可用图」。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { normPath } from './core/paths.js'

// ── 常量 ────────────────────────────────────────────────────────────────────

/** 图纸根目录名（位于项目目录内）。 */
const FIGURES_DIR_NAME = 'figures'
/** 单版渲染日志尾部上限（字符）。 */
const LOG_TAIL_MAX = 4000
/** 默认渲染超时（毫秒）；超时 kill 并记 exitCode=null。 */
const RENDER_TIMEOUT_MS = 120 * 1000
/** 认可的产物扩展名。 */
const ARTIFACT_EXTS: ReadonlySet<string> = new Set(['.png', '.svg', '.pdf', '.jpg', '.jpeg'])

// ── 类型 ────────────────────────────────────────────────────────────────────

/** 单个图纸的一次渲染版本。 */
export interface FigureVersion {
  /** 从 1 递增（失败尝试也占号）。 */
  readonly version: number
  /** epoch 毫秒。 */
  readonly renderedAt: number
  readonly exitCode: number | null
  readonly ok: boolean
  /** 渲染日志尾部（≤4000 字符）。 */
  readonly logTail: string
  /** 本次产物相对 figures/<figureId>/v<N>/ 的文件名列表（png/svg/pdf/jpg）。 */
  readonly artifacts: readonly string[]
}

/** 图纸元数据（wire JSON）。 */
export interface FigureInfo {
  /** f-<8位随机> 或 <slug>-<6位随机>。 */
  figureId: string
  /** 用户/模型起的图题。 */
  title: string
  /** 绝对路径（项目内）。 */
  scriptPath: string
  /** figures/<figureId> 目录名（=figureId）。 */
  dirName: string
  /** 时间正序。 */
  versions: readonly FigureVersion[]
  /** 最新成功版本的第一个 png/svg/pdf 绝对路径。 */
  latestPath: string | null
}

/** 单次渲染结果（wire 安全）。 */
export interface FigureRenderResult {
  ok: boolean
  figureId: string
  version: number
  exitCode: number | null
  logTail: string
  /** 相对 figures/<figureId>/v<N>/ 的文件名列表。 */
  artifacts: readonly string[]
  latestPath: string | null
  error?: string
}

/** 注入执行器入参（env 已合并 process.env 并附 FIGURE_OUT_DIR/PYTHONIOENCODING）。 */
export interface FigureRunnerOptions {
  readonly exe: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string | undefined>>
}

/** 注入执行器结果。 */
export interface FigureRunnerOutcome {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}

/** 注入执行器（测试用）；缺省用 child_process.spawn 异步收集。 */
export type FigureRunner = (options: FigureRunnerOptions) => Promise<FigureRunnerOutcome>

export interface FigureServiceConfig {
  dataRoot: string
  /** 项目虚拟环境解释器解析器（host/index 接线 ProjectEnvService.pythonOf∘envDirOf）。 */
  resolvePython?: (projectDir: string) => string | null
  /** 注入执行器（测试）；缺省真实 spawn，超时 120s kill。 */
  runner?: FigureRunner
}

// ── manifest / history（wire 层）───────────────────────────────────────────

/** manifest.json（snake_case wire）。 */
interface FigureManifestWire {
  figure_id: string
  title: string
  script_path: string
  created_at: number
  updated_at: number
  latest_version: number
  latest_path: string | null
}

/** history.jsonl 单行（snake_case wire）。 */
interface FigureVersionWire {
  version: number
  rendered_at: number
  exit_code: number | null
  ok: boolean
  log_tail: string
  artifacts: readonly string[]
}

/** 容错解析 manifest（损坏/缺 figure_id → null）。 */
function normalizeManifest(value: unknown): FigureManifestWire | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  if (typeof r['figure_id'] !== 'string' || r['figure_id'] === '') return null
  return {
    figure_id: r['figure_id'],
    title: typeof r['title'] === 'string' ? r['title'] : '',
    script_path: typeof r['script_path'] === 'string' ? r['script_path'] : '',
    created_at: typeof r['created_at'] === 'number' ? r['created_at'] : 0,
    updated_at: typeof r['updated_at'] === 'number' ? r['updated_at'] : 0,
    latest_version: typeof r['latest_version'] === 'number' ? r['latest_version'] : 0,
    latest_path: typeof r['latest_path'] === 'string' ? r['latest_path'] : null,
  }
}

/** 容错解析一条 history 行（缺 version → 丢弃）。 */
function normalizeVersion(value: unknown): FigureVersion | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  if (typeof r['version'] !== 'number') return null
  return {
    version: r['version'],
    renderedAt: typeof r['rendered_at'] === 'number' ? r['rendered_at'] : 0,
    exitCode: typeof r['exit_code'] === 'number' ? r['exit_code'] : null,
    ok: r['ok'] === true,
    logTail: typeof r['log_tail'] === 'string' ? r['log_tail'] : '',
    artifacts: Array.isArray(r['artifacts']) ? r['artifacts'].map(String) : [],
  }
}

// ── 纯函数 ──────────────────────────────────────────────────────────────────

/** 标题 slug：小写 [a-z0-9_-]，≤24 字符；无有效字符返回空串。 */
export function slugTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '')
}

/** 生成新 figureId：有有效 slug 用 slug-6位随机，否则 f-8位随机。 */
function newFigureId(title: string): string {
  const rand = randomUUID().replace(/-/g, '')
  const slug = slugTitle(title)
  if (slug !== '') return `${slug}-${rand.slice(0, 6)}`
  return `f-${rand.slice(0, 8)}`
}

/** 日志尾部截取（≤max 字符，保尾部）。 */
function tailOf(text: string, max = LOG_TAIL_MAX): string {
  const t = text.trim()
  return t.length <= max ? t : t.slice(t.length - max)
}

/** 扫描版本目录下的产物文件名（顶层，按名称排序）。 */
function scanArtifacts(versionDir: string): string[] {
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(versionDir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isFile() && ARTIFACT_EXTS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort()
}

/** 选「最新产物」：优先 png，否则第一个。 */
function preferredArtifact(artifacts: readonly string[]): string | null {
  const png = artifacts.find((a) => a.toLowerCase().endsWith('.png'))
  return png ?? artifacts[0] ?? null
}

/** 路径包含判断（大小写不敏感，Windows 友好）。 */
function isInside(child: string, parent: string): boolean {
  const nc = normPath(child)
  const np = normPath(parent)
  return nc === np || nc.startsWith(np.endsWith(path.sep) ? np : `${np}${path.sep}`)
}

// ── 默认执行器 ──────────────────────────────────────────────────────────────

/** 默认执行器：spawn 异步收集 stdout/stderr/exitCode；120s 超时 kill。 */
function defaultRunner(options: FigureRunnerOptions): Promise<FigureRunnerOutcome> {
  return new Promise((resolve) => {
    const child = spawn(options.exe, [...options.args], {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      // Windows 无 SIGKILL 语义，直接 terminate；其余平台强杀
      try {
        if (process.platform === 'win32') child.kill()
        else child.kill('SIGKILL')
      } catch {
        // 进程可能已自行退出
      }
      resolve({ exitCode: null, stdout, stderr: `${stderr}\n(timeout)` })
    }, RENDER_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ exitCode: null, stdout, stderr: String(error?.message ?? error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code, stdout, stderr })
    })
  })
}

// ── 服务 ────────────────────────────────────────────────────────────────────

/** 论文图片服务（P2-1）。 */
export class FigureService {
  constructor(private readonly config: FigureServiceConfig) {}

  /** 解析项目解释器；不可用返回 null（注入 runner 时跳过磁盘存在性检查）。 */
  private resolvePythonExe(projectDir: string): string | null {
    const resolve = this.config.resolvePython
    if (resolve === undefined) return null
    const exe = resolve(projectDir)
    if (typeof exe !== 'string' || exe.trim() === '') return null
    if (this.config.runner === undefined && !fs.existsSync(exe)) return null
    return exe
  }

  /** 执行：注入 runner 优先（测试），否则默认 spawn。 */
  private run(options: FigureRunnerOptions): Promise<FigureRunnerOutcome> {
    const injected = this.config.runner
    if (injected !== undefined) return injected(options)
    return defaultRunner(options)
  }

  // ── 磁盘读写 ──────────────────────────────────────────────────────────────

  private manifestFile(figureDir: string): string {
    return path.join(figureDir, 'manifest.json')
  }

  private historyFile(figureDir: string): string {
    return path.join(figureDir, 'history.jsonl')
  }

  private readManifest(figureDir: string): FigureManifestWire | null {
    try {
      return normalizeManifest(JSON.parse(fs.readFileSync(this.manifestFile(figureDir), 'utf8')))
    } catch {
      return null
    }
  }

  /** manifest 原子写（tmp+rename，与账本一致）。 */
  private writeManifest(figureDir: string, manifest: FigureManifestWire): void {
    const file = this.manifestFile(figureDir)
    const tmp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    fs.renameSync(tmp, file)
  }

  /** 读 history.jsonl 还原版本序列（时间正序；损坏行跳过）。 */
  private readHistory(figureDir: string): FigureVersion[] {
    let text = ''
    try {
      text = fs.readFileSync(this.historyFile(figureDir), 'utf8')
    } catch {
      return []
    }
    const out: FigureVersion[] = []
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === '') continue
      try {
        const v = normalizeVersion(JSON.parse(line))
        if (v !== null) out.push(v)
      } catch {
        // 损坏行跳过
      }
    }
    return out
  }

  /** 追加一版到 history.jsonl（逐行 JSON）。 */
  private appendHistory(figureDir: string, version: FigureVersion): void {
    const wire: FigureVersionWire = {
      version: version.version,
      rendered_at: version.renderedAt,
      exit_code: version.exitCode,
      ok: version.ok,
      log_tail: version.logTail,
      artifacts: [...version.artifacts],
    }
    fs.appendFileSync(this.historyFile(figureDir), `${JSON.stringify(wire)}\n`, 'utf8')
  }

  /** 在 figures 根下按 script_path 匹配既有图纸（复用 figureId 实现重跑新版本）。 */
  private findExistingFigureId(figuresRoot: string, scriptAbs: string): string | null {
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(figuresRoot, { withFileTypes: true })
    } catch {
      return null
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifest = this.readManifest(path.join(figuresRoot, entry.name))
      if (manifest === null) continue
      if (manifest.script_path !== '' && normPath(manifest.script_path) === normPath(scriptAbs)) {
        return manifest.figure_id
      }
    }
    return null
  }

  /** 单个图纸信息 + 排序键（updated_at）；manifest 缺失返回 undefined。 */
  private infoOf(figuresRoot: string, dirName: string): { info: FigureInfo; updatedAt: number } | undefined {
    const figureDir = path.join(figuresRoot, dirName)
    const manifest = this.readManifest(figureDir)
    if (manifest === null) return undefined
    return {
      info: {
        figureId: manifest.figure_id,
        title: manifest.title,
        scriptPath: manifest.script_path,
        dirName,
        versions: this.readHistory(figureDir),
        latestPath: manifest.latest_path,
      },
      updatedAt: manifest.updated_at,
    }
  }

  // ── 对外 API ──────────────────────────────────────────────────────────────

  /**
   * 渲染一次：解析脚本（须位于 workspaceDir 内）→ 解析项目解释器 →
   * 建 v<N> 目录并以 FIGURE_OUT_DIR 运行脚本 → 扫产物 → 追加 history +
   * 原子写 manifest。预检失败（脚本不存在/越界/环境不可用）不落任何记录。
   */
  async renderFigure(input: {
    workspaceDir: string
    scriptPath: string
    title?: string
  }): Promise<FigureRenderResult> {
    const fail = (error: string): FigureRenderResult => ({
      ok: false, figureId: '', version: 0, exitCode: null, logTail: '', artifacts: [], latestPath: null, error,
    })
    const workspace = path.resolve(String(input.workspaceDir ?? ''))
    if (workspace === '') return fail('缺少工作区目录')
    const title = typeof input.title === 'string' ? input.title.trim() : ''

    // 脚本路径解析 + 防穿越（resolve 后必须仍在工作区内）
    const rawScript = String(input.scriptPath ?? '').trim()
    if (rawScript === '') return fail('缺少脚本路径 script_path')
    const scriptAbs = path.resolve(workspace, rawScript)
    if (!isInside(scriptAbs, workspace)) return fail(`脚本路径超出项目目录: ${rawScript}`)
    if (!fs.existsSync(scriptAbs) || !fs.statSync(scriptAbs).isFile()) {
      return fail(`绘图脚本不存在: ${scriptAbs}`)
    }

    // 项目解释器（不可用直接失败，不落任何版本记录）
    const exe = this.resolvePythonExe(workspace)
    if (exe === null) {
      return fail('项目 Python 环境不可用：请先创建环境（uv venv）并安装 matplotlib')
    }

    // 定位/创建图纸目录
    const figuresRoot = path.join(workspace, FIGURES_DIR_NAME)
    fs.mkdirSync(figuresRoot, { recursive: true })
    const figureId = this.findExistingFigureId(figuresRoot, scriptAbs) ?? newFigureId(title)
    const figureDir = path.join(figuresRoot, figureId)
    fs.mkdirSync(figureDir, { recursive: true })

    const manifest = this.readManifest(figureDir)
    const history = this.readHistory(figureDir)
    const nextVersion = history.reduce((max, v) => Math.max(max, v.version), 0) + 1
    const versionDir = path.join(figureDir, `v${nextVersion}`)
    fs.mkdirSync(versionDir, { recursive: true })

    // 运行脚本（cwd=脚本所在目录；FIGURE_OUT_DIR 指向本版输出目录）
    const now = Date.now()
    const env: Record<string, string | undefined> = {
      ...process.env,
      FIGURE_OUT_DIR: versionDir,
      PYTHONIOENCODING: 'utf-8',
    }
    let outcome: FigureRunnerOutcome
    try {
      outcome = await this.run({ exe, args: [scriptAbs], cwd: path.dirname(scriptAbs), env })
    } catch (error) {
      outcome = { exitCode: null, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
    }
    const ok = outcome.exitCode === 0
    const logTail = tailOf(`${outcome.stdout}\n${outcome.stderr}`)
    const artifacts = scanArtifacts(versionDir)

    // 每次尝试都进 history（含失败）
    const version: FigureVersion = {
      version: nextVersion,
      renderedAt: now,
      exitCode: outcome.exitCode,
      ok,
      logTail,
      artifacts,
    }
    this.appendHistory(figureDir, version)

    // 只有「成功且有产物」才推进 latest_*；否则保留上一成功版
    const promoted = ok && artifacts.length > 0
    const chosen = promoted ? preferredArtifact(artifacts) : null
    const thisLatestPath = promoted && chosen !== null ? path.join(versionDir, chosen) : null
    this.writeManifest(figureDir, {
      figure_id: figureId,
      title: title !== '' ? title : manifest?.title ?? '',
      script_path: scriptAbs,
      created_at: manifest?.created_at ?? now,
      updated_at: now,
      latest_version: promoted ? nextVersion : manifest?.latest_version ?? 0,
      latest_path: thisLatestPath ?? manifest?.latest_path ?? null,
    })

    const result: FigureRenderResult = {
      ok,
      figureId,
      version: nextVersion,
      exitCode: outcome.exitCode,
      logTail,
      artifacts,
      latestPath: thisLatestPath,
    }
    if (!ok) result.error = `渲染失败（退出码 ${outcome.exitCode === null ? 'null' : outcome.exitCode}），详见 log_tail`
    return result
  }

  /** 列出项目全部图纸（按 manifest.updated_at 降序；损坏条目跳过）。 */
  listFigures(workspaceDir: string): FigureInfo[] {
    const root = path.join(path.resolve(workspaceDir), FIGURES_DIR_NAME)
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      return []
    }
    const out: Array<{ info: FigureInfo; updatedAt: number }> = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const item = this.infoOf(root, entry.name)
      if (item !== undefined) out.push(item)
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt).map((item) => item.info)
  }

  /** 按 figureId 取单个图纸（manifest + history 还原 versions；非法 id 返回 undefined）。 */
  getFigure(workspaceDir: string, figureId: string): FigureInfo | undefined {
    const id = String(figureId ?? '')
    if (id === '' || id === '.' || id === '..' || id.includes('/') || id.includes('\\') || id.includes('\0')) {
      return undefined
    }
    const root = path.join(path.resolve(workspaceDir), FIGURES_DIR_NAME)
    return this.infoOf(root, id)?.info
  }
}

// ── 模型工具注册 ────────────────────────────────────────────────────────────

/** critique_figure 默认评审指令（论文图表标准）。 */
const CRITIQUE_INSTRUCTION =
  '请按学术论文图表标准评审这张图：坐标轴标签与刻度是否完整清晰、字号缩印后是否可读、' +
  '配色是否区分度高且色盲友好、信息密度是否恰当、图题/图例/单位是否齐全、中文是否存在乱码或字体缺字。' +
  '请逐条列出问题并给出具体改进建议。'

export interface FigureToolsDeps {
  service: FigureService
  dataRoot: string
  /** 视觉评审（host 接线 vision.analyzeImage）；未配置视觉模型时缺省 → 不注册 critique_figure。 */
  critiqueImage?: (imagePath: string, instruction: string) => Promise<string>
}

/** 从工具执行上下文推断工作区（与 memory/tools.ts 一致）。 */
function workspaceOf(exec: ToolRunContext): string {
  // Agent 直接持有 session（dsh-agent runtime-types）；经 agent.ctx.session 读取会因 cordis
  // 未注入 'session' 抛 "cannot get property session without inject"。
  const agent = (exec as { agent?: { session?: { header?: { cwd?: string } }; ctx?: { session?: { header?: { cwd?: string } } } } }).agent
  try {
    return agent?.session?.header?.cwd ?? ''
  } catch {
    return ''
  }
}

/** 构造一个 JSON Schema 参数定义。 */
function paramsSchema(properties: Record<string, unknown>, required: readonly string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false }
}

/** 文本输出渲染。 */
function textRender(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

/**
 * 注册论文图片工具（render_figure / list_figures / critique_figure）。
 * @returns 解除注册的 disposer。
 */
export function registerFigureTools(ctx: Context, deps: FigureToolsDeps): () => void {
  const tools = ctx.get('tools')
  if (!tools) return () => {}
  const disposers: Array<() => void> = []
  const register = (definition: ToolDefinition): void => {
    disposers.push(tools.register(definition))
  }

  // ── render_figure ─────────────────────────────────────────────────────────
  register({
    name: 'render_figure',
    description:
      '运行项目内的绘图脚本生成论文图片（在项目 .venv 的 Python 下执行；脚本通过环境变量 ' +
      'FIGURE_OUT_DIR 获取输出目录，把 PNG/SVG/PDF 写进去）。同一 figureId 重跑产生新版本，历史保留。',
    parameters: paramsSchema(
      {
        script_path: { type: 'string', description: '绘图脚本路径（相对当前项目目录或绝对路径）；脚本从环境变量 FIGURE_OUT_DIR 读取输出目录' },
        title: { type: 'string', description: '图题（可选；用于生成图纸 id 与展示）' },
      },
      ['script_path'],
    ),
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          figure_id: { type: 'string' },
          version: { type: 'number' },
          exit_code: { description: '进程退出码；null 表示超时或启动失败' },
          log_tail: { type: 'string' },
          artifacts: { type: 'array', items: { type: 'string' } },
          latest_path: { description: '本次成功版本的第一个产物绝对路径；无产物时为 null' },
          error: { type: 'string' },
        },
      },
      render: textRender,
    },
    execute: async (args, exec) => {
      const input = args as { script_path?: string; title?: string }
      const cwd = workspaceOf(exec)
      const result = await deps.service.renderFigure({
        workspaceDir: cwd !== '' ? cwd : deps.dataRoot,
        scriptPath: String(input.script_path ?? ''),
        title: input.title,
      })
      const out: Record<string, unknown> = {
        ok: result.ok,
        figure_id: result.figureId,
        version: result.version,
        exit_code: result.exitCode,
        log_tail: result.logTail,
        artifacts: [...result.artifacts],
        latest_path: result.latestPath,
      }
      if (result.error !== undefined) out['error'] = result.error
      return out
    },
  })

  // ── list_figures ──────────────────────────────────────────────────────────
  register({
    name: 'list_figures',
    description: '列出本项目全部图纸及其版本历史与最新产物路径。',
    parameters: paramsSchema({}),
    output: {
      schema: {
        type: 'object',
        properties: {
          figures: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                figure_id: { type: 'string' },
                title: { type: 'string' },
                latest_path: { description: '最新成功版本产物绝对路径；无则 null' },
                versions: { type: 'number', description: '版本数' },
                updated_at: { type: 'number', description: '更新时间（epoch 毫秒）' },
              },
            },
          },
        },
      },
      render: textRender,
    },
    execute: async (_args, exec) => {
      const cwd = workspaceOf(exec)
      const figures = deps.service.listFigures(cwd !== '' ? cwd : deps.dataRoot)
      return {
        figures: figures.map((f) => ({
          figure_id: f.figureId,
          title: f.title,
          latest_path: f.latestPath,
          versions: f.versions.length,
          updated_at: f.versions.length > 0 ? f.versions[f.versions.length - 1]?.renderedAt ?? 0 : 0,
        })),
      }
    },
  })

  // ── critique_figure（仅在配置了视觉评审时注册）────────────────────────────
  if (deps.critiqueImage !== undefined) {
    const critiqueImage = deps.critiqueImage
    register({
      name: 'critique_figure',
      description: '让视觉模型按论文图表标准评审一张图纸（坐标轴/字号/配色/信息密度/中文乱码），返回改进建议文本。',
      parameters: paramsSchema(
        { image_path: { type: 'string', description: '要评审的图片路径（绝对路径，或相对当前项目；可用 render_figure 返回的 latest_path）' } },
        ['image_path'],
      ),
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            analysis: { type: 'string' },
            error: { type: 'string' },
          },
        },
        render: textRender,
      },
      execute: async (args, exec) => {
        const input = args as { image_path?: string }
        const raw = String(input.image_path ?? '').trim()
        if (raw === '') return { ok: false, error: '缺少 image_path' }
        const cwd = workspaceOf(exec)
        const abs = path.isAbsolute(raw) ? raw : path.resolve(cwd !== '' ? cwd : deps.dataRoot, raw)
        try {
          const analysis = await critiqueImage(abs, CRITIQUE_INSTRUCTION)
          return { ok: true, analysis }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      },
    })
  }

  return () => {
    for (const dispose of disposers) dispose()
  }
}
