/**
 * EvoResearch Host 插件入口。
 *
 * 组装全部科研能力：
 * - WorkspaceService：科研项目工作区（projects/<name>/.evoresearch-data 隔离）；
 * - MemoryRuntime：EvoMemory v2/v3（Turn Catalog / 记忆包注入 / 检索工具 / Goal Control）；
 * - SchedulerService：定时任务（cron，项目隔离）；
 * - ChannelManager：消息通道（Telegram 等）；
 * - AutoSkillsService / ExpertService：技能蒸馏与专家团队；
 * - EVORESEARCHApiService：Client 可调用的 Remote API；
 * - 斜杠命令：/project /memory /schedule /channel /expert /autoskills。
 *
 * 配置（settings.yaml 的 EVORESEARCH 段，或环境变量）：
 * ```yaml
 * EVORESEARCH:
 *   dataRoot: D:\EvoResearch      # 部署根目录（projects/ 所在目录），默认 $EVORESEARCH_DATA_ROOT 或 cwd
 *   memoryTokenBudget: 6000
 *   auxiliaryModel: { provider: deepseek-official, model: deepseek-v4-flash }
 * ```
 */
import type { Context } from '@deepseek-ai/cordis'
import * as path from 'node:path'
import { WorkspaceService, type WorkspaceConfig } from './workspace.js'
import { MemoryRuntime, type MemoryConfig } from './memory/index.js'
import { SchedulerService, type SchedulerConfig } from './scheduler.js'
import { ChannelManager } from './channels/index.js'
import { builtinAdapters } from './channels/adapters.js'
import type { ChannelMessage } from './channels/base.js'
import { AutoSkillsService, type AutoSkillsConfig } from './autoskills.js'
import { ExpertService, type ExpertConfig } from './experts.js'
import { EVORESEARCHApiService, type HostServices } from './api.js'
import { registerCommands } from './commands.js'
import { listProjects } from './core/paths.js'

/** 插件配置（settings 的 EVORESEARCH 段合并环境变量）。 */
export interface EVORESEARCHPluginConfig {
  /** 部署根目录。 */
  readonly dataRoot?: string
  readonly memoryTokenBudget?: number
  readonly auxiliaryModel?: { provider: string; model: string }
  /** 启动时自动启动已配置通道（默认 false）。 */
  readonly autoStartChannels?: boolean
  /** 是否启用科研记忆（默认 true）。 */
  readonly memoryEnabled?: boolean
}

/** 从 settings/env 解析配置。 */
function resolveConfig(ctx: Context): EVORESEARCHPluginConfig {
  const settings = ctx.get('settings') as { get?: (ns: string) => unknown } | undefined
  const fromSettings = (settings?.get?.('EVORESEARCH') ?? {}) as Partial<EVORESEARCHPluginConfig>
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

const name = 'EVORESEARCH-host'

const inject = ['commands', 'tools', 'systemPrompt'] as const

function apply(ctx: Context): void {
  const config = resolveConfig(ctx)
  const dataRoot = config.dataRoot ?? process.cwd()
  console.log(`[EVORESEARCH] host 插件激活（dataRoot: ${dataRoot}）`)

  // 1) 科研项目工作区
  const workspaceConfig: WorkspaceConfig = { dataRoot }
  const workspace = new WorkspaceService(workspaceConfig)

  // 2) EvoMemory v2/v3
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
    return deliverToAgent(ctx, `[${message.senderName ?? message.senderId} 经 ${message.chatId} 通道] ${message.text}`, cwd, 'EVORESEARCH:channel')
  })

  // 5) AutoSkills / 专家
  const autoskillsConfig: AutoSkillsConfig = { dataRoot }
  const autoskills = new AutoSkillsService(autoskillsConfig)
  const expertConfig: ExpertConfig = { dataRoot }
  const experts = new ExpertService(expertConfig)

  // 6) Remote API（构造即注册 services.EVORESEARCH）
  const services: HostServices = { workspace, memory, scheduler, channels, autoskills, experts }
  void new EVORESEARCHApiService(ctx, services)

  // 7) 斜杠命令
  const disposeCommands = registerCommands(ctx, { workspace, memory, scheduler, channels, autoskills, experts })

  // 8) 挂载副作用（记忆事件订阅 + prompt 注入 + 工具；调度 tick；通道）
  const disposeMemory = memory.attach(ctx)
  const disposeScheduler = scheduler.attach(ctx)
  const disposeChannels = channels.attach(ctx)
  if (config.autoStartChannels) {
    void channels.startAll().catch((error) => {
      console.error('[EVORESEARCH] 自动启动通道失败:', error)
    })
  }

  // 9) 卸载时清理全部副作用（cordis effect 回调必须返回 disposer）
  ctx.effect(() => {
    return () => {
      disposeMemory()
      disposeScheduler()
      disposeChannels()
      disposeCommands()
    }
  })
}

export default { name, inject, apply }
