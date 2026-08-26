/**
 * 子代理运行时适配与可插拔 provider（PLAT-16 / PLAT-19）。
 *
 * PLAT-16：同步/异步/后台/可继续/可取消子代理的统一适配接口（create/continue/
 * interrupt/report）+ 父子任务谱系/恢复点/结果回报的 JSONL 记录（SubagentRegistry，
 * <dataRoot>/plugins/subagents.jsonl）。
 *
 * PLAT-19：可插拔子代理 provider 接口——进程内 / fork / ACP / DSH SDK / 外部
 * 编码 Agent 都可以实现 SubagentProvider 并注册进 SubagentProviderRegistry；
 * continuation/interrupt/report 统一语义（方法可选，未实现则记录不支持）。
 *
 * 现有能力核对（只读，接入说明见 api-integration-plat3.md §4）：
 * - host/teams.ts：TEAM_ROLES 六类角色定义（角色预设，非运行时）；
 * - DSH ctx.subagents（SubagentRuntime.start/startContinuable/interrupt/followup/
 *   reportFrom/listChildren）与 ctx.agents（AgentRegistry.create/resume）——
 *   本模块的 provider 可由队长用 DSH 服务实现并注册。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

/** 子代理运行模式（PLAT-16）。 */
export type SubagentMode = 'sync' | 'async' | 'background' | 'continuable'

/** 子代理状态。 */
export type SubagentStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted' | 'resumable'

/** 谱系记录（PLAT-16：父子任务谱系/恢复点/结果回报）。 */
export interface SubagentRecord {
  readonly subagentId: string
  /** 父会话 id（谱系根）。 */
  readonly parentSessionId: string
  /** 子会话 id（provider 创建后回填）。 */
  readonly sessionId?: string
  /** provider 返回的真实任务/子代理 id；内部谱系 id 与外部 id 分离。 */
  readonly providerSubagentId?: string
  readonly mode: SubagentMode
  /** provider 名（PLAT-19）。 */
  readonly provider: string
  readonly prompt: string
  readonly status: SubagentStatus
  readonly createdAt: number
  readonly startedAt?: number
  readonly endedAt?: number
  /** 恢复点（continuable：上次中断位置/消息 id；PLAT-16）。 */
  readonly resumePoint?: string
  /** 结果回报（report 文本）。 */
  readonly report?: string
  readonly error?: string
}

/** 谱系记录更新（部分字段）。 */
export type SubagentRecordPatch = Partial<Pick<SubagentRecord, 'status' | 'sessionId' | 'providerSubagentId' | 'startedAt' | 'endedAt' | 'resumePoint' | 'report' | 'error'>>

/** 谱系记录存储（追加式 JSONL；PLAT-16）。 */
export class SubagentRegistry {
  private readonly file: string
  private readonly records: SubagentRecord[] = []

  constructor(readonly dataRoot: string) {
    this.file = path.join(dataRoot, 'plugins', 'subagents.jsonl')
    this.load()
  }

  fileOf(): string {
    return this.file
  }

  private load(): void {
    try {
      const lines = fs.readFileSync(this.file, 'utf8').split('\n').filter((line) => line.trim() !== '')
      for (const line of lines) {
        try {
          const record = JSON.parse(line) as SubagentRecord
          if (typeof record?.subagentId === 'string' && typeof record?.parentSessionId === 'string') {
            this.records.push(record)
          }
        } catch {
          // 坏行跳过
        }
      }
    } catch {
      // 空记录
    }
  }

