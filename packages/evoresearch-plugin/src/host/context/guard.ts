/**
 * CTX-13 / CTX-14 上下文窗口保护层 运行时（ContextWindowRuntime + DSH 适配）。
 *
 * 职责（与检索解耦）：
 * - detectPressure：窗口压力检测（优先 ctx.tokenMeter 实测，缺省字符/token 近似）；
 * - considerAutoCompact / manualCompact / regionCompact / overflowRetry：
 *   经适配层调用 DSH rc.6 压缩能力（ctx.compaction），并登记 CTX-16 事件记录；
 * - 降级路径：DSH 服务探测不到时明确"不可用"——登记 degraded-noop 事件 +
 *   结构化结果返回，绝不抛异常中断聊天；调用失败同样只记 failed 记录；
 * - CTX-15 工具结果裁剪的运行时部分：完整原文写档案文件 + 返回继续读取位置；
 * - CTX-17 工具历史修复的运行时部分：从会话投影消息、分析、生成修复后投影、
 *   修复前后分别持久化；
 * - CTX-18 当前上下文来源查询的组合入口。
 *
 * 纯计算逻辑在 window.ts / pruner.ts / compaction-log.ts / history-repair.ts /
 * sources.ts，本文件只做 DSH 适配、文件持久化与编排。所有动态注册返回 disposer。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  CompactionQuery,
  CompactionRecord,
  ContextSourceReport,
  GuardActionResult,
  GraphConnectionInfo,
  PressureReport,
  PruneBudget,
  PrunePlan,
  SurfaceEventInfo,
  ToolResultArchiveRecord,
  WindowSpec,
} from './types.js'
import { DEFAULT_WINDOW_SPEC, DEFAULT_CHARS_PER_TOKEN, estimateProjectionTokens, resolveWindowTokens, computePressure, type WindowCatalogConfig } from './window.js'
import { DEFAULT_PRUNE_BUDGET, planPrune, renderPrunedText } from './pruner.js'
import { CompactionLog, toCompactionLine, parseCompactionLine } from './compaction-log.js'
import {
  analyzeToolHistory,
  buildRepairedProjection,
  createRepairRecord,
  type RepairMessage,
  type ToolHistoryRepairRecord,
  type RepairedProjection,
  type ToolHistoryAnalysis,
} from './history-repair.js'
import { describeContextSources } from './sources.js'

// ── DSH rc.6 适配接口（结构化探测；不直接依赖 dsh-compaction 等包）──────────

/** DSH CompactionEngine 的最小结构契约（@deepseek-ai/dsh-compaction）。 */
export interface DshCompactionAdapter {
  compactIfNeeded(agent: DshAgentContext, trigger: 'pressure' | 'context-overflow', signal: AbortSignal): Promise<unknown | null>
  compactNow(agent: DshAgentContext, signal: AbortSignal, sourceCommandId?: string): Promise<unknown | null>
  compactRegion(start: number, end: number, agent: DshAgentContext, signal?: AbortSignal): Promise<unknown>
}

/** DSH CompactionAgentContext 的最小形态。 */
export interface DshAgentContext {
  readonly session: unknown
  readonly options: { readonly provider?: string; readonly model?: string }
}

/** DSH TokenMeter 的最小结构契约（@deepseek-ai/dsh-token-meter）。 */
export interface DshTokenMeterAdapter {
  measure(session: unknown, requestHeader?: unknown): {
    readonly totalTokens: number
    readonly surfaceTokens: number
    readonly logRevision: number
    readonly nodes: readonly { readonly seq: number; readonly tokens: number }[]
  }
}

/** DSH ToolResultPruner 的最小结构契约（@deepseek-ai/dsh-compaction-tool-result-pruner）。 */
export interface DshToolResultPrunerAdapter {
  measureContent(blocks: readonly unknown[]): number
  pruneContent(blocks: readonly unknown[]): readonly unknown[] | null
  pruneSession(session: unknown): { readonly pruned: readonly unknown[]; readonly charsRemoved: number }
}

/** DSH CompactionResult 的最小结构（@deepseek-ai/dsh-compaction types）。 */
interface DshCompactionResultShape {
  readonly compactionId?: unknown
  readonly summary?: unknown
  readonly shadowedRange?: { readonly start?: unknown; readonly end?: unknown }
  readonly shadowedSeqs?: unknown
  readonly shadowedTokenCount?: unknown
  readonly startSeq?: unknown
  readonly summarySeq?: unknown
  readonly endSeq?: unknown
}

