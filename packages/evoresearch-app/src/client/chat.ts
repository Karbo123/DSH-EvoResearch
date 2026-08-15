/**
 * 中间聊天区：欢迎页 + 会话消息列表（气泡样式：用户青色右对齐 / 助手卡片左对齐）+ 输入面板。
 *
 * 消息数据来自 DSH 会话快照（conversation 管线注册的 chat legacy 节点）：
 * - user 节点：右对齐青色气泡（user-message 色系）
 * - assistant-step 节点：左对齐、头像 + 文本/推理/工具卡片
 * - partial：流式中的 assistant 消息（光标动画）
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import {
  Paperclip, ShieldCheck, ArrowUp, Wrench, User, Copy, Check, PenLine, Eye,
  ChevronDown, ChevronUp, ChevronRight, Shrink, Info, Search, Bell, BellOff, Keyboard,
  ListTodo, X as XIcon, Trash2, Terminal, XCircle, CheckCircle2, Command, Square, CornerUpRight,
} from 'lucide-react'
import { t } from './i18n'
import { SessionStatusLine, SessionStatsLine } from './session-dock'
import { renderMarkdown, renderMermaidBlocks } from './markdown'
import {
  CandidatePopup, buildCandidates, detectTrigger, pushHistory, readHistory,
  resolveMentions, useCommandCatalog, useFileTree,
  type Trigger, type Candidate,
} from './composer-assist'
import { CurrentDialog, SearchDialog, ShortcutsDialog, ConfirmDialog, ModelSelectorDialog } from './session-actions'
import { ShieldCheck as ShieldCheckIcon, ShieldX } from 'lucide-react'

const SUGGESTED_PROMPTS = [
  'Survey recent papers on a topic',
  'Design an experiment plan',
  'Analyze workspace files',
]

/** 历史分页（移植规范 §9）：默认每页 100 条；?pageSize=N（2..500）用于调试。 */
const DEFAULT_PAGE_SIZE = 100
function pageSizeFromUrl(): number {
  if (typeof location === 'undefined') return DEFAULT_PAGE_SIZE
  const raw = Number(new URLSearchParams(location.search).get('pageSize'))
  if (Number.isFinite(raw) && raw >= 2) return Math.min(Math.floor(raw), 500)
  return DEFAULT_PAGE_SIZE
}
const PAGE_SIZE = pageSizeFromUrl()

/** 会话快照消息节点（chat legacy 形状）。 */
export interface ChatNode {
  key: string
  kind: string
  anchorSeq: number
  visibility: string
  data: {
    status?: 'running' | 'settled'
    kind?: string
    text?: string
    time?: number
    turn?: number
    step?: number
    blocks?: Array<{ kind: string; text?: string; callId?: string; name?: string; argsRaw?: string }>
  }
}

export interface ChatAreaProps {
  /** 已定稿消息（按 anchorSeq 排序的可见节点）。 */
  nodes: ChatNode[]
  /** 流式中的 assistant 消息。 */
  partial: ChatNode | null
  /** 会话是否正在运行。 */
  running: boolean
  /** 发送失败信息（promptError）。 */
  error: string | null
  /** 当前会话标题（无会话时为 null）。 */
  currentTitle: string | null
  /** 当前会话 id（Current/Search 弹窗；无会话时为 null）。 */
  sessionId: string | null
  /** 会话对象（投影/排队数据；无会话时为 null）。 */
  session: any | null
  /** 当前 workspace（@文件 补全与输入历史的根目录；无会话时为 null）。 */
  cwd: string | null
  /** 当前会话的后台任务（§21.6，jobsBySession 快照）。 */
  jobs: Array<{ id: string; kind: string; label: string; status: string; detail?: string; startedAt?: number; finishedAt?: number }>
  /** 打开另一个会话（Search 全历史结果跳转）。 */
  onOpenThread: (id: string) => void
  onSend: (text: string) => void
}

function fmtTime(t: number | undefined): string {
  if (!t) return ''
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 复制文本到剪贴板（clipboard API + execCommand 兜底）。 */
function copyText(text: string): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText !== undefined) {
    void navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
    return
  }
  fallbackCopy(text)
}

function fallbackCopy(text: string): void {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  } catch { /* 忽略 */ }
}

/** 消息复制按钮（点击后短暂显示已复制）。 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return jsx('button', {
    type: 'button',
    className: 'evo-msg-copy',
    title: copied ? 'Copied' : 'Copy',
    'aria-label': copied ? 'Copied' : 'Copy',
    onClick: (e: { stopPropagation(): void }) => {
      e.stopPropagation()
      copyText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    },
    children: copied ? jsx(Check, {}) : jsx(Copy, {}),
  })
}

/** assistant 节点 → 正文文本（仅 text 块；reasoning 单独折叠展示，§31.6）。 */
function assistantText(node: ChatNode): string {
  return (node.data.blocks ?? [])
    .filter((b) => b.kind === 'text' && b.text)
    .map((b) => b.text)
    .join('\n')
}

/** assistant 节点 → 推理文本（reasoning 块，§31.6 默认折叠为 Thinking 行）。 */
function assistantReasoning(node: ChatNode): string {
  return (node.data.blocks ?? [])
    .filter((b) => b.kind === 'reasoning' && b.text)
    .map((b) => b.text)
    .join('\n')
}

function assistantTools(node: ChatNode, toolResults: Record<string, { text: string; isError: boolean }>): Array<{ name: string; args: string; result?: string; isError?: boolean }> {
  return (node.data.blocks ?? [])
    .filter((b) => b.kind === 'tool-call')
    .map((b) => {
      const linked = b.callId !== undefined ? toolResults[b.callId] : undefined
      return {
        name: b.name ?? 'tool',
        args: b.argsRaw ?? '',
        ...(linked !== undefined ? { result: linked.text, isError: linked.isError } : {}),
      }
    })
}

