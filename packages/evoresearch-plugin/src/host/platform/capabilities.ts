/**
 * DSH 平台能力探测与版本能力矩阵（PLAT-01）。
 *
 * 本模块是全插件唯一保存「DSH 版本能力认知」的静态知识库：
 * - `DSH_CAPABILITY_MATRIX`：针对 DSH 0.1.0-rc.6 安装面的静态矩阵（能力 → rc.6 现状
 *   available/partial/missing → 适配层策略 → 降级路径）。当前部署基线已随依赖
 *   声明升至 **0.1.0-rc.8**，但 rc.6 与 rc.8 在本次升级涉及的 Cordis 服务面
 *   （sessions/llm/tools/approval/skills/subagents/jobs 等）无 API 差异，本矩阵
 *   仍为有效参考；实际能力以 `probeCapabilities(ctx)` 运行时探测为准；
 * - `probeCapabilities(ctx)`：运行时探测，读取 `ctx.get(...)` 中对应 Cordis
 *   服务是否真实存在，返回实际可用集。
 *
 * 科研模块只依赖本模块的探测结果与矩阵文档，不直接散落 DSH 服务名与调用
 * 形态；升级 DSH 版本时只改本文件（矩阵行 + 服务名映射）与 `adapters.ts`。
 *
 * 矩阵依据（rc.6 安装面，见 packages/evoresearch-plugin/node_modules 的
 * @deepseek-ai/* 类型声明）：
 * - sessions:  ctx.sessions（SessionStore: create/get/list/fork/flush）；
 * - models:    ctx.llm（LlmRuntime: listProviders/listModels/resolveCallConfig/stream）
 *              + ctx.agentDefaultModel（currentSelection）；
 * - tools:     ctx.tools（ToolRuntime: register/get/schemas/execute/restrict/guard）；
 * - approval:  ctx.approval（ApprovalService: request/setPolicy/overrideOf）；
 * - sandbox:   rc.6 无独立 ctx.sandbox 服务，只有 tools.restrict/guard
 *              （按 Agent 工具可见性）与 dsh-scope（ScopeKey）机制；
 * - events:    Cordis 事件总线（ctx.events / ctx.on，恒可用）；
 * - plugins:   Cordis registry（ctx.registry / ctx.plugin）+ 可选
 *              dsh-host-plugin-inventory（PluginInventoryGateway.list）；
 * - compaction: ctx.compaction（CompactionEngine 抽象：compactIfNeeded /
 *              compactNow / compactRegion），rc.6 安装的是抽象定义，
 *              具体实现由 profile 是否装配决定；
 * - toolPruning: rc.6 无独立工具结果裁剪服务，仅有 surface replace 机制
 *              （供 compaction 替换节点使用）；
 * - sessionQuery: ctx.sessionQuery（SessionQueryEngine 抽象：listSessions /
 *              readSession / readSurface / traceSession / listEvents / readEvent），
 *              同样依赖 profile 装配具体实现；
 * - skills:    ctx.skills（SkillRegistry: list/get/register/registerProvider/
 *              snapshot），分层由注册的 SkillProvider 承担；
 * - mcp:       rc.6 无 MCP supervisor / 传输包；
 * - subagents: ctx.subagents（SubagentRuntime: start/startContinuable/interrupt/
 *              followup/reportFrom/listChildren）+ ctx.agents（AgentRegistry:
 *              create/resume/get/list）；
 * - scheduler: ctx.jobs（JobRegistry: start/list/get/read/kill/wait）+ ctx.timer
 *              （cron 定时器）；自然语言调度由插件 SchedulerService 承担；
 * - channels:  DSH 无通道服务，多通道由插件 ChannelManager 承担
 *              （Web/桌面/CLI 已有，Telegram 等按同一 ChannelAdapter 扩展）。
 */
import type { Context } from '@deepseek-ai/cordis'

/** 平台能力标识（PLAT-01 枚举，与平台运行时能力目录对齐）。 */
export const PLATFORM_CAPABILITIES = [
  'sessions',
  'models',
  'tools',
  'approval',
  'sandbox',
  'events',
  'plugins',
  'compaction',
  'toolPruning',
  'sessionQuery',
  'skills',
  'mcp',
  'subagents',
  'scheduler',
  'channels',
] as const

export type PlatformCapability = (typeof PLATFORM_CAPABILITIES)[number]

/** 能力在目标 DSH 版本（0.1.0-rc.6）中的现状。 */
export type CapabilityStatus = 'available' | 'partial' | 'missing'

