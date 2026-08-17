/**
 * 实验进程服务（§7.2 运行账本；§15.7 EXP-05..12）。
 *
 * 职责：启动/停止实验进程，把「运行了什么、在哪跑、用哪个 Python、对应哪个
 * Git commit、日志在哪、进程是否还在」自动记入运行账本，并提供日志流式读取、
 * 重启恢复识别、复盘草稿与 Chat Graph 引用解析。
 *
 * 数据位置（EXP-05，论证）：
 * - 运行账本：<expDir>/.evoresearch-run.json（与导入侧车一致，随实验目录走）。
 *   理由：账本是实验目录的一部分——目录即真相（零中心索引）；实验目录被复制/
 *   迁移/备份时账本与日志、产物一起走；旧 manifest 体系（.evoresearch-data/
 *   experiments/<id>.json）不受影响。账本内容只读、可重建（重建=丢失历史），
 *   不会因本服务而删除任何用户文件。
 * - 完整日志：<expDir>/stdout.log、<expDir>/stderr.log（EXP-06，实时追加写）。
 *
 * 状态机（EXP-07）：
 *   running → success（自然退出码 0）
 *           → failed（自然退出码非 0，或 spawn 失败）
 *           → user-stopped（经 stop() 主动停止；停止前先落 stopRequested）
 *           → unknown（非我们停止的异常消失：外部 kill、重启后无法确认归属）
 *   停止区分：我们发起的停止 = user-stopped；自然退出 = success/failed；
 *   其余（close 无退出码 + 有 signal，或重启后 PID/命令行不匹配）= unknown，
 *   绝不伪造完成。
 *
 * 重启恢复（EXP-08）：restartRecovery() 对每个 running 记录重探 PID：
 * - 进程存在且命令行匹配（PID+cmdline 双确认，防 PID 复用）→ 保持 running，
 *   记 recoveredAt/recoveredNote，可继续 stop；
 * - 进程存在但命令行不匹配 → unknown（PID 可能被复用），不伪造完成；
 * - 进程不存在 → 按 stderr 尾部失败标记保守推断 failed，否则 unknown。
 *
 * EXP-09/10：结果文件由脚本写入实验目录（约定 artifacts/），实验视图经
 * experiment-workspace.artifacts() 列出；用户/Agent 自然语言解释经
 * appendNote() 只追加进 LAB_NOTE.md；复盘草稿 retrospectiveDraft() 只生成
 * 文本（可选落 .evoresearch-retrospective.draft.md），用户确认后才写笔记。
 *
 * EXP-11：resolveGraphRef() 为 Chat Graph 的 ref 提供 path 解析（数据接口；
 * 由实验服务统一接线。
 *
 * EXP-12（§7.6）：实验运行期间不设任何状态门禁——论文编辑/编译、其他聊天在
 * 实验 running 时完全可用；本服务不因实验状态拒绝任何操作，状态只用于展示、
 * 停止与复盘。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { normPath, validateWorkspace } from './core/paths.js'
import { ExperimentWorkspaceService } from './experiment-workspace.js'

/** 运行账本文件名（位于实验目录内）。 */
export const RUN_LEDGER_NAME = '.evoresearch-run.json'
/** 复盘草稿文件名（可选落盘，用户确认前不算笔记）。 */
export const RETROSPECTIVE_DRAFT_NAME = '.evoresearch-retrospective.draft.md'
/** 账本最多保留的运行记录数（running 的始终保留）。 */
export const RUN_MAX_KEPT = 20
/** 单次日志读取上限（offset/limit 分页保护）。 */
export const LOG_MAX_CHUNK = 1024 * 1024
/** 复盘草稿引用的日志尾部字节数。 */
export const DRAFT_LOG_TAIL = 4096

// ── 类型 ────────────────────────────────────────────────────────────────────

/** 运行状态（EXP-07 状态机）。 */
export type RunStatus = 'running' | 'success' | 'failed' | 'user-stopped' | 'unknown'

const RUN_STATUSES: readonly RunStatus[] = ['running', 'success', 'failed', 'user-stopped', 'unknown']

/** 一条运行账本记录（§7.2 最低限度运行信息）。 */
export interface RunRecord {
  readonly runId: string
  /** 用户/Agent 提交的命令文本（shell 解析）。 */
  readonly command: string
  /** 实际 spawn 的 argv（win32: <ComSpec> /d /s /c <command>；其余: sh -c）。 */
  readonly argv: readonly string[]
  /** 运行目录。 */
  readonly cwd: string
  /** 使用的 Python 解释器路径（project-env 提供，仅记录用于复现）。 */
  readonly pythonPath: string | null
  /** 启动时的 Git commit（cwd 内 git rev-parse HEAD，非 git 仓库为 null）。 */
  readonly gitCommit: string | null
  readonly startedAt: number
  readonly pid: number | null
  readonly status: RunStatus
  readonly exitCode: number | null
  /** 自然退出时的 signal（非我们停止；Windows 通常 null）。 */
  readonly exitSignal: string | null
  /** spawn 失败错误信息（如 ENOENT）。 */
  readonly error: string | null
  /** 是否由 stop() 主动发起停止（重启恢复据此区分 user-stopped）。 */
  readonly stopRequested: boolean
  readonly stoppedBy: 'user' | null
  readonly endedAt: number | null
  /** 日志文件名（相对实验目录）。 */
  readonly stdoutLog: string
  readonly stderrLog: string
  /** 重启恢复时间与说明（EXP-08）。 */
  readonly recoveredAt: number | null
  readonly recoveredNote: string | null
}

