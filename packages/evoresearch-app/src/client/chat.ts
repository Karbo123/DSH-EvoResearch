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
  ChevronDown, ChevronUp, Shrink, Info, Search, Bell, BellOff, Keyboard, ListTodo, X as XIcon, Trash2,
} from 'lucide-react'
import { t } from './i18n'
import { SessionStatusLine, SessionStatsLine } from './session-dock'
import { renderMarkdown } from './markdown'
import {
  CandidatePopup, buildCandidates, detectTrigger, pushHistory, readHistory,
  resolveMentions, useCommandCatalog, useFileTree,
  type Trigger, type Candidate,
} from './composer-assist'
import { CurrentDialog, SearchDialog, ShortcutsDialog, ConfirmDialog, ModelSelectorDialog } from './session-actions'

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

/** assistant 节点 → 可读文本（text + reasoning 块拼接）。 */
function assistantText(node: ChatNode): string {
  return (node.data.blocks ?? [])
    .filter((b) => (b.kind === 'text' || b.kind === 'reasoning') && b.text)
    .map((b) => b.text)
    .join('\n')
}

function assistantTools(node: ChatNode): Array<{ name: string; args: string }> {
  return (node.data.blocks ?? [])
    .filter((b) => b.kind === 'tool-call')
    .map((b) => ({ name: b.name ?? 'tool', args: b.argsRaw ?? '' }))
}

/** 用户消息气泡。 */
function UserBubble({ text, time, nodeKey, highlight }: { text: string; time?: number; nodeKey?: string; highlight?: boolean }) {
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
            children: [jsx('div', { className: 'evo-msg-time', children: fmtTime(time) }), jsx(CopyButton, { text })],
          }),
        ],
      }),
    ],
  })
}

/** 助手消息（头像 + 内容 + 工具卡片）。 */
function AssistantBubble({ node, nodeKey, highlight }: { node: ChatNode; nodeKey?: string; highlight?: boolean }) {
  const text = assistantText(node)
  const tools = assistantTools(node)
  const running = node.data.status === 'running'
  return jsxs('div', {
    className: `evo-msg-row${highlight ? ' evo-msg-jump' : ''}`,
    'data-node-key': nodeKey,
    children: [
      jsx('div', { className: 'evo-msg-avatar', children: jsx(User, {}) }),
      jsxs('div', {
        className: 'evo-msg-body',
        children: [
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
          tools.map((tool, i) => jsx('div', {
            className: 'evo-tool-card',
            children: jsxs(Fragment, {
              children: [
                jsx(Wrench, {}),
                jsx('span', { className: 'evo-tool-name', children: tool.name }),
                tool.args !== '' && jsx('span', { className: 'evo-tool-args', children: tool.args.length > 120 ? `${tool.args.slice(0, 120)}…` : tool.args }),
              ],
            }),
          }, `${node.key}-tool-${i}`)),
        ],
      }),
    ],
  })
}

export function ChatArea({ nodes, partial, running, error, currentTitle, sessionId, session, cwd, onOpenThread, onSend }: ChatAreaProps) {
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState(false)
  const [autoApprove, setAutoApprove] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  // ── 会话动作（§25.6）：Current / Search / Notify / Shortcuts / Compact / Clear view ──
  const [actionDialog, setActionDialog] = useState<null | 'current' | 'search' | 'shortcuts' | 'compact' | 'model'>(null)
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

  const submit = async () => {
    const text = input.trim()
    if (!text) return
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
  const shown = ordered.slice(-visibleCount)
  const hasMore = ordered.length > visibleCount
  const showMessages = hasMessages && !clearView

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
                  ? jsx(UserBubble, { text: node.data.text ?? '', time: node.data.time, nodeKey: node.key, highlight: node.key === jumpKey }, node.key)
                  : jsx(AssistantBubble, { node, nodeKey: node.key, highlight: node.key === jumpKey }, node.key)),
                partial !== null && !ordered.some((n) => n.key === partial.key) && jsx(AssistantBubble, { node: partial }, partial.key),
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
                    disabled: !input.trim(),
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
      // ── 忙时消息队列弹层（§23.6）──
      queueOpen && queueItems.length > 0 && jsxs('div', {
        className: 'evo-queue',
        children: [
          jsxs('div', {
            className: 'evo-queue-head',
            children: [
              jsx('span', { className: 'evo-insp-subtab-title', children: `Queued messages（${queueItems.length}）` }),
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
    ],
  })
}
