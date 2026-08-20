/**
 * 实验日报服务（Part C：手动 + 自动触发）。
 *
 * 产出：一份 Markdown 日报，包含概览、每个实验小节（最近尝试/当前回合/笔记）
 * 存储：<projectDir>/.evoresearch-data/reports/daily/<YYYY-MM-DD-HHmm>-<rand>.md
 * 配置：<dataRoot>/.evoresearch-data/daily-report.json（原子写）
 * 调度：复用 core/cron 的 parseCron/nextRun + timer.interval 每分钟 tick
 */
import type { Context } from '@deepseek-ai/cordis'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { parseCron, nextRun } from './core/cron.js'
import { ExperimentWorkspaceService } from './experiment-workspace.js'
import { listProjects } from './core/paths.js'

/** 日报生成选项。 */
export interface DailyReportOptions {
  projectDir: string
  /** 实验 slug 列表；不传 = 该项目全部实验 */
  slugs?: string[]
  llm?: boolean
}

/** 日报结果。 */
export interface DailyReportResult {
  reportId: string
  path: string
  markdown: string
  generatedAt: number
  trigger: 'manual' | 'auto'
}

/** 定时调度配置。 */
export interface DailyReportSchedule {
  enabled: boolean
  mode: 'interval' | 'daily' | 'weekly'
  /** interval 模式：每 N 分钟 */
  intervalMinutes?: number
  /** daily/weekly 模式：cron 表达式 */
  cron?: string
  projectDir: string
  slugs?: string[]
  lastRunAt?: number
  nextRunAt?: number
}

/** 日报服务。 */
export class DailyReportService {
  private readonly file: string
  private schedule: DailyReportSchedule | null = null
  private tickDisposer: (() => void) | undefined