/** 会话的轻量结构（真实 Session 满足此形状；便于测试与只读场景）。 */
export interface PressureSessionLike {
  readonly id: string
  readonly header?: { readonly cwd?: string }
  readonly deriveMessages?: () => readonly unknown[]
  readonly requestHeader?: () => unknown
  readonly events?: readonly unknown[]
}

/** 适配可用性总览（CTX-13：探测不到就明确"不可用"）。 */
export interface GuardStatus {
  readonly compaction: boolean
  readonly tokenMeter: boolean
  readonly toolResultPruner: boolean
  readonly sessionQuery: boolean
  readonly degraded: boolean
}

/** 运行时配置。 */
export interface ContextWindowConfig {
  /** 部署根目录（档案/日志写入 <dataRoot>/plugins/context/）。 */
  readonly dataRoot?: string
  readonly enabled?: boolean
  readonly windowCatalog?: WindowCatalogConfig
  readonly spec?: Readonly<Partial<WindowSpec>>
  readonly pruneBudget?: PruneBudget
  /** 辅助模型（压缩摘要等后台调用；缺省取 agentDefaultModel 当前选择）。 */
  readonly auxiliaryModel?: { readonly provider: string; readonly model: string }
}

interface ResolvedConfig {
  readonly dataRoot: string
  readonly enabled: boolean
  readonly windowCatalog: WindowCatalogConfig
  readonly spec: WindowSpec
  readonly pruneBudget: PruneBudget
  readonly auxiliaryModel?: { readonly provider: string; readonly model: string }
}

// ── 操作选项与结果 ─────────────────────────────────────────────────────────

export interface AutoCompactOptions {
  readonly model?: string
  /** 由集成方提供的 agent 上下文（DSH CompactionAgentContext）；缺省自动组装。 */
  readonly agent?: DshAgentContext
  readonly signal?: AbortSignal
  /** 强制压缩（跳过阈值判定；手动触发用）。 */
  readonly force?: boolean
}

export interface ManualCompactOptions {
  readonly model?: string
  readonly agent?: DshAgentContext
  readonly signal?: AbortSignal
  readonly sourceCommandId?: string
}

export interface RegionCompactOptions {
  readonly model?: string
  readonly agent?: DshAgentContext
  readonly signal?: AbortSignal
}

export interface OverflowRetryOptions {
  readonly model?: string
  readonly agent?: DshAgentContext
  readonly signal?: AbortSignal
}

export interface PruneToolResultInput {
  readonly sessionId: string
  readonly callId: string
  readonly toolName: string
  readonly text: string
}

export interface PruneToolResultOutput {
  /** 裁剪归档记录（action='keep' 时为 undefined：未超预算无需归档）。 */
  readonly record: ToolResultArchiveRecord | undefined
  readonly plan: PrunePlan
  readonly prunedText: string
  readonly applied: boolean
}

export interface RepairToolHistoryOutput {
  readonly record: ToolHistoryRepairRecord | undefined
  readonly analysis: ToolHistoryAnalysis
  readonly repaired: RepairedProjection
}

export interface ContextSourcesOptions {
  readonly graphConnections?: readonly GraphConnectionInfo[]
}

/** CTX-13 定义的上下文窗口保护层接口。 */
export interface ContextWindowGuard {
  readonly enabled: boolean
  status(): GuardStatus
  detectPressure(session: PressureSessionLike, model?: string): PressureReport
  considerAutoCompact(session: PressureSessionLike, options?: AutoCompactOptions): Promise<GuardActionResult>
  manualCompact(session: PressureSessionLike, options?: ManualCompactOptions): Promise<GuardActionResult>
  regionCompact(session: PressureSessionLike, start: number, end: number, options?: RegionCompactOptions): Promise<GuardActionResult>
  overflowRetry(session: PressureSessionLike, options?: OverflowRetryOptions): Promise<GuardActionResult>
  pruneToolResult(input: PruneToolResultInput): PruneToolResultOutput
  repairToolHistory(session: PressureSessionLike): RepairToolHistoryOutput
  /** 已保存的修复记录（CTX-17 回读）。 */
  repairRecords(sessionId?: string): readonly ToolHistoryRepairRecord[]
  queryCompactions(query?: CompactionQuery): readonly CompactionRecord[]
  queryContextSources(sessionId: string, options?: ContextSourcesOptions): Promise<ContextSourceReport>
}

