/**
 * 科学自演化编排：高层科研职责 RA / EA / EMA（SCI-01..04）。
 *
 * SCI-01：职责定义与六类角色映射（teams.ts TEAM_ROLES）：
 * - RA（Researcher Agent）：只负责 Idea 探索与讨论——提出、比较、质疑、扩展
 *   （分支讨论）；不设 Idea 通过门槛；不实现代码。
 * - EA（Engineer Agent）：只负责实现、运行和分析——复现、实现、超参尝试、
 *   消融、分析、失败复盘；保存代码、命令、环境、日志和产物。
 * - EMA（Evolution Manager Agent）：只提出 Harness 改进候选（检索策略、Skill、
 *   工具、循环策略）；不直接改写原始 Idea、论文或实验资料。
 *
 * 每个职责都可以通过普通对话调用（SCI-01：后台循环只是额外能力，不改变主
 * 聊天语义）；六类协作角色（planner/research/code/debug/data_analysis/writing）
 * 是低层可调用角色，RA/EA/EMA 是高层职责，映射关系见 SCIENCE_DUTIES。
 *
 * SCI-02：RA 接口 `raExplore`——输入当前 Graph 节点 + 历史，输出候选方向
 * 列表（纯函数 + LLM 注入点：缺省启发式 reasoner 保证无 LLM 也可确定性工作）。
 * SCI-03：EA 接口 `defineEaTask` / `eaTaskPrompt`——六类任务定义与投递文本，
 * 对接 t6/t12 的 ExperimentWorkspaceService / ExperimentProcessService
 * （实验目录 slug + 运行记录），只读 import 类型，不持有服务实例。
 * SCI-04：EMA 接口 `emaPropose`——只输出 Harness 候选（component/description/
 * diff/content/rationale），对接 t15 evolution registry 的 propose 签名。
 */
import type { TeamRole } from '../teams.js'
import { findTeamRole } from '../teams.js'
import { isMemoryNode, type GraphNode } from '../chat-graph.js'

/** 高层科研职责。 */
export type ScienceDuty = 'RA' | 'EA' | 'EMA'

/** 职责定义（SCI-01）。 */
export interface ScienceDutyDefinition {
  readonly duty: ScienceDuty
  readonly name: string
  /** 一句话描述。 */
  readonly description: string
  /** 职责范围（可做什么）。 */
  readonly scope: string
  /** 职责禁区（不可做什么）。 */
  readonly forbidden: string
  /** 映射到的现有六类角色 id（teams.ts；EMA 无直接六类映射）。 */
  readonly mapsToRoles: readonly string[]
  /** 系统提示词（中文；面向普通对话调用）。 */
  readonly systemPrompt: string
}

