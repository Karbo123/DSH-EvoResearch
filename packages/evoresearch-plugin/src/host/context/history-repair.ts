/**
 * CTX-17 tool-history repair：检测工具调用序列中断/缺配对消息，
 * 生成修复后的请求投影（修复前后分别保存），供重试。
 *
 * 纯函数模块：输入输出均为可序列化的最小消息结构（不依赖 DSH 类型，
 * 运行时由 guard.ts 从会话事件投影出这些结构）。语义对齐
 * dsh-session/repair 的 TOOL_NOT_STARTED / TOOL_OUTCOME_UNKNOWN 分类。
 */
import { randomUUID } from 'node:crypto'

/** 文本块。 */
export interface RepairTextBlock {
  readonly type: 'text'
  readonly text: string
}

/** 工具调用块（assistant 消息内）。 */
export interface RepairToolCallBlock {
  readonly type: 'tool-call'
  readonly id: string
  readonly name: string
  readonly arguments: string
}

/** 工具结果块（user 消息内）。 */
export interface RepairToolResultBlock {
  readonly type: 'tool-result'
  readonly toolCallId: string
  readonly content: readonly RepairContentBlock[]
  readonly isError?: boolean
}

export type RepairContentBlock = RepairTextBlock | RepairToolCallBlock | RepairToolResultBlock

/** 最小消息结构（request 投影的组成单元）。 */
export interface RepairMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: readonly RepairContentBlock[]
}

/** 工具历史问题分类。 */
export type ToolHistoryIssueKind =
  | 'missing-result' // 有 tool-call 没有配对 tool-result（TOOL_OUTCOME_UNKNOWN）
  | 'orphan-result' // 有 tool-result 没有前置 tool-call（TOOL_NOT_STARTED）
  | 'duplicate-result' // 同一 call 出现多次 result
  | 'duplicate-call' // 同一 callId 的 tool-call 重复出现
  | 'open-turn' // 末条 assistant 消息带未完成 tool-call，turn 中断

export interface ToolHistoryIssue {
  readonly kind: ToolHistoryIssueKind
  readonly callId?: string
  /** 出现问题的消息下标（messages 数组）。 */
  readonly messageIndex?: number
  readonly detail: string
}

export interface ToolHistoryAnalysis {
  /** 完全配对（无问题）。 */
  readonly balanced: boolean
  readonly issues: readonly ToolHistoryIssue[]
  /** 缺配对的开放调用 callId 列表。 */
  readonly openCalls: readonly string[]
  /** 无主结果 callId 列表。 */
  readonly orphanResults: readonly string[]
}

/** 修复动作。 */
export type RepairActionKind =
  | 'insert-error-result' // 在开放调用之后插入一条 isError 的 tool-result（user 消息）
  | 'drop-orphan-result' // 丢弃无主 result（块级；若消息因此为空则丢弃整条消息）
  | 'drop-duplicate-result' // 丢弃重复 result，保留第一条
  | 'drop-duplicate-call' // 丢弃重复 tool-call 块，保留第一条

export interface RepairAction {
  readonly kind: RepairActionKind
  readonly callId?: string
  readonly messageIndex?: number
  readonly reason: string
}

/** 修复后的请求投影。 */
export interface RepairedProjection {
  readonly messages: readonly RepairMessage[]
  readonly actions: readonly RepairAction[]
}

/** 修复记录（修复前后分别保存）。 */
export interface ToolHistoryRepairRecord {
  readonly repairId: string
  readonly sessionId: string
  readonly detectedAt: number
  readonly issues: readonly ToolHistoryIssue[]
  readonly actions: readonly RepairAction[]
  /** 修复前请求投影（JSON 序列化）。 */
  readonly originalProjection: string
  /** 修复后请求投影（JSON 序列化）。 */
  readonly repairedProjection: string
  readonly status: 'proposed' | 'applied'
}

/**
 * 分析工具调用序列：扫描消息流，统计未配对调用/无主结果/重复块。
 * @param messages 请求投影消息（按发送顺序）。
 */
export function analyzeToolHistory(messages: readonly RepairMessage[]): ToolHistoryAnalysis {
  const issues: ToolHistoryIssue[] = []
  const callCount = new Map<string, number>() // callId -> 出现次数
  const callIndex = new Map<string, number>() // callId -> 首次调用消息下标
  const resultCount = new Map<string, number>() // callId -> 结果块计数
  const orphanResults = new Set<string>()

  messages.forEach((message, index) => {
    for (const block of message.content) {
      if (block.type === 'tool-call') {
        const count = callCount.get(block.id) ?? 0
        callCount.set(block.id, count + 1)
        if (count === 0) callIndex.set(block.id, index)
        else {
          issues.push({
            kind: 'duplicate-call',
            callId: block.id,
            messageIndex: index,
            detail: `工具调用 ${block.id} 第 ${count + 1} 次出现（重复调用块）`,
          })
        }
      } else if (block.type === 'tool-result') {
        const seenCalls = callCount.get(block.toolCallId) ?? 0
        const seenResults = resultCount.get(block.toolCallId) ?? 0
        resultCount.set(block.toolCallId, seenResults + 1)
        if (seenCalls === 0) {
          orphanResults.add(block.toolCallId)
          issues.push({
            kind: 'orphan-result',
            callId: block.toolCallId,
            messageIndex: index,
            detail: `工具结果 ${block.toolCallId} 没有对应的前置 tool-call（TOOL_NOT_STARTED）`,
          })
        } else if (seenResults > 0) {
          issues.push({
            kind: 'duplicate-result',
            callId: block.toolCallId,
            messageIndex: index,
            detail: `工具结果 ${block.toolCallId} 重复出现，只保留第一条`,
          })
        }
      }
    }
  })

  const openCalls: string[] = []
  for (const [callId, count] of callCount) {
    if (count > 0 && (resultCount.get(callId) ?? 0) === 0) {
      openCalls.push(callId)
      issues.push({
        kind: 'missing-result',
        callId,
        messageIndex: callIndex.get(callId),
        detail: `工具调用 ${callId} 缺少配对结果（TOOL_OUTCOME_UNKNOWN）`,
      })
    }
  }

  // 末条 assistant 消息带未完成调用 → turn 中断
  const last = messages[messages.length - 1]
  if (last?.role === 'assistant' && openCalls.length > 0) {
    const pending = last.content.filter((block): block is RepairToolCallBlock =>
      block.type === 'tool-call' && openCalls.includes(block.id))
    if (pending.length > 0) {
      issues.push({
        kind: 'open-turn',
        messageIndex: messages.length - 1,
        detail: `末条 assistant 消息仍带 ${pending.length} 个未完成工具调用，turn 中断`,
      })
    }
  }

  return {
    balanced: issues.length === 0,
    issues,
    openCalls,
    orphanResults: [...orphanResults],
  }
}

