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
import { randomUUID } from 'node:crypto'
import type { WorkspaceService } from './workspace.js'
import type { MemoryRuntime } from './memory/index.js'
import type { SchedulerService } from './scheduler.js'
import type { ChannelManager } from './channels/index.js'
import type { AutoSkillsService } from './autoskills.js'
import type { ExpertService } from './experts.js'
import type { ExperimentService } from './experiments.js'
import type { ChatGraphService, GraphGroup, GraphNode, GraphEdge } from './chat-graph.js'
import type { ProjectEnvService, ProjectEnvInfo } from './project-env.js'
import type { RewindService } from './rewind.js'
import type { NotesService } from './notes.js'
import type { ExperimentWorkspaceService, ExperimentWorkspaceInfo, ExperimentWorkspaceDetail, ExperimentWorkspaceEntry, ExperimentWorkspaceTree } from './experiment-workspace.js'
import type { ExperimentProcessService, RunRecord, ExperimentGraphRef, ExperimentGraphRefResolution } from './experiment-process.js'
import type { WorktreeService } from './worktrees.js'
import type { LibraryIndexer, LibrarySearch } from './library/index.js'
import type {
  AddPaperResult,
  IndexLibraryResult,
  PaperSummary,
  SearchHit,
  SearchOptions,
  TextRange,
  BibEntry,
  LibraryRef,
  ResolvedLibraryRef,
} from './library/index.js'
import type {
  ManuscriptService,
  ManuscriptInfo,
  ManuscriptContext,
  QuoteCheckInput,
  QuoteCheckResult,
  DraftDiff,
  CompileResult,
  LatexTool,
} from './manuscript.js'
import type { SignalStore } from './evolution/signals.js'
import { aggregateWeaknesses, weaknessMarkdown } from './evolution/signals.js'
import type { EvolutionSignal, EvolutionSignalType } from './evolution/signals.js'
import type { CandidateRegistry, CandidateStatus, EvolutionCandidate } from './evolution/registry.js'
import { evaluateCandidate } from './evolution/evaluator.js'
import type { EvaluationResult, EvaluationSample } from './evolution/evaluator.js'
import type { SkillRunResult } from './autoskills.js'
import type { ContextWindowRuntime, PressureSessionLike } from './context/guard.js'
import type { ContextRuntime, ProjectionQueryOptions, ProjectionQueryResult, LineageResult } from './platform/context-runtime.js'
import type { ContextAssembler, AssembleInput, EffectQuery, AssemblyResult, ReferencePreview, EffectSignalRecord } from './context/assembler.js'
import type { CompactionQuery, GraphConnectionInfo, PressureReport, CompactionRecord, ContextSourceReport, SurfaceEventInfo } from './context/types.js'
import { readSessionEvents } from './rewind.js'
import { isLowInformationInput } from './core/title.js'
import type { ProjectInfo, MemoryPacket, TurnRecord, TopicState, GoalContract, GoalProposal, ScheduledTask, AutoSkillProposal, ModelSettings, ExperimentManifest, ExperimentSummary } from '../shared/types.js'
import { DEFAULT_MODEL_SETTINGS } from '../shared/types.js'
import type { ApprovalPolicy, ApprovalDecision } from './platform/approval-policy.js'
import { decideApproval, defaultApprovalPolicy, validateApprovalPolicy } from './platform/approval-policy.js'
import type { FallbackState, ModelRoute, SelectModelOptions } from './platform/models-selector.js'
import { emptyFallbackState, routeKey, selectModel, recordFailure, recordSuccess } from './platform/models-selector.js'
import type { ToolDef } from './platform/tools-selector.js'
import { selectToolsForTurn, BASE_TOOL_WHITELIST } from './platform/tools-selector.js'
import type { SubagentRecord, SubagentCreateRequest, SubagentMode, SubagentOpResult } from './platform/subagents.js'
import type { SubagentRegistry, SubagentProviderRegistry, SubagentFacade } from './platform/subagents.js'
import { exportSessionDiagnostics, type SessionDiagnostics, type DiagnosticEventLike, type DiagnosticCompaction } from './platform/diagnostics.js'
import type { McpSupervisor } from './mcp/supervisor.js'
import type { McpServerConfig, McpServerStatus } from './mcp/supervisor.js'
import type { LayeredSkillRegistry, SkillLayer, SkillEntry } from './skills/registry.js'
import type { ScienceLoopService, ScienceLoop, ScienceLoopAction } from './science/loops.js'
import type { ScienceChatGraphBridge } from './science/chat-graph-bridge.js'
import { callJson } from './core/llm.js'

/** 各服务集合（host 入口注入）。 */
export interface HostServices {
  readonly workspace: WorkspaceService
  readonly memory: MemoryRuntime
  readonly scheduler: SchedulerService
  readonly channels: ChannelManager
  readonly autoskills: AutoSkillsService
  readonly experts: ExpertService
  readonly experiments: ExperimentService
  readonly chatGraph: ChatGraphService
  readonly projectEnv: ProjectEnvService
  readonly rewind: RewindService
  /** 自由文本研究笔记（NOTE-01..09；§整合 3.1）。 */
  readonly notes?: NotesService
  /** 实验工作区（§7 自由形式实验管理；EXP-02..04，整合 §3.3）。 */
  readonly experimentWorkspace?: ExperimentWorkspaceService
  /** 实验进程与日志（§7.2 运行账本；EXP-05..12，整合 §3.4）。 */
  readonly experimentProcess?: ExperimentProcessService
  /** Git worktree（§7.4；ENV-01/02）。 */
  readonly worktrees?: WorktreeService
  /** 科学自演化循环（SCI-08/09），状态快照可跨重启恢复。 */
  readonly scienceLoops?: ScienceLoopService
  /** RA/EA/EMA 到 Chat Graph/Evolution 的明确边界桥接。 */
  readonly scienceGraphBridge?: ScienceChatGraphBridge
  /** 文献索引（LIB-01..08）：注册/提取/搜索/笔记/参考文献/BibTeX/图引用。 */
  readonly libraryIndexer?: LibraryIndexer
  /** 文献检索与引用解析（LIB-03/07/08）。 */
  readonly librarySearch?: LibrarySearch
  /** 稿件目录与 LaTeX 写作（WRITE-01..08）。 */
  readonly manuscript?: ManuscriptService
  /** 自进化运行时（EVO-01..06；t15 交付，P1 接入）。 */
  readonly evo?: {
    readonly signals: SignalStore
    readonly registry: CandidateRegistry
  }
  /** 上下文窗口保护层（CTX-13..19；P2）。 */
  readonly contextGuard?: ContextWindowRuntime
  /** 平台上下文运行时（PLAT-03..07）：压缩、裁剪、投影和谱系的统一门面。 */
  readonly contextRuntime?: ContextRuntime
  /** ContextAssembler（CTX-01..12；P2）。 */
  readonly contextAssembler?: ContextAssembler
  /** 平台能力层（PLAT-13..20；t19 交付，按需接线）。 */
  readonly platform?: PlatformServices
}

/** 平台能力服务集合（PLAT-13..20；可选接线）。 */
export interface PlatformServices {
  /** 模型路由状态（PLAT-13：多模型 Fallback 计数）。 */
  readonly modelFallbackState?: FallbackState
  /** 记录一次失败（增加计数）。 */
  readonly recordModelFailure?: (route: ModelRoute) => FallbackState
  /** 记录一次成功（清零计数）。 */
  readonly recordModelSuccess?: (route: ModelRoute) => FallbackState
  /** 选择当前路由（PLAT-13 纯函数）。 */
  readonly selectModelRoute?: (routes: { primary: ModelRoute; fallbacks?: ModelRoute[] }, options?: SelectModelOptions) => ModelRoute | null
  /** 工具选择（PLAT-14）。 */
  readonly selectToolsForTurn?: (tools: readonly ToolDef[], query: string, options?: { required?: readonly string[]; maxTools?: number }) => ToolDef[]
  /** 审批策略（PLAT-15：默认 ask + 默认危险清单）。 */
  readonly approvalPolicy?: ApprovalPolicy
  /** 同步审批判定（PLAT-15 纯函数）。 */
  readonly decideApproval?: (toolName: string) => ApprovalDecision
  /** 子代理运行时（PLAT-16/19）。 */
  readonly subagents?: {
    readonly registry: SubagentRegistry
    readonly providers: SubagentProviderRegistry
    readonly facade: SubagentFacade
  }
  /** MCP supervisor（PLAT-11/12）。 */
  readonly mcp?: McpSupervisor
  /** 分层 Skill 注册表（PLAT-08..10；按工作区创建视图）。 */
  readonly skillRegistry?: LayeredSkillRegistry
  readonly skillRegistryFor?: (workspaceDir?: string) => LayeredSkillRegistry
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

/** 路径规范化（大小写不敏感比较，统一斜杠）。 */
function normPathKey(p: string): string {
  return path.normalize(p).replace(/\\/g, '/').toLowerCase()
}

/** target 是否等于 base 或位于 base 之下。 */
function isSameOrInside(target: string, base: string): boolean {
  const t = normPathKey(target)
  const b = normPathKey(base)
  return t === b || t.startsWith(`${b}/`)
}

/** 会话存储根（与客户端 session-delete 同源）。 */
function sessionStoreRoot(): string {
  return path.join(process.env.DSH_HOME ?? process.cwd(), 'sessions')
}

/**
 * DSH 会话目录键：与 @deepseek-ai/dsh-session-persistence-jsonl 的 projectKey
 * 完全一致 —— 连续分隔符（/ \\ :）折叠为单个 `-`，不安全码元转义为 ~XXXX，
 * 去掉前导 `-` 并截断到 251 字符，最后以 `--` 包裹。
 */
function sessionKeyOf(cwd: string): string {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i += 1) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
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
      // 回溯基线提交（auto-turn 0 = 初始状态，编辑/回溯第 1 回合可恢复到此）
      try { this.services.rewind.commitWorkspace(project.path, 'auto-turn 0') } catch { /* 非 git 项目忽略 */ }
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
      const project = await this.services.workspace.autoCreateProject(this.hostCtx, model, String(args?.description ?? ''))
      // 欢迎页自动建项目路径同样打回溯基线（auto-turn 0 = 初始状态）
      try { this.services.rewind.commitWorkspace(project.path, 'auto-turn 0') } catch { /* 非 git 项目忽略 */ }
      return project
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

