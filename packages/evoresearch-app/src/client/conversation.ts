/**
 * 会话消息管线：注册官方 conversationEvents Definition 与 chat view target。
 *
 * 基于 DSH 官方会话事件契约（conversationEvents / conversationViews）的
 * assistant-step / input-message 消息 Definition —— 事件匹配、节点形状、
 * 流式 chunk 折叠与 legacy 快照语义；渲染由本工作台自写。
 *
 * 注册后，Session 的 ConversationSnapshot.chat.legacy 提供
 * { nodes, partial, runningCalls } 供工作台渲染。
 */
import {
  toAssistantBlocks,
  emptyAssistantBlock,
  isAppendSurfaceEvent,
  isTokenDelta,
} from '@deepseek-ai/dsh-client-runtime/client'

// ── assistant-step：一个 step 的流式/最终/中断消息 ────────────────────────

function initialState(turn, step) {
  return { turn, step, blocks: [], hidden: false, final: undefined }
}

function hasVisibleContent(blocks) {
  return blocks.some((block) => {
    if (block.kind === 'tool-call') return false
    if (block.kind === 'text' || block.kind === 'reasoning') return block.text.trim() !== ''
    return true
  })
}

/** 官方 updateChunk 的裁剪版（block-start / text-delta / reasoning-delta / tool-call-delta / block-end / usage）。 */
function updateChunk(state, match) {
  if (match.event.type !== 'assistant/chunk') return state
  const chunk = match.event.data.chunk
  const blocks = [...state.blocks]
  switch (chunk.type) {
    case 'block-start':
      blocks[chunk.index] = emptyAssistantBlock(chunk.blockType)
      break
    case 'text-delta': {
      const previous = blocks[chunk.index]
      blocks[chunk.index] = {
        kind: 'text',
        text: (previous?.kind === 'text' ? previous.text : '') + chunk.text,
      }
      break
    }
    case 'reasoning-delta': {
      const previous = blocks[chunk.index]
      blocks[chunk.index] = {
        kind: 'reasoning',
        text: (previous?.kind === 'reasoning' ? previous.text : '') + chunk.text,
      }
      break
    }
    case 'tool-call-delta': {
      const previous = blocks[chunk.index]
      const base = previous?.kind === 'tool-call' ? previous : { kind: 'tool-call', callId: '', name: '', argsRaw: '' }
      blocks[chunk.index] = {
        kind: 'tool-call',
        callId: base.callId || String(chunk.id),
        name: chunk.name ?? base.name,
        argsRaw: base.argsRaw + chunk.argumentsDelta,
      }
      break
    }
    case 'block-end':
      blocks[chunk.index] = toAssistantBlockCompat(chunk.block)
      break
    case 'usage':
      return { ...state, usage: chunk.usage }
    default:
      return state
  }
  const visible = hasVisibleContent(blocks)
  const firstToken = isTokenDelta(chunk)
  return {
    ...state,
    blocks,
    hidden: visible ? false : state.hidden,
    firstVisibleSeq: state.firstVisibleSeq ?? (visible || firstToken ? match.event.seq : undefined),
    firstVisibleTime: state.firstVisibleTime ?? (visible || firstToken ? match.event.time : undefined),
  }
}

/** 兼容包装：block-end 的 block 直接分类（official toAssistantBlock 语义）。 */
function toAssistantBlockCompat(block) {
  switch (block.type) {
    case 'text': return { kind: 'text', text: block.text }
    case 'reasoning': return { kind: 'reasoning', text: block.text }
    case 'tool-call': return {
      kind: 'tool-call',
      callId: String(block.id),
      name: block.name,
      argsRaw: block.arguments,
    }
    default: return { kind: 'other', block }
  }
}

/** 每个 step 一条 assistant 消息（流式 + 最终 + 工具调用块保留）。
 * 工具结果（§21.1 running/success/error 与结果展示）不折叠进 Definition——
 * 引擎的已定稿节点视图不随 tool/result 更新重绘，改由渲染层按 callId 从
 * session.events（tool/result 事件）直接关联。 */
const assistantDefinition = {
  kind: 'assistant-step',
  target: 'chat',
  match: (event) => {
    if (event.type === 'step/start') return { id: `${event.data.turn}:${event.data.step}`, role: 'start' }
    if (event.type === 'assistant/chunk' || (event.type === 'assistant/message' && isAppendSurfaceEvent(event))) {
      return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
    }
    return null
  },
  start: (_context, match) => initialState(match.event.data.turn, match.event.data.step),
  update: (context, match) => {
    if (match.event.type === 'assistant/chunk') return updateChunk(context.state, match)
    if (match.event.type === 'assistant/message') {
      const finalBlocks = toAssistantBlocks(match.event.data.message.content)
      // 最终消息通常只含文本：保留流式期已出现的工具调用块与推理块
      // （工具结果由渲染层关联；推理默认折叠为 Thinking 行，§31.6），
      // 与最终块按 callId 去重合并
      const keptReasoning = context.state.blocks.filter((b) => b.kind === 'reasoning')
      const byCallId = new Map(context.state.blocks.filter((b) => b.kind === 'tool-call').map((b) => [b.callId, b]))
      const merged = finalBlocks.map((b) => {
        if (b.kind === 'tool-call' && byCallId.has(b.callId)) {
          const previous = byCallId.get(b.callId)
          byCallId.delete(b.callId)
          return previous
        }
        return b
      })
      for (const leftover of byCallId.values()) merged.push(leftover)
      // 推理块放最前（流式顺序：先思考后正文）
      const blocks = finalBlocks.some((b) => b.kind === 'reasoning') ? merged : [...keptReasoning, ...merged]
      return {
        ...context.state,
        blocks,
        hidden: false,
        final: match,
        usage: match.event.data.usage,
      }
    }
    return context.state
  },
  publication: (match) => {
    if (match.event.type === 'step/start') return 'none'
    if (match.event.type !== 'assistant/chunk') return 'immediate'
    const type = match.event.data.chunk.type
    return type === 'usage' || type === 'finish' ? 'none' : 'animation-frame'
  },
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined) return null
    const blocks = state.blocks
    const settled = state.final !== undefined
    const visible = hasVisibleContent(blocks)
    if (!settled && !visible) return null
    const anchorSeq = state.final?.event.seq ?? state.firstVisibleSeq ?? context.matches[0]?.event.seq ?? 0
    const time = state.final?.event.time ?? state.firstVisibleTime ?? context.matches[0]?.event.time ?? 0
    return {
      key: context.key,
      kind: 'assistant-step',
      id: context.id,
      target: 'chat',
      anchorSeq,
      visibility: visible || settled ? 'visible' : 'hidden',
      data: {
        status: settled ? 'settled' : 'running',
        turn: state.turn,
        step: state.step,
        blocks,
        time,
        ...(state.usage === undefined ? {} : { usage: state.usage }),
        ...(settled ? { finalNode: state.final } : {}),
      },
    }
  },
}