/**
 * 生成修复后的请求投影（CTX-17 核心）：
 * 1. 重建消息列表：丢弃无主 result、重复 result、重复调用块；
 * 2. 对每个开放调用，在其调用消息之后插入一条 isError 的 tool-result；
 * 3. 返回修复动作清单（供修复记录保存"修复前/修复后"）。
 * 原始消息绝不被修改（不可变重建）。
 * @param messages 原始投影消息。
 * @param analysis 可选：未提供时先内部分析。
 */
export function buildRepairedProjection(
  messages: readonly RepairMessage[],
  analysis: ToolHistoryAnalysis = analyzeToolHistory(messages),
): RepairedProjection {
  if (analysis.balanced) return { messages, actions: [] }

  const actions: RepairAction[] = []

  // 1) 重建消息列表：丢弃无主/重复 result、重复调用块
  const rebuilt: RepairMessage[] = []
  const resultSeen = new Set<string>()
  const callSeen = new Set<string>()
  for (const message of messages) {
    const kept: RepairContentBlock[] = []
    for (const block of message.content) {
      if (block.type === 'tool-result') {
        if (analysis.orphanResults.includes(block.toolCallId)) {
          actions.push({ kind: 'drop-orphan-result', callId: block.toolCallId, reason: `丢弃无主结果 ${block.toolCallId}` })
          continue
        }
        if (resultSeen.has(block.toolCallId)) {
          actions.push({ kind: 'drop-duplicate-result', callId: block.toolCallId, reason: `丢弃重复结果 ${block.toolCallId}，保留第一条` })
          continue
        }
        resultSeen.add(block.toolCallId)
        kept.push(block)
      } else if (block.type === 'tool-call') {
        if (callSeen.has(block.id)) {
          actions.push({ kind: 'drop-duplicate-call', callId: block.id, reason: `丢弃重复调用块 ${block.id}，保留第一条` })
          continue
        }
        callSeen.add(block.id)
        kept.push(block)
      } else {
        kept.push(block)
      }
    }
    if (kept.length > 0) rebuilt.push({ role: message.role, content: kept })
  }

  // 2) 定位重建后列表中各开放调用所在消息
  const callIndex = new Map<string, number>()
  rebuilt.forEach((message, index) => {
    for (const block of message.content) {
      if (block.type === 'tool-call') callIndex.set(block.id, index)
    }
  })

  // 3) 按目标消息分组插入错误结果（同一条调用消息后的多个调用按原顺序）
  const insertions = new Map<number, RepairMessage[]>()
  for (const callId of analysis.openCalls) {
    const target = callIndex.get(callId) ?? Math.max(0, rebuilt.length - 1)
    const holder: RepairMessage = {
      role: 'user',
      content: [{
        type: 'tool-result',
        toolCallId: callId,
        isError: true,
        content: [{
          type: 'text',
          text: `[上下文保护层修复] 工具调用 ${callId} 的结果缺失（TOOL_OUTCOME_UNKNOWN），已补记失败状态；可安全重试该调用或据上下文调整。`,
        }],
      }],
    }
    const list = insertions.get(target) ?? []
    list.push(holder)
    insertions.set(target, list)
    actions.push({ kind: 'insert-error-result', callId, messageIndex: target, reason: `为 ${callId} 插入错误结果以闭合配对` })
  }

  const repaired: RepairMessage[] = []
  rebuilt.forEach((message, index) => {
    repaired.push(message)
    const inserts = insertions.get(index)
    if (inserts) repaired.push(...inserts)
  })

  return { messages: repaired, actions }
}

/** 序列化投影（修复记录用；纯 JSON 结构）。 */
export function serializeProjection(messages: readonly RepairMessage[]): string {
  return JSON.stringify(messages)
}

/**
 * 构造一条修复记录（修复前后分别保存）。
 * @param sessionId 会话 id。
 * @param messages 原始投影。
 * @param analysis 分析结果。
 * @param repaired 修复后投影（可由 buildRepairedProjection 生成）。
 */
export function createRepairRecord(
  sessionId: string,
  messages: readonly RepairMessage[],
  analysis: ToolHistoryAnalysis,
  repaired: RepairedProjection,
): ToolHistoryRepairRecord {
  return {
    repairId: randomUUID(),
    sessionId,
    detectedAt: Date.now(),
    issues: analysis.issues,
    actions: repaired.actions,
    originalProjection: serializeProjection(messages),
    repairedProjection: serializeProjection(repaired.messages),
    status: 'proposed',
  }
}