/** 从会话原始事件提取工具结果（§21.1）：tool/result → callId → {text, isError}。 */
function toolResultsOf(session: any): Record<string, { text: string; isError: boolean }> {
  const map: Record<string, { text: string; isError: boolean }> = {}
  for (const ev of session?.events ?? []) {
    if (ev?.type !== 'tool/result') continue
    const d = ev.data ?? {}
    const block = Array.isArray(d.message?.content) ? d.message.content.find((b) => b?.type === 'tool-result') : undefined
    const callId = d.message?.source?.callId ?? block?.toolCallId
    if (callId === undefined || callId === '') continue
    const content = block?.content
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c: any) => (typeof c === 'string' ? c : String(c?.text ?? ''))).join('\n') : ''
    map[callId] = { text, isError: block?.isError === true || d.error !== undefined }
  }
  return map
}

/** 工具卡片（§21.1）：名称/状态/参数折叠/结果（success·error·running）。 */
function ToolCard({ tool, running, defaultExpanded }: { tool: { name: string; args: string; result?: string; isError?: boolean }; running: boolean; defaultExpanded: boolean }) {
  const [argsOpen, setArgsOpen] = useState(defaultExpanded)
  const [resultOpen, setResultOpen] = useState(false)
  const status = running ? 'running' : tool.result === undefined ? 'running' : tool.isError ? 'error' : 'success'
  const argsTruncated = tool.args.length > 120
  const resultTruncated = (tool.result ?? '').length > 160
  return jsxs('div', {
    className: `evo-tool-card${status === 'running' ? ' running' : ''}${status === 'error' ? ' error' : ''}${status === 'success' ? ' success' : ''}`,
    children: [
      jsxs('div', {
        className: 'evo-tool-head',
        children: [
          status === 'running'
            ? jsx('span', { className: 'evo-tool-spinner', 'aria-label': 'running' })
            : status === 'error'
              ? jsx(XCircle, {})
              : jsx(CheckCircle2, {}),
          jsx('span', { className: 'evo-tool-name', children: tool.name }),
          jsx('span', { className: 'evo-tool-state', children: status }),
        ],
      }),
      tool.args !== '' && jsx('button', {
        type: 'button',
        className: 'evo-tool-args',
        onClick: () => setArgsOpen((v) => !v),
        title: argsOpen ? 'Collapse arguments' : 'Expand arguments',
        children: jsxs(Fragment, {
          children: [
            jsx(ChevronRight, { className: argsOpen ? 'evo-tool-chev open' : 'evo-tool-chev' }),
            jsx('span', { className: 'evo-tool-args-text', children: argsOpen || !argsTruncated ? tool.args : `${tool.args.slice(0, 120)}…` }),
          ],
        }),
      }),
      tool.result !== undefined && tool.result !== '' && jsx('button', {
        type: 'button',
        className: 'evo-tool-result',
        onClick: () => setResultOpen((v) => !v),
        title: resultOpen ? 'Collapse result' : 'Expand result',
        children: jsxs(Fragment, {
          children: [
            jsx('span', { className: 'evo-tool-result-label', children: tool.isError ? 'error' : 'result' }),
            jsx('span', { className: 'evo-tool-result-text', children: resultOpen || !resultTruncated ? tool.result : `${(tool.result ?? '').slice(0, 160)}…` }),
          ],
        }),
      }),
    ],
  })
}

/** 用户消息气泡（hover 显示复制与编辑图标，§31.6；编辑 = 回填输入框）。 */
function UserBubble({ text, time, nodeKey, highlight, onEdit }: { text: string; time?: number; nodeKey?: string; highlight?: boolean; onEdit?: (text: string) => void }) {
  return jsxs('div', {
    className: `evo-msg-row evo-msg-user${highlight ? ' evo-msg-jump' : ''}`,
    'data-node-key': nodeKey,
    children: [
      jsx('div', { className: 'evo-msg-user-body' }),
      jsxs('div', {
        className: 'evo-msg-bubble evo-msg-bubble-user',
        children: [
          jsx('div', { className: 'evo-msg-text evo-md', dangerouslySetInnerHTML: { __html: renderMarkdown(text) } }),
          jsx('div', {
            className: 'evo-msg-meta',
            children: [
              jsx('div', { className: 'evo-msg-time', children: fmtTime(time) }),
              onEdit !== undefined && jsx('button', {
                type: 'button',
                className: 'evo-msg-copy',
                title: 'Edit（回填输入框）',
                'aria-label': 'Edit message',
                onClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); onEdit(text) },
                children: jsx(PenLine, {}),
              }),
              jsx(CopyButton, { text }),
            ],
          }),
        ],
      }),
    ],
  })
}