/** 能力归属层：DSH 原生提供 / EvoResearch 插件自身实现 / 两者混合。 */
export type CapabilityLayer = 'dsh' | 'plugin' | 'mixed'

/** 能力矩阵一行（静态知识，随 DSH 版本升级修订）。 */
export interface CapabilityPlan {
  readonly capability: PlatformCapability
  /** rc.6 现状。 */
  readonly status: CapabilityStatus
  /** 归属层。 */
  readonly layer: CapabilityLayer
  /** 运行时探测的 ctx.get 服务名候选（plugin 层为空数组）。 */
  readonly serviceNames: readonly string[]
  /** DSH rc.6 提供的真实载体（为什么是这个现状）。 */
  readonly basis: string
  /** 适配层接入策略。 */
  readonly adapter: string
  /** 能力缺失时的降级路径。 */
  readonly degradation: string
}

/** DSH 0.1.0-rc.6 静态能力矩阵（PLAT-01）。 */
export const DSH_CAPABILITY_MATRIX: readonly CapabilityPlan[] = [
  {
    capability: 'sessions',
    status: 'available',
    layer: 'dsh',
    serviceNames: ['sessions'],
    basis: 'ctx.sessions（SessionStore）提供 create/get/list/fork/flush 与 session/event 事件源。',
    adapter: 'adapters.sessions 直接复用 SessionStore：get/list/create/fork/readLog/flush。',
    degradation: '无 sessions → 实时事件源不可用，科研记忆只读插件自身持久化镜像（research_turns 等）并告警。',
  },
  {
    capability: 'models',
    status: 'available',
    layer: 'dsh',
    serviceNames: ['llm', 'agentDefaultModel'],
    basis: 'ctx.llm（LlmRuntime）提供 listProviders/listModels/resolveCallConfig/stream；ctx.agentDefaultModel 提供当前默认模型；providerRetryPolicy 与 dsh-llm-retry 提供有限重试。',
    adapter: 'adapters.models 封装 list/current/route；多模型 Fallback 与有限重试复用 DSH 内置重试策略，不在科研模块重复实现。',
    degradation: '无 llm → 依赖模型的辅助功能（分类/摘要/调度执行）显式报错或走规则回退，不静默假成功；原会话与资料不受影响。',
  },
  {
    capability: 'tools',
    status: 'available',
    layer: 'dsh',
    serviceNames: ['tools'],
    basis: 'ctx.tools（ToolRuntime）提供 register/get/schemas/execute/restrict/guard。',
    adapter: 'adapters.tools 封装 list/get/invoke/register；工具过多时的按任务选择（PLAT-14）由上层在 schemas() 结果上筛选，基础工具常驻。',
    degradation: '无 tools → 插件不注册科研工具，记忆/命令/图谱等不依赖工具的能力仍可用。',
  },
  {
    capability: 'approval',
    status: 'available',
    layer: 'dsh',
    serviceNames: ['approval'],
    basis: 'ctx.approval（ApprovalService）提供 request/setPolicy/overrideOf，事件 approval/request（waterfall）。',
    adapter: 'adapters.approval 封装 request/setPolicy；子代理与危险操作统一走同一审批通道（PLAT-15）。',
    degradation: '无 approval → 危险操作默认拒绝并告警（fail-closed，不静默放行），除非调用方显式 allowMissing。',
  },
  {
    capability: 'sandbox',
    status: 'partial',
    layer: 'dsh',
    serviceNames: [],
    basis: 'rc.6 无独立 ctx.sandbox 服务；只有 tools.restrict/guard（按 Agent 工具可见性）与 dsh-scope（ScopeKey）机制；dsh-cordis-host-runner 的 vm 沙箱仅用于动态插件宿主。',
    adapter: '工具级隔离走 adapters.sandbox（restrict/guard 包装）；文件系统隔离由 WorkspaceService 路径校验与项目 .evoresearch-data 承担。',
    degradation: '无 restrict/guard → 不启用工具过滤，记录 warning；文件隔离仍由工作区路径校验保证。',
  },
  {
    capability: 'events',
    status: 'available',
    layer: 'dsh',
    serviceNames: ['events'],
    basis: 'Cordis 事件总线（ctx.events / ctx.on / ctx.parallel）恒可用；DSH 在其上发布 session/event、agent/* 等事件。',
    adapter: 'adapters.events 统一包装订阅（on/once），一律返回 disposer（BASE-03）。',
    degradation: '事件总线是 Cordis 核心，恒可用；无需降级。',
  },
  {
    capability: 'plugins',
    status: 'available',
    layer: 'dsh',
    serviceNames: ['registry', 'pluginInventory'],
    basis: 'Cordis registry（ctx.registry / ctx.plugin）恒可用；dsh-host-plugin-inventory 的 PluginInventoryGateway 提供可选清单（entries/moduleName/enabled/fiberPhase）。',
    adapter: 'adapters.plugins 封装清单查询（inventory 优先，registry 兜底），供诊断导出与自进化观察。',
    degradation: '无 inventory → 仅返回 registry 可见的插件运行时摘要（数量/键），不报错。',
  },
  {
    capability: 'compaction',
    status: 'partial',
    layer: 'dsh',
    serviceNames: ['compaction'],
    basis: 'ctx.compaction（CompactionEngine 抽象）提供 compactIfNeeded/compactNow/compactRegion；rc.6 安装的是抽象定义，具体实现由 profile 装配决定。',
    adapter: '探测存在后由 CTX 层接入压力/溢出/手动/区域压缩；压缩只替换模型可见 surface 投影，原始事件保留在 session log。',
    degradation: '无 compaction → 不自动压缩，保留手动入口与完整原文回读；长会话仅提示上下文占用。',
  },
  {
    capability: 'toolPruning',
    status: 'missing',
    layer: 'mixed',
    serviceNames: [],
    basis: 'rc.6 无独立工具结果裁剪服务；仅有 surface replace 机制（compaction 替换节点用），无头部/中部/尾部裁剪入口。',
    adapter: '由 CTX 层基于 session surface replace 事件自实现裁剪（PLAT-04），完整工具结果仍写入 session log 可回读。',
    degradation: '不裁剪，返回完整工具结果（记录 warning）；模型继续工作时长工具结果占用上下文。',
  },
  {
    capability: 'sessionQuery',
    status: 'partial',
    layer: 'dsh',
    serviceNames: ['sessionQuery'],
    basis: 'ctx.sessionQuery（SessionQueryEngine 抽象）提供 listSessions/readSession/readSurface/traceSession/listEvents/readEvent；rc.6 安装抽象定义，具体实现由 profile 装配决定。',
    adapter: '探测存在后由 MEM/RET 模块用于跨会话检索、bounded read 与 lineage 查询（PLAT-07）；不存在时回退 live sessions + 插件 SQLite 镜像。',
    degradation: '无 sessionQuery → 检索回退 adapters.sessions（live store）+ 插件自身索引（research_turns/片段索引），跨会话搜索受限但原文仍在。',
  },
  {
    capability: 'skills',
    status: 'available',
    layer: 'dsh',
    serviceNames: ['skills'],
    basis: 'ctx.skills（SkillRegistry）提供 list/get/register/registerProvider/snapshot；builtin/global/workspace/project/custom 分层由注册的 SkillProvider 承担。',
    adapter: '探测存在后 AutoSkills/EVO 模块经 ctx.skills 注册与按需读取（PLAT-08/09）；本层只探测与上报。',
    degradation: '无 skills → AutoSkills 仅保存 Markdown 草稿（EVO-08 仍可用），不注册运行时技能。',
  },
  {
    capability: 'mcp',
    status: 'missing',
    layer: 'plugin',
    serviceNames: [],
    basis: 'rc.6 无 MCP supervisor / 传输包（stdio/HTTP/Streamable HTTP 均未提供）。',
    adapter: '暂不接入；保留 MCP supervisor 扩展位（PLAT-11/12），未来版本在适配层增加 mcp 适配器，服务器失败只影响相关工具。',
    degradation: '不暴露 MCP 工具；普通工具与原文检索不受影响。',
  },
  {
    capability: 'subagents',
    status: 'available',
    layer: 'dsh',
    serviceNames: ['subagents', 'agents'],
    basis: 'ctx.subagents（SubagentRuntime）提供 start/startContinuable/interrupt/followup/reportFrom/listChildren；ctx.agents（AgentRegistry）提供 create/resume/get/list。',
    adapter: '探测存在后由 teams/SCI 模块接入同步/异步/后台/可继续子代理与父子谱系（PLAT-16/19）；本层只探测与上报。',
    degradation: '无 subagents → 后台任务回退 ctx.jobs 或同步执行；中断/恢复/谱系能力降级并告警。',
  },
  {
    capability: 'scheduler',
    status: 'partial',
    layer: 'mixed',
    serviceNames: ['jobs', 'timer'],
    basis: 'ctx.jobs（JobRegistry: start/list/get/read/kill/wait）提供后台作业；ctx.timer 提供 cron 定时器；自然语言调度与暂停/恢复/结果回送由插件 SchedulerService 承担。',
    adapter: '后台作业统一走 ctx.jobs（存在时）；cron 触发用 ctx.timer；自然语言创建/暂停/恢复/立即运行保持插件层实现（PLAT-17）。',
    degradation: '无 jobs → 调度只在进程内运行，重启后待跑任务丢失并告警；无 timer → 只用显式触发。',
  },
  {
    capability: 'channels',
    status: 'missing',
    layer: 'plugin',
    serviceNames: [],
    basis: 'DSH 无通道服务；多通道由插件 ChannelManager 承担（Web/桌面/CLI 已有）。',
    adapter: '保持插件自身 channels 模块（ChannelAdapter 接口），Telegram/Slack/飞书/微信按同一接口扩展（PLAT-18）。',
    degradation: '未配置通道时仅主聊天入口；科研功能不受影响。',
  },
]

