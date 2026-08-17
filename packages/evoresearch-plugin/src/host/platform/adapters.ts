/**
 * DSH 平台服务统一访问适配层（PLAT-02）。
 *
 * 科研模块只依赖本模块暴露的适配接口（`adapters.*`），不直接访问
 * `ctx.sessions` / `ctx.llm` / `ctx.tools` 等 DSH 服务名与调用形态；
 * DSH 版本升级时只改本文件与 `capabilities.ts` 的矩阵即可。
 *
 * 每个适配器在对应 DSH 服务缺失时给出明确的降级行为：
 * - 构造时汇总缺失/部分能力并记录 warning（`quiet: true` 可只收集不打印）；
 * - 读操作（list/get/current）降级返回空值；
 * - 写/执行操作（create/fork/invoke/register/request）抛出
 *   `PlatformCapabilityUnavailableError`（approval 例外：fail-closed 返回
 *   `unavailable`，显式 `allowMissing` 才放行）；
 * - 可安全跳过的副作用（restrict/guard/setPolicy）降级为 no-op 并告警。
 *
 * 使用方式（与 host/index.ts 的服务构造风格一致，构造参数传 ctx）：
 * ```ts
 * const adapters = createPlatformAdapters(ctx)
 * console.log(adapters.summarize())
 * if (adapters.has('sessionQuery')) { /* MEM 层跨会话检索 *\/ }
 * ```
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  DSH_CAPABILITY_MATRIX,
  capabilityUsable,
  probeCapabilities,
} from './capabilities.js'
import type { CapabilityProbe, PlatformCapability } from './capabilities.js'

/* ------------------------------------------------------------------ */
/* rc.6 服务最小结构（DSH 细节唯一出现处；升级版本只改这里）            */
/* ------------------------------------------------------------------ */

/** ctx.sessions（SessionStore）最小结构。 */
interface SessionStoreLike {
  create(id?: string, options?: { seed?: readonly unknown[]; meta?: Record<string, unknown> }): unknown
  get(id: string): unknown
  list(): unknown[]
  fork(source: unknown, boundary?: number, childSessionId?: string): unknown
  flush(session: unknown): Promise<boolean>
}

/** ctx.sessionQuery（SessionQueryEngine）最小结构（可选能力）。 */
interface SessionQueryLike {
  readSession(sessionId: string, signal?: AbortSignal): Promise<unknown>
}

/** ctx.llm（LlmRuntime）最小结构。 */
interface LlmRuntimeLike {
  listProviders(): { id: string; name: string }[]
  listModels(provider: string, signal?: AbortSignal): Promise<{ provider: string; id: string; name: string; description?: string }[]>
  resolveCallConfig(config: { provider?: string; model?: string }, signal?: AbortSignal): Promise<{ provider?: string; model?: string }>
}

/** ctx.agentDefaultModel 最小结构。 */
interface AgentDefaultModelLike {
  currentSelection?(): { provider: string; model: string }
}

/** ctx.tools（ToolRuntime）最小结构。 */
interface ToolRuntimeLike {
  schemas(scope?: unknown): { name: string; description?: string; parameters?: unknown }[]
  get(name: string): { name: string; description?: string } | undefined
  register(definition: unknown): () => void
  restrict(filter: { allow?: readonly string[]; deny?: readonly string[] }): () => void
  guard(guard: (input: unknown) => Promise<unknown>): () => void
  execute(input: {
    callId: string
    name: string
    arguments: unknown
    agent?: unknown
    signal: AbortSignal
  }): Promise<{ content: readonly unknown[]; isError: boolean; meta?: unknown }>
}

/** ctx.approval（ApprovalService）最小结构。 */
interface ApprovalServiceLike {
  request(req: { agent: unknown; toolName: string; callId?: string; reason?: string; signal?: AbortSignal }): Promise<string>
  setPolicy(agent: unknown, policy: unknown): void
}

