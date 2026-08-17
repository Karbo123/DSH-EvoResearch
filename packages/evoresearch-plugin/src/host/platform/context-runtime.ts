/**
 * 上下文运行时接入层（PLAT-03..07）。
 *
 * 组合 t5 ContextWindowRuntime（context/guard.ts，压缩/裁剪/事件记录/历史修复
 * 的运行时）+ t8 PlatformAdapters（platform/adapters.ts，能力探测判据），
 * 提供科研模块可用的统一入口：
 *
 * - PLAT-03 压缩接入：以 `adapters.has('compaction')` 为判据；可用则经 guard
 *   调 DSH ctx.compaction（自动压力/溢出、手动、区域），不可用走 guard 的
 *   degraded-noop（事件登记 + 明确降级路径，绝不抛异常）。
 * - PLAT-04 工具结果裁剪管线：pruner 计划 → 完整原文归档 → 继续读取位置注入；
 *   `wrapToolExecute` 是"tools 执行后置钩子"的注册点（由队长在模型调用管线
 *   接线：包装 ToolRuntime.execute 或 middleware）。
 * - PLAT-05 压缩事件折叠：guard 已订阅 session/event 并把 DSH compaction
 *   start/summary/end 折叠进 compactions.jsonl（CTX-16）；本层透传查询。
 * - PLAT-06 历史修复重试：`repairAndRetry` 编排（分析 → 修复后投影 → 重试
 *   载荷），修复前后记录分别保存（guard.repairRecords 回读）。
 * - PLAT-07 session query 投影适配：current / shadowed / log-only 投影区分
 *   （`classifyProjection` 纯函数）+ bounded read + lineage 查询（父子会话谱系，
 *   来源为 session header 的 parentSession meta 或 sessionQuery.traceSession）。
 *
 * 降级总原则（PLAT-21）：任何 DSH 能力缺失都只降级、只登记、不损坏科研资料
 * （记忆/笔记/实验文件不经本层写操作）。
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  ContextWindowRuntime,
  type ContextWindowConfig,
  type GuardStatus,
  type PressureSessionLike,
  type AutoCompactOptions,
  type ManualCompactOptions,
  type RegionCompactOptions,
  type OverflowRetryOptions,
  type PruneToolResultInput,
  type PruneToolResultOutput,
  type RepairToolHistoryOutput,
} from '../context/guard.js'
import type { CompactionRecord, CompactionQuery, GuardActionResult, ToolResultArchiveRecord } from '../context/types.js'
import type { ToolHistoryRepairRecord, RepairedProjection, ToolHistoryAnalysis } from '../context/history-repair.js'
import { serializeProjection } from '../context/history-repair.js'
import { createPlatformAdapters, type PlatformAdapters } from './adapters.js'
import type { CapabilityProbe } from './capabilities.js'
import { readSessionEvents } from '../rewind.js'

/* ------------------------------------------------------------------ */
/* 状态与选项                                                            */
/* ------------------------------------------------------------------ */

/** 能力接入状态（PLAT-03 判据 + 降级路径）。 */
export type RuntimeCapabilityState = 'available' | 'degraded' | 'missing'

/** 运行时接入总览（PLAT-21 降级报告）。 */
export interface ContextRuntimeStatus {
  readonly compaction: RuntimeCapabilityState
  readonly toolPruning: RuntimeCapabilityState
  /** DSH compaction 事件折叠订阅（PLAT-05）。 */
  readonly eventFolding: boolean
  /** 历史修复可用（本地能力，恒 true；依赖派生消息）。 */
  readonly historyRepair: boolean
  readonly sessionQuery: RuntimeCapabilityState
  /** 降级原因列表（每条能力一条，供日志/界面展示）。 */
  readonly degradations: readonly string[]
  /** 是否整体降级（任一核心能力非 available）。 */
  readonly degraded: boolean
}

export interface ContextRuntimeOptions {
  readonly dataRoot?: string
  readonly windowConfig?: ContextWindowConfig
  /** 注入能力探测结果（测试/复用）；缺省 attach 时 createPlatformAdapters。 */
  readonly adapters?: PlatformAdapters
}

