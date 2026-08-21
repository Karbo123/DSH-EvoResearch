/**
 * EvoResearch Host 插件入口。
 *
 * 组装全部科研能力：
 * - WorkspaceService：科研项目工作区（projects/<name>/.evoresearch-data 隔离）；
 * - MemoryRuntime：科研记忆（Turn Catalog / 记忆包注入 / 检索工具 / Goal Control）；
 * - SchedulerService：定时任务（cron，项目隔离）；
 * - ChannelManager：消息通道（Telegram 等）；
 * - AutoSkillsService / ExpertService：技能蒸馏与专家团队；
 * - EvoResearchApiService：Client 可调用的 Remote API；
 * - 斜杠命令：/project /memory /schedule /channel /expert /autoskills。
 *
 * 配置（settings.yaml 的 evoresearch 段，或环境变量）：
 * ```yaml
 * evoresearch:
 *   dataRoot: D:\evoresearch      # 部署根目录（projects/ 所在目录），默认 $EVORESEARCH_DATA_ROOT 或 cwd
 *   memoryTokenBudget: 6000
 *   auxiliaryModel: { provider: deepseek-official, model: deepseek-v4-flash }
 * ```
 */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { WorkspaceService, type WorkspaceConfig } from './workspace.js'
import { MemoryRuntime, type MemoryConfig } from './memory/index.js'
import { SchedulerService, type SchedulerConfig } from './scheduler.js'
import { ChannelManager } from './channels/index.js'
import { builtinAdapters } from './channels/adapters.js'
import type { ChannelMessage } from './channels/base.js'
import { AutoSkillsService, type AutoSkillsConfig } from './autoskills.js'
import { ChatGraphService } from './chat-graph.js'
import { NotesService } from './notes.js'
import { ExperimentWorkspaceService } from './experiment-workspace.js'
import { ExperimentProcessService } from './experiment-process.js'
import { WorktreeService } from './worktrees.js'
import { ExperimentLedgerService } from './experiment-ledger.js'
import { ExperimentRoundsService } from './experiment-rounds.js'
import { DailyReportService } from './daily-report.js'
import { LibraryIndexer, LibrarySearch } from './library/index.js'
import { ManuscriptService } from './manuscript.js'
import { SignalStore } from './evolution/signals.js'
import { CandidateRegistry } from './evolution/registry.js'
import { ContextRuntime } from './platform/context-runtime.js'
import { ContextAssembler } from './context/assembler.js'
import { callText } from './core/llm.js'
import { ExpertService, type ExpertConfig } from './experts.js'
import { ExperimentService } from './experiments.js'
import { ProjectEnvService } from './project-env.js'
import { RewindService } from './rewind.js'
import { EvoResearchApiService, type HostServices, type PlatformServices } from './api.js'
import { registerCommands } from './commands.js'
import { listProjects, projectNameFromWorkspace } from './core/paths.js'
import { registerVisionTool } from './vision.js'
import { defaultApprovalPolicy, decideUnattendedShell, isUnattendedSource } from './platform/approval-policy.js'
import { markUnattendedSession, isMarkedUnattended } from './platform/unattended-registry.js'
import {
  emptyFallbackState,
  recordFailure,
  recordSuccess,
  selectModel,
} from './platform/models-selector.js'
import { selectToolsForTurn } from './platform/tools-selector.js'
import {
  SubagentRegistry,
  SubagentProviderRegistry,
  SubagentFacade,
} from './platform/subagents.js'
import { McpSupervisor } from './mcp/supervisor.js'
import { LayeredSkillRegistry } from './skills/registry.js'
import { ScienceLoopService, experimentAppender } from './science/loops.js'
import { ScienceChatGraphBridge } from './science/chat-graph-bridge.js'
import { JobHubService } from './jobs.js'
import { registerAskResearcherTool } from './tools/ask.js'
import { OverflowWatch } from './context/overflow-watch.js'
import { registerLibraryTools, type LibraryToolsDeps } from './library/tools.js'
import { FigureService, registerFigureTools } from './figures.js'

/** 插件配置（settings 的 evoresearch 段合并环境变量）。 */
export interface EvoResearchPluginConfig {
  /** 部署根目录。 */
  readonly dataRoot?: string
  readonly memoryTokenBudget?: number
  readonly auxiliaryModel?: { provider: string; model: string }
  /** 启动时自动启动已配置通道（默认 false）。 */
  readonly autoStartChannels?: boolean
  /** 是否启用科研记忆（默认 true）。 */
  readonly memoryEnabled?: boolean
  /** 是否注册 vision_check 视觉检查工具（默认 true；模型未配置时自动跳过）。 */
  readonly visionEnabled?: boolean
  /** P1-1 AutoSkills 定时挖掘 cron（默认 '7 3 * * 1' 每周一凌晨；'off' 关闭）。 */
  readonly autoskillsSchedule?: string
  /** P3-2 无人值守 shell 门控：allow-list 前缀（deny 清单恒生效）。 */
  readonly unattended?: { allowCommands?: string[] }
}

/** 从 settings/env 解析配置。 */
function resolveConfig(ctx: Context): EvoResearchPluginConfig {
  const settings = ctx.get('settings') as { get?: (ns: string) => unknown } | undefined
  const fromSettings = (settings?.get?.('evoresearch') ?? {}) as Partial<EvoResearchPluginConfig>
  const fromEnv: { dataRoot?: string } = {}
  if (process.env.EVORESEARCH_DATA_ROOT) fromEnv.dataRoot = process.env.EVORESEARCH_DATA_ROOT
  return { ...fromEnv, ...fromSettings }
}

