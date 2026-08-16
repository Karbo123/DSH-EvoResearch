/**
 * EvoResearch API 服务：Client（浏览器插件）通过 Typert Gateway 调用的 Remote 方法。
 *
 * 所有方法返回纯 JSON（wire 序列化安全）。命名空间默认 evoresearch，
 * Remote API 路由群（projects/memory/scheduler/channels/autoskills/experts/threads）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import * as path from 'node:path'
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, renameSync, existsSync, rmSync } from 'node:fs'
import type { WorkspaceService } from './workspace.js'
import type { MemoryRuntime } from './memory/index.js'
import type { SchedulerService } from './scheduler.js'
import type { ChannelManager } from './channels/index.js'
import type { AutoSkillsService } from './autoskills.js'
import type { ExpertService } from './experts.js'
import type { ExperimentService } from './experiments.js'
import type { ProjectEnvService, ProjectEnvInfo } from './project-env.js'
import type { ProjectInfo, MemoryPacket, TurnRecord, TopicState, GoalContract, GoalProposal, ScheduledTask, AutoSkillProposal, ModelSettings, ExperimentManifest, ExperimentSummary } from '../shared/types.js'
import { DEFAULT_MODEL_SETTINGS } from '../shared/types.js'

/** 各服务集合（host 入口注入）。 */
export interface HostServices {
  readonly workspace: WorkspaceService
  readonly memory: MemoryRuntime
  readonly scheduler: SchedulerService
  readonly channels: ChannelManager
  readonly autoskills: AutoSkillsService
  readonly experts: ExpertService
  readonly experiments: ExperimentService
  readonly projectEnv: ProjectEnvService
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
      const project = this.services.workspace.createProject(args.name)
      // 后台异步创建项目专属 UV 环境（失败不阻塞项目创建）
      void this.services.projectEnv.create(project.path).catch(() => { /* 状态面板可重试 */ })
      return project
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

