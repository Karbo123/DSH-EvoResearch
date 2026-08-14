/**
 * 中间聊天区：欢迎页 + 会话消息列表（气泡样式：用户青色右对齐 / 助手卡片左对齐）+ 输入面板。
 *
 * 消息数据来自 DSH 会话快照（conversation 管线注册的 chat legacy 节点）：
 * - user 节点：右对齐青色气泡（user-message 色系）
 * - assistant-step 节点：左对齐、头像 + 文本/推理/工具卡片
 * - partial：流式中的 assistant 消息（光标动画）
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState, useEffect, useRef } from 'react'
import { Paperclip, ShieldCheck, ArrowUp, Wrench, User, Copy, Check } from 'lucide-react'
import { t } from './i18n'
import { SessionStatusLine, SessionStatsLine } from './session-dock'

const SUGGESTED_PROMPTS = [
  'Survey recent papers on a topic',
  'Design an experiment plan',
  'Analyze workspace files',
]

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
  /** 会话对象（投影/排队数据；无会话时为 null）。 */
  session: any | null
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
function UserBubble({ text, time }: { text: string; time?: number }) {
  return jsxs('div', {
    className: 'evo-msg-row evo-msg-user',
    children: [
      jsx('div', { className: 'evo-msg-user-body' }),
      jsxs('div', {
        className: 'evo-msg-bubble evo-msg-bubble-user',
        children: [
          jsx('div', { className: 'evo-msg-text', children: text }),
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
function AssistantBubble({ node }: { node: ChatNode }) {
  const text = assistantText(node)
  const tools = assistantTools(node)
  const running = node.data.status === 'running'
  return jsxs('div', {
    className: 'evo-msg-row',
    children: [
      jsx('div', { className: 'evo-msg-avatar', children: jsx(User, {}) }),
      jsxs('div', {
        className: 'evo-msg-body',
        children: [
          text !== '' && jsx('div', {
            className: 'evo-msg-bubble evo-msg-bubble-assistant',
            children: [
              jsx('div', { className: 'evo-msg-text', children: text }),
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

export function ChatArea({ nodes, partial, running, error, currentTitle, session, onSend }: ChatAreaProps) {
  const [input, setInput] = useState('')
  const [autoApprove, setAutoApprove] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  // 新消息/流式更新时滚动到底部（用户查看历史时不强拉）
  useEffect(() => {
    const el = listRef.current
    if (el === null) return
    el.scrollTop = el.scrollHeight
  }, [nodes.length, partial?.data.blocks])

  const submit = () => {
    const text = input.trim()
    if (!text || running) return
    onSend(text)
    setInput('')
  }

  const hasMessages = nodes.length > 0 || partial !== null
  const ordered = [...nodes].sort((a, b) => a.anchorSeq - b.anchorSeq)

  return jsxs(Fragment, {
    children: [
      jsx('div', {
        className: 'evo-chat',
        children: hasMessages
          ? jsxs('div', {
              ref: listRef,
              className: 'evo-msg-list',
              children: [
                error !== null && jsx('div', { className: 'evo-msg-error', children: `发送失败：${error}` }),
                ...ordered.map((node) => node.kind === 'user'
                  ? jsx(UserBubble, { text: node.data.text ?? '', time: node.data.time }, node.key)
                  : jsx(AssistantBubble, { node }, node.key)),
                partial !== null && !ordered.some((n) => n.key === partial.key) && jsx(AssistantBubble, { node: partial }, partial.key),
              ],
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
                ],
              }),
              jsx('textarea', {
                className: 'evo-composer-textarea',
                placeholder: t('askAnything'),
                rows: 1,
                value: input,
                onInput: (e) => {
                  setInput(e.currentTarget.value)
                  e.currentTarget.style.height = 'auto'
                  e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 220)}px`
                },
                onKeyDown: (e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    submit()
                  }
                },
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
                  jsx('span', { className: 'evo-composer-spacer' }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-send',
                    disabled: !input.trim() || running,
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
    ],
  })
}