/** 三类高层职责定义（SCI-01，映射 TEAM_ROLES）。 */
export const SCIENCE_DUTIES: readonly ScienceDutyDefinition[] = [
  {
    duty: 'RA',
    name: 'Researcher Agent',
    description: 'Idea 探索与讨论：提出、比较、质疑、扩展与分支讨论（不设通过门槛）',
    scope: '提出与比较 Idea、质疑假设、扩展方向、从 Chat Graph/论文/历史讨论中寻找启发、保留无来源猜想',
    forbidden: '不宣布 Idea 是否"通过"；不实现代码；不运行实验；不直接改写论文与实验资料',
    mapsToRoles: ['research', 'planner'],
    systemPrompt: `你是 Researcher Agent（RA）。你只负责 Idea 的探索与讨论。

## 职责
1. 提出新的 Idea 或研究方向；
2. 比较多个 Idea 的优缺点、前提与风险；
3. 质疑当前假设，指出证据缺口；
4. 扩展或改写方向（"如果……会怎样"）；
5. 从当前 Chat Graph、论文和历史讨论中寻找启发。

## 禁区
- 不宣布哪个 Idea "通过"或"失败"——Idea 没有门槛，所有方向都值得保留；
- 不实现代码、不运行实验、不修改原始论文与实验资料；
- 无来源的猜想也可以提出并明确标注"未验证"。

## 输出
候选方向列表，每个方向用自然语言描述（可附来源：聊天/节点/论文）。`,
  },
  {
    duty: 'EA',
    name: 'Engineer Agent',
    description: '实现、运行与分析：复现、实现、超参尝试、消融、分析和失败复盘',
    scope: '把方向转成可运行实现：复现、实现、超参尝试、消融、分析、失败复盘；记录代码、命令、环境、日志和结果',
    forbidden: '不替用户决定研究方向；不删除或覆盖原始资料、用户稿件与实验产物',
    mapsToRoles: ['code', 'debug', 'data_analysis'],
    systemPrompt: `你是 Engineer Agent（EA）。你负责把一个或多个方向转成可运行的实现与实验。

## 职责
1. 复现已有结果（固定环境与版本）；
2. 实现新方法或修改代码；
3. 超参数尝试（记录每次配置与结果）；
4. 消融实验（每次只改变一个因素）；
5. 数据分析（统计检验、可视化，结论只基于数据）；
6. 失败复盘（记录失败原因与可复用经验）。

## 要求
- 保存代码、命令、环境（依赖版本）、日志和结果文件；
- 实验产物写入实验目录（<project>/experiments/<slug>/，产物放 artifacts/）；
- 不虚构数据或结果；失败要保留，不掩盖。

## 输出
任务完成说明：做了什么、命令与产物位置、结果与结论。`,
  },
  {
    duty: 'EMA',
    name: 'Evolution Manager Agent',
    description: '提出 Harness 改进候选：检索策略、Skill、工具与循环策略（不触碰科研内容）',
    scope: '观察长期交互中哪些检索策略、工具用法、Skill 和实验习惯有效；提出对 Harness 的改进候选（组件+说明+diff）',
    forbidden: '不直接改写原始 Idea、论文或实验资料；不修改科研笔记正文；候选未评估通过前不启用',
    mapsToRoles: [],
    systemPrompt: `你是 Evolution Manager Agent（EMA）。你观察长期交互，提出对 Harness（软件自身）的改进候选。

## 职责
1. 从弱点聚合（用户指出遗忘、旧原文回读、上下文移除、工具反复失败、检索改写）发现可改进点；
2. 每次只针对一个组件提出候选：检索策略、查询改写、Graph 邻域读取、上下文长度分配、Skill；
3. 候选 = 自然语言说明 + 代码 diff（纯文本统一格式）+ 依据（哪些信号/失败样本支撑）；
4. 候选先评估后启用，失败候选不启用，已启用候选可回滚。

## 禁区
- 不直接改写用户的 Idea、论文或实验资料；
- 不修改科研笔记正文；不把运行信息混入笔记；
- 不一次修改多个组件。

## 输出
一个候选：{ 组件, 说明, diff, 依据 }。`,
  },
]

/** 按职责查找定义。 */
export function findScienceDuty(duty: ScienceDuty): ScienceDutyDefinition {
  const found = SCIENCE_DUTIES.find((d) => d.duty === duty)
  if (!found) throw new Error(`未知科研职责: ${duty}`)
  return found
}

/** 职责 → 现有六类角色定义（EMA 无直接映射，返回 []）。 */
export function rolesForDuty(duty: ScienceDuty): TeamRole[] {
  return findScienceDuty(duty).mapsToRoles
    .map((id) => findTeamRole(id))
    .filter((role): role is TeamRole => role !== undefined)
}

/* ------------------------------------------------------------------ */
/* SCI-02：RA 接口（Idea 探索，纯函数 + LLM 注入点）                     */
/* ------------------------------------------------------------------ */

/** RA 输入：当前 Graph 节点 + 历史 + 用户当前想法。 */
export interface RaInput {
  /** 用户当前的想法/话题（自然语言）。 */
  readonly idea: string
  /** 当前 Graph 上下文（节点标题/内容摘要，来自 ChatGraphService.get 后精简）。 */
  readonly graphContext?: readonly GraphContextEntry[]
  /** 相关历史讨论文本（可来自 sessionHistoryText / 检索结果）。 */
  readonly history?: string
}

