/**
 * CTX-18 当前上下文来源查询（纯函数模块）。
 *
 * 给定一组的输入事实（压缩记录、surface 事件、工具结果归档、Graph 连接），
 * 生成"本轮投影由什么构成"的可读结构：每段材料来自哪个摘要/原文片段/
 * 工具结果/Graph 连接、估算 token、可继续深读的位置。
 * 运行时（guard.ts）负责收集这些事实；本模块只做组合与统计。
 */
import type {
  CompactionRecord,
  ContextSourceEntry,
  ContextSourceLocation,
  ContextSourceReport,
  GraphConnectionInfo,
  SurfaceEventInfo,
  ToolResultArchiveRecord,
} from './types.js'
import type { CandidateLocation, SearchCandidate } from './search.js'
import { estimateProjectionTokens } from './window.js'

/**
 * 组装器候选 → CTX-18 来源条目（协同闭环：assembler 的 [定位:] 与
 * ContextSourceReport 一一对应）。Graph 节点映射为 graph-connection，
 * 其余（turn/segment/note/observation/chat/background）映射为 original-snippet。
 */
export function candidatesToContextSources(
  sessionId: string,
  candidates: readonly SearchCandidate[],
): ContextSourceEntry[] {
  return candidates.map((candidate) => ({
    kind: candidate.kind === 'graph' ? 'graph-connection' : 'original-snippet',
    id: candidate.id,
    label: candidate.title,
    detail: `来自 ${candidate.sourceLabel}${candidate.connected ? '（Graph 明确连接）' : ''}`,
    estimatedTokens: candidate.estimatedTokens,
    location: locationOf(candidate.location, sessionId),
  }))
}

/** CandidateLocation → ContextSourceLocation（保真映射，无信息丢失）。 */
export function locationOf(location: CandidateLocation, sessionId: string): ContextSourceLocation {
  switch (location.kind) {
    case 'turn': return { kind: 'turn', turnId: location.turnId }
    case 'segment': return { kind: 'segment', turnId: location.turnId, segmentId: location.segmentId }
    case 'note': return { kind: 'note', noteId: location.noteId, offset: location.offset }
    case 'observation': return { kind: 'observation', observationId: location.observationId }
    case 'graph': return { kind: 'graph', nodeId: location.nodeId }
    case 'chat': return { kind: 'chat', sessionId: location.sessionId }
    case 'background': return { kind: 'background', docKind: location.docKind }
    case 'resource': return { kind: 'inline' }
    default: return { kind: 'inline' }
  }
}

/** 描述输入。 */
export interface DescribeContextSourcesInput {
  readonly sessionId: string
  /** 该会话的压缩记录（含摘要文本与消息范围）。 */
  readonly compactions?: readonly CompactionRecord[]
  /** 当前 surface 的普通消息事件（原文片段/消息）。 */
  readonly surfaceEvents?: readonly SurfaceEventInfo[]
  /** 该会话已裁剪的工具结果归档记录。 */
  readonly prunedToolResults?: readonly ToolResultArchiveRecord[]
  /** 该会话的 Graph 直接连接。 */
  readonly graphConnections?: readonly GraphConnectionInfo[]
  /** 是否把 surface 事件细分为 user/assistant 消息（默认 true）。 */
  readonly detailMessages?: boolean
}

/**
 * 组合当前上下文来源报告。
 * 排序约定：摘要（旧→新）→ Graph 连接 → 原文消息（旧→新）→ 工具结果归档。
 */
export function describeContextSources(input: DescribeContextSourcesInput): ContextSourceReport {
  const sessionId = input.sessionId
  const entries: ContextSourceEntry[] = []

  // 1) 压缩摘要（CTX-16 记录 → 摘要来源）
  const compactions = [...(input.compactions ?? [])].sort((a, b) => a.startedAt - b.startedAt)
  for (const record of compactions) {
    const summary = record.summaryText ?? '（无摘要文本）'
    const range = record.messageRange
      ? `消息范围 ${rangeLabel(record.messageRange.shadowedSeqs)}`
      : '消息范围未知'
    const version = record.summaryVersion !== undefined ? ` #${record.summaryVersion}` : ''
    entries.push({
      kind: 'summary',
      id: record.compactionId,
      label: `压缩摘要${version}`,
      detail: `${summary.slice(0, 120)}（${range}，状态 ${record.status}）`,
      estimatedTokens: estimateProjectionTokens(summary),
      location: { kind: 'inline' },
    })
  }

  // 2) Graph 连接（来源查询输入）
  for (const connection of input.graphConnections ?? []) {
    entries.push({
      kind: 'graph-connection',
      id: connection.nodeId,
      label: `Graph 连接 ${connection.label}`,
      detail: '来自当前会话的 Chat Graph 直接连接（持续参考）',
      estimatedTokens: 0,
      location: { kind: 'graph', nodeId: connection.nodeId },
    })
  }

  // 3) 原文消息（surface 事件）
  for (const event of input.surfaceEvents ?? []) {
    const kind = event.type.startsWith('assistant') ? 'assistant-message' : 'user-message'
    entries.push({
      kind: input.detailMessages === false ? 'original-snippet' : kind,
      id: `event:${event.seq}`,
      label: `${kind === 'user-message' ? '用户' : '助手'}消息 @${event.seq}`,
      detail: event.label,
      estimatedTokens: event.estimatedTokens,
      location: { kind: 'event', sessionId, seq: event.seq },
    })
  }

  // 4) 工具结果归档（CTX-15 记录 → 裁剪来源 + 继续读取位置）
  for (const record of input.prunedToolResults ?? []) {
    entries.push({
      kind: 'tool-result',
      id: `tool:${record.callId}`,
      label: `工具结果 ${record.toolName}(${record.callId})`,
      detail: `已裁剪 ${record.charsBefore} → ${record.charsAfter} 字符；完整原文在 ${record.archive.path}，继续读取偏移 ${record.continueRead.offset}`,
      estimatedTokens: estimateProjectionTokens(record.prunedText),
      location: { kind: 'archive', path: record.archive.path, offset: record.continueRead.offset },
    })
  }

  const totals = {
    summaries: entries.filter((entry) => entry.kind === 'summary').length,
    originalSnippets: entries.filter((entry) => entry.kind === 'original-snippet').length,
    toolResults: entries.filter((entry) => entry.kind === 'tool-result').length,
    graphConnections: entries.filter((entry) => entry.kind === 'graph-connection').length,
    estimatedTokens: entries.reduce((sum, entry) => sum + entry.estimatedTokens, 0),
  }
  return { sessionId, entries, totals }
}

/** 消息范围的可读标签（seq 列表或 start..end）。 */
function rangeLabel(shadowedSeqs: readonly number[]): string {
  if (shadowedSeqs.length === 0) return '（空）'
  if (shadowedSeqs.length === 1) return `${shadowedSeqs[0]}`
  const sorted = [...shadowedSeqs].sort((a, b) => a - b)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (last !== undefined && first !== undefined && sorted.length === last - first + 1) {
    return `${first}..${last}（${sorted.length} 条）`
  }
  return `${sorted.join(',')}`
}
