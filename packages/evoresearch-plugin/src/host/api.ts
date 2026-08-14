/**
 * EvoResearch API 服务：Client（浏览器插件）通过 Typert Gateway 调用的 Remote 方法。
 *
 * 所有方法返回纯 JSON（wire 序列化安全）。命名空间默认 evoresearch，
 * 对应上游 EvoScientist WebUI 的 /api/* 路由群（projects/memory/scheduler/channels/autoskills/experts/threads）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceService } from './workspace.js'
import type { MemoryRuntime } from './memory/index.js'
import type { SchedulerService } from './scheduler.js'
import type { ChannelManager } from './channels/index.js'
import type { AutoSkillsService } from './autoskills.js'
import type { ExpertService } from './experts.js'
import type { ProjectInfo, MemoryPacket, TurnRecord, TopicState, GoalContract, ScheduledTask, AutoSkillProposal } from '../shared/types.js'

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

  // ── 定时任务 ──────────────────────────────────────────────────────────────

  @Remote('schedulerList')
  schedulerList(): ScheduledTask[] {
    return this.services.scheduler.list()
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

  @Remote('safety')
  safety(): { dangerousMode: boolean } {
    // 第一版：返回 false（危险模式由 DSH 权限预设管理，此处预留聚合）
    return { dangerousMode: false }
  }
}