/* ------------------------------------------------------------------ */
/* PLAT-04：工具执行后置钩子（管线注册点）                               */
/* ------------------------------------------------------------------ */

/** 被包装的 tools.execute 最小形态（ToolRuntime.execute 的结构）。 */
export interface ToolExecuteLike {
  (input: {
    callId?: string
    name: string
    arguments?: unknown
    agent?: unknown
    signal?: AbortSignal
  }): Promise<{ content: readonly unknown[]; isError: boolean; meta?: unknown }>
}

/** 从工具执行上下文解析会话 id（agent.session.id 或注入函数）。 */
export type SessionIdResolver = (input: Parameters<ToolExecuteLike>[0]) => string | undefined

/** 工具执行包装结果。 */
export interface WrappedToolExecute {
  /** 包装后的 execute（执行 → 结果文本 → 裁剪归档 → 注入继续读取位置）。 */
  execute: ToolExecuteLike
}

/**
 * PLAT-04 管线注册点：包装一次工具执行，把超长工具结果接入裁剪管线
 * （pruner 计划 → 完整归档 → 继续读取位置注入）。
 *
 * 接线说明（队长在模型调用管线处）：把 ToolRuntime.execute 用本函数包装后
 * 替换/包装调用点，或在 middleware 位置调用本包装；sessionIdOf 缺省从
 * input.agent.session.id 解析（DSH ToolExecutionInput.agent 携带 Session）。
 * 裁剪失败不影响原结果返回（降级：原样透传 + warn）。
 */
export function wrapToolExecute(
  execute: ToolExecuteLike,
  prune: (input: PruneToolResultInput) => PruneToolResultOutput,
  sessionIdOf?: SessionIdResolver,
): WrappedToolExecute {
  return {
    execute: async (input) => {
      const result = await execute(input)
      if (result.isError) return result
      const sessionId = sessionIdOf ? sessionIdOf(input) : defaultSessionIdOf(input)
      if (sessionId === undefined || sessionId === '') return result
      const text = contentToText(result.content)
      if (text === '') return result
      const pruned = prune({ sessionId, callId: input.callId ?? `call-${Date.now()}`, toolName: input.name, text })
      if (!pruned.applied) return result
      // 替换 text 块为裁剪后文本（保留非 text 块结构；tool-result content 通常为 [text]）。
      const content = replaceTextBlocks(result.content, pruned.prunedText)
      return { ...result, content }
    },
  }
}

/** 缺省会话 id 解析：input.agent.session.id。 */
function defaultSessionIdOf(input: Parameters<ToolExecuteLike>[0]): string | undefined {
  const agent = input.agent as { session?: { id?: unknown } } | undefined
  const id = agent?.session?.id
  return typeof id === 'string' ? id : undefined
}

/** 把 content blocks 拼成纯文本（text 块拼接）。 */
function contentToText(blocks: readonly unknown[]): string {
  return blocks
    .map((block) => {
      const b = block as { type?: unknown; text?: unknown }
      return typeof b?.type === 'string' && b.type === 'text' && typeof b.text === 'string' ? b.text : ''
    })
    .join('')
}

/** 把 content 中的 text 块替换为单块裁剪后文本（其余块原样保留）。 */
function replaceTextBlocks(blocks: readonly unknown[], prunedText: string): readonly unknown[] {
  const hasText = blocks.some((block) => (block as { type?: unknown })?.type === 'text')
  if (!hasText) return blocks
  const out: unknown[] = []
  for (const block of blocks) {
    const b = block as { type?: unknown }
    if (b?.type === 'text') continue
    out.push(block)
  }
  return [{ type: 'text', text: prunedText }, ...out]
}

/* ------------------------------------------------------------------ */
/* PLAT-07：投影分类（纯函数）                                          */
/* ------------------------------------------------------------------ */

/** 投影类别（PLAT-07：current=当前可见 / shadowed=被压缩遮蔽 / log-only=仅日志）。 */
export type ProjectionKind = 'current' | 'shadowed' | 'log-only'

/** 事件投影标注。 */
export interface ProjectedEvent {
  readonly seq: number
  readonly type: string
  readonly time: number
  readonly projection: ProjectionKind
  /** 被哪次压缩遮蔽（shadowed 时）。 */
  readonly shadowedByCompactionId?: string
}

