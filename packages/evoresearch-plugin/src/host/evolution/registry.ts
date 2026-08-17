/**
 * 自进化候选注册表（EVO-03 / EVO-04 / EVO-06）。
 *
 * EVO-03：检索策略、查询改写、Graph 邻域、token 分配、Skill 等组件各自维护
 * 独立版本号（`versions(component)` / `nextVersion`）。
 *
 * EVO-04：一次候选只修改一个组件；每个候选携带自然语言说明（description）与
 * 纯文本统一格式 diff（`unifiedDiff`，无外部依赖）。
 *
 * EVO-06：`activate(candidateId)` 返回 disposer——调用 disposer 即回滚：释放该
 * 候选注册的副作用（apply 回调的 disposer，对应 Cordis 生命周期语义）并恢复
 * 前一版本；`rollback(candidateId)` 等价；`disposeAll()` 在插件卸载时释放全部
 * 活动候选副作用（EVO-10 卸载无副作用）。
 *
 * 候选隔离存储：全部候选与"当前启用版本指针"一起持久化在
 * `<dataRoot>/.evoresearch-data/evolution/candidates.json`；候选通过/拒绝/回滚
 * 都不影响其他组件与当前启用版本（EVO-05 的隔离由 evaluateCandidate 保证，
 * 本模块保证版本指针可恢复）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

/** 内置可演化组件（EVO-03；可扩展为任意字符串组件名）。 */
export const EVOLUTION_COMPONENTS = [
  'query-rewrite', // 查询改写方法
  'snippet-ranking', // 原文片段排序
  'graph-neighborhood', // Graph 邻域读取策略
  'token-allocation', // 上下文长度分配
  'skill', // 研究笔记/文献精读/实验日志整理等 Skill
] as const

export type EvolutionComponent = (typeof EVOLUTION_COMPONENTS)[number] | (string & {})

/** 组件的一个版本（EVO-03：组件内独立版本号，从 1 递增）。 */
export interface ComponentVersion {
  readonly version: number
  /** 自然语言说明（EVO-04：每次候选都带）。 */
  readonly description: string
  /** 纯文本统一格式 diff（EVO-04）。 */
  readonly diff: string
  /** 组件内容载荷（如 Skill Markdown / 策略 JSON），可选。 */
  readonly content?: string
  readonly createdAt: number
  /** 该版本基于的父版本号（首版无）。 */
  readonly parentVersion?: number
}

/** 候选状态。 */
export type CandidateStatus = 'proposed' | 'active' | 'rejected' | 'rolled-back'

/** 演化候选（一次只改一个组件；隔离存储，不通过不影响当前版本）。 */
export interface EvolutionCandidate {
  readonly candidateId: string
  readonly component: string
  readonly version: number
  readonly description: string
  readonly diff: string
  readonly content?: string
  readonly createdAt: number
  status: CandidateStatus
  /** 评估记录（EVO-05，evaluateCandidate 写入）。 */
  evaluation?: {
    readonly evaluatedAt: number
    readonly total: number
    readonly passed: number
    readonly failed: number
    readonly ok: boolean
    readonly detail: string
  }
  /** 激活时保存的前一版本（回滚目标，EVO-06）。 */
  readonly previousVersion?: number
}

/** 持久化文件结构。 */
interface RegistryFile {
  candidates?: EvolutionCandidate[]
  /** 组件 → 当前启用版本。 */
  active?: Record<string, number>
}

/** apply 回调：应用某组件某版本，返回释放副作用的 disposer（EVO-06）。 */
export type ComponentApplier = (component: string, version: ComponentVersion) => () => void

export interface CandidateRegistryOptions {
  readonly dataRoot: string
  /** 应用回调（缺省 no-op：注册表只记账，实际副作用由上层提供）。 */
  readonly apply?: ComponentApplier
}

/** 候选注册表。 */
export class CandidateRegistry {
  private readonly file: string
  private candidates: EvolutionCandidate[] = []
  private active = new Map<string, number>()
  private readonly disposers = new Map<string, () => void>()
  private readonly applier: ComponentApplier