/** 默认配置（与 DSH compaction-basic 默认策略对齐）。 */
export function resolveContextWindowConfig(config: ContextWindowConfig = {}): ResolvedConfig {
  return {
    dataRoot: config.dataRoot ?? process.cwd(),
    enabled: config.enabled ?? true,
    windowCatalog: config.windowCatalog ?? {},
    spec: { ...DEFAULT_WINDOW_SPEC, ...config.spec },
    pruneBudget: { ...DEFAULT_PRUNE_BUDGET, ...config.pruneBudget },
    auxiliaryModel: config.auxiliaryModel,
  }
}

/**
 * 上下文窗口保护层 运行时门面。
 * 用法：const guard = new ContextWindowRuntime(config); const dispose = guard.attach(ctx)。
 */
export class ContextWindowRuntime implements ContextWindowGuard {
  readonly config: ResolvedConfig
  readonly compactionLog = new CompactionLog()
  private readonly prunes: ToolResultArchiveRecord[] = []
  private readonly repairs: ToolHistoryRepairRecord[] = []
  private ctxRef: Context | undefined
  private cachedModel: { provider: string; model: string } | undefined
  private compaction: DshCompactionAdapter | undefined
  private tokenMeter: DshTokenMeterAdapter | undefined
  private toolResultPruner: DshToolResultPrunerAdapter | undefined
  private sessionQuery: { listEvents?: (sessionId: string) => Promise<readonly unknown[]> } | undefined

  constructor(config: ContextWindowConfig = {}) {
    this.config = resolveContextWindowConfig(config)
  }

  get enabled(): boolean {
    return this.config.enabled
  }

  /** CTX-13 适配可用性：探测不到的能力明确"不可用"并计入降级。 */
  status(): GuardStatus {
    const compaction = this.compaction !== undefined
    const tokenMeter = this.tokenMeter !== undefined
    const toolResultPruner = this.toolResultPruner !== undefined
    const sessionQuery = this.sessionQuery !== undefined
    return {
      compaction,
      tokenMeter,
      toolResultPruner,
      sessionQuery,
      degraded: !compaction || !tokenMeter,
    }
  }

  /** 内部数据目录（<dataRoot>/plugins/context/）。 */
  private contextDir(): string {
    return path.join(this.config.dataRoot, 'plugins', 'context')
  }

  private compactionsFile(): string {
    return path.join(this.contextDir(), 'compactions.jsonl')
  }

  private toolResultsDir(): string {
    return path.join(this.contextDir(), 'tool-results')
  }

  private toolResultsIndexFile(): string {
    return path.join(this.toolResultsDir(), 'index.jsonl')
  }

  private repairsFile(): string {
    return path.join(this.contextDir(), 'repairs.jsonl')
  }

  // ── 生命周期 ──────────────────────────────────────────────────────────────

  /** 挂载全部副作用（探测适配、事件订阅、日志装载、持久化钩子）。返回 disposer。 */
  attach(ctx: Context): () => void {
    if (!this.config.enabled) return () => {}
    this.ctxRef = ctx
    this.probeAdapters(ctx)
    this.loadPersisted()
    this.compactionLog.onAppend = (record) => {
      this.appendLine(this.compactionsFile(), toCompactionLine(record))
    }

    // CTX-16：订阅 DSH compaction 事件（start/summary/end → 记录），只读不改原始事件
    const disposeEvent = ctx.on('session/event', (session: Session, event: SessionEvent) => {
      try {
        this.compactionLog.fold(event as unknown as { type: string; data?: unknown }, {
          sessionId: session.id,
          now: event.time,
        })
      } catch (error) {
        console.error('[evoresearch:context] compaction 事件折叠失败（不阻塞）:', error)
      }
    })

    if (this.compaction) {
      console.log('[evoresearch:context] 上下文窗口保护层: DSH compaction 适配可用')
    } else {
      console.log('[evoresearch:context] 上下文窗口保护层: DSH compaction 不可用，压缩操作降级为事件登记 + 接口待接')
    }

    return () => {
      disposeEvent()
      this.compactionLog.onAppend = undefined
      this.ctxRef = undefined
    }
  }

  private probeAdapters(ctx: Context): void {
    this.compaction = ctx.get('compaction') as DshCompactionAdapter | undefined
    this.tokenMeter = ctx.get('tokenMeter') as DshTokenMeterAdapter | undefined
    this.toolResultPruner = ctx.get('toolResultPruner') as DshToolResultPrunerAdapter | undefined
    const sessionQuery = ctx.get('sessionQuery') as
      | { listSessions?: () => Promise<unknown[]>; listEvents?: (sessionId: string) => Promise<readonly unknown[]> }
      | undefined
    this.sessionQuery = sessionQuery && typeof sessionQuery.listEvents === 'function'
      ? { listEvents: (sessionId) => sessionQuery.listEvents!(sessionId) }
      : undefined
  }

