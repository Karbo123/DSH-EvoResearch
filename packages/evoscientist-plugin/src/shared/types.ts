/**
 * EvoScientist 插件共享类型（Host 与 Client 两侧共用的纯 JSON 数据模型）。
 *
 * 与 D:\EvoScientist 的 Python 实现保持字段级语义一致：
 * - 七类科研记忆分类（idea/method/experiment/related_work/reproduction/project/general）；
 * - Turn Catalog（research_turns）、Topic State（category_states）、Observation、Goal Contract；
 * - 项目工作区（projects/<name>/.evosci-data/ 隔离）。
 */

/** 科研记忆的七个类别（与 EvoScientist EvoMemory v2 一致，多标签）。 */
export const RESEARCH_CATEGORIES = [
  'idea',
  'method',
  'experiment',
  'related_work',
  'reproduction',
  'project',
  'general',
] as const

export type ResearchCategory = (typeof RESEARCH_CATEGORIES)[number]

/** 一轮对话（Turn）的状态。 */
export type TurnStatus =
  | 'pending' // 已记录、尚未完成（模型正在回答或刚收到用户消息）
  | 'completed' // 正常完成
  | 'interrupted' // 被用户打断或 API 失败（v3 语义）
  | 'archived' // 已归档到 Raw Turn Archive（活跃 state 已裁剪）

/** 一轮对话在 Turn Catalog 中的记录。 */
export interface TurnRecord {
  /** 稳定 turn id（UUID，字符串）。 */
  readonly turnId: string
  /** 所属会话（DSH SessionId）。 */
  readonly sessionId: string
  /** 所属项目目录绝对路径（workspace_dir），无项目时为空。 */
  readonly workspaceDir: string
  /** 该轮的第一条用户消息文本。 */
  readonly userText: string
  /** 模型最终回答文本（可为空）。 */
  readonly assistantText: string
  /** 分类器给出的多标签分类。 */
  readonly categories: readonly ResearchCategory[]
  /** 归一化后的 topic key 列表。 */
  readonly topicKeys: readonly string[]
  /** 状态。 */
  readonly status: TurnStatus
  /** 记录时间（毫秒时间戳）。 */
  readonly createdAt: number
  /** 最后更新时间。 */
  readonly updatedAt: number
  /** 是否由「继续」消息映射回原轮（v3 turn_continuation_messages）。 */
  readonly continuedFrom?: string
  /** v3：模型响应是否已开始流式输出。 */
  readonly responseStarted?: boolean
  /** v3：打断原因（user_stop | api_failure）。 */
  readonly interruptReason?: 'user_stop' | 'api_failure'
  /** 打断时生成的 Partial Turn Note 文本。 */
  readonly partialNote?: string
  /** v3：工作摘要（滚动整理时生成）。 */
  readonly workingSummary?: string
}

/** Topic State：每个类别/主题维护的当前科研状态。 */
export interface TopicState {
  readonly category: ResearchCategory
  readonly topicKey: string
  /** 人类可读的展示标签。 */
  readonly label: string
  /** 当前决定（结论）。 */
  readonly decision: string
  /** 开放问题。 */
  readonly openQuestions: string[]
  /** 来源 turn id 列表。 */
  readonly sourceTurnIds: readonly string[]
  /** 最近更新时间。 */
  readonly updatedAt: number
}

/** 长期 Observation（Markdown 文件 + frontmatter 的索引镜像）。 */
export interface ObservationMeta {
  readonly observationId: string
  /** 文件名（含 .md 后缀）。 */
  readonly fileName: string
  readonly title: string
  readonly content: string
  readonly categories: readonly ResearchCategory[]
  readonly primaryCategory?: ResearchCategory
  readonly topicKeys: readonly string[]
  readonly entities: readonly string[]
  readonly sourceTurnIds: readonly string[]
  /** active | superseded（supersede 保留旧文件标记，检索默认只出 ACTIVE）。 */
  readonly status: 'active' | 'superseded'
  /** 被谁取代（observation id）。 */
  readonly supersededBy?: string
  readonly projectId?: string
  readonly createdAt: number
  readonly updatedAt: number
}

/** 检索结果条目（混合召回：FTS5 + 可选向量，RRF 融合）。 */
export interface MemoryHit {
  readonly kind: 'turn' | 'observation'
  readonly id: string
  readonly score: number
  readonly category: ResearchCategory | undefined
  readonly topicKey: string | undefined
  readonly snippet: string
  readonly createdAt: number
}

/** 每轮注入的记忆包（<research_memory_packet>），默认 6000 token 预算。 */
export interface MemoryPacket {
  /** 类别一行目录（category_catalog）。 */
  readonly catalog: ReadonlyArray<{ category: ResearchCategory; count: number }>
  /** 每个活跃类别的最佳 state（+同类别高分补充候选入口）。 */
  readonly states: readonly TopicState[]
  /** RRF 融合的候选条目（类别加权、不硬过滤）。 */
  readonly hits: readonly MemoryHit[]
  /** read_more 提示（可继续读取的 turn id 列表）。 */
  readonly readMoreTurnIds: readonly string[]
  /** 实际注入文本。 */
  readonly text: string
  /** 估算 token 数。 */
  readonly estimatedTokens: number
}

/** 科研项目信息（projects/<name>/）。 */
export interface ProjectInfo {
  readonly name: string
  readonly path: string
  readonly dataDir: string
  readonly createdAt: number
}

/** v3 Goal Contract：长程目标合同。 */
export interface GoalContract {
  readonly goalId: string
  readonly title: string
  readonly objective: string
  /** 成功标准（evidence-linked）。 */
  readonly criteria: ReadonlyArray<{ id: string; text: string; satisfied: boolean; evidence: readonly string[] }>
  /** 范围约束。 */
  readonly constraints: readonly string[]
  readonly version: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** AutoSkills 提案。存储模型字段可变（审核状态流转）。 */
export interface AutoSkillProposal {
  proposalId: string
  name: string
  description: string
  /** 操作类型：create | update。 */
  action: 'create' | 'update'
  targetSkill?: string
  content: string
  sourceObservationIds: readonly string[]
  status: 'pending' | 'approved' | 'rejected'
  createdAt: number
}

/** 定时任务（cron）。存储模型字段可变（调度器内部更新运行状态）。 */
export interface ScheduledTask {
  taskId: string
  name: string
  /** cron 表达式（5 字段：分 时 日 月 周）。 */
  cron: string
  /** 触发时发送给主对话的指令文本。 */
  prompt: string
  workspaceDir: string
  enabled: boolean
  lastRunAt?: number
  lastResultThreadId?: string
  createdAt: number
}

/** 通道适配器状态。 */
export interface ChannelStatus {
  readonly id: string
  readonly name: string
  readonly online: boolean
  readonly received: number
  readonly sent: number
  readonly error?: string
}