  constructor(readonly options: CandidateRegistryOptions) {
    this.file = path.join(options.dataRoot, '.evoresearch-data', 'evolution', 'candidates.json')
    this.applier = options.apply ?? (() => () => { /* no-op */ })
    this.load()
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as RegistryFile
      if (Array.isArray(raw.candidates)) {
        this.candidates = raw.candidates.filter((c): c is EvolutionCandidate =>
          typeof c?.candidateId === 'string' && typeof c?.component === 'string' && typeof c?.version === 'number')
      }
      if (typeof raw.active === 'object' && raw.active !== null) {
        for (const [component, version] of Object.entries(raw.active)) {
          if (typeof version === 'number') this.active.set(component, version)
        }
      }
    } catch {
      this.candidates = []
      this.active = new Map()
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const data: RegistryFile = {
      candidates: this.candidates,
      active: Object.fromEntries(this.active),
    }
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, this.file)
  }

  /** 组件下一版本号（当前最大 +1；无版本时从 1 开始，EVO-03）。 */
  nextVersion(component: string): number {
    let max = 0
    for (const candidate of this.candidates) {
      if (candidate.component === component && candidate.version > max) max = candidate.version
    }
    return max + 1
  }

  /** 某组件的全部版本（升序）。 */
  versions(component: string): ComponentVersion[] {
    return this.candidates
      .filter((c) => c.component === component)
      .sort((a, b) => a.version - b.version)
      .map((c) => ({
        version: c.version,
        description: c.description,
        diff: c.diff,
        content: c.content,
        createdAt: c.createdAt,
        parentVersion: c.previousVersion,
      }))
  }

  /** 全部候选（最新在前）。 */
  listCandidates(status?: CandidateStatus): EvolutionCandidate[] {
    const list = status ? this.candidates.filter((c) => c.status === status) : this.candidates
    return [...list].sort((a, b) => b.createdAt - a.createdAt)
  }

  getCandidate(candidateId: string): EvolutionCandidate | undefined {
    return this.candidates.find((c) => c.candidateId === candidateId)
  }

  /** 当前启用版本（active 指针；无则 undefined）。 */
  currentVersion(component: string): number | undefined {
    return this.active.get(component)
  }

  /**
   * 提出候选（EVO-04）：一次只改一个组件（component 单值）；生成自然语言说明
   * 与代码 diff（调用方用 unifiedDiff 生成）。候选隔离存储，不改变当前版本。
   */
  propose(input: {
    component: string
    description: string
    diff: string
    content?: string
  }): EvolutionCandidate {
    const version = this.nextVersion(input.component)
    const parentVersion = this.active.get(input.component)
    const candidate: EvolutionCandidate = {
      candidateId: `evc-${randomUUID().slice(0, 8)}`,
      component: input.component,
      version,
      description: input.description,
      diff: input.diff,
      content: input.content,
      createdAt: Date.now(),
      status: 'proposed',
      previousVersion: parentVersion,
    }
    this.candidates.push(candidate)
    this.save()
    return candidate
  }

  /**
   * 激活候选（EVO-06）：应用该版本，记录 disposer；返回的 disposer 即回滚——
   * 释放副作用并恢复前一版本。disposer 幂等（重复调用安全）。
   */
  activate(candidateId: string): () => void {
    const candidate = this.getCandidate(candidateId)
    if (!candidate) throw new Error(`候选不存在: ${candidateId}`)
    if (candidate.status === 'active') return this.rollbackDisposerOf(candidateId)
    if (candidate.status !== 'proposed') throw new Error(`候选状态不允许激活: ${candidate.status}`)
    const previous = this.active.get(candidate.component)
    const version: ComponentVersion = {
      version: candidate.version,
      description: candidate.description,
      diff: candidate.diff,
      content: candidate.content,
      createdAt: candidate.createdAt,
      parentVersion: candidate.previousVersion,
    }
    const dispose = this.applier(candidate.component, version)
    this.disposers.set(candidateId, dispose)
    this.active.set(candidate.component, candidate.version)
    candidate.status = 'active'
    this.save()
    // disposer = 回滚句柄：释放副作用 + 恢复前一版本（EVO-06）。
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.rollbackTo(candidateId, previous)
    }
  }

  /** 回滚一个已激活候选（EVO-06）：释放副作用 + 恢复前一版本。 */
  rollback(candidateId: string): boolean {
    const candidate = this.getCandidate(candidateId)
    if (!candidate) return false
    if (candidate.status !== 'active') return false
    const previous = this.active.get(candidate.component)
    this.rollbackTo(candidateId, previous === candidate.version ? candidate.previousVersion : previous)
    return true
  }

  private rollbackDisposerOf(candidateId: string): () => void {
    return () => { this.rollback(candidateId) }
  }

  /** 内部回滚实现：调用 disposer、恢复版本指针、标记 rolled-back。 */
  private rollbackTo(candidateId: string, previous: number | undefined): void {
    const candidate = this.getCandidate(candidateId)
    if (!candidate) return
    const dispose = this.disposers.get(candidateId)
    if (dispose) {
      try {
        dispose()
      } catch (error) {
        console.warn(`[evoresearch:evolution] 候选 ${candidateId} 副作用释放失败: ${String(error)}`)
      }
      this.disposers.delete(candidateId)
    }
    if (previous !== undefined) this.active.set(candidate.component, previous)
    else this.active.delete(candidate.component)
    candidate.status = 'rolled-back'
    this.save()
  }

  /** 拒绝候选（EVO-05：不通过不影响当前版本；拒绝只标记，不动 active 指针）。 */
  reject(candidateId: string): boolean {
    const candidate = this.getCandidate(candidateId)
    if (!candidate || candidate.status !== 'proposed') return false
    candidate.status = 'rejected'
    this.save()
    return true
  }

  /** 写入评估记录（EVO-05，evaluateCandidate 调用）。 */
  recordEvaluation(candidateId: string, evaluation: NonNullable<EvolutionCandidate['evaluation']>): void {
    const candidate = this.getCandidate(candidateId)
    if (!candidate) return
    candidate.evaluation = evaluation
    this.save()
  }

  /** 插件卸载：释放全部活动候选副作用并清空（EVO-10 卸载无副作用）。 */
  disposeAll(): void {
    for (const candidateId of [...this.disposers.keys()]) {
      const dispose = this.disposers.get(candidateId)
      if (dispose) {
        try {
          dispose()
        } catch (error) {
          console.warn(`[evoresearch:evolution] 卸载释放副作用失败: ${String(error)}`)
        }
      }
    }
    this.disposers.clear()
    this.active.clear()
    for (const candidate of this.candidates) {
      if (candidate.status === 'active') candidate.status = 'rolled-back'
    }
    this.save()
  }

  /** 当前活动候选数（诊断/测试）。 */
  activeCount(): number {
    return this.candidates.filter((c) => c.status === 'active').length
  }
}