  private loadPersisted(): void {
    try {
      const lines = readLinesSafe(this.compactionsFile())
      this.compactionLog.loadLines(lines)
    } catch {
      // 文件不存在/不可读：空日志
    }
    try {
      for (const line of readLinesSafe(this.toolResultsIndexFile())) {
        const record = parseToolResultArchiveLine(line)
        if (record) this.prunes.push(record)
      }
    } catch {
      // 空索引
    }
    try {
      for (const line of readLinesSafe(this.repairsFile())) {
        const record = parseRepairLine(line)
        if (record) this.repairs.push(record)
      }
    } catch {
      // 空记录
    }
  }

  private appendLine(file: string, line: string): void {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.appendFileSync(file, `${line}\n`, 'utf8')
    } catch (error) {
      console.warn(`[evoresearch:context] 持久化失败（不影响内存）: ${String(error)}`)
    }
  }

  // ── CTX-14 压力检测 ───────────────────────────────────────────────────────

  /**
   * 检测当前会话的窗口压力。
   * 优先 ctx.tokenMeter 实测（request+surface 压力）；不可用时按
   * 派生消息文本做字符/token 近似；两者都不可用则返回 unavailable 报告。
   * @param session 会话（真实 Session 或轻量结构）。
   * @param model 模型 id（解析窗口 catalog；缺省取会话请求头/缓存模型）。
   */
  detectPressure(session: PressureSessionLike, model?: string): PressureReport {
    const resolvedModel = model ?? this.modelOf(session)
    const windowTokens = resolveWindowTokens(resolvedModel, this.config.windowCatalog)
    const adapters = {
      compaction: this.compaction !== undefined,
      tokenMeter: this.tokenMeter !== undefined,
      toolResultPruner: this.toolResultPruner !== undefined,
    }

    // 1) token-meter 实测
    if (this.tokenMeter && typeof session.deriveMessages === 'function') {
      try {
        const measurement = this.tokenMeter.measure(session as unknown)
        return computePressure({
          sessionId: session.id,
          estimatedTokens: measurement.totalTokens,
          windowTokens,
          spec: this.config.spec,
          source: 'token-meter',
          adapters,
        })
      } catch (error) {
        console.warn(`[evoresearch:context] tokenMeter 测量失败，降级启发式: ${String(error)}`)
      }
    }

    // 2) 启发式：派生消息文本
    const messages = this.deriveMessagesOf(session)
    if (messages.length > 0) {
      const estimated = messages.reduce<number>((sum, message) => sum + estimateMessageTokens(message), 0)
      return computePressure({
        sessionId: session.id,
        estimatedTokens: estimated,
        windowTokens,
        spec: this.config.spec,
        source: 'heuristic',
        adapters,
      })
    }

    // 3) 不可用
    return computePressure({
      sessionId: session.id,
      estimatedTokens: 0,
      windowTokens,
      spec: this.config.spec,
      source: 'unavailable',
      adapters,
    })
  }

  private deriveMessagesOf(session: PressureSessionLike): readonly unknown[] {
    try {
      return typeof session.deriveMessages === 'function' ? session.deriveMessages() : []
    } catch {
      return []
    }
  }

  /** 从会话请求头/缓存/配置解析模型。 */
  private modelOf(session: PressureSessionLike): string | undefined {
    try {
      const header = typeof session.requestHeader === 'function' ? session.requestHeader() : undefined
      const model = (header as { model?: unknown } | undefined)?.model
      if (typeof model === 'string' && model !== '') return model
    } catch {
      // 请求头不可读，继续回退
    }
    return this.resolveModel()?.model
  }

  private resolveModel(): { provider: string; model: string } | undefined {
    if (this.cachedModel) return this.cachedModel
    if (this.config.auxiliaryModel) {
      this.cachedModel = this.config.auxiliaryModel
      return this.cachedModel
    }
    const ctx = this.ctxRef
    const agentDefaultModel = ctx?.get('agentDefaultModel') as
      | { currentSelection?: () => { provider?: string; model?: string } }
      | undefined
    const selection = agentDefaultModel?.currentSelection?.()
    if (selection?.provider && selection?.model) {
      this.cachedModel = { provider: selection.provider, model: selection.model }
      return this.cachedModel
    }
    this.cachedModel = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    return this.cachedModel
  }

  private agentContextOf(session: PressureSessionLike, model?: string): DshAgentContext {
    const resolved = model !== undefined ? { provider: this.resolveModel()?.provider ?? '', model } : this.resolveModel()
    return { session, options: { provider: resolved?.provider, model: resolved?.model } }
  }

  // ── CTX-13/14 压缩操作（适配层调用 + 降级路径）────────────────────────────

  /**
   * 自动压缩：压力达到阈值时经适配层请求 DSH 压缩；未到阈值返回 skipped；
   * DSH 不可用时登记 degraded-noop（接口待接）。任何失败都记录 failed，不抛异常。
   */
  async considerAutoCompact(session: PressureSessionLike, options: AutoCompactOptions = {}): Promise<GuardActionResult> {
    const signal = options.signal ?? new AbortController().signal
    const report = this.detectPressure(session, options.model)
    const compactionId = randomUUID()
    if (!options.force && !report.triggerAutoCompact) {
      const record: CompactionRecord = {
        compactionId,
        sessionId: session.id,
        trigger: 'auto',
        status: 'skipped',
        startedAt: Date.now(),
        source: 'evoresearch',
        summaryVersion: undefined,
      }
      return {
        ok: true,
        applied: false,
        degraded: false,
        record: this.logRecord(record),
        detail: `压力 ${Math.round(report.ratio * 100)}%（阈值 ${Math.round(this.config.spec.autoCompactThresholdRatio * 100)}%），未触发压缩`,
      }
    }

    if (!this.compaction) {
      return this.degradedResult(session, 'auto', 'DSH compaction 服务不可用（接口待接）: 已登记事件，未实际压缩；可降级为工具结果裁剪 + 提示')
    }

    try {
      const agent = options.agent ?? this.agentContextOf(session, options.model)
      const result = await this.compaction.compactIfNeeded(agent, 'pressure', signal)
      return this.mapCompactionResult(session, result, 'auto', compactionId)
    } catch (error) {
      return this.failedResult(session, 'auto', compactionId, error)
    }
  }

  /** 手动压缩（用户主动 /compact 语义；DSH compactNow）。 */
  async manualCompact(session: PressureSessionLike, options: ManualCompactOptions = {}): Promise<GuardActionResult> {
    const signal = options.signal ?? new AbortController().signal
    const compactionId = randomUUID()
    if (!this.compaction) {
      return this.degradedResult(session, 'manual', 'DSH compaction 服务不可用（接口待接）: 手动压缩请求已登记，未实际压缩')
    }
    try {
      const agent = options.agent ?? this.agentContextOf(session, options.model)
      const result = await this.compaction.compactNow(agent, signal, options.sourceCommandId)
      return this.mapCompactionResult(session, result, 'manual', compactionId)
    } catch (error) {
      return this.failedResult(session, 'manual', compactionId, error)
    }
  }

  /** 区域压缩（DSH compactRegion：按 surface 位置 span，端点必须配对平衡）。 */
  async regionCompact(
    session: PressureSessionLike,
    start: number,
    end: number,
    options: RegionCompactOptions = {},
  ): Promise<GuardActionResult> {
    const signal = options.signal ?? new AbortController().signal
    const compactionId = randomUUID()
    if (!this.compaction) {
      return this.degradedResult(session, 'region', `DSH compaction 服务不可用（接口待接）: 区域压缩请求 [${start},${end}] 已登记，未实际压缩`)
    }
    try {
      const agent = options.agent ?? this.agentContextOf(session, options.model)
      const result = await this.compaction.compactRegion(start, end, agent, signal)
      return this.mapCompactionResult(session, result, 'region', compactionId)
    } catch (error) {
      return this.failedResult(session, 'region', compactionId, error)
    }
  }

  /**
   * 上下文溢出恢复：先裁剪低优先级工具结果（DSH toolResultPruner），
   * 再请求 context-overflow 压缩；重试本身由集成方在收到结果后执行。
   * 所有步骤失败均保留（不把失败伪装成成功）。
   */
  async overflowRetry(session: PressureSessionLike, options: OverflowRetryOptions = {}): Promise<GuardActionResult> {
    const signal = options.signal ?? new AbortController().signal
    const compactionId = randomUUID()
    const steps: string[] = []
    let pruned = 0
    let degraded = this.compaction === undefined

    if (this.toolResultPruner) {
      try {
        const result = this.toolResultPruner.pruneSession(session as unknown)
        pruned = result.pruned.length
        steps.push(`工具结果裁剪 ${pruned} 条（移除 ${result.charsRemoved} 字符）`)
      } catch (error) {
        steps.push(`工具结果裁剪失败: ${messageOf(error)}`)
      }
    } else {
      degraded = true
      steps.push('DSH toolResultPruner 不可用，跳过工具结果裁剪')
    }

    if (this.compaction) {
      try {
        const agent = options.agent ?? this.agentContextOf(session, options.model)
        const result = await this.compaction.compactIfNeeded(agent, 'context-overflow', signal)
        if (result) {
          steps.push('已执行 context-overflow 压缩')
        } else {
          steps.push('context-overflow 压缩未产生可压缩范围')
        }
      } catch (error) {
        steps.push(`context-overflow 压缩失败: ${messageOf(error)}`)
      }
    } else {
      steps.push('DSH compaction 不可用（接口待接）')
    }

    const record: CompactionRecord = {
      compactionId,
      sessionId: session.id,
      trigger: 'overflow-retry',
      status: degraded && pruned === 0 ? 'degraded-noop' : 'completed',
      startedAt: Date.now(),
      endedAt: Date.now(),
      source: 'evoresearch',
      degradedReason: degraded && pruned === 0 ? 'DSH compaction 与 toolResultPruner 均不可用' : undefined,
      summaryVersion: undefined,
    }
    return {
      ok: true,
      applied: pruned > 0,
      degraded,
      record: this.logRecord(record),
      detail: steps.join('；'),
    }
  }

  // ── 结果映射 ──────────────────────────────────────────────────────────────

  private mapCompactionResult(
    session: PressureSessionLike,
    result: unknown,
    trigger: CompactionRecord['trigger'],
    fallbackId: string,
  ): GuardActionResult {
    const shape = (result ?? {}) as DshCompactionResultShape
    const compactionId = typeof shape.compactionId === 'string' ? shape.compactionId : fallbackId
    const shadowedSeqs = Array.isArray(shape.shadowedSeqs) ? (shape.shadowedSeqs as unknown[]).map(Number) : []
    const shadowed = shape.shadowedRange ?? {}
    const record: CompactionRecord = {
      compactionId,
      sessionId: session.id,
      trigger,
      status: 'completed',
      startedAt: Date.now(),
      endedAt: Date.now(),
      messageRange: {
        start: typeof shadowed.start === 'number' ? shadowed.start : 0,
        end: typeof shadowed.end === 'number' ? shadowed.end : 0,
        shadowedSeqs,
        shadowedTokenCount: typeof shape.shadowedTokenCount === 'number' ? shape.shadowedTokenCount : undefined,
      },
      summaryText: summaryTextOf(shape.summary),
      summaryVersion: this.compactionLog.nextSummaryVersion(session.id),
      source: 'dsh',
    }
    return { ok: true, applied: true, degraded: false, record: this.logRecord(record) }
  }

  private degradedResult(session: PressureSessionLike, trigger: CompactionRecord['trigger'], reason: string): GuardActionResult {
    const record: CompactionRecord = {
      compactionId: randomUUID(),
      sessionId: session.id,
      trigger,
      status: 'degraded-noop',
      startedAt: Date.now(),
      source: 'evoresearch',
      degradedReason: reason,
    }
    return { ok: true, applied: false, degraded: true, record: this.logRecord(record), detail: reason }
  }

  private failedResult(
    session: PressureSessionLike,
    trigger: CompactionRecord['trigger'],
    compactionId: string,
    error: unknown,
  ): GuardActionResult {
    const record: CompactionRecord = {
      compactionId,
      sessionId: session.id,
      trigger,
      status: 'failed',
      startedAt: Date.now(),
      endedAt: Date.now(),
      source: 'evoresearch',
      error: messageOf(error),
    }
    return { ok: false, applied: false, degraded: false, record: this.logRecord(record), detail: messageOf(error) }
  }

  private logRecord(record: CompactionRecord): CompactionRecord {
    this.compactionLog.append(record)
    return record
  }

  // ── CTX-15 工具结果裁剪（运行时部分）──────────────────────────────────────

  /**
   * 裁剪一段工具结果：完整原文写入档案文件（tool-results/<sessionId>-<callId>.txt），
   * 返回裁剪计划、注入投影文本与继续读取位置（文件路径 + 偏移）。
   * 未超预算时原样返回、不写档案。
   */
  pruneToolResult(input: PruneToolResultInput): PruneToolResultOutput {
    const plan = planPrune(input.text, this.config.pruneBudget)
    if (plan.action === 'keep') {
      return { record: undefined, plan, prunedText: input.text, applied: false }
    }
    const safeSession = safeSegment(input.sessionId)
    const safeCall = safeSegment(input.callId)
    const archivePath = path.join(this.toolResultsDir(), `${safeSession}-${safeCall}.txt`)
    try {
      fs.mkdirSync(this.toolResultsDir(), { recursive: true })
      fs.writeFileSync(archivePath, input.text, 'utf8')
    } catch (error) {
      console.warn(`[evoresearch:context] 工具结果归档写入失败（裁剪仍可用）: ${String(error)}`)
    }
    const continueRead = { path: archivePath, offset: plan.continueOffset }
    const prunedText = renderPrunedText(plan, continueRead)
    const record: ToolResultArchiveRecord = {
      callId: input.callId,
      toolName: input.toolName,
      sessionId: input.sessionId,
      archivedAt: Date.now(),
      charsBefore: input.text.length,
      charsAfter: prunedText.length,
      archive: { path: archivePath, offset: 0 },
      continueRead,
      prunedText,
    }
    this.prunes.push(record)
    this.appendLine(this.toolResultsIndexFile(), JSON.stringify(record))
    return { record, plan, prunedText, applied: true }
  }

  // ── CTX-17 工具历史修复（运行时部分）──────────────────────────────────────

  /**
   * 检测并修复工具调用序列：从会话派生消息 → 分析 → 生成修复后投影，
   * 修复前后分别保存（JSONL + 内存）。balanced 时返回空记录。
   */
  repairToolHistory(session: PressureSessionLike): RepairToolHistoryOutput {
    const messages = this.deriveMessagesOf(session).map(toRepairMessage)
    const analysis = analyzeToolHistory(messages)
    const repaired = buildRepairedProjection(messages, analysis)
    if (analysis.balanced) {
      return { record: undefined, analysis, repaired }
    }
    const record = createRepairRecord(session.id, messages, analysis, repaired)
    this.repairs.push(record)
    this.appendLine(this.repairsFile(), JSON.stringify(record))
    return { record, analysis, repaired }
  }

  /** 已保存的修复记录（CTX-17 回读）。 */
  repairRecords(sessionId?: string): readonly ToolHistoryRepairRecord[] {
    return sessionId === undefined ? this.repairs : this.repairs.filter((record) => record.sessionId === sessionId)
  }

  // ── CTX-16 查询 ───────────────────────────────────────────────────────────

  queryCompactions(query: CompactionQuery = {}): readonly CompactionRecord[] {
    return this.compactionLog.query(query)
  }

  // ── CTX-18 当前上下文来源查询 ─────────────────────────────────────────────

  /**
   * 列出本轮投影由哪些摘要、原文片段、工具结果与 Graph 连接构成。
   * 会话不在内存时尝试经 sessionQuery 回读事件（只读）。
   */
  async queryContextSources(sessionId: string, options: ContextSourcesOptions = {}): Promise<ContextSourceReport> {
    const compactions = this.compactionLog.query({ sessionId })
    const pruned = this.prunes.filter((record) => record.sessionId === sessionId)
    const surface = await this.surfaceEventsOf(sessionId)
    return describeContextSources({
      sessionId,
      compactions,
      surfaceEvents: surface,
      prunedToolResults: pruned,
      graphConnections: options.graphConnections,
    })
  }

  private async surfaceEventsOf(sessionId: string): Promise<SurfaceEventInfo[]> {
    // 1) 内存中的活动会话
    const ctx = this.ctxRef
    const sessions = ctx?.get('sessions') as { get?: (id: string) => unknown } | undefined
    const getSession = sessions?.get
    const session = getSession ? (getSession.call(sessions, sessionId) as PressureSessionLike | undefined) : undefined
    if (session?.events) {
      return eventsToSurfaceInfo(session.events)
    }
    // 2) sessionQuery 只读回读
    if (this.sessionQuery?.listEvents) {
      try {
        const events = await this.sessionQuery.listEvents(sessionId)
        return eventsToSurfaceInfo(events)
      } catch {
        return []
      }
    }
    return []
  }
}

