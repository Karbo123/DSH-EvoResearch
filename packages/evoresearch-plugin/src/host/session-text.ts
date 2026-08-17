/**
 * 统一会话正文解析（session-text.ts）——从 DSH 事件还原对话原文（MEM-01）。
 *
 * 对齐原始资料保留规则「第一层：不可被摘要替代的原始资料」：
 * - user/message：真人用户消息正文（跳过系统注入的「伪用户消息」）；
 * - assistant/message：模型最终消息，只收 text 块（reasoning 是思考过程，不进入原文正文）；
 * - assistant/chunk：按 (turn, step) 累积 text-delta，不收 reasoning-delta；
 * - data.text / data.content[].text / data.blocks[].text：兼容旧/其他事件形状；
 * - 若某个 step 存在最终 assistant/message，以它为准（避免 chunk 合并稿重复正文，MEM-03）；
 * - tool/call 与 tool/result 按事件原序收集（MEM-06 原始轮次档案的输入）。
 *
 * 本模块只做解析与还原，不写数据库；同一解析逻辑同时服务：
 * - 实时路径（memory/index.ts 的 TurnTextAccumulator：chunk 到达即累积）；
 * - 兜底路径（recovery.ts 从 DSH session log 按轮次还原原文补回，MEM-08）。
 */
import { isSystemText } from './rewind.js'

/** 最小事件形状（兼容 live SessionEvent 与 session log 的 JSON 行）。 */
export interface SessionEventLike {
  readonly type?: unknown
  readonly seq?: unknown
  readonly data?: unknown
  [key: string]: unknown
}

/** 一条工具调用/结果事件（按原事件顺序收集，供 MEM-06 归档）。 */
export interface ToolEventItem {
  /** 事件序号（session log 的 seq；同轮内保持原序）。 */
  readonly seq: number
  readonly kind: 'call' | 'result'
  readonly callId: string
  /** 工具名（仅 call）。 */
  readonly name?: string
  /** 模型原始 arguments JSON 字符串（仅 call）。 */
  readonly arguments?: string
  /** 结果可读文本（仅 result）。 */
  readonly result?: string
  /** 工具失败信息（仅 result，data.error 的 JSON）。 */
  readonly error?: string
}

/**
 * 轮次原始事件的稳定归档投影。
 *
 * `order` 优先使用 DSH session event 的 seq；没有 seq 的旧事件使用累积器
 * 内部的单调序号。它只描述归档顺序，不替代 session log 本身。
 */
export interface TurnArchiveEvent {
  readonly order: number
  readonly kind: 'user' | 'assistant' | 'tool'
  readonly step?: number
  readonly text?: string
  readonly tool?: ToolEventItem
}

/** 单个 step 的回答（正文来源：最终消息或 chunk 合并稿）。 */
export interface AssistantStepText {
  readonly step: number
  readonly text: string
  readonly source: 'message' | 'chunks'
}