  /** 确保 UV 已安装（缺失时用官方脚本自动安装；返回安装结果）。 */
  @Remote('uvEnsure')
  async uvEnsure(): Promise<{ ok: boolean; uv: string | null; installed: boolean; error?: string }> {
    return this.services.projectEnv.uvEnsure()
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

  // ── 回溯（§回溯：Git 工作区 + 会话截断 + 编辑重发）────────────────────────

  /** 回溯信息：最近用户消息（编辑/回溯目标）+ 工作区 git 状态。 */
  @Remote('rewindInfo')
  rewindInfo(args: { sessionId?: string }): {
    workspaceDir: string | null
    lastUserMessage: { seq: number; text: string; turn: number } | null
    gitLog: Array<{ sha: string; message: string; when: number }>
  } | { error: string } {
    try {
      const sessionId = String(args?.sessionId ?? '')
      const workspaceDir = this.services.rewind.workspaceOfSession(sessionId)
      const gitLog = workspaceDir !== null ? this.services.rewind.workspaceLog(workspaceDir, 30) : []
      return { workspaceDir, lastUserMessage: this.services.rewind.lastUserMessage(sessionId), gitLog }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 完全回溯：fork 截断子会话 + 工作区恢复到目标回合。 */
  @Remote('rewindExecute')
  rewindExecute(args: { sessionId?: string; beforeSeq?: number }): {
    ok: boolean
    childSessionId: string
    workspaceDir: string | null
    restoredCommit: string | null
    safetyCommit: string | null
    note?: string
  } | { error: string } {
    try {
      return this.services.rewind.rewindFork(this.hostCtx, String(args?.sessionId ?? ''), Number(args?.beforeSeq ?? 0))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * 编辑重发：以被编辑消息为边界 fork 截断子会话（旧内容与后续回复不复存在），
   * 并恢复工作区到该回合之前；前端打开子会话后以修正文本走官方 prompt 流程。
   */
  @Remote('usermsgEdit')
  usermsgEdit(args: { sessionId?: string; seq?: number }): {
    ok: boolean
    childSessionId: string
    workspaceDir: string | null
    restoredCommit: string | null
    safetyCommit: string | null
    note?: string
  } | { error: string } {
    try {
      return this.services.rewind.rewindFork(this.hostCtx, String(args?.sessionId ?? ''), Number(args?.seq ?? 0))
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

  /** 清除数据（设置面板）：scopes ∈ projects / models（prefs 为客户端本地偏好）。 */
  @Remote('dataClear')
  async dataClear(args: { scopes?: string[] }): Promise<{ ok: boolean; counts?: Record<string, number>; error?: string }> {
    try {
      const scopes = new Set((Array.isArray(args?.scopes) ? args.scopes : []).filter((s) => s === 'projects' || s === 'models'))
      if (scopes.size === 0) return { ok: false, error: '未选择任何清除项' }
      const counts: { projects: number; sessions: number; chatGraphs: number; tasks: number; models: number } = { projects: 0, sessions: 0, chatGraphs: 0, tasks: 0, models: 0 }

      if (scopes.has('projects')) {
        const projects = this.services.workspace.listProjects()
        const projectPaths = projects.map((p) => p.path)
        if (projectPaths.length > 0) {
          // 运行中的项目会话不可删除（与 session-delete 同策略）
          const agents = this.hostCtx.get('agents') as { get?(id: string): { status?: string } } | undefined
          const live = this.hostCtx.get('sessions') as { list?(): Array<{ id?: string; header?: { cwd?: string } }> } | undefined
          const busy = (live?.list?.() ?? []).some((s) => {
            const cwd = s.header?.cwd ?? ''
            if (!projectPaths.some((p) => isSameOrInside(cwd, p))) return false
            return agents?.get?.(s.id ?? '')?.status === 'running'
          })
          if (busy) return { ok: false, error: '有项目会话正在运行，请先停止任务再清除' }

          // 收集这些项目的全部会话 id（持久化 + live），供引用清理使用
          const sessionIds = new Set<string>()
          const persistence = this.hostCtx.get('sessionPersistence') as { listSnapshots?(): Promise<Array<{ header?: { id?: string; cwd?: string } }>> } | undefined
          if (persistence?.listSnapshots !== undefined) {
            try {
              for (const snap of await persistence.listSnapshots()) {
                const cwd = snap.header?.cwd ?? ''
                if (projectPaths.some((p) => isSameOrInside(cwd, p))) {
                  const id = snap.header?.id
                  if (id !== undefined && id !== '') sessionIds.add(id)
                }
              }
            } catch {
              // 快照不可用则退回目录级清理
            }
          }
          for (const s of live?.list?.() ?? []) {
            const cwd = s.header?.cwd ?? ''
            if (projectPaths.some((p) => isSameOrInside(cwd, p)) && s.id !== undefined) sessionIds.add(s.id)
          }
          console.log(`[evoresearch:data-clear] projects=${projects.length} sessionIds=${sessionIds.size} snapshots=${persistence?.listSnapshots !== undefined ? 'available' : 'missing'} root=${sessionStoreRoot()}`)

          // 先释放项目记忆库连接，再删目录（Windows 文件占用防护）
          for (const p of projects) {
            try {
              this.services.memory.closeStore(p.path)
            } catch {
              // 关闭失败不阻塞
            }
          }
          const sessionsRoot = sessionStoreRoot()
          for (const p of projects) {
            // 项目目录（含 .venv / 记忆 / 笔记 / 实验 / 图数据等）
            try {
              rmSync(p.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
              counts.projects += 1
            } catch (error) {
              console.error(`[evoresearch:data-clear] 项目目录删除失败: ${p.path}`, error)
              // 单个目录失败不中断
            }
            // 会话目录（按 workspace 键）
            try {
              rmSync(path.join(sessionsRoot, sessionKeyOf(p.path)), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
              counts.sessions += 1
            } catch (error) {
              console.error(`[evoresearch:data-clear] 会话键目录删除失败: ${path.join(sessionsRoot, sessionKeyOf(p.path))}`, error)
              // 不存在或失败
            }
          }
          // 兜底：遍历会话存储，按 sessionId 精确删除（兼容键变体）
          if (sessionIds.size > 0) {
            const walk = (dir: string, depth: number): void => {
              if (depth > 4) return
              let entries: string[] = []
              try {
                entries = readdirSync(dir)
              } catch {
                return
              }
              for (const name of entries) {
                const full = path.join(dir, name)
                let isDir = false
                try {
                  isDir = statSync(full).isDirectory()
                } catch {
                  continue
                }
                if (!isDir) continue
                if (sessionIds.has(name)) {
                  try {
                    rmSync(full, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
                    counts.sessions += 1
                  } catch {
                    // 跳过失败目录
                  }
                } else {
                  walk(full, depth + 1)
                }
              }
            }
            walk(sessionsRoot, 0)
          }

          // 全局 Chat Graph 文件（<dataRoot>/.evoresearch-data/chat-graphs/<name>.json）
          const graphsDir = path.join(this.services.memory.config.dataRoot, '.evoresearch-data', 'chat-graphs')
          let graphFiles: string[] = []
          try {
            graphFiles = readdirSync(graphsDir)
          } catch {
            // 目录不存在
          }
          for (const p of projects) {
            const prefix = `${p.name}.json`
            for (const file of graphFiles) {
              if (file === prefix || file.startsWith(`${prefix}.bak-`)) {
                try {
                  rmSync(path.join(graphsDir, file), { force: true })
                  counts.chatGraphs += 1
                } catch {
                  // 跳过失败文件
                }
              }
            }
          }

          // 项目定时任务：清空全部项目时一并移除（任务均挂靠项目工作区）
          for (const task of this.services.scheduler.list()) {
            if (this.services.scheduler.remove(task.taskId)) counts.tasks += 1
          }

          // 会话元数据 / 反馈记录中的项目会话引用
          this.dropSessionRefs(sessionIds)
        }
      }

      if (scopes.has('models')) {
        this.resetModelSettingsFile()
        const settings = this.hostCtx.get('settings') as { replace?(ns: unknown, section: object): Promise<unknown> } | undefined
        if (settings?.replace !== undefined) {
          try {
            // 重置默认模型选择：用户层清空 → 回退组合基线（出厂默认）
            await settings.replace('agent-default-model', {})
          } catch {
            // 无 settings provider 时忽略
          }
        }
        counts.models = 1
      }
      return { ok: true, counts }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 重置模型档位文件为出厂默认。 */
  private resetModelSettingsFile(): void {
    const file = this.modelSettingsFile()
    mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(DEFAULT_MODEL_SETTINGS, null, 2), 'utf8')
    renameSync(tmp, file)
  }

  /** 清理会话元数据与反馈记录中已删除会话的引用。 */
  private dropSessionRefs(sessionIds: Set<string>): void {
    if (sessionIds.size === 0) return
    // session-meta.json
    try {
      const meta = this.readSessionMeta()
      let changed = false
      for (const id of sessionIds) {
        if (meta[id] !== undefined) {
          delete meta[id]
          changed = true
        }
      }
      if (changed) this.writeSessionMeta(meta)
    } catch {
      // 元数据清理失败不影响主流程
    }
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
  experimentsRollback(args: { workspaceDir?: string; id: string; checkpointId: string; confirm?: boolean }): { ok: boolean; restored: number; checkpointId: string; name: string } | { error: string } {
    try {
      // EXP-13 破坏性保护：覆盖工作区文件前必须显式 confirm:true（前端先弹确认框）
      const result = this.services.experiments.rollback(this.experimentArgs(args), String(args?.id ?? ''), String(args?.checkpointId ?? ''), { confirm: args?.confirm === true })
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

  // ── 实验工作区（§7 自由形式实验管理；EXP-02..04，t39 片段）────────────────

  @Remote('experimentWorkspaceCreate')
  experimentWorkspaceCreate(args: { project: string; name: string }): ExperimentWorkspaceInfo | { error: string } {
    try {
      const svc = this.services.experimentWorkspace
      if (svc === undefined) return { error: 'experimentWorkspace 服务不可用' }
      return svc.createWorkspace(String(args?.project ?? ''), String(args?.name ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentWorkspaceImport')
  experimentWorkspaceImport(args: { project: string; sourceDir: string; name?: string; copy?: boolean }): ExperimentWorkspaceInfo | { error: string } {
    try {
      const svc = this.services.experimentWorkspace
      if (svc === undefined) return { error: 'experimentWorkspace 服务不可用' }
      return svc.importExisting(String(args?.project ?? ''), String(args?.sourceDir ?? ''), {
        ...(typeof args?.name === 'string' && args.name.trim() !== '' ? { name: args.name } : {}),
        ...(args?.copy === true ? { copy: true } : {}),
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentWorkspaceList')
  experimentWorkspaceList(args: { workspaceDir?: string }): ExperimentWorkspaceInfo[] {
    const svc = this.services.experimentWorkspace
    if (svc === undefined) return []
    return svc.list(String(args?.workspaceDir ?? ''))
  }

  @Remote('experimentWorkspaceDetail')
  experimentWorkspaceDetail(args: { workspaceDir?: string; slug: string }): ExperimentWorkspaceDetail | { error: string } {
    try {
      const svc = this.services.experimentWorkspace
      if (svc === undefined) return { error: 'experimentWorkspace 服务不可用' }
      return svc.listDetail(String(args?.workspaceDir ?? ''), String(args?.slug ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentWorkspaceReadNote')
  experimentWorkspaceReadNote(args: { workspaceDir?: string; slug: string }): { content: string } | { error: string } {
    try {
      const svc = this.services.experimentWorkspace
      if (svc === undefined) return { error: 'experimentWorkspace 服务不可用' }
      return { content: svc.readNote(String(args?.workspaceDir ?? ''), String(args?.slug ?? '')) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentWorkspaceWriteNote')
  experimentWorkspaceWriteNote(args: { workspaceDir?: string; slug: string; content: string; append?: boolean }): { ok: true; bytes: number } | { error: string } {
    try {
      const svc = this.services.experimentWorkspace
      if (svc === undefined) return { error: 'experimentWorkspace 服务不可用' }
      return svc.writeNote(String(args?.workspaceDir ?? ''), String(args?.slug ?? ''), String(args?.content ?? ''), {
        append: args?.append === true,
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentWorkspaceTree')
  experimentWorkspaceTree(args: { workspaceDir?: string; slug: string; depth?: number; maxItems?: number }): ExperimentWorkspaceTree | { error: string } {
    try {
      const svc = this.services.experimentWorkspace
      if (svc === undefined) return { error: 'experimentWorkspace 服务不可用' }
      return svc.listContents(String(args?.workspaceDir ?? ''), String(args?.slug ?? ''), {
        ...(typeof args?.depth === 'number' ? { depth: args.depth } : {}),
        ...(typeof args?.maxItems === 'number' ? { maxItems: args.maxItems } : {}),
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ── 实验进程与日志（§7.2 运行账本；EXP-05..12，t39 片段）──────────────────

  @Remote('experimentRunStart')
  experimentRunStart(args: { workspaceDir?: string; slug: string; command: string; cwd?: string; pythonPath?: string; env?: Record<string, string> }): { run: RunRecord } | { error: string } {
    try {
      const svc = this.services.experimentProcess
      if (svc === undefined) return { error: 'experimentProcess 服务不可用' }
      const run = svc.run(String(args?.workspaceDir ?? ''), String(args?.slug ?? ''), {
        command: String(args?.command ?? ''),
        ...(typeof args?.cwd === 'string' && args.cwd.trim() !== '' ? { cwd: args.cwd } : {}),
        ...(typeof args?.pythonPath === 'string' && args.pythonPath.trim() !== '' ? { pythonPath: args.pythonPath } : {}),
        ...(args?.env !== undefined ? { env: args.env } : {}),
      })
      return { run }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentRunList')
  experimentRunList(args: { workspaceDir?: string; slug: string }): { runs: RunRecord[] } {
    const svc = this.services.experimentProcess
    if (svc === undefined) return { runs: [] }
    return { runs: svc.list(String(args?.workspaceDir ?? ''), String(args?.slug ?? '')) }
  }

  @Remote('experimentRunStatus')
  experimentRunStatus(args: { workspaceDir?: string; slug: string }): { runs: RunRecord[]; running: RunRecord | null; latest: RunRecord | null } {
    const svc = this.services.experimentProcess
    if (svc === undefined) return { runs: [], running: null, latest: null }
    return svc.status(String(args?.workspaceDir ?? ''), String(args?.slug ?? ''))
  }

  @Remote('experimentRunStop')
  experimentRunStop(args: { workspaceDir?: string; slug: string; runId?: string }): { ok: true; run: RunRecord } | { error: string } {
    try {
      const svc = this.services.experimentProcess
      if (svc === undefined) return { error: 'experimentProcess 服务不可用' }
      return svc.stop(String(args?.workspaceDir ?? ''), String(args?.slug ?? ''), {
        ...(typeof args?.runId === 'string' && args.runId !== '' ? { runId: args.runId } : {}),
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentLogRead')
  experimentLogRead(args: { workspaceDir?: string; slug: string; stream?: 'stdout' | 'stderr'; offset?: number; limit?: number; tail?: number }): { text: string; nextOffset: number; eof: boolean; size: number } | { error: string } {
    try {
      const svc = this.services.experimentProcess
      if (svc === undefined) return { error: 'experimentProcess 服务不可用' }
      const stream = args?.stream === 'stderr' ? 'stderr' : 'stdout'
      return svc.readLog(String(args?.workspaceDir ?? ''), String(args?.slug ?? ''), stream, {
        ...(typeof args?.offset === 'number' ? { offset: args.offset } : {}),
        ...(typeof args?.limit === 'number' ? { limit: args.limit } : {}),
        ...(typeof args?.tail === 'number' ? { tail: args.tail } : {}),
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentLogInfo')
  experimentLogInfo(args: { workspaceDir?: string; slug: string }): { stdout: { path: string; size: number }; stderr: { path: string; size: number } } {
    const svc = this.services.experimentProcess
    if (svc === undefined) return { stdout: { path: '', size: 0 }, stderr: { path: '', size: 0 } }
    return svc.logInfo(String(args?.workspaceDir ?? ''), String(args?.slug ?? ''))
  }

  @Remote('experimentRecover')
  experimentRecover(args: { workspaceDir?: string; slug: string }): { checked: number; changed: number; notes: string[] } {
    const svc = this.services.experimentProcess
    if (svc === undefined) return { checked: 0, changed: 0, notes: [] }
    return svc.restartRecovery(String(args?.workspaceDir ?? ''), String(args?.slug ?? ''))
  }

  @Remote('experimentRetrospectiveDraft')
  experimentRetrospectiveDraft(args: { workspaceDir?: string; slug: string; saveDraft?: boolean }): { draft: string; draftPath: string | null } | { error: string } {
    try {
      const svc = this.services.experimentProcess
      if (svc === undefined) return { error: 'experimentProcess 服务不可用' }
      return svc.retrospectiveDraft(String(args?.workspaceDir ?? ''), String(args?.slug ?? ''), {
        saveDraft: args?.saveDraft === true,
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentWorkspaceAppendNote')
  experimentWorkspaceAppendNote(args: { workspaceDir?: string; slug: string; text: string; heading?: string }): { ok: true; bytes: number } | { error: string } {
    try {
      const svc = this.services.experimentWorkspace
      if (svc === undefined) return { error: 'experimentWorkspace 服务不可用' }
      return svc.appendNote(String(args?.workspaceDir ?? ''), String(args?.slug ?? ''), String(args?.text ?? ''), {
        ...(typeof args?.heading === 'string' && args.heading.trim() !== '' ? { heading: args.heading } : {}),
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentWorkspaceArtifacts')
  experimentWorkspaceArtifacts(args: { workspaceDir?: string; slug: string }): { dir: string; exists: boolean; entries: ExperimentWorkspaceEntry[]; dirs: number; files: number; totalBytes: number } | { error: string } {
    try {
      const svc = this.services.experimentWorkspace
      if (svc === undefined) return { error: 'experimentWorkspace 服务不可用' }
      return svc.artifacts(String(args?.workspaceDir ?? ''), String(args?.slug ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('experimentGraphRefResolve')
  experimentGraphRefResolve(args: { ref: ExperimentGraphRef }): ExperimentGraphRefResolution | { error: string } {
    try {
      const svc = this.services.experimentProcess
      if (svc === undefined) return { error: 'experimentProcess 服务不可用' }
      return svc.resolveGraphRef(args?.ref as ExperimentGraphRef)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ── 文献索引（LIB；t40 片段；project=项目名非路径）────────────────────────

  @Remote('libraryAddPaper')
  async libraryAddPaper(args: { project: string; pdfPath: string }): Promise<AddPaperResult | { error: string }> {
    try {
      const svc = this.services.libraryIndexer
      if (svc === undefined) return { error: 'libraryIndexer 服务不可用' }
      return await svc.addPaper(String(args?.project ?? ''), String(args?.pdfPath ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('libraryIndex')
  async libraryIndex(args: { project: string; scanDir: string }): Promise<IndexLibraryResult | { error: string }> {
    try {
      const svc = this.services.libraryIndexer
      if (svc === undefined) return { error: 'libraryIndexer 服务不可用' }
      return await svc.indexLibrary(String(args?.project ?? ''), String(args?.scanDir ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('libraryList')
  libraryList(args: { project: string; includeMissing?: boolean; limit?: number; offset?: number }): PaperSummary[] | { error: string } {
    try {
      const svc = this.services.librarySearch
      if (svc === undefined) return { error: 'librarySearch 服务不可用' }
      return svc.listPapers(String(args?.project ?? ''), {
        includeMissing: args?.includeMissing,
        limit: args?.limit,
        offset: args?.offset,
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('libraryGet')
  libraryGet(args: { project: string; paperId: string }): PaperSummary | null | { error: string } {
    try {
      const svc = this.services.librarySearch
      if (svc === undefined) return { error: 'librarySearch 服务不可用' }
      return svc.getPaper(String(args?.project ?? ''), String(args?.paperId ?? '')) ?? null
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('librarySearch')
  librarySearch(args: {
    project: string
    query: string
    fields?: SearchOptions['fields']
    limit?: number
    includeLocations?: boolean
    locationsPerPaper?: number
  }): SearchHit[] | { error: string } {
    try {
      const svc = this.services.librarySearch
      if (svc === undefined) return { error: 'librarySearch 服务不可用' }
      return svc.search(String(args?.project ?? ''), String(args?.query ?? ''), {
        fields: args?.fields,
        limit: args?.limit,
        includeLocations: args?.includeLocations,
        locationsPerPaper: args?.locationsPerPaper,
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('libraryGetTextRange')
  libraryGetTextRange(args: { project: string; paperId: string; page: number; offset: number; length: number }): TextRange | { error: string } {
    try {
      const svc = this.services.librarySearch
      if (svc === undefined) return { error: 'librarySearch 服务不可用' }
      return svc.getTextRange(
        String(args?.project ?? ''),
        String(args?.paperId ?? ''),
        Number(args?.page ?? 1),
        Number(args?.offset ?? 0),
        Number(args?.length ?? 0),
      )
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('libraryGetPageText')
  libraryGetPageText(args: { project: string; paperId: string; page: number }): { filePath: string; page: number; text: string } | null | { error: string } {
    try {
      const svc = this.services.librarySearch
      if (svc === undefined) return { error: 'librarySearch 服务不可用' }
      return svc.getPageText(String(args?.project ?? ''), String(args?.paperId ?? ''), Number(args?.page ?? 1)) ?? null
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('librarySetNotes')
  librarySetNotes(args: { project: string; paperId: string; notes: string }): PaperSummary | { error: string } {
    try {
      const svc = this.services.libraryIndexer
      if (svc === undefined) return { error: 'libraryIndexer 服务不可用' }
      return svc.setNotes(String(args?.project ?? ''), String(args?.paperId ?? ''), String(args?.notes ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('libraryGetNotes')
  libraryGetNotes(args: { project: string; paperId: string }): string | { error: string } {
    try {
      const svc = this.services.libraryIndexer
      if (svc === undefined) return { error: 'libraryIndexer 服务不可用' }
      return svc.getNotes(String(args?.project ?? ''), String(args?.paperId ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('librarySetReferences')
  librarySetReferences(args: { project: string; paperId: string; references: string[] }): PaperSummary | { error: string } {
    try {
      const svc = this.services.libraryIndexer
      if (svc === undefined) return { error: 'libraryIndexer 服务不可用' }
      return svc.setReferences(String(args?.project ?? ''), String(args?.paperId ?? ''), args?.references ?? [])
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('libraryGetReferences')
  libraryGetReferences(args: { project: string; paperId: string }): string[] | { error: string } {
    try {
      const svc = this.services.libraryIndexer
      if (svc === undefined) return { error: 'libraryIndexer 服务不可用' }
      return svc.getReferences(String(args?.project ?? ''), String(args?.paperId ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('librarySetBibtex')
  librarySetBibtex(args: { project: string; paperId: string; bibtex: string }): PaperSummary | { error: string } {
    try {
      const svc = this.services.libraryIndexer
      if (svc === undefined) return { error: 'libraryIndexer 服务不可用' }
      return svc.setBibtex(String(args?.project ?? ''), String(args?.paperId ?? ''), String(args?.bibtex ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('libraryGetBibtex')
  libraryGetBibtex(args: { project: string; paperId: string }): string | { error: string } {
    try {
      const svc = this.services.libraryIndexer
      if (svc === undefined) return { error: 'libraryIndexer 服务不可用' }
      return svc.getBibtex(String(args?.project ?? ''), String(args?.paperId ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('libraryImportBibtex')
  libraryImportBibtex(args: { project: string; bibtex: string }): { attached: Array<{ paperId: string; title: string }>; unmatched: BibEntry[] } | { error: string } {
    try {
      const svc = this.services.libraryIndexer
      if (svc === undefined) return { error: 'libraryIndexer 服务不可用' }
      return svc.importBibtex(String(args?.project ?? ''), String(args?.bibtex ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('libraryResolveRef')
  libraryResolveRef(args: { project: string; ref: LibraryRef }): ResolvedLibraryRef | null | { error: string } {
    try {
      const svc = this.services.librarySearch
      if (svc === undefined) return { error: 'librarySearch 服务不可用' }
      return svc.resolveRef(String(args?.project ?? ''), args?.ref ?? { kind: 'paper' }) ?? null
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('libraryToGraphRef')
  libraryToGraphRef(args: { project: string; ref: LibraryRef }): { kind: 'pdf'; path: string } | null | { error: string } {
    try {
      const svc = this.services.librarySearch
      if (svc === undefined) return { error: 'librarySearch 服务不可用' }
      return svc.toGraphRef(String(args?.project ?? ''), args?.ref ?? { kind: 'paper' }) ?? null
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('libraryScanPages')
  libraryScanPages(args: { project: string; query: string; paperId?: string; limit?: number }):
    Array<{ paperId: string; title: string; filePath: string; page: number; offset: number; snippet: string }> | { error: string } {
    try {
      const svc = this.services.librarySearch
      if (svc === undefined) return { error: 'librarySearch 服务不可用' }
      return svc.scanPages(String(args?.project ?? ''), String(args?.query ?? ''), {
        paperId: args?.paperId,
        hitLimit: args?.limit,
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ── 稿件写作（WRITE；t40 片段）────────────────────────────────────────────

  @Remote('manuscriptCreate')
  manuscriptCreate(args: { project: string; dirName?: string }): ManuscriptInfo | { error: string } {
    try {
      const svc = this.services.manuscript
      if (svc === undefined) return { error: 'manuscript 服务不可用' }
      return svc.createManuscript(String(args?.project ?? ''), args?.dirName)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('manuscriptList')
  manuscriptList(args: { project: string }): ManuscriptInfo[] | { error: string } {
    try {
      const svc = this.services.manuscript
      if (svc === undefined) return { error: 'manuscript 服务不可用' }
      return svc.listManuscripts(String(args?.project ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('manuscriptGet')
  manuscriptGet(args: { project: string; dir?: string }): ManuscriptInfo | { error: string } {
    try {
      const svc = this.services.manuscript
      if (svc === undefined) return { error: 'manuscript 服务不可用' }
      return svc.getManuscript(String(args?.project ?? ''), args?.dir)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('manuscriptListFiles')
  manuscriptListFiles(args: { project: string; dir?: string; sub?: string }): string[] | { error: string } {
    try {
      const svc = this.services.manuscript
      if (svc === undefined) return { error: 'manuscript 服务不可用' }
      return svc.listFiles(String(args?.project ?? ''), args?.dir, args?.sub)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('manuscriptReadFile')
  manuscriptReadFile(args: { project: string; dir?: string; relPath: string }): { path: string; content: string } | { error: string } {
    try {
      const svc = this.services.manuscript
      if (svc === undefined) return { error: 'manuscript 服务不可用' }
      return svc.readFile(String(args?.project ?? ''), args?.dir, String(args?.relPath ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('manuscriptWriteFile')
  manuscriptWriteFile(args: { project: string; dir?: string; relPath: string; content: string }): { path: string } | { error: string } {
    try {
      const svc = this.services.manuscript
      if (svc === undefined) return { error: 'manuscript 服务不可用' }
      return svc.writeFile(String(args?.project ?? ''), args?.dir, String(args?.relPath ?? ''), String(args?.content ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('manuscriptCompile')
  async manuscriptCompile(args: { project: string; dir?: string; tool?: LatexTool; timeoutMs?: number }): Promise<CompileResult | { error: string }> {
    try {
      const svc = this.services.manuscript
      if (svc === undefined) return { error: 'manuscript 服务不可用' }
      return await svc.compileManuscript(String(args?.project ?? ''), args?.dir, {
        tool: args?.tool,
        timeoutMs: args?.timeoutMs,
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('manuscriptContext')
  manuscriptContext(args: { project: string; refs: unknown[] }): ManuscriptContext | { error: string } {
    try {
      const svc = this.services.manuscript
      if (svc === undefined) return { error: 'manuscript 服务不可用' }
      return svc.resolveManuscriptContext(String(args?.project ?? ''), args?.refs ?? [])
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('manuscriptQuoteCheck')
  manuscriptQuoteCheck(args: QuoteCheckInput & { project: string }): QuoteCheckResult | { error: string } {
    try {
      const svc = this.services.manuscript
      if (svc === undefined) return { error: 'manuscript 服务不可用' }
      return svc.quoteCheck(String(args?.project ?? ''), {
        text: args?.text,
        number: args?.number,
        paperId: args?.paperId,
        experimentDir: args?.experimentDir,
        resultFile: args?.resultFile,
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('manuscriptDiffDraft')
  manuscriptDiffDraft(args: { project: string; dir?: string; newContent: string }): DraftDiff | { error: string } {
    try {
      const svc = this.services.manuscript
      if (svc === undefined) return { error: 'manuscript 服务不可用' }
      return svc.diffDraft(String(args?.project ?? ''), args?.dir, String(args?.newContent ?? ''))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ── Chat Graph ────────────────────────────────────────────────────────────

  /** 项目名 → 图（按项目隔离；会话 cwd 派生项目名）。 */
  private graphProjectOf(args: { workspaceDir?: string }): string {
    const ws = args?.workspaceDir && args.workspaceDir !== this.services.memory.config.dataRoot
      ? String(args.workspaceDir)
      : undefined
    const name = ws !== undefined
      ? (() => {
          const v = this.services.workspace.validateWorkspace(ws)
          return v.kind === 'project' ? v.name : undefined
        })()
      : undefined
    if (name === undefined) throw new Error('未绑定项目工作区')
    return name
  }

  @Remote('graphGet')
  graphGet(args: { workspaceDir?: string }): unknown {
    try {
      const name = this.graphProjectOf(args)
      return { graph: this.services.chatGraph.get(name), rev: this.services.chatGraph.rev(name) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('graphSave')
  graphSave(args: { workspaceDir?: string; graph: unknown; rev?: number }): { ok: boolean; error?: string; conflict?: boolean; rev?: number } {
    try {
      const name = this.graphProjectOf(args)
      // 乐观并发：前端携带的修订号与当前不一致 → 拒绝并提示刷新（防陈旧窗口整图覆盖）
      if (typeof args?.rev === 'number' && this.services.chatGraph.rev(name) !== args.rev) {
        return { ok: false, conflict: true, error: '图谱已在其他窗口修改，请刷新后重试' }
      }
      const result = this.services.chatGraph.save(name, (args?.graph ?? { nodes: [], edges: [] }) as never, args?.rev)
      if (!result.ok) return result
      return { ok: true, rev: this.services.chatGraph.rev(name) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('graphAddNode')
  graphAddNode(args: { workspaceDir?: string; node: unknown; operationId?: string }): unknown {
    try {
      const name = this.graphProjectOf(args)
      return this.services.chatGraph.applyOperation(args.operationId, () => ({ node: this.services.chatGraph.addNode(name, args?.node as never), rev: this.services.chatGraph.rev(name) }))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('graphAddEdge')
  graphAddEdge(args: { workspaceDir?: string; edge: unknown; operationId?: string }): unknown {
    try {
      const name = this.graphProjectOf(args)
      return this.services.chatGraph.applyOperation(args.operationId, () => ({ edge: this.services.chatGraph.addEdge(name, args?.edge as never), rev: this.services.chatGraph.rev(name) }))
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * 上下文初始化继承（§ChatGraph）：context 连线时一次性执行——
   * 把源 chat 会话的完整历史 fork 为新的独立会话（一层继承，非递归、非运行时注入），
   * 并将目标节点重新绑定到该会话。
   *
   * 原子性（GRAPH-03）：fork 成功（await agents.create）后才换绑并落盘；
   * fork 失败直接返回错误，不改动图——避免图指向不存在的会话。
   */
  @Remote('graphInherit')
  async graphInherit(args: { workspaceDir?: string; fromNodeId: string; toNodeId: string; sourceEventSeq?: number }): Promise<{ ok: boolean; sessionId?: string; replaced?: boolean; notice?: string; error?: string; rev?: number }> {
    try {
      const name = this.graphProjectOf(args)
      const graph = this.services.chatGraph.get(name)
      const from = graph.nodes.find((n) => n.id === String(args?.fromNodeId ?? '') && n.type === 'chat')
      const to = graph.nodes.find((n) => n.id === String(args?.toNodeId ?? '') && n.type === 'chat')
      if (from === undefined || from.sessionId === undefined) return { ok: false, error: '源聊天节点未绑定会话' }
      if (to === undefined) return { ok: false, error: '目标聊天节点不存在' }
      if (from.id === to.id) return { ok: false, error: '不能继承自己的上下文' }
      const agents = this.hostCtx.get('agents') as { create?(opts: Record<string, unknown>): Promise<unknown> } | undefined
      if (agents?.create === undefined) return { ok: false, error: 'agents 服务不可用' }
      // 源会话历史从持久化文件读取（源会话可能不是 live 会话）；
      // 过滤不符合官方 seed envelope 的事件（如会话头事件 session{type,id,cwd}）
      let seedEvents: unknown[]
      let cwd: string | undefined
      let sourceEventSeq: number | undefined
      let sourceMessageId: string | undefined
      try {
        const raw = readSessionEvents(from.sessionId) as Array<Record<string, unknown>>
        const requestedSeq = typeof args?.sourceEventSeq === 'number' && Number.isFinite(args.sourceEventSeq)
          ? Math.max(0, Math.floor(args.sourceEventSeq))
          : undefined
        const availableSeqs = raw.map((event) => typeof event.seq === 'number' ? event.seq : -1).filter((seq) => seq >= 0)
        const latestSeq = availableSeqs.length > 0 ? Math.max(...availableSeqs) : 0
        const bounded = requestedSeq === undefined ? raw : raw.filter((event) => typeof event.seq === 'number' && event.seq <= Math.min(requestedSeq, latestSeq))
        const lastEvent = bounded[bounded.length - 1]
        sourceEventSeq = typeof requestedSeq === 'number' ? Math.min(requestedSeq, latestSeq) : (typeof lastEvent?.seq === 'number' ? lastEvent.seq : undefined)
        const lastMessage = [...bounded].reverse().find((event) => event.type === 'user/message' || event.type === 'assistant/message')
        const messageData = lastMessage?.data as { messageId?: unknown; id?: unknown } | undefined
        const messageId = messageData?.messageId ?? messageData?.id
        sourceMessageId = typeof messageId === 'string' && messageId !== '' ? messageId : undefined
        const allowed = new Set(['type', 'seq', 'time', 'data', 'surfaceOp', 'sourceEventSeqs', 'ignorable'])
        // 过滤非法 envelope 事件，重排 seq 并丢弃 sourceEventSeqs（其引用旧 seq，
        // seed 回放不需要；官方要求 seed 从 0 连续且引用必须更早）
        seedEvents = bounded
          .filter((ev) => {
            if (typeof ev.type !== 'string') return false
            if (typeof ev.seq !== 'number' || typeof ev.time !== 'number' || ev.data === undefined) return false
            return Object.keys(ev).every((k) => allowed.has(k))
          })
          .map((ev, i) => {
            const clean: Record<string, unknown> = { type: ev.type, seq: i, time: ev.time, data: ev.data }
            if (ev.surfaceOp !== undefined) clean.surfaceOp = ev.surfaceOp
            if (ev.ignorable === true) clean.ignorable = true
            return clean
          })
        // cwd：live 会话头优先，否则取会话头事件（type==='session' 的 cwd 字段）
        const store = this.hostCtx.get('sessions') as { get?(id: string): { header?: { cwd?: string } } } | undefined
        const live = store?.get?.(from.sessionId)
        cwd = live?.header?.cwd
        if (cwd === undefined || cwd === '') {
          const head = raw.find((ev) => ev.type === 'session')
          cwd = typeof head?.cwd === 'string' && head.cwd !== '' ? head.cwd : undefined
        }
      } catch (error) {
        return { ok: false, error: `源会话历史读取失败: ${error instanceof Error ? error.message : String(error)}` }
      }
      const childId = `session-${randomUUID()}`
      const seed = Array.isArray(seedEvents) ? seedEvents : []
      // 原子性关键：fork 必须成功才继续——失败时返回错误且不改动图
      let created: unknown
      try {
        created = await agents.create({
          sessionId: childId,
          seed,
          meta: {
            ...(typeof cwd === 'string' && cwd !== '' ? { cwd } : {}),
            parentSession: from.sessionId,
            seedLength: seed.length,
            inherited: true,
          },
          agentOptions: {},
        })
      } catch (error) {
        return { ok: false, error: `会话 fork 失败: ${error instanceof Error ? error.message : String(error)}` }
      }
      // 以实际创建的会话 id 为准（handle 可能是 { session: { id } } 或直接 id）
      const realSessionId = (created as { session?: { id?: unknown } } | undefined)?.session?.id
        ?? (created as { id?: unknown } | undefined)?.id
      const finalId = typeof realSessionId === 'string' && realSessionId !== '' ? realSessionId : childId
      const replaced = to.sessionId !== finalId
      // 目标旧会话已有内容时提示（重新继承会换绑新会话，原会话保留但不再显示）
      let notice: string | undefined
      if (replaced && to.sessionId !== undefined) {
        try {
          if (readSessionEvents(to.sessionId).length > 0) notice = '该聊天已有内容，已重新绑定继承会话（原内容保留在旧会话中）'
        } catch { /* 旧会话不存在则无需提示 */ }
      }
      // 原子保存：context 边（唯一替换）+ 目标节点重新绑定 + 全图落盘
      // （与前端拖线共用一个写入口，避免 graph-save 与 graph-inherit 竞争覆盖）
      const edges = graph.edges
        .filter((e) => !(e.to === to.id && e.toPort === 'context'))
        .concat([{
          id: `e${Date.now().toString(36)}`,
          from: from.id,
          to: to.id,
          toPort: 'context' as const,
          behavior: 'fork' as const,
          forkAnchor: { sourceSessionId: from.sessionId, sourceEventSeq, sourceMessageId, targetSessionId: finalId },
        }])
      const next = { ...graph, nodes: graph.nodes.map((n) => (n.id === to.id ? { ...n, sessionId: finalId } : n)), edges }
      const saved = this.services.chatGraph.save(name, next)
      if (!saved.ok) return { ok: false, error: saved.error ?? '图谱保存失败' }
      return { ok: true, sessionId: finalId, replaced, notice, rev: this.services.chatGraph.rev(name) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ── Chat Graph 资料引用（GRAPH-04/06/08：文件/笔记引用节点预览与转笔记）──

  @Remote('graphPreview')
  graphPreview(args: { workspaceDir?: string; nodeId: string }): unknown {
    try {
      const name = this.graphProjectOf(args)
      const node = this.services.chatGraph.get(name).nodes.find((n) => n.id === String(args?.nodeId ?? ''))
      if (node === undefined) return { error: '节点不存在' }
      return { nodeId: node.id, preview: this.services.chatGraph.previewOf(node, String(args?.workspaceDir ?? '')) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('graphConvertNote')
  graphConvertNote(args: { workspaceDir?: string; nodeId: string }): { ok: boolean; noteId?: string; fileName?: string; node?: unknown; error?: string } {
    try {
      const name = this.graphProjectOf(args)
      const notes = this.services.notes
      if (notes === undefined) return { ok: false, error: 'notes 服务不可用' }
      const result = this.services.chatGraph.convertToNote(name, String(args?.nodeId ?? ''), String(args?.workspaceDir ?? ''), notes)
      if (!result.ok) return { ok: false, error: result.error }
      return { ok: true, noteId: result.noteId, fileName: result.fileName, node: result.node }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ── 自由文本研究笔记（NOTE-01..09；§整合 3.1，P0）─────────────────────────

  private notesService(): NotesService {
    const notes = this.services.notes
    if (notes === undefined) throw new Error('notes 服务不可用')
    return notes
  }

  @Remote('notesList')
  notesList(args: { workspaceDir?: string; includeLegacy?: boolean; source?: string; limit?: number; offset?: number }): unknown {
    try {
      const list = this.notesService().listNotes({
        workspaceDir: args?.workspaceDir,
        source: args?.source === 'legacy' || args?.source === 'observation' ? 'observation' : undefined,
        limit: args?.limit,
        offset: args?.offset,
      })
      return args?.includeLegacy === true
        ? [...list, ...this.notesService().listLegacyObservations(String(args?.workspaceDir ?? ''))]
        : list
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('notesRead')
  notesRead(args: { workspaceDir?: string; noteId: string; offset?: number; limit?: number }): unknown {
    try {
      return this.notesService().readNote({
        workspaceDir: args?.workspaceDir,
        noteId: String(args?.noteId ?? ''),
        offset: args?.offset,
        limit: args?.limit,
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('notesCreate')
  notesCreate(args: { workspaceDir?: string; title?: string; body: string }): unknown {
    try {
      return this.notesService().createNote({ workspaceDir: args?.workspaceDir, title: args?.title, body: String(args?.body ?? '') })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('notesWrite')
  notesWrite(args: { workspaceDir?: string; noteId: string; body: string }): unknown {
    try {
      return this.notesService().writeNote({ workspaceDir: args?.workspaceDir, noteId: String(args?.noteId ?? ''), body: String(args?.body ?? '') })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('notesDelete')
  notesDelete(args: { workspaceDir?: string; noteId: string }): { ok: boolean; error?: string } {
    try {
      return this.notesService().deleteNote({ workspaceDir: args?.workspaceDir, noteId: String(args?.noteId ?? '') })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('notesSearch')
  notesSearch(args: { workspaceDir?: string; query: string; limit?: number; noteIds?: string[] }): unknown {
    try {
      return this.notesService().searchIndex({
        workspaceDir: args?.workspaceDir,
        query: String(args?.query ?? ''),
        limit: args?.limit,
        noteIds: args?.noteIds,
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('notesRebuildIndex')
  notesRebuildIndex(args: { workspaceDir?: string; noteIds?: string[] }): { ok: boolean; indexed: number; error?: string } {
    try {
      return this.notesService().rebuildIndex({ workspaceDir: args?.workspaceDir, noteIds: args?.noteIds })
    } catch (error) {
      return { ok: false, indexed: 0, error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('notesClearIndex')
  notesClearIndex(args: { workspaceDir?: string }): { ok: boolean; error?: string } {
    try {
      return this.notesService().clearIndex({ workspaceDir: args?.workspaceDir })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('notesBackgroundRead')
  notesBackgroundRead(args: { workspaceDir?: string; kind: string }): unknown {
    try {
      return this.notesService().readBackgroundDoc({ workspaceDir: args?.workspaceDir, kind: String(args?.kind ?? '') as never })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('notesBackgroundReadAll')
  notesBackgroundReadAll(args: { workspaceDir?: string }): unknown {
    try {
      return this.notesService().readAllBackgroundDocs({ workspaceDir: args?.workspaceDir })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('notesBackgroundWrite')
  notesBackgroundWrite(args: { workspaceDir?: string; kind: string; content: string }): { ok: boolean; fileName?: string; error?: string } {
    try {
      return this.notesService().writeBackgroundDoc({ workspaceDir: args?.workspaceDir, kind: String(args?.kind ?? '') as never, content: String(args?.content ?? '') })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('notesDraftUpdate')
  notesDraftUpdate(args: { workspaceDir?: string; kind: string; draft: string; note?: string }): unknown {
    try {
      return this.notesService().updateDraft({ workspaceDir: args?.workspaceDir, kind: String(args?.kind ?? '') as never, draft: String(args?.draft ?? ''), note: args?.note })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('notesDraftList')
  notesDraftList(args: { workspaceDir?: string; kind?: string }): unknown {
    try {
      return this.notesService().listDrafts({ workspaceDir: args?.workspaceDir, kind: args?.kind as never })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('notesDraftRead')
  notesDraftRead(args: { workspaceDir?: string; draftId: string }): unknown {
    try {
      return this.notesService().readDraft({ workspaceDir: args?.workspaceDir, draftId: String(args?.draftId ?? '') })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('notesDraftApply')
  notesDraftApply(args: { workspaceDir?: string; draftId: string; force?: boolean }): { ok: boolean; target?: string; conflict?: boolean; error?: string } {
    try {
      return this.notesService().applyDraft({ workspaceDir: args?.workspaceDir, draftId: String(args?.draftId ?? ''), force: args?.force === true })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('notesDraftDiscard')
  notesDraftDiscard(args: { workspaceDir?: string; draftId: string }): { ok: boolean; error?: string } {
    try {
      return this.notesService().discardDraft({ workspaceDir: args?.workspaceDir, draftId: String(args?.draftId ?? '') })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ── 自进化（EVO/SCI；P1，t41 片段）────────────────────────────────────────

  private evoRuntime(): NonNullable<HostServices['evo']> {
    const evo = this.services.evo
    if (evo === undefined) throw new Error('evo 运行时未接线')
    return evo
  }

  @Remote('evolutionSignalsList')
  evolutionSignalsList(args: { types?: EvolutionSignalType[]; since?: number; limit?: number }): EvolutionSignal[] {
    return this.evoRuntime().signals.listSignals({ types: args?.types, since: args?.since, limit: args?.limit })
  }

  @Remote('evolutionWeaknessesMarkdown')
  evolutionWeaknessesMarkdown(): string {
    return weaknessMarkdown(aggregateWeaknesses(this.evoRuntime().signals.listSignals()))
  }

  @Remote('evolutionCandidatesList')
  evolutionCandidatesList(args: { status?: CandidateStatus }): EvolutionCandidate[] {
    return this.evoRuntime().registry.listCandidates(args?.status)
  }

  @Remote('evolutionCandidatePropose')
  evolutionCandidatePropose(args: { component: string; description: string; diff: string; content?: string }): EvolutionCandidate {
    return this.evoRuntime().registry.propose({
      component: String(args?.component ?? ''),
      description: String(args?.description ?? ''),
      diff: String(args?.diff ?? ''),
      content: args?.content,
    })
  }

  @Remote('evolutionCandidateEvaluate')
  async evolutionCandidateEvaluate(args: { candidateId: string; samples: EvaluationSample[] }): Promise<EvaluationResult> {
    return evaluateCandidate(this.evoRuntime().registry, String(args?.candidateId ?? ''), args?.samples ?? [])
  }

  @Remote('evolutionCandidateActivate')
  evolutionCandidateActivate(args: { candidateId: string }): { ok: boolean; previousVersion?: number } {
    try {
      const registry = this.evoRuntime().registry
      const candidate = registry.getCandidate(String(args?.candidateId ?? ''))
      if (!candidate) return { ok: false }
      const previousVersion = registry.currentVersion(candidate.component)
      registry.activate(String(args?.candidateId ?? ''))
      return { ok: true, previousVersion }
    } catch {
      return { ok: false }
    }
  }

  @Remote('evolutionCandidateRollback')
  evolutionCandidateRollback(args: { candidateId: string }): { ok: boolean } {
    try {
      return { ok: this.evoRuntime().registry.rollback(String(args?.candidateId ?? '')) }
    } catch {
      return { ok: false }
    }
  }

  @Remote('evolutionCandidateReject')
  evolutionCandidateReject(args: { candidateId: string }): { ok: boolean } {
    try {
      return { ok: this.evoRuntime().registry.reject(String(args?.candidateId ?? '')) }
    } catch {
      return { ok: false }
    }
  }

  @Remote('autoskillsGenerateFromTraces')
  autoskillsGenerateFromTraces(args: { texts?: string[]; minOccurrences?: number; workspaceDir?: string }): { created: number } {
    return {
      created: this.services.autoskills.generateFromTraces({
        texts: args?.texts,
        minOccurrences: args?.minOccurrences,
        workspaceDir: args?.workspaceDir,
      }),
    }
  }

  @Remote('autoskillsUpdateProposalContent')
  autoskillsUpdateProposalContent(args: { proposalId: string; content: string }): { ok: boolean } {
    return { ok: this.services.autoskills.updateProposalContent(String(args?.proposalId ?? ''), String(args?.content ?? '')) }
  }

  @Remote('autoskillsRunSkill')
  async autoskillsRunSkill(args: { proposalId: string }): Promise<SkillRunResult> {
    return this.services.autoskills.runSkill(String(args?.proposalId ?? ''))
  }

  /**
   * 为新项目/子聊天判断一个短标题。
   *
   * 低信息输入（问候、确认、单字短句）不强行命名；调用方会继续收集后续
   * 输入，最多第 10 次调用时由这里给出确定性兜底标题。
   */
  @Remote('projectTitleSuggest')
  async projectTitleSuggest(args: { inputs?: string[]; kind?: 'project' | 'subchat'; attempt?: number }): Promise<{ title: string | null; final: boolean }> {
    const kind = args.kind === 'subchat' ? 'subchat' : 'project'
    const inputs = (Array.isArray(args.inputs) ? args.inputs : [])
      .filter((text): text is string => typeof text === 'string')
      .map((text) => text.trim())
      .filter((text) => text !== '')
      .slice(0, 10)
    const attempt = Math.min(10, Math.max(1, Math.floor(args.attempt ?? inputs.length ?? 1)))
    const meaningful = inputs.filter((text) => !isLowInformationInput(text))
    const fallback = kind === 'subchat' ? '未命名研究子对话' : '未命名科研项目'
    if (meaningful.length === 0 && attempt < 10) return { title: null, final: false }

    try {
      const selection = (this.hostCtx.get('agentDefaultModel') as { currentSelection?(): { provider?: string; model?: string } } | undefined)?.currentSelection?.()
      const configured = this.services.memory.config.auxiliaryModel
      const model = selection?.provider && selection?.model
        ? { provider: selection.provider, model: selection.model }
        : configured?.provider && configured?.model
          ? { provider: configured.provider, model: configured.model }
          : { provider: 'new-api', model: 'deepseek-v4-flash' }
      const value = await callJson(this.hostCtx, {
        provider: model.provider,
        model: model.model,
        messages: [
          `请根据下面按时间顺序的用户输入，为一个科研${kind === 'subchat' ? '子对话' : '项目'}生成标题。\n${inputs.map((text, index) => `${index + 1}. ${text.slice(0, 500)}`).join('\n')}`,
        ],
        // 推理型模型需要给足预算：思考过程会先消耗 token，太小会导致正文为空。
        maxTokens: 400,
        jsonInstruction: `输出 JSON：{"title":"短标题"}。只有当输入包含明确的研究主题、具体任务或研究目标时才生成标题；如果输入只是问候、询问助手能做什么、功能介绍、闲聊、感谢确认或信息不足，输出 {"title":null}。标题使用用户主要语言，简洁、具体、能概括研究主题，不要带引号、序号、Markdown 或解释。`,
      })
      const candidate = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).title : undefined
      if (typeof candidate === 'string') {
        const title = candidate.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^['"“”]+|['"“”]+$/g, '').slice(0, 80)
        if (title !== '' && !isLowInformationInput(title)) return { title, final: true }
      }
    } catch {
      // 辅助标题失败不影响实际对话；第 10 次由下方兜底保证有标题。
    }
    if (attempt >= 10) {
      // 只允许「有意义输入」作为兜底标题；全是问候/能力询问时给通用占位名。
      const seed = meaningful[0] ?? ''
      const compact = seed.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28)
      return { title: compact !== '' ? compact : fallback, final: true }
    }
    return { title: null, final: false }
  }

  /** 从当前聊天的具体消息创建分支（CG-UX-01/02）：目标节点与 fork 一起建立。 */
  @Remote('graphForkFromMessage')
  async graphForkFromMessage(args: { workspaceDir?: string; sourceSessionId: string; sourceEventSeq: number }): Promise<{ ok: boolean; sessionId?: string; nodeId?: string; error?: string; rev?: number }> {
    try {
      const name = this.graphProjectOf(args)
      const graph = this.services.chatGraph.get(name)
      let source = graph.nodes.find((node) => node.type === 'chat' && node.sessionId === args.sourceSessionId)
      // 从消息分支是主聊天区入口，不要求用户事先打开图；首次使用时
      // 自动把当前会话加入研究地图，之后仍复用同一个稳定节点。
      if (source === undefined) {
        source = this.services.chatGraph.addNode(name, {
          type: 'chat',
          title: '当前聊天',
          x: 48,
          y: 48,
          sessionId: args.sourceSessionId,
          workspaceDir: args.workspaceDir,
          origin: 'user',
        })
      }
      const target = this.services.chatGraph.addNode(name, {
        type: 'chat',
        title: '从消息分出的新方向',
        x: source.x + 240,
        y: source.y + 96,
        workspaceDir: args.workspaceDir,
      })
      const result = await this.graphInherit({
        workspaceDir: args.workspaceDir,
        fromNodeId: source.id,
        toNodeId: target.id,
        sourceEventSeq: args.sourceEventSeq,
      })
      if (!result.ok) {
        const current = this.services.chatGraph.get(name)
        this.services.chatGraph.save(name, {
          ...current,
          nodes: current.nodes.filter((node) => node.id !== target.id),
          edges: current.edges.filter((edge) => edge.from !== target.id && edge.to !== target.id),
        })
        return { ok: false, error: result.error }
      }
      return { ok: true, sessionId: result.sessionId, nodeId: target.id, rev: result.rev }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('graphMigrate')
  graphMigrate(args: { workspaceDir?: string }): unknown {
    try {
      const name = this.graphProjectOf(args)
      const result = this.services.chatGraph.migrate(name)
      return { ok: true, graph: result.graph, report: result.report, rev: this.services.chatGraph.rev(name) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 新建空白 Markdown Memory，不复用图中已有 locator。 */
  @Remote('graphMemoryCreate')
  graphMemoryCreate(args: { workspaceDir?: string; title?: string; scope?: 'project' | 'global'; x?: number; y?: number }): unknown {
    try {
      const name = this.graphProjectOf(args)
      const node = this.services.chatGraph.createBlankMemory(name, args.workspaceDir, {
        title: args.title, scope: args.scope, x: args.x, y: args.y,
      })
      return { ok: true, node, rev: this.services.chatGraph.rev(name) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 复制 Memory 正文/链接到独立 Markdown 文件，之后不联动。 */
  @Remote('graphMemoryCopy')
  graphMemoryCopy(args: { workspaceDir?: string; nodeId: string; title?: string; x?: number; y?: number }): unknown {
    try {
      const name = this.graphProjectOf(args)
      const node = this.services.chatGraph.copyMemory(name, String(args.nodeId ?? ''), args.workspaceDir, {
        title: args.title, x: args.x, y: args.y,
      })
      return { ok: true, node, rev: this.services.chatGraph.rev(name) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 新建逻辑 Memory Collection；图中仍保持唯一节点。 */
  @Remote('graphMemoryCollection')
  graphMemoryCollection(args: { workspaceDir?: string; title?: string; scope?: 'project' | 'global'; x?: number; y?: number }): unknown {
    try {
      const name = this.graphProjectOf(args)
      const node = this.services.chatGraph.createMemoryCollection(name, args.workspaceDir, {
        title: args.title, scope: args.scope, x: args.x, y: args.y,
      })
      return { ok: true, node, rev: this.services.chatGraph.rev(name) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Explicit editor path for a referenced or legacy Memory node. */
  @Remote('graphMemoryWrite')
  graphMemoryWrite(args: { workspaceDir?: string; nodeId: string; content: string; operationId?: string }): unknown {
    try {
      const name = this.graphProjectOf(args)
      return this.services.chatGraph.applyOperation(args.operationId, () => ({
        ...this.services.chatGraph.writeMemory(name, String(args.nodeId ?? ''), args.workspaceDir, String(args.content ?? '')),
        rev: this.services.chatGraph.rev(name),
      }))
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ── RA / EA / EMA → Chat Graph（CG-AUTO / CG-INTEG）──────────────────────

  @Remote('scienceRaCandidateAdd')
  scienceRaCandidateAdd(args: Parameters<ScienceChatGraphBridge['raCandidateAdd']>[0]): unknown {
    try { return this.services.scienceGraphBridge?.raCandidateAdd(args) ?? { ok: false, error: 'science graph bridge 不可用' } }
    catch (error) { return { ok: false, error: this.errMessage(error) } }
  }

  @Remote('scienceCandidateAccept')
  async scienceCandidateAccept(args: Parameters<ScienceChatGraphBridge['candidateAccept']>[0]): Promise<unknown> {
    try { return this.services.scienceGraphBridge ? await this.services.scienceGraphBridge.candidateAccept(args) : { ok: false, error: 'science graph bridge 不可用' } }
    catch (error) { return { ok: false, error: this.errMessage(error) } }
  }

  @Remote('scienceEaAttemptAdd')
  scienceEaAttemptAdd(args: Parameters<ScienceChatGraphBridge['eaAttemptAdd']>[0]): unknown {
    try { return this.services.scienceGraphBridge?.eaAttemptAdd(args) ?? { ok: false, error: 'science graph bridge 不可用' } }
    catch (error) { return { ok: false, error: this.errMessage(error) } }
  }

  @Remote('scienceEmaCandidateRecord')
  scienceEmaCandidateRecord(args: Parameters<ScienceChatGraphBridge['emaCandidateRecord']>[0]): unknown {
    try { return this.services.scienceGraphBridge?.emaCandidateRecord(args) ?? { ok: false, error: 'science graph bridge 不可用' } }
    catch (error) { return { ok: false, error: this.errMessage(error) } }
  }

  // ── 科学自演化循环（SCI-08/09）───────────────────────────────────────────

  @Remote('scienceLoopCreate')
  scienceLoopCreate(args: {
    kind: 'idea-explore' | 'experiment-try'
    title: string
    authorizedBy: string
    budget?: { maxSteps?: number }
    steps?: Array<{ label: string; appendTo?: { kind: 'graph-node' | 'experiment'; ref: string } }>
    reportTo?: string
    workspaceDir?: string
  }): ScienceLoop | { error: string } {
    try {
      const service = this.services.scienceLoops
      if (!service) return { error: 'scienceLoops 服务不可用' }
      if (String(args?.authorizedBy ?? '').trim() === '') return { error: '自动循环必须记录用户授权者' }
      return service.create({
        kind: args.kind,
        title: String(args.title ?? ''),
        authorizedBy: String(args.authorizedBy),
        budget: args.budget,
        steps: args.steps,
        reportTo: args.reportTo,
        workspaceDir: args.workspaceDir,
      })
    } catch (error) { return { error: this.errMessage(error) } }
  }

  @Remote('scienceLoopList')
  scienceLoopList(): ScienceLoop[] | { error: string } {
    try { return this.services.scienceLoops?.list() ?? [] }
    catch (error) { return { error: this.errMessage(error) } }
  }

  @Remote('scienceLoopGet')
  scienceLoopGet(args: { loopId: string }): ScienceLoop | null | { error: string } {
    try { return this.services.scienceLoops?.get(String(args?.loopId ?? '')) ?? null }
    catch (error) { return { error: this.errMessage(error) } }
  }

  @Remote('scienceLoopRun')
  async scienceLoopRun(args: { loopId: string }): Promise<ScienceLoop | { error: string }> {
    try {
      const service = this.services.scienceLoops
      if (!service) return { error: 'scienceLoops 服务不可用' }
      return await service.run(String(args?.loopId ?? ''))
    } catch (error) { return { error: this.errMessage(error) } }
  }

  @Remote('scienceLoopPause')
  scienceLoopPause(args: { loopId: string }): ScienceLoop | null | { error: string } {
    try { return this.services.scienceLoops?.pause(String(args?.loopId ?? '')) ?? null }
    catch (error) { return { error: this.errMessage(error) } }
  }

  @Remote('scienceLoopResume')
  async scienceLoopResume(args: { loopId: string }): Promise<ScienceLoop | { error: string }> {
    try {
      const service = this.services.scienceLoops
      if (!service) return { error: 'scienceLoops 服务不可用' }
      return await service.resume(String(args?.loopId ?? ''))
    } catch (error) { return { error: this.errMessage(error) } }
  }

  @Remote('scienceLoopCancel')
  async scienceLoopCancel(args: { loopId: string }): Promise<ScienceLoop | null | { error: string }> {
    try {
      const service = this.services.scienceLoops
      if (!service) return { error: 'scienceLoops 服务不可用' }
      return (await service.cancel(String(args?.loopId ?? ''))) ?? null
    } catch (error) { return { error: this.errMessage(error) } }
  }

  @Remote('scienceLoopTransition')
  scienceLoopTransition(args: { loopId: string; action: ScienceLoopAction; stepId?: string; output?: string; error?: string }): ScienceLoop | null | { error: string } {
    try {
      const service = this.services.scienceLoops
      if (!service) return { error: 'scienceLoops 服务不可用' }
      return service.transition(String(args?.loopId ?? ''), args.action, args.stepId, { output: args.output, error: args.error }) ?? null
    } catch (error) { return { error: this.errMessage(error) } }
  }

  @Remote('graphUpdateNode')
  graphUpdateNode(args: { workspaceDir?: string; nodeId: string; patch: unknown; operationId?: string }): unknown {
    try {
      const name = this.graphProjectOf(args)
      return this.services.chatGraph.applyOperation(args.operationId, () => ({
        ...this.services.chatGraph.updateNode(name, String(args.nodeId ?? ''), (args.patch ?? {}) as Partial<Omit<GraphNode, 'id'>>),
        rev: this.services.chatGraph.rev(name),
      }))
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('graphRemoveNode')
  graphRemoveNode(args: { workspaceDir?: string; nodeId: string; operationId?: string }): unknown {
    try {
      const name = this.graphProjectOf(args)
      return this.services.chatGraph.applyOperation(args.operationId, () => ({
        ...this.services.chatGraph.removeNode(name, String(args.nodeId ?? '')),
        rev: this.services.chatGraph.rev(name),
      }))
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('graphUpdateEdge')
  graphUpdateEdge(args: { workspaceDir?: string; edgeId: string; patch: unknown; operationId?: string }): unknown {
    try {
      const name = this.graphProjectOf(args)
      return this.services.chatGraph.applyOperation(args.operationId, () => ({
        ...this.services.chatGraph.updateEdge(name, String(args.edgeId ?? ''), (args.patch ?? {}) as Partial<Omit<GraphEdge, 'id' | 'from' | 'to'>>),
        rev: this.services.chatGraph.rev(name),
      }))
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('graphRemoveEdge')
  graphRemoveEdge(args: { workspaceDir?: string; edgeId: string; operationId?: string }): unknown {
    try {
      const name = this.graphProjectOf(args)
      return this.services.chatGraph.applyOperation(args.operationId, () => ({
        ...this.services.chatGraph.removeEdge(name, String(args.edgeId ?? '')),
        rev: this.services.chatGraph.rev(name),
      }))
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('graphMoveNodes')
  graphMoveNodes(args: { workspaceDir?: string; positions: unknown; operationId?: string }): unknown {
    try {
      const name = this.graphProjectOf(args)
      const positions = Array.isArray(args.positions) ? args.positions.filter((item): item is { id: string; x: number; y: number; pinned?: boolean } => {
        const value = item as Record<string, unknown>
        return typeof value.id === 'string' && typeof value.x === 'number' && typeof value.y === 'number'
      }) : []
      return this.services.chatGraph.applyOperation(args.operationId, () => ({
        ...this.services.chatGraph.moveNodes(name, positions),
        rev: this.services.chatGraph.rev(name),
      }))
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('graphAddGroup')
  graphAddGroup(args: { workspaceDir?: string; group: unknown; operationId?: string }): unknown {
    try {
      const name = this.graphProjectOf(args)
      return this.services.chatGraph.applyOperation(args.operationId, () => ({
        ...this.services.chatGraph.addGroup(name, args.group as GraphGroup),
        rev: this.services.chatGraph.rev(name),
      }))
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('graphUpdateGroup')
  graphUpdateGroup(args: { workspaceDir?: string; groupId: string; patch: unknown; operationId?: string }): unknown {
    try {
      const name = this.graphProjectOf(args)
      return this.services.chatGraph.applyOperation(args.operationId, () => ({
        ...this.services.chatGraph.updateGroup(name, String(args.groupId ?? ''), args.patch as Partial<Omit<GraphGroup, 'id'>>),
        rev: this.services.chatGraph.rev(name),
      }))
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('graphRemoveGroup')
  graphRemoveGroup(args: { workspaceDir?: string; groupId: string; operationId?: string }): unknown {
    try {
      const name = this.graphProjectOf(args)
      return this.services.chatGraph.applyOperation(args.operationId, () => ({
        ...this.services.chatGraph.removeGroup(name, String(args.groupId ?? '')),
        rev: this.services.chatGraph.rev(name),
      }))
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('autoskillsInstallGit')
  autoskillsInstallGit(args: { source: string; name?: string }): unknown {
    return this.services.autoskills.installFromGit(String(args?.source ?? ''), args?.name)
  }

  // ── CTX 窗口保护层与组装器（P2，t42 片段）────────────────────────────────

  private errMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  /** 按 sessionId 解析活动会话（detectPressure 需要会话对象而非 id）。 */
  private sessionOf(sessionId: string): PressureSessionLike | undefined {
    if (sessionId === '') return undefined
    const sessions = this.hostCtx.get('sessions') as { get?: (id: string) => unknown } | undefined
    const getSession = sessions?.get
    if (getSession === undefined) return undefined
    return getSession.call(sessions, sessionId) as PressureSessionLike | undefined
  }

  @Remote('contextStatus')
  contextStatus(): unknown {
    try {
      const runtime = this.services.contextRuntime
      if (runtime !== undefined) return runtime.status()
      const guard = this.services.contextGuard
      if (guard === undefined) return { error: 'contextGuard 服务不可用' }
      return guard.status()
    } catch (error) {
      return { error: this.errMessage(error) }
    }
  }

  @Remote('contextPressure')
  contextPressure(args: { sessionId: string; model?: string }): PressureReport | { error: string } {
    try {
      const guard = this.services.contextGuard
      if (guard === undefined) return { error: 'contextGuard 服务不可用' }
      const session = this.sessionOf(String(args?.sessionId ?? ''))
      if (session === undefined) return { error: `会话不存在: ${String(args?.sessionId ?? '')}` }
      return guard.detectPressure(session, args?.model)
    } catch (error) {
      return { error: this.errMessage(error) }
    }
  }

  @Remote('contextCompactions')
  contextCompactions(args: CompactionQuery = {}): readonly CompactionRecord[] | { error: string } {
    try {
      const guard = this.services.contextGuard
      if (guard === undefined) return { error: 'contextGuard 服务不可用' }
      return guard.queryCompactions(args ?? {})
    } catch (error) {
      return { error: this.errMessage(error) }
    }
  }

  @Remote('contextSources')
  async contextSources(args: { sessionId: string; graphConnections?: readonly GraphConnectionInfo[] }): Promise<ContextSourceReport | { error: string }> {
    try {
      const guard = this.services.contextGuard
      if (guard === undefined) return { error: 'contextGuard 服务不可用' }
      return await guard.queryContextSources(String(args?.sessionId ?? ''), {
        graphConnections: args?.graphConnections,
      })
    } catch (error) {
      return { error: this.errMessage(error) }
    }
  }

  @Remote('contextRepairs')
  contextRepairs(args: { sessionId?: string } = {}): readonly unknown[] | { error: string } {
    try {
      const guard = this.services.contextGuard
      if (guard === undefined) return { error: 'contextGuard 服务不可用' }
      return guard.repairRecords(args?.sessionId)
    } catch (error) {
      return { error: this.errMessage(error) }
    }
  }

  @Remote('contextPreview')
  async contextPreview(args: AssembleInput): Promise<ReferencePreview | { error: string }> {
    try {
      const assembler = this.services.contextAssembler
      if (assembler === undefined) return { error: 'contextAssembler 服务不可用' }
      return await assembler.preview(args)
    } catch (error) {
      return { error: this.errMessage(error) }
    }
  }

  @Remote('contextAssemble')
  async contextAssemble(args: AssembleInput): Promise<AssemblyResult | { error: string }> {
    try {
      const assembler = this.services.contextAssembler
      if (assembler === undefined) return { error: 'contextAssembler 服务不可用' }
      return await assembler.assemble(args)
    } catch (error) {
      return { error: this.errMessage(error) }
    }
  }

  /** PLAT-07：读取会话当前/被压缩/仅日志事件，支持 bounded read。 */
  @Remote('contextProjection')
  async contextProjection(args: { sessionId: string; projection?: ProjectionQueryOptions['projection']; bounded?: ProjectionQueryOptions['bounded'] }): Promise<ProjectionQueryResult | { error: string }> {
    try {
      const runtime = this.services.contextRuntime
      if (runtime === undefined) return { error: 'contextRuntime 服务不可用' }
      return await runtime.queryProjection(String(args?.sessionId ?? ''), {
        projection: args?.projection,
        bounded: args?.bounded,
      })
    } catch (error) {
      return { error: this.errMessage(error) }
    }
  }

  /** PLAT-07：读取 fork/parentSession 谱系。 */
  @Remote('contextLineage')
  async contextLineage(args: { sessionId: string }): Promise<LineageResult | { error: string }> {
    try {
      const runtime = this.services.contextRuntime
      if (runtime === undefined) return { error: 'contextRuntime 服务不可用' }
      return await runtime.queryLineage(String(args?.sessionId ?? ''))
    } catch (error) {
      return { error: this.errMessage(error) }
    }
  }

  /** PLAT-04：读取工具结果裁剪归档索引，作为继续读取入口。 */
  @Remote('contextPrunes')
  contextPrunes(args: { sessionId?: string }): unknown {
    const runtime = this.services.contextRuntime
    if (runtime === undefined) return { error: 'contextRuntime 服务不可用' }
    return runtime.pruneRecords(args?.sessionId)
  }

  @Remote('contextAssembleDeep')
  async contextAssembleDeep(args: AssembleInput): Promise<AssemblyResult | { error: string }> {
    try {
      const assembler = this.services.contextAssembler
      if (assembler === undefined) return { error: 'contextAssembler 服务不可用' }
      return await assembler.assembleDeep(args)
    } catch (error) {
      return { error: this.errMessage(error) }
    }
  }

  @Remote('contextEffects')
  contextEffects(args: EffectQuery = {}): readonly EffectSignalRecord[] | { error: string } {
    try {
      const assembler = this.services.contextAssembler
      if (assembler === undefined) return { error: 'contextAssembler 服务不可用' }
      return assembler.queryEffects(args ?? {})
    } catch (error) {
      return { error: this.errMessage(error) }
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

  @Remote('expertsContext')
  expertsContext(args: { workspaceDir?: string; maxChars?: number }): unknown {
    return this.services.experts.agentsContext(args?.workspaceDir, args?.maxChars)
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

  // ── 平台能力层（PLAT-13..20，t19 交付） ───────────────────────────────────

  // ── PLAT-13：模型 Fallback selector ────────────────────────────────────────

  @Remote('modelsSelectorState')
  modelsSelectorState(): FallbackState | { error: string } {
    const state = this.services.platform?.modelFallbackState
    if (!state) return { error: 'platform.services 未接线' }
    return state
  }

  @Remote('modelsSelectorReset')
  modelsSelectorReset(): FallbackState | { error: string } {
    const reset = this.services.platform?.recordModelSuccess
    if (!reset) return { error: 'platform.services 未接线' }
    // 用 current() 当作 route 重置当前路由——若 current 为空则返回空状态
    const adapters = this.hostCtx.get('agentDefaultModel') as { currentSelection?(): { provider: string; model: string } } | undefined
    const current = adapters?.currentSelection?.()
    if (!current) return emptyFallbackState()
    return reset({ provider: current.provider, model: current.model })
  }

  @Remote('modelsSelectRoute')
  modelsSelectRoute(args: { primary: ModelRoute; fallbacks?: ModelRoute[]; maxRetriesPerRoute?: number }): { ok: boolean; route: ModelRoute | null; error?: string } {
    const selector = this.services.platform?.selectModelRoute
    if (!selector) return { ok: false, route: null, error: 'platform.services 未接线' }
    const route = selector({ primary: args.primary, fallbacks: args.fallbacks }, { maxRetriesPerRoute: args.maxRetriesPerRoute })
    return { ok: true, route }
  }

  // ── PLAT-14：per-turn 自适应工具选择 ─────────────────────────────────────

  @Remote('toolsSelectForTurn')
  toolsSelectForTurn(args: { tools: ToolDef[]; query: string; required?: string[]; maxTools?: number }): { tools: ToolDef[]; whitelisted: number } {
    const selector = this.services.platform?.selectToolsForTurn
    if (!selector) {
      // 兜底：原样返回，标记无白名单
      return { tools: args.tools, whitelisted: 0 }
    }
    const selected = selector(args.tools, args.query, { required: args.required, maxTools: args.maxTools })
    return { tools: selected, whitelisted: BASE_TOOL_WHITELIST.length }
  }

  @Remote('toolsWhitelist')
  toolsWhitelist(): readonly string[] {
    return BASE_TOOL_WHITELIST
  }

  // ── PLAT-15：统一审批与危险操作策略 ───────────────────────────────────────

  @Remote('approvalDecide')
  approvalDecide(args: { toolName: string }): ApprovalDecision | { error: string } {
    const policy = this.services.platform?.approvalPolicy
    const decider = this.services.platform?.decideApproval
    if (!policy || !decider) return { error: 'platform.services 未接线' }
    return decider(args.toolName)
  }

  @Remote('approvalPolicyGet')
  approvalPolicyGet(): ApprovalPolicy | { error: string } {
    const policy = this.services.platform?.approvalPolicy
    if (!policy) return { error: 'platform.services 未接线' }
    return policy
  }

  @Remote('approvalPolicyDefault')
  approvalPolicyDefault(): ApprovalPolicy {
    return defaultApprovalPolicy()
  }

  @Remote('approvalPolicyValidate')
  approvalPolicyValidate(args: { policy: ApprovalPolicy }): { ok: boolean; error?: string } {
    return validateApprovalPolicy(args.policy)
  }

  // ── PLAT-17：自然语言调度器 ───────────────────────────────────────────────

  @Remote('schedulerAddNatural')
  schedulerAddNatural(args: { text: string; prompt: string; workspaceDir?: string; name?: string }): ScheduledTask | { error: string } {
    try {
      return this.services.scheduler.addNatural({
        text: args.text,
        prompt: args.prompt,
        workspaceDir: args.workspaceDir ?? '',
        name: args.name,
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('schedulerPause')
  schedulerPause(args: { taskId: string }): { ok: boolean } {
    return { ok: this.services.scheduler.pause(args.taskId) }
  }

  @Remote('schedulerResume')
  schedulerResume(args: { taskId: string }): { ok: boolean } {
    return { ok: this.services.scheduler.resume(args.taskId) }
  }

  // ── PLAT-16/19：子代理运行时 ─────────────────────────────────────────────

  @Remote('subagentsProviders')
  subagentsProviders(): string[] | { error: string } {
    const providers = this.services.platform?.subagents?.providers
    if (!providers) return { error: 'platform.subagents 未接线' }
    return providers.list()
  }

  @Remote('subagentsList')
  subagentsList(args: { parentSessionId?: string }): SubagentRecord[] | { error: string } {
    const registry = this.services.platform?.subagents?.registry
    if (!registry) return { error: 'platform.subagents 未接线' }
    return registry.list(args.parentSessionId)
  }

  @Remote('subagentsDescendants')
  subagentsDescendants(args: { rootSessionId: string }): SubagentRecord[] | { error: string } {
    const registry = this.services.platform?.subagents?.registry
    if (!registry) return { error: 'platform.subagents 未接线' }
    return registry.descendants(args.rootSessionId)
  }

  @Remote('subagentsCreate')
  async subagentsCreate(args: SubagentCreateRequest): Promise<{ ok: boolean; subagentId?: string; error?: string }> {
    const facade = this.services.platform?.subagents?.facade
    if (!facade) return { ok: false, error: 'platform.subagents 未接线' }
    const result = await facade.create(args)
    if (!result.ok || !result.record) return { ok: false, error: result.error }
    return { ok: true, subagentId: result.record.subagentId }
  }

  @Remote('subagentsContinue')
  async subagentsContinue(args: { subagentId: string; message: string }): Promise<SubagentOpResult | { error: string }> {
    const facade = this.services.platform?.subagents?.facade
    if (!facade) return { error: 'platform.subagents 未接线' }
    return facade.continue(args.subagentId, args.message)
  }

  @Remote('subagentsInterrupt')
  async subagentsInterrupt(args: { subagentId: string }): Promise<SubagentOpResult | { error: string }> {
    const facade = this.services.platform?.subagents?.facade
    if (!facade) return { error: 'platform.subagents 未接线' }
    return facade.interrupt(args.subagentId)
  }

  @Remote('subagentsReport')
  async subagentsReport(args: { subagentId: string }): Promise<SubagentOpResult | { error: string }> {
    const facade = this.services.platform?.subagents?.facade
    if (!facade) return { error: 'platform.subagents 未接线' }
    return facade.report(args.subagentId)
  }

  @Remote('subagentsCancel')
  async subagentsCancel(args: { subagentId: string }): Promise<SubagentOpResult | { error: string }> {
    const facade = this.services.platform?.subagents?.facade
    if (!facade) return { error: 'platform.subagents 未接线' }
    return facade.cancel(args.subagentId)
  }

  // ── PLAT-20：会话诊断导出 ──────────────────────────────────────────────────

  @Remote('diagnosticsExport')
  async diagnosticsExport(args: { sessionId: string }): Promise<SessionDiagnostics | { error: string }> {
    const sessions = this.hostCtx.get('sessions') as { get?(id: string): { log?: unknown[] } | undefined } | undefined
    const sessionPersistence = this.hostCtx.get('sessionPersistence') as { load?(id: string): Promise<{ events?: unknown[] } | undefined> } | undefined
    let events: unknown[] = []
    if (sessions?.get) {
      const live = sessions.get(args.sessionId)
      if (live && Array.isArray(live.log)) events = live.log
    }
    if (events.length === 0 && sessionPersistence?.load) {
      try {
        const loaded = await sessionPersistence.load(args.sessionId)
        if (loaded && Array.isArray(loaded.events)) events = loaded.events
      } catch { /* 持久化读失败 */ }
    }
    if (events.length === 0) return { error: `会话 ${args.sessionId} 找不到任何事件` }
    return exportSessionDiagnostics(args.sessionId, events as DiagnosticEventLike[])
  }

  // ── PLAT-11/12：MCP supervisor ─────────────────────────────────────────────

  @Remote('mcpServerAdd')
  async mcpServerAdd(args: { config: McpServerConfig }): Promise<McpServerStatus | { error: string }> {
    const mcp = this.services.platform?.mcp
    if (!mcp) return { error: 'platform.mcp 未接线' }
    try {
      const result = mcp.addServer(args.config)
      return result.status
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('mcpServerRemove')
  async mcpServerRemove(args: { serverId: string }): Promise<{ ok: boolean; error?: string }> {
    const mcp = this.services.platform?.mcp
    if (!mcp) return { ok: false, error: 'platform.mcp 未接线' }
    try {
      const ok = await mcp.removeServer(args.serverId)
      return { ok }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('mcpServerList')
  mcpServerList(): McpServerStatus[] | { error: string } {
    const mcp = this.services.platform?.mcp
    if (!mcp) return { error: 'platform.mcp 未接线' }
    return mcp.list()
  }

  @Remote('mcpServerGet')
  mcpServerGet(args: { serverId: string }): McpServerStatus | { error: string } {
    const mcp = this.services.platform?.mcp
    if (!mcp) return { error: 'platform.mcp 未接线' }
    const status = mcp.get(args.serverId)
    return status ?? { error: `MCP 服务器不存在: ${args.serverId}` }
  }

  @Remote('mcpServerStart')
  async mcpServerStart(args: { serverId: string }): Promise<McpServerStatus | { error: string }> {
    const mcp = this.services.platform?.mcp
    if (!mcp) return { error: 'platform.mcp 未接线' }
    try { return await mcp.startServer(args.serverId) }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  }

  @Remote('mcpServerStop')
  async mcpServerStop(args: { serverId: string }): Promise<McpServerStatus | { error: string }> {
    const mcp = this.services.platform?.mcp
    if (!mcp) return { error: 'platform.mcp 未接线' }
    try { return await mcp.stop(args.serverId) }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  }

  @Remote('mcpServerReconnect')
  async mcpServerReconnect(args: { serverId: string }): Promise<McpServerStatus | { error: string }> {
    const mcp = this.services.platform?.mcp
    if (!mcp) return { error: 'platform.mcp 未接线' }
    try { return await mcp.restart(args.serverId) }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  }

  @Remote('mcpServerUpdateConfig')
  async mcpServerUpdateConfig(args: { serverId: string; patch: Partial<Omit<McpServerConfig, 'serverId'>> }): Promise<McpServerStatus | { error: string }> {
    const mcp = this.services.platform?.mcp
    if (!mcp) return { error: 'platform.mcp 未接线' }
    try {
      return await mcp.updateConfig(args.serverId, args.patch)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('mcpServerToolsFor')
  mcpServerToolsFor(args: { agentId?: string }): { name: string; description?: string }[] | { error: string } {
    const mcp = this.services.platform?.mcp
    if (!mcp) return { error: 'platform.mcp 未接线' }
    return mcp.toolsFor(args.agentId)
  }

  // ── PLAT-08/09/10：分层 Skill 注册表 ────────────────────────────────────

  private skillRegistryOf(workspaceDir?: string): LayeredSkillRegistry {
    const registry = this.services.platform?.skillRegistryFor?.(workspaceDir)
      ?? this.services.platform?.skillRegistry
    if (!registry) throw new Error('platform.skillRegistry 未接线')
    return registry
  }

  @Remote('skillsListLayered')
  skillsListLayered(args: { workspaceDir?: string; layer?: SkillLayer }): SkillEntry[] | { error: string } {
    try { return this.skillRegistryOf(args?.workspaceDir).list(args?.layer) }
    catch (error) { return { error: this.errMessage(error) } }
  }

  @Remote('skillsReadLayered')
  skillsReadLayered(args: { workspaceDir?: string; name: string; layer?: SkillLayer }): { entry: SkillEntry; body: string } | { error: string } {
    try {
      const registry = this.skillRegistryOf(args?.workspaceDir)
      const entry = registry.get(String(args?.name ?? ''), args?.layer)
      if (!entry) return { error: `技能不存在: ${String(args?.name ?? '')}` }
      const body = registry.readBody(entry.name, entry.layer)
      if (body === undefined) return { error: `技能正文不可读: ${entry.name}` }
      return { entry, body }
    } catch (error) { return { error: this.errMessage(error) } }
  }

  @Remote('skillsInstallLocal')
  skillsInstallLocal(args: { workspaceDir?: string; layer: SkillLayer; source: string; name?: string }): SkillEntry | { error: string } {
    try { return this.skillRegistryOf(args?.workspaceDir).installFromLocal(args.layer, args.source, { name: args.name }) }
    catch (error) { return { error: this.errMessage(error) } }
  }

  @Remote('skillsInstallGit')
  async skillsInstallGit(args: { workspaceDir?: string; layer: SkillLayer; source: string; name?: string; ref?: string }): Promise<SkillEntry | { error: string }> {
    try { return await this.skillRegistryOf(args?.workspaceDir).installFromGit(args.layer, args.source, { name: args.name, ref: args.ref }) }
    catch (error) { return { error: this.errMessage(error) } }
  }

  @Remote('skillsUninstallLayered')
  skillsUninstallLayered(args: { workspaceDir?: string; layer: SkillLayer; name: string }): { ok: boolean; fallback?: SkillEntry } | { error: string } {
    try { return this.skillRegistryOf(args?.workspaceDir).uninstall(args.name, args.layer) }
    catch (error) { return { error: this.errMessage(error) } }
  }
}
