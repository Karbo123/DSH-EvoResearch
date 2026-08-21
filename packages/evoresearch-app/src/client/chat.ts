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
import { Editor, rootCtx, defaultValueCtx, commandsCtx, editorViewCtx, parserCtx } from '@milkdown/core'
import { TextSelection } from '@milkdown/prose/state'
import {
  commonmark,
  wrapInHeadingCommand, toggleStrongCommand, toggleEmphasisCommand,
  insertHrCommand, wrapInBlockquoteCommand, wrapInBulletListCommand, wrapInOrderedListCommand,
  toggleLinkCommand, toggleInlineCodeCommand, createCodeBlockCommand,
} from '@milkdown/preset-commonmark'
import { gfm, insertTableCommand, toggleStrikethroughCommand } from '@milkdown/preset-gfm'
import { history as milkdownHistory } from '@milkdown/plugin-history'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import {
  Paperclip, Send, Wrench, User, Copy, Check, PenLine,
  ChevronDown, ChevronUp, ChevronRight, Shrink, Info, Search, Bell, BellOff, Keyboard,
  ListTodo, X as XIcon, Trash2, Terminal, XCircle, CheckCircle2, Command, Square, CornerUpRight, HelpCircle, History, GitBranch,
  Heading1, Bold, Italic, Strikethrough, Minus, Quote, List, ListOrdered, Table2, Link as LinkIcon, Code, Code2,
} from 'lucide-react'
import { t } from './i18n'
import { clientStateDelete, clientStateGet, clientStateSet } from './client-state'
import { toast } from './toast'
import { SessionStatusLine } from './session-dock'
import { ComposerModelInfo, StatusBar } from './statusbar'
import { renderMarkdown, renderMermaidBlocks } from './markdown'
import {
  CandidatePopup, buildCandidates, detectTrigger, pushHistory, readHistory,
  resolveMentions, trimPromptEdges, useCommandCatalog, useFileTree,
  type Trigger, type TriggerKind, type Candidate,
} from './composer-assist'
import { CurrentDialog, SearchDialog, ShortcutsDialog, ConfirmDialog } from './session-actions'
import { ShieldCheck as ShieldCheckIcon, ShieldX } from 'lucide-react'
import { Dropdown } from './dropdown'

const SUGGESTED_PROMPTS = [
  'Survey recent papers on a topic',
  'Design an experiment plan',
  'Analyze workspace files',
]

/** 自适应工作路径：可用宽度放得下就完整显示；放不下时保留头尾路径段、中间省略（省略号位于两段分隔符之间）。 */
function CwdPath({ path }: { path: string }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [text, setText] = useState(path)

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return

    const splitParts = (p: string): string[] => {
      const parts: string[] = []
      let cur = ''
      for (const ch of p) {
        if (ch === '/' || ch === '\\') { parts.push(cur, ch); cur = '' }
        else cur += ch
      }
      parts.push(cur)
      return parts
    }
    const parts = splitParts(path)
    const segCount = Math.ceil(parts.length / 2)

    const build = (keep: number): string => {
      const headKeep = Math.ceil(keep / 2)
      const tailKeep = Math.floor(keep / 2)
      const headEnd = 2 * headKeep - 1
      const tailStart = parts.length - (2 * tailKeep - 1)
      const headPart = parts.slice(0, headEnd).join('')
      const tailPart = parts.slice(Math.max(tailStart, 0)).join('')
      const sep = (headEnd < parts.length && parts[headEnd] !== '')
        ? parts[headEnd]
        : (tailStart > 0 && parts[tailStart - 1] !== '') ? parts[tailStart - 1] : '\\'
      return `${headPart}${sep}…${sep}${tailPart}`
    }

    const render = () => {
      const avail = el.clientWidth
      el.textContent = path
      if (avail <= 0 || segCount < 2 || el.scrollWidth <= avail + 1) {
        setText(path)
        return
      }
      let lo = 2
      let hi = segCount - 1
      let best = 2
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        el.textContent = build(mid)
        if (el.scrollWidth <= avail + 1) { best = mid; lo = mid + 1 }
        else hi = mid - 1
      }
      setText(build(best))
    }

    render()
    const ro = new ResizeObserver(render)
    ro.observe(el)
    return () => ro.disconnect()
  }, [path])

  return jsx('span', { ref, className: 'evo-cwd', title: path, children: text })
}

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

/** 工具结果中登记的图片资产（P0-2，host artifactImageDetect 返回形状）。 */
interface ToolImageAsset { path: string; mime: string; name: string }

