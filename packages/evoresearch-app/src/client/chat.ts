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
import ToastEditor, { type Editor as ToastEditorInstance } from '@toast-ui/editor'
import {
  Paperclip, ShieldCheck, Send, Wrench, User, Copy, Check, PenLine,
  ChevronDown, ChevronUp, ChevronRight, Shrink, Info, Search, Bell, BellOff, Keyboard,
  ListTodo, X as XIcon, Trash2, Terminal, XCircle, CheckCircle2, Command, Square, CornerUpRight, HelpCircle, History, GitBranch,
  ThumbsUp, ThumbsDown, MessageSquareText,
} from 'lucide-react'
import { t } from './i18n'
import { toast } from './toast'
import { SessionStatusLine } from './session-dock'
import { StatusBar } from './statusbar'
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
    seq?: number
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
  /** 从一条用户消息创建只继承到该消息的新方向。 */
  onBranchFromMessage?: (seq: number) => void
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

/** 用户消息气泡：气泡内仅文本；下方（气泡外）小字操作行：时间 / 编辑 / 复制 / 回溯。 */
function UserBubble({ text, time, nodeKey, highlight, seq, onEdit, onRewind, onBranch, rewindConfirming }: {
  text: string
  time?: number
  nodeKey?: string
  highlight?: boolean
  seq?: number
  onEdit?: (seq: number, text: string) => void
  onRewind?: (seq: number) => void
  onBranch?: (seq: number) => void
  rewindConfirming?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  if (editing) {
    return jsxs('div', {
      className: `evo-msg-row evo-msg-user${highlight ? ' evo-msg-jump' : ''}`,
      'data-node-key': nodeKey,
      children: [
        jsx('div', { className: 'evo-msg-user-body' }),
        jsxs('div', {
          className: 'evo-msg-edit',
          children: [
            jsx('textarea', {
              className: 'evo-msg-edit-textarea',
              value: draft,
              spellCheck: false,
              autoFocus: true,
              onInput: (e) => setDraft(e.currentTarget.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (seq !== undefined && draft.trim() !== '') onEdit?.(seq, draft) }
                if (e.key === 'Escape') setEditing(false)
              },
            }),
            jsxs('div', {
              className: 'evo-msg-edit-acts',
              children: [
                jsx('span', { className: 'evo-msg-edit-hint', children: t('editHint') }),
                jsx('span', { style: { flex: 1 } }),
                jsx('button', {
                  type: 'button',
                  className: 'evo-btn evo-btn-danger',
                  onClick: () => setEditing(false),
                  children: t('cancel'),
                }),
                jsx('button', {
                  type: 'button',
                  className: 'evo-btn evo-btn-run',
                  disabled: draft.trim() === '' || seq === undefined,
                  onClick: () => { if (seq !== undefined && draft.trim() !== '') { setEditing(false); onEdit?.(seq, draft) } },
                  children: t('editResend'),
                }),
              ],
            }),
          ],
        }),
      ],
    })
  }
  return jsxs('div', {
    className: `evo-msg-row evo-msg-user${highlight ? ' evo-msg-jump' : ''}`,
    'data-node-key': nodeKey,
    children: [
      jsx('div', { className: 'evo-msg-user-body' }),
      jsxs('div', {
        className: 'evo-msg-stack',
        children: [
          jsx('div', {
            className: 'evo-msg-bubble evo-msg-bubble-user',
            children: jsx('div', { className: 'evo-msg-text evo-md', dangerouslySetInnerHTML: { __html: renderMarkdown(text) } }),
          }),
          // 气泡外下方操作行（§用户反馈：复制/编辑/回溯 不进入气泡内部）
          jsxs('div', {
            className: 'evo-msg-meta',
            children: [
              jsx('div', { className: 'evo-msg-time', children: fmtTime(time) }),
              onEdit !== undefined && seq !== undefined && jsx('button', {
                type: 'button',
                className: 'evo-msg-copy',
                title: t('editMsg'),
                'aria-label': t('editMsg'),
                onClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); setEditing(true) },
                children: jsx(PenLine, {}),
              }),
              onRewind !== undefined && seq !== undefined && jsx('button', {
                type: 'button',
                className: `evo-msg-copy${rewindConfirming === true ? ' confirming' : ''}`,
                title: rewindConfirming === true ? t('rewindConfirm') : t('rewindToHere'),
                'aria-label': t('rewindToHere'),
                onClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); onRewind(seq) },
                children: jsx(History, {}),
              }),
              onBranch !== undefined && seq !== undefined && jsx('button', {
                type: 'button',
                className: 'evo-msg-copy',
                title: t('graphBranchFromHere'),
                'aria-label': t('graphBranchFromHere'),
                onClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); onBranch(seq) },
                children: jsx(GitBranch, {}),
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
function AssistantBubble({ node, nodeKey, highlight, toolResults, sessionId }: { node: ChatNode; nodeKey?: string; highlight?: boolean; toolResults: Record<string, { text: string; isError: boolean }>; sessionId: string | null }) {
  const text = assistantText(node)
  const reasoning = assistantReasoning(node)
  const tools = assistantTools(node, toolResults)
  const running = node.data.status === 'running'
  const settled = node.data.status === 'settled'
  const [feedback, setFeedback] = useState<'helpful' | 'unhelpful' | 'neutral' | null>(null)
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  // 推理默认折叠（§31.6：小号 Thinking 行，展开后左侧 2px 边线 + 次级文字）
  const [thinkingOpen, setThinkingOpen] = useState(false)
  // 工具组：默认折叠已完成的组（§21.1），运行中自动展开
  const [toolsOpen, setToolsOpen] = useState(!settled)
  const anyRunning = tools.some((t) => t.result === undefined)
  const sendFeedback = (rating: 'helpful' | 'unhelpful' | 'neutral', comment?: string) => {
    if (sessionId === null || feedbackBusy || node.data.seq === undefined) return
    setFeedbackBusy(true)
    void fetch('/evoresearch/fs/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, messageSeq: node.data.seq, rating, ...(comment === undefined ? {} : { comment }) }),
    }).then(async (response) => {
      const json = await response.json() as { ok?: boolean; error?: { message?: string } }
      if (json.ok !== true) throw new Error(json.error?.message ?? '反馈提交失败')
      setFeedback(rating)
      toast(rating === 'helpful' ? '已记录：有帮助' : rating === 'unhelpful' ? '已记录：需要改进' : '已记录反馈', 'info')
    }).catch((error: unknown) => toast(String((error as Error)?.message ?? error), 'error')).finally(() => setFeedbackBusy(false))
  }
  const writeFeedback = () => {
    const comment = window.prompt('补充这条回答的反馈（可留空）', '')
    if (comment === null) return
    sendFeedback('neutral', comment.trim() === '' ? undefined : comment.trim())
  }
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
          text !== '' && jsxs('div', {
            className: 'evo-msg-stack',
            children: [
              jsx('div', {
                className: 'evo-msg-bubble evo-msg-bubble-assistant',
                children: [
                  jsx('div', { className: 'evo-msg-text evo-md', dangerouslySetInnerHTML: { __html: renderMarkdown(text) } }),
                  running && jsx('span', { className: 'evo-msg-cursor' }),
                ],
              }),
              // 气泡外下方操作行：复制
              !running && jsxs('div', {
                className: 'evo-msg-meta',
                children: [
                  jsx('button', {
                    type: 'button', className: `evo-msg-feedback${feedback === 'helpful' ? ' selected' : ''}`,
                    title: '有帮助', 'aria-label': '有帮助', 'aria-pressed': feedback === 'helpful', disabled: feedbackBusy,
                    onClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); sendFeedback('helpful') },
                    children: jsx(ThumbsUp, {}),
                  }),
                  jsx('button', {
                    type: 'button', className: `evo-msg-feedback${feedback === 'unhelpful' ? ' selected negative' : ''}`,
                    title: '需要改进', 'aria-label': '需要改进', 'aria-pressed': feedback === 'unhelpful', disabled: feedbackBusy,
                    onClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); sendFeedback('unhelpful') },
                    children: jsx(ThumbsDown, {}),
                  }),
                  jsx('button', {
                    type: 'button', className: `evo-msg-feedback${feedback === 'neutral' ? ' selected' : ''}`,
                    title: '补充反馈', 'aria-label': '补充反馈', 'aria-pressed': feedback === 'neutral', disabled: feedbackBusy,
                    onClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); writeFeedback() },
                    children: jsx(MessageSquareText, {}),
                  }),
                  jsx(CopyButton, { text }),
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

export function ChatArea({ nodes, partial, running, error, currentTitle, sessionId, session, cwd, jobs, onOpenThread, onBranchFromMessage, onSend }: ChatAreaProps) {
  const [input, setInput] = useState('')
    // §21.4 Auto-approve：按 Thread 持久化（localStorage evoresearch-auto-approve:<sessionId>）；
  // 开启前先弹风险确认，关闭直接生效。
  const [autoApprove, setAutoApprove] = useState(false)
  useEffect(() => {
    if (sessionId === null) return
    try { setAutoApprove(localStorage.getItem(`evoresearch-auto-approve:${sessionId}`) === '1') } catch { /* 忽略 */ }
  }, [sessionId])
  const persistAutoApprove = (value: boolean) => {
    setAutoApprove(value)
    if (sessionId !== null) {
      try {
        if (value) localStorage.setItem(`evoresearch-auto-approve:${sessionId}`, '1')
        else localStorage.removeItem(`evoresearch-auto-approve:${sessionId}`)
      } catch { /* 忽略 */ }
    }
  }
  const listRef = useRef<HTMLDivElement | null>(null)
  const composerEditorHostRef = useRef<HTMLDivElement | null>(null)
  const composerEditorRef = useRef<ToastEditorInstance | null>(null)
  const submitRef = useRef<() => void>(() => {})
  const candidatesRef = useRef<Candidate[]>([])
  const activeIndexRef = useRef(0)
  const runningRef = useRef(running)
  runningRef.current = running
  const setComposerMarkdown = (value: string, cursorToEnd = false) => {
    setInput(value)
    const editor = composerEditorRef.current
    if (editor !== null && editor.getMarkdown() !== value) editor.setMarkdown(value, cursorToEnd)
  }
  // 滚动容器 = 中间栏（消息区内容自适应、页面整体滚动；输入框 sticky 常驻底部）
  const scrollBox = () => document.querySelector<HTMLElement>('.evo-center')

  // ── 会话动作（§25.6）：Current / Search / Notify / Shortcuts / Compact / Clear view ──
  const [actionDialog, setActionDialog] = useState<null | 'current' | 'search' | 'shortcuts' | 'compact' | 'model' | 'wf-clear' | 'auto-approve'>(null)
  const [clearView, setClearView] = useState(false)
  const [notifyOn, setNotifyOn] = useState(() => {
    try { return localStorage.getItem('evoresearch-notifications') === '1' } catch { return false }
  })
  // 仅显示我的消息（用户消息过滤；localStorage 持久化，全局共享）
  const [userOnly, setUserOnly] = useState(() => {
    try { return localStorage.getItem('evoresearch-useronly') === '1' } catch { return false }
  })
  const toggleUserOnly = () => {
    setUserOnly((v) => {
      const next = !v
      try {
        if (next) localStorage.setItem('evoresearch-useronly', '1')
        else localStorage.removeItem('evoresearch-useronly')
      } catch { /* 忽略 */ }
      return next
    })
  }
  // 切换过滤时滚动回顶（过滤后列表变短，避免停留位置越界）
  useEffect(() => {
    if (userOnly) {
      const box = scrollBox()
      if (box !== null) box.scrollTop = 0
    }
  }, [userOnly])

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
    setComposerMarkdown(text, true)
    setTrigger(null)
    const editor = composerEditorRef.current
    if (editor !== null) {
      requestAnimationFrame(() => { editor.focus(); editor.moveCursorToEnd(true) })
    }
  }

  // ── §回溯/编辑重发：fork 截断子会话 + git 工作区恢复（index.ts 处理 promote/open）──
  const [opBusy, setOpBusy] = useState(false)
  const [rewindConfirm, setRewindConfirm] = useState<number | null>(null)
  const runRewindOp = (url: string, body: Record<string, unknown>, resend?: string) => {
    if (sessionId === null || opBusy) return
    setOpBusy(true)
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((res) => res.json()).then((json) => {
      if (json.ok === true && typeof json.value?.childSessionId === 'string') {
        if (json.value?.note !== undefined && json.value.note !== '') toast(json.value.note, 'info')
        window.dispatchEvent(new CustomEvent('evo-rewind', { detail: { childId: json.value.childSessionId, ...(resend !== undefined ? { resend } : {}) } }))
      } else {
        setOpBusy(false)
        toast(json.error?.message ?? '操作失败', 'error')
      }
    }).catch(() => { setOpBusy(false); toast('操作失败', 'error') })
  }
  const editAndResend = (seq: number, text: string) => {
    runRewindOp('/evoresearch/fs/usermsg-edit', { sessionId, seq }, text)
  }
  const rewindAt = (seq: number) => {
    if (opBusy) return
    if (rewindConfirm !== seq) {
      setRewindConfirm(seq)
      setTimeout(() => setRewindConfirm((v) => (v === seq ? null : v)), 5000)
      return
    }
    setRewindConfirm(null)
    runRewindOp('/evoresearch/fs/rewind-execute', { sessionId, beforeSeq: seq })
  }

  // ── 输入辅助（§23.2–23.5）：斜杠命令 / @文件 / 输入历史 ──
  const commandCatalog = useCommandCatalog()
  const fileTree = useFileTree(cwd)
  const [history, setHistory] = useState<string[]>(() => readHistory(cwd))
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [trigger, setTrigger] = useState<Trigger | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const applyCandidateRef = useRef<(candidate: Candidate) => void>(() => {})

  // workspace 切换时重载历史（§23.5：不读取/覆盖其他 workspace 的键）
  useEffect(() => { setHistory(readHistory(cwd)); setHistoryIndex(-1) }, [cwd])

  const candidates = trigger === null ? [] : buildCandidates(trigger, commandCatalog, fileTree, history)
  candidatesRef.current = candidates
  activeIndexRef.current = activeIndex

  const refreshTrigger = (value: string, pos: number) => {
    const next = detectTrigger(value, pos)
    setTrigger(next)
    setActiveIndex(0)
  }

  const applyCandidate = (c: Candidate) => {
    const editor = composerEditorRef.current
    const current = editor?.getMarkdown() ?? input
    const pos = current.length
    const t = detectTrigger(current, pos)
    let next: string
    if (t !== null && (t.kind === 'mention' || t.kind === 'command')) {
      next = current.slice(0, t.start) + c.insert + current.slice(pos)
    } else {
      next = c.insert
    }
    setComposerMarkdown(next, true)
    setTrigger(null)
    setHistoryIndex(-1)
    requestAnimationFrame(() => { editor?.focus(); editor?.moveCursorToEnd(true) })
  }
  applyCandidateRef.current = applyCandidate

  const browseHistory = (delta: -1 | 1) => {
    if (history.length === 0) return
    const current = historyIndex
    let next: number
    if (current === -1) next = delta === -1 ? 0 : history.length - 1
    else next = Math.min(Math.max(current + delta, 0), history.length - 1)
    setHistoryIndex(next)
    setComposerMarkdown(history[next] ?? '', true)
    const editor = composerEditorRef.current
    requestAnimationFrame(() => { editor?.focus(); editor?.moveCursorToEnd(true) })
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
    const box = scrollBox()
    if (box === null || !nearBottomRef.current) return
    box.scrollTop = box.scrollHeight
  }, [nodes.length, partial?.data.blocks])

  // Mermaid 惰性渲染（§31.5）：流式期间不绘制，回答结束后按需加载 /assets/mermaid.js
  useEffect(() => {
    if (running) return
    const root = listRef.current
    if (root !== null) void renderMermaidBlocks(root)
  }, [nodes, running])

  // 展开更早历史后恢复原视觉位置（§9.2 滚动锚定）
  useLayoutEffect(() => {
    const box = scrollBox()
    if (box !== null && anchorRef.current !== null) {
      box.scrollTop = anchorRef.current.scrollTop + (box.scrollHeight - anchorRef.current.scrollHeight)
      anchorRef.current = null
    }
  }, [visibleCount])

  const onListScroll = () => {
    const box = scrollBox()
    if (box === null) return
    const near = box.scrollHeight - box.scrollTop - box.clientHeight <= 1
    nearBottomRef.current = near
    setShowJump(!near)
  }
  // 滚动容器监听（中间栏滚动时判断是否在底部）
  useEffect(() => {
    const box = scrollBox()
    if (box === null) return
    box.addEventListener('scroll', onListScroll, { passive: true })
    return () => box.removeEventListener('scroll', onListScroll)
  }, [])

  const loadEarlier = () => {
    const box = scrollBox()
    if (box !== null) anchorRef.current = { scrollTop: box.scrollTop, scrollHeight: box.scrollHeight }
    setVisibleCount((v) => v + PAGE_SIZE)
  }

  const jumpToLatest = () => {
    const box = scrollBox()
    if (box !== null) box.scrollTop = box.scrollHeight
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
    const rawInput = composerEditorRef.current?.getMarkdown() ?? input
    const text = rawInput.trim()
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
        setComposerMarkdown('')
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
    // Context Trace is a per-turn projection.  Publish the resolved question
    // before handing the message to the host so the Graph can clear the
    // previous turn's temporary highlight even when the model starts quickly.
    if (sessionId !== null) {
      window.dispatchEvent(new CustomEvent('evo-context-question', {
        detail: { sessionId, question: resolved },
      }))
    }
    onSend(resolved, images.length > 0 ? images : undefined)
    pushHistory(cwd, text)
    setHistory(readHistory(cwd))
    setComposerMarkdown('')
    setTrigger(null)
    setHistoryIndex(-1)
    setPendingImages([])
  }

  submitRef.current = () => { void submit() }

  // Toast UI 的编辑器是唯一的输入 DOM；React state 只保存其 Markdown 序列化结果。
  useEffect(() => {
    const host = composerEditorHostRef.current
    if (host === null) return
    const editor = new ToastEditor({
      el: host,
      height: '112px',
      minHeight: '72px',
      initialValue: input,
      initialEditType: 'wysiwyg',
      hideModeSwitch: true,
      usageStatistics: false,
      autofocus: false,
      placeholder: t('askAnything'),
      toolbarItems: [
        ['heading', 'bold', 'italic', 'strike'],
        ['hr', 'quote', 'ul', 'ol', 'task'],
        ['table', 'link', 'code', 'codeblock'],
      ],
      events: {
        change: () => {
          const next = editor.getMarkdown()
          setInput(next)
          setHistoryIndex(-1)
          setTrigger(detectTrigger(next, next.length))
        },
        keydown: (_editorType, event) => {
          const currentCandidates = candidatesRef.current
          if (currentCandidates.length > 0) {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => (index + 1) % currentCandidates.length); return }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => (index - 1 + currentCandidates.length) % currentCandidates.length); return }
            if (event.key === 'Tab') { event.preventDefault(); applyCandidateRef.current(currentCandidates[activeIndexRef.current] ?? currentCandidates[0]!); return }
            if (event.key === 'Escape') { event.preventDefault(); setTrigger(null); return }
          }
          if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            submitRef.current()
            return
          }
          if (event.key === 'Escape' && runningRef.current) {
            event.preventDefault()
            stopTurn()
          }
        },
      },
    })
    composerEditorRef.current = editor
    return () => {
      editor.destroy()
      composerEditorRef.current = null
    }
  // The editor must be mounted once; its content is synchronized below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // ── 输入框高度拖动（§23.1）：顶边缘热区，只有实际移动才改变高度 ──
  const MARKDOWN_TOOLBAR_HEIGHT = 36
  const COMPOSER_BASE_MIN_HEIGHT = 112
  const [markdownToolbarOpen, setMarkdownToolbarOpen] = useState(false)
  const [composerHeight, setComposerHeight] = useState<number | null>(null)
  const composerResizeRef = useRef<{ startY: number; startH: number; moved: boolean } | null>(null)
  const composerResizeCleanupRef = useRef<(() => void) | null>(null)
  const composerResizeHandleRef = useRef<HTMLElement | null>(null)
  const composerMinHeight = () => {
    return COMPOSER_BASE_MIN_HEIGHT + (markdownToolbarOpen ? MARKDOWN_TOOLBAR_HEIGHT : 0)
  }
  // 高度上限按视口计算，但不改变单击时的自然高度。
  const composerMaxHeight = () => {
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900
    return Math.max(composerMinHeight(), Math.min(Math.round(vh * 0.55) + (markdownToolbarOpen ? MARKDOWN_TOOLBAR_HEIGHT : 0), 520 + MARKDOWN_TOOLBAR_HEIGHT))
  }
  const toggleMarkdownToolbar = () => {
    const next = !markdownToolbarOpen
    setMarkdownToolbarOpen(next)
    setComposerHeight((height) => {
      if (height === null) return null
      const adjusted = height + (next ? MARKDOWN_TOOLBAR_HEIGHT : -MARKDOWN_TOOLBAR_HEIGHT)
      return Math.max(COMPOSER_BASE_MIN_HEIGHT + (next ? MARKDOWN_TOOLBAR_HEIGHT : 0), adjusted)
    })
  }
  const onComposerResizeStart = (e: { clientY: number; currentTarget: HTMLElement; pointerId: number; preventDefault(): void }) => {
    e.preventDefault()
    const el = composerEditorHostRef.current
    if (el === null) return
    composerResizeCleanupRef.current?.()
    composerResizeRef.current = { startY: e.clientY, startH: composerHeight ?? el.offsetHeight, moved: false }
    const handle = e.currentTarget
    composerResizeHandleRef.current = handle
    // Pointer capture is useful when the pointer leaves the 9px hot zone, but
    // it can reject an invalid/stale pointer id in embedded browsers. The
    // document listeners below are the fallback and must still be installed.
    try {
      if (e.pointerId > 0) handle.setPointerCapture(e.pointerId)
    } catch { /* document-level tracking keeps the drag usable */ }
    handle.dataset.dragging = '1'
    const onMove = (event: PointerEvent) => {
      const ref = composerResizeRef.current
      if (ref === null) return
      // 阈值 4px：点击、轻微手抖和 pointer capture 建立时的零位移不改变高度。
      const dy = event.clientY - ref.startY
      if (Math.abs(dy) < 4) return
      ref.moved = true
      // 上拖 = 增高；下拖 = 减小。直到真正移动后才进入受控高度模式。
      const next = ref.startH - dy
      setComposerHeight(Math.min(composerMaxHeight(), Math.max(composerMinHeight(), next)))
    }
    const onMouseMove = (event: MouseEvent) => onMove({ clientY: event.clientY } as PointerEvent)
    const onEnd = () => {
      composerResizeRef.current = null
      const handle = composerResizeHandleRef.current
      if (handle !== null) delete handle.dataset.dragging
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onEnd)
      document.removeEventListener('pointercancel', onEnd)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onEnd)
      composerResizeCleanupRef.current = null
    }
    composerResizeCleanupRef.current = onEnd
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onEnd)
    document.addEventListener('pointercancel', onEnd)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onEnd)
  }
  const onComposerResizeEnd = () => {
    composerResizeCleanupRef.current?.()
  }
  useEffect(() => () => { composerResizeCleanupRef.current?.() }, [])

  const hasMessages = nodes.length > 0 || partial !== null
  const ordered = [...nodes].sort((a, b) => a.anchorSeq - b.anchorSeq)

  // ── Dynamic Workflow（§24）：workflow-run 节点 → 输入区上方阶段条 ──
  const workflowNodes = (nodes as Array<ChatNode & { data?: any }>).filter((n) => n.kind === 'workflow-run')
  const messageNodes = ordered.filter((n) => n.kind !== 'workflow-run')
  // 仅显示我的消息：只保留 user 节点，隐藏 AI 回复（assistant-step / partial / 系统工具卡片）
  const viewNodes = userOnly ? messageNodes.filter((n) => n.kind === 'user') : messageNodes
  const shown = viewNodes.slice(-visibleCount)
  const hasMore = viewNodes.length > visibleCount
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
              children: [
                error !== null && jsx('div', { className: 'evo-msg-error', children: `发送失败：${error}` }),
                userOnly && jsx('button', {
                  type: 'button',
                  className: 'evo-useronly-hint',
                  title: t('userOnlyOff'),
                  onClick: toggleUserOnly,
                  children: jsxs(Fragment, {
                    children: [jsx(User, {}), jsx('span', { children: t('userOnlyHint') })],
                  }),
                }),
                hasMore && jsx('button', {
                  type: 'button',
                  className: 'evo-load-earlier',
                  onClick: loadEarlier,
                  children: jsxs(Fragment, {
                    children: [jsx(ChevronUp, {}), jsx('span', { children: t('loadEarlier') })],
                  }),
                }),
                ...shown.map((node) => node.kind === 'user'
                  ? jsx(UserBubble, {
                      text: node.data.text ?? '',
                      time: node.data.time,
                      nodeKey: node.key,
                      highlight: node.key === jumpKey,
                      seq: typeof node.data.seq === 'number' ? node.data.seq : node.anchorSeq,
                      onEdit: editAndResend,
                      onRewind: rewindAt,
                      onBranch: onBranchFromMessage,
                      rewindConfirming: rewindConfirm === node.data.seq,
                    }, node.key)
                  : jsx(AssistantBubble, { node, nodeKey: node.key, highlight: node.key === jumpKey, toolResults, sessionId }, node.key)),
                partial !== null && !userOnly && !ordered.some((n) => n.key === partial.key) && jsx(AssistantBubble, { node: partial, toolResults, sessionId }, partial.key),
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
                      title: t('suggestionHint'),
                      'aria-label': `${p}（${t('suggestionHint')}）`,
                      onClick: () => {
                        setComposerMarkdown(p, true)
                        const editor = composerEditorRef.current
                        requestAnimationFrame(() => { editor?.focus(); editor?.moveCursorToEnd(true) })
                      },
                      children: p,
                    }, p)),
                  }),
                  input.trim() === '' && jsx('button', {
                    type: 'button',
                    className: 'evo-welcome-prompt',
                    title: t('askAnything'),
                    'aria-label': t('askAnything'),
                    onClick: () => composerEditorRef.current?.focus(),
                    children: t('askAnything'),
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
              // 输入区顶部覆盖式拖动热区（§23.1：不增加布局高度）
              jsx('div', {
                className: 'evo-composer-resize',
                title: t('dragToResize'),
                onPointerDown: onComposerResizeStart,
                onPointerUp: onComposerResizeEnd,
                onPointerCancel: onComposerResizeEnd,
              }),
              jsxs('div', {
                className: 'evo-composer-status',
                'data-markdown-toolbar-open': markdownToolbarOpen || undefined,
                children: [
                  jsx('span', { className: 'evo-composer-dot', 'data-busy': running || undefined }),
                  jsx('span', { title: currentTitle === null ? t('noActiveConversationHint') : undefined, children: currentTitle === null ? t('noActiveConversation') : running ? t('running') : currentTitle }),
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
                  jsx('span', {
                    className: 'evo-composer-markdown-state',
                    children: t('markdownWysiwyg'),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-markdown-toggle',
                    'data-on': markdownToolbarOpen || undefined,
                    title: markdownToolbarOpen ? t('hideMarkdownToolbar') : t('showMarkdownToolbar'),
                    'aria-label': markdownToolbarOpen ? t('hideMarkdownToolbar') : t('showMarkdownToolbar'),
                    'aria-pressed': markdownToolbarOpen,
                    onClick: toggleMarkdownToolbar,
                    children: jsx(PenLine, {}),
                  }),
                ],
              }),
              jsx('div', {
                ref: composerEditorHostRef,
                className: 'evo-composer-editor',
                'data-markdown-toolbar-open': markdownToolbarOpen || undefined,
                role: 'textbox',
                'aria-label': t('askAnything'),
                'aria-expanded': candidates.length > 0 || undefined,
                'aria-autocomplete': 'list',
                style: { height: `${composerHeight ?? (COMPOSER_BASE_MIN_HEIGHT + (markdownToolbarOpen ? MARKDOWN_TOOLBAR_HEIGHT : 0))}px` },
                onPaste: onPasteImages,
                onKeyDown: (e: { key: string }) => {
                  // Toast UI 捕获主要键盘事件；这里保留空输入历史的 React 侧入口。
                  if (e.key === 'ArrowUp' && input === '') browseHistory(-1)
                  if (e.key === 'ArrowDown' && input === '' && historyIndex !== -1) browseHistory(1)
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
                    'aria-label': t('attachFiles'),
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
                    className: `evo-composer-tool${autoApprove ? ' evo-aa-on' : ''}`,
                    'data-on': autoApprove || undefined,
                    title: t('autoApprove'),
                    'aria-label': t('autoApprove'),
                    onClick: () => {
                      // §21.4：开启先弹风险确认；关闭直接生效
                      if (autoApprove) persistAutoApprove(false)
                      else setActionDialog('auto-approve')
                    },
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
                    'data-on': userOnly || undefined,
                    title: userOnly ? t('userOnlyOff') : t('userOnly'),
                    'aria-label': t('userOnly'),
                    onClick: toggleUserOnly,
                    children: jsx(User, {}),
                  }),
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
                    title: `${t('send')}（Ctrl+Enter）`,
                    'aria-label': `${t('send')}（Ctrl+Enter）`,
                    onClick: submit,
                    children: jsx(Send, {}),
                  }),
                ],
              }),
            ],
          }),
          // 会话统计行：位于输入框圆角框下方外部、水平居中、紧贴（不在输入框内部）
          !userOnly && jsx('div', {
            className: 'evo-composer-stats',
            children: jsx(StatusBar, { session }),
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
      actionDialog === 'auto-approve' && jsx(ConfirmDialog, {
        title: t('autoApproveConfirmTitle'),
        message: t('autoApproveConfirmMsg'),
        confirmLabel: t('confirmEnable'),
        danger: true,
        onConfirm: () => { persistAutoApprove(true); setActionDialog(null) },
        onClose: () => setActionDialog(null),
      }),
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