/** 助手消息（头像 + 内容 + Thinking 折叠 + 工具卡片分组）。 */
function AssistantBubble({ node, nodeKey, highlight, toolResults }: { node: ChatNode; nodeKey?: string; highlight?: boolean; toolResults: Record<string, { text: string; isError: boolean }> }) {
  const text = assistantText(node)
  const reasoning = assistantReasoning(node)
  const tools = assistantTools(node, toolResults)
  const running = node.data.status === 'running'
  const settled = node.data.status === 'settled'
  // 推理默认折叠（§31.6：小号 Thinking 行，展开后左侧 2px 边线 + 次级文字）
  const [thinkingOpen, setThinkingOpen] = useState(false)
  // 工具组：默认折叠已完成的组（§21.1），运行中自动展开
  const [toolsOpen, setToolsOpen] = useState(!settled)
  const anyRunning = tools.some((t) => t.result === undefined)
  return jsxs('div', {
    className: `evo-msg-row${highlight ? ' evo-msg-jump' : ''}`,
    'data-node-key': nodeKey,
    children: [
      jsx('div', { className: 'evo-msg-avatar', children: jsx(User, {}) }),
      jsxs('div', {
        className: 'evo-msg-body',
        children: [
          reasoning !== '' && jsxs('div', {
            className: 'evo-thinking',
            children: [
              jsx('button', {
                type: 'button',
                className: 'evo-thinking-toggle',
                'aria-expanded': thinkingOpen || undefined,
                onClick: () => setThinkingOpen((v) => !v),
                children: jsxs(Fragment, {
                  children: [
                    jsx(ChevronRight, { className: `evo-tool-chev${thinkingOpen ? ' open' : ''}` }),
                    jsx('span', { children: 'Thinking' }),
                  ],
                }),
              }),
              thinkingOpen && jsx('div', { className: 'evo-thinking-body', children: reasoning }),
            ],
          }),
          text !== '' && jsx('div', {
            className: 'evo-msg-bubble evo-msg-bubble-assistant',
            children: [
              jsx('div', { className: 'evo-msg-text evo-md', dangerouslySetInnerHTML: { __html: renderMarkdown(text) } }),
              jsxs('div', {
                className: 'evo-msg-meta',
                children: [
                  running && jsx('span', { className: 'evo-msg-cursor' }),
                  !running && jsx(CopyButton, { text }),
                ],
              }),
            ],
          }),
          tools.length > 0 && jsxs('div', {
            className: 'evo-tool-group',
            children: [
              jsx('button', {
                type: 'button',
                className: 'evo-tool-group-head',
                onClick: () => setToolsOpen((v) => !v),
                'aria-expanded': toolsOpen || undefined,
                children: jsxs(Fragment, {
                  children: [
                    jsx(ChevronRight, { className: `evo-tool-chev${toolsOpen ? ' open' : ''}` }),
                    anyRunning ? jsx('span', { className: 'evo-tool-spinner', 'aria-label': 'running' }) : jsx(Wrench, {}),
                    jsx('span', { children: `Tools · ${tools.length}` }),
                    jsx('span', { className: 'evo-tool-group-state', children: anyRunning ? 'running' : 'done' }),
                  ],
                }),
              }),
              toolsOpen && jsx('div', {
                className: 'evo-tool-group-body',
                children: tools.map((tool, i) => jsx(ToolCard, { tool, running: running || tool.result === undefined, defaultExpanded: anyRunning }, `${node.key}-tool-${i}`)),
              }),
            ],
          }),
        ],
      }),
    ],
  })
}