/** 把一段文本投递给一个后台 agent 会话（定时任务/通道共用）。 */
export async function deliverToAgent(
  ctx: Context,
  text: string,
  cwd: string,
  source: string,
): Promise<string> {
  const agents = ctx.get('agents')
  if (!agents) throw new Error('agents 服务不可用')
  const handle = await agents.create({
    cwd,
    source,
    initialMessage: text,
  } as never)
  const sessionId = (handle as unknown as { session?: { id?: string } }).session?.id
    ?? (handle as unknown as { id?: string }).id
  if (!sessionId) throw new Error('无法解析新会话 id')
  if (isUnattendedSource(source)) markUnattendedSession(sessionId)
  return sessionId
}

const name = 'evoresearch-host'

const inject = ['commands', 'tools', 'systemPrompt'] as const

function apply(ctx: Context): void {
  const config = resolveConfig(ctx)
  const dataRoot = config.dataRoot ?? process.cwd()
  console.log(`[evoresearch] host 插件激活（dataRoot: ${dataRoot}）`)

  // 1) 科研项目工作区
  const workspaceConfig: WorkspaceConfig = { dataRoot }
  const workspace = new WorkspaceService(workspaceConfig)

  // 2) 科研记忆
  const memoryConfig: MemoryConfig = {
    dataRoot,
    tokenBudget: config.memoryTokenBudget,
    auxiliaryModel: config.auxiliaryModel,
    enabled: config.memoryEnabled ?? true,
  }
  const memory = new MemoryRuntime(memoryConfig)

  // 3) 定时任务
  const schedulerConfig: SchedulerConfig = {
    dataRoot,
    model: config.auxiliaryModel,
  }
  const scheduler = new SchedulerService(schedulerConfig)

  // 4) 通道
  const channels = new ChannelManager(builtinAdapters())
  channels.setDeliver(async (message: ChannelMessage) => {
    const projectName = listProjects(dataRoot)[0]
    const cwd = projectName
      ? path.join(dataRoot, 'projects', projectName)
      : dataRoot
    return deliverToAgent(ctx, `[${message.senderName ?? message.senderId} 经 ${message.chatId} 通道] ${message.text}`, cwd, 'evoresearch:channel')
  })

  // 5) AutoSkills / 专家
  // skillsDir 对齐官方用户全局技能层 <DSH_HOME>/skills（dsh-skill-filesystem 默认根），
  // approve 后的技能立即出现在 Skills Marketplace（§42.6）与官方技能目录。
  const autoskillsConfig: AutoSkillsConfig = { dataRoot, skillsDir: path.join(dataRoot, 'skills') }
  const autoskills = new AutoSkillsService(autoskillsConfig)
  const expertConfig: ExpertConfig = { dataRoot }
  const experts = new ExpertService(expertConfig)

  // 5.2) 后台任务注册表（P0-3）：纯登记，不接管执行；P3-1 删除级联取消的查询入口
  const jobHub = new JobHubService()

  // 5.5) 实验管理（§5.1 Git 式分支/回退/checkpoint）
  const experiments = new ExperimentService(dataRoot)

  // 5.6) 项目环境（每项目独立 UV 虚拟环境）
  const projectEnv = new ProjectEnvService(dataRoot)

  // 5.7) 回溯服务（§回溯：Git 工作区 + 会话截断）
  const rewind = new RewindService(dataRoot)

  // 5.8) Chat Graph（节点/连线图，按项目存储）
  const chatGraph = new ChatGraphService(dataRoot)

  // 5.9) 自由文本研究笔记（§整合：memories/notes 零 frontmatter + 旧 Observation 兼容）
  const notes = new NotesService(dataRoot)
  // NOTE-02：模型写笔记时优先走零 frontmatter 的自由 Markdown；旧 Observation
  // 工具仍由 MemoryRuntime 兼容保留，避免升级时改变既有文件。
  memory.setNotesService(notes)

  // 5.10) 上下文运行时（§整合 P0c/PLAT-03..07）：
  // ContextRuntime 是唯一挂载入口；contextGuard 仅作为兼容 API 的同一实例，
  // 避免同时订阅两次 session/event 或重复写入压缩日志。
  const contextRuntime = new ContextRuntime({
    dataRoot,
    windowConfig: { dataRoot, auxiliaryModel: config.auxiliaryModel },
  })
  const contextGuard = contextRuntime.guard

  // 5.11) 文献索引与稿件写作（§整合 P1：LIB/WRITE）
  const libraryIndexer = new LibraryIndexer({ dataRoot })
  const librarySearch = new LibrarySearch({ dataRoot })
  const manuscript = new ManuscriptService({ dataRoot })

  // 5.12) 实验工作区/进程与 Git worktree（§整合 P1：EXP/ENV）
  const experimentWorkspace = new ExperimentWorkspaceService({ dataRoot })
  const experimentProcess = new ExperimentProcessService({ dataRoot })
  const worktrees = new WorktreeService(dataRoot)
  // Part A/B/C 实验控制台升级（账本 / 回合 / 日报）
  const experimentLedger = new ExperimentLedgerService(dataRoot)
  const experimentRounds = new ExperimentRoundsService({ dataRoot, ledger: experimentLedger })
  const dailyReport = new DailyReportService(dataRoot)
  const scienceLoops = new ScienceLoopService(dataRoot, {
    appenderFor: (loop) => loop.workspaceDir === undefined
      ? { append: () => ({ ok: true }) }
      : experimentAppender(experimentWorkspace, loop.workspaceDir),
  })

  // 5.13) 自进化运行时（§整合 P1：EVO 信号 + 候选注册表）
  const signals = new SignalStore(dataRoot)
  const registry = new CandidateRegistry({
    dataRoot,
    apply: (component, version) => {
      // EVO-06 组件版本副作用注册点：上层模块实现（检索策略/Skill 内容等），
      // 返回 disposer；当前为日志 no-op，激活/回滚生命周期由 registry 管理。
      console.log(`[evoresearch:evolution] 应用候选 ${component} v${version.version}: ${version.description}`)
      return () => {
        console.log(`[evoresearch:evolution] 释放候选 ${component} v${version.version} 副作用`)
      }
    },
  })

  // 5.14) ContextAssembler（§整合 P2：每轮组装 + 压力检查闭环）
  // 关键约束：store 必须按本次 assemble 的 workspaceDir 解析，不能使用一个可变
  // 的“最近工作区”变量，否则并发项目会把上下文检索到另一个数据库。
  const contextAssembler = new ContextAssembler({
    storeFor: (workspaceDir) => memory.storeFor(workspaceDir),
    notes,
    chatGraph,
    llm: { callText: (options) => callText(ctx, options) },
    previewOf: (node, workspaceDir, maxChars) => chatGraph.previewOf(node, workspaceDir, maxChars),
    resourceReader: ({ node, workspaceDir, maxChars }) => {
      const ref = node.ref
      if (ref === undefined) return chatGraph.previewOf(node, workspaceDir, maxChars)
      const base = node.scope === 'global' || workspaceDir === undefined || workspaceDir === dataRoot ? dataRoot : workspaceDir
      const target = ref.kind === 'note'
        ? path.isAbsolute(ref.path) ? path.resolve(ref.path) : path.resolve(base, '.evoresearch-data', 'memories', 'notes', ref.path)
        : path.isAbsolute(ref.path) ? path.resolve(ref.path) : path.resolve(base, ref.path)
      const root = path.resolve(base)
      const rootOk = target === root || target.startsWith(`${root}${path.sep}`) || target.startsWith(`${path.resolve(dataRoot)}${path.sep}`)
      if (!rootOk) return { ok: false, error: '引用资料不在当前工作区内' }
      if (ref.kind !== 'pdf' && ref.kind !== 'paper') return chatGraph.previewOf(node, workspaceDir, maxChars)
      try {
        const text = execFileSync('pdftotext', ['-f', '1', '-l', '4', '-layout', target, '-'], {
          encoding: 'utf8', timeout: 3000, maxBuffer: 4 * 1024 * 1024,
        }).slice(0, maxChars)
        return text.trim() === ''
          ? { ok: false, path: target, error: 'PDF 尚无可提取文本，请从页码入口打开原文' }
          : { ok: true, path: target, text }
      } catch {
        return { ok: false, path: target, error: 'PDF 提取工具不可用，请从页码入口打开原文' }
      }
    },
    dataRoot,
  })
  const scienceGraphBridge = new ScienceChatGraphBridge({
    dataRoot,
    chatGraph,
    experimentWorkspace,
    evolution: registry,
    createSession: async (workspaceDir, initialMessage) => {
      try { return await deliverToAgent(ctx, initialMessage, workspaceDir, 'evoresearch:science-candidate') }
      catch { return null }
    },
  })

  // user/message 到达后立即建立同步快速投影；这是第一次模型调用前的真正接线点，
  // 深入检索仍由 contextAssembleDeep/API 在需要时执行。
  const disposeContextAssemblerEvents = ctx.on('session/event', (session: any, event: any) => {
    const sessionId = typeof session?.id === 'string' ? session.id : ''
    if (sessionId === '') return
    if (event?.type === 'user/message') {
      const data = event.data as { source?: { kind?: string }; text?: unknown; content?: unknown } | undefined
      if (data?.source?.kind !== 'user') return
      const text = typeof data.text === 'string'
        ? data.text
        : Array.isArray(data?.content)
          ? data.content.map((block: any) => typeof block?.text === 'string' ? block.text : '').join('')
          : ''
      const workspaceDir = typeof session?.header?.cwd === 'string' && session.header.cwd !== '' ? session.header.cwd : dataRoot
      if (text.trim() !== '') {
        const projectName = projectNameFromWorkspace(dataRoot, workspaceDir)
        contextAssembler.prepareFast({ sessionId, userQuestion: text.trim(), workspaceDir, projectName })
      }
    } else if (event?.type === 'turn/end') {
      contextAssembler.clearPrepared(sessionId)
    }
  })

  // 5.7.1) 每回合完成 → 自动提交项目工作区（debounce 2s，为回溯提供还原点）
  const rewindTimers = new Map<string, NodeJS.Timeout>()
  const disposeRewindHook = ctx.on('session/event', (session: any, event: any) => {
    if (event?.type !== 'turn/end') return
    const cwd = session?.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') return
    const turn = typeof event.data?.turn === 'number' ? event.data.turn : 0
    const timer = rewindTimers.get(cwd)
    if (timer !== undefined) clearTimeout(timer)
    rewindTimers.set(cwd, setTimeout(() => {
      rewindTimers.delete(cwd)
      try { rewind.commitWorkspace(cwd, `auto-turn ${turn}`) } catch { /* 非 git 项目忽略 */ }
    }, 2000))
  })
  const disposeRewindTimers = () => {
    for (const timer of rewindTimers.values()) clearTimeout(timer)
    rewindTimers.clear()
  }

  // 5.6.1) UV 自动安装（用户缺失时启动即静默安装，官方脚本，幂等快速）
  void projectEnv.uvEnsure().then((result) => {
    if (result.ok && result.installed) console.log(`[evoresearch] 已自动安装 UV → ${result.uv}`)
    else if (result.ok) console.log(`[evoresearch] UV 已就绪: ${result.uv}`)
    else console.warn(`[evoresearch] UV 自动安装失败（可稍后重试）: ${result.error}`)
  })

  // 5.15) 平台能力层（PLAT-13..20，t19 交付）：
  //  - PLAT-13 多模型 Fallback selector（纯函数 + 进程内失败计数状态）；
  //  - PLAT-14 per-turn 工具选择（基础白名单 + 相关性打分）；
  //  - PLAT-15 审批策略（默认 ask + 默认危险清单 + 单工具覆盖）；
  //  - PLAT-16/19 子代理运行时（谱系 + provider 注册表 + 门面 + DSH provider）；
  //  - PLAT-20 消息反馈与诊断导出；
  //  - PLAT-11/12 MCP supervisor（stdio / HTTP / Streamable HTTP）。
  let modelFallbackState = emptyFallbackState()
  const approvalPolicy = defaultApprovalPolicy()
  const subagentRegistry = new SubagentRegistry(dataRoot)
  const subagentProviders = new SubagentProviderRegistry()
  const subagentFacade = new SubagentFacade(subagentRegistry, subagentProviders)
  // 注册内置 DSH 子代理 provider（PLAT-19）：使用 ctx.agents.create 派生子会话，
  // sessionId 回填后通过 ctx.subagents.start 启动；未实现时返回明确不支持。
  let disposeDshProvider: (() => void) | undefined
  try {
    const agents = ctx.get('agents') as {
      create?: (options: { sessionId: string; cwd?: string }) => Promise<{ session?: { id?: string } }>
    } | undefined
    if (agents?.create) {
      const liveHandles = new Map<string, any>()
      disposeDshProvider = subagentProviders.register({
        name: 'dsh',
        async create(request) {
          if (!agents.create) return { ok: false, error: 'agents.create 不可用' }
          const sessionId = `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
          try {
            const handle = await agents.create({ sessionId, cwd: request.cwd })
            const created = (handle as { session?: { id?: string } }).session?.id ?? sessionId
            liveHandles.set(created, (handle as any).agent ?? handle)
            return { ok: true, subagentId: created, sessionId: created }
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) }
          }
        },
        async continue(subagentId, message) {
          const agent = liveHandles.get(subagentId)
          if (!agent?.followup) return { ok: false, error: 'DSH 子代理已不在内存中，无法继续；请从持久化会话恢复' }
          try {
            await Promise.resolve(agent.followup(createUserMessage({
              content: [{ type: 'text', text: message }],
              source: { kind: 'user' },
            })))
            return { ok: true, sessionId: subagentId, resumePoint: `followup:${Date.now()}` }
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) }
          }
        },
        async interrupt(subagentId) {
          const agent = liveHandles.get(subagentId)
          try {
            if (typeof agent?.interrupt === 'function') await agent.interrupt()
            else if (typeof agent?.stop === 'function') await agent.stop()
            else if (typeof agent?.abort === 'function') await agent.abort()
            else return { ok: false, error: 'DSH 子代理没有可用的 interrupt/stop/abort 方法' }
            return { ok: true, resumePoint: `interrupt:${Date.now()}` }
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) }
          }
        },
        async report(subagentId) {
          const agent = liveHandles.get(subagentId)
          const log = Array.isArray(agent?.session?.log) ? agent.session.log : []
          const texts = log.flatMap((event: any) => event?.type === 'assistant/message' && Array.isArray(event.data?.message?.content)
            ? event.data.message.content.filter((block: any) => block?.type === 'text').map((block: any) => String(block.text ?? ''))
            : [])
          return { ok: true, report: texts.at(-1) ?? '子代理尚无可回报正文', sessionId: subagentId }
        },
        async cancel(subagentId) {
          const result = await this.interrupt?.(subagentId)
          liveHandles.delete(subagentId)
          return result ?? { ok: false, error: '取消未执行' }
        },
      })
    }
  } catch (error) {
    console.warn(`[evoresearch] 注册 DSH 子代理 provider 失败: ${String(error)}`)
  }
  const mcpSupervisor = new McpSupervisor({ dataRoot })
  // PLAT-08..10：分层 Skill 注册表同时作为 DSH provider 与 EvoResearch
  // Remote API 的统一入口；workspace/project 层由 skillRegistryFor 按当前
  // 会话工作区创建视图，global/custom/builtin 仍共享部署根。
  const layeredSkills = new LayeredSkillRegistry({ dataRoot })
  const disposeLayeredSkills = layeredSkills.registerDshProvider(ctx)
  // PLAT-11/12：恢复上次保存的 MCP 配置；单个服务器失败只记录局部降级。
  void mcpSupervisor.restore().catch((error) => {
    console.warn(`[evoresearch:mcp] 配置恢复失败（普通聊天不受影响）: ${String(error)}`)
  })
  const platform: PlatformServices = {
    get modelFallbackState() { return modelFallbackState },
    recordModelFailure: (route) => {
      const next = recordFailure(modelFallbackState, route)
      modelFallbackState = next
      return next
    },
    recordModelSuccess: (route) => {
      const next = recordSuccess(modelFallbackState, route)
      modelFallbackState = next
      return next
    },
    selectModelRoute: (routes, options) => selectModel(routes, modelFallbackState, options),
    selectToolsForTurn: (tools, query, options) => selectToolsForTurn(tools, query, options),
    approvalPolicy,
    decideApproval: (toolName) => decisionFromPolicy(approvalPolicy, toolName),
    subagents: { registry: subagentRegistry, providers: subagentProviders, facade: subagentFacade },
    mcp: mcpSupervisor,
    skillRegistry: layeredSkills,
    skillRegistryFor: (workspaceDir) => workspaceDir === undefined || workspaceDir === ''
      ? layeredSkills
      : new LayeredSkillRegistry({ dataRoot, workspaceDir }),
  }

  // 6) Remote API（构造即注册 services.evoresearch）；figureService 在下方 7.5 节
  // 构造，此处用 getter 延迟解析（Remote 方法调用时已就绪）。
  const services: HostServices = {
    workspace, memory, scheduler, channels, autoskills, experts, experiments,
    experimentWorkspace, experimentProcess, worktrees, experimentLedger,
    experimentRounds, dailyReport, scienceLoops, scienceGraphBridge, chatGraph,
    projectEnv, rewind, notes, libraryIndexer, librarySearch, manuscript,
    evo: { signals, registry }, contextGuard, contextRuntime, contextAssembler,
    platform, jobHub,
    get figureService() { return figureServiceRef.current },
  }
  void new EvoResearchApiService(ctx, services)

  // 7) 斜杠命令
  const disposeCommands = registerCommands(ctx, { workspace, memory, scheduler, channels, autoskills, experts })

  // 7.5) NF 批次工具接线（P0-3/P1-3/P1-4/P2-1/P2-2）：
  const disposersNf: Array<() => void> = []
  // P1-3 ask_researcher（平台 userQuestions 可用时注册；缺失时告警降级为文本提问）
  const disposeAskTool = registerAskResearcherTool(ctx)
  if (disposeAskTool) disposersNf.push(disposeAskTool)
  // P1-4 超限自动重试监视：turn/end 错误特征 → guard.overflowRetry（压缩→重试一次）
  const overflowWatch = new OverflowWatch({
    guard: {
      status: () => contextRuntime.guard.status(),
      overflowRetry: (session, options) => contextRuntime.guard.overflowRetry(session as never, options as never),
    },
    getSession: (sessionId) => {
      const sessions = ctx.get('sessions') as { get?(id: string): unknown } | undefined
      return sessions?.get?.(sessionId)
    },
  })
  disposersNf.push(overflowWatch.attach(ctx))
  // P3-2 无人值守 shell 门控：scheduler/channel/science 会话的 bash/pwsh 命令
  // 在执行前经 decideUnattendedShell 判定（deny-list fail-closed + allow-list）。
  const unattendedAllowCommands = config.unattended?.allowCommands ?? []
  try {
    const toolRuntime = ctx.get('tools') as
      | { guard?(guard: (execution: unknown) => string | undefined): () => void }
      | undefined
    if (typeof toolRuntime?.guard === 'function') {
      disposersNf.push(toolRuntime.guard((execution: unknown) => {
        const exec = execution as { name?: string; arguments?: unknown; agent?: { session?: { id?: string } } }
        const toolName = typeof exec?.name === 'string' ? exec.name : ''
        if (!/^(bash|pwsh|powershell)$/.test(toolName)) return undefined
        const sessionId = exec?.agent?.session?.id ?? ''
        if (!isMarkedUnattended(sessionId)) return undefined
        const args = exec?.arguments as { command?: unknown } | undefined
        const command = typeof args?.command === 'string' ? args.command : ''
        if (command.trim() === '') return '无人值守会话拒绝无法解析命令文本的 shell 调用（fail-closed）'
        const verdict = decideUnattendedShell(command, unattendedAllowCommands)
        return verdict.allowed ? undefined : verdict.reason
      }))
      console.log('[evoresearch] P3-2 无人值守 shell 门控已挂载（tools.guard）')
    } else {
      console.warn('[evoresearch] P3-2 tools.guard 不可用，无人值守 shell 门控降级为仅记录')
    }
  } catch (error) {
    console.warn(`[evoresearch] P3-2 无人值守 shell 门控挂载失败（不影响其余功能）: ${String(error)}`)
  }
  // P2-2 文献检索三工具：本地库 + 平台 web_search 探测合并
  const libraryToolsDeps: LibraryToolsDeps = {
    dataRoot,
    librarySearch,
    libraryIndexer,
    hasWebSearch: () => {
      try { return (ctx.get('tools') as { get?(name: string): unknown } | undefined)?.get?.('web_search') !== undefined } catch { return false }
    },
    invokeWebSearch: async (query) => {
      const result = await (ctx.get('tools') as NonNullable<ReturnType<typeof ctx.get>> & { execute(input: { callId: string; name: string; arguments: unknown; signal?: AbortSignal }): Promise<{ content: readonly unknown[]; isError: boolean }> }).execute({
        callId: `evoresearch-web-${Date.now()}`,
        name: 'web_search',
        arguments: { query },
      })
      if (result.isError) throw new Error('web_search 执行失败')
      return result.content
        .map((block: unknown) => {
          const b = block as { type?: unknown; text?: unknown }
          return typeof b?.type === 'string' && b.type === 'text' && typeof b.text === 'string' ? b.text : ''
        })
        .join('\n')
    },
  }
  disposersNf.push(registerLibraryTools(ctx, libraryToolsDeps))
  // P2-1 论文图片工作流三工具：项目 venv 渲染脚本 + critique 复用 vision
  const figureServiceRef: { current: FigureService | undefined } = { current: undefined }
  const figureService = new FigureService({
    dataRoot,
    resolvePython: (projectDirPath) => {
      const envDir = projectEnv.envDirOf(projectDirPath)
      const python = projectEnv.pythonOf(envDir)
      return fs.existsSync(python) ? python : null
    },
  })
  figureServiceRef.current = figureService
  disposersNf.push(registerFigureTools(ctx, {
    service: figureService,
    dataRoot,
    critiqueImage: undefined, // 视觉模型配置就绪时由 vision.ts 的 analyzeImage 接入；此处保守缺省
  }))
  // P0-3 四挂接点之一：实验进程启动登记（其余挂接点见下）
  const origExpRun = experimentProcess.run.bind(experimentProcess)
  ;(experimentProcess as { run: typeof experimentProcess.run }).run = (workspaceDir: string, slug: string, spec: Parameters<typeof experimentProcess.run>[2]) => {
    const record = origExpRun(workspaceDir, slug, spec)
    const job = jobHub.register({ kind: 'experiment', label: `${slug}: ${record.command.slice(0, 60)}`, sessionId: undefined, detail: record.runId })
    void (async () => {
      // 轮询等待该 run 结束（账本状态翻转），随后注销任务行
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        try {
          const current = experimentProcess.get(workspaceDir, slug, record.runId)
          if (current.status === 'running') continue
          if (current.status === 'success') jobHub.complete(job.jobId, `exit ${current.exitCode}`)
          else jobHub.fail(job.jobId, `status ${current.status}`)
        } catch {
          jobHub.unregister(job.jobId)
        }
        break
      }
    })()
    return record
  }

  // 8) 视觉检查工具（vision_check，配置就绪时注册）
  const disposeVision = registerVisionTool(ctx, config.visionEnabled ?? true)

  // 8.5) §10.6 科研代码生成模式规则注入：准备委派代码任务前必须询问用户选择
  // Lite（一次性委派）/ More Effort（迭代式编码技能）；More Effort 技能未安装时
  // 不得静默退回 Lite——停止委派并说明缺少能力。询问复用官方 ask_user 工具。
  const systemPrompt = ctx.get('systemPrompt')
  /**
   * PLAT-14 真实模型管线接线：DSH 的 system-prompt/assemble 是每次模型
   * request 的最终工具 schema 汇合点。selector 只改变本次 assembly 的
   * model-facing tools，不注销全局工具，也不影响工具实际执行注册表。
   *
   * 先调用 next() 取得所有 provider 的结果，再用 tools.schemas(scope)
   * 建立完整可见工具名集合；这样前置 provider 的排序/限制不会让 selector
   * 误以为工具不存在。没有当前 user/message 投影时保持原 assembly，避免
   * 诊断/启动期 assembly 被空问题裁成只剩基础工具。
   */
  const disposeAdaptiveToolAssembly = ctx.on('system-prompt/assemble', async (
    assembly: PromptAssembly,
    context: AssembleContext,
    next: () => Promise<PromptAssembly>,
  ): Promise<PromptAssembly> => {
    const assembled = await next()
    const agent = (context as AssembleContext & { agent?: { id?: string; session?: { id?: string } } }).agent
    const sessionId = agent?.session?.id ?? agent?.id ?? ''
    const question = sessionId === '' ? '' : contextAssembler.preparedQuestion(sessionId)
    if (question.trim() === '') return assembled

    const runtime = ctx.get('tools') as { schemas?: (scope?: unknown) => ToolSchema[] } | undefined
    let visible: ToolSchema[] = []
    try {
      visible = typeof runtime?.schemas === 'function' ? runtime.schemas(context.scope) : []
    } catch {
      visible = []
    }
    const byName = new Map<string, ToolSchema>()
    for (const tool of visible) byName.set(tool.name, tool)
    // Providers may contribute a schema that is intentionally not registered
    // in the runtime registry (for example a deployment-local presentation
    // tool); it remains part of the known universe for this assembly.
    for (const tool of assembled.tools) if (!byName.has(tool.name)) byName.set(tool.name, tool)
    const selected = selectToolsForTurn([...byName.values()], question)
    const selectedNames = new Set(selected.map((tool) => tool.name))
    const tools = assembled.tools.filter((tool) => selectedNames.has(tool.name))
    return { ...assembled, tools }
  }, { prepend: true })
  const disposeContextAssemblerPrompt = systemPrompt
    ? systemPrompt.context({
        name: 'evoresearch:context-assembler-first-call',
        order: 63,
        text: (context: { agent?: { session?: { id?: string } } }) => {
          const sessionId = context?.agent?.session?.id ?? ''
          const prepared = sessionId === '' ? '' : contextAssembler.preparedText(sessionId)
          return prepared === '' ? '' :
            '<context_assembler_first_call>\n' +
            '这是本轮模型调用前已按当前问题同步构造的快速阅读材料；它来自当前聊天、Graph 直接连接和项目原文搜索。' +
            '长材料只保留了继续读取入口，回答细节时应沿入口回读原文。\n' +
            prepared +
            '\n</context_assembler_first_call>'
        },
      })
    : undefined
  const disposeCodeMode = systemPrompt
    ? systemPrompt.context({
        name: 'evoresearch:code-mode-guidance',
        order: 62,
        text: () =>
          '<code_mode>\n' +
          '准备委派代码任务（进入实验实现阶段）前，必须先用 ask_user 工具询问用户选择代码模式：\n' +
          '- Lite：普通代码 Agent，一次性完成当前委派；\n' +
          '- More Effort：使用已安装的迭代式编码技能，多轮实现、验证和改进。\n' +
          '若用户选择 More Effort：先用 skill 工具确认迭代式编码技能已安装；' +
          '未安装时不得静默退回 Lite——应停止本次代码委派，明确告知用户缺少该能力，' +
          '请其安装技能或重新选择 Lite。\n' +
          '</code_mode>',
      })
    : undefined

  // 8.55) Windows 终端约定：默认使用 CMD（cmd.exe）语法，不使用 PowerShell。
  const disposeShellConvention = systemPrompt
    ? systemPrompt.context({
        name: 'evoresearch:windows-shell-convention',
        order: 60,
        text: () =>
          '<shell_convention>\n' +
          '在 Windows 上执行终端命令时，默认使用 CMD（cmd.exe）语法，不使用 PowerShell 语法：\n' +
          '- 常用命令：dir / type / copy / del / move / set / start / tasklist / taskkill / netstat / findstr；\n' +
          '- 环境变量用 %VAR% 读取、set VAR=value 写入；\n' +
          '- 示例：netstat -ano | findstr :3082；taskkill /PID <pid> /F；\n' +
          '- 除非用户明确要求使用 PowerShell，否则不要写 Get-ChildItem、Get-Content、$env:VAR 等 PowerShell 命令。\n' +
          '</shell_convention>',
      })
    : undefined

  // 8.6) 项目环境（§环境管理）：按会话动态注入 <project_env> 指引——
  // assemble context 携带 agent.session.header.cwd，据此解析当前项目的 .venv。
  const disposeEnvHint = systemPrompt
    ? systemPrompt.context({
        name: 'evoresearch:project-env',
        order: 61,
        text: (context: { agent?: { session?: { header?: { cwd?: string } } } }) => {
          const cwd = context?.agent?.session?.header?.cwd ?? ''
          if (cwd === '') return ''
          const envDir = projectEnv.envDirOf(cwd)
          const python = projectEnv.pythonOf(envDir)
          if (fs.existsSync(python)) {
            return '<project_env>\n' +
              '本项目拥有独立的 Python 虚拟环境（UV 管理，与其它项目隔离）：\n' +
              `- 环境目录: ${envDir}\n` +
              `- 解释器: ${python}\n` +
              `- 环境变量: %DSH_VENV_PYTHON%（cmd）/ $env:DSH_VENV_PYTHON（pwsh）即该解释器路径\n` +
              '运行本项目 Python 代码请使用该解释器（cmd: "%DSH_VENV_PYTHON%" script.py；pwsh: & $env:DSH_VENV_PYTHON script.py）；\n' +
              `安装依赖请使用: uv pip install --python "${envDir}" <package>（uv 路径在 %DSH_UV%）\n` +
              '禁止使用全局 python/pip（会污染其它项目）。\n' +
              '</project_env>'
          }
          const uv = projectEnv.uvPath()
          return '<project_env>\n' +
            '本项目尚未创建专属虚拟环境（.venv 不存在）。如需 Python 依赖，请先创建环境：\n' +
            `- uv venv "${envDir}" --python 3.12 --python-preference managed` +
            (uv === null ? '' : `（uv 位于 ${uv}）`) + '\n' +
            '创建后再安装依赖并运行代码；不要使用全局 python/pip。\n' +
            '</project_env>'
        },
      })
    : undefined

  // 8.8) Chat Graph 不再把相连节点全文直接拼进 system prompt。
  // ContextAssembler 在 user/message 到达时按当前问题同步选择候选，并提供
  // Context Trace；这里不保留旧的 graphMemoryText contributor，避免“所有相连
  // 节点全文注入”破坏 token 预算与 relation 不注入语义。
  const disposeGraphMemory: (() => void) | undefined = undefined

  // 8.8.2) 项目级自然语言专家说明（PLAT-10）：AGENTS.md 是可选背景资料，
  // 按当前会话 cwd 读取，不把安装/运行元数据混入研究笔记。
  const disposeAgentGuidance = systemPrompt
    ? systemPrompt.context({
        name: 'evoresearch:agent-guidance',
        order: 59,
        text: (context: { agent?: { session?: { header?: { cwd?: string } } } }) => {
          const cwd = context?.agent?.session?.header?.cwd ?? ''
          return experts.agentsContext(cwd).text
        },
      })
    : undefined

  // 8.8.1) 上下文继承不再运行时注入（§ChatGraph 语义调整：context 连线时由
  // graphInherit 一次性 fork 源会话历史作为初始化，只有一层；此后会话独立演进）

  // 8.7) 项目环境自动切换（shellEnv）：每次 bash/pwsh 执行注入当前项目环境的
  // 真实路径——按 execution.agent.session.header.cwd 解析，与所选项目一一对应。
  const shellEnv = ctx.get('shellEnv') as
    | { register(contributor: {
        name: string
        variables: Record<string, { description: string }>
        resolve(execution: { agent?: { session?: { header?: { cwd?: string } } } }): Record<string, string>
      }): () => void }
    | undefined
  const disposeShellEnv = shellEnv
    ? shellEnv.register({
        name: 'evoresearch-project-env',
        variables: {
          DSH_VENV: { description: '当前会话所属科研项目的虚拟环境目录（.venv 不存在时也为目录路径）' },
          DSH_VENV_PYTHON: { description: '项目虚拟环境的 python.exe 绝对路径（环境不存在时为空字符串）' },
          DSH_VENV_SCRIPTS: { description: '项目虚拟环境的 Scripts 目录（环境不存在时为空字符串）' },
          DSH_UV: { description: 'UV 可执行文件绝对路径（未安装时为空字符串）' },
        },
        resolve(execution) {
          const cwd = execution?.agent?.session?.header?.cwd ?? ''
          const uv = projectEnv.uvPath()
          if (cwd === '') return { DSH_VENV: '', DSH_VENV_PYTHON: '', DSH_VENV_SCRIPTS: '', DSH_UV: uv ?? '' }
          const envDir = projectEnv.envDirOf(cwd)
          const python = projectEnv.pythonOf(envDir)
          const exists = fs.existsSync(python)
          return {
            DSH_VENV: envDir,
            DSH_VENV_PYTHON: exists ? python : '',
            DSH_VENV_SCRIPTS: exists ? path.join(envDir, 'Scripts') : '',
            DSH_UV: uv ?? '',
          }
        },
      })
    : undefined

  // 9) 挂载副作用（记忆事件订阅 + prompt 注入 + 工具；调度 tick；通道）
  const disposeMemory = memory.attach(ctx)
  const disposeScheduler = scheduler.attach(ctx)
  const disposeChannels = channels.attach(ctx)
  const disposeDailyReport = dailyReport.attach(ctx)
  // §整合 P0c：上下文窗口保护层 + AutoSkills 真实执行（runSkill 依赖 attach 探测 DSH skills）
  const disposeContextRuntime = contextRuntime.attach(ctx)
  const disposeAutoskills = autoskills.attach(ctx)

  // P1-1 AutoSkills 定时挖掘：经 SchedulerService 注册内置任务（每周一凌晨 3:07，
  // settings.yaml evoresearch.autoskills.schedule 可覆盖 cron 或设 off 关闭）。
  // 结果经 deliverToAgent 回报主对话（通知也走对话，F1）。
  let disposeAutoskillsMining: (() => void) | undefined
  {
    const scheduleSetting = (config as { autoskillsSchedule?: string }).autoskillsSchedule
    if (scheduleSetting !== 'off') {
      const cron = typeof scheduleSetting === 'string' && scheduleSetting !== '' ? scheduleSetting : '7 3 * * 1'
      try {
        const task = scheduler.add({
          name: 'AutoSkills 定时挖掘',
          cron,
          prompt: `执行一次全项目技能挖掘（mineAllWorkspaces）：汇总各项目观测聚类与笔记重复做法，生成待审技能提案。完成后汇报新增提案数与名称列表。`,
          workspaceDir: dataRoot,
        })
        void task
        console.log(`[evoresearch] P1-1 AutoSkills 定时挖掘已注册（cron: ${cron}）`)
      } catch (error) {
        console.warn(`[evoresearch] AutoSkills 定时挖掘注册失败（不影响其余功能）: ${String(error)}`)
      }
    }
  }
  if (config.autoStartChannels) {
    void channels.startAll().catch((error) => {
      console.error('[evoresearch] 自动启动通道失败:', error)
    })
  }

  // 10) 卸载时清理全部副作用（cordis effect 回调必须返回 disposer）
  ctx.effect(() => {
    return () => {
      disposeMemory()
      disposeScheduler()
      disposeChannels()
      disposeDailyReport()
      disposeContextRuntime()
      disposeAutoskills()
      for (const dispose of disposersNf) dispose()
      jobHub.dispose()
      disposeContextAssemblerPrompt?.()
      disposeAdaptiveToolAssembly()
      disposeContextAssemblerEvents()
      disposeAgentGuidance?.()
      disposeCommands()
      disposeVision?.()
      disposeCodeMode?.()
      disposeShellConvention?.()
      disposeEnvHint?.()
      disposeShellEnv?.()
      disposeRewindHook()
      disposeRewindTimers()
      libraryIndexer.dispose()
      librarySearch.dispose()
      manuscript.dispose()
      registry.disposeAll()
      // 平台能力层（PLAT-13..20）卸载：MCP / 子代理 provider 释放
      mcpSupervisor.disposeAll()
      disposeLayeredSkills()
      subagentProviders.disposeAll()
      disposeDshProvider?.()
      void disposeAutoskillsMining
    }
  })
}

export default { name, inject, apply }

/** PLAT-15：基于策略做审批判定（薄包装，方便 closure 捕获）。 */
function decisionFromPolicy(approvalPolicy: ReturnType<typeof defaultApprovalPolicy>, toolName: string) {
  const dangerous = (approvalPolicy.dangerousTools ?? []).includes(toolName)
  if (!dangerous) return { decision: 'allow' as const, reason: `工具 ${toolName} 不在危险清单`, dangerous: false }
  const override = approvalPolicy.overrides?.[toolName]
  const mode = override ?? approvalPolicy.mode
  if (mode === 'allow') return { decision: 'allow' as const, reason: `工具 ${toolName} 被策略放行`, dangerous: true }
  if (mode === 'deny') return { decision: 'deny' as const, reason: `工具 ${toolName} 被策略拒绝`, dangerous: true }
  return { decision: 'ask' as const, reason: `工具 ${toolName} 需要审批`, dangerous: true }
}