/** ctx.registry（Cordis RegistryService）最小结构。 */
interface RegistryLike {
  readonly size: number
  keys(): IterableIterator<unknown>
}

/** dsh-host-plugin-inventory 最小结构（可选）。 */
interface PluginInventoryLike {
  list(): { entries?: readonly { moduleName?: string; enabled?: boolean; fiberPhase?: string }[] }
}

/* ------------------------------------------------------------------ */
/* 适配接口（科研模块可见面）                                           */
/* ------------------------------------------------------------------ */

/** 会话头（只读叶字段，不含 live 对象）。 */
export interface SessionHeaderView {
  readonly id: string
  readonly version: number
  readonly createdAt: number
  readonly cwd?: string
  readonly parentSession?: string
  readonly seedLength?: number
  readonly origin?: string
  readonly delegationDepth?: number
}

/** 会话视图（live 会话的只读摘要）。 */
export interface SessionView {
  readonly id: string
  readonly seq: number
  readonly header: SessionHeaderView
}

/** 会话事件视图（事件为 DSH 深冻结 JSON，直接引用其 data 只读）。 */
export interface SessionEventView {
  readonly seq: number
  readonly type: string
  readonly time: number
  readonly data?: Record<string, unknown>
}

/** 会话日志视图（readLog 返回值）。 */
export interface SessionLogView extends SessionView {
  readonly events: readonly SessionEventView[]
}

export interface SessionAdapter {
  /** DSH SessionStore 是否可用。 */
  readonly available: boolean
  /** 取活动会话（仅内存 store 中的 live 会话）；缺失时返回 undefined。 */
  get(id: string): SessionView | undefined
  /** 列出所有活动会话；缺失时返回 []。 */
  list(): SessionView[]
  /** 创建会话（id 省略时由 store 分配）；store 缺失时抛错。 */
  create(options?: { id?: string; cwd?: string; parentSession?: string; seedLength?: number }): SessionView
  /** 从 live 源会话 fork（boundary 为源事件 seq，含）；store 缺失时抛错。 */
  fork(sourceId: string, boundary?: number, childSessionId?: string): SessionView
  /**
   * 读取会话事件日志：优先 live store，其次 sessionQuery.readSession（持久化兜底）；
   * 两者都缺失时返回 undefined。
   */
  readLog(id: string): Promise<SessionLogView | undefined>
  /** 触发持久化 flush；store 缺失时返回 false。 */
  flush(id: string): Promise<boolean>
}

export interface ModelAdapter {
  /** ctx.llm 与 ctx.agentDefaultModel 任一可用即为部分可用。 */
  readonly available: boolean
  /** 当前默认模型（agentDefaultModel.currentSelection）；缺失时 undefined。 */
  current(): { provider: string; model: string } | undefined
  /** 已注册的 provider 路由（llm.listProviders）；缺失时 []。 */
  listProviders(): { id: string; name: string }[]
  /** 某 provider 的模型目录（llm.listModels）；llm 缺失时返回 []。 */
  listModels(provider: string): Promise<{ provider: string; id: string; name: string; description?: string }[]>
  /**
   * 解析一次模型路由（llm.resolveCallConfig）；llm 缺失或解析失败时原样返回
   * target（规则回退，不抛错——调用方以 current()/available 判断可信度）。
   */
  route(target: { provider?: string; model?: string }): Promise<{ provider?: string; model?: string }>
}

export interface ToolInfo {
  readonly name: string
  readonly description?: string
  readonly parameters?: unknown
}

export interface ToolInvokeResult {
  readonly content: readonly unknown[]
  readonly isError: boolean
  readonly meta?: unknown
}

export interface ToolDefinitionLike {
  readonly name: string
  readonly description?: string
  readonly parameters?: unknown
  readonly output?: unknown
  readonly execute?: (...args: unknown[]) => unknown
}