/** 单次运行时探测结果。 */
export interface CapabilityProbe {
  readonly capability: PlatformCapability
  /** 矩阵预期（rc.6 静态评估）。 */
  readonly expected: CapabilityStatus
  /** 本次运行实际探测结果。 */
  readonly status: CapabilityStatus
  /** 实际探测到的载体（服务名，或方法级载体如 tools.restrict/guard）。 */
  readonly present: readonly string[]
  /** 未探测到的载体。 */
  readonly absent: readonly string[]
  /** 附加说明（plugin 层 / 无独立服务等）。 */
  readonly note?: string
}

/** 服务存在之外的附加运行时校验（方法级载体，如 sandbox 的 restrict/guard）。 */
const EXTRA_CHECKS: Partial<Record<PlatformCapability, (ctx: Context) => { present: string[]; absent: string[] }>> = {
  sandbox(ctx) {
    const tools = ctx.get('tools') as { restrict?: unknown; guard?: unknown } | undefined
    if (tools && typeof tools.restrict === 'function' && typeof tools.guard === 'function') {
      return { present: ['tools.restrict/guard'], absent: [] }
    }
    return { present: [], absent: ['tools.restrict/guard'] }
  },
}

/** 运行时探测 DSH 平台能力（PLAT-01 的探测函数）。 */
export function probeCapabilities(ctx: Context): CapabilityProbe[] {
  return DSH_CAPABILITY_MATRIX.map((plan) => {
    // plugin 层能力（channels/mcp 等）由插件自身实现，DSH 探测不参与。
    if (plan.layer === 'plugin') {
      return {
        capability: plan.capability,
        expected: plan.status,
        status: plan.status,
        present: [],
        absent: [],
        note: 'plugin 层能力（EvoResearch 自身实现），不依赖 DSH 服务',
      }
    }

    let present: string[] = []
    let absent: string[] = []
    const extra = EXTRA_CHECKS[plan.capability]
    if (extra) {
      const result = extra(ctx)
      present = result.present
      absent = result.absent
    } else {
      for (const name of plan.serviceNames) {
        if (ctx.get(name) !== undefined) present.push(name)
        else absent.push(name)
      }
    }

    let status: CapabilityStatus
    if (plan.serviceNames.length === 0 && present.length === 0) {
      // 无服务名且无附加载体（如 toolPruning 的 surface replace 机制无法探测）。
      status = 'missing'
    } else if (present.length > 0 && absent.length === 0) {
      status = 'available'
    } else if (present.length > 0) {
      status = 'partial'
    } else {
      status = 'missing'
    }
    return { capability: plan.capability, expected: plan.status, status, present, absent }
  })
}

/** 由探测结果判断某能力当前是否可用（status !== 'missing'）。 */
export function capabilityUsable(probes: readonly CapabilityProbe[], capability: PlatformCapability): boolean {
  return probes.find((probe) => probe.capability === capability)?.status !== 'missing'
}

/** 生成人类可读能力摘要（诊断日志用），如 "sessions=available(llm) models=available(...) ..."。 */
export function summarizeCapabilities(probes: readonly CapabilityProbe[]): string {
  return probes
    .map((probe) => {
      const carrier = probe.present.length > 0 ? `(${probe.present.join(',')})` : ''
      return `${probe.capability}=${probe.status}${carrier}`
    })
    .join(' ')
}