// ── 模块级工具函数 ─────────────────────────────────────────────────────────

/** 从 DSH Message[] 投影出修复模块的最小消息结构。 */
function toRepairMessage(message: unknown): RepairMessage {
  const m = message as { role?: unknown; content?: unknown }
  const content = Array.isArray(m.content) ? m.content : []
  const blocks = content
    .map((block): RepairMessage['content'][number] | undefined => {
      const b = block as { type?: unknown }
      if (b?.type === 'text') {
        const text = (block as { text?: unknown }).text
        return { type: 'text', text: typeof text === 'string' ? text : '' }
      }
      if (b?.type === 'tool-call') {
        const call = block as { id?: unknown; name?: unknown; arguments?: unknown }
        return {
          type: 'tool-call',
          id: typeof call.id === 'string' ? call.id : String(call.id ?? ''),
          name: typeof call.name === 'string' ? call.name : '',
          arguments: typeof call.arguments === 'string' ? call.arguments : '',
        }
      }
      if (b?.type === 'tool-result') {
        const result = block as { toolCallId?: unknown; content?: unknown; isError?: unknown }
        return {
          type: 'tool-result',
          toolCallId: typeof result.toolCallId === 'string' ? result.toolCallId : String(result.toolCallId ?? ''),
          content: Array.isArray(result.content) ? result.content.map(blockToRepair) : [],
          isError: result.isError === true,
        }
      }
      return undefined // reasoning/image 等块不影响配对，跳过
    })
    .filter((block): block is RepairMessage['content'][number] => block !== undefined)
  const role = m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user'
  return { role, content: blocks }
}