/** 运行账本文件结构。 */
export interface RunLedger {
  readonly version: number
  /** 时间序（旧 → 新）。 */
  readonly runs: readonly RunRecord[]
}

/** 启动一次实验运行（EXP-05）。 */
export interface RunSpec {
  /** 命令文本（shell 解析）。 */
  readonly command: string
  /** 运行目录（默认实验目录；必须位于工作区内）。 */
  readonly cwd?: string
  /** Python 解释器路径（project-env 提供，仅记录）。 */
  readonly pythonPath?: string
  /** 附加环境变量（合并进 process.env）。 */
  readonly env?: Readonly<Record<string, string>>
}

/** 进程探针（EXP-08；测试可注入假探针）。 */
export interface ProcessProbe {
  alive(pid: number): boolean
  /** 进程命令行（读不到返回 null）。 */
  commandLine(pid: number): string | null
}

/** spawn 注入点（测试用）。 */
export interface SpawnFn {
  (file: string, args: readonly string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): ChildProcess
}

/** 进程结束信息（close/error 事件）。 */
export interface ExitOutcome {
  readonly exitCode: number | null
  readonly exitSignal: string | null
  readonly error: string | null
}

/** Chat Graph 实验引用（EXP-11 数据接口）。 */
export interface ExperimentGraphRef {
  readonly type: 'experiment' | 'log' | 'artifact' | 'note'
  readonly workspaceDir: string
  readonly slug: string
  /** type=log 时：stdout | stderr（默认 stdout）。 */
  readonly stream?: 'stdout' | 'stderr'
  /** type=artifact 时：相对实验目录的路径（须解析回实验目录内）。 */
  readonly relPath?: string
}

/** Chat Graph 引用解析结果（EXP-11）。 */
export interface ExperimentGraphRefResolution {
  readonly kind: 'experiment' | 'log' | 'artifact' | 'note'
  readonly path: string
  readonly title: string
}

export interface ExperimentProcessConfig {
  readonly dataRoot: string
  /** 注入工作区服务（测试用）；默认内部创建。 */
  readonly workspace?: ExperimentWorkspaceService
  /** 注入 spawn（测试用）；默认 node:child_process.spawn。 */
  readonly spawnImpl?: SpawnFn
  /** 注入进程探针（测试用）；默认系统探针。 */
  readonly probe?: ProcessProbe
  /** 注入杀进程实现（测试用）；默认 win32 taskkill /T /F，其余 SIGTERM。 */
  readonly killImpl?: (pid: number) => boolean
}

// ── 纯函数（EXP-14 单测覆盖）──────────────────────────────────────────────

/** 容错解析账本 JSON（损坏/非法条目 → 空或过滤；非法 status 归一为 unknown）。 */
export function parseRunLedger(text: string): RunLedger {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { version: 1, runs: [] }
  }
  if (typeof raw !== 'object' || raw === null) return { version: 1, runs: [] }
  const obj = raw as Record<string, unknown>
  const runs = Array.isArray(obj.runs) ? obj.runs.map(normalizeRun).filter((r): r is RunRecord => r !== null) : []
  return { version: typeof obj.version === 'number' ? obj.version : 1, runs }
}

function normalizeRun(value: unknown): RunRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  if (typeof r.runId !== 'string' || typeof r.command !== 'string') return null
  const status = RUN_STATUSES.includes(r.status as RunStatus) ? r.status as RunStatus : 'unknown'
  return {
    runId: r.runId,
    command: r.command,
    argv: Array.isArray(r.argv) ? r.argv.map(String) : [],
    cwd: typeof r.cwd === 'string' ? r.cwd : '',
    pythonPath: typeof r.pythonPath === 'string' ? r.pythonPath : null,
    gitCommit: typeof r.gitCommit === 'string' ? r.gitCommit : null,
    startedAt: typeof r.startedAt === 'number' ? r.startedAt : 0,
    pid: typeof r.pid === 'number' ? r.pid : null,
    status,
    exitCode: typeof r.exitCode === 'number' ? r.exitCode : null,
    exitSignal: typeof r.exitSignal === 'string' ? r.exitSignal : null,
    error: typeof r.error === 'string' ? r.error : null,
    stopRequested: r.stopRequested === true,
    stoppedBy: r.stoppedBy === 'user' ? 'user' : null,
    endedAt: typeof r.endedAt === 'number' ? r.endedAt : null,
    stdoutLog: typeof r.stdoutLog === 'string' ? r.stdoutLog : 'stdout.log',
    stderrLog: typeof r.stderrLog === 'string' ? r.stderrLog : 'stderr.log',
    recoveredAt: typeof r.recoveredAt === 'number' ? r.recoveredAt : null,
    recoveredNote: typeof r.recoveredNote === 'string' ? r.recoveredNote : null,
  }
}

