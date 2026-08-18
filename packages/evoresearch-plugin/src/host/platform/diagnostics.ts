/**
 * 会话诊断导出（PLAT-20）。
 *
 * exportSessionDiagnostics：从会话事件派生完整诊断（消息/工具调用/工具结果/
 * 中断/压缩事件），只读不修改原会话；压缩事件来自 t5 compaction-log 记录
 * （CompactionRecord 形状，见 context/types.ts）。
 */

/** 诊断消息条目（角色 + 文本；来自 user/message 与 assistant/message 事件）。 */
export interface DiagnosticMessage {
  readonly seq: number
  readonly role: 'user' | 'assistant' | 'system'
  readonly text: string
  readonly interrupted: boolean
}

/** 工具调用条目。 */
export interface DiagnosticToolCall {
  readonly seq: number
  readonly name: string
  readonly arguments: string
  /** 是否有对应结果。 */
  readonly hasResult: boolean
  readonly resultError?: boolean
}

/** 压缩事件条目（PLAT-05 记录的最小形态）。 */
export interface DiagnosticCompaction {
  readonly compactionId: string
  readonly trigger: string
  readonly status: string
  readonly startedAt: number
  readonly summaryText?: string
}

/** 会话诊断导出（PLAT-20：完整消息/工具/结果/中断/压缩；不修改原会话）。 */
export interface SessionDiagnostics {
  readonly sessionId: string
  readonly exportedAt: number
  readonly messages: readonly DiagnosticMessage[]
  readonly toolCalls: readonly DiagnosticToolCall[]
  readonly interruptions: readonly { seq: number; reason?: string }[]
  readonly compactions: readonly DiagnosticCompaction[]
  /** 原始事件数（只统计不导出原文，避免重复体积）。 */
  readonly rawEventCount: number
}

/** 会话事件最小形态（容忍任意结构）。 */
export interface DiagnosticEventLike {
  readonly seq?: unknown
  readonly type?: unknown
  readonly time?: unknown
  readonly data?: unknown
}

/** 从事件流提取文本块。 */
function eventText(data: Record<string, unknown> | undefined): string {
  if (!data) return ''
  if (typeof data.text === 'string') return data.text
  if (Array.isArray(data.content)) {
    return data.content
      .map((block) => {
        const b = block as { type?: unknown; text?: unknown }
        return typeof b?.type === 'string' && b.type === 'text' && typeof b.text === 'string' ? b.text : ''
      })
      .join('')
  }
  if (typeof data.message === 'object' && data.message !== null) {
    return eventText((data.message as { content?: unknown }).content as Record<string, unknown> | undefined)
  }
  return ''
}

/** 工具调用参数文本。 */
function eventToolArguments(data: Record<string, unknown> | undefined): { name: string; arguments: string } | null {
  if (!data) return null
  if (typeof data.toolName === 'string') {
    return {
      name: data.toolName,
      arguments: typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? {}),
    }
  }
  if (typeof data.name === 'string' && typeof data.arguments === 'string') {
    return { name: data.name, arguments: data.arguments }
  }
  return null
}

/**
 * 导出会话诊断（PLAT-20 纯函数）：从事件列表派生，只读不改原会话。
 * 压缩事件由调用方传入（t5 guard.queryCompactions({ sessionId }) 结果）。
 */
export function exportSessionDiagnostics(
  sessionId: string,
  events: readonly DiagnosticEventLike[],
  compactions: readonly DiagnosticCompaction[] = [],
  now = Date.now(),
): SessionDiagnostics {
  const messages: DiagnosticMessage[] = []
  const toolCalls: DiagnosticToolCall[] = []
  const interruptionList: Array<{ seq: number; reason?: string }> = []
  let rawEventCount = 0
  // 中断标记：turn 之后没有 assistant/message 的 turn/end（简化：event.data.interrupted）
  for (const raw of events) {
    rawEventCount += 1
    const seq = typeof raw.seq === 'number' ? raw.seq : 0
    const type = typeof raw.type === 'string' ? raw.type : ''
    const data = (raw.data ?? {}) as Record<string, unknown>
    if (type === 'user/message') {
      messages.push({ seq, role: 'user', text: eventText(data), interrupted: false })
    } else if (type === 'assistant/message') {
      messages.push({ seq, role: 'assistant', text: eventText(data), interrupted: data.interrupted === true })
    } else if (type === 'assistant/tool-call' || type === 'tool/call') {
      const call = eventToolArguments(data)
      if (call) toolCalls.push({ seq, name: call.name, arguments: call.arguments, hasResult: false })
    } else if (type === 'assistant/tool-result' || type === 'tool/result') {
      const call = eventToolArguments(data)
      if (call) {
        toolCalls.push({
          seq,
          name: call.name,
          arguments: call.arguments,
          hasResult: true,
          resultError: data.isError === true,
        })
      }
    } else if (type === 'turn/end' && data.interrupted === true) {
      interruptionList.push({ seq, reason: typeof data.reason === 'string' ? data.reason : undefined })
    }
  }
  return {
    sessionId,
    exportedAt: now,
    messages,
    toolCalls,
    interruptions: interruptionList,
    compactions,
    rawEventCount,
  }
}

/* ------------------------------------------------------------------ */
/* PLAT-20：可选消息反馈                                                */
