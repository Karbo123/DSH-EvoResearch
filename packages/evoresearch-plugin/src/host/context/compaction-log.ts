/**
 * CTX-16 compaction 事件记录与查询。
 *
 * 记录 start/summary/end、消息范围、摘要版本；写入会话日志/事件档案
 * （JSONL 追加 + 内存索引），原始会话事件只读、绝不被本层修改。
 * 提供查询方法：按会话 / 触发方式 / 状态 / 时间过滤。
 */
import type { CompactionQuery, CompactionRecord } from './types.js'

/** 日志文件行（JSONL）。 */
export function toCompactionLine(record: CompactionRecord): string {
  return JSON.stringify(record)
}

/** 从 JSONL 行解析记录；损坏行返回 undefined（容忍旧数据/截断尾行）。 */
export function parseCompactionLine(line: string): CompactionRecord | undefined {
  const trimmed = line.trim()
  if (trimmed === '') return undefined
  try {
    const value = JSON.parse(trimmed) as unknown
    if (value && typeof value === 'object' && typeof (value as CompactionRecord).compactionId === 'string') {
      return value as CompactionRecord
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * 纯过滤函数：按查询条件筛选记录（按 startedAt 倒序，limit 截取最近）。
 */
export function filterCompactions(records: readonly CompactionRecord[], query: CompactionQuery = {}): CompactionRecord[] {
  let filtered = records.filter((record) => {
    if (query.sessionId !== undefined && record.sessionId !== query.sessionId) return false
    if (query.trigger !== undefined && record.trigger !== query.trigger) return false
    if (query.status !== undefined && record.status !== query.status) return false
    if (query.since !== undefined && record.startedAt < query.since) return false
    return true
  })
  filtered = [...filtered].sort((a, b) => b.startedAt - a.startedAt)
  if (query.limit !== undefined && query.limit > 0) filtered = filtered.slice(0, query.limit)
  return filtered
}

/** 某会话的摘要版本号（第几次压缩；从既有记录推导，原子性由调用方保证）。 */
export function nextSummaryVersion(records: readonly CompactionRecord[], sessionId: string): number {
  const versions = records
    .filter((record) => record.sessionId === sessionId && typeof record.summaryVersion === 'number')
    .map((record) => record.summaryVersion ?? 0)
  return versions.length === 0 ? 1 : Math.max(...versions) + 1
}

/** 折叠输入：DSH compaction 事件 + 运行时提供的事件归属信息。 */
export interface CompactionFoldContext {
  /** 事件所属会话 id（DSH compaction 事件 data 中不含 sessionId）。 */
  readonly sessionId?: string
  /** 事件时间（DSH 事件信封的 time；缺省用 Date.now()）。 */
  readonly now?: number
}

/** 折叠结果：新记录列表 + 本轮变更的记录（供持久化钩子精确追加）。 */
export interface CompactionFoldResult {
  readonly records: readonly CompactionRecord[]
  readonly changed: boolean
  /** 本次新增或修改的记录（持久化只写这些）。 */
  readonly changedRecords: readonly CompactionRecord[]
}

/**
 * 把 compaction/start|summary|end 事件折叠进记录（运行时的 DSH 事件适配入口）。
 * 纯函数：输入不可变，返回新数组。
 */
export function foldCompactionEvent(
  records: readonly CompactionRecord[],
  event: { readonly type: string; readonly data?: unknown },
  context: CompactionFoldContext = {},
): CompactionFoldResult {
  const type = event.type
  const data = (event.data ?? {}) as Record<string, unknown>
  const compactionId = typeof data.compactionId === 'string' ? data.compactionId : undefined
  if (compactionId === undefined) return { records, changed: false, changedRecords: [] }
  const now = context.now ?? Date.now()

  if (type === 'compaction/start') {
    const existing = records.find((record) => record.compactionId === compactionId)
    if (existing) return { records, changed: false, changedRecords: [] }
    const record: CompactionRecord = {
      compactionId,
      sessionId: context.sessionId ?? '',
      trigger: 'auto',
      status: 'running',
      startedAt: now,
      source: 'dsh',
    }
    return { records: [...records, record], changed: true, changedRecords: [record] }
  }

  const index = records.findIndex((record) => record.compactionId === compactionId)
  if (index < 0) return { records, changed: false, changedRecords: [] }
  const base = records[index]!

  if (type === 'compaction/summary') {
    const shadowed = (data.shadowedRange ?? {}) as { start?: unknown; end?: unknown }
    const shadowedSeqs = Array.isArray(data.shadowedSeqs) ? (data.shadowedSeqs as unknown[]).map(Number) : []
    const shadowedTokenCount = typeof data.shadowedTokenCount === 'number' ? data.shadowedTokenCount : undefined
    const summaryText = extractSummaryText(data.summary)
    const record: CompactionRecord = {
      ...base,
      messageRange: {
        start: typeof shadowed.start === 'number' ? shadowed.start : 0,
        end: typeof shadowed.end === 'number' ? shadowed.end : 0,
        shadowedSeqs,
        shadowedTokenCount,
      },
      summaryText,
      summaryVersion: nextSummaryVersion(records, base.sessionId),
    }
    return { records: records.map((r, i) => (i === index ? record : r)), changed: true, changedRecords: [record] }
  }

  if (type === 'compaction/end') {
    const error = typeof data.error === 'string' ? data.error : undefined
    const record: CompactionRecord = {
      ...base,
      status: error === undefined ? 'completed' : 'failed',
      endedAt: now,
      error,
    }
    return { records: records.map((r, i) => (i === index ? record : r)), changed: true, changedRecords: [record] }
  }
  return { records, changed: false, changedRecords: [] }
}

/** 从 summary ContentBlock[]（或 text 字符串）提取摘要文本。 */
function extractSummaryText(summary: unknown): string | undefined {
  if (typeof summary === 'string') return summary
  if (!Array.isArray(summary)) return undefined
  const parts = summary
    .map((block) => {
      const b = block as { type?: unknown; text?: unknown }
      return typeof b?.text === 'string' ? b.text : ''
    })
    .filter((text) => text.length > 0)
  return parts.length > 0 ? parts.join('\n') : undefined
}

/**
 * 内存压缩日志：追加记录、查询、版本推导；通过可选持久化钩子写入 JSONL。
 * 线程模型：单一调用方（宿主事件循环）使用，无需锁。
 */
export class CompactionLog {
  private readonly records: CompactionRecord[] = []
  /** 持久化钩子（每追加/变更一条调用一次；失败由调用方捕获，不中断追加）。 */
  onAppend?: (record: CompactionRecord) => void

  /** 批量装载既有记录（启动恢复；损坏行跳过）。 */
  loadLines(lines: readonly string[]): void {
    for (const line of lines) {
      const record = parseCompactionLine(line)
      if (record) this.records.push(record)
    }
  }

  append(record: CompactionRecord): void {
    this.records.push(record)
    this.persist(record)
  }

  /** 折叠 DSH compaction 事件（compaction/start|summary|end）。 */
  fold(event: { readonly type: string; readonly data?: unknown }, context: CompactionFoldContext = {}): boolean {
    const { records, changed, changedRecords } = foldCompactionEvent(this.records, event, context)
    if (!changed) return false
    this.records.length = 0
    this.records.push(...records)
    for (const record of changedRecords) this.persist(record)
    return true
  }

  all(): readonly CompactionRecord[] {
    return this.records
  }

  query(query: CompactionQuery = {}): readonly CompactionRecord[] {
    return filterCompactions(this.records, query)
  }

  latestFor(sessionId: string): CompactionRecord | undefined {
    return filterCompactions(this.records, { sessionId, limit: 1 })[0]
  }

  /** 某会话下一个摘要版本号（第几次压缩）。 */
  nextSummaryVersion(sessionId: string): number {
    return nextSummaryVersion(this.records, sessionId)
  }

  private persist(record: CompactionRecord): void {
    try {
      this.onAppend?.(record)
    } catch {
      // 持久化失败不影响内存日志与聊天
    }
  }
}