export function serializeRunLedger(ledger: RunLedger): string {
  return `${JSON.stringify(ledger, null, 2)}\n`
}

/** 账本上限裁剪：running 恒保留，其余按时间保留最新的 max 条。 */
export function pruneRuns(runs: readonly RunRecord[], max = RUN_MAX_KEPT): RunRecord[] {
  const done = runs.filter((r) => r.status !== 'running')
  const keepDone = Math.max(0, max - runs.filter((r) => r.status === 'running').length)
  const keptDone = new Set(done.slice(Math.max(0, done.length - keepDone)).map((run) => run.runId))
  // Preserve ledger chronology. Reordering running records makes status.latest
  // point at an older completed run when a short-lived run is started.
  return runs.filter((run) => run.status === 'running' || keptDone.has(run.runId))
}

/** 状态机（EXP-07）：根据结束信息 + 是否主动停止决定终态。 */
export function decideExitStatus(stopRequested: boolean, outcome: ExitOutcome): RunStatus {
  if (stopRequested) return 'user-stopped'
  if (outcome.error !== null) return 'failed'
  if (outcome.exitCode === 0) return 'success'
  if (outcome.exitCode !== null) return 'failed'
  if (outcome.exitSignal !== null) return 'unknown'
  return 'unknown'
}

/** 终结一条运行记录（纯函数；endedAt=now）。 */
export function finalizeRun(record: RunRecord, outcome: ExitOutcome, now = Date.now()): RunRecord {
  const status = decideExitStatus(record.stopRequested, outcome)
  return {
    ...record,
    status,
    exitCode: outcome.exitCode,
    exitSignal: outcome.exitSignal,
    error: outcome.error ?? record.error,
    stoppedBy: status === 'user-stopped' ? 'user' : record.stoppedBy,
    endedAt: now,
  }
}

/** 记录命令与进程实际命令行的归属匹配（EXP-08；启发式，大小写可按平台忽略）。 */
export function commandLineMatches(record: RunRecord, actualCommandLine: string, opts?: { caseInsensitive?: boolean }): boolean {
  const actual = String(actualCommandLine ?? '')
  if (actual.trim() === '') return false
  const insensitive = opts?.caseInsensitive ?? process.platform === 'win32'
  const norm = (s: string): string => (insensitive ? s.toLowerCase() : s)
  const a = norm(actual)
  const tokens = matchTokensOf(record)
  if (tokens.length === 0) return false
  return tokens.every((t) => a.includes(norm(t)))
}

