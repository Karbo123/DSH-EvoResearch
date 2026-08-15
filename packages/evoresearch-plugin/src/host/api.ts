/**
 * EvoResearch API 服务：Client（浏览器插件）通过 Typert Gateway 调用的 Remote 方法。
 *
 * 所有方法返回纯 JSON（wire 序列化安全）。命名空间默认 evoresearch，
 * Remote API 路由群（projects/memory/scheduler/channels/autoskills/experts/threads）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import * as path from 'node:path'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import type { WorkspaceService } from './workspace.js'
import type { MemoryRuntime } from './memory/index.js'
import type { SchedulerService } from './scheduler.js'
import type { ChannelManager } from './channels/index.js'
import type { AutoSkillsService } from './autoskills.js'
import type { ExpertService } from './experts.js'
import type { ProjectInfo, MemoryPacket, TurnRecord, TopicState, GoalContract, GoalProposal, ScheduledTask, AutoSkillProposal } from '../shared/types.js'

/** 各服务集合（host 入口注入）。 */
export interface HostServices {
  readonly workspace: WorkspaceService
  readonly memory: MemoryRuntime
  readonly scheduler: SchedulerService
  readonly channels: ChannelManager
  readonly autoskills: AutoSkillsService
  readonly experts: ExpertService
}

/** JSON 化的记忆包（不含内部引用）。 */
function packetToJson(packet: MemoryPacket): unknown {
  return {
    catalog: packet.catalog,
    states: packet.states.map((state) => ({
      category: state.category,
      topicKey: state.topicKey,
      label: state.label,
      decision: state.decision,
      openQuestions: state.openQuestions,
      sourceTurnIds: state.sourceTurnIds,
      updatedAt: state.updatedAt,
    })),
    hits: packet.hits.map((hit) => ({ kind: hit.kind, id: hit.id, score: hit.score, snippet: hit.snippet })),
    readMoreTurnIds: packet.readMoreTurnIds,
    estimatedTokens: packet.estimatedTokens,
  }
}

/** EvoResearch Remote API。 */
export class EvoResearchApiService extends TypertRemoteService {
  private readonly services: HostServices
  private readonly hostCtx: Context

  constructor(ctx: Context, services: HostServices) {
    super(ctx, 'evoresearch')
    this.hostCtx = ctx
    this.services = services
  }

  // ── 科研项目工作区 ────────────────────────────────────────────────────────

  @Remote('projectsList')
  projectsList(): ProjectInfo[] {
    return this.services.workspace.listProjects()
  }