// ── input-message：用户消息 ────────────────────────────────────────────────

function userTextOf(data) {
  if (typeof data.content === 'string') return data.content
  if (Array.isArray(data.content)) {
    return data.content
      .map((block) => (block?.type === 'text' ? block.text : ''))
      .join('')
      .trim()
  }
  return ''
}

const messageDefinition = {
  kind: 'input-message',
  target: 'chat',
  match: (event) => (event.type === 'user/message' && isAppendSurfaceEvent(event) ? { id: String(event.seq), role: 'start' } : null),
  start: (_context, match) => ({
    kind: 'user',
    seq: match.event.seq,
    time: match.event.time,
    text: userTextOf(match.event.data),
  }),
  update: (context) => context.state,
  publication: () => 'immediate',
  buildViewNode: (context) => ({
    key: context.key,
    kind: context.state.kind,
    id: context.id,
    target: 'chat',
    anchorSeq: context.state.seq,
    visibility: 'visible',
    data: context.state,
  }),
}

// ── chat view target：收集节点为 legacy 快照 ────────────────────────────────

/**
 * 简化 builder（官方 ChatSnapshotBuilder 的裁剪版）：
 * 维护 keyed 节点表，输出官方 legacy 形状 { nodes, partial, runningCalls }。
 */
function createChatViewBuilder() {
  const store = new Map()
  return {
    empty: { order: [], nodes: new Map(), legacy: { nodes: [], partial: null, runningCalls: [] } },
    replace({ nodes }) {
      store.clear()
      for (const node of nodes) if (node !== null) store.set(node.key, node)
      return this.snapshot()
    },
    apply({ upserts }) {
      for (const node of upserts) if (node !== null) store.set(node.key, node)
      return this.snapshot()
    },
    snapshot() {
      const nodes = [...store.values()]
      const partial = nodes.find((n) => n.kind === 'assistant-step' && n.data?.status === 'running') ?? null
      return {
        order: nodes.map((n) => n.key),
        nodes: new Map(nodes.map((n) => [n.key, n])),
        legacy: { nodes, partial, runningCalls: [] },
      }
    },
  }
}

// ── workflow-run：Dynamic Workflow（移植规范 §24）──────────────────────────
// 折叠 tool-workflow/* 事件族为一个 keyed chat 节点（对齐官方 ui-workflow-run）。

function workflowStart(_context, match) {
  return {
    name: match.event.data.name ?? 'Workflow',
    members: [],
    stopReason: undefined,
    startedAt: match.event.time,
  }
}

function workflowUpdate(context, match) {
  const state = context.state
  if (match.event.type === 'tool-workflow/agent-start') {
    const d = match.event.data
    const members = state.members.filter((m) => m.seq !== d.seq)
    members.push({ seq: d.seq, label: d.label ?? `agent-${d.seq}`, phase: d.phase ?? null, status: 'running', startedAt: match.event.time })
    return { ...state, members }
  }
  if (match.event.type === 'tool-workflow/agent-end') {
    const d = match.event.data
    const members = state.members.map((m) => (m.seq === d.seq ? { ...m, status: d.outcome ?? 'completed' } : m))
    return { ...state, members }
  }
  if (match.event.type === 'tool-workflow/run-end') {
    return { ...state, stopReason: match.event.data.stopReason, endedAt: match.event.time }
  }
  return state
}

const workflowRunDefinition = {
  kind: 'workflow-run',
  target: 'chat',
  match: (event) => {
    if (event.type === 'tool-workflow/run-start') return { id: String(event.data.runId), role: 'start' }
    if (event.type === 'tool-workflow/agent-start' || event.type === 'tool-workflow/agent-end' || event.type === 'tool-workflow/run-end') {
      return { id: String(event.data.runId), role: 'update' }
    }
    return null
  },
  start: workflowStart,
  update: workflowUpdate,
  publication: () => 'immediate',
  buildViewNode: (context) => {
    if (context.start === undefined) return null
    return {
      key: context.key,
      kind: 'workflow-run',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      visibility: 'visible',
      data: context.state,
    }
  },
}

/** 注册消息 Definition 与 chat view（在 client-runtime apply 之后、任何会话打开之前）。 */
export function registerConversation(ctx) {
  ctx.conversationEvents.register(assistantDefinition)
  ctx.conversationEvents.register(messageDefinition)
  ctx.conversationEvents.register(workflowRunDefinition)
  ctx.conversationViews.register({ target: 'chat', create: createChatViewBuilder })
}