export interface ToolAdapter {
  /** ctx.tools 是否可用。 */
  readonly available: boolean
  /** 当前可见工具 schema 列表（tools.schemas）；缺失时 []。 */
  list(): ToolInfo[]
  /** 按名取工具定义（tools.get）；缺失或未找到时 undefined。 */
  get(name: string): { name: string; description?: string } | undefined
  /** 执行工具（适配层补全 callId/signal）；tools 缺失时抛错。 */
  invoke(name: string, args: unknown, options?: { signal?: AbortSignal; agent?: unknown }): Promise<ToolInvokeResult>
  /** 注册工具，返回 disposer；tools 缺失时抛错。 */
  register(definition: ToolDefinitionLike): () => void
}

export interface ApprovalOutcomeView {
  /** rc.6 的 ApprovalOutcome：allowed-once/rejected/cancelled/unavailable。 */
  readonly outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
  /** true 表示 approval 服务缺失、由适配层降级给出的结果。 */
  readonly degraded?: boolean
}

export interface ApprovalAdapter {
  /** ctx.approval 是否可用。 */
  readonly available: boolean
  /**
   * 请求一次审批。approval 缺失时 fail-closed：返回 'unavailable'（视为拒绝）
   * 并告警；仅当 options.allowMissing 为 true 时返回 'allowed-once'（显式放行，
   * degraded: true）。
   */
  request(
    req: { agent: unknown; toolName: string; callId?: string; reason?: string; signal?: AbortSignal },
    options?: { allowMissing?: boolean },
  ): Promise<ApprovalOutcomeView>
  /** 为 agent 设置审批策略（approval.setPolicy）；缺失时 no-op。 */
  setPolicy(agent: unknown, policy: unknown): void
}

export interface SandboxAdapter {
  /** rc.6 无独立沙箱服务；仅当 tools.restrict/guard 存在时为 true。 */
  readonly available: boolean
  /** 按 Agent 限制可见工具（allow/deny 名单），返回 disposer；不可用时 no-op。 */
  restrict(filter: { allow?: readonly string[]; deny?: readonly string[] }): () => void
  /** 注册工具执行前守卫（异步判定 allow/deny/ask），返回 disposer；不可用时 no-op。 */
  guard(guard: (input: unknown) => Promise<unknown>): () => void
}

export interface EventAdapter {
  /** 事件总线是 Cordis 核心，恒可用。 */
  readonly available: true
  /** 订阅事件，返回 disposer（统一包装 ctx.on，BASE-03）。 */
  on(event: string, listener: (...args: unknown[]) => void): () => void
  /** 单次订阅，返回 disposer。 */
  once(event: string, listener: (...args: unknown[]) => void): () => void
}

export interface PluginEntryView {
  readonly moduleName?: string
  readonly enabled?: boolean
  readonly fiberPhase?: string
}

export interface PluginAdapter {
  /** Cordis registry 恒可用。 */
  readonly registryAvailable: true
  /** dsh-host-plugin-inventory 是否可用。 */
  readonly inventoryAvailable: boolean
  /** 插件运行时数量（registry.size）。 */
  size(): number
  /** 插件清单（inventory 优先，registry 兜底为键摘要）；两者皆无时 []。 */
  list(): PluginEntryView[]
}

export interface PlatformAdapters {
  /** 运行时能力探测结果（按 PLATFORM_CAPABILITIES 顺序）。 */
  readonly probes: readonly CapabilityProbe[]
  /** 构造时记录的降级告警（去重，按能力一条）。 */
  readonly warnings: readonly string[]
  readonly sessions: SessionAdapter
  readonly models: ModelAdapter
  readonly tools: ToolAdapter
  readonly approval: ApprovalAdapter
  readonly sandbox: SandboxAdapter
  readonly events: EventAdapter
  readonly plugins: PluginAdapter
  /** 某能力当前是否可用（status !== 'missing'）。 */
  has(capability: PlatformCapability): boolean
  /** 断言某能力可用，否则抛 PlatformCapabilityUnavailableError。 */
  require(capability: PlatformCapability): void
  /** 人类可读摘要（诊断日志用）。 */
  summarize(): string
}