/** 工具结果 → 图片资产缓存（按 callId；会话切换时整体失效）。 */
const toolImageCache = new Map<string, ToolImageAsset[]>()
/** 已取过的 base64 图（data URL 缓存，避免重复拉取）。 */
const toolImageDataUrl = new Map<string, string>()

/**
 * 探测一批工具结果的图片资产（P0-2）：把结果文本发给 host 做路径探测
 * （workspace 边界校验在 host 侧），命中则缓存并在工具卡片上渲染缩略图。
 */
function useToolImages(sessionId: string | null, toolResults: Record<string, { text: string; isError: boolean }>): void {
  useEffect(() => {
    if (sessionId === null) return
    const pending: Array<{ callId: string; text: string }> = []
    for (const [callId, r] of Object.entries(toolResults)) {
      if (toolImageCache.has(callId)) continue
      // 只对可能含路径的结果做一次探测（含图片扩展名才发请求）
      if (!/\.(png|jpe?g|gif|webp|svg)/i.test(r.text)) {
        toolImageCache.set(callId, [])
        continue
      }
      pending.push({ callId, text: r.text.slice(0, 8000) })
    }
    if (pending.length === 0) return
    let cancelled = false
    for (const item of pending) {
      void fetch('/evoresearch/fs/artifact-image-detect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, text: item.text }),
      }).then((res) => res.json()).then((json) => {
        if (cancelled) return
        const assets: ToolImageAsset[] = json.ok && Array.isArray(json.value?.assets) ? json.value.assets : []
        toolImageCache.set(item.callId, assets)
        setToolImagesTick((v) => v + 1)
      }).catch(() => {
        if (!cancelled) toolImageCache.set(item.callId, [])
      })
    }
    return () => { cancelled = true }
  }, [sessionId, toolResults])
}

// useToolImages 的重渲染信号（模块级 setter 由 hook 内赋值）
let setToolImagesTick: ((fn: (v: number) => number) => void) | null = null

/** 单张工具产物缩略图（懒加载 base64；失败显示占位 + 重试）。 */
function ToolImageThumb({ asset }: { asset: ToolImageAsset }) {
  const cacheKey = asset.path
  const [src, setSrc] = useState<string | null>(toolImageDataUrl.get(cacheKey) ?? null)
  const [failed, setFailed] = useState(false)
  const load = () => {
    setFailed(false)
    void fetch('/evoresearch/fs/artifact-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: asset.path }),
    }).then((res) => res.json()).then((json) => {
      if (json.ok === true && typeof json.value?.base64 === 'string') {
        const url = `data:${json.value.mime};base64,${json.value.base64}`
        toolImageDataUrl.set(cacheKey, url)
        setSrc(url)
      } else {
        setFailed(true)
      }
    }).catch(() => setFailed(true))
  }
  useEffect(() => { if (src === null) load() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [])
  return jsxs('button', {
    type: 'button',
    className: 'evo-tool-img',
    title: `${asset.name}（点击放大）`,
    onClick: () => {
      if (src === null) { load(); return }
      const win = typeof window !== 'undefined' ? window.open('') : null
      if (win !== null && win.document !== undefined) {
        win.document.write(`<img src="${src}" style="max-width:100%;background:#fff" alt="${asset.name}">`)
        win.document.title = asset.name
      }
    },
    children: src !== null
      ? jsx('img', { src, alt: asset.name })
      : jsx('span', { className: 'evo-tool-img-loading', children: failed ? t('imageLoadRetry') : '…' }),
  })
}

/** 工具卡片（§21.1）：名称/状态/参数折叠/结果（success·error·running）+ 图片资产缩略图（P0-2）。 */
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