/** Graph 上下文条目（只读叶字段）。 */
export interface GraphContextEntry {
  readonly nodeId: string
  readonly title: string
  /** memory 节点内容摘要（可选）。 */
  readonly content?: string
}

/** RA 操作类型（SCI-02：提出/比较/质疑/扩展/分支）。 */
export type RaOperation = 'propose' | 'compare' | 'question' | 'extend' | 'branch'

/** RA 候选方向（无门槛：所有方向都保留）。 */
export interface RaDirection {
  readonly id: string
  readonly kind: RaOperation
  /** 自然语言方向描述。 */
  readonly text: string
  /** 引用的 Graph 节点 id / 历史来源。 */
  readonly sources?: readonly string[]
  /** branch 操作：建议 fork 的源节点 id（新会话继承该节点历史）。 */
  readonly branchFrom?: string
}

/** RA 推理注入点（LLM/子代理实现；缺省为启发式）。 */
export type RaReasoner = (input: RaInput, operation: RaOperation) => Promise<RaDirection[]>

let raIdCounter = 0
function nextRaId(): string {
  raIdCounter += 1
  return `ra-${Date.now()}-${raIdCounter}`
}

/**
 * 缺省 RA reasoner：无 LLM 时的确定性启发式——
 * 把 idea 按句子切分，按操作类型挑选候选句；compare 优先含"对比/还是"的句，
 * question 优先含"？"的句，extend 优先含"如果/进一步/扩展"的句，branch 把
 * 每个 graph 节点作为分支起点候选，否则整段 idea 为 propose。
 */