/** 需要某能力但平台缺失时抛出的类型化错误。 */
export class PlatformCapabilityUnavailableError extends Error {
  readonly capability: PlatformCapability
  constructor(capability: PlatformCapability, message: string) {
    super(message)
    this.name = 'PlatformCapabilityUnavailableError'
    this.capability = capability
  }
}

/* ------------------------------------------------------------------ */
/* 实现                                                                 */
/* ------------------------------------------------------------------ */

/** 从 DSH Session 对象提取只读叶字段（不持有 live 引用）。 */
function toSessionView(session: unknown): SessionView {
  const s = session as {
    id?: unknown
    seq?: unknown
    header?: Record<string, unknown>
  }
  const header = (s.header ?? {}) as Record<string, unknown>
  return {
    id: String(s.id ?? ''),
    seq: typeof s.seq === 'number' ? s.seq : 0,
    header: {
      id: String(header.id ?? s.id ?? ''),
      version: typeof header.version === 'number' ? header.version : 0,
      createdAt: typeof header.createdAt === 'number' ? header.createdAt : 0,
      cwd: typeof header.cwd === 'string' ? header.cwd : undefined,
      parentSession: typeof header.parentSession === 'string' ? header.parentSession : undefined,
      seedLength: typeof header.seedLength === 'number' ? header.seedLength : undefined,
      origin: typeof header.origin === 'string' ? header.origin : undefined,
      delegationDepth: typeof header.delegationDepth === 'number' ? header.delegationDepth : undefined,
    },
  }
}

/** 从 DSH Session 对象提取事件日志视图（事件为深冻结 JSON，只读共享）。 */
function toSessionLogView(session: unknown): SessionLogView | undefined {
  const s = session as { events?: readonly unknown[] }
  if (!Array.isArray(s?.events)) return undefined
  const view = toSessionView(session)
  const events: SessionEventView[] = []
  for (const event of s.events) {
    const e = event as { seq?: unknown; type?: unknown; time?: unknown; data?: Record<string, unknown> }
    events.push({
      seq: typeof e.seq === 'number' ? e.seq : 0,
      type: typeof e.type === 'string' ? e.type : '',
      time: typeof e.time === 'number' ? e.time : 0,
      data: e.data,
    })
  }
  return { ...view, events }
}

/** 从 sessionQuery.readSession 的返回提取事件日志视图。 */
function toLogViewFromQuery(snapshot: unknown): SessionLogView | undefined {
  const snap = snapshot as {
    session?: unknown
    events?: readonly unknown[]
    capturedThroughSeq?: number | null
  }
  if (!snap || !Array.isArray(snap.events)) return undefined
  const base = toSessionView(snap.session)
  const events: SessionEventView[] = []
  for (const event of snap.events) {
    const e = event as { seq?: unknown; type?: unknown; time?: unknown; data?: Record<string, unknown> }
    events.push({
      seq: typeof e.seq === 'number' ? e.seq : 0,
      type: typeof e.type === 'string' ? e.type : '',
      time: typeof e.time === 'number' ? e.time : 0,
      data: e.data,
    })
  }
  return { ...base, events }
}

let callIdCounter = 0

/** 生成适配层工具调用 callId（rc.6 CallId 为字符串品牌类型）。 */
function nextCallId(): string {
  callIdCounter += 1
  return `evoresearch-${Date.now()}-${callIdCounter}`
}

export interface PlatformAdaptersOptions {
  /** true 时缺失能力只收集不打印 console.warn（默认 false）。 */
  readonly quiet?: boolean
}