  @Remote('projectCreate')
  projectCreate(args: { name: string }): ProjectInfo | { error: string } {
    try {
      return this.services.workspace.createProject(args.name)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('projectImport')
  projectImport(args: { sourcePath: string; name?: string }): ProjectInfo | { error: string } {
    try {
      return this.services.workspace.importProject(args.sourcePath, args.name)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('projectValidate')
  projectValidate(args: { path: string }): { ok: true } | { ok: false; error: string } {
    try {
      this.services.workspace.validateWorkspace(args.path)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ── 科研记忆 ─────────────────────────────────────────────────────────────

  @Remote('memoryCatalog')
  memoryCatalog(args: { workspaceDir?: string }): { category: string; count: number }[] {
    const counts = this.services.memory.storeFor(args.workspaceDir ?? '').countByCategory()
    return Object.entries(counts).map(([category, count]) => ({ category, count }))
  }

  @Remote('memoryStates')
  memoryStates(args: { workspaceDir?: string; category?: string }): TopicState[] {
    const store = this.services.memory.storeFor(args.workspaceDir ?? '')
    const states = store.listTopicStates(args.category as TopicState['category'])
    return states.map((state) => ({
      category: state.category,
      topicKey: state.topicKey,
      label: state.label,
      decision: state.decision,
      openQuestions: state.openQuestions,
      sourceTurnIds: state.sourceTurnIds,
      updatedAt: state.updatedAt,
    }))
  }

  @Remote('memoryTurns')
  memoryTurns(args: { workspaceDir?: string; sessionId?: string; limit?: number; offset?: number }): TurnRecord[] {
    return this.services.memory
      .storeFor(args.workspaceDir ?? '')
      .listTurns(args.sessionId, args.limit ?? 50, args.offset ?? 0)
  }

  /** Identity 记忆文件（§26.5）：memories/profile 下的 Markdown（SOUL.md 等）。 */
  @Remote('memoryProfile')
  memoryProfile(args: { workspaceDir?: string }): Array<{ name: string; text: string; bytes: number }> {
    const base = args.workspaceDir && args.workspaceDir !== this.services.memory.config.dataRoot
      ? args.workspaceDir
      : this.services.memory.config.dataRoot
    const profileDir = path.join(base, '.evoresearch-data', 'memories', 'profile')
    const out: Array<{ name: string; text: string; bytes: number }> = []
    try {
      for (const entry of readdirSync(profileDir)) {
        if (!entry.endsWith('.md')) continue
        const full = path.join(profileDir, entry)
        try {
          const stat = statSync(full)
          if (!stat.isFile() || stat.size > 64 * 1024) continue
          out.push({ name: entry, text: readFileSync(full, 'utf8').slice(0, 4096), bytes: stat.size })
        } catch { /* 跳过不可读 */ }
      }
    } catch { /* 目录不存在 */ }
    return out
  }

  /** Knowledge（§26.5 轻量版）：Observation 列表（active/superseded + 分类筛选）。 */
  @Remote('memoryObservations')
  memoryObservations(args: { status?: 'active' | 'superseded'; category?: string; limit?: number }): Array<{
    observationId: string
    title: string
    content: string
    categories: readonly string[]
    status: string
    supersededBy?: string
    updatedAt: number
  }> {
    return this.services.memory
      .storeFor('')
      .listObservations({
        status: args.status,
        limit: args.limit ?? 100,
      })
      .filter((o) => args.category === undefined || o.categories.includes(args.category as never))
      .map((o) => ({
        observationId: o.observationId,
        title: o.title,
        content: o.content.slice(0, 600),
        categories: o.categories,
        status: o.status,
        ...(o.supersededBy === undefined ? {} : { supersededBy: o.supersededBy }),
        updatedAt: o.updatedAt,
      }))
  }

  @Remote('memoryPacket')
  memoryPacket(args: { sessionId: string }): unknown {
    const packet = this.services.memory.packetFor(args.sessionId)
    return packet ? packetToJson(packet) : null
  }

  @Remote('memoryGoals')
  memoryGoals(args: { workspaceDir?: string }): GoalContract[] {
    return this.services.memory.storeFor(args.workspaceDir ?? '').listRecentGoals(20)
  }

  @Remote('memoryGoalContract')
  memoryGoalContract(args: { workspaceDir?: string; goalId: string }): GoalContract | null {
    return this.services.memory.storeFor(args.workspaceDir ?? '').getGoal(args.goalId) ?? null
  }

  @Remote('goalProposals')
  goalProposals(args: { workspaceDir?: string; goalId: string }): GoalProposal[] {
    return this.services.memory.storeFor(args.workspaceDir ?? '').listGoalProposals(args.goalId)
  }

  @Remote('goalProposalRespond')
  goalProposalRespond(args: { workspaceDir?: string; proposalId: string; decision: 'approve' | 'reject' }): { proposal: GoalProposal; goal?: GoalContract } {
    return this.services.memory.storeFor(args.workspaceDir ?? '').respondGoalProposal(args.proposalId, args.decision)
  }

  // ── 定时任务 ──────────────────────────────────────────────────────────────

  @Remote('schedulerList')
  schedulerList(): unknown[] {
    return this.services.scheduler.list().map((task) => ({
      ...task,
      nextRunAt: this.services.scheduler.nextRunOf(task),
    }))
  }

  @Remote('schedulerAdd')
  schedulerAdd(args: { name: string; cron: string; prompt: string; workspaceDir?: string }): ScheduledTask | { error: string } {
    try {
      return this.services.scheduler.add({
        name: args.name,
        cron: args.cron,
        prompt: args.prompt,
        workspaceDir: args.workspaceDir ?? '',
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('schedulerRemove')
  schedulerRemove(args: { taskId: string }): { ok: boolean } {
    return { ok: this.services.scheduler.remove(args.taskId) }
  }

  /** Run now（§42.3）：立即执行一次任务。 */
  @Remote('schedulerRunNow')
  async schedulerRunNow(args: { taskId: string }): Promise<{ ok: boolean; error?: string; threadId?: string }> {
    return this.services.scheduler.runNow(this.hostCtx, args.taskId)
  }

  /** 读取任务最近一次运行的结果会话（lastResultThreadId）尾部回复文本（§26.6 Report to main chat）。 */
  @Remote('schedulerReport')
  async schedulerReport(args: { taskId: string }): Promise<{ text: string } | { error: string }> {
    const task = this.services.scheduler.list().find((t) => t.taskId === args.taskId)
    if (!task) return { error: '任务不存在' }
    const threadId = task.lastResultThreadId
    if (!threadId) return { error: '任务尚未运行' }
    // 优先读 live 会话事件（本部署事件不落盘，persistence 只有 header）
    const sessions = this.hostCtx.get('sessions') as { get?(id: string): { log?: Array<{ type?: string; data?: any }> } | undefined } | undefined
    const live = sessions?.get?.(threadId)
    let events: Array<{ type?: string; data?: any }> = []
    if (live !== undefined && Array.isArray(live.log)) {
      events = live.log
    } else {
      const persistence = this.hostCtx.get('sessionPersistence')
      try {
        const load = (persistence as { load(id: string): Promise<{ events?: Array<{ type?: string; data?: any }> } | undefined> } | undefined)?.load
        const loaded = load !== undefined ? await load(threadId) : undefined
        events = loaded?.events ?? []
      } catch { /* 持久化读失败 */ }
    }
    const texts: string[] = []
    for (const event of events) {
      if (event?.type !== 'assistant/message') continue
      const content = event.data?.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'text' && typeof block.text === 'string') texts.push(block.text)
        }
      }
    }
    if (texts.length === 0) return { error: '结果会话暂无回复内容（任务可能仍在运行）' }
    const text = texts[texts.length - 1]!.slice(0, 4000)
    return { text: `【定时任务 ${task.name}】结果回报：\n${text}` }
  }

  // ── 通道 ──────────────────────────────────────────────────────────────────

  @Remote('channelsStatus')
  channelsStatus(): unknown {
    return this.services.channels.status()
  }

  @Remote('channelStart')
  async channelStart(args: { id: string }): Promise<{ ok: boolean }> {
    return { ok: await this.services.channels.start(args.id) }
  }

  @Remote('channelStop')
  async channelStop(args: { id: string }): Promise<{ ok: boolean }> {
    return { ok: await this.services.channels.stop(args.id) }
  }

  // ── AutoSkills ────────────────────────────────────────────────────────────

  @Remote('autoskillsList')
  autoskillsList(args: { status?: AutoSkillProposal['status'] }): AutoSkillProposal[] {
    return this.services.autoskills.listProposals(args.status)
  }

  @Remote('autoskillsGenerate')
  autoskillsGenerate(args: { workspaceDir?: string }): { created: number } {
    const store = this.services.memory.storeFor(args.workspaceDir ?? '')
    return { created: this.services.autoskills.generateFromObservations(store) }
  }

  @Remote('autoskillsApprove')
  autoskillsApprove(args: { proposalId: string }): { ok: boolean } {
    return { ok: this.services.autoskills.approve(args.proposalId) }
  }

  @Remote('autoskillsReject')
  autoskillsReject(args: { proposalId: string }): { ok: boolean } {
    return { ok: this.services.autoskills.reject(args.proposalId) }
  }

  @Remote('autoskillsRun')
  autoskillsRun(args: { proposalId: string }): { ok: boolean } {
    return { ok: this.services.autoskills.run(args.proposalId) }
  }

  /** AutoSkills 调度配置（§42.9）：读（空参数）或写；写时对 scheduler 中 AutoSkills 任务 reconcile。 */
  @Remote('autoskillsConfig')
  autoskillsConfig(args: { enabled?: boolean; mode?: string; cadence?: string; time?: string }): unknown {
    if (Object.keys(args).length === 0) {
      return this.services.autoskills.readConfig()
    }
    const { cron } = this.services.autoskills.saveConfig(args)
    // reconcile：先删旧 AutoSkills 任务（禁用删除；配置变化替换；相同保留由"删除后重建"等价实现）
    const scheduler = this.services.scheduler
    for (const task of scheduler.list()) {
      if (task.name === 'AutoSkills') scheduler.remove(task.taskId)
    }
    if (cron !== null) {
      scheduler.add({
        name: 'AutoSkills',
        cron,
        prompt: '执行 AutoSkills 技能提案生成与审核流程。',
        workspaceDir: '',
      })
    }
    return { saved: true, cron }
  }

  // ── 专家团队 ──────────────────────────────────────────────────────────────

  @Remote('expertsList')
  async expertsList(): Promise<unknown> {
    return this.services.experts.list(this.hostCtx)
  }

  @Remote('expertInvite')
  async expertInvite(args: { name: string }): Promise<{ ok: boolean }> {
    return { ok: await this.services.experts.invite(this.hostCtx, args.name) }
  }

  @Remote('expertClear')
  async expertClear(): Promise<{ ok: boolean }> {
    await this.services.experts.clear()
    return { ok: true }
  }

  // ── 会话搜索（分页历史/全文搜索的查询基础） ────────────────────────────────

  @Remote('threadsSearch')
  async threadsSearch(args: { query: string; limit?: number }): Promise<unknown> {
    const sessionQuery = this.hostCtx.get('sessionQuery')
    if (!sessionQuery) return { hits: [], error: 'sessionQuery 服务不可用' }
    const page = await sessionQuery.searchEvents({
      query: args.query,
      limit: args.limit ?? 50,
    } as never)
    return { hits: page as unknown }
  }

  // ── 斜杠命令目录（动态读取 dsh-commands 全局注册表） ──────────────────────

  @Remote('commandsList')
  commandsList(): unknown {
    const commands = this.hostCtx.get('commands') as { list(agent?: unknown): Array<{ name: string; description: string; input?: { hint?: string } }> } | undefined
    if (!commands) return { commands: [], error: 'commands 服务不可用' }
    try {
      const descriptors = commands.list(undefined)
      return {
        commands: descriptors.map((d) => ({
          name: d.name,
          description: d.description,
          hint: d.input?.hint ?? '',
        })),
      }
    } catch (error) {
      return { commands: [], error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('safety')
  safety(): { dangerousMode: boolean } {
    // 第一版：返回 false（危险模式由 DSH 权限预设管理，此处预留聚合）
    return { dangerousMode: false }
  }
}