  /**
   * 自动创建项目工作区（欢迎页首条消息触发）：AI 生成 slug，失败确定性回退。
   * 模型取当前默认选择，其次配置的 auxiliaryModel，最后部署默认（new-api）。
   */
  @Remote('projectAutoCreate')
  async projectAutoCreate(args: { description?: string }): Promise<ProjectInfo | { error: string }> {
    try {
      const selection = (this.hostCtx.get('agentDefaultModel') as { currentSelection?(): { provider?: string; model?: string } } | undefined)?.currentSelection?.()
      const configured = this.services.memory.config.auxiliaryModel
      const model = selection?.provider && selection?.model
        ? { provider: selection.provider, model: selection.model }
        : configured?.provider && configured?.model
          ? { provider: configured.provider, model: configured.model }
          : { provider: 'new-api', model: 'deepseek-v4-flash' }
      return await this.services.workspace.autoCreateProject(this.hostCtx, model, String(args?.description ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ── 项目环境（§环境管理：每项目独立 UV 虚拟环境）─────────────────────────

  private envArgs(args: { projectDir?: string }): string {
    return String(args?.projectDir ?? '')
  }

  @Remote('projectEnvStatus')
  projectEnvStatus(args: { projectDir?: string }): ProjectEnvInfo | { error: string } {
    try {
      return this.services.projectEnv.status(this.envArgs(args))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('projectEnvCreate')
  async projectEnvCreate(args: { projectDir?: string; pythonVersion?: string }): Promise<ProjectEnvInfo | { error: string }> {
    try {
      return await this.services.projectEnv.create(this.envArgs(args), typeof args?.pythonVersion === 'string' ? args.pythonVersion : undefined)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('projectEnvInstall')
  async projectEnvInstall(args: { projectDir?: string; packages?: string[] }): Promise<{ ok: boolean; output: string } | { error: string }> {
    try {
      return await this.services.projectEnv.install(this.envArgs(args), Array.isArray(args?.packages) ? args.packages.map(String) : [])
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('projectEnvRemove')
  projectEnvRemove(args: { projectDir?: string }): { ok: boolean } | { error: string } {
    try {
      return this.services.projectEnv.remove(this.envArgs(args))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
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

  /** 模型设置（设置面板）：读/写/应用。 */
  private modelSettingsFile(): string {
    return path.join(this.services.memory.config.dataRoot, '.evoresearch-data', 'model-settings.json')
  }

  readModelSettings(): ModelSettings {
    try {
      const raw = JSON.parse(readFileSync(this.modelSettingsFile(), 'utf8')) as Partial<ModelSettings>
      const merged: ModelSettings = {
        code: { ...DEFAULT_MODEL_SETTINGS.code, ...(raw.code ?? {}) },
        vision: { ...DEFAULT_MODEL_SETTINGS.vision, ...(raw.vision ?? {}) },
        image: { ...DEFAULT_MODEL_SETTINGS.image, ...(raw.image ?? {}) },
        voice: { ...DEFAULT_MODEL_SETTINGS.voice, ...(raw.voice ?? {}) },
      }
      return merged
    } catch {
      return DEFAULT_MODEL_SETTINGS
    }
  }

  @Remote('modelSettingsGet')
  modelSettingsGet(): ModelSettings {
    return this.readModelSettings()
  }

  @Remote('modelSettingsSet')
  modelSettingsSet(args: { patch: Partial<ModelSettings> }): { ok: boolean } {
    const file = this.modelSettingsFile()
    mkdirSync(path.dirname(file), { recursive: true })
    const current = this.readModelSettings()
    const patch = args?.patch ?? {}
    const merged: ModelSettings = {
      code: { ...current.code, ...(patch.code ?? {}) },
      vision: { ...current.vision, ...(patch.vision ?? {}) },
      image: { ...current.image, ...(patch.image ?? {}) },
      voice: { ...current.voice, ...(patch.voice ?? {}) },
    }
    const tmp = `${file}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8')
    renameSync(tmp, file)
    return { ok: true }
  }

  /** 应用代码模型某档为当前默认模型（agentDefaultModel.saveSelection）。 */
  @Remote('modelSettingsApply')
  modelSettingsApply(args: { tier: 'simple' | 'medium' | 'complex' }): { ok: boolean; provider?: string; model?: string; error?: string } {
    const tier = args?.tier
    if (tier !== 'simple' && tier !== 'medium' && tier !== 'complex') return { ok: false, error: 'tier 必须是 simple/medium/complex' }
    const setting = this.readModelSettings().code[tier]
    if (!setting.model || !setting.provider) return { ok: false, error: '该档未配置模型' }
    const agentDefaultModel = this.hostCtx?.get('agentDefaultModel')
    if (!agentDefaultModel || typeof agentDefaultModel.saveSelection !== 'function') {
      return { ok: false, error: 'agentDefaultModel 服务不可用' }
    }
    agentDefaultModel.saveSelection({ provider: setting.provider, model: setting.model })
    return { ok: true, provider: setting.provider, model: setting.model }
  }

  /** §29：会话元数据（置顶/标签色/归档）后端存储——pin/tag/archive 随项目数据迁移。 */  private metaFile(): string {
    return path.join(this.services.memory.config.dataRoot, '.evoresearch-data', 'session-meta.json')
  }

  private readSessionMeta(): Record<string, { pinned?: boolean; tagColor?: string | null; archived?: boolean }> {
    try {
      const raw = JSON.parse(readFileSync(this.metaFile(), 'utf8')) as Record<string, unknown>
      return typeof raw === 'object' && raw !== null ? (raw as Record<string, { pinned?: boolean; tagColor?: string | null; archived?: boolean }>) : {}
    } catch {
      return {}
    }
  }

  private writeSessionMeta(meta: Record<string, { pinned?: boolean; tagColor?: string | null; archived?: boolean }>): void {
    const file = this.metaFile()
    mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf8')
    renameSync(tmp, file)
  }

  @Remote('sessionMetaGet')
  sessionMetaGet(): Record<string, { pinned?: boolean; tagColor?: string | null; archived?: boolean }> {
    return this.readSessionMeta()
  }

  @Remote('sessionMetaSet')
  sessionMetaSet(args: { sessionId: string; patch: { pinned?: boolean; tagColor?: string | null; archived?: boolean } }): { ok: boolean } {
    const sessionId = String(args?.sessionId ?? '')
    if (sessionId === '') return { ok: false }
    const meta = this.readSessionMeta()
    const current = meta[sessionId] ?? {}
    const next: { pinned?: boolean; tagColor?: string | null; archived?: boolean } = { ...current }
    const patch = args?.patch ?? {}
    if (patch.pinned !== undefined) next.pinned = patch.pinned
    if (patch.tagColor !== undefined) next.tagColor = patch.tagColor === null ? null : patch.tagColor
    if (patch.archived !== undefined) next.archived = patch.archived
    // 全空则删除该会话条目
    if (next.pinned === undefined && next.tagColor === undefined && next.archived === undefined) {
      delete meta[sessionId]
    } else {
      meta[sessionId] = next
    }
    this.writeSessionMeta(meta)
    return { ok: true }
  }

  /** §12.4 Profile 文件操作：写（新建/保存）、重命名、删除（名字严格限制在 profile 目录内）。 */
  private profileDirOf(workspaceDir: string | undefined): string {
    const base = workspaceDir && workspaceDir !== this.services.memory.config.dataRoot
      ? workspaceDir
      : this.services.memory.config.dataRoot
    return path.join(base, '.evoresearch-data', 'memories', 'profile')
  }

  /** 校验 profile 文件名（仅允许 <name>.md，禁止路径穿越）。 */
  private assertProfileName(name: string): string {
    const base = path.basename(name)
    if (base !== name || !/^[A-Za-z0-9_.-]{1,80}\.md$/.test(name)) {
      throw new Error(`非法的记忆文件名: ${name}`)
    }
    return name
  }

  @Remote('memoryProfileWrite')
  memoryProfileWrite(args: { workspaceDir?: string; name: string; content: string }): { ok: boolean; name: string } {
    const name = this.assertProfileName(args.name)
    const dir = this.profileDirOf(args.workspaceDir)
    mkdirSync(dir, { recursive: true })
    const content = String(args.content ?? '').slice(0, 64 * 1024)
    const full = path.join(dir, name)
    const tmp = `${full}.tmp-${process.pid}`
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, full)
    return { ok: true, name }
  }

  @Remote('memoryProfileDelete')
  memoryProfileDelete(args: { workspaceDir?: string; name: string }): { ok: boolean } {
    const name = this.assertProfileName(args.name)
    const full = path.join(this.profileDirOf(args.workspaceDir), name)
    if (existsSync(full)) rmSync(full, { force: true })
    return { ok: true }
  }

  @Remote('memoryProfileRename')
  memoryProfileRename(args: { workspaceDir?: string; from: string; to: string }): { ok: boolean; name: string } {
    const from = this.assertProfileName(args.from)
    const to = this.assertProfileName(args.to)
    const dir = this.profileDirOf(args.workspaceDir)
    const fromFull = path.join(dir, from)
    if (!existsSync(fromFull)) throw new Error(`文件不存在: ${from}`)
    const toFull = path.join(dir, to)
    if (existsSync(toFull)) throw new Error(`目标已存在: ${to}`)
    mkdirSync(dir, { recursive: true })
    renameSync(fromFull, toFull)
    return { ok: true, name: to }
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
    relatedObservationIds: readonly string[]
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
        relatedObservationIds: o.relatedObservationIds ?? [],
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

  // ── 实验管理（§5.1 Git 式分支/回退/checkpoint）────────────────────────────

  private experimentArgs(args: { workspaceDir?: string }): string {
    return args?.workspaceDir ?? ''
  }

  @Remote('experimentsList')
  experimentsList(args: { workspaceDir?: string }): ExperimentSummary[] {
    return this.services.experiments.list(this.experimentArgs(args))
  }

  @Remote('experimentsGet')
  experimentsGet(args: { workspaceDir?: string; id: string }): ExperimentManifest | { error: string } {
    try {
      return this.services.experiments.get(this.experimentArgs(args), String(args?.id ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentsCreate')
  experimentsCreate(args: { workspaceDir?: string; name: string; description?: string }): ExperimentManifest | { error: string } {
    try {
      return this.services.experiments.create(this.experimentArgs(args), String(args?.name ?? ''), String(args?.description ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentsUpdate')
  experimentsUpdate(args: { workspaceDir?: string; id: string; patch: { name?: string; description?: string } }): ExperimentManifest | { error: string } {
    try {
      return this.services.experiments.update(this.experimentArgs(args), String(args?.id ?? ''), args?.patch ?? {})
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentsAddPhase')
  experimentsAddPhase(args: { workspaceDir?: string; id: string; name?: string; description?: string }): ExperimentManifest | { error: string } {
    try {
      return this.services.experiments.addPhase(this.experimentArgs(args), String(args?.id ?? ''), String(args?.name ?? ''), String(args?.description ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentsCheckpoint')
  experimentsCheckpoint(args: { workspaceDir?: string; id: string; name?: string; note?: string; phaseId?: string; sessionId?: string }): ExperimentManifest | { error: string } {
    try {
      return this.services.experiments.checkpoint(this.experimentArgs(args), String(args?.id ?? ''), {
        name: String(args?.name ?? ''),
        note: String(args?.note ?? ''),
        ...(typeof args?.phaseId === 'string' && args.phaseId !== '' ? { phaseId: args.phaseId } : {}),
        ...(typeof args?.sessionId === 'string' && args.sessionId !== '' ? { sessionId: args.sessionId } : {}),
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentsRollback')
  experimentsRollback(args: { workspaceDir?: string; id: string; checkpointId: string }): { ok: boolean; restored: number; checkpointId: string; name: string } | { error: string } {
    try {
      const result = this.services.experiments.rollback(this.experimentArgs(args), String(args?.id ?? ''), String(args?.checkpointId ?? ''))
      return { ok: true, ...result }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentsBranch')
  experimentsBranch(args: { workspaceDir?: string; id: string; fromCheckpointId: string; name?: string }): ExperimentManifest | { error: string } {
    try {
      return this.services.experiments.branch(this.experimentArgs(args), String(args?.id ?? ''), String(args?.fromCheckpointId ?? ''), String(args?.name ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentsSwitchBranch')
  experimentsSwitchBranch(args: { workspaceDir?: string; id: string; branchId: string }): ExperimentManifest | { error: string } {
    try {
      return this.services.experiments.switchBranch(this.experimentArgs(args), String(args?.id ?? ''), String(args?.branchId ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentsDelete')
  experimentsDelete(args: { workspaceDir?: string; id: string }): { ok: boolean } | { error: string } {
    try {
      return this.services.experiments.delete(this.experimentArgs(args), String(args?.id ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
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
    const workspaceDir = args.workspaceDir ?? ''
    const store = this.services.memory.storeFor(workspaceDir)
    return { created: this.services.autoskills.generateFromObservations(store, workspaceDir) }
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