export async function defaultRaReasoner(input: RaInput, operation: RaOperation): Promise<RaDirection[]> {
  const directions: RaDirection[] = []
  const sentences = input.idea
    .split(/[\n。；;！!？?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
  const push = (kind: RaOperation, text: string, sources?: readonly string[], branchFrom?: string): void => {
    if (text.length === 0) return
    directions.push({ id: nextRaId(), kind, text, sources, branchFrom })
  }

  if (operation === 'branch') {
    // 分支讨论：当前 Graph 节点各为一个分支起点候选。
    const nodes = input.graphContext ?? []
    if (nodes.length === 0) push('branch', `围绕「${input.idea}」开新分支讨论`, [], undefined)
    for (const node of nodes) {
      push('branch', `从节点「${node.title}」分支继续讨论「${input.idea}」`, [node.nodeId], node.nodeId)
    }
    return directions
  }

  const picked = sentences.filter((sentence) => {
    if (operation === 'compare') return /(对比|比较|还是|vs|versus|区别)/.test(sentence)
    if (operation === 'question') return /(？|\?|是否|能不能|会不会|为什么|质疑|风险)/.test(sentence)
    if (operation === 'extend') return /(如果|进一步|扩展|延伸|要是|假设)/.test(sentence)
    return true // propose：全部候选句
  })
  if (picked.length === 0) push(operation, input.idea)
  else for (const sentence of picked) push(operation, sentence)

  // 有 Graph 上下文时，propose 附一条综合方向（引用上下文节点）。
  if (operation === 'propose' && (input.graphContext?.length ?? 0) > 0) {
    const nodeIds = input.graphContext?.map((n) => n.nodeId) ?? []
    push('propose', `综合当前讨论与节点线索，围绕「${input.idea}」提出新方向`, nodeIds)
  }
  return directions
}

/**
 * RA 探索入口（SCI-02）：输出候选方向列表。
 * 缺省用启发式 reasoner；上层可注入 LLM/子代理实现（如投递给 RA 角色对话）。
 */
export async function raExplore(
  input: RaInput,
  operation: RaOperation,
  reasoner: RaReasoner = defaultRaReasoner,
): Promise<RaDirection[]> {
  return reasoner(input, operation)
}

/* ------------------------------------------------------------------ */
/* SCI-03：EA 接口（任务定义，对接实验工作区/进程）                      */
/* ------------------------------------------------------------------ */

/** EA 任务类型（SCI-03）。 */
export const EA_KINDS = [
  'reproduce', // 复现
  'implement', // 实现
  'hyperparameter', // 超参尝试
  'ablation', // 消融
  'analysis', // 分析
  'postmortem', // 失败复盘
] as const

export type EaTaskKind = (typeof EA_KINDS)[number]

/** EA 任务（对接 t6/t12：experimentSlug 指向实验目录，运行记录由 ExperimentProcessService 管理）。 */
export interface EaTask {
  readonly taskId: string
  readonly kind: EaTaskKind
  readonly title: string
  /** 自然语言任务描述。 */
  readonly description: string
  /** 目标实验目录 slug（<workspace>/experiments/<slug>/；可空 = 待创建）。 */
  readonly experimentSlug?: string
  readonly workspaceDir?: string
  /** 要求保存的产物类别（代码/命令/环境/日志/结果）。 */
  readonly artifacts: readonly string[]
  readonly createdAt: number
  /** 状态：pending → running → done | failed。 */
  readonly status: 'pending' | 'running' | 'done' | 'failed'
}

/** EA 任务输入。 */
export interface EaTaskInput {
  readonly kind: EaTaskKind
  readonly title: string
  readonly description: string
  readonly experimentSlug?: string
  readonly workspaceDir?: string
}

let eaIdCounter = 0
function nextEaId(): string {
  eaIdCounter += 1
  return `ea-${Date.now()}-${eaIdCounter}`
}

/** 各任务类型的产物约定（PLAN：EA 负责保存代码、命令、环境、日志和产物）。 */
const EA_ARTIFACTS: Record<EaTaskKind, readonly string[]> = {
  reproduce: ['代码', '运行命令', '环境（依赖版本）', '日志', '结果文件'],
  implement: ['代码', '运行命令', '测试/验证结果'],
  hyperparameter: ['超参配置', '每次尝试的命令', '指标记录', '日志'],
  ablation: ['消融配置（每次只改一个因素）', '运行命令', '指标记录', '日志'],
  analysis: ['分析脚本', '图表', '统计结果'],
  postmortem: ['失败日志', '根因分析', '可复用经验'],
}

/** 定义 EA 任务（SCI-03；结构校验：kind/title/description 必填，实验 slug 可选）。 */
export function defineEaTask(input: EaTaskInput): EaTask {
  const kind = input.kind
  if (!EA_KINDS.includes(kind)) throw new Error(`未知 EA 任务类型: ${String(kind)}`)
  if (String(input.title).trim().length === 0) throw new Error('EA 任务标题不能为空')
  if (String(input.description).trim().length === 0) throw new Error('EA 任务描述不能为空')
  return {
    taskId: nextEaId(),
    kind,
    title: String(input.title).trim(),
    description: String(input.description).trim(),
    experimentSlug: input.experimentSlug,
    workspaceDir: input.workspaceDir,
    artifacts: EA_ARTIFACTS[kind],
    createdAt: Date.now(),
    status: 'pending',
  }
}

/** 任务状态迁移（纯函数）。 */
export function eaTaskTransition(task: EaTask, next: 'running' | 'done' | 'failed'): EaTask {
  if (task.status === 'done' || task.status === 'failed') return task
  return { ...task, status: next }
}

/** EA 任务投递文本（自然语言指令，可直接发给 EA 角色/子代理）。 */
export function eaTaskPrompt(task: EaTask): string {
  const lines = [
    `[EA 任务] ${task.title}`,
    '',
    `类型：${task.kind}`,
    '',
    task.description,
    '',
    '要求保存的产物：',
    ...task.artifacts.map((artifact) => `- ${artifact}`),
  ]
  if (task.experimentSlug) {
    lines.push('', `目标实验目录：<workspace>/experiments/${task.experimentSlug}/（产物放 artifacts/）`)
  }
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* SCI-04：EMA 接口（只输出 Harness 候选，对接 evolution registry）      */
/* ------------------------------------------------------------------ */

/** EMA 输入：弱点聚合 + 失败历史样本 + 现有组件版本。 */
export interface EmaInput {
  /** 弱点聚合文本（EVO-02 weaknessMarkdown 输出）。 */
  readonly weaknesses?: string
  /** 失败历史样本（EVO-05 EvaluationSample 的最小形态）。 */
  readonly failureSamples?: readonly {
    sampleId: string
    component: string
    input: string
    expected: string
  }[]
  /** 现有组件版本摘要（EVO-03 registry.versions 输出）。 */
  readonly currentVersions?: readonly { component: string; version: number; description: string }[]
}

/** EMA Harness 候选（对接 t15 CandidateRegistry.propose：component/description/diff/content）。 */
export interface EmaHarnessCandidate {
  /** 组件名（EVOLUTION_COMPONENTS 之一或扩展）。 */
  readonly component: string
  /** 自然语言说明。 */
  readonly description: string
  /** 代码 diff（纯文本统一格式；策略类组件可用行为说明性 diff）。 */
  readonly diff: string
  /** 组件内容载荷（可选）。 */
  readonly content?: string
  /** 依据（哪些信号/失败样本支撑）。 */
  readonly rationale?: string
}

/** EMA 推理注入点（LLM/子代理实现；缺省为启发式）。 */
export type EmaReasoner = (input: EmaInput) => Promise<EmaHarnessCandidate[]>

/** 弱点簇 → 组件映射（EVO-02 的聚类键前缀）。 */
function componentForWeaknessLine(line: string): string | null {
  if (line.includes('工具') || line.includes('反复失败')) return 'skill'
  if (line.includes('检索') || line.includes('说法')) return 'query-rewrite'
  if (line.includes('上下文') || line.includes('移除了')) return 'token-allocation'
  if (line.includes('遗忘')) return 'snippet-ranking'
  return null
}

/**
 * 缺省 EMA reasoner：从弱点聚合文本逐行提取候选（每类弱点 → 一个组件候选，
 * 一次只改一个组件；diff 为策略行为说明，不触碰科研内容）。
 */
export async function defaultEmaReasoner(input: EmaInput): Promise<EmaHarnessCandidate[]> {
  const candidates: EmaHarnessCandidate[] = []
  const seen = new Set<string>()
  const push = (component: string, description: string, rationale: string): void => {
    if (seen.has(component)) return // 同一轮一个组件只提一个候选（EVO-04）
    seen.add(component)
    candidates.push({
      component,
      description,
      diff: `--- before\n+++ after\n@@ component: ${component} @@\n- 当前行为\n+ 候选行为：${description.slice(0, 80)}`,
      rationale,
    })
  }
  for (const line of (input.weaknesses ?? '').split('\n')) {
    const component = componentForWeaknessLine(line)
    if (!component) continue
    push(component, `改进 ${component} 以缓解：「${line.trim().slice(0, 100)}」`, `来自弱点聚合：${line.trim().slice(0, 120)}`)
  }
  // 失败样本直接映射组件。
  for (const sample of input.failureSamples ?? []) {
    push(sample.component, `改进 ${sample.component} 以覆盖失败样本 ${sample.sampleId}`, `失败样本：${sample.input.slice(0, 80)}`)
  }
  return candidates
}

/** EMA 入口（SCI-04）：只输出 Harness 候选，不修改任何原始资料。 */
export async function emaPropose(
  input: EmaInput,
  reasoner: EmaReasoner = defaultEmaReasoner,
): Promise<EmaHarnessCandidate[]> {
  return reasoner(input)
}

/** 便捷：把 EMA 候选提交给 t15 候选注册表（只读 import 类型，由上层注入 registry）。 */
export interface EmaRegistrySink {
  propose(input: { component: string; description: string; diff: string; content?: string }): { candidateId: string }
}
export function emaSubmitCandidates(candidates: readonly EmaHarnessCandidate[], registry: EmaRegistrySink): string[] {
  return candidates.map((candidate) => registry.propose({
    component: candidate.component,
    description: candidate.description,
    diff: candidate.diff,
    content: candidate.content,
  }).candidateId)
}

/** Graph 节点 → RA 输入上下文条目（SCI-02 接线辅助）。 */
export function graphNodesToContext(nodes: readonly GraphNode[]): GraphContextEntry[] {
  return nodes.map((node) => ({
    nodeId: node.id,
    title: node.title,
    content: isMemoryNode(node) ? (node.content ?? node.ref?.path) : undefined,
  }))
}