/** 一轮对话的完整原文还原（供归档/对账/测试使用）。 */
export interface TurnTranscript {
  readonly turn: number
  readonly userText: string
  readonly assistantText: string
  readonly steps: readonly AssistantStepText[]
  readonly tools: readonly ToolEventItem[]
  readonly endReason?: { kind: string }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 递归提取任意载荷中的正文文本：
 * 字符串原样返回；数组逐项拼接；对象按 text → content → blocks 字段提取。
 * 注意：只取 text 字段，不把 tool-call 的 arguments JSON 当正文。
 */
export function extractTextBlocks(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(extractTextBlocks).join('')
  if (isObject(value)) {
    if (typeof value.text === 'string') return value.text
    if (value.content !== undefined) return extractTextBlocks(value.content)
    if (value.blocks !== undefined) return extractTextBlocks(value.blocks)
  }
  return ''
}

/**
 * 从 ContentBlock 数组提取正文：默认只收 type === 'text' 的块（跳过 reasoning /
 * image / tool-call 等）；includeReasoning 仅用于用户消息与工具结果（无正文块语义）。
 */
export function textBlocksOf(content: unknown, options: { includeReasoning?: boolean } = {}): string {
  if (!Array.isArray(content)) return extractTextBlocks(content)
  const parts: string[] = []
  for (const block of content) {
    if (!isObject(block)) continue
    const type = block.type
    if (typeof type === 'string' && type !== 'text' && !(options.includeReasoning && type === 'reasoning')) continue
    if (typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('').trim()
}

/** user/message 事件 → 用户正文（纯提取，不做系统注入过滤）。 */
export function userMessageText(event: SessionEventLike): string {
  const data = isObject(event.data) ? event.data : {}
  if (typeof data.text === 'string' && data.text.trim() !== '') return data.text.trim()
  if (Array.isArray(data.content)) {
    const text = textBlocksOf(data.content, { includeReasoning: true })
    if (text !== '') return text
  }
  return ''
}

/** assistant/message 事件 → 正文（只收 text 块，跳过 reasoning 与 tool-call）。 */
export function assistantMessageText(event: SessionEventLike): string {
  const data = isObject(event.data) ? event.data : {}
  const message = data.message
  if (isObject(message) && Array.isArray(message.content)) {
    return textBlocksOf(message.content)
  }
  if (Array.isArray(data.content)) return textBlocksOf(data.content)
  return extractTextBlocks(data)
}

/** assistant/chunk 事件 → 正文增量（只收 text-delta；reasoning-delta 一律不收）。 */
export function assistantChunkDelta(event: SessionEventLike): string {
  const data = isObject(event.data) ? event.data : {}
  // 旧形状：事件直接带 data.text 增量
  if (typeof data.text === 'string') {
    const kind = String(data.deltaType ?? data.kind ?? data.type ?? '').toLowerCase()
    if (kind.includes('reason') || data.reasoning === true) return ''
    return data.text
  }
  const chunk = data.chunk
  if (isObject(chunk)) {
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') return chunk.text
    return ''
  }
  // 旧形状：事件直接带 data.blocks（按整段正文处理，仍只收 text 块）
  if (Array.isArray(data.blocks)) {
    const text = textBlocksOf(data.blocks)
    if (text !== '') return text
  }
  return ''
}

/** tool/result 事件 → 结果可读文本（ToolResultBlock 的嵌套 content 块）。 */
export function toolResultText(event: SessionEventLike): string {
  const data = isObject(event.data) ? event.data : {}
  const message = data.message
  if (isObject(message) && Array.isArray(message.content)) {
    const parts: string[] = []
    for (const block of message.content) {
      if (!isObject(block)) continue
      if (block.type === 'tool-result' && block.content !== undefined) {
        parts.push(textBlocksOf(block.content, { includeReasoning: true }))
      } else {
        parts.push(textBlocksOf(block, { includeReasoning: true }))
      }
    }
    const joined = parts.join('').trim()
    if (joined !== '') return joined
  }
  return extractTextBlocks(data)
}

/** tool/call 事件 → 工具调用条目（callId 缺失时无法关联，返回 undefined）。 */
export function toolCallItem(event: SessionEventLike): ToolEventItem | undefined {
  const data = isObject(event.data) ? event.data : {}
  const callId = data.callId ?? data.id
  if (callId === undefined) return undefined
  return {
    seq: typeof event.seq === 'number' ? event.seq : 0,
    kind: 'call',
    callId: String(callId),
    name: typeof data.name === 'string' ? data.name : undefined,
    ...(data.arguments === undefined ? {} : {
      arguments: typeof data.arguments === 'string' ? data.arguments : safeJson(data.arguments),
    }),
  }
}

/** 工具参数可能是对象；归档必须保留可读的完整 JSON，而不是静默丢失。 */
function safeJson(value: unknown): string {
  try { return JSON.stringify(value) } catch { return String(value) }
}

/** tool/result 事件 → 工具结果条目（经 message.source.callId 关联调用）。 */
export function toolResultItem(event: SessionEventLike): ToolEventItem | undefined {
  const data = isObject(event.data) ? event.data : {}
  const message = isObject(data.message) ? data.message : {}
  const source = isObject(message.source) ? message.source : {}
  const callId = message.callId ?? data.callId ?? source.callId
  if (callId === undefined) return undefined
  return {
    seq: typeof event.seq === 'number' ? event.seq : 0,
    kind: 'result',
    callId: String(callId),
    result: toolResultText(event),
    ...(data.error !== undefined ? { error: JSON.stringify(data.error) } : {}),
  }
}

/**
 * turn/end 中断判定与原因归一（MEM-05）。
 * - api_failure：error（API 失败）、interrupted（崩溃遗留轮）；
 * - user_stop：aborted（用户/父级取消）、rejected（用户拒绝审批，旧形状）、
 *   cancelled（旧形状）。
 */
export function turnInterruptFromEndReason(reason: unknown): {
  interrupted: boolean
  interruptReason?: 'user_stop' | 'api_failure'
} {
  const kind = (isObject(reason) ? reason.kind : undefined) ?? 'unknown'
  const apiFailure = kind === 'error' || kind === 'interrupted'
  const userStop = kind === 'aborted' || kind === 'rejected' || kind === 'cancelled'
  if (!apiFailure && !userStop) return { interrupted: false }
  return { interrupted: true, interruptReason: apiFailure ? 'api_failure' : 'user_stop' }
}

/**
 * 现场累积器（MEM-02/MEM-03）：按 (turn, step) 累积 assistant 正文与工具事件。
 * - assistant/chunk：text-delta 追加到该 step 的 chunk 合并稿；
 * - assistant/message：以最终消息文本覆盖该 step 的 chunk 合并稿（避免重复正文）；
 * - tool/call、tool/result：按事件原序收集。
 */
export class TurnTextAccumulator {
  /** 当前轮号（由 turn/start 事件更新；实时路径可不依赖）。 */
  turnNumber = -1
  private readonly chunksByStep = new Map<number, string>()
  private readonly messagesByStep = new Map<number, string>()
  private readonly assistantOrderByStep = new Map<number, number>()
  private readonly archiveOrder: Array<{ order: number; kind: 'user' | 'assistant' | 'tool'; step?: number; tool?: ToolEventItem }> = []
  private nextOrder = 0
  private userTextValue = ''
  readonly tools: ToolEventItem[] = []

  private orderOf(event: SessionEventLike): number {
    const seq = typeof event.seq === 'number' && Number.isFinite(event.seq) ? event.seq : this.nextOrder
    this.nextOrder = Math.max(this.nextOrder + 1, seq + 1)
    return seq
  }

  /** 处理一条会话事件（turn/start、assistant/chunk、assistant/message、tool/call、tool/result）。 */
  feedEvent(event: SessionEventLike): void {
    const data = isObject(event.data) ? event.data : {}
    if (event.type === 'turn/start') {
      if (typeof data.turn === 'number') this.turnNumber = data.turn
      return
    }
    if (event.type === 'user/message') {
      const text = userMessageText(event)
      const source = isObject(data.source) ? data.source : {}
      if (this.userTextValue === '' && text !== '' && (source.kind === undefined || source.kind === 'user')) {
        this.userTextValue = text
        this.archiveOrder.push({ order: this.orderOf(event), kind: 'user' })
      }
      return
    }
    if (event.type === 'assistant/chunk') {
      const step = typeof data.step === 'number' ? data.step : 0
      const delta = assistantChunkDelta(event)
      if (delta !== '') {
        this.chunksByStep.set(step, (this.chunksByStep.get(step) ?? '') + delta)
        if (!this.assistantOrderByStep.has(step)) {
          const order = this.orderOf(event)
          this.assistantOrderByStep.set(step, order)
          this.archiveOrder.push({ order, kind: 'assistant', step })
        }
      }
      return
    }
    if (event.type === 'assistant/message') {
      const step = typeof data.step === 'number' ? data.step : 0
      const text = assistantMessageText(event)
      // MEM-03：最终 assistant/message 存在时以它为准（覆盖 chunk 合并稿）
      this.messagesByStep.set(step, text)
      if (!this.assistantOrderByStep.has(step)) {
        const order = this.orderOf(event)
        this.assistantOrderByStep.set(step, order)
        this.archiveOrder.push({ order, kind: 'assistant', step })
      }
      return
    }
    if (event.type === 'tool/call') {
      const item = toolCallItem(event)
      if (item) {
        this.tools.push(item)
        this.archiveOrder.push({ order: this.orderOf(event), kind: 'tool', tool: item })
      }
      return
    }
    if (event.type === 'tool/result') {
      const item = toolResultItem(event)
      if (item) {
        this.tools.push(item)
        this.archiveOrder.push({ order: this.orderOf(event), kind: 'tool', tool: item })
      }
      return
    }
  }

  /** 每 step 的正文（message 优先，缺省回退 chunk 合并稿），按 step 升序。 */
  steps(): AssistantStepText[] {
    const stepIds = new Set<number>([...this.chunksByStep.keys(), ...this.messagesByStep.keys()])
    return [...stepIds].sort((a, b) => a - b).map((step) => {
      const message = this.messagesByStep.get(step) ?? ''
      const chunks = this.chunksByStep.get(step) ?? ''
      if (message !== '') return { step, text: message, source: 'message' }
      return { step, text: chunks, source: 'chunks' }
    })
  }

  /** 完整 assistant 正文（按 step 顺序拼接）。 */
  text(): string {
    return this.steps()
      .map((s) => s.text)
      .join('')
      .trim()
  }

  /** 当前累积内容按原事件顺序生成归档事件（MEM-06）。 */
  archiveEvents(userText = this.userTextValue): TurnArchiveEvent[] {
    const byStep = new Map(this.steps().map((step) => [step.step, step.text]))
    const events: TurnArchiveEvent[] = this.archiveOrder.map((entry): TurnArchiveEvent => {
      if (entry.kind === 'tool') return { order: entry.order, kind: 'tool', tool: entry.tool }
      if (entry.kind === 'user') return { order: entry.order, kind: 'user', text: userText }
      const step = entry.step ?? 0
      return { order: entry.order, kind: 'assistant', step, text: byStep.get(step) ?? '' }
    }).filter((entry) => entry.kind === 'tool' || (entry.text ?? '') !== '')
    if (userText !== '' && !events.some((event) => event.kind === 'user')) {
      events.unshift({ order: Number.NEGATIVE_INFINITY, kind: 'user', text: userText })
    }
    if (this.text() !== '' && !events.some((event) => event.kind === 'assistant')) {
      events.push({ order: Number.POSITIVE_INFINITY, kind: 'assistant', step: 0, text: this.text() })
    }
    return events.sort((a, b) => a.order - b.order || (a.kind === 'user' ? -1 : 1))
  }

  /** 清空（轮次收尾后复用同一实例）。 */
  reset(): void {
    this.turnNumber = -1
    this.chunksByStep.clear()
    this.messagesByStep.clear()
    this.assistantOrderByStep.clear()
    this.archiveOrder.length = 0
    this.nextOrder = 0
    this.userTextValue = ''
    this.tools.length = 0
  }
}

/**
 * 从事件流还原全部轮次的原文（live 或 session log 均可）。
 * 每轮含：用户正文、完整 assistant 正文（按 step 顺序）、step 明细、
 * 按原序的工具事件、结束原因。user/message 无 turn 字段，按 turn/start 归属当前轮。
 */
export function turnsFromEvents(events: readonly SessionEventLike[]): TurnTranscript[] {
  interface TurnEntry {
    userText: string
    acc: TurnTextAccumulator
    endReason?: { kind: string }
  }
  const byTurn = new Map<number, TurnEntry>()
  let currentTurn = 0
  const ensure = (turn: number): TurnEntry => {
    let entry = byTurn.get(turn)
    if (!entry) {
      entry = { userText: '', acc: new TurnTextAccumulator() }
      byTurn.set(turn, entry)
    }
    return entry
  }

  for (const event of events) {
    const type = event.type
    const data = isObject(event.data) ? event.data : {}
    if (type === 'turn/start') {
      currentTurn = typeof data.turn === 'number' ? data.turn : currentTurn
      ensure(currentTurn).acc.turnNumber = currentTurn
      continue
    }
    if (type === 'user/message') {
      const entry = ensure(currentTurn)
      if (entry.userText === '') {
        const source = isObject(data.source) ? data.source : {}
        const isUser = source.kind === undefined || source.kind === 'user'
        const text = userMessageText(event)
        if (isUser && text !== '' && !isSystemText(text)) {
          entry.userText = text
          entry.acc.feedEvent(event)
        }
      }
      continue
    }
    if (type === 'turn/end') {
      const turn = typeof data.turn === 'number' ? data.turn : currentTurn
      const entry = ensure(turn)
      const reason = isObject(data.reason) ? data.reason : {}
      entry.endReason = { kind: typeof reason.kind === 'string' ? reason.kind : 'unknown' }
      continue
    }
    if (type === 'assistant/chunk' || type === 'assistant/message') {
      const turn = typeof data.turn === 'number' ? data.turn : currentTurn
      ensure(turn).acc.feedEvent(event)
      continue
    }
    if (type === 'tool/call' || type === 'tool/result') {
      const turn = typeof data.turn === 'number' ? data.turn : currentTurn
      ensure(turn).acc.feedEvent(event)
      continue
    }
  }

  const transcripts: TurnTranscript[] = []
  for (const [turn, entry] of [...byTurn.entries()].sort((a, b) => a[0] - b[0])) {
    transcripts.push({
      turn,
      userText: entry.userText,
      assistantText: entry.acc.text(),
      steps: entry.acc.steps(),
      tools: [...entry.acc.tools],
      ...(entry.endReason ? { endReason: entry.endReason } : {}),
    })
  }
  return transcripts
}

/** 某轮完整 assistant 正文（存在最终 assistant/message 时以它为准）。 */
export function assistantTextForTurn(events: readonly SessionEventLike[], turn: number): string {
  return turnsFromEvents(events).find((t) => t.turn === turn)?.assistantText ?? ''
}

/** 某轮用户正文（第一条第 source.kind==='user' 的真实消息）。 */
export function userTextForTurn(events: readonly SessionEventLike[], turn: number): string {
  return turnsFromEvents(events).find((t) => t.turn === turn)?.userText ?? ''
}