/** 带图片资产的工具卡片包装（P0-2）：在原 ToolCard 下方渲染缩略图网格。 */
function ToolCardWithImages({ callId, tool, running, defaultExpanded }: { callId: string; tool: { name: string; args: string; result?: string; isError?: boolean }; running: boolean; defaultExpanded: boolean }) {
  const assets = toolImageCache.get(callId)
  return jsxs(Fragment, {
    children: [
      jsx(ToolCard, { tool, running, defaultExpanded }),
      assets !== undefined && assets.length > 0 && jsx('div', {
        className: 'evo-tool-imgs',
        children: assets.map((asset) => jsx(ToolImageThumb, { asset }, asset.path)),
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
  const displayText = trimPromptEdges(text)
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
          jsx('span', { className: 'evo-msg-author evo-msg-author-user', children: t('yourMessage') }),
          jsx('div', {
            className: 'evo-msg-bubble evo-msg-bubble-user',
            title: t('yourMessage'),
            'aria-label': `${t('yourMessage')}: ${text}`,
            children: jsx('div', { className: 'evo-msg-text evo-md', dangerouslySetInnerHTML: { __html: renderMarkdown(displayText) } }),
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
                    jsx('span', { children: t('toolsCount').replace('{n}', String(tools.length)) }),
                    jsx('span', { className: 'evo-tool-group-state', children: anyRunning ? t('runningDot') : t('done') }),
                  ],
                }),
              }),
              toolsOpen && jsx('div', {
                className: 'evo-tool-group-body',
                children: tools.map((tool, i) => {
                  // P0-2：按 callId 关联图片资产（assistantTools 保留 blocks 顺序，callId 从原块取）
                  const callId = (node.data.blocks ?? []).filter((b) => b.kind === 'tool-call')[i]?.callId ?? ''
                  return jsx(ToolCardWithImages, { callId, tool, running: running || tool.result === undefined, defaultExpanded: anyRunning }, `${node.key}-tool-${i}`)
                }),
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
  // ── 会话权限（§25.x）：跟随当前会话，不是全局设置；在输入框工具行切换 ──
  const [permPreset, setPermPreset] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetch('/evoresearch/fs/mode').then((r) => r.json()).then((json) => {
      if (!cancelled && json.ok) setPermPreset(String(json.value?.preset ?? ''))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  const applyPermPreset = (preset: string) => {
    if (sessionId === null) { toast(t('noActiveConversation'), 'error'); return }
    void fetch('/evoresearch/fs/mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, preset }),
    }).then((r) => r.json()).then((json) => {
      if (json.ok) setPermPreset(preset)
      else toast(json.error?.message ?? t('permSwitchFailed'), 'error')
    }).catch(() => toast(t('permSwitchFailed'), 'error'))
  }
  // 权限档位切换：「自动批准」为高风险档位，先弹确认框再生效
  const switchPerm = (preset: string) => {
    if (preset === 'danger-full-access') {
      setActionDialog('auto-approve')
      return
    }
    applyPermPreset(preset)
  }
  const listRef = useRef<HTMLDivElement | null>(null)
  const composerEditorHostRef = useRef<HTMLDivElement | null>(null)
  const composerEditorRef = useRef<Editor | null>(null)
  const composerMarkdownRef = useRef(input)
  const submitRef = useRef<() => void>(() => {})
  const candidatesRef = useRef<Candidate[]>([])
  const activeIndexRef = useRef(0)
  const triggerKindRef = useRef<TriggerKind>(null)
  const historyIndexRef = useRef(-1)
  const historyDraftRef = useRef<string | null>(null)
  const historyRef = useRef<string[]>([])
  const inputRef = useRef('')
  const historyNavigationRef = useRef(false)
  const suppressCandidateTriggerRef = useRef(false)
  const runningRef = useRef(running)
  runningRef.current = running
  // Milkdown 命令执行辅助：向编辑器动作上下文取 commandsCtx 并执行命令。
  const runCommand = (command: any, payload?: any) => {
    composerEditorRef.current?.action((ctx) => {
      // $command 导出的是插件函数，命令 key 在其 .key（CmdKey）上；
      // CommandManager 按该 key（或它的字符串名）查找已注册命令。
      const key = typeof command === 'string' ? command : (command?.key ?? command)
      ctx.get(commandsCtx).call(key, payload)
    })
  }
  // 聚焦输入框（编辑器实例就绪后）。
  const focusEditor = () => {
    composerEditorRef.current?.action((ctx) => ctx.get(editorViewCtx).focus())
  }
  // Typora 式代码块退出：光标位于代码块内的空行时按 Enter 跳出代码块。
  // 必须在捕获阶段拦截（ProseMirror 的 keydown 处理不检查 defaultPrevented）。
  const tryExitCodeBlock = (view: any): boolean => {
    const { state } = view
    if (!state.selection.empty) return false
    const { $from } = state.selection
    const parent = $from.parent
    if (parent.type.name !== 'code_block') return false
    const start = $from.start()
    const cursor = $from.pos
    const before = state.doc.textBetween(start, cursor)
    // 代码块首行（尚未换行）不退出，保证刚创建代码块时能直接输入代码；
    // 一旦光标落在空行（前一字符是换行符），按 Enter 即跳出代码块。
    if (!before.endsWith('\n')) return false
    let b = before
    while (b.endsWith('\n')) b = b.slice(0, -1)
    let a = state.doc.textBetween(cursor, $from.end())
    while (a.startsWith('\n')) a = a.slice(1)
    const schema = state.schema
    const pos = $from.before()
    const nodes: Array<any> = []
    if (b !== '') nodes.push(schema.nodes.code_block.create(parent.attrs, schema.text(b)))
    nodes.push(schema.nodes.paragraph.create(null))
    if (a !== '') nodes.push(schema.nodes.code_block.create(parent.attrs, schema.text(a)))
    const tr = state.tr.replaceWith(pos, pos + parent.nodeSize, nodes)
    let paraPos = pos
    if (b !== '') paraPos += 2 + b.length
    const resolved = tr.doc.resolve(Math.min(paraPos + 1, tr.doc.content.size))
    tr.setSelection(TextSelection.near(resolved))
    view.dispatch(tr)
    view.focus()
    return true
  }
  // 光标移到文档末尾（ProseMirror 文本选择）。
  const moveCursorToEnd = () => {
    composerEditorRef.current?.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const doc = view.state.doc
      view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, doc.content.size)))
      view.focus()
    })
  }
  // 用 Markdown 文本整体替换编辑器内容（不进入撤销历史，避免历史浏览污染 undo 栈）。
  const replaceEditorMarkdown = (value: string) => {
    composerEditorRef.current?.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const parser = ctx.get(parserCtx)
      const doc = parser(value)
      view.dispatch(
        view.state.tr
          .replaceWith(0, view.state.doc.content.size, doc.content)
          .setMeta('addToHistory', false),
      )
    })
  }
  const setComposerMarkdown = (value: string, cursorToEnd = false) => {
    setInput(value)
    composerMarkdownRef.current = value
    if (composerEditorRef.current !== null) replaceEditorMarkdown(value)
    if (cursorToEnd) requestAnimationFrame(() => moveCursorToEnd())
  }
  // 滚动容器 = 中间栏（消息区内容自适应、页面整体滚动；输入框 sticky 常驻底部）
  const scrollBox = () => document.querySelector<HTMLElement>('.evo-center')

  // ── 会话动作（§25.6）：Current / Search / Notify / Shortcuts / Compact / Clear view ──
  const [actionDialog, setActionDialog] = useState<null | 'current' | 'search' | 'shortcuts' | 'compact' | 'wf-clear' | 'auto-approve'>(null)
  const [clearView, setClearView] = useState(false)
  const [notifyOn, setNotifyOn] = useState(() => {
    try { return clientStateGet('evoresearch-notifications') === '1' } catch { return false }
  })
  // 仅显示我的消息（用户消息过滤；文件里持久化，全局共享）
  const [userOnly, setUserOnly] = useState(() => {
    try { return clientStateGet('evoresearch-useronly') === '1' } catch { return false }
  })
  const toggleUserOnly = () => {
    setUserOnly((v) => {
      const next = !v
      if (next) clientStateSet('evoresearch-useronly', '1')
      else clientStateDelete('evoresearch-useronly')
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
        const message = (r?.error as { message?: string } | undefined)?.message ?? t('steerFailed')
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
      clientStateDelete('evoresearch-notifications')
      return
    }
    if (typeof Notification !== 'undefined') {
      const permission = Notification.requestPermission()
      if (permission instanceof Promise) {
        void permission.then((result) => {
          if (result === 'granted') {
            setNotifyOn(true)
            clientStateSet('evoresearch-notifications', '1')
            try { new Notification(t('notificationsEnabled')) } catch { /* 忽略 */ }
          }
        })
      } else if (permission === 'granted') {
        setNotifyOn(true)
        clientStateSet('evoresearch-notifications', '1')
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
    historyNavigationRef.current = false
    suppressCandidateTriggerRef.current = false
    historyIndexRef.current = -1
    historyDraftRef.current = null
    setComposerMarkdown(text, true)
    setTrigger(null)
    requestAnimationFrame(() => moveCursorToEnd())
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
        toast(json.error?.message ?? t('opFailed'), 'error')
      }
    }).catch(() => { setOpBusy(false); toast(t('opFailed'), 'error') })
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
  useEffect(() => {
    const nextHistory = readHistory(cwd)
    setHistory(nextHistory)
    historyRef.current = nextHistory
    historyIndexRef.current = -1
    historyDraftRef.current = null
    historyNavigationRef.current = false
    suppressCandidateTriggerRef.current = false
    setHistoryIndex(-1)
  }, [cwd])

  const candidates = trigger === null ? [] : buildCandidates(trigger, commandCatalog, fileTree, history)
  candidatesRef.current = candidates
  activeIndexRef.current = activeIndex
  triggerKindRef.current = trigger?.kind ?? null
  historyRef.current = history
  inputRef.current = input

  const refreshTrigger = (value: string, pos: number) => {
    const next = detectTrigger(value, pos)
    setTrigger(next)
    setActiveIndex(0)
  }

  const applyCandidate = (c: Candidate) => {
    const current = composerMarkdownRef.current || input
    const pos = current.length
    const t = detectTrigger(current, pos)
    let next: string
    if (t !== null && (t.kind === 'mention' || t.kind === 'command')) {
      next = current.slice(0, t.start) + c.insert + current.slice(pos)
    } else {
      next = c.insert
    }
    historyNavigationRef.current = false
    suppressCandidateTriggerRef.current = true
    historyIndexRef.current = -1
    historyDraftRef.current = null
    setComposerMarkdown(next, true)
    setTrigger(null)
    setHistoryIndex(-1)
    requestAnimationFrame(() => moveCursorToEnd())
  }
  applyCandidateRef.current = applyCandidate

  const browseHistory = (delta: -1 | 1) => {
    const entries = historyRef.current
    if (entries.length === 0) return
    const current = historyIndexRef.current
    if (delta === 1 && current === -1) return
    if (delta === -1 && current === -1) historyDraftRef.current = composerMarkdownRef.current || inputRef.current
    let next: number
    if (delta === -1) {
      next = current === -1 ? 0 : Math.min(current + 1, entries.length - 1)
    } else if (current > 0) {
      next = current - 1
    } else {
      const draft = historyDraftRef.current ?? ''
      historyNavigationRef.current = true
      historyIndexRef.current = -1
      historyDraftRef.current = null
      setHistoryIndex(-1)
      setComposerMarkdown(draft, true)
      requestAnimationFrame(() => moveCursorToEnd())
      return
    }
    {
      const selected = entries[next] ?? ''
      historyNavigationRef.current = true
      historyIndexRef.current = next
      setHistoryIndex(next)
      setComposerMarkdown(selected, true)
    }
    requestAnimationFrame(() => moveCursorToEnd())
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
    const rawInput = composerMarkdownRef.current || input
    const text = trimPromptEdges(rawInput)
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
        historyNavigationRef.current = false
        historyIndexRef.current = -1
        historyDraftRef.current = null
        setComposerMarkdown('')
        setTrigger(null)
        setHistoryIndex(-1)
        return
      }
    }
    // @引用解析（§23.4）：小型文本文件注入内容，其余保留路径
    const resolved = trimPromptEdges(await resolveMentions(text, cwd))
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
    historyNavigationRef.current = false
    suppressCandidateTriggerRef.current = false
    historyIndexRef.current = -1
    historyDraftRef.current = null
    setComposerMarkdown('')
    setTrigger(null)
    setHistoryIndex(-1)
    setPendingImages([])
  }

  submitRef.current = () => { void submit() }

  // Milkdown 所见即所得编辑器：敲下 Markdown 语法即刻渲染（# 123 → H1、- item → 列表）。
  // React state 只保存其 Markdown 序列化结果；编辑器实例在异步 create 完成后挂载。
  useEffect(() => {
    const host = composerEditorHostRef.current
    if (host === null) return
    let disposed = false
    let keyCleanup: (() => void) | null = null
    // 捕获阶段监听：空行回车退出代码块（需在 ProseMirror 处理 Enter 之前拦截）。
    const onKeydownCapture = (event: KeyboardEvent) => {
      if (event.isComposing || event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      const instance = composerEditorRef.current
      if (instance === null) return
      const exited = instance.action((ctx) => tryExitCodeBlock(ctx.get(editorViewCtx)))
      if (exited) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    const onKeydown = (event: KeyboardEvent) => {
      const keepsCandidateHistory = event.key === 'ArrowUp'
        || event.key === 'ArrowDown'
        || event.key === 'Tab'
      if (suppressCandidateTriggerRef.current && !keepsCandidateHistory) suppressCandidateTriggerRef.current = false
      const currentCandidates = candidatesRef.current
      const keepsHistoryNavigation = event.key === 'ArrowUp'
        || event.key === 'ArrowDown'
        || event.key === 'Tab'
        || event.key === 'Escape'
        || (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key === 'Enter')
      if (historyIndexRef.current !== -1 && !keepsHistoryNavigation) {
        historyNavigationRef.current = false
        historyIndexRef.current = -1
        historyDraftRef.current = null
        setHistoryIndex(-1)
      }
      const historyNavigation = triggerKindRef.current === 'history'
        || currentCandidates.some((candidate) => candidate.kind === 'history')
        || suppressCandidateTriggerRef.current
        || inputRef.current === ''
      if (historyNavigation && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        browseHistory(event.key === 'ArrowUp' ? -1 : 1)
        return
      }
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
    }
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, host)
        ctx.set(defaultValueCtx, input)
        ctx.get(listenerCtx)
          .markdownUpdated((_ctx, md) => {
            composerMarkdownRef.current = md
            setInput(md)
            inputRef.current = md
            if (!historyNavigationRef.current) {
              historyIndexRef.current = -1
              historyDraftRef.current = null
              setHistoryIndex(-1)
            }
            if (!suppressCandidateTriggerRef.current) setTrigger(detectTrigger(md, md.length))
          })
      })
      .use(commonmark)
      .use(gfm)
      .use(milkdownHistory)
      .use(listener)
      .create()
    composerEditorRef.current = null
    void editor.then((instance) => {
      if (disposed) { void instance.destroy(); return }
      composerEditorRef.current = instance
      // 编辑器异步就绪前若已有外部写入（如建议 prompt 点击），补同步一次。
      const pending = inputRef.current
      if (pending !== '') {
        composerMarkdownRef.current = pending
        instance.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          const parser = ctx.get(parserCtx)
          const doc = parser(pending)
          view.dispatch(
            view.state.tr
              .replaceWith(0, view.state.doc.content.size, doc.content)
              .setMeta('addToHistory', false),
          )
        })
      }
      const dom = instance.action((ctx) => ctx.get(editorViewCtx).dom)
      if (dom !== undefined && dom !== null) {
        dom.addEventListener('keydown', onKeydownCapture, { capture: true })
        dom.addEventListener('keydown', onKeydown)
        keyCleanup = () => {
          dom.removeEventListener('keydown', onKeydownCapture, { capture: true })
          dom.removeEventListener('keydown', onKeydown)
        }
      }
    })
    return () => {
      disposed = true
      keyCleanup?.()
      const current = composerEditorRef.current
      if (current !== null) void current.destroy()
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
      setAttachError(t('attachImagesOnly'))
      setTimeout(() => setAttachError(null), 5000)
    }
    if (images.length === 0) return
    if (pendingImages.length + images.length > MAX_IMAGES_PER_MESSAGE) {
      setAttachError(t('attachMaxCount').replace('{n}', String(MAX_IMAGES_PER_MESSAGE)))
      setTimeout(() => setAttachError(null), 5000)
      return
    }
    const oversized = images.filter((f) => f.size > MAX_IMAGE_BYTES)
    if (oversized.length > 0) {
      setAttachError(t('attachOversized').replace('{name}', oversized[0]!.name))
      setTimeout(() => setAttachError(null), 5000)
    }
    const admitted = images.filter((f) => f.size <= MAX_IMAGE_BYTES)
    if (admitted.length === 0) return
    const added = admitted.map((f) => ({ id: `att-${++attachUidRef.current}-${Date.now()}`, name: f.name, mediaType: f.type || 'image/png', dataUrl: '', bytes: f.size }))
    toast(t('attachAdded').replace('{n}', String(added.length)), 'success')
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
  const [headingValue, setHeadingValue] = useState('0')
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  const HEADING_OPTIONS = [
    { value: '0', label: t('mdParagraph') },
    ...Array.from({ length: 6 }, (_unused, i) => ({ value: String(i + 1), label: `H${i + 1}` })),
  ]
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
  // P0-2：探测工具结果中的图片资产（命中后触发一次重渲染）
  const [, setToolImagesState] = useState(0)
  setToolImagesTick = setToolImagesState as unknown as (fn: (v: number) => number) => void
  useToolImages(sessionId, toolResults)
  const [wfCleared, setWfCleared] = useState<string[]>(() => {
    const raw = clientStateGet(`evoresearch-dynamic-workflows:${sessionId ?? ''}`)
    try { return JSON.parse(raw ?? '[]') } catch { return [] }
  })
  const [wfTick, setWfTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setWfTick((v) => v + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    clientStateSet(`evoresearch-dynamic-workflows:${sessionId ?? ''}`, JSON.stringify(wfCleared))
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
                error !== null && jsx('div', { className: 'evo-msg-error', children: t('sendFailed').replace('{error}', error) }),
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
                    jsx('div', { className: 'evo-clear-notice-sub', children: t('clearViewNotice') }),
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
                        requestAnimationFrame(() => moveCursorToEnd())
                      },
                      children: p,
                    }, p)),
                  }),
                  input.trim() === '' && jsx('button', {
                    type: 'button',
                    className: 'evo-welcome-prompt',
                    title: t('askAnything'),
                    'aria-label': t('askAnything'),
                    onClick: () => focusEditor(),
                    children: t('askAnything'),
                  }),
                  jsx(ResearchDashboard, { cwd }),
                ],
              }),
      }, 'chat-area'),
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
                    jsx('span', { children: questions.length > 1 ? t('questionCount').replace('{n}', String(questions.length)) : t('question') }),
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
                        onInput: (e: { currentTarget: HTMLInputElement }) => {
                          const next = e.currentTarget.value
                          setQuestionCustom((prev) => ({ ...prev, [key]: next }))
                        },
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
                  // 当前工作路径（§25.4）：自适应宽度、中间省略、tooltip 完整路径
                  cwd !== null && jsx(CwdPath, { path: cwd }),
                  jsx('span', { style: cwd !== null ? { flex: '0 0 12px' } : { flex: 1 } }),
                  // 停止本轮（官方 session.cancel；host 保留排队消息）
                  running && jsx('button', {
                    type: 'button',
                    className: 'evo-composer-stop',
                    title: t('stopTurn'),
                    'aria-label': t('stopTurn'),
                    onClick: stopTurn,
                    children: jsx(Square, {}),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-markdown-state',
                    'data-on': markdownToolbarOpen || undefined,
                    title: markdownToolbarOpen ? t('hideMarkdownToolbar') : t('showMarkdownToolbar'),
                    'aria-label': t('markdownWysiwyg'),
                    'aria-pressed': markdownToolbarOpen || undefined,
                    onClick: toggleMarkdownToolbar,
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
                className: 'evo-composer-editor',
                'data-markdown-toolbar-open': markdownToolbarOpen || undefined,
                role: 'textbox',
                'aria-label': t('askAnything'),
                'aria-expanded': candidates.length > 0 || undefined,
                'aria-autocomplete': 'list',
                style: { height: `${composerHeight ?? (COMPOSER_BASE_MIN_HEIGHT + (markdownToolbarOpen ? MARKDOWN_TOOLBAR_HEIGHT : 0))}px` },
                onPaste: onPasteImages,
                children: [
                  jsxs('div', {
                    className: 'evo-md-toolbar',
                    children: [
                      jsx(Dropdown, {
                        value: headingValue,
                        className: 'evo-md-heading',
                        icon: Heading1,
                        onChange: (v: string) => { setHeadingValue(v); runCommand(wrapInHeadingCommand, Number(v)) },
                        options: HEADING_OPTIONS,
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'evo-md-btn',
                        title: t('mdBold'),
                        'aria-label': t('mdBold'),
                        onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
                        onClick: () => runCommand(toggleStrongCommand),
                        children: jsx(Bold, {}),
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'evo-md-btn',
                        title: t('mdItalic'),
                        'aria-label': t('mdItalic'),
                        onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
                        onClick: () => runCommand(toggleEmphasisCommand),
                        children: jsx(Italic, {}),
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'evo-md-btn',
                        title: t('mdStrike'),
                        'aria-label': t('mdStrike'),
                        onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
                        onClick: () => runCommand(toggleStrikethroughCommand),
                        children: jsx(Strikethrough, {}),
                      }),
                      jsx('span', { className: 'evo-md-sep' }),
                      jsx('button', {
                        type: 'button',
                        className: 'evo-md-btn',
                        title: t('mdQuote'),
                        'aria-label': t('mdQuote'),
                        onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
                        onClick: () => runCommand(wrapInBlockquoteCommand),
                        children: jsx(Quote, {}),
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'evo-md-btn',
                        title: t('mdBulletList'),
                        'aria-label': t('mdBulletList'),
                        onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
                        onClick: () => runCommand(wrapInBulletListCommand),
                        children: jsx(List, {}),
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'evo-md-btn',
                        title: t('mdOrderedList'),
                        'aria-label': t('mdOrderedList'),
                        onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
                        onClick: () => runCommand(wrapInOrderedListCommand),
                        children: jsx(ListOrdered, {}),
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'evo-md-btn',
                        title: t('mdHr'),
                        'aria-label': t('mdHr'),
                        onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
                        onClick: () => runCommand(insertHrCommand),
                        children: jsx(Minus, {}),
                      }),
                      jsx('span', { className: 'evo-md-sep' }),
                      jsx('button', {
                        type: 'button',
                        className: 'evo-md-btn',
                        title: t('mdTable'),
                        'aria-label': t('mdTable'),
                        onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
                        onClick: () => runCommand(insertTableCommand, { row: 2, col: 2 }),
                        children: jsx(Table2, {}),
                      }),
                      linkOpen
                        ? jsx('input', {
                            className: 'evo-md-link-input',
                            autoFocus: true,
                            value: linkDraft,
                            placeholder: t('mdLinkPlaceholder'),
                            onChange: (e: { currentTarget: { value: string } }) => setLinkDraft(e.currentTarget.value),
                            onBlur: () => { setLinkOpen(false); setLinkDraft('') },
                            onKeyDown: (e: { key: string; currentTarget: { value: string }; preventDefault: () => void }) => {
                              if (e.key === 'Enter') {
                                const href = e.currentTarget.value.trim()
                                if (href !== '') runCommand(toggleLinkCommand, { href })
                                setLinkOpen(false)
                                setLinkDraft('')
                                e.preventDefault()
                              }
                              if (e.key === 'Escape') { setLinkOpen(false); setLinkDraft('') }
                            },
                          })
                        : jsx('button', {
                            type: 'button',
                            className: 'evo-md-btn',
                            title: t('mdLink'),
                            'aria-label': t('mdLink'),
                            onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
                            onClick: () => setLinkOpen(true),
                            children: jsx(LinkIcon, {}),
                          }),
                      jsx('button', {
                        type: 'button',
                        className: 'evo-md-btn',
                        title: t('mdCode'),
                        'aria-label': t('mdCode'),
                        onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
                        onClick: () => runCommand(toggleInlineCodeCommand),
                        children: jsx(Code, {}),
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'evo-md-btn',
                        title: t('mdCodeBlock'),
                        'aria-label': t('mdCodeBlock'),
                        onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
                        onClick: () => runCommand(createCodeBlockCommand, ''),
                        children: jsx(Code2, {}),
                      }),
                    ],
                  }),
                  jsx('div', { ref: composerEditorHostRef, className: 'evo-composer-editor-host evo-milkdown' }),
                  input === '' && jsx('div', {
                    className: 'evo-composer-placeholder',
                    'aria-hidden': true,
                    children: t('askAnything'),
                  }),
                ],
              }),
              candidates.length > 0 && jsx(CandidatePopup, {
                candidates,
                active: activeIndex,
                onActive: setActiveIndex,
                onApply: applyCandidate,
                onClose: () => setTrigger(null),
                label: trigger?.kind === 'command' ? t('commands') : trigger?.kind === 'mention' ? t('fileMentions') : t('historyInput'),
                hint: t('candidateKeyboardHint'),
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
                  // 会话权限（跟随当前会话，非全局）：输入框内切换权限档位
                  jsx(Dropdown, {
                    value: permPreset ?? '',
                    className: 'evo-composer-perm',
                    icon: ShieldCheckIcon,
                    placeholder: t('permission'),
                    onChange: switchPerm,
                    options: [
                      { value: 'read-only', label: t('readOnly') },
                      { value: 'workspace-write', label: t('permWrite') },
                      { value: 'danger-full-access', label: t('autoApprove') },
                    ],
                  }),
                  // 模型徽章（§25.2）：输入框内右下侧、紧邻发送按钮，点击打开模型选择器
                  jsx(ComposerModelInfo, {}),
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
          !userOnly && jsxs('div', {
            className: 'evo-composer-stats',
            children: [
              jsx(StatusBar, { session }),
            ],
          }),
        ],
      }, 'composer'),
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
        onConfirm: () => { setActionDialog(null); applyPermPreset('danger-full-access') },
        onClose: () => setActionDialog(null),
      }),
      actionDialog === 'compact' && jsx(ConfirmDialog, {
        title: t('compact'),
        message: t('compactConfirmMsg'),
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
        message: t('wfClearConfirmMsg'),
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
              jsx('span', { className: 'evo-insp-subtab-title', children: t('queuedMsgCount').replace('{n}', String(queueItems.length)) }),
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
            children: jsx('span', { className: 'evo-insp-subtab-title', children: t('bgJobsCount').replace('{n}', String(jobs.length)) }),
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