function blockToRepair(block: unknown): RepairMessage['content'][number] {
  const b = block as { type?: unknown; text?: unknown }
  if (b?.type === 'text') return { type: 'text', text: typeof b.text === 'string' ? b.text : '' }
  return { type: 'text', text: '' }
}

/** 估算一条 DSH 消息的 token（text 块 + tool-call 参数，字符/token 近似）。 */
function estimateMessageTokens(message: unknown): number {
  const m = message as { content?: unknown }
  if (!Array.isArray(m.content)) return 0
  let chars = 0
  for (const block of m.content) {
    const b = block as { type?: unknown; text?: unknown; arguments?: unknown }
    if (b?.type === 'text' && typeof b.text === 'string') chars += b.text.length
    if (b?.type === 'tool-call' && typeof b.arguments === 'string') chars += b.arguments.length
  }
  return chars === 0 ? 0 : Math.ceil(chars / DEFAULT_CHARS_PER_TOKEN)
}

/** 把事件列表投影为来源查询用的 SurfaceEventInfo（容忍任意结构）。 */
function eventsToSurfaceInfo(events: readonly unknown[]): SurfaceEventInfo[] {
  const info: SurfaceEventInfo[] = []
  for (const raw of events) {
    const event = raw as { type?: unknown; seq?: unknown; data?: unknown }
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    const seq = typeof event.seq === 'number' ? event.seq : 0
    const data = (event.data ?? {}) as { message?: unknown }
    const message = data.message as { role?: unknown; content?: unknown } | undefined
    let text = ''
    if (Array.isArray(message?.content)) {
      text = message.content
        .map((block) => {
          const b = block as { type?: unknown; text?: unknown }
          return typeof b?.text === 'string' ? b.text : ''
        })
        .join('')
    }
    info.push({
      seq,
      type: String(event.type),
      label: text.slice(0, 80) || (event.type === 'user/message' ? '（用户消息）' : '（助手消息）'),
      estimatedTokens: estimateProjectionTokens(text),
    })
  }
  return info
}