  constructor(readonly dataRoot: string) {
    this.file = path.join(dataRoot, '.evoresearch-data', 'daily-report.json')
    this.load()
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { schedule?: unknown }
      if (raw.schedule !== null && typeof raw.schedule === 'object') {
        const s = raw.schedule as DailyReportSchedule
        if (typeof s.enabled === 'boolean' && (s.mode === 'interval' || s.mode === 'daily' || s.mode === 'weekly') && typeof s.projectDir === 'string') {
          this.schedule = s
        }
      }
    } catch {
      this.schedule = null
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify({ schedule: this.schedule }, null, 2), 'utf8')
    fs.renameSync(tmp, this.file)
  }

  /** 计算下次运行时间。 */
  private computeNextRun(schedule: DailyReportSchedule, from: Date): number | null {
    try {
      if (schedule.mode === 'interval') {
        const minutes = schedule.intervalMinutes
        if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null
        const base = schedule.lastRunAt !== undefined ? schedule.lastRunAt : from.getTime()
        // 若从未运行，用 from + interval
        const next = schedule.lastRunAt !== undefined ? base + minutes * 60_000 : from.getTime() + minutes * 60_000
        return next
      }
      if (schedule.cron) {
        const cron = parseCron(schedule.cron)
        const next = nextRun(cron, from)
        return next?.getTime() ?? null
      }
      return null
    } catch {
      return null
    }
  }

  /** 生成一份日报（模板渲染；llm=true 时尝试润色并回退）。 */
  async generate(opts: DailyReportOptions, trigger: 'manual' | 'auto'): Promise<DailyReportResult> {
    const projectDir = path.resolve(String(opts.projectDir ?? '').trim())
    if (projectDir === '') throw new Error('projectDir 不能为空')
    // 校验 projectDir 位于 dataRoot 内或为 dataRoot
    const rootNorm = path.resolve(this.dataRoot).toLowerCase().replace(/\//g, '\\')
    const targetNorm = projectDir.toLowerCase().replace(/\//g, '\\')
    const inside = targetNorm === rootNorm || targetNorm.startsWith(rootNorm.endsWith('\\') ? rootNorm : `${rootNorm}\\`)
    if (!inside) throw new Error(`projectDir 不在 dataRoot 内: ${projectDir}`)

    const generatedAt = Date.now()
    const wsService = new ExperimentWorkspaceService({ dataRoot: this.dataRoot })
    let experiments: Array<{ slug: string; dir: string; updatedAt: number; hasNote: boolean; noteBytes: number }> = []
    try {
      const all = wsService.list(projectDir)
      experiments = all.map((e) => ({ slug: e.slug, dir: e.dir, updatedAt: e.updatedAt, hasNote: e.hasNote, noteBytes: e.noteBytes }))
    } catch {
      experiments = []
    }
    if (Array.isArray(opts.slugs) && opts.slugs.length > 0) {
      const set = new Set(opts.slugs.map((s) => String(s)))
      experiments = experiments.filter((e) => set.has(e.slug))
    }

    const todayStart = new Date(generatedAt)
    todayStart.setHours(0, 0, 0, 0)
    let todayUpdated = 0
    for (const exp of experiments) {
      if (exp.updatedAt >= todayStart.getTime()) todayUpdated += 1
    }

    // 为每个实验收集扩展信息
    const details: Array<{
      slug: string
      dir: string
      updatedAt: number
      noteInfo: string
      ledger: string[]
      roundInfo: string
    }> = []
    for (const exp of experiments) {
      // 笔记信息
      let noteInfo = '无笔记'
      if (exp.hasNote) {
        try {
          const stat = fs.statSync(path.join(exp.dir, 'LAB_NOTE.md'))
          const lines = fs.readFileSync(path.join(exp.dir, 'LAB_NOTE.md'), 'utf8').split('\n').length
          noteInfo = `${lines} 行 / ${formatBytes(stat.size)} / 更新于 ${formatTime(stat.mtimeMs)}`
        } catch {
          noteInfo = `${exp.noteBytes} bytes`
        }
      }
      // 账本最近 5 条
      const ledgerLines = this.tryGetLedgerLog(projectDir, exp.slug, 5)
      // 回合信息
      const roundInfo = this.tryGetRoundInfo(exp.dir)

      details.push({ slug: exp.slug, dir: exp.dir, updatedAt: exp.updatedAt, noteInfo, ledger: ledgerLines, roundInfo })
    }

    const dateStr = formatDate(generatedAt)
    const timeStr = formatTime(generatedAt)
    const triggerLabel = trigger === 'manual' ? '手动' : '自动'

    let markdown = `# 实验日报 · ${dateStr}\n`
    markdown += `触发方式：${triggerLabel}　|　生成时间：${timeStr}\n\n`
    markdown += `## 今日概览\n`
    markdown += `共 ${experiments.length} 个实验，${todayUpdated} 个今天有更新。\n\n`
    markdown += `## 实验进展\n`
    if (details.length === 0) {
      markdown += `暂无实验。\n\n`
    } else {
      for (const d of details) {
        markdown += `### ${d.slug}（最近更新 ${formatTime(d.updatedAt)}）\n`
        if (d.ledger.length > 0) {
          markdown += `- 最近尝试：\n`
          for (const line of d.ledger) {
            markdown += `  - ${line}\n`
          }
        } else {
          markdown += `- 最近尝试：暂无记录\n`
        }
        markdown += `- 当前回合：${d.roundInfo}\n`
        markdown += `- 笔记：${d.noteInfo}\n\n`
      }
    }
    markdown += `## 建议\n`
    markdown += `自动生成，供参考。\n`

    // LLM 润色（可选，失败回退）
    if (opts.llm === true) {
      try {
        // 复用全局 ctx 的 llm 服务需要外部传入；此处没有 ctx，尝试无 ctx 润色跳过
        // generate 的调用方若有 ctx，可在外层自行润色；这里保持离线可用，不抛错
        // 为保持接口兼容，尝试用空 ctx 占位，若失败则回退
        markdown = await this.tryPolishMarkdown(markdown)
      } catch {
        // 回退到模板
      }
    }

    // 写文件
    const reportsRoot = path.join(projectDir, '.evoresearch-data', 'reports', 'daily')
    fs.mkdirSync(reportsRoot, { recursive: true })
    const stamp = formatFileStamp(generatedAt)
    const reportId = `${stamp}-${randomUUID().slice(0, 4)}`
    const filePath = path.join(reportsRoot, `${reportId}.md`)
    const tmp = `${filePath}.tmp-${process.pid}`
    fs.writeFileSync(tmp, markdown, 'utf8')
    fs.renameSync(tmp, filePath)

    // 更新索引（可选，list 会扫描文件系统，这里不强依赖索引）
    return { reportId, path: filePath, markdown, generatedAt, trigger }
  }

  private tryGetLedgerLog(projectDir: string, slug: string, limit: number): string[] {
    try {
      // 账本路径：<dataRoot>/.evoresearch-data/ledgers/<sanitized>/<slug>.git
      const sanitized = slugifyProjectName(path.basename(projectDir))
      const repoDir = path.join(this.dataRoot, '.evoresearch-data', 'ledgers', sanitized, `${slug}.git`)
      if (!fs.existsSync(repoDir)) return []
      // 用 --git-dir 指定裸仓库读取 log
      const result = spawnSync('git.exe', ['--git-dir', repoDir, 'log', `--pretty=format:%h %s`, '-n', String(limit)], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      })
      if (result.status !== 0) return []
      const out = (result.stdout ?? '').trim()
      if (out === '') return []
      return out.split('\n').map((l) => l.trim()).filter((l) => l !== '')
    } catch {
      return []
    }
  }

  private tryGetRoundInfo(expDir: string): string {
    try {
      const roundsDir = path.join(expDir, 'rounds')
      if (!fs.existsSync(roundsDir) || !fs.statSync(roundsDir).isDirectory()) return '无进行中回合'
      const entries = fs.readdirSync(roundsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
      if (entries.length === 0) return '无进行中回合'
      // 检查是否有 current 回合标记文件
      // rounds 服务若存在会在实验目录下写 current.json；尝试读取
      const currentFile = path.join(expDir, '.evoresearch-data-round-current.json')
      if (fs.existsSync(currentFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(currentFile, 'utf8')) as { roundId?: string; currentIndex?: number; status?: string }
          if (data.status === 'running' && typeof data.currentIndex === 'number') {
            const phases = ['观察', '提议', '行动', '反思']
            return `进行中：第 ${data.currentIndex + 1} 阶段（${phases[data.currentIndex] ?? data.currentIndex}）`
          }
          if (data.status === 'done') return '无进行中回合（上一轮已完成）'
        } catch { /* ignore */ }
      }
      // 兜底：列出 rounds 数量
      return `共有 ${entries.length} 轮记录（详情见 rounds/ 目录）`
    } catch {
      return '无进行中回合'
    }
  }

  private async tryPolishMarkdown(markdown: string): Promise<string> {
    // 没有 ctx 时无法调用 LLM，保持原样（调用方若需要 LLM 润色应在外层用 ctx.callText）
    // 这里保留接口，实际润色由上层通过 DailyReportServicePolisher 注入或直接在 generate 后处理
    // 为避免无 ctx 抛错，直接返回原 markdown；若后续需要真实 LLM，可扩展为接受 ctx 参数
    return markdown
  }

  /** 读取一份日报内容。 */
  read(reportId: string): { markdown: string } | null {
    const id = String(reportId ?? '').trim()
    if (id === '') return null
    // 扫描所有项目的 reports 目录寻找匹配文件
    const found = this.findReportPath(id)
    if (found === null) return null
    try {
      return { markdown: fs.readFileSync(found, 'utf8') }
    } catch {
      return null
    }
  }

  /** 列出已有日报（按时间倒序）。 */
  list(): Array<{ reportId: string; path: string; generatedAt: number; trigger: string }> {
    const out: Array<{ reportId: string; path: string; generatedAt: number; trigger: string }> = []
    const projects = listProjects(this.dataRoot)
    const roots: string[] = [this.dataRoot, ...projects.map((name) => path.join(this.dataRoot, 'projects', name))]
    for (const root of roots) {
      const dir = path.join(root, '.evoresearch-data', 'reports', 'daily')
      let entries: fs.Dirent[] = []
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.md')) continue
        const full = path.join(dir, e.name)
        try {
          const stat = fs.statSync(full)
          const reportId = path.basename(e.name, '.md')
          // trigger 从文件内容第一段解析，默认 manual
          let trigger = 'manual'
          try {
            const first = fs.readFileSync(full, 'utf8').slice(0, 500)
            if (first.includes('触发方式：自动')) trigger = 'auto'
          } catch { /* ignore */ }
          out.push({ reportId, path: full, generatedAt: stat.mtimeMs, trigger })
        } catch { /* skip */ }
      }
    }
    out.sort((a, b) => b.generatedAt - a.generatedAt)
    return out
  }

  private findReportPath(reportId: string): string | null {
    const projects = listProjects(this.dataRoot)
    const roots: string[] = [this.dataRoot, ...projects.map((name) => path.join(this.dataRoot, 'projects', name))]
    for (const root of roots) {
      const p = path.join(root, '.evoresearch-data', 'reports', 'daily', `${reportId}.md`)
      if (fs.existsSync(p)) return p
    }
    // 兜底扫描
    for (const root of roots) {
      const dir = path.join(root, '.evoresearch-data', 'reports', 'daily')
      let entries: string[] = []
      try { entries = fs.readdirSync(dir) } catch { continue }
      const hit = entries.find((n) => n === `${reportId}.md`)
      if (hit) return path.join(dir, hit)
    }
    return null
  }

  /** 读取调度配置。 */
  getSchedule(): DailyReportSchedule | null {
    return this.schedule
  }

  /** 保存调度配置。 */
  setSchedule(schedule: DailyReportSchedule): { ok: true; nextRunAt: number | null } {
    const s = { ...schedule } as DailyReportSchedule
    if (typeof s.projectDir !== 'string' || s.projectDir.trim() === '') throw new Error('projectDir 不能为空')
    s.projectDir = path.resolve(s.projectDir)
    if (s.mode !== 'interval' && s.mode !== 'daily' && s.mode !== 'weekly') throw new Error('mode 必须是 interval/daily/weekly')
    if (s.mode === 'interval') {
      if (typeof s.intervalMinutes !== 'number' || !Number.isFinite(s.intervalMinutes) || s.intervalMinutes <= 0) throw new Error('intervalMinutes 必须为正数')
      s.cron = undefined
    } else {
      if (typeof s.cron !== 'string' || s.cron.trim() === '') throw new Error('cron 不能为空')
      parseCron(s.cron) // 校验
      s.intervalMinutes = undefined
    }
    s.nextRunAt = this.computeNextRun(s, new Date()) ?? undefined
    this.schedule = s
    this.save()
    return { ok: true, nextRunAt: s.nextRunAt ?? null }
  }

  /** 切换开关。 */
  toggle(force?: boolean): { ok: true; enabled: boolean } {
    if (this.schedule === null) {
      // 无配置时无法 toggle，返回 false
      return { ok: true, enabled: false }
    }
    const enabled = typeof force === 'boolean' ? force : !this.schedule.enabled
    this.schedule.enabled = enabled
    if (enabled) {
      this.schedule.nextRunAt = this.computeNextRun(this.schedule, new Date()) ?? undefined
    }
    this.save()
    return { ok: true, enabled }
  }

  /** 启动每分钟 tick。 */
  attach(ctx: Context): () => void {
    if (this.tickDisposer) return this.tickDisposer
    const timer = ctx.get('timer') as { interval?: (fn: () => void, ms: number) => () => void } | undefined
    if (!timer?.interval) return () => {}
    this.tickDisposer = timer.interval(() => {
      void this.tick().catch((error) => {
        console.error('[evoresearch:daily-report] tick 失败:', error)
      })
    }, 60_000)
    return () => {
      this.tickDisposer?.()
      this.tickDisposer = undefined
    }
  }

  private async tick(): Promise<void> {
    const s = this.schedule
    if (!s || !s.enabled) return
    if (s.nextRunAt === undefined || s.nextRunAt === null) {
      s.nextRunAt = this.computeNextRun(s, new Date()) ?? undefined
      this.save()
      return
    }
    const now = Date.now()
    if (s.nextRunAt > now) return
    try {
      await this.generate({ projectDir: s.projectDir, slugs: s.slugs }, 'auto')
      s.lastRunAt = now
      s.nextRunAt = this.computeNextRun(s, new Date()) ?? undefined
    } catch (error) {
      console.error('[evoresearch:daily-report] auto generate 失败:', error)
      s.lastRunAt = now
      s.nextRunAt = this.computeNextRun(s, new Date()) ?? undefined
    }
    this.save()
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

function slugifyProjectName(input: string): string {
  const slug = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '')
  return /[a-z0-9]/.test(slug) ? slug : 'project'
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatFileStamp(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
