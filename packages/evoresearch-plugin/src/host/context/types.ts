/**
 * 上下文窗口保护层（CTX-13..19）共享类型。
 *
 * 与检索解耦：检索层（host/memory/*、host/chat-graph.ts）回答"找什么"，
 * 本层回答"当前这一轮能放多少"——窗口压力、压缩、工具结果裁剪、事件记录、
 * 历史修复与上下文来源查询。所有类型均为纯 JSON 可序列化的只读数据。
 *
 * 对齐 DSH rc.6 能力（@deepseek-ai/dsh-compaction、dsh-token-meter、
 * dsh-compaction-tool-result-pruner 的语义），但不直接依赖这些包：
 * 适配层用结构化接口探测运行时服务，缺失时明确降级，绝不抛异常中断聊天。
 */

/** 压力等级（level）。 */
export type PressureLevel = 'ok' | 'watch' | 'high' | 'critical' | 'unknown'

/** 压力数据来源。 */
export type PressureSource = 'token-meter' | 'heuristic' | 'unavailable'

/** 压力报告（CTX-14：估算 token / 窗口上限比例 + 触发建议）。 */
export interface PressureReport {
  readonly sessionId: string
  /** 模型窗口上限（token，已按 catalog/配置解析）。 */
  readonly windowTokens: number
  /** 当前投影估算 token 数。 */
  readonly estimatedTokens: number
  /** 占用比例 estimatedTokens / windowTokens（0..1+）。 */
  readonly ratio: number
  readonly level: PressureLevel
  readonly source: PressureSource
  /** 是否达到自动压缩触发阈值。 */
  readonly triggerAutoCompact: boolean
  /** 是否达到临界（建议溢出恢复路径）。 */
  readonly triggerOverflowRecovery: boolean
  /** 当前适配可用性（探测结果透传）。 */
  readonly adapter: { readonly compaction: boolean; readonly tokenMeter: boolean; readonly toolResultPruner: boolean }
}

/** 压缩触发方式。 */
export type CompactionTriggerKind = 'auto' | 'manual' | 'region' | 'overflow-retry'

/** 一次压缩记录的状态。 */
export type CompactionStatus =
  | 'running' // compaction/start 已登记，尚未收到 end
  | 'completed' // compaction/end 无 error
  | 'failed' // compaction/end 带 error，或适配调用抛错
  | 'degraded-noop' // DSH 压缩服务不可用：登记事件 + 接口待接，未实际压缩
  | 'skipped' // 阈值未到或没有可压缩范围（结果为空）

/** 压缩记录（CTX-16：start/summary/end、消息范围、摘要版本，只读不改原始事件）。 */
export interface CompactionRecord {
  /** 稳定压缩事务 id。 */
  readonly compactionId: string
  /** 所属会话 id。 */
  readonly sessionId: string
  /** 触发方式。 */
  readonly trigger: CompactionTriggerKind
  readonly status: CompactionStatus
  readonly startedAt: number
  readonly endedAt?: number
  /** 被压缩/遮蔽的消息范围（surface 位置 span；shadowedSeqs 为实际遮蔽 seq 集）。 */
  readonly messageRange?: {
    readonly start: number
    readonly end: number
    readonly shadowedSeqs: readonly number[]
    readonly shadowedTokenCount?: number
  }
  /** 摘要文本（compaction/summary 的文本块拼接）。 */
  readonly summaryText?: string
  /** 摘要版本（同一会话第几次压缩；供回读解释"当前上下文怎么来的"）。 */
  readonly summaryVersion?: number
  /** 记录来源：DSH 引擎事件，或本层登记。 */
  readonly source: 'dsh' | 'evoresearch'
  /** 失败原因（status=failed 时）。 */
  readonly error?: string
  /** 降级原因（status=degraded-noop 时）。 */
  readonly degradedReason?: string
}

/** 压缩记录查询条件（CTX-16 查询方法）。 */
export interface CompactionQuery {
  readonly sessionId?: string
  readonly trigger?: CompactionTriggerKind
  readonly status?: CompactionStatus
  /** 只返回 startedAt >= since 的记录。 */
  readonly since?: number
  /** 最多返回条数（按 startedAt 倒序取最近）。 */
  readonly limit?: number
}

/** 模型窗口规格：上限 + 压力阈值（CTX-14，默认对齐 DSH compaction-basic 策略）。 */
export interface WindowSpec {
  /** 模型上下文窗口（token）。 */
  readonly windowTokens: number
  /** 自动压缩触发比例（窗口占比），默认 0.8。 */
  readonly autoCompactThresholdRatio: number
  /** 关注线（watch），默认 0.6。 */
  readonly watchRatio: number
  /** 临界线（critical，触发溢出恢复路径），默认 0.95。 */
  readonly criticalRatio: number
  /** 压缩后保留的近程比例，默认 0.16。 */
  readonly retainRatio: number
  /** 上下文溢出最大重试次数，默认 1。 */
  readonly maxOverflowRetries: number
}