/** 匹配 token：shell 模式取命令前 3 个非选项/非操作符 token 的 basename；直接模式取 exe + 首个非选项参数。 */
function matchTokensOf(record: RunRecord): string[] {
  const argv = record.argv
  const exe = argv[0]
  if (exe !== undefined) {
    const exeBase = basenameOf(exe)
    const shell = exeBase === 'cmd' || exeBase === 'cmd.exe' || exeBase === 'sh' || exeBase === 'bash'
    if (shell) {
      return record.command
        .split(/\s+/)
        .map((t) => t.replace(/^["']+|["']+$/g, ''))
        .filter((t) => t !== '' && !t.startsWith('-') && !/^[<>&|;()]+$/.test(t))
        .slice(0, 3)
        .map(basenameOf)
    }
    const out = [exeBase]
    const arg1 = argv[1]
    if (arg1 !== undefined && !arg1.startsWith('-')) out.push(basenameOf(arg1))
    return out
  }
  return []
}

function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

/** 保守失败标记（重启恢复时用于从日志尾部推断；宁缺毋滥）。 */
const FAILURE_MARKERS: readonly RegExp[] = [
  /Traceback \(most recent call last\)/,
  /\bFATAL\b/i,
  /\bAssertionError\b/,
]

/** 从日志尾部推断失败（无明确标记返回 null → 由调用方标 unknown）。 */
export function inferStatusFromLogTail(tail: string): 'failed' | null {
  const text = String(tail ?? '')
  for (const re of FAILURE_MARKERS) {
    if (re.test(text)) return 'failed'
  }
  return null
}

/** 重启恢复探针结果。 */
export interface RestartProbeResult {
  readonly alive: boolean
  readonly commandLine: string | null
}

/** 重启恢复分类（EXP-08；非 running 记录返回 null=不变）。 */
export function classifyAfterRestart(record: RunRecord, probe: RestartProbeResult, opts?: { logTail?: string }): RestartClassification | null {
  if (record.status !== 'running') return null
  if (!probe.alive) {
    const inferred = inferStatusFromLogTail(opts?.logTail ?? '')
    if (inferred !== null) return { status: inferred, note: '进程已不存在；按日志尾部失败标记保守推断为失败' }
    return { status: 'unknown', note: '进程已不存在且日志无明确失败标记，无法确认结果' }
  }
  if (probe.commandLine === null) return { status: 'unknown', note: '进程存在但无法读取命令行，无法确认归属' }
  if (commandLineMatches(record, probe.commandLine)) {
    return { status: 'running', note: 'PID 存活且命令行匹配，确认归属（已重新挂接，可停止）' }
  }
  return { status: 'unknown', note: 'PID 存活但命令行不匹配（可能 PID 被复用），不伪造完成' }
}

export interface RestartClassification {
  readonly status: RunStatus
  readonly note: string
}

/** 日志切片（EXP-06 纯函数）：offset/limit 分页，或 tail 取尾部（对齐行边界）。 */
export interface LogSliceOptions {
  readonly offset?: number
  readonly limit?: number
  readonly tail?: number
}

export interface LogSlice {
  readonly text: string
  /** 下一次读取的字节偏移（== size 表示已到文件尾）。 */
  readonly nextOffset: number
  readonly eof: boolean
}

export function sliceLog(content: Buffer, opts: LogSliceOptions = {}): LogSlice {
  const size = content.length
  if (size === 0) return { text: '', nextOffset: 0, eof: true }
  if (opts.tail !== undefined) {
    const n = Math.max(0, Math.floor(opts.tail))
    if (n === 0) return { text: '', nextOffset: size, eof: true }
    const start = Math.max(0, size - n)
    // 窗口从文件头开始 → 本身就是行边界，直接返回全部
    if (start === 0) return { text: content.toString('utf8'), nextOffset: size, eof: true }
    // 窗口起点前一字节是换行 → 起点即行首；否则跳到窗口内第一个换行之后
    const window = content.subarray(start)
    const prevNl = content[start - 1] === 0x0a
    const nl = prevNl ? -1 : window.indexOf(0x0a)
    const from = start + (nl >= 0 ? nl + 1 : 0)
    return { text: content.subarray(from).toString('utf8'), nextOffset: size, eof: true }
  }
  const offset = Math.max(0, Math.floor(opts.offset ?? 0))
  if (offset >= size) return { text: '', nextOffset: size, eof: true }
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? LOG_MAX_CHUNK)), LOG_MAX_CHUNK)
  const end = Math.min(size, offset + limit)
  return { text: content.subarray(offset, end).toString('utf8'), nextOffset: end, eof: end >= size }
}

/** 复盘草稿生成（EXP-10 纯函数）：只生成文本，不写笔记。 */
export interface RetrospectiveDraftInput {
  readonly name: string
  readonly runs: readonly RunRecord[]
  readonly stderrTail: string
  readonly stdoutTail: string
  readonly now?: number
}

export function buildRetrospectiveDraft(input: RetrospectiveDraftInput): string {
  const now = input.now ?? Date.now()
  const statusText: Record<RunStatus, string> = {
    running: '运行中',
    success: '成功',
    failed: '失败',
    'user-stopped': '用户停止',
    unknown: '未知',
  }
  const lines: string[] = []
  lines.push('## 实验复盘（草稿，待确认）')
  lines.push('')
  lines.push(`实验：${input.name}（生成于 ${new Date(now).toISOString()}）`)
  lines.push('')
  if (input.runs.length === 0) {
    lines.push('（本实验暂无运行记录）')
  } else {
    lines.push('### 运行记录')
    for (const run of input.runs) {
      const dur = run.endedAt !== null
        ? `${Math.max(0, Math.round((run.endedAt - run.startedAt) / 1000))}s`
        : '仍在运行'
      lines.push(`- \`${run.command}\` — ${statusText[run.status] ?? run.status}，退出码 ${run.exitCode ?? '—'}，耗时 ${dur}（${new Date(run.startedAt).toISOString()}）`)
    }
  }
  if (String(input.stderrTail).trim() !== '') {
    lines.push('')
    lines.push('### 最近 stderr（尾部）')
    lines.push('```text')
    lines.push(String(input.stderrTail).trimEnd())
    lines.push('```')
  }
  lines.push('')
  lines.push('### 观察与下一步')
  lines.push('（确认前由用户/Agent 在此补充观察；确认后经 appendNote 写入 LAB_NOTE.md，用户文字不被覆盖）')
  return `${lines.join('\n')}\n`
}

/** 解析相对实验目录的路径（EXP-11 安全防护）：必须解析回目录内，否则抛错。 */
export function resolveExperimentRelativePath(baseDir: string, relPath: string): string {
  const rel = String(relPath ?? '')
  if (rel === '' || rel === '.' || rel === '..') throw new Error(`非法的实验相对路径: ${relPath}`)
  const base = path.resolve(baseDir)
  const resolved = path.resolve(base, rel)
  const nb = normPath(base)
  if (normPath(resolved) !== nb && !normPath(resolved).startsWith(nb.endsWith(path.sep) ? nb : `${nb}${path.sep}`)) {
    throw new Error(`路径超出实验目录: ${relPath}`)
  }
  return resolved
}