/** 会话事件最小形态（容忍任意结构，只读叶字段）。 */
export interface SessionEventLike {
  readonly seq?: unknown
  readonly type?: unknown
  readonly time?: unknown
  readonly data?: unknown
}

/** 参与 surface 投影的事件类型（消息类；chunk/turn 等不进入派生历史）。 */
const SURFACE_EVENT_TYPES = new Set([
  'user/message',
  'assistant/message',
  'assistant/tool-call',
  'assistant/tool-result',
  'compaction/summary',
])

/**
 * 把事件序列分类为 current / shadowed / log-only（PLAT-07 纯函数）：
 * 1. 先按压缩记录的 messageRange.shadowedSeqs 标记 shadowed；
 * 2. 否则按 surface 类型（或显式 surfaceSeqs 集合）标记 current；
 * 3. 其余为 log-only。
 */
export function classifyProjection(
  events: readonly SessionEventLike[],
  compactions: readonly CompactionRecord[],
  surfaceSeqs?: readonly number[],
): ProjectedEvent[] {
  const shadowedBy = new Map<number, string>()
  for (const record of compactions) {
    for (const seq of record.messageRange?.shadowedSeqs ?? []) {
      shadowedBy.set(seq, record.compactionId)
    }
  }
  const surface = surfaceSeqs !== undefined ? new Set(surfaceSeqs) : undefined
  const out: ProjectedEvent[] = []
  for (const raw of events) {
    const seq = typeof raw.seq === 'number' ? raw.seq : 0
    const type = typeof raw.type === 'string' ? raw.type : ''
    const time = typeof raw.time === 'number' ? raw.time : 0
    let projection: ProjectionKind
    let shadowedByCompactionId: string | undefined
    const shadowedCompaction = shadowedBy.get(seq)
    if (shadowedCompaction !== undefined) {
      projection = 'shadowed'
      shadowedByCompactionId = shadowedCompaction
    } else if (surface !== undefined ? surface.has(seq) : SURFACE_EVENT_TYPES.has(type)) {
      projection = 'current'
    } else {
      projection = 'log-only'
    }
    out.push({ seq, type, time, projection, shadowedByCompactionId })
  }
  out.sort((a, b) => a.seq - b.seq)
  return out
}

/* ------------------------------------------------------------------ */
/* PLAT-07：投影查询与谱系                                              */
/* ------------------------------------------------------------------ */

export interface ProjectionQueryOptions {
  /** 请求的投影类别；缺省 all（返回全部带标注）。 */
  readonly projection?: ProjectionKind | 'all'
  /** bounded read：seq 范围 + 数量上限（PLAT-07）。 */
  readonly bounded?: { readonly startSeq?: number; readonly endSeq?: number; readonly limit?: number }
}

export interface ProjectionQueryResult {
  readonly sessionId: string
  readonly events: readonly ProjectedEvent[]
  /** 数据来源：live 会话内存 / sessionQuery 持久化回读 / 两者都不可用。 */
  readonly source: 'live' | 'session-query' | 'unavailable'
  /** 请求的投影类别（透传）。 */
  readonly projection: ProjectionKind | 'all'
  /** 是否因 bounded.limit 截断。 */
  readonly truncated: boolean
}

export interface LineageEntry {
  readonly sessionId: string
  /** 0 = 自身；>0 = 祖先。 */
  readonly depth: number
  readonly parentSessionId?: string
}

export interface LineageResult {
  /** 祖先链根（最远祖先；无祖先时为自身）。 */
  readonly root: string
  /** 祖先链（root 在前、自身在后）。 */
  readonly chain: readonly LineageEntry[]
  readonly source: 'header-meta' | 'session-query' | 'unavailable'
}

/* ------------------------------------------------------------------ */
/* ContextRuntime 门面                                                  */
/* ------------------------------------------------------------------ */

/**
 * 上下文运行时接入层门面（PLAT-03..07）。
 * 用法：const runtime = new ContextRuntime({ dataRoot }); const dispose = runtime.attach(ctx)。
 */