/** 工具结果裁剪预算（CTX-15：头部/中部/尾部保留）。 */
export interface PruneBudget {
  /** 超过该字符数才裁剪（Unicode code point 计）。 */
  readonly thresholdChars: number
  readonly headChars: number
  readonly middleChars: number
  readonly tailChars: number
}

/** 继续读取位置（完整原文归档：文件路径 + 字符偏移）。 */
export interface ContinueReadPosition {
  readonly path: string
  /** Unicode code point 偏移（从中部起点继续读）。 */
  readonly offset: number
}

/** 裁剪计划（纯函数结果）。 */
export interface PrunePlan {
  readonly action: 'keep' | 'prune'
  readonly head: string
  readonly middle: string
  readonly tail: string
  /** 被移除的字符数。 */
  readonly removedChars: number
  /** 继续读取偏移：完整原文归档中"中部"的起点。 */
  readonly continueOffset: number
}

/** 工具结果裁剪归档记录（CTX-15：完整结果存档 + 继续读取位置）。 */
export interface ToolResultArchiveRecord {
  readonly callId: string
  readonly toolName: string
  readonly sessionId: string
  readonly archivedAt: number
  readonly charsBefore: number
  readonly charsAfter: number
  /** 完整原文归档位置（文件路径 + 偏移 0）。 */
  readonly archive: ContinueReadPosition
  /** 继续读取位置：归档文件中被裁掉的中部起点。 */
  readonly continueRead: ContinueReadPosition
  /** 本轮注入的裁剪后文本。 */
  readonly prunedText: string
}

/** 单次压缩/溢出操作的结果（含结构化降级，绝不抛异常）。 */
export interface GuardActionResult {
  readonly ok: boolean
  /** 是否实际执行了压缩/裁剪（false = 降级 no-op 或阈值未到）。 */
  readonly applied: boolean
  /** 是否因 DSH 能力缺失而降级。 */
  readonly degraded: boolean
  readonly record: CompactionRecord
  /** 人类可读补充说明（给集成方 / 日志）。 */
  readonly detail?: string
}

/** 当前上下文来源条目（CTX-18）。 */
export type ContextSourceKind =
  | 'summary' // 压缩摘要
  | 'original-snippet' // 原文片段（surface 消息）
  | 'tool-result' // 工具结果（含裁剪归档）
  | 'graph-connection' // Chat Graph 连接
  | 'user-message'
  | 'assistant-message'

/** 来源位置（可继续深读的定位；与 search.ts 的 CandidateLocation 一一对应）。 */
export type ContextSourceLocation =
  | { readonly kind: 'event'; readonly sessionId: string; readonly seq: number }
  | { readonly kind: 'archive'; readonly path: string; readonly offset: number }
  | { readonly kind: 'graph'; readonly nodeId: string }
  | { readonly kind: 'turn'; readonly turnId: string }
  | { readonly kind: 'segment'; readonly turnId: string; readonly segmentId: string }
  | { readonly kind: 'note'; readonly noteId: string; readonly offset: number }
  | { readonly kind: 'chat'; readonly sessionId: string }
  | { readonly kind: 'observation'; readonly observationId: string }
  | { readonly kind: 'background'; readonly docKind: string }
  | { readonly kind: 'resource'; readonly path: string; readonly offset?: number; readonly page?: number }
  | { readonly kind: 'inline' }

export interface ContextSourceEntry {
  readonly kind: ContextSourceKind
  readonly id: string
  readonly label: string
  /** 简短可读说明（给用户/Agent 解释"这段是怎么来的"）。 */
  readonly detail: string
  readonly estimatedTokens: number
  readonly location: ContextSourceLocation
}

/** 当前上下文来源报告（CTX-18）。 */
export interface ContextSourceReport {
  readonly sessionId: string
  readonly entries: readonly ContextSourceEntry[]
  readonly totals: {
    readonly summaries: number
    readonly originalSnippets: number
    readonly toolResults: number
    readonly graphConnections: number
    readonly estimatedTokens: number
  }
}

/** 会话事件的最小投影信息（来源查询输入，避免依赖 DSH 事件全量结构）。 */
export interface SurfaceEventInfo {
  readonly seq: number
  readonly type: string
  readonly label: string
  readonly estimatedTokens: number
}

/** Graph 连接信息（来源查询输入）。 */
export interface GraphConnectionInfo {
  readonly nodeId: string
  readonly label: string
}