/* ------------------------------------------------------------------ */
/* EVO-04：纯文本统一格式 diff（无外部依赖）                             */
/* ------------------------------------------------------------------ */

/** 按行 LCS 的最长公共子序列长度表（行数过大时退化，防爆内存）。 */
const DIFF_MAX_LINES = 2000

/**
 * 生成统一格式 diff（`--- before` / `+++ after` / `@@ -a,b +c,d @@` / +/- 行）。
 * 纯文本实现（LCS），不依赖外部 diff 工具；超过 DIFF_MAX_LINES 时退化为
 * 整体替换（- 全部旧行 + 全部新行）。
 */
export function unifiedDiff(before: string, after: string, contextLines = 3): string {
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES) {
    const lines: string[] = ['--- before', '+++ after']
    for (const line of a) lines.push(`-${line}`)
    for (const line of b) lines.push(`+${line}`)
    return lines.join('\n')
  }
  // LCS 表（行数乘积有限；两行文本的 LCS 用于定位增删）。
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j] ? (lcs[i + 1]![j + 1] ?? 0) + 1 : Math.max(lcs[i + 1]![j] ?? 0, lcs[i]![j + 1] ?? 0)
    }
  }
  // 回溯生成操作序列。
  type Op = { kind: 'keep' | 'del' | 'add'; line: string }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'keep', line: a[i]! })
      i += 1
      j += 1
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      ops.push({ kind: 'del', line: a[i]! })
      i += 1
    } else {
      ops.push({ kind: 'add', line: b[j]! })
      j += 1
    }
  }
  while (i < n) {
    ops.push({ kind: 'del', line: a[i]! })
    i += 1
  }
  while (j < m) {
    ops.push({ kind: 'add', line: b[j]! })
    j += 1
  }

  // 分块输出（@@ hunk @@）。hunk = 连续增删段；记录其在 ops 中的起始位置
  // （不能用 indexOf 回查：相同的删除行可能重复出现）。
  const out: string[] = ['--- before', '+++ after']
  const window = Math.max(1, contextLines)
  const hunks: Array<{ start: number; ops: Op[] }> = []
  let currentStart = -1
  let current: Op[] = []
  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index]!
    if (op.kind === 'keep') {
      if (current.length > 0) {
        hunks.push({ start: currentStart, ops: current })
        current = []
        currentStart = -1
      }
    } else {
      if (current.length === 0) currentStart = index
      current.push(op)
    }
  }
  if (current.length > 0) hunks.push({ start: currentStart, ops: current })
  if (hunks.length === 0) return out.join('\n')

  for (const hunk of hunks) {
    const start = Math.max(0, hunk.start - window)
    const end = Math.min(ops.length, hunk.start + hunk.ops.length + window)
    const oldStart = ops.slice(0, start).filter((op) => op.kind !== 'add').length + 1
    const newStart = ops.slice(0, start).filter((op) => op.kind !== 'del').length + 1
    const slice = ops.slice(start, end)
    const oldCount = slice.filter((op) => op.kind !== 'add').length
    const newCount = slice.filter((op) => op.kind !== 'del').length
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`)
    for (const op of slice) {
      if (op.kind === 'keep') out.push(` ${op.line}`)
      else if (op.kind === 'del') out.push(`-${op.line}`)
      else out.push(`+${op.line}`)
    }
  }
  return out.join('\n')
}