export class ContextRuntime {
  readonly guard: ContextWindowRuntime
  private readonly pruneRecords_: ToolResultArchiveRecord[] = []
  private adapters: PlatformAdapters | undefined
  private ctxRef: Context | undefined
  private sessionStore: { get?: (id: string) => unknown } | undefined
  private sessionQuery: {
    listEvents?: (sessionId: string) => Promise<readonly unknown[]>
    readSession?: (sessionId: string) => Promise<unknown>
    traceSession?: (sessionId: string) => Promise<unknown>
  } | undefined

  constructor(options: ContextRuntimeOptions = {}) {
    this.guard = new ContextWindowRuntime(options.windowConfig ?? { dataRoot: options.dataRoot })
    this.adapters = options.adapters
  }

  /** 挂载全部副作用（guard.attach + 能力探测）。返回 disposer。 */
  attach(ctx: Context): () => void {
    this.ctxRef = ctx
    this.adapters = this.adapters ?? createPlatformAdapters(ctx)
    const sessionQuery = ctx.get('sessionQuery') as
      | { listEvents?: (sessionId: string) => Promise<readonly unknown[]>; readSession?: (sessionId: string) => Promise<unknown>; traceSession?: (sessionId: string) => Promise<unknown> }
      | undefined
    this.sessionQuery = sessionQuery ?? undefined
    const sessions = ctx.get('sessions') as { get?: (id: string) => unknown } | undefined
    this.sessionStore = sessions ?? undefined
    const disposeGuard = this.guard.attach(ctx)
    return () => {
      disposeGuard()
      this.ctxRef = undefined
      this.adapters = undefined
      this.sessionQuery = undefined
      this.sessionStore = undefined
    }
  }

  /** 注入/替换能力探测（测试用）。 */
  setAdapters(adapters: PlatformAdapters): void {
    this.adapters = adapters
  }

  /** PLAT-21 状态报告（探测判据 + 降级原因）。 */
  status(): ContextRuntimeStatus {
    const probes = this.adapters?.probes ?? []
    const guardStatus = this.guard.status()
    const state = (probe: CapabilityProbe | undefined, guardOk: boolean): RuntimeCapabilityState => {
      if (probe?.status === 'available') return 'available'
      if (probe?.status === 'partial' || guardOk) return 'degraded'
      return 'missing'
    }
    const compaction = state(probes.find((p) => p.capability === 'compaction'), guardStatus.compaction)
    const sessionQuery = state(probes.find((p) => p.capability === 'sessionQuery'), guardStatus.sessionQuery)
    const toolPruning = guardStatus.toolResultPruner ? 'available' : 'missing'
    const degradations: string[] = []
    if (compaction !== 'available') degradations.push(`compaction: ${compaction}（自动/手动/区域压缩降级为事件登记，不损坏会话原文）`)
    if (sessionQuery !== 'available') degradations.push(`sessionQuery: ${sessionQuery}（跨会话/bounded read 降级为 live store 与本地镜像）`)
    if (toolPruning !== 'available') degradations.push('toolPruning: missing（长工具结果不裁剪，完整返回）')
    return {
      compaction,
      toolPruning,
      eventFolding: true, // guard.attach 恒订阅 session/event 折叠（PLAT-05）
      historyRepair: true, // 本地纯函数能力（依赖派生消息，恒可用）
      sessionQuery,
      degradations,
      // 整体降级只看核心能力（compaction/sessionQuery）；toolPruning 在 rc.6
      // 本就无独立服务，属信息性提示，不把"恒缺失"算作整体降级。
      degraded: compaction !== 'available' || sessionQuery !== 'available',
    }
  }

  /* ── PLAT-03：压缩（透传 guard，判据已由状态机保证降级路径） ──────────── */

  autoCompact(session: PressureSessionLike, options?: AutoCompactOptions): Promise<GuardActionResult> {
    return this.guard.considerAutoCompact(session, options)
  }

  manualCompact(session: PressureSessionLike, options?: ManualCompactOptions): Promise<GuardActionResult> {
    return this.guard.manualCompact(session, options)
  }

  regionCompact(session: PressureSessionLike, start: number, end: number, options?: RegionCompactOptions): Promise<GuardActionResult> {
    return this.guard.regionCompact(session, start, end, options)
  }