/** 从 DSH summary ContentBlock[] 提取摘要文本。 */
function summaryTextOf(summary: unknown): string | undefined {
  if (typeof summary === 'string') return summary
  if (!Array.isArray(summary)) return undefined
  const parts = summary
    .map((block) => {
      const b = block as { type?: unknown; text?: unknown }
      return typeof b?.text === 'string' ? b.text : ''
    })
    .filter((text) => text.length > 0)
  return parts.length > 0 ? parts.join('\n') : undefined
}

function parseToolResultArchiveLine(line: string): ToolResultArchiveRecord | undefined {
  try {
    const value = JSON.parse(line) as unknown
    if (value && typeof value === 'object' && typeof (value as ToolResultArchiveRecord).callId === 'string') {
      return value as ToolResultArchiveRecord
    }
    return undefined
  } catch {
    return undefined
  }
}

function parseRepairLine(line: string): ToolHistoryRepairRecord | undefined {
  try {
    const value = JSON.parse(line) as unknown
    if (value && typeof value === 'object' && typeof (value as ToolHistoryRepairRecord).repairId === 'string') {
      return value as ToolHistoryRepairRecord
    }
    return undefined
  } catch {
    return undefined
  }
}

function readLinesSafe(file: string): string[] {
  if (!fs.existsSync(file)) return []
  const content = fs.readFileSync(file, 'utf8')
  return content.split('\n')
}

/** 错误 → 消息（稳定、不抛）。 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 归档文件名安全段（去路径分隔符与控制字符）。 */
function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 96)
}