export function ChatArea({ nodes, partial, running, error, currentTitle, sessionId, session, cwd, jobs, onOpenThread, onSend }: ChatAreaProps) {
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState(false)
  const [autoApprove, setAutoApprove] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  // ── 会话动作（§25.6）：Current / Search / Notify / Shortcuts / Compact / Clear view ──
  const [actionDialog, setActionDialog] = useState<null | 'current' | 'search' | 'shortcuts' | 'compact' | 'model' | 'wf-clear'>(null)
  const [clearView, setClearView] = useState(false)
  const [notifyOn, setNotifyOn] = useState(() => {
    try { return localStorage.getItem('evoresearch-notifications') === '1' } catch { return false }
  })
  const [jumpKey, setJumpKey] = useState<string | null>(null)

  // 状态条模型 chip → 打开模型选择器（§25.2：模型名本身是按钮）
  useEffect(() => {
    const open = () => setActionDialog('model')
    window.addEventListener('evo-open-model-selector', open)
    return () => window.removeEventListener('evo-open-model-selector', open)
  }, [])

  // ── 忙时消息队列 UI（§23.6）：编辑 / 删除 / 清空（官方 session.updateQueue）──
  const [queueOpen, setQueueOpen] = useState(false)
  const [queueEditId, setQueueEditId] = useState<string | null>(null)
  const [queueEditText, setQueueEditText] = useState('')
  const queueItems = session?.snapshotCache?.queue ?? []

  // ── 后台任务（§21.6）：会话 jobsBySession 快照 → 弹层 ──
  const [jobsOpen, setJobsOpen] = useState(false)
  const liveJobCount = jobs.filter((j) => j.status === 'running' || j.status === 'stopping').length
  const queueText = (item: any): string => {
    const c = item?.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) return c.map((b: any) => (b?.type === 'text' ? b.text : '')).join('')
    return String(item?.id ?? '')
  }
  const queueItemId = (item: any): string => item?.id ?? ''
  const applyQueueAction = (itemId: string, action: { kind: 'edit'; content: Array<{ type: string; text: string }> } | { kind: 'remove' }) => {
    const s = session
    if (s?.updateQueue === undefined || itemId === '') return
    void s.updateQueue(itemId, action)
  }
  const saveQueueEdit = (id: string) => {
    const text = queueEditText.trim()
    if (text === '') applyQueueAction(id, { kind: 'remove' })
    else applyQueueAction(id, { kind: 'edit', content: [{ type: 'text', text }] })
    setQueueEditId(null)
  }
  const clearQueue = () => { for (const item of queueItems) applyQueueAction(queueItemId(item), { kind: 'remove' }) }

  // ── 队列转向（§23.6 steer，官方 session.updateQueue kind:'steer'）──
  // 仅 next-turn 队列消息（placement === 'queued'）且本轮运行中可转向：
  // host 把该消息注入当前 turn（agent.steer），并从队列移除。
  const [queueError, setQueueError] = useState<string | null>(null)
  const steerQueue = (itemId: string) => {
    const s = session
    if (s?.updateQueue === undefined || itemId === '') return
    setQueueError(null)
    void s.updateQueue(itemId, { kind: 'steer' }).then((r: any) => {
      if (r?.ok !== true) {
        const message = (r?.error as { message?: string } | undefined)?.message ?? 'steer 失败'
        setQueueError(message)
        setTimeout(() => setQueueError(null), 5000)
      }
    })
  }

  // ── 停止本轮（§21.6 stop，官方 session.cancel：停止当前 turn、保留排队消息）──
  const stopTurn = () => {
    const s = session
    if (s?.cancel === undefined) return
    void s.cancel()
  }

  // ── HITL 审批（§21.2）：会话待审批工具调用卡片 ──
  const pendingApprovals = (session?.snapshotCache?.pending ?? []).filter((p: any) => p?.kind === 'approval')
  const respondApproval = (wait: any, outcome: 'allowed-once' | 'rejected') => {
    try {
      wait.respond({ ok: true, value: { sessionId: wait.sessionId, approvalId: wait.payload?.approvalId, outcome } })
    } catch { /* 已结算 */ }
  }

  // 切换会话时重置 Clear view 与跳转高亮
  useEffect(() => { setClearView(false); setJumpKey(null) }, [sessionId])

  const toggleNotify = () => {
    if (notifyOn) {
      setNotifyOn(false)
      try { localStorage.removeItem('evoresearch-notifications') } catch { /* 忽略 */ }
      return
    }
    if (typeof Notification !== 'undefined') {
      const permission = Notification.requestPermission()
      if (permission instanceof Promise) {
        void permission.then((result) => {
          if (result === 'granted') {
            setNotifyOn(true)
            try { localStorage.setItem('evoresearch-notifications', '1') } catch { /* 忽略 */ }
            try { new Notification('EvoResearch notifications enabled') } catch { /* 忽略 */ }
          }
        })
      } else if (permission === 'granted') {
        setNotifyOn(true)
        try { localStorage.setItem('evoresearch-notifications', '1') } catch { /* 忽略 */ }
      }
    }
  }

  const jumpToNode = (key: string) => {
    if (key === '') return
    const el = listRef.current?.querySelector(`[data-node-key="${CSS.escape(key)}"]`) as HTMLElement | null
    if (el !== null) {
      el.scrollIntoView({ block: 'center' })
      setJumpKey(key)
      setTimeout(() => setJumpKey(null), 1600)
    }
    setActionDialog(null)
  }

  // 用户消息编辑（§31.6 编辑图标）：回填输入框并聚焦（host 无已发消息修改 API）
  const editUserMessage = (text: string) => {
    setInput(text)
    setPreview(false)
    setTrigger(null)
    requestAnimationFrame(() => {
      const el = taRef.current
      if (el === null) return
      el.focus()
      el.selectionStart = el.selectionEnd = el.value.length
    })
  }

  // ── 输入辅助（§23.2–23.5）：斜杠命令 / @文件 / 输入历史 ──
  const commandCatalog = useCommandCatalog()
  const fileTree = useFileTree(cwd)
  const [history, setHistory] = useState<string[]>(() => readHistory(cwd))
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [trigger, setTrigger] = useState<Trigger | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  // workspace 切换时重载历史（§23.5：不读取/覆盖其他 workspace 的键）
  useEffect(() => { setHistory(readHistory(cwd)); setHistoryIndex(-1) }, [cwd])

  const candidates = trigger === null ? [] : buildCandidates(trigger, commandCatalog, fileTree, history)

  const refreshTrigger = (value: string, pos: number) => {
    const next = detectTrigger(value, pos)
    setTrigger(next)
    setActiveIndex(0)
  }

  const applyCandidate = (c: Candidate) => {
    const el = taRef.current
    const pos = el?.selectionStart ?? input.length
    const t = detectTrigger(input, pos)
    let next: string
    let nextCursor: number
    if (t !== null && (t.kind === 'mention' || t.kind === 'command')) {
      next = input.slice(0, t.start) + c.insert + input.slice(pos)
      nextCursor = t.start + c.insert.length
    } else {
      next = c.insert
      nextCursor = next.length
    }
    setInput(next)
    setTrigger(null)
    setHistoryIndex(-1)
    requestAnimationFrame(() => {
      if (el === null) return
      el.focus()
      el.selectionStart = el.selectionEnd = nextCursor
    })
  }

  const browseHistory = (delta: -1 | 1) => {
    if (history.length === 0) return
    const current = historyIndex
    let next: number
    if (current === -1) next = delta === -1 ? 0 : history.length - 1
    else next = Math.min(Math.max(current + delta, 0), history.length - 1)
    setHistoryIndex(next)
    setInput(history[next])
    requestAnimationFrame(() => {
      const el = taRef.current
      if (el !== null) el.selectionStart = el.selectionEnd = el.value.length
    })
  }

  // ── 历史分页与滚动行为（移植规范 §9）──
  // 默认只渲染最近 PAGE_SIZE 条；Load earlier 向前扩展并保持视觉位置；
  // 仅在用户原本位于底部时自动跟随新消息；不在底部时显示"回到最新"按钮。
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [showJump, setShowJump] = useState(false)
  const nearBottomRef = useRef(true)
  const anchorRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null)

  // 新消息/流式更新时：仅当位于底部才滚动到底部（§9.3）
  useEffect(() => {
    const el = listRef.current
    if (el === null || !nearBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [nodes.length, partial?.data.blocks])

  // Mermaid 惰性渲染（§31.5）：流式期间不绘制，回答结束后按需加载 /assets/mermaid.js
  useEffect(() => {
    if (running) return
    const root = listRef.current
    if (root !== null) void renderMermaidBlocks(root)
    const previewEl = document.querySelector<HTMLElement>('.evo-composer-preview')
    if (previewEl !== null) void renderMermaidBlocks(previewEl)
  }, [nodes, running, preview])

  // 展开更早历史后恢复原视觉位置（§9.2 滚动锚定）
  useLayoutEffect(() => {
    const el = listRef.current
    if (el !== null && anchorRef.current !== null) {
      el.scrollTop = anchorRef.current.scrollTop + (el.scrollHeight - anchorRef.current.scrollHeight)
      anchorRef.current = null
    }
  }, [visibleCount])

  const onListScroll = () => {
    const el = listRef.current
    if (el === null) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= 1
    nearBottomRef.current = near
    setShowJump(!near)
  }

  const loadEarlier = () => {
    const el = listRef.current
    if (el !== null) anchorRef.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight }
    setVisibleCount((v) => v + PAGE_SIZE)
  }

  const jumpToLatest = () => {
    const el = listRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
    nearBottomRef.current = true
    setShowJump(false)
    // 回到最新后释放旧页（§9.3：位于底部时 DOM 只保留最近一页）
    if (visibleCount > PAGE_SIZE) setVisibleCount(PAGE_SIZE)
  }

  // ── 斜杠命令直接执行（§23.3）：Enter 执行，结果以文本显示在输入区上方 ──
  const [cmdResult, setCmdResult] = useState<{ line: string; text: string; kind: string } | null>(null)
  const [cmdRunning, setCmdRunning] = useState(false)
  const executeCommand = async (line: string): Promise<boolean> => {
    if (sessionId === null) return false
    setCmdRunning(true)
    try {
      const res = await fetch('/evoresearch/fs/commands-execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, line }),
      })
      const json = await res.json()
      if (json.ok && json.value?.matched === true && json.value?.result !== null) {
        const outer = json.value.result
        const inner = outer?.result ?? outer
        setCmdResult({ line, text: inner?.text ?? '', kind: inner?.kind ?? 'success' })
        return true
      }
      return false
    } catch {
      return false
    } finally {
      setCmdRunning(false)
    }
  }

  const submit = async () => {
    const text = input.trim()
    // Pending 审批时禁用发送（§21.2：避免新消息污染待审批工具调用）
    if (!text || pendingApprovals.length > 0) return
    // 斜杠命令：单行且以 / 开头 → 直接执行（未知命令降级为普通聊天，§23.3）
    if (text.startsWith('/') && !text.includes('\n')) {
      const matched = await executeCommand(text)
      if (matched) {
        pushHistory(cwd, text)
        setHistory(readHistory(cwd))
        setInput('')
        setTrigger(null)
        setHistoryIndex(-1)
        return
      }
    }
    // @引用解析（§23.4）：小型文本文件注入内容，其余保留路径
    const resolved = await resolveMentions(text, cwd)
    // 忙时也允许发送：消息进入 append-only 队列（§23.6），由 host 顺序消费
    onSend(resolved)
    pushHistory(cwd, text)
    setHistory(readHistory(cwd))
    setInput('')
    setTrigger(null)
    setHistoryIndex(-1)
    setPreview(false)
  }

  const hasMessages = nodes.length > 0 || partial !== null
  const ordered = [...nodes].sort((a, b) => a.anchorSeq - b.anchorSeq)

  // ── Dynamic Workflow（§24）：workflow-run 节点 → 输入区上方阶段条 ──
  const workflowNodes = (nodes as Array<ChatNode & { data?: any }>).filter((n) => n.kind === 'workflow-run')
  const messageNodes = ordered.filter((n) => n.kind !== 'workflow-run')
  const shown = messageNodes.slice(-visibleCount)
  const hasMore = messageNodes.length > visibleCount
  const showMessages = hasMessages && !clearView
  const toolResults = toolResultsOf(session)
  const [wfCleared, setWfCleared] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`evoresearch-dynamic-workflows:${sessionId ?? ''}`) ?? '[]') } catch { return [] }
  })
  const [wfTick, setWfTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setWfTick((v) => v + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    try { localStorage.setItem(`evoresearch-dynamic-workflows:${sessionId ?? ''}`, JSON.stringify(wfCleared)) } catch { /* 忽略 */ }
  }, [wfCleared, sessionId])
  const latestWorkflow = workflowNodes[workflowNodes.length - 1] as (ChatNode & { data: { name?: string; members?: Array<{ seq: number; label: string; phase?: string | null; status: string }>; stopReason?: string; startedAt?: number; endedAt?: number } }) | undefined
  const wfVisible = latestWorkflow !== undefined && !wfCleared.includes(latestWorkflow.key)
  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    return `${m}m ${s % 60}s`
  }

  return jsxs(Fragment, {
    children: [
      jsx('div', {
        className: 'evo-chat',
        children: showMessages
          ? jsxs('div', {
              ref: listRef,
              className: 'evo-msg-list',
              onScroll: onListScroll,
              children: [
                error !== null && jsx('div', { className: 'evo-msg-error', children: `发送失败：${error}` }),
                hasMore && jsx('button', {
                  type: 'button',
                  className: 'evo-load-earlier',
                  onClick: loadEarlier,
                  children: jsxs(Fragment, {
                    children: [jsx(ChevronUp, {}), jsx('span', { children: t('loadEarlier') })],
                  }),
                }),
                ...shown.map((node) => node.kind === 'user'
                  ? jsx(UserBubble, { text: node.data.text ?? '', time: node.data.time, nodeKey: node.key, highlight: node.key === jumpKey, onEdit: editUserMessage }, node.key)
                  : jsx(AssistantBubble, { node, nodeKey: node.key, highlight: node.key === jumpKey, toolResults }, node.key)),
                partial !== null && !ordered.some((n) => n.key === partial.key) && jsx(AssistantBubble, { node: partial, toolResults }, partial.key),
                showJump && jsx('button', {
                  type: 'button',
                  className: 'evo-jump-latest',
                  title: t('jumpToLatest'),
                  'aria-label': t('jumpToLatest'),
                  onClick: jumpToLatest,
                  children: jsxs(Fragment, {
                    children: [jsx(ChevronDown, {}), jsx('span', { children: t('latest') })],
                  }),
                }),
              ],
            })
          : clearView && hasMessages
            ? jsx('div', {
                className: 'evo-clear-notice',
                children: jsxs('div', {
                  className: 'evo-clear-notice-box',
                  children: [
                    jsx('div', { className: 'evo-clear-notice-title', children: 'View cleared' }),
                    jsx('div', { className: 'evo-clear-notice-sub', children: '仅清空了本页展示，会话数据未删除；刷新页面即可恢复全部消息。' }),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-btn evo-btn-run',
                      onClick: () => setClearView(false),
                      children: 'Restore view',
                    }),
                  ],
                }),
              })
            : jsxs('div', {
                className: 'evo-welcome',
                children: [
                  jsx('h1', { children: t('welcome') }),
                  jsx('p', { children: t('tagline') }),
                  jsx('div', {
                    className: 'evo-suggest',
                    children: SUGGESTED_PROMPTS.map((p) => jsx('button', {
                      type: 'button',
                      className: 'evo-suggest-card',
                      onClick: () => onSend(p),
                      children: p,
                    }, p)),
                  }),
                ],
              }),
      }),
      // ── 命令执行结果条（§23.3：结果以文本/表格显示在输入框上方）──
      (cmdResult !== null || cmdRunning) && jsx('div', {
        className: 'evo-cmd-strip',
        children: jsx('div', {
          className: `evo-cmd-card${cmdResult !== null && cmdResult.kind === 'error' ? ' error' : ''}`,
          children: [
            jsx(Command, {}),
            jsx('code', { className: 'evo-cmd-line', children: cmdResult?.line ?? '' }),
            cmdRunning && cmdResult === null && jsx('span', { className: 'evo-cmd-running', children: 'running…' }),
            cmdResult !== null && jsx('pre', { className: 'evo-cmd-output', children: cmdResult.text }),
            cmdResult !== null && jsx('button', {
              type: 'button',
              className: 'evo-cmd-dismiss',
              title: 'Dismiss',
              'aria-label': 'Dismiss',
              onClick: () => setCmdResult(null),
              children: jsx(XIcon, {}),
            }),
          ],
        }),
      }),
      // ── Dynamic Workflow 条（§24）：phase / evaluation / duration / 状态 + 清除 ──
      wfVisible && latestWorkflow !== undefined && jsxs('div', {
        className: 'evo-wf-strip',
        children: [
          jsxs('div', {
            className: 'evo-wf-bar',
            children: [
              jsx(ListTodo, {}),
              jsx('span', { className: 'evo-wf-name', children: latestWorkflow.data?.name ?? 'Workflow' }),
              jsx('span', { className: 'evo-wf-members', children: (latestWorkflow.data?.members ?? []).map((m) => jsx('span', {
                className: `evo-wf-member${m.status === 'completed' ? ' done' : m.status === 'running' ? ' running' : ' failed'}`,
                title: m.phase ?? m.status,
                children: m.label,
              }, `${m.seq}:${m.label}`)) }),
              (latestWorkflow.data?.members?.filter((m) => m.status === 'completed').length ?? 0) > 0
                && jsx('span', { className: 'evo-wf-count', children: `${(latestWorkflow.data?.members ?? []).filter((m) => m.status === 'completed').length}/${(latestWorkflow.data?.members ?? []).length}` }),
              jsx('span', { className: 'evo-wf-duration', children: formatDuration(((latestWorkflow.data?.endedAt ?? Date.now()) - (latestWorkflow.data?.startedAt ?? Date.now()))) }),
              latestWorkflow.data?.stopReason !== undefined && jsx('span', { className: 'evo-wf-status', children: latestWorkflow.data.stopReason }),
              jsx('button', {
                type: 'button',
                className: 'evo-wf-clear',
                title: 'Clear workflow',
                'aria-label': 'Clear workflow',
                onClick: () => setActionDialog('wf-clear'),
                children: jsx(XIcon, {}),
              }),
            ],
          }),
        ],
      }),
      // ── HITL 审批条（§21.2）：逐个显示待审批工具调用 ──
      pendingApprovals.length > 0 && jsx('div', {
        className: 'evo-approval-strip',
        children: jsx('div', {
          className: 'evo-approval-list',
          children: pendingApprovals.map((wait: any) => {
            const payload = wait.payload ?? {}
            return jsxs('div', {
              className: 'evo-approval-card',
              children: [
                jsxs('div', {
                  className: 'evo-approval-head',
                  children: [
                    jsx(ShieldCheckIcon, {}),
                    jsx('span', { children: 'Tool approval required' }),
                  ],
                }),
                jsxs('div', {
                  className: 'evo-approval-body',
                  children: [
                    jsx('code', { className: 'evo-approval-tool', children: payload.toolName ?? 'tool' }),
                    payload.callId !== undefined && jsx('span', { className: 'evo-approval-callid', children: payload.callId }),
                  ],
                }),
                payload.reason !== undefined && payload.reason !== '' && jsx('div', { className: 'evo-approval-reason', children: payload.reason }),
                jsxs('div', {
                  className: 'evo-approval-acts',
                  children: [
                    jsx('button', {
                      type: 'button',
                      className: 'evo-btn evo-btn-ok',
                      onClick: () => respondApproval(wait, 'allowed-once'),
                      children: jsxs(Fragment, { children: [jsx(Check, {}), jsx('span', { children: 'Approve' })] }),
                    }),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-btn evo-btn-danger',
                      onClick: () => respondApproval(wait, 'rejected'),
                      children: jsxs(Fragment, { children: [jsx(ShieldX, {}), jsx('span', { children: 'Reject' })] }),
                    }),
                  ],
                }),
              ],
            }, wait.key)
          }),
        }),
      }),
      jsxs('div', {
        className: 'evo-composer-wrap',
        children: [
          jsxs('div', {
            className: 'evo-composer',
            children: [
              jsxs('div', {
                className: 'evo-composer-status',
                children: [
                  jsx('span', { className: 'evo-composer-dot', 'data-busy': running || undefined }),
                  jsx('span', { children: currentTitle === null ? t('noActiveConversation') : running ? t('running') : currentTitle }),
                  jsx(SessionStatusLine, { session }),
                  jsx('span', { style: { flex: 1 } }),
                  // 停止本轮（官方 session.cancel；host 保留排队消息）
                  running && jsx('button', {
                    type: 'button',
                    className: 'evo-composer-stop',
                    title: t('stopTurn'),
                    'aria-label': t('stopTurn'),
                    onClick: stopTurn,
                    children: jsx(Square, {}),
                  }),
                  // Markdown 输入预览：Write / Preview 切换
                  jsx('div', {
                    className: 'evo-md-toggle',
                    role: 'group',
                    'aria-label': 'Markdown preview',
                    children: [
                      jsx('button', {
                        type: 'button',
                        className: 'evo-md-toggle-btn',
                        'data-active': !preview || undefined,
                        title: t('write'),
                        'aria-label': t('write'),
                        onClick: () => setPreview(false),
                        children: jsx(PenLine, {}),
                      }, 'write'),
                      jsx('button', {
                        type: 'button',
                        className: 'evo-md-toggle-btn',
                        'data-active': preview || undefined,
                        title: t('preview'),
                        'aria-label': t('preview'),
                        onClick: () => setPreview(true),
                        children: jsx(Eye, {}),
                      }, 'preview'),
                    ],
                  }),
                ],
              }),
              preview
                ? jsx('div', {
                    className: 'evo-composer-preview evo-md',
                    children: input.trim() === ''
                      ? jsx('span', { className: 'evo-composer-preview-empty', children: t('previewEmpty') })
                      : jsx(Fragment, { children: [jsx('div', { dangerouslySetInnerHTML: { __html: renderMarkdown(input) } })] }),
                  })
                : jsx('textarea', {
                ref: taRef,
                className: 'evo-composer-textarea',
                placeholder: t('askAnything'),
                rows: 1,
                value: input,
                onInput: (e) => {
                  setInput(e.currentTarget.value)
                  e.currentTarget.style.height = 'auto'
                  e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 220)}px`
                  refreshTrigger(e.currentTarget.value, e.currentTarget.selectionStart)
                },
                onKeyUp: (e) => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
                    refreshTrigger(e.currentTarget.value, e.currentTarget.selectionStart)
                  }
                },
                onClick: (e) => refreshTrigger(e.currentTarget.value, e.currentTarget.selectionStart),
                onKeyDown: (e) => {
                  // 候选弹层键盘导航（§23.2：Tab 应用、上下移动、Esc 关闭）
                  if (candidates.length > 0) {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => (i + 1) % candidates.length); return }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => (i - 1 + candidates.length) % candidates.length); return }
                    if (e.key === 'Tab') { e.preventDefault(); applyCandidate(candidates[activeIndex]); return }
                    if (e.key === 'Escape') { e.preventDefault(); setTrigger(null); return }
                  }
                  // 空输入上下键浏览输入历史（§23.5）
                  if (e.key === 'ArrowUp' && input === '') { e.preventDefault(); browseHistory(-1); return }
                  if (e.key === 'ArrowDown' && input === '' && historyIndex !== -1) { e.preventDefault(); browseHistory(1); return }
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void submit()
                  }
                },
              }),
              candidates.length > 0 && jsx(CandidatePopup, {
                candidates,
                active: activeIndex,
                onActive: setActiveIndex,
                onApply: applyCandidate,
                onClose: () => setTrigger(null),
                label: trigger?.kind === 'command' ? 'Commands' : trigger?.kind === 'mention' ? 'File mentions' : 'History',
              }),
              jsxs('div', {
                className: 'evo-composer-tools',
                children: [
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    title: t('attachFiles'),
                    children: jsx(Paperclip, {}),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    'data-on': autoApprove || undefined,
                    onClick: () => setAutoApprove((v) => !v),
                    children: jsxs(Fragment, {
                      children: [jsx(ShieldCheck, {}), jsx('span', { children: t('autoApprove') })],
                    }),
                  }),
                  // ── 会话动作（§25.6）──
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    'data-on': queueItems.length > 0 || undefined,
                    title: queueItems.length > 0 ? `Queued messages（${queueItems.length}）` : 'Queued messages',
                    'aria-label': 'Queued messages',
                    onClick: () => setQueueOpen((v) => !v),
                    children: jsxs(Fragment, {
                      children: [jsx(ListTodo, {}), queueItems.length > 0 && jsx('span', { className: 'evo-queue-count', children: String(queueItems.length) })],
                    }),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    'data-on': liveJobCount > 0 || undefined,
                    title: jobs.length > 0 ? `Background jobs（${jobs.length}${liveJobCount > 0 ? `，${liveJobCount} running` : ''}）` : 'Background jobs',
                    'aria-label': 'Background jobs',
                    onClick: () => setJobsOpen((v) => !v),
                    children: jsxs(Fragment, {
                      children: [jsx(Terminal, {}), jobs.length > 0 && jsx('span', { className: 'evo-queue-count', children: String(jobs.length) })],
                    }),
                  }),
                  jsx('span', { className: 'evo-composer-divider' }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    title: 'Compact（摘要投影，不删历史）',
                    'aria-label': 'Compact',
                    onClick: () => setActionDialog('compact'),
                    children: jsx(Shrink, {}),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    title: 'Current session',
                    'aria-label': 'Current session',
                    onClick: () => setActionDialog('current'),
                    children: jsx(Info, {}),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    title: 'Search',
                    'aria-label': 'Search',
                    onClick: () => setActionDialog('search'),
                    children: jsx(Search, {}),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    'data-on': notifyOn || undefined,
                    title: notifyOn ? 'Notifications on' : 'Notifications off',
                    'aria-label': 'Notifications',
                    onClick: toggleNotify,
                    children: notifyOn ? jsx(Bell, {}) : jsx(BellOff, {}),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    title: 'Keyboard shortcuts',
                    'aria-label': 'Keyboard shortcuts',
                    onClick: () => setActionDialog('shortcuts'),
                    children: jsx(Keyboard, {}),
                  }),
                  jsx('span', { className: 'evo-composer-spacer' }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-send',
                    disabled: !input.trim() || pendingApprovals.length > 0,
                    onClick: submit,
                    children: jsxs(Fragment, {
                      children: [jsx('span', { children: t('send') }), jsx(ArrowUp, {})],
                    }),
                  }),
                ],
              }),
              jsx(SessionStatsLine, { session }),
            ],
          }),
        ],
      }),
      // ── 会话动作弹窗（§25.6 / §26.8）──
      actionDialog === 'current' && sessionId !== null && jsx(CurrentDialog, {
        sessionId,
        cwd,
        session,
        onClose: () => setActionDialog(null),
        onClearView: () => setClearView(true),
      }),
      actionDialog === 'search' && sessionId !== null && jsx(SearchDialog, {
        nodes: nodes as Array<{ key: string; kind: string; data: { text?: string } }>,
        sessionId,
        onClose: () => setActionDialog(null),
        onJumpToNode: jumpToNode,
        onOpenThread,
      }),
      actionDialog === 'shortcuts' && jsx(ShortcutsDialog, { onClose: () => setActionDialog(null) }),
      actionDialog === 'model' && jsx(ModelSelectorDialog, { onClose: () => setActionDialog(null) }),
      actionDialog === 'compact' && jsx(ConfirmDialog, {
        title: 'Compact',
        message: 'Compact 会对较早的活跃上下文生成摘要投影（§10.3），完整聊天仍保存在数据库中。确认继续？',
        confirmLabel: 'Compact',
        onConfirm: () => {
          // 直接执行 /compact 命令（官方 session.command，不产生模型回复回显）
          if (session?.command !== undefined) void session.command('/compact')
          else onSend('/compact')
        },
        onClose: () => setActionDialog(null),
      }),
      actionDialog === 'wf-clear' && latestWorkflow !== undefined && jsx(ConfirmDialog, {
        title: 'Clear workflow',
        message: '清除当前 Dynamic Workflow 的展示记录（§24：仅移除浏览器持久化记录，不影响会话与执行）。确认？',
        confirmLabel: 'Clear',
        danger: true,
        onConfirm: () => setWfCleared((list) => [...list, latestWorkflow.key]),
        onClose: () => setActionDialog(null),
      }),
      // ── 忙时消息队列弹层（§23.6）──
      queueOpen && queueItems.length > 0 && jsxs('div', {
        className: 'evo-queue',
        children: [
          jsxs('div', {
            className: 'evo-queue-head',
            children: [
              jsx('span', { className: 'evo-insp-subtab-title', children: `Queued messages（${queueItems.length}）` }),
              queueError !== null && jsx('span', { className: 'evo-tl-fork-error', children: queueError }),
              jsx('span', { style: { flex: 1 } }),
              jsx('button', {
                type: 'button',
                className: 'evo-icon-btn',
                title: 'Clear queue',
                'aria-label': 'Clear queue',
                onClick: clearQueue,
                children: jsx(Trash2, {}),
              }),
            ],
          }),
          jsx('div', {
            className: 'evo-queue-list',
            children: queueItems.map((item: any) => {
              const id = queueItemId(item)
              if (queueEditId === id) {
                return jsxs('div', {
                  className: 'evo-queue-row',
                  children: [
                    jsx('input', {
                      type: 'text',
                      className: 'evo-queue-input',
                      value: queueEditText,
                      autoFocus: true,
                      onInput: (e) => setQueueEditText(e.currentTarget.value),
                      onKeyDown: (e) => {
                        if (e.key === 'Enter') saveQueueEdit(id)
                        if (e.key === 'Escape') setQueueEditId(null)
                      },
                    }),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-queue-act',
                      title: 'Save',
                      'aria-label': 'Save',
                      onClick: () => saveQueueEdit(id),
                      children: jsx(Check, {}),
                    }),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-queue-act',
                      title: 'Cancel',
                      'aria-label': 'Cancel',
                      onClick: () => setQueueEditId(null),
                      children: jsx(XIcon, {}),
                    }),
                  ],
                }, `edit-${id}`)
              }
              return jsxs('div', {
                className: 'evo-queue-row',
                children: [
                  jsx('span', { className: 'evo-queue-text', children: queueText(item) }),
                  // 转向本轮：仅 next-turn 排队消息（placement 'queued'）且本轮运行中
                  running && item?.placement === 'queued' && jsx('button', {
                    type: 'button',
                    className: 'evo-queue-act evo-queue-steer',
                    title: t('steerTurn'),
                    'aria-label': t('steerTurn'),
                    onClick: () => steerQueue(id),
                    children: jsx(CornerUpRight, {}),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-queue-act',
                    title: 'Edit',
                    'aria-label': 'Edit',
                    onClick: () => { setQueueEditId(id); setQueueEditText(queueText(item)) },
                    children: jsx(PenLine, {}),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-queue-act',
                    title: 'Remove',
                    'aria-label': 'Remove',
                    onClick: () => applyQueueAction(id, { kind: 'remove' }),
                    children: jsx(XIcon, {}),
                  }),
                ],
              }, id)
            }),
          }),
        ],
      }),
      // ── 后台任务弹层（§21.6）──
      jobsOpen && jobs.length > 0 && jsxs('div', {
        className: 'evo-queue',
        children: [
          jsx('div', {
            className: 'evo-queue-head',
            children: jsx('span', { className: 'evo-insp-subtab-title', children: `Background jobs（${jobs.length}）` }),
          }),
          jsx('div', {
            className: 'evo-queue-list',
            children: jobs.map((job) => {
              const live = job.status === 'running' || job.status === 'stopping'
              const end = job.finishedAt ?? Date.now()
              const dur = Math.max(0, Math.floor(((live ? end : (job.finishedAt ?? end)) - (job.startedAt ?? end)) / 1000))
              const statusText = job.status === 'running' ? 'running' : job.status === 'stopping' ? 'stopping' : job.status === 'completed' ? 'completed' : job.status === 'killed' ? 'killed' : 'failed'
              return jsxs('div', {
                className: 'evo-job-row',
                children: [
                  jsx('span', { className: `evo-job-dot ${live ? 'running' : statusText === 'completed' ? 'done' : statusText === 'failed' ? 'failed' : 'killed'}` }),
                  jsx('span', { className: 'evo-job-kind', children: job.kind }),
                  jsx('span', { className: 'evo-job-label', title: job.label, children: job.label }),
                  job.detail !== undefined && jsx('span', { className: 'evo-job-detail', children: job.detail }),
                  jsx('span', { className: 'evo-job-status', children: statusText }),
                  jsx('span', { className: 'evo-job-duration', children: dur < 60 ? `${dur}s` : `${Math.floor(dur / 60)}m ${dur % 60}s` }),
                ],
              }, job.id)
            }),
          }),
        ],
      }),
    ],
  })
}