  private append(record: SubagentRecord): void {
    this.records.push(record)
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.appendFileSync(this.file, `${JSON.stringify(record)}\n`, 'utf8')
    } catch (error) {
      console.warn(`[evoresearch:subagents] 谱系记录落盘失败（内存仍可用）: ${String(error)}`)
    }
  }

  /** 新建谱系记录。 */
  record(input: {
    parentSessionId: string
    mode: SubagentMode
    provider: string
    prompt: string
    sessionId?: string
  }): SubagentRecord {
    const record: SubagentRecord = {
      subagentId: `sub-${randomUUID().slice(0, 8)}`,
      parentSessionId: input.parentSessionId,
      mode: input.mode,
      provider: input.provider,
      prompt: input.prompt,
      sessionId: input.sessionId,
      status: 'pending',
      createdAt: Date.now(),
    }
    this.append(record)
    return record
  }

  /** 更新记录（找到最近一条同 id 的追加更新——JSONL 是追加式，读时取最新）。 */
  update(subagentId: string, patch: SubagentRecordPatch): SubagentRecord | undefined {
    const current = this.get(subagentId)
    if (!current) return undefined
    const updated: SubagentRecord = { ...current, ...patch }
    this.append(updated)
    return updated
  }

  /** 读取最新记录（JSONL 追加式：同 id 多条时取最后一条）。 */
  get(subagentId: string): SubagentRecord | undefined {
    let found: SubagentRecord | undefined
    for (const record of this.records) {
      if (record.subagentId === subagentId) found = record
    }
    return found
  }

  /** 某父会话的全部子代理（谱系查询；最新在前）。 */
  list(parentSessionId?: string): SubagentRecord[] {
    const records = parentSessionId === undefined
      ? this.records
      : this.records.filter((record) => record.parentSessionId === parentSessionId)
    // 同 id 多条时只保留最新
    const latest = new Map<string, SubagentRecord>()
    for (const record of records) latest.set(record.subagentId, record)
    return [...latest.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  /** 后代谱系（直接子代理 + 递归子代理；按父链展开）。 */
  descendants(rootSessionId: string): SubagentRecord[] {
    const all = this.list()
    const childrenOf = new Map<string, SubagentRecord[]>()
    for (const record of all) {
      const list = childrenOf.get(record.parentSessionId) ?? []
      list.push(record)
      childrenOf.set(record.parentSessionId, list)
    }
    const result: SubagentRecord[] = []
    const walk = (parent: string): void => {
      for (const child of childrenOf.get(parent) ?? []) {
        result.push(child)
        walk(child.subagentId)
      }
    }
    walk(rootSessionId)
    return result
  }
}

/* ------------------------------------------------------------------ */
/* PLAT-19：可插拔子代理 provider                                      */
/* ------------------------------------------------------------------ */

/** 子代理创建请求。 */
export interface SubagentCreateRequest {
  readonly parentSessionId: string
  readonly prompt: string
  readonly mode: SubagentMode
  readonly cwd?: string
  /** provider 名（缺省 'default'，由门面解析）。 */
  readonly provider?: string
}

/** provider 操作结果。 */
export interface SubagentOpResult {
  readonly ok: boolean
  readonly error?: string
  readonly sessionId?: string
  readonly report?: string
  readonly resumePoint?: string
}

/**
 * 可插拔子代理 provider（PLAT-19 抽象）：
 * - create：必须实现；返回子代理 id（+可选 sessionId）；
 * - continue/interrupt/report/cancel：可选（未实现 = 不支持，统一返回
 *   { ok:false, error:'provider 不支持 continue' }）。
 * 进程内/fork/ACP/DSH SDK/外部编码 Agent 均实现此接口并注册。
 */
export interface SubagentProvider {
  readonly name: string
  create(request: SubagentCreateRequest): Promise<SubagentOpResult & { subagentId?: string }>
  continue?(subagentId: string, message: string): Promise<SubagentOpResult>
  interrupt?(subagentId: string): Promise<SubagentOpResult>
  report?(subagentId: string): Promise<SubagentOpResult>
  cancel?(subagentId: string): Promise<SubagentOpResult>
}

/** provider 注册表（PLAT-19）。 */
export class SubagentProviderRegistry {
  private readonly providers = new Map<string, SubagentProvider>()

  /** 注册 provider，返回 disposer。 */
  register(provider: SubagentProvider): () => void {
    if (this.providers.has(provider.name)) {
      throw new Error(`子代理 provider 已存在: ${provider.name}`)
    }
    this.providers.set(provider.name, provider)
    return () => {
      this.providers.delete(provider.name)
    }
  }

  get(name: string): SubagentProvider | undefined {
    return this.providers.get(name)
  }

  list(): string[] {
    return [...this.providers.keys()]
  }

  /** 插件卸载：清空全部 provider（PLAT-21 无副作用）。 */
  disposeAll(): void {
    this.providers.clear()
  }
}

/* ------------------------------------------------------------------ */
/* PLAT-16：统一适配门面（create/continue/interrupt/report + 谱系记录）   */
/* ------------------------------------------------------------------ */

/** 子代理门面：把 provider 操作与谱系记录串起来。 */
export class SubagentFacade {
  constructor(
    readonly registry: SubagentRegistry,
    readonly providers: SubagentProviderRegistry,
  ) {}

  /** 创建子代理（记录谱系；pending → running）。 */
  async create(input: SubagentCreateRequest): Promise<{ ok: boolean; record?: SubagentRecord; error?: string }> {
    const provider = this.providers.get(input.provider ?? 'default')
    if (!provider) {
      const providerNames = this.providers.list()
      if (providerNames.length === 0) return { ok: false, error: '未注册任何子代理 provider' }
      return { ok: false, error: `子代理 provider 不存在: ${input.provider ?? 'default'}（可用: ${providerNames.join(', ')}）` }
    }
    const record = this.registry.record({
      parentSessionId: input.parentSessionId,
      mode: input.mode,
      provider: provider.name,
      prompt: input.prompt,
    })
    try {
      const result = await provider.create(input)
      const updated = this.registry.update(record.subagentId, {
        sessionId: result.sessionId,
        providerSubagentId: result.subagentId,
        status: result.ok ? 'running' : 'failed',
        startedAt: result.ok ? Date.now() : undefined,
        endedAt: result.ok ? undefined : Date.now(),
        resumePoint: result.resumePoint,
        error: result.ok ? undefined : result.error,
      })
      return { ok: result.ok, record: updated ?? record, error: result.ok ? undefined : result.error }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const updated = this.registry.update(record.subagentId, { status: 'failed', endedAt: Date.now(), error: message })
      return { ok: false, record: updated ?? record, error: message }
    }
  }

  /** 继续（continuable/resumable；记录恢复点）。 */
  async continue(subagentId: string, message: string): Promise<SubagentOpResult> {
    const record = this.registry.get(subagentId)
    if (!record) return { ok: false, error: `子代理不存在: ${subagentId}` }
    const provider = this.providers.get(record.provider)
    if (!provider?.continue) return { ok: false, error: `provider ${record.provider} 不支持 continue` }
    const result = await provider.continue(record.providerSubagentId ?? subagentId, message)
    this.registry.update(subagentId, {
      status: result.ok ? 'running' : record.status,
      resumePoint: result.resumePoint,
      error: result.ok ? undefined : result.error,
    })
    return result
  }

  /** 中断（可继续：status → interrupted，保留恢复点）。 */
  async interrupt(subagentId: string): Promise<SubagentOpResult> {
    const record = this.registry.get(subagentId)
    if (!record) return { ok: false, error: `子代理不存在: ${subagentId}` }
    const provider = this.providers.get(record.provider)
    if (!provider?.interrupt) return { ok: false, error: `provider ${record.provider} 不支持 interrupt` }
    const result = await provider.interrupt(record.providerSubagentId ?? subagentId)
    if (result.ok) {
      this.registry.update(subagentId, {
        status: record.mode === 'continuable' ? 'interrupted' : 'cancelled',
        resumePoint: result.resumePoint ?? record.resumePoint,
        endedAt: Date.now(),
      })
    }
    return result
  }

  /** 结果回报（status → done + report 记录）。 */
  async report(subagentId: string): Promise<SubagentOpResult> {
    const record = this.registry.get(subagentId)
    if (!record) return { ok: false, error: `子代理不存在: ${subagentId}` }
    const provider = this.providers.get(record.provider)
    if (!provider?.report) return { ok: false, error: `provider ${record.provider} 不支持 report` }
    const result = await provider.report(record.providerSubagentId ?? subagentId)
    if (result.ok) {
      this.registry.update(subagentId, { status: 'done', report: result.report, endedAt: Date.now() })
    }
    return result
  }

  /** 取消一次性/后台子代理；continuable 取消后仍保留谱系与恢复点。 */
  async cancel(subagentId: string): Promise<SubagentOpResult> {
    const record = this.registry.get(subagentId)
    if (!record) return { ok: false, error: `子代理不存在: ${subagentId}` }
    const provider = this.providers.get(record.provider)
    if (!provider?.cancel) return { ok: false, error: `provider ${record.provider} 不支持 cancel` }
    const result = await provider.cancel(record.providerSubagentId ?? subagentId)
    if (result.ok) {
      this.registry.update(subagentId, {
        status: 'cancelled',
        resumePoint: result.resumePoint ?? record.resumePoint,
        endedAt: Date.now(),
      })
    }
    return result
  }
}
