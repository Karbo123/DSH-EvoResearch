/**
 * 科研记忆 回读助手（read.ts）—— RET-03/05/06/07/08 的纯逻辑层。
 *
 * 供模型工具（tools.ts）与 Remote API（队长整合 api.ts 时）共用；只依赖 store，
 * 不依赖 cordis/dsh-tools，可直接单元测试：
 * - expandFragmentContext：检索命中自动扩展相邻消息（RET-08）；
 * - readConversationRange：按位置向前/向后翻页读取会话原文（RET-05）；
 * - turnDetail：完整轮次原文（assistant/工具片段/中断信息，兼容旧字段）（RET-06）；
 * - readMemoryFilePaged：记忆文件 offset/cursor 分页（RET-07）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ResearchMemoryStore, TurnFragment } from './store.js'

/** 会话原文序列中的一条（位置 = turnId + segSeq）。 */
export interface ConversationItem {
  readonly turnId: string
  readonly segSeq: number
  readonly kind: string
  readonly text: string
  readonly turnCreatedAt: number
}

/** 片段命中扩展（RET-08）：命中前后相邻消息。 */
export interface FragmentContext {
  readonly prev: readonly ConversationItem[]
  readonly anchor: ConversationItem | undefined
  readonly next: readonly ConversationItem[]
}

/** 检索命中的可定位形状（RET-03：位置 + 前后文，不再是不可展开的短摘要）。 */
export interface LocatableFragmentHit {
  readonly kind: 'fragment'
  readonly id: string
  readonly turnId: string
  readonly sessionId: string
  readonly snippet: string
  /** 回到会话原文的位置：归档段序号 + 段内偏移。 */
  readonly position: { segSeq: number; fragIndex: number; charOffset: number; charLen: number }
  readonly prev: readonly ConversationItem[]
  readonly next: readonly ConversationItem[]
  readonly score: number
  readonly category: string | undefined
  readonly createdAt: number
}

/** 命中相邻扩展（RET-08）：默认前后各 2 条。 */
export function expandFragmentContext(
  store: ResearchMemoryStore,
  sessionId: string,
  anchorTurnId: string,
  anchorSegSeq: number,
  beforeN = 2,
  afterN = 2,
): FragmentContext {
  const items = store.conversationSegments(sessionId)
  const index = items.findIndex((item) => item.turnId === anchorTurnId && item.segSeq === anchorSegSeq)
  if (index === -1) return { prev: [], anchor: undefined, next: [] }
  const start = Math.max(0, index - beforeN)
  const end = Math.min(items.length, index + afterN + 1)
  return {
    prev: items.slice(start, index),
    anchor: items[index],
    next: items.slice(index + 1, end),
  }
}

/** 片段命中 → 可定位命中（含前后文；RET-03/RET-08）。 */
export function expandFragmentHit(
  store: ResearchMemoryStore,
  fragment: TurnFragment,
  score: number,
  contextBefore = 2,
  contextAfter = 2,
): LocatableFragmentHit {
  const context = expandFragmentContext(store, fragment.sessionId, fragment.turnId, fragment.segSeq, contextBefore, contextAfter)
  const turn = store.getTurn(fragment.turnId)
  return {
    kind: 'fragment',
    id: fragment.fragmentId,
    turnId: fragment.turnId,
    sessionId: fragment.sessionId,
    snippet: fragment.content.slice(0, 300),
    position: {
      segSeq: fragment.segSeq,
      fragIndex: fragment.fragIndex,
      charOffset: fragment.charOffset,
      charLen: fragment.charLen,
    },
    prev: context.prev,
    next: context.next,
    score: Number(score.toFixed(4)),
    category: turn?.categories[0],
    createdAt: fragment.createdAt,
  }
}

/** 翻页读取选项（RET-05）。 */
export interface RangeReadOptions {
  /** 锚点（来自检索命中的 position.seg_seq）：围绕它取窗口。 */
  readonly anchor?: { turnId: string; segSeq: number }
  /** 锚点模式：锚前条数（默认 2）。 */
  readonly before?: number
  /** 锚点模式：锚后条数（默认 2）。 */
  readonly after?: number
  /** 无锚点模式：返回最近 N 条（默认 20，最新优先）。 */
  readonly limit?: number
  /** 无锚点模式：偏移（向前翻旧页用）。 */
  readonly offset?: number
}

/** 翻页读取结果（RET-05）。 */
export interface RangeReadResult {
  readonly items: readonly ConversationItem[]
  /** 锚点在返回窗口内的下标（无锚点/未找到为 null）。 */
  readonly anchorIndex: number | null
  readonly hasMoreBefore: boolean
  readonly hasMoreAfter: boolean
  readonly total: number
}

/** 按位置向前/向后读取会话原文（RET-05）。 */
export function readConversationRange(store: ResearchMemoryStore, sessionId: string, options: RangeReadOptions = {}): RangeReadResult {
  const items = store.conversationSegments(sessionId)
  if (options.anchor) {
    const index = items.findIndex((item) => item.turnId === options.anchor!.turnId && item.segSeq === options.anchor!.segSeq)
    if (index === -1) {
      return { items: [], anchorIndex: null, hasMoreBefore: false, hasMoreAfter: false, total: items.length }
    }
    const before = options.before ?? 2
    const after = options.after ?? 2
    const start = Math.max(0, index - before)
    const end = Math.min(items.length, index + after + 1)
    return {
      items: items.slice(start, end),
      anchorIndex: index - start,
      hasMoreBefore: start > 0,
      hasMoreAfter: end < items.length,
      total: items.length,
    }
  }
  const limit = options.limit ?? 20
  const offset = options.offset ?? 0
  const end = Math.max(0, items.length - offset)
  const start = Math.max(0, end - limit)
  return {
    items: items.slice(start, end),
    anchorIndex: null,
    hasMoreBefore: start > 0,
    hasMoreAfter: false,
    total: items.length,
  }
}

