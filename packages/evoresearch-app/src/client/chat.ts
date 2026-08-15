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
  ListTodo, X as XIcon, Trash2, Terminal, XCircle, CheckCircle2, Command, Square, CornerUpRight, HelpCircle,
} from 'lucide-react'
import { t } from './i18n'
import { toast } from './toast'
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
  onSend: (text: string, images?: Array<{ data: string; mediaType: string; name?: string }>) => void
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
    title: copied ? t('copied') : t('copy'),
    'aria-label': copied ? t('copied') : t('copy'),
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
            ? jsx('span', { className: 'evo-tool-spinner', 'aria-label': t('runningDot') })
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
        title: argsOpen ? t('collapseArguments') : t('expandArguments'),
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
        title: resultOpen ? t('collapseResult') : t('expandResult'),
        children: jsxs(Fragment, {
          children: [
            jsx('span', { className: 'evo-tool-result-label', children: tool.isError ? t('toolError') : t('toolResult') }),
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
                title: t('editMsg'),
                'aria-label': t('editMsg'),
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
                    jsx('span', { children: t('thinking') }),
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
                    anyRunning ? jsx('span', { className: 'evo-tool-spinner', 'aria-label': t('runningDot') }) : jsx(Wrench, {}),
                    jsx('span', { children: `Tools · ${tools.length}` }),
                    jsx('span', { className: 'evo-tool-group-state', children: anyRunning ? t('runningDot') : t('done') }),
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

/**
 * 欢迎页 Research Dashboard（§31.7）：当前 workspace 的记忆/目标统计卡片。
 * 无数据时渲染空（保持欢迎页简洁）。
 */
function ResearchDashboard({ cwd }: { cwd: string | null }) {
  const [stats, setStats] = useState<{ turns: number; categories: number; goals: number } | null>(null)
  useEffect(() => {
    if (cwd === null) { setStats(null); return }
    let cancelled = false
    void Promise.all([
      fetch('/evoresearch/fs/memory-catalog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceDir: cwd }) })
        .then((r) => r.json()).catch(() => null),
      fetch('/evoresearch/fs/memory-goals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceDir: cwd }) })
        .then((r) => r.json()).catch(() => null),
    ]).then(([catalog, goals]) => {
      if (cancelled) return
      const rows: Array<{ category?: string; count?: number }> = Array.isArray(catalog?.value) ? catalog.value : []
      const turns = rows.reduce((a, c) => a + (typeof c.count === 'number' ? c.count : 0), 0)
      const categories = rows.filter((c) => typeof c.count === 'number' && c.count > 0).length
      const goalList = Array.isArray(goals?.value) ? goals.value : []
      if (turns === 0 && goalList.length === 0) { setStats(null); return }
      setStats({ turns, categories, goals: goalList.length })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [cwd])
  if (stats === null) return null
  const cards = [
    { label: t('memoryTurns'), value: stats.turns },
    { label: t('categories'), value: stats.categories },
    { label: t('activeGoals'), value: stats.goals },
  ]
  return jsx('div', {
    className: 'evo-dashboard',
    'aria-label': t('researchDashboard'),
    children: cards.map((card) => jsxs('div', {
      className: 'evo-dashboard-card',
      children: [
        jsx('div', { className: 'evo-dashboard-value', children: String(card.value) }),
        jsx('div', { className: 'evo-dashboard-label', children: card.label }),
      ],
    }, card.label)),
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

  // ── Ask User 问题卡片（§21.3）：模型 ask_user_question 工具 → snapshotCache.pending kind='question' ──
  const pendingQuestions = (session?.snapshotCache?.pending ?? []).filter((p: any) => p?.kind === 'question')
  const [questionSelections, setQuestionSelections] = useState<Record<string, string[]>>({})
  const [questionCustom, setQuestionCustom] = useState<Record<string, string>>({})
  const answerQuestion = (wait: any, answers: Array<{ id: string; selected: string[]; custom?: string }>) => {
    try {
      wait.respond({ ok: true, value: { sessionId: wait.sessionId, answer: { answers } } })
    } catch { /* 已结算 */ }
  }
  const cancelQuestion = (wait: any) => {
    try {
      wait.respond({ ok: false, error: { code: 'cancelled', message: 'the user closed this question request', details: {} } })
    } catch { /* 已结算 */ }
  }
  const toggleQuestionOption = (wait: any, question: any, optionLabel: string) => {
    const key = `${wait.key}:${question.id}`
    if (question.multiSelect === true) {
      setQuestionSelections((prev) => {
        const cur = prev[key] ?? []
        const next = cur.includes(optionLabel) ? cur.filter((l) => l !== optionLabel) : [...cur, optionLabel]
        return { ...prev, [key]: next }
      })
      return
    }
    // 单选：记录唯一选择（批处理提交；custom 有内容时先清空，避免冲突被 host 拒绝）
    if ((questionCustom[key] ?? '').trim() !== '') setQuestionCustom((prev) => ({ ...prev, [key]: '' }))
    setQuestionSelections((prev) => ({ ...prev, [key]: [optionLabel] }))
  }
  const submitQuestions = (wait: any, questions: Array<{ id: string }>) => {
    // 官方要求 answers 覆盖整批问题（matchesQuestions 校验长度与 id）
    const answers = questions.map((q) => {
      const key = `${wait.key}:${q.id}`
      const custom = (questionCustom[key] ?? '').trim()
      if (custom !== '') return { id: q.id, selected: [], custom }
      const selected = questionSelections[key] ?? []
      return { id: q.id, selected }
    })
    if (answers.some((a) => a.selected.length > 0 || (a.custom ?? '') !== '')) answerQuestion(wait, answers)
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
    // 附件未就绪（仍在读取）时禁用发送
    if (pendingImages.some((img) => img.dataUrl === '')) return
    // 斜杠命令：单行且以 / 开头 → 直接执行（未知命令降级为普通聊天，§23.3）
    if (text.startsWith('/') && !text.includes('\n') && pendingImages.length === 0) {
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
    const images = pendingImages
      .filter((img) => img.dataUrl !== '')
      .map((img) => ({ data: img.dataUrl.slice(img.dataUrl.indexOf(',') + 1), mediaType: img.mediaType, name: img.name }))
    onSend(resolved, images.length > 0 ? images : undefined)
    pushHistory(cwd, text)
    setHistory(readHistory(cwd))
    setInput('')
    setTrigger(null)
    setHistoryIndex(-1)
    setPreview(false)
    setPendingImages([])
  }

  // ── 附件（§23.7）：图片拖放/粘贴/文件选择 → prompt image 块；单文件 ≤5MB、一次 ≤20 张 ──
  const MAX_IMAGES_PER_MESSAGE = 20
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024
  const [pendingImages, setPendingImages] = useState<Array<{ id: string; name: string; mediaType: string; dataUrl: string; bytes: number }>>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const attachUidRef = useRef(0)
  const addImageFiles = async (files: Array<File>) => {
    const images = files.filter((f) => f.type.startsWith('image/'))
    const others = files.filter((f) => !f.type.startsWith('image/'))
    if (others.length > 0) {
      setAttachError('仅支持图片附件（文本文件可用 @ 引用注入内容）')
      setTimeout(() => setAttachError(null), 5000)
    }
    if (images.length === 0) return
    if (pendingImages.length + images.length > MAX_IMAGES_PER_MESSAGE) {
      setAttachError(`一次最多 ${MAX_IMAGES_PER_MESSAGE} 个附件`)
      setTimeout(() => setAttachError(null), 5000)
      return
    }
    const oversized = images.filter((f) => f.size > MAX_IMAGE_BYTES)
    if (oversized.length > 0) {
      setAttachError(`${oversized[0]!.name} 超过 5MB 限制`)
      setTimeout(() => setAttachError(null), 5000)
    }
    const admitted = images.filter((f) => f.size <= MAX_IMAGE_BYTES)
    if (admitted.length === 0) return
    const added = admitted.map((f) => ({ id: `att-${++attachUidRef.current}-${Date.now()}`, name: f.name, mediaType: f.type || 'image/png', dataUrl: '', bytes: f.size }))
    toast(`Added ${added.length} attachment${added.length > 1 ? 's' : ''}`, 'success')
    setPendingImages((prev) => [...prev, ...added])
    for (let i = 0; i < admitted.length; i += 1) {
      try {
        const buf = new Uint8Array(await admitted[i]!.arrayBuffer())
        let binary = ''
        const chunk = 0x8000
        for (let off = 0; off < buf.length; off += chunk) {
          binary += String.fromCharCode(...buf.subarray(off, Math.min(off + chunk, buf.length)))
        }
        const dataUrl = `data:${added[i]!.mediaType};base64,${btoa(binary)}`
        const id = added[i]!.id
        setPendingImages((prev) => prev.map((img) => (img.id === id ? { ...img, dataUrl } : img)))
      } catch { /* 读取失败则丢弃该项 */ }
    }
  }
  const removeImage = (id: string) => setPendingImages((prev) => prev.filter((img) => img.id !== id))
  const onPasteImages = (e: { clipboardData: DataTransfer | null }) => {
    if (e.clipboardData === null) return
    const files = Array.from(e.clipboardData.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (files.length > 0) {
      e.preventDefault?.()
      void addImageFiles(files)
    }
  }
  const onDropFiles = (e: { preventDefault(): void; dataTransfer: DataTransfer | null }) => {
    e.preventDefault()
    if (e.dataTransfer === null) return
    void addImageFiles(Array.from(e.dataTransfer.files ?? []))
  }
  const [dragOver, setDragOver] = useState(false)

  // ── 输入框高度拖动（§23.1）：顶边缘 8px 热区，垂直 resize，范围视口 1/4 ~ 2/3 ──
  const [composerHeight, setComposerHeight] = useState<number | null>(null)
  const composerResizeRef = useRef<{ startY: number; startH: number } | null>(null)
  const composerMinHeight = () => Math.max(80, Math.round((typeof window !== 'undefined' ? window.innerHeight : 900) / 4))
  const composerMaxHeight = () => Math.round((typeof window !== 'undefined' ? window.innerHeight : 900) * 2 / 3)
  const onComposerResizeStart = (e: { clientY: number; currentTarget: HTMLElement; pointerId: number; preventDefault(): void }) => {
    e.preventDefault()
    const el = taRef.current
    if (el === null) return
    composerResizeRef.current = { startY: e.clientY, startH: composerHeight ?? el.offsetHeight }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onComposerResizeMove = (e: { clientY: number; currentTarget: HTMLElement; pointerId: number }) => {
    const ref = composerResizeRef.current
    if (ref === null || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    const next = ref.startH + (e.clientY - ref.startY)
    setComposerHeight(Math.min(composerMaxHeight(), Math.max(composerMinHeight(), next)))
  }
  const onComposerResizeEnd = () => { composerResizeRef.current = null }

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
        className: `evo-chat${dragOver ? ' evo-chat-dragover' : ''}`,
        'data-attachments': pendingImages.length > 0 || undefined,
        onDragOver: (e: { preventDefault(): void }) => { e.preventDefault(); setDragOver(true) },
        onDragLeave: () => setDragOver(false),
        onDrop: onDropFiles,
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
                    jsx('div', { className: 'evo-clear-notice-title', children: t('viewCleared') }),
                    jsx('div', { className: 'evo-clear-notice-sub', children: '仅清空了本页展示，会话数据未删除；刷新页面即可恢复全部消息。' }),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-btn evo-btn-run',
                      onClick: () => setClearView(false),
                      children: t('restoreView'),
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
                  jsx(ResearchDashboard, { cwd }),
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
            cmdRunning && cmdResult === null && jsx('span', { className: 'evo-cmd-running', children: t('runningLower') }),
            cmdResult !== null && (cmdResult.kind === 'success' && cmdResult.text !== ''
              ? (() => {
                  // 结果文本含 GFM 表格 → Markdown 渲染成真表格（§23.3"文本或表格"）；否则等宽文本
                  const html = renderMarkdown(cmdResult.text)
                  return html.includes('<table')
                    ? jsx('div', { className: 'evo-cmd-output evo-cmd-output-md evo-md', dangerouslySetInnerHTML: { __html: html } })
                    : jsx('pre', { className: 'evo-cmd-output', children: cmdResult.text })
                })()
              : jsx('pre', { className: 'evo-cmd-output', children: cmdResult.text })),
            cmdResult !== null && jsx('button', {
              type: 'button',
              className: 'evo-cmd-dismiss',
              title: t('dismiss'),
              'aria-label': t('dismiss'),
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
              jsx('span', { className: 'evo-wf-name', children: latestWorkflow.data?.name ?? t('workflow') }),
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
                title: t('clearWorkflow'),
                'aria-label': t('clearWorkflow'),
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
                    jsx('span', { children: t('toolApprovalRequired') }),
                  ],
                }),
                jsxs('div', {
                  className: 'evo-approval-body',
                  children: [
                    jsx('code', { className: 'evo-approval-tool', children: payload.toolName ?? t('tool') }),
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
                      children: jsxs(Fragment, { children: [jsx(Check, {}), jsx('span', { children: t('approve') })] }),
                    }),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-btn evo-btn-danger',
                      onClick: () => respondApproval(wait, 'rejected'),
                      children: jsxs(Fragment, { children: [jsx(ShieldX, {}), jsx('span', { children: t('reject') })] }),
                    }),
                  ],
                }),
              ],
            }, wait.key)
          }),
        }),
      }),
      // ── Ask User 问题条（§21.3）：模型 ask_user_question 的问题卡片 ──
      pendingQuestions.length > 0 && jsx('div', {
        className: 'evo-approval-strip',
        children: jsx('div', {
          className: 'evo-approval-list',
          children: pendingQuestions.map((wait: any) => {
            const questions: Array<{ id: string; question: string; multiSelect?: boolean; options?: Array<{ label: string; description?: string }> }> = wait.payload?.questions ?? []
            return jsxs('div', {
              className: 'evo-question-card',
              children: [
                jsxs('div', {
                  className: 'evo-approval-head',
                  children: [
                    jsx(HelpCircle, {}),
                    jsx('span', { children: questions.length > 1 ? `${t('question')}（${questions.length}）` : t('question') }),
                  ],
                }),
                questions.map((q) => {
                  const key = `${wait.key}:${q.id}`
                  const sel = questionSelections[key] ?? []
                  const custom = questionCustom[key] ?? ''
                  const options = q.options ?? []
                  return jsxs('div', {
                    className: 'evo-question',
                    children: [
                      jsx('div', { className: 'evo-question-text', children: q.question }),
                      options.length > 0 && jsx('div', {
                        className: 'evo-question-opts',
                        children: options.map((opt) => {
                          const active = sel.includes(opt.label)
                          return jsx('button', {
                            type: 'button',
                            className: 'evo-question-opt',
                            'data-on': active || undefined,
                            title: opt.description,
                            onClick: () => toggleQuestionOption(wait, q, opt.label),
                            children: jsxs(Fragment, {
                              children: [
                                q.multiSelect === true && jsx('span', { className: 'evo-question-check', children: active ? '✓' : '' }),
                                jsx('span', { children: opt.label }),
                              ],
                            }),
                          }, opt.label)
                        }),
                      }),
                      jsx('input', {
                        type: 'text',
                        className: 'evo-question-custom',
                        placeholder: t('customAnswer'),
                        value: custom,
                        onInput: (e: { currentTarget: HTMLInputElement }) => setQuestionCustom((prev) => ({ ...prev, [key]: e.currentTarget.value })),
                        onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') submitQuestions(wait, questions) },
                      }),
                    ],
                  }, q.id)
                }),
                jsxs('div', {
                  className: 'evo-question-acts',
                  children: [
                    jsx('button', {
                      type: 'button',
                      className: 'evo-btn evo-btn-ok',
                      onClick: () => submitQuestions(wait, questions),
                      children: jsxs(Fragment, { children: [jsx(Check, {}), jsx('span', { children: t('submit') })] }),
                    }),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-btn evo-btn-danger',
                      onClick: () => cancelQuestion(wait),
                      children: jsxs(Fragment, { children: [jsx(XIcon, {}), jsx('span', { children: t('cancel') })] }),
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
          // 附件预览条（§23.7）：缩略图 + 名称 + 移除
          (pendingImages.length > 0 || attachError !== null) && jsx('div', {
            className: 'evo-attach-strip',
            children: [
              attachError !== null && jsx('span', { className: 'evo-attach-error', children: attachError }),
              pendingImages.length > 0 && jsxs('div', {
                className: 'evo-attach-list',
                children: pendingImages.map((img) => jsxs('div', {
                  className: 'evo-attach-item',
                  children: [
                    img.dataUrl !== ''
                      ? jsx('img', { className: 'evo-attach-thumb', src: img.dataUrl, alt: img.name })
                      : jsx('span', { className: 'evo-attach-thumb evo-attach-loading', children: '…' }),
                    jsx('span', { className: 'evo-attach-name', title: img.name, children: img.name }),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-attach-remove',
                      title: t('removeAttachment'),
                      'aria-label': t('removeAttachment'),
                      onClick: () => removeImage(img.id),
                      children: jsx(XIcon, {}),
                    }),
                  ],
                }, img.id)),
              }),
            ],
          }),
          jsxs('div', {
            className: 'evo-composer',
            children: [
              // 输入区顶部 8px 拖动热区（§23.1：hover 垂直 resize 光标，拖动改变 textarea 高度）
              jsx('div', {
                className: 'evo-composer-resize',
                title: t('dragToResize'),
                onPointerDown: onComposerResizeStart,
                onPointerMove: onComposerResizeMove,
                onPointerUp: onComposerResizeEnd,
                onPointerCancel: onComposerResizeEnd,
              }),
              jsxs('div', {
                className: 'evo-composer-status',
                children: [
                  jsx('span', { className: 'evo-composer-dot', 'data-busy': running || undefined }),
                  jsx('span', { children: currentTitle === null ? t('noActiveConversation') : running ? t('running') : currentTitle }),
                  jsx(SessionStatusLine, { session }),
                  // 当前工作路径（§25.4）：与模型行同行右对齐、单行省略、tooltip 完整路径
                  cwd !== null && jsx('span', { className: 'evo-cwd', title: cwd, children: cwd }),
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
                    'aria-label': t('markdownPreview'),
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
                role: 'combobox',
                'aria-expanded': candidates.length > 0 || undefined,
                'aria-autocomplete': 'list',
                'aria-activedescendant': candidates.length > 0 && activeIndex < candidates.length ? `evo-cand-${activeIndex}` : undefined,
                style: composerHeight !== null ? { height: `${composerHeight}px`, maxHeight: 'none' } : undefined,
                onInput: (e) => {
                  setInput(e.currentTarget.value)
                  // 手动拖动设定高度后不再自动伸缩（§23.1）
                  if (composerHeight === null) {
                    e.currentTarget.style.height = 'auto'
                    e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 220)}px`
                  }
                  refreshTrigger(e.currentTarget.value, e.currentTarget.selectionStart)
                },
                onKeyUp: (e) => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
                    refreshTrigger(e.currentTarget.value, e.currentTarget.selectionStart)
                  }
                },
                onClick: (e) => refreshTrigger(e.currentTarget.value, e.currentTarget.selectionStart),
                onPaste: onPasteImages,
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
                  // Ctrl/Cmd+Enter 也发送（§23.2）
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault()
                    void submit()
                    return
                  }
                  // Esc：运行中停止本轮（§23.2；候选框存在时上面已处理关闭）
                  if (e.key === 'Escape' && running) {
                    e.preventDefault()
                    stopTurn()
                    return
                  }
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
                label: trigger?.kind === 'command' ? t('commands') : trigger?.kind === 'mention' ? t('fileMentions') : t('history'),
              }),
              jsxs('div', {
                className: 'evo-composer-tools',
                children: [
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    'data-on': pendingImages.length > 0 || undefined,
                    title: t('attachFiles'),
                    onClick: () => fileInputRef.current?.click(),
                    children: jsx(Paperclip, {}),
                  }),
                  jsx('input', {
                    ref: fileInputRef,
                    type: 'file',
                    accept: 'image/*',
                    multiple: true,
                    hidden: true,
                    onChange: (e: { currentTarget: HTMLInputElement }) => {
                      const files = Array.from(e.currentTarget.files ?? [])
                      if (files.length > 0) void addImageFiles(files)
                      e.currentTarget.value = ''
                    },
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
                    title: queueItems.length > 0 ? `${t('queuedMessages')}（${queueItems.length}）` : t('queuedMessages'),
                    'aria-label': t('queuedMessages'),
                    onClick: () => setQueueOpen((v) => !v),
                    children: jsxs(Fragment, {
                      children: [jsx(ListTodo, {}), queueItems.length > 0 && jsx('span', { className: 'evo-queue-count', children: String(queueItems.length) })],
                    }),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    'data-on': liveJobCount > 0 || undefined,
                    title: jobs.length > 0 ? `${t('backgroundJobs')}（${jobs.length}${liveJobCount > 0 ? `，${liveJobCount} ${t('runningLower')}` : ''}）` : t('backgroundJobs'),
                    'aria-label': t('backgroundJobs'),
                    onClick: () => setJobsOpen((v) => !v),
                    children: jsxs(Fragment, {
                      children: [jsx(Terminal, {}), jobs.length > 0 && jsx('span', { className: 'evo-queue-count', children: String(jobs.length) })],
                    }),
                  }),
                  jsx('span', { className: 'evo-composer-divider' }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    title: t('compactTitle'),
                    'aria-label': t('compact'),
                    onClick: () => setActionDialog('compact'),
                    children: jsx(Shrink, {}),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    title: t('currentSession'),
                    'aria-label': t('currentSession'),
                    onClick: () => setActionDialog('current'),
                    children: jsx(Info, {}),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    title: t('search'),
                    'aria-label': t('search'),
                    onClick: () => setActionDialog('search'),
                    children: jsx(Search, {}),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    'data-on': notifyOn || undefined,
                    title: notifyOn ? t('notificationsOn') : t('notificationsOff'),
                    'aria-label': t('notifications'),
                    onClick: toggleNotify,
                    children: notifyOn ? jsx(Bell, {}) : jsx(BellOff, {}),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-tool',
                    title: t('shortcuts'),
                    'aria-label': t('shortcuts'),
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
        title: t('compact'),
        message: 'Compact 会对较早的活跃上下文生成摘要投影（§10.3），完整聊天仍保存在数据库中。确认继续？',
        confirmLabel: t('compact'),
        onConfirm: () => {
          // 直接执行 /compact 命令（官方 session.command，不产生模型回复回显）
          if (session?.command !== undefined) void session.command('/compact')
          else onSend('/compact')
        },
        onClose: () => setActionDialog(null),
      }),
      actionDialog === 'wf-clear' && latestWorkflow !== undefined && jsx(ConfirmDialog, {
        title: t('clearWorkflow'),
        message: '清除当前 Dynamic Workflow 的展示记录（§24：仅移除浏览器持久化记录，不影响会话与执行）。确认？',
        confirmLabel: t('clear'),
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
                title: t('clearQueue'),
                'aria-label': t('clearQueue'),
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
                      title: t('save'),
                      'aria-label': t('save'),
                      onClick: () => saveQueueEdit(id),
                      children: jsx(Check, {}),
                    }),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-queue-act',
                      title: t('cancel'),
                      'aria-label': t('cancel'),
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
                    title: t('edit'),
                    'aria-label': t('edit'),
                    onClick: () => { setQueueEditId(id); setQueueEditText(queueText(item)) },
                    children: jsx(PenLine, {}),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-queue-act',
                    title: t('remove'),
                    'aria-label': t('remove'),
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
              const statusText = job.status === 'running' ? t('runningDot') : job.status === 'stopping' ? t('jobStopping') : job.status === 'completed' ? t('jobCompleted') : job.status === 'killed' ? t('jobKilled') : t('jobFailed')
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