  overflowRetry(session: PressureSessionLike, options?: OverflowRetryOptions): Promise<GuardActionResult> {
    return this.guard.overflowRetry(session, options)
  }

  /** PLAT-05：压缩事件记录查询（DSH 原生事件折叠 + 本层登记统一查询）。 */
  compactionRecords(query: CompactionQuery = {}): readonly CompactionRecord[] {
    return this.guard.queryCompactions(query)
  }

  /* ── PLAT-04：工具结果裁剪（透传 guard + 本层记录） ──────────────────── */

  pruneToolResult(input: PruneToolResultInput): PruneToolResultOutput {
    const output = this.guard.pruneToolResult(input)
    if (output.record) this.pruneRecords_.push(output.record)
    return output
  }

  /** 裁剪归档记录查询（本层运行期收集；历史记录在 guard 的 index.jsonl）。 */
  pruneRecords(sessionId?: string): readonly ToolResultArchiveRecord[] {
    return sessionId === undefined ? this.pruneRecords_ : this.pruneRecords_.filter((record) => record.sessionId === sessionId)
  }

  /* ── PLAT-06：历史修复与重试编排 ─────────────────────────────────────── */

  /** 修复记录查询（修复前后分别保存，回读）。 */
  repairRecords(sessionId?: string): readonly ToolHistoryRepairRecord[] {
    return this.guard.repairRecords(sessionId)
  }

  /**
   * 修复并重试编排（PLAT-06）：分析工具调用序列 → 生成修复后投影 →
   * 序列化为可重发载荷（retryPayload）；修复记录前后分别保存（guard）。
   * balanced 时返回 retryPayload=null（无需修复）。
   */
  repairAndRetry(session: PressureSessionLike): {
    readonly record: ToolHistoryRepairRecord | undefined
    readonly analysis: ToolHistoryAnalysis
    readonly repaired: RepairedProjection
    /** 修复后投影的可重发文本载荷（null = 无需修复）。 */
    readonly retryPayload: string | null
  } {
    const output: RepairToolHistoryOutput = this.guard.repairToolHistory(session)
    // record 存在 = 检测到未配对问题并生成了修复记录；balanced 时为 null。
    const retryPayload = output.record ? serializeProjection(output.repaired.messages) : null
    return { record: output.record, analysis: output.analysis, repaired: output.repaired, retryPayload }
  }

  /* ── PLAT-07：投影查询与谱系 ────────────────────────────────────────── */

  /**
   * 会话投影查询：跨会话/指定会话（sessionId）+ bounded read +
   * current/shadowed/log-only 投影区分。数据源：live store → sessionQuery 回读。
   */
  async queryProjection(sessionId: string, options: ProjectionQueryOptions = {}): Promise<ProjectionQueryResult> {
    const compactions = this.guard.queryCompactions({ sessionId })
    const liveEvents = this.liveEventsOf(sessionId)
    let events: readonly SessionEventLike[]
    let source: ProjectionQueryResult['source']
    if (liveEvents !== undefined) {
      events = liveEvents
      source = 'live'
    } else if (this.sessionQuery?.listEvents) {
      try {
        events = (await this.sessionQuery.listEvents(sessionId)) as readonly SessionEventLike[]
        source = 'session-query'
      } catch {
        events = []
        source = 'unavailable'
      }
    } else {
      // rc.6 没有挂载 sessionQuery 时，插件自己的 DSH session log 仍是
      // 最终兜底原文；这使 bounded read/lineage 在 Web、CLI、重启后都可用。
      try {
        events = readSessionEvents(sessionId) as readonly SessionEventLike[]
        source = events.length > 0 ? 'session-query' : 'unavailable'
      } catch {
        events = []
        source = 'unavailable'
      }
    }
    const classified = classifyProjection(events, compactions)
    const projection = options.projection ?? 'all'
    let filtered = projection === 'all' ? classified : classified.filter((event) => event.projection === projection)
    const bounded = options.bounded
    if (bounded) {
      if (bounded.startSeq !== undefined) filtered = filtered.filter((event) => event.seq >= bounded.startSeq!)
      if (bounded.endSeq !== undefined) filtered = filtered.filter((event) => event.seq <= bounded.endSeq!)
    }
    let truncated = false
    if (bounded?.limit !== undefined && filtered.length > bounded.limit) {
      filtered = filtered.slice(0, bounded.limit)
      truncated = true
    }
    return { sessionId, events: filtered, source, projection, truncated }
  }

