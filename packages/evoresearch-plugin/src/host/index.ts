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
import * as path from 'node:path'
import * as fs from 'node:fs'
import { WorkspaceService, type WorkspaceConfig } from './workspace.js'
import { MemoryRuntime, type MemoryConfig } from './memory/index.js'
import { SchedulerService, type SchedulerConfig } from './scheduler.js'
import { ChannelManager } from './channels/index.js'
import { builtinAdapters } from './channels/adapters.js'
import type { ChannelMessage } from './channels/base.js'
import { AutoSkillsService, type AutoSkillsConfig } from './autoskills.js'
import { ChatGraphService, graphMemoryText } from './chat-graph.js'
import { ExpertService, type ExpertConfig } from './experts.js'
import { ExperimentService } from './experiments.js'
import { ProjectEnvService } from './project-env.js'
import { RewindService } from './rewind.js'
import { EvoResearchApiService, type HostServices } from './api.js'
import { registerCommands } from './commands.js'
import { listProjects } from './core/paths.js'
import { registerVisionTool } from './vision.js'

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

  // 5.5) 实验管理（§5.1 Git 式分支/回退/checkpoint）
  const experiments = new ExperimentService(dataRoot)

  // 5.6) 项目环境（每项目独立 UV 虚拟环境）
  const projectEnv = new ProjectEnvService(dataRoot)

  // 5.7) 回溯服务（§回溯：Git 工作区 + 会话截断）
  const rewind = new RewindService(dataRoot)

  // 5.8) Chat Graph（节点/连线图，按项目存储）
  const chatGraph = new ChatGraphService(dataRoot)

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

  // 6) Remote API（构造即注册 services.evoresearch）
  const services: HostServices = { workspace, memory, scheduler, channels, autoskills, experts, experiments, chatGraph, projectEnv, rewind }
  void new EvoResearchApiService(ctx, services)

  // 7) 斜杠命令
  const disposeCommands = registerCommands(ctx, { workspace, memory, scheduler, channels, autoskills, experts })

  // 8) 视觉检查工具（vision_check，配置就绪时注册）
  const disposeVision = registerVisionTool(ctx, config.visionEnabled ?? true)

  // 8.5) §10.6 科研代码生成模式规则注入：准备委派代码任务前必须询问用户选择
  // Lite（一次性委派）/ More Effort（迭代式编码技能）；More Effort 技能未安装时
  // 不得静默退回 Lite——停止委派并说明缺少能力。询问复用官方 ask_user 工具。
  const systemPrompt = ctx.get('systemPrompt')
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
              `- 环境变量: $env:DSH_VENV_PYTHON（pwsh）/ $DSH_VENV_PYTHON（bash）即该解释器路径\n` +
              '运行本项目 Python 代码请使用该解释器（pwsh: & $env:DSH_VENV_PYTHON script.py；bash: "$DSH_VENV_PYTHON" script.py）；\n' +
              `安装依赖请使用: uv pip install --python "${envDir}" <package>（uv 路径在 $env:DSH_UV）\n` +
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

  // 8.8) Chat Graph 记忆/上下文注入（§ChatGraph）：
  // - <graph_memory>：会话的 memory 边 → 记忆节点内容；
  // - <graph_context>：会话的 context 边 → 源 chat 会话的最近消息历史（上下文继承）。
  const graphOf = (context: { agent?: { session?: { header?: { cwd?: string } } } }): { name: string; graph: import('./chat-graph.js').ChatGraph } | null => {
    const cwd = context?.agent?.session?.header?.cwd ?? ''
    if (cwd === '') return null
    const v = workspace.validateWorkspace(cwd)
    if (v.kind !== 'project') return null
    return { name: v.name, graph: chatGraph.get(v.name) }
  }
  const sessionIdOf = (context: { agent?: { session?: { id?: string } } }): string =>
    context?.agent?.session?.id ?? ''
  const disposeGraphMemory = systemPrompt
    ? systemPrompt.context({
        name: 'evoresearch:graph-memory',
        order: 62,
        text: (context: { agent?: { session?: { header?: { cwd?: string }; id?: string } } }) => {
          const sessionId = sessionIdOf(context)
          if (sessionId === '') return ''
          const g = graphOf(context)
          if (g === null) return ''
          const content = graphMemoryText(g.graph, sessionId)
          if (content === '') return ''
          return '<graph_memory>\n' +
            '本会话在聊天图谱中连接了以下记忆节点，回答时请按需参考：\n' +
            content +
            '\n</graph_memory>'
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
      disposeCommands()
      disposeVision?.()
      disposeCodeMode?.()
      disposeEnvHint?.()
      disposeShellEnv?.()
      disposeRewindHook()
      disposeRewindTimers()
    }
  })
}

export default { name, inject, apply }