// ── 默认实现（进程/探针/杀进程）───────────────────────────────────────────

function defaultSpawn(file: string, args: readonly string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): ChildProcess {
  return spawn(file, [...args], { cwd: opts.cwd, env: opts.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
}

/** 默认进程探针：win32 用 PowerShell CIM 读命令行；POSIX 读 /proc/<pid>/cmdline。 */
export function defaultProbe(): ProcessProbe {
  return {
    alive(pid: number): boolean {
      try {
        process.kill(pid, 0)
        return true
      } catch (error) {
        return (error as NodeJS.ErrnoException)?.code === 'EPERM'
      }
    },
    commandLine(pid: number): string | null {
      if (process.platform === 'win32') {
        try {
          const r = spawnSync('powershell', [
            '-NoProfile', '-NonInteractive', '-Command',
            `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
          ], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
          if (r.status !== 0) return null
          const out = (r.stdout ?? '').trim()
          return out === '' ? null : out
        } catch {
          return null
        }
      }
      try {
        const out = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim()
        return out === '' ? null : out
      } catch {
        return null
      }
    },
  }
}

/** 默认杀进程：win32 用 taskkill /T /F（连进程树一起停）；其余 SIGTERM。 */
function defaultKill(pid: number): boolean {
  if (process.platform === 'win32') {
    try {
      const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      return r.status === 0
    } catch {
      return false
    }
  }
  try {
    process.kill(pid, 'SIGTERM')
    return true
  } catch {
    return false
  }
}

function gitRevParse(cwd: string): string | null {
  try {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', windowsHide: true, timeout: 5000 })
    if (r.status !== 0) return null
    const out = (r.stdout ?? '').trim()
    return /^[0-9a-f]{40}$/.test(out) ? out : null
  } catch {
    return null
  }
}

function isInsidePath(a: string, b: string): boolean {
  const na = normPath(a)
  const nb = normPath(b)
  return na === nb || na.startsWith(nb.endsWith(path.sep) ? nb : `${nb}${path.sep}`)
}

// ── 服务 ────────────────────────────────────────────────────────────────────

/** 实验进程服务（EXP-05..12）。 */
export class ExperimentProcessService {
  private readonly workspace: ExperimentWorkspaceService
  private readonly spawnImpl: SpawnFn
  private readonly probe: ProcessProbe
  private readonly killImpl: (pid: number) => boolean
  /** 本进程内存活子进程句柄（runId → child）。 */
  private readonly running = new Map<string, ChildProcess>()

  constructor(readonly config: ExperimentProcessConfig) {
    this.workspace = config.workspace ?? new ExperimentWorkspaceService({ dataRoot: config.dataRoot })
    this.spawnImpl = config.spawnImpl ?? defaultSpawn
    this.probe = config.probe ?? defaultProbe()
    this.killImpl = config.killImpl ?? defaultKill
  }

  private expDirOf(workspaceDir: string, slug: string): string {
    return this.workspace.listDetail(workspaceDir, slug).dir
  }

  // ── 账本 ───────────────────────────────────────────────────────────────

  private ledgerFile(expDir: string): string {
    return path.join(expDir, RUN_LEDGER_NAME)
  }

  private readLedger(expDir: string): RunLedger {
    const file = this.ledgerFile(expDir)
    try {
      return parseRunLedger(fs.readFileSync(file, 'utf8'))
    } catch {
      return { version: 1, runs: [] }
    }
  }

  private writeLedger(expDir: string, ledger: RunLedger): void {
    const file = this.ledgerFile(expDir)
    const tmp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(tmp, serializeRunLedger(ledger), 'utf8')
    fs.renameSync(tmp, file)
  }

  private updateLedger(expDir: string, fn: (ledger: RunLedger) => RunLedger): RunLedger {
    const next = fn(this.readLedger(expDir))
    this.writeLedger(expDir, next)
    return next
  }

  // ── 运行（EXP-05）──────────────────────────────────────────────────────

  /**
   * 启动实验运行：记录账本（命令/cwd/Python/Git commit/PID）并立即返回；
   * stdout/stderr 实时追加写 <expDir>/stdout.log、stderr.log（EXP-06）；
   * 进程自然退出或失败时自动终结账本记录（close/error 事件）。
   */
  run(workspaceDir: string, slug: string, spec: RunSpec): RunRecord {
    const command = String(spec.command ?? '').trim()
    if (command === '') throw new Error('命令不能为空')
    const expDir = this.expDirOf(workspaceDir, slug)
    const cwd = spec.cwd !== undefined && String(spec.cwd).trim() !== ''
      ? this.assertRunCwd(workspaceDir, String(spec.cwd))
      : expDir
    const shell = process.platform === 'win32'
    const file = shell ? (process.env.ComSpec ?? 'cmd.exe') : '/bin/sh'
    const argv = shell ? ['/d', '/s', '/c', command] : ['-c', command]
    const env: NodeJS.ProcessEnv = { ...process.env, ...(spec.env ?? {}) }
    const runId = `r-${randomUUID().slice(0, 8)}`
    const now = Date.now()
    const record: RunRecord = {
      runId,
      command,
      argv,
      cwd,
      pythonPath: typeof spec.pythonPath === 'string' && spec.pythonPath !== '' ? spec.pythonPath : null,
      gitCommit: gitRevParse(cwd),
      startedAt: now,
      pid: null,
      status: 'running',
      exitCode: null,
      exitSignal: null,
      error: null,
      stopRequested: false,
      stoppedBy: null,
      endedAt: null,
      stdoutLog: 'stdout.log',
      stderrLog: 'stderr.log',
      recoveredAt: null,
      recoveredNote: null,
    }
    let child: ChildProcess
    try {
      child = this.spawnImpl(file, argv, { cwd, env })
    } catch (error) {
      // spawn can fail synchronously (invalid executable, permission error, or
      // an injected runner failure). The run must still be durable: callers
      // should see a terminal failed record instead of losing the attempt.
      const failed = finalizeRun(record, {
        exitCode: null,
        exitSignal: null,
        error: error instanceof Error ? error.message : String(error),
      })
      this.updateLedger(expDir, (ledger) => ({
        ...ledger,
        runs: pruneRuns([...ledger.runs, failed]),
      }))
      return failed
    }
    // 日志实时追加写（EXP-06）；写失败不中断运行
    const stdoutStream = fs.createWriteStream(path.join(expDir, 'stdout.log'), { flags: 'a' })
    const stderrStream = fs.createWriteStream(path.join(expDir, 'stderr.log'), { flags: 'a' })
    stdoutStream.on('error', () => { /* 忽略日志写失败 */ })
    stderrStream.on('error', () => { /* 忽略日志写失败 */ })
    child.stdout?.on('error', () => { /* 忽略 */ })
    child.stderr?.on('error', () => { /* 忽略 */ })
    child.stdout?.pipe(stdoutStream)
    child.stderr?.pipe(stderrStream)
    this.running.set(runId, child)
    const withPid = { ...record, pid: child.pid ?? null }
    // 终结（只执行一次）：按账本最新记录（含 stopRequested）走状态机；
    // 同时关闭日志写流（释放文件句柄，Windows 下目录删除依赖此关闭）。
    // 事件处理器不允许抛错：实验目录可能已被删除/移动，账本终结失败可接受。
    let finalized = false
    let ledgerReady = false
    let pendingOutcome: ExitOutcome | null = null
    const finalize = async (outcome: ExitOutcome): Promise<void> => {
      if (finalized) return
      if (!ledgerReady) {
        pendingOutcome ??= outcome
        return
      }
      finalized = true
      this.running.delete(runId)
      // Child close can race with pipe writes. Do not publish a terminal
      // ledger state until both log streams have finished flushing.
      const finish = (stream: NodeJS.WritableStream): Promise<void> => new Promise((resolve) => {
        if ((stream as NodeJS.WritableStream & { writableFinished?: boolean }).writableFinished === true) {
          resolve()
          return
        }
        stream.once('finish', resolve)
        stream.once('error', resolve)
        try { stream.end() } catch { resolve() }
      })
      await Promise.all([finish(stdoutStream), finish(stderrStream)])
      try {
        this.updateLedger(expDir, (ledger) => {
          const runs = ledger.runs.map((r) => (r.runId === runId ? finalizeRun(r, outcome) : r))
          return { ...ledger, runs: pruneRuns(runs) }
        })
      } catch {
        // 实验目录被删除/移动等：静默（日志文件仍在时数据已落盘）
      }
    }
    child.on('error', (err) => { void finalize({ exitCode: null, exitSignal: null, error: err?.message ?? 'spawn 失败' }) })
    child.on('close', (code, signal) => { void finalize({ exitCode: code, exitSignal: signal ?? null, error: null }) })
    this.updateLedger(expDir, (ledger) => ({
      ...ledger,
      runs: pruneRuns([...ledger.runs, withPid]),
    }))
    ledgerReady = true
    if (pendingOutcome !== null) void finalize(pendingOutcome)
    return withPid
  }

  private assertRunCwd(workspaceDir: string, cwd: string): string {
    const resolved = path.resolve(cwd)
    const v = validateWorkspace(this.config.dataRoot, workspaceDir)
    const wsPath = v.kind === 'project' ? v.path : path.resolve(this.config.dataRoot)
    if (!isInsidePath(resolved, wsPath)) throw new Error(`运行目录超出工作区: ${cwd}`)
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`运行目录不存在或不是文件夹: ${cwd}`)
    }
    return resolved
  }

  // ── 查询 ───────────────────────────────────────────────────────────────

  /** 账本全部运行记录（新 → 旧）。 */
  list(workspaceDir: string, slug: string): RunRecord[] {
    const expDir = this.expDirOf(workspaceDir, slug)
    return [...this.readLedger(expDir).runs].reverse()
  }

  /** 单条记录（默认最新）。 */
  get(workspaceDir: string, slug: string, runId?: string): RunRecord {
    const expDir = this.expDirOf(workspaceDir, slug)
    const runs = this.readLedger(expDir).runs
    const run = runId !== undefined
      ? runs.find((r) => r.runId === runId)
      : runs.length > 0 ? runs[runs.length - 1] : undefined
    if (run === undefined) throw new Error(`运行记录不存在: ${runId ?? '(latest)'}`)
    return run
  }

  /** 当前状态：running 记录 + 最新记录。 */
  status(workspaceDir: string, slug: string): { runs: RunRecord[]; running: RunRecord | null; latest: RunRecord | null } {
    const runs = this.list(workspaceDir, slug)
    return {
      runs,
      running: runs.find((r) => r.status === 'running') ?? null,
      latest: runs.length > 0 ? runs[0] ?? null : null,
    }
  }

  // ── 停止（EXP-07）──────────────────────────────────────────────────────

  /**
   * 停止运行中的实验进程：先落账（stopRequested + user-stopped，重启恢复据此
   * 区分人为停止），再杀进程（win32 taskkill /T 连进程树，其余 SIGTERM；
   * 重启恢复后的运行无子进程句柄，直接按 PID 杀）。
   */
  stop(workspaceDir: string, slug: string, opts?: { runId?: string }): { ok: true; run: RunRecord } {
    const expDir = this.expDirOf(workspaceDir, slug)
    const run = this.get(workspaceDir, slug, opts?.runId)
    if (run.status !== 'running') throw new Error(`实验进程不在运行中（${run.status}）`)
    const now = Date.now()
    const stopped: RunRecord = { ...run, stopRequested: true, status: 'user-stopped', stoppedBy: 'user', endedAt: now }
    this.updateLedger(expDir, (ledger) => ({
      ...ledger,
      runs: ledger.runs.map((r) => (r.runId === run.runId ? stopped : r)),
    }))
    const child = this.running.get(run.runId)
    let killed = false
    if (run.pid !== null) killed = this.killImpl(run.pid)
    if (!killed && child !== undefined) {
      try {
        child.kill()
        killed = true
      } catch {
        killed = false
      }
    }
    if (!killed && run.pid !== null) {
      try {
        process.kill(run.pid)
      } catch {
        // 进程可能已自行退出；close 事件会按 stopRequested 终结为 user-stopped
      }
    }
    return { ok: true, run: stopped }
  }

  // ── 日志流式读取（EXP-06）──────────────────────────────────────────────

  /** 日志信息：两个流的当前字节数与路径。 */
  logInfo(workspaceDir: string, slug: string): { stdout: { path: string; size: number }; stderr: { path: string; size: number } } {
    const expDir = this.expDirOf(workspaceDir, slug)
    const sizeOf = (name: string): number => {
      try {
        return fs.statSync(path.join(expDir, name)).size
      } catch {
        return 0
      }
    }
    return {
      stdout: { path: path.join(expDir, 'stdout.log'), size: sizeOf('stdout.log') },
      stderr: { path: path.join(expDir, 'stderr.log'), size: sizeOf('stderr.log') },
    }
  }

  /**
   * 流式读取日志：offset/limit 分页回读，或 tail 取尾部（对齐行边界）。
   * 日志文件不存在按空处理（运行未开始/无输出）。
   */
  readLog(workspaceDir: string, slug: string, stream: 'stdout' | 'stderr', opts: LogSliceOptions = {}): LogSlice & { size: number } {
    const expDir = this.expDirOf(workspaceDir, slug)
    const file = path.join(expDir, `${stream}.log`)
    try {
      return this.readLogFile(file, opts)
    } catch {
      return { text: '', nextOffset: 0, eof: true, size: 0 }
    }
  }

  private readLogFile(file: string, opts: LogSliceOptions): LogSlice & { size: number } {
    if (!fs.existsSync(file)) return { text: '', nextOffset: 0, eof: true, size: 0 }
    const size = fs.statSync(file).size
    if (size === 0) return { text: '', nextOffset: 0, eof: true, size }
    if (opts.tail !== undefined) {
      const n = Math.max(0, Math.floor(opts.tail))
      if (n === 0) return { text: '', nextOffset: size, eof: true, size }
      if (size <= n) {
        return { text: fs.readFileSync(file, 'utf8'), nextOffset: size, eof: true, size }
      }
      // 读 [start-1, size)：buf[0] 是窗口前一个字节，仅用于行边界判断（不输出）
      const start = size - n
      const buf = Buffer.alloc(n + 1)
      this.readAt(file, buf, start - 1)
      let from = 1
      if (buf[0] !== 0x0a) {
        const nl = buf.indexOf(0x0a, 1)
        if (nl >= 0) from = nl + 1
      }
      return { text: buf.subarray(from).toString('utf8'), nextOffset: size, eof: true, size }
    }
    const offset = Math.max(0, Math.floor(opts.offset ?? 0))
    const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? LOG_MAX_CHUNK)), LOG_MAX_CHUNK)
    if (offset >= size) return { text: '', nextOffset: size, eof: true, size }
    const end = Math.min(size, offset + limit)
    const buf = Buffer.alloc(end - offset)
    this.readAt(file, buf, offset)
    return { text: sliceLog(buf, { limit }).text, nextOffset: end, eof: end >= size, size }
  }

  private readAt(file: string, buf: Buffer, position: number): void {
    const fd = fs.openSync(file, 'r')
    try {
      let done = 0
      while (done < buf.length) {
        const n = fs.readSync(fd, buf, done, buf.length - done, position + done)
        if (n <= 0) break
        done += n
      }
    } finally {
      fs.closeSync(fd)
    }
  }

  // ── 重启恢复（EXP-08）──────────────────────────────────────────────────

  /**
   * 重启恢复识别：对每个 running 记录重探 PID 与命令行确认归属；
   * 无法确认的标 unknown，不伪造完成。返回本次检查摘要。
   */
  restartRecovery(workspaceDir: string, slug: string): { checked: number; changed: number; notes: string[] } {
    const expDir = this.expDirOf(workspaceDir, slug)
    const notes: string[] = []
    let changed = 0
    let checked = 0
    this.updateLedger(expDir, (ledger) => {
      const runs = ledger.runs.map((run) => {
        if (run.status !== 'running') return run
        checked += 1
        const probe: RestartProbeResult = run.pid !== null
          ? { alive: this.probe.alive(run.pid), commandLine: this.probe.commandLine(run.pid) }
          : { alive: false, commandLine: null }
        const logTail = this.readLogFile(path.join(expDir, 'stderr.log'), { tail: 2048 }).text
        const classification = classifyAfterRestart(run, probe, { logTail })
        if (classification === null) return run
        const now = Date.now()
        // 确认归属（仍 running）：记录 recoveredAt 以便界面展示「重启后重新挂接」
        const updated = {
          ...run,
          status: classification.status,
          endedAt: classification.status === 'running' ? null : now,
          recoveredAt: now,
          recoveredNote: classification.note,
        }
        notes.push(`[${run.runId}] ${classification.note}`)
        if (classification.status !== run.status) changed += 1
        return updated
      })
      return { ...ledger, runs: pruneRuns(runs) }
    })
    return { checked, changed, notes }
  }

  // ── 复盘草稿（EXP-10）──────────────────────────────────────────────────

  /**
   * 生成实验复盘草稿（只生成文本；saveDraft=true 时可落
   * .evoresearch-retrospective.draft.md）。用户确认后才经
   * ExperimentWorkspaceService.appendNote() 写入 LAB_NOTE.md。
   */
  retrospectiveDraft(workspaceDir: string, slug: string, opts?: { saveDraft?: boolean }): { draft: string; draftPath: string | null } {
    const expDir = this.expDirOf(workspaceDir, slug)
    const ledger = this.readLedger(expDir)
    const stderrTail = this.readLogFile(path.join(expDir, 'stderr.log'), { tail: DRAFT_LOG_TAIL }).text
    const stdoutTail = this.readLogFile(path.join(expDir, 'stdout.log'), { tail: DRAFT_LOG_TAIL }).text
    const draft = buildRetrospectiveDraft({ name: slug, runs: ledger.runs, stderrTail, stdoutTail })
    if (opts?.saveDraft !== true) return { draft, draftPath: null }
    const file = path.join(expDir, RETROSPECTIVE_DRAFT_NAME)
    const tmp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(tmp, draft, 'utf8')
    fs.renameSync(tmp, file)
    return { draft, draftPath: file }
  }

  // ── Chat Graph 引用解析（EXP-11 数据接口）─────────────────────────────

  /**
   * 解析实验引用 → 文件系统路径（供 Chat Graph 节点/全文检索接线）。
   * 只做路径解析与安全性校验；图节点创建与检索注入由 api 层接线
   * （见 api-integration-exp2.md「接线点」）。
   */
  resolveGraphRef(ref: ExperimentGraphRef): ExperimentGraphRefResolution {
    const type = String(ref?.type ?? '')
    const expDir = this.expDirOf(ref?.workspaceDir ?? '', ref?.slug ?? '')
    if (type === 'experiment') {
      return { kind: 'experiment', path: expDir, title: `实验 ${ref.slug}` }
    }
    if (type === 'note') {
      const note = path.join(expDir, 'LAB_NOTE.md')
      return { kind: 'note', path: note, title: `实验笔记 ${ref.slug}` }
    }
    if (type === 'log') {
      const stream = ref?.stream === 'stderr' ? 'stderr' : 'stdout'
      return { kind: 'log', path: path.join(expDir, `${stream}.log`), title: `实验日志 ${ref.slug} (${stream})` }
    }
    if (type === 'artifact') {
      const file = resolveExperimentRelativePath(expDir, ref?.relPath ?? '')
      if (!fs.existsSync(file)) throw new Error(`实验产物不存在: ${ref.relPath}`)
      return { kind: 'artifact', path: file, title: `实验产物 ${ref.slug}: ${ref.relPath}` }
    }
    throw new Error(`未知的实验引用类型: ${type}`)
  }
}
