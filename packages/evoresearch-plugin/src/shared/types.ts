/**
 * EvoResearch 插件共享类型（Host 与 Client 两侧共用的纯 JSON 数据模型）。
 *
 * 字段级语义约定：
 * - 七类科研记忆分类（idea/method/experiment/related_work/reproduction/project/general）；
 * - Turn Catalog（research_turns）、Topic State（category_states）、Observation、Goal Contract；
 * - 项目工作区（projects/<name>/.evoresearch-data/ 隔离）。
 */

/** 科研记忆的七个类别（与 EvoResearch 科研记忆 一致，多标签）。 */
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
  /** 关联的其他 Observation id（link_observations 双向维护）。 */
  readonly relatedObservationIds: readonly string[]
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

/** Goal Contract 修改提案（§19.6：propose_goal_contract_update 只建待确认提案，不直接改合同）。 */
export interface GoalProposal {
  readonly proposalId: string
  readonly goalId: string
  readonly title: string
  /** 修改理由。 */
  readonly summary: string
  /** 待应用的部分合同字段（title/objective/criteria/constraints 子集）。 */
  readonly changes: Readonly<Partial<Pick<GoalContract, 'title' | 'objective' | 'criteria' | 'constraints'>>>
  readonly status: 'pending' | 'approved' | 'rejected'
  readonly createdAt: number
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
  /** §42.7：候选簇稳定哈希（排序后 Observation IDs 生成）。 */
  clusterHash?: string
  /** §42.8：所属工作区 / 项目 / 批准后安装路径。 */
  workspaceDir?: string
  projectId?: string
  installedPath?: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: number
}

/** 定时任务（cron）。存储模型字段可变（调度器内部更新运行状态）。 */export interface ScheduledTask {
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

/** 模型设置（设置面板，参照 ResearchOS）：代码三档 / 视觉 / 图片生成 / 语音。 */
export interface ModelTierSetting {
  readonly model: string
  readonly provider: string
  /** reasoning effort：low | medium | high。 */
  readonly reasoningEffort?: string
}

export interface ModelSettings {
  /** 写代码模型三档（§：lightweight/balanced/advanced）。 */
  readonly code: {
    readonly simple: ModelTierSetting
    readonly medium: ModelTierSetting
    readonly complex: ModelTierSetting
  }
  /** 图片识别（视觉）模型。 */
  readonly vision: ModelTierSetting & { readonly url?: string; readonly keyEnv?: string }
  /** 图片生成模型。 */
  readonly image: ModelTierSetting
  /** 语音识别：provider = api（OpenAI 兼容）/ local（预留本地引擎）。 */
  readonly voice: ModelTierSetting & { readonly url?: string; readonly keyEnv?: string; readonly provider?: string }
}

/** 默认模型设置（与 ResearchOS 三档语义对齐）。 */
export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  code: {
    simple: { model: '', provider: '', reasoningEffort: '' },
    medium: { model: '', provider: '', reasoningEffort: '' },
    complex: { model: '', provider: '', reasoningEffort: '' },
  },
  vision: { model: '', provider: '', url: '', keyEnv: 'VISION_API_KEY' },
  image: { model: '', provider: '' },
  voice: { model: '', provider: 'api', url: '', keyEnv: 'VOICE_API_KEY' },
}

// ── 实验管理（§5.1 Git 式分支/回退/checkpoint）──────────────────────────────

/** 实验检查点（工作区快照 + 元信息）。 */
export interface ExperimentCheckpoint {
  readonly id: string
  readonly name: string
  readonly note: string
  readonly createdAt: number
  /** 所属阶段 id（分支内）。 */
  readonly phaseId: string
  /** 快照目录（相对 <workspace>/.evoresearch-data/experiments/）。 */
  readonly snapshotDir: string
  /** 快照文件数与总字节。 */
  readonly files: number
  readonly bytes: number
  /** 创建检查点时的会话 id（可一键跳回）。 */
  readonly sessionId?: string
  /** 是否被回退过（rollback 记录）。 */
  readonly rolledBack?: boolean
}

/** 实验阶段（一个方向上的推进单元，按创建顺序排列）。 */
export interface ExperimentPhase {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly createdAt: number
  readonly checkpoints: readonly ExperimentCheckpoint[]
}

/** 实验分支（从某 checkpoint 分出，携带截至该检查点的阶段/检查点副本）。 */
export interface ExperimentBranch {
  readonly id: string
  readonly name: string
  /** 分支来源检查点 id（首个分支可无）。 */
  readonly fromCheckpointId?: string
  readonly createdAt: number
  readonly phases: readonly ExperimentPhase[]
}

/** 实验 manifest（<workspace>/.evoresearch-data/experiments/<id>.json）。 */
export interface ExperimentManifest {
  readonly id: string
  readonly name: string
  readonly description: string
  /** 所属工作区绝对路径。 */
  readonly workspaceDir: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly branches: readonly ExperimentBranch[]
  readonly currentBranchId: string
  /** 关联过的会话 id（跳回入口）。 */
  readonly sessionIds: readonly string[]
}

/** 实验列表摘要。 */
export interface ExperimentSummary {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly branchCount: number
  readonly phaseCount: number
  readonly checkpointCount: number
  readonly currentBranchId: string
}