/** 工具段 payload 的展示结构（RET-06：完整工具 JSON + 文件位置）。 */
export interface ToolSegmentView {
  readonly seq: number
  readonly kind: string
  readonly callId: string
  readonly name?: string
  readonly arguments?: string
  readonly argumentsFile?: string
  readonly result?: string
  readonly resultFile?: string
  readonly error?: string
  /** 长结果文件是否存在（resultFile 落盘时）。 */
  readonly resultFileExists?: boolean
  readonly argumentsFileExists?: boolean
}

/** 完整轮次原文（RET-06：assistant/工具片段/中断信息；旧字段保持兼容）。 */
export interface TurnDetail {
  readonly turn: {
    readonly turnId: string
    readonly userText: string
    readonly assistantText: string
    readonly categories: readonly string[]
    readonly topicKeys: readonly string[]
    readonly status: string
    readonly createdAt: number
    readonly workingSummary?: string
    // RET-06 新增：中断信息
    readonly partialNote?: string
    readonly interruptReason?: string
    readonly responseStarted?: boolean
  }
  readonly segments: Array<{ seq: number; kind: string; text?: string; tool?: ToolSegmentView }>
}

/** 读取一轮完整原文（RET-06；兼容旧调用：turn 对象字段全部保留）。 */
export function turnDetail(store: ResearchMemoryStore, turnId: string): TurnDetail | undefined {
  const turn = store.getTurn(turnId)
  if (!turn) return undefined
  const segments = store.listSegments(turnId).map((segment) => {
    if (segment.kind === 'tool') {
      let tool: ToolSegmentView | undefined
      try {
        const parsed = JSON.parse(segment.payload) as Record<string, unknown>
        const base: ToolSegmentView = {
          seq: typeof parsed.seq === 'number' ? parsed.seq : segment.seq,
          kind: String(parsed.kind ?? 'result'),
          callId: String(parsed.callId ?? ''),
          ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
          ...(typeof parsed.arguments === 'string' ? { arguments: parsed.arguments } : {}),
          ...(typeof parsed.argumentsFile === 'string' ? { argumentsFile: parsed.argumentsFile } : {}),
          ...(typeof parsed.result === 'string' ? { result: parsed.result } : {}),
          ...(typeof parsed.resultFile === 'string' ? { resultFile: parsed.resultFile } : {}),
          ...(parsed.error !== undefined ? { error: String(parsed.error) } : {}),
        }
        tool = {
          ...base,
          ...(base.resultFile !== undefined ? { resultFileExists: fs.existsSync(base.resultFile) } : {}),
          ...(base.argumentsFile !== undefined ? { argumentsFileExists: fs.existsSync(base.argumentsFile) } : {}),
        }
      } catch {
        tool = undefined
      }
      return { seq: segment.seq, kind: segment.kind, tool }
    }
    return { seq: segment.seq, kind: segment.kind, text: segment.payload }
  })
  return {
    turn: {
      turnId: turn.turnId,
      userText: turn.userText,
      assistantText: turn.assistantText,
      categories: [...turn.categories],
      topicKeys: [...turn.topicKeys],
      status: turn.status,
      createdAt: turn.createdAt,
      ...(turn.workingSummary ? { workingSummary: turn.workingSummary } : {}),
      ...(turn.partialNote ? { partialNote: turn.partialNote } : {}),
      ...(turn.interruptReason ? { interruptReason: turn.interruptReason } : {}),
      ...(turn.responseStarted !== undefined ? { responseStarted: turn.responseStarted } : {}),
    },
    segments,
  }
}

/** 记忆文件分页读取（RET-07）：offset/cursor 翻页，不再固定截断 6000 字符。 */
export interface PagedFileRead {
  readonly content: string
  readonly path: string
  readonly offset: number
  readonly limit: number
  readonly totalChars: number
  readonly hasMore: boolean
}

/** 默认每页字符数（与旧 read_memory 行为一致）。 */
export const MEMORY_PAGE_CHARS = 6000
/** 单页上限。 */
export const MEMORY_PAGE_MAX = 20000

/** 读取记忆文件的一页（offset=0、缺省 limit 时与旧行为完全一致）。 */
export function readMemoryFilePaged(memoriesRoot: string, relPath: string, offset = 0, limit = MEMORY_PAGE_CHARS): PagedFileRead | { error: string } {
  const target = path.resolve(memoriesRoot, relPath)
  if (!target.startsWith(memoriesRoot + path.sep) && target !== memoriesRoot) {
    return { error: '路径越界：只允许读取 .evoresearch-data/memories 内的文件' }
  }
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    return { error: `文件不存在: ${relPath}` }
  }
  const content = fs.readFileSync(target, 'utf8')
  if (content.includes('\u0000')) return { error: '二进制文件无法直接读取' }
  const safeOffset = Math.max(0, offset)
  const safeLimit = Math.min(Math.max(1, limit), MEMORY_PAGE_MAX)
  return {
    content: content.slice(safeOffset, safeOffset + safeLimit),
    path: relPath,
    offset: safeOffset,
    limit: safeLimit,
    totalChars: content.length,
    hasMore: safeOffset + safeLimit < content.length,
  }
}