  /** 会话谱系（父子链）：header.parentSession meta 优先，sessionQuery.traceSession 兜底。 */
  async queryLineage(sessionId: string): Promise<LineageResult> {
    // 1) header meta 回溯（graphInherit fork 的 parentSession 即谱系来源）。
    const chain: LineageEntry[] = []
    let current: string | undefined = sessionId
    let depth = 0
    let viaHeader = false
    while (current !== undefined) {
      chain.push({ sessionId: current, depth, parentSessionId: undefined })
      const header: { parentSession?: unknown } | undefined = this.headerOf(current) ?? this.logHeaderOf(current)
      const parent: string | undefined = typeof header?.parentSession === 'string' && header.parentSession !== '' ? header.parentSession : undefined
      if (parent === undefined || parent === current) break
      if (parent) viaHeader = true
      current = parent
      depth += 1
    }
    if (chain.length > 1) {
      // 反向重建：root 在前（LineageEntry 只读，重建而非修改）。
      const reversed = chain.reverse()
      const rebuilt: LineageEntry[] = reversed.map((entry, index) => ({
        sessionId: entry.sessionId,
        depth: index,
        parentSessionId: index > 0 ? reversed[index - 1]!.sessionId : undefined,
      }))
      return { root: rebuilt[0]!.sessionId, chain: rebuilt, source: 'header-meta' }
    }
    // 2) sessionQuery.traceSession 兜底。
    if (this.sessionQuery?.traceSession) {
      try {
        const trace = await this.sessionQuery.traceSession(sessionId) as
          | { ancestors?: readonly { sessionId?: unknown }[]; root?: { sessionId?: unknown } }
          | undefined
        const ancestors = trace?.ancestors ?? []
        const entries: LineageEntry[] = []
        const all = [...ancestors, { sessionId }]
        for (const [index, entry] of all.entries()) {
          const id = String(entry?.sessionId ?? '')
          if (id === '') continue
          entries.push({
            sessionId: id,
            depth: index,
            parentSessionId: index > 0 ? String(all[index - 1]?.sessionId ?? '') : undefined,
          })
        }
        if (entries.length > 0) return { root: entries[0]!.sessionId, chain: entries, source: 'session-query' }
      } catch {
        // 兜底失败，回落 unavailable
      }
    }
    const logHeader = this.logHeaderOf(sessionId)
    if (logHeader?.parentSession) {
      // 理论上已在上面的 header loop 处理；这里只保证 source 标注稳定。
      void viaHeader
    }
    return { root: sessionId, chain: [{ sessionId, depth: 0 }], source: logHeader ? 'session-query' : 'unavailable' }
  }

  private liveEventsOf(sessionId: string): readonly SessionEventLike[] | undefined {
    const session = this.sessionStore?.get?.(sessionId)
    const events = (session as { events?: readonly SessionEventLike[] } | undefined)?.events
    return Array.isArray(events) ? events : undefined
  }

  private headerOf(sessionId: string): { parentSession?: unknown } | undefined {
    const session = this.sessionStore?.get?.(sessionId)
    return (session as { header?: { parentSession?: unknown } } | undefined)?.header
  }

  /** 从持久化 session log 的 session/header 事件读取 parentSession 元数据。 */
  private logHeaderOf(sessionId: string): { parentSession?: unknown } | undefined {
    try {
      const events = readSessionEvents(sessionId) as Array<Record<string, unknown>>
      const head = events.find((event) => event.type === 'session' || event.type === 'session/header')
      const data = head?.data as Record<string, unknown> | undefined
      const parent = head?.parentSession ?? data?.parentSession ?? (data?.meta as Record<string, unknown> | undefined)?.parentSession
      return parent === undefined ? undefined : { parentSession: parent }
    } catch {
      return undefined
    }
  }
}