/** 创建 DSH 平台适配层（构造即探测能力并记录降级告警）。 */
export function createPlatformAdapters(ctx: Context, options: PlatformAdaptersOptions = {}): PlatformAdapters {
  const probes = probeCapabilities(ctx)
  const warnings: string[] = []

  const warn = (message: string): void => {
    warnings.push(message)
    if (!options.quiet) console.warn(`[evoresearch] 平台适配层: ${message}`)
  }

  // 汇总缺失/部分能力告警（每条能力一条，附矩阵降级路径）。
  for (const probe of probes) {
    if (probe.status === 'missing') {
      const plan = DSH_CAPABILITY_MATRIX.find((row) => row.capability === probe.capability)
      warn(`${probe.capability} 不可用 → 降级：${plan?.degradation ?? '无'}`)
    } else if (probe.status === 'partial') {
      const carrier = probe.present.length > 0 ? probe.present.join(',') : '部分服务缺失'
      warn(`${probe.capability} 部分可用（${carrier}）→ 受限运行，降级路径见矩阵。`)
    }
  }

  const store = ctx.get('sessions') as SessionStoreLike | undefined
  const sessionQuery = ctx.get('sessionQuery') as SessionQueryLike | undefined
  const llm = ctx.get('llm') as LlmRuntimeLike | undefined
  const agentDefaultModel = ctx.get('agentDefaultModel') as AgentDefaultModelLike | undefined
  const toolRuntime = ctx.get('tools') as ToolRuntimeLike | undefined
  const approval = ctx.get('approval') as ApprovalServiceLike | undefined
  const registry = ctx.get('registry') as RegistryLike | undefined
  const inventory = ctx.get('pluginInventory') as PluginInventoryLike | undefined

  const sessions: SessionAdapter = {
    available: store !== undefined,
    get(id) {
      if (!store) return undefined
      const session = store.get(id)
      return session ? toSessionView(session) : undefined
    },
    list() {
      if (!store) return []
      return store.list().map(toSessionView)
    },
    create(options) {
      if (!store) {
        throw new PlatformCapabilityUnavailableError('sessions', 'DSH SessionStore 不可用，无法创建会话')
      }
      const meta: Record<string, unknown> = {}
      if (options?.cwd !== undefined) meta.cwd = options.cwd
      if (options?.parentSession !== undefined) meta.parentSession = options.parentSession
      if (options?.seedLength !== undefined) meta.seedLength = options.seedLength
      const session = store.create(options?.id, { meta })
      return toSessionView(session)
    },
    fork(sourceId, boundary, childSessionId) {
      if (!store) {
        throw new PlatformCapabilityUnavailableError('sessions', 'DSH SessionStore 不可用，无法 fork 会话')
      }
      return toSessionView(store.fork(sourceId, boundary, childSessionId))
    },
    async readLog(id) {
      // 优先 live store（同步事件日志）；其次 sessionQuery（持久化兜底）。
      if (store) {
        const session = store.get(id)
        const live = session ? toSessionLogView(session) : undefined
        if (live !== undefined) return live
      }
      if (sessionQuery) {
        const snapshot = await sessionQuery.readSession(id)
        const fromQuery = toLogViewFromQuery(snapshot)
        if (fromQuery !== undefined) return fromQuery
      }
      return undefined
    },
    async flush(id) {
      if (!store) return false
      const session = store.get(id)
      if (!session) return false
      return store.flush(session)
    },
  }

  const models: ModelAdapter = {
    available: llm !== undefined || agentDefaultModel !== undefined,
    current() {
      return agentDefaultModel?.currentSelection?.()
    },
    listProviders() {
      return llm ? llm.listProviders() : []
    },
    async listModels(provider) {
      return llm ? llm.listModels(provider) : []
    },
    async route(target) {
      if (!llm) return target
      try {
        const resolved = await llm.resolveCallConfig({ provider: target.provider, model: target.model })
        return { provider: resolved.provider, model: resolved.model }
      } catch (error) {
        // 规则回退：解析失败原样返回，调用方以 current()/available 判断可信度。
        warn(`models.route 解析失败，回退原样路由: ${String(error)}`)
        return target
      }
    },
  }

  const tools: ToolAdapter = {
    available: toolRuntime !== undefined,
    list() {
      return toolRuntime ? toolRuntime.schemas() : []
    },
    get(name) {
      return toolRuntime?.get(name)
    },
    async invoke(name, args, options) {
      if (!toolRuntime) {
        throw new PlatformCapabilityUnavailableError('tools', 'DSH ToolRuntime 不可用，无法执行工具')
      }
      const result = await toolRuntime.execute({
        callId: nextCallId(),
        name,
        arguments: args,
        agent: options?.agent,
        signal: options?.signal ?? new AbortController().signal,
      })
      return { content: result.content, isError: result.isError, meta: result.meta }
    },
    register(definition) {
      if (!toolRuntime) {
        throw new PlatformCapabilityUnavailableError('tools', 'DSH ToolRuntime 不可用，无法注册工具')
      }
      return toolRuntime.register(definition)
    },
  }

  const approvalAdapter: ApprovalAdapter = {
    available: approval !== undefined,
    async request(req, requestOptions) {
      if (!approval) {
        if (requestOptions?.allowMissing === true) {
          return { outcome: 'allowed-once', degraded: true }
        }
        // fail-closed：审批服务缺失时视为拒绝（unavailable 是 rc.6 的失败闭合默认）。
        return { outcome: 'unavailable', degraded: true }
      }
      const outcome = await approval.request(req)
      return { outcome: outcome as ApprovalOutcomeView['outcome'] }
    },
    setPolicy(agent, policy) {
      approval?.setPolicy(agent, policy)
    },
  }

  const sandbox: SandboxAdapter = {
    available: toolRuntime !== undefined
      && typeof toolRuntime.restrict === 'function'
      && typeof toolRuntime.guard === 'function',
    restrict(filter) {
      if (!toolRuntime || typeof toolRuntime.restrict !== 'function') return () => { /* no-op：无工具过滤 */ }
      return toolRuntime.restrict(filter)
    },
    guard(guard) {
      if (!toolRuntime || typeof toolRuntime.guard !== 'function') return () => { /* no-op：无执行守卫 */ }
      return toolRuntime.guard(guard)
    },
  }

  const events: EventAdapter = {
    available: true,
    on(event, listener) {
      // Cordis 的 on/once 以 keyof Events 约束；适配层按字符串订阅统一包装。
      return ctx.on(event as never, listener as never)
    },
    once(event, listener) {
      return ctx.once(event as never, listener as never)
    },
  }

  const plugins: PluginAdapter = {
    registryAvailable: true,
    inventoryAvailable: inventory !== undefined,
    size() {
      return registry?.size ?? 0
    },
    list() {
      if (inventory) {
        return (inventory.list().entries ?? []).map((entry) => ({
          moduleName: entry.moduleName,
          enabled: entry.enabled,
          fiberPhase: entry.fiberPhase,
        }))
      }
      if (registry) {
        const entries: PluginEntryView[] = []
        for (const key of registry.keys()) {
          entries.push({ moduleName: typeof key === 'function' ? (key as { name?: string }).name : String(key) })
        }
        return entries
      }
      return []
    },
  }

  const adapter: PlatformAdapters = {
    probes,
    warnings,
    sessions,
    models,
    tools,
    approval: approvalAdapter,
    sandbox,
    events,
    plugins,
    has(capability) {
      return capabilityUsable(probes, capability)
    },
    require(capability) {
      if (!capabilityUsable(probes, capability)) {
        const plan = DSH_CAPABILITY_MATRIX.find((row) => row.capability === capability)
        throw new PlatformCapabilityUnavailableError(
          capability,
          `平台能力 ${capability} 不可用；降级路径：${plan?.degradation ?? '无'}`,
        )
      }
    },
    summarize() {
      const lines: string[] = []
      for (const probe of probes) {
        const carrier = probe.present.length > 0 ? `(${probe.present.join(',')})` : ''
        lines.push(`${probe.capability}=${probe.status}${carrier}`)
      }
      return lines.join(' ')
    },
  }

  return adapter
}
