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
  Paperclip, Send, Wrench, User, Copy, Check, PenLine, Atom,
  ChevronDown, ChevronUp, ChevronRight, Shrink, Info, Search, Bell, BellOff, Keyboard,
  ListTodo, X as XIcon, Trash2, Terminal, XCircle, CheckCircle2, Command, Square, CornerUpRight, HelpCircle, History, GitBranch,
  Heading1, Bold, Italic, Strikethrough, Minus, Quote, List, ListOrdered, Table2, Link as LinkIcon, Code, Code2,
} from 'lucide-react'
import { t } from './i18n'
import { sessionEventsSync } from './session-events'
import { OpenInMenu } from './open-in'
import { useHitlWaits } from './hitl'
import { clientStateDelete, clientStateGet, clientStateSet } from './client-state'
import { toast } from './toast'
import { isCurrentReferenceRequest } from './reference-bridge'
import { SessionStatusLine } from './session-dock'
import { ComposerModelInfo, StatusBar } from './statusbar'
import { renderMarkdown, renderMermaidBlocks } from './markdown'
import {
  CandidatePopup, buildCandidates, buildReferenceCandidates, detectTrigger, pushHistory, readHistory,
  replaceTriggerText, trimPromptEdges, useCommandCatalog,
  type Trigger, type TriggerKind, type Candidate, type ReferenceCandidates,
} from './composer-assist'
import { CurrentDialog, SearchDialog, ShortcutsDialog, ConfirmDialog } from './session-actions'
import { ShieldCheck as ShieldCheckIcon, ShieldX } from 'lucide-react'
import { Dropdown } from './dropdown'

// i18n：欢迎页建议卡此前硬编码英文（中文界面仍显示英文文案）
const SUGGESTED_PROMPTS = ['sugPromptSurvey', 'sugPromptExperiment', 'sugPromptWorkspace']

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
        : (tailStart > 0 && parts[tailStart - 1] !== '') ? parts[tailStart - 1] : '/'
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
  /** 首条消息乐观占位：会话尚未建立时立即显示「我的消息 + AI 加载中」。 */
  pendingFirst: { text: string; ts: number } | null
  /** 已有会话的乐观回显：发送后立即显示用户气泡，快照回显同文本后由父级撤销。 */
  pendingEcho: { text: string; ts: number } | null
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
  /** 当前 workspace（官方 @引用与输入历史的根目录；无会话时为 null）。 */
  cwd: string | null
  /** DSH 官方 file/session reference discovery。 */
  referenceSearch: (query: string, signal?: AbortSignal, allowSessions?: boolean) => Promise<ReferenceCandidates>
  /** 当前会话的后台任务（§21.6，jobsBySession 快照）。 */
  jobs: Array<{ id: string; kind: string; label: string; status: string; detail?: string; startedAt?: number; finishedAt?: number }>

  /** 打开另一个会话（Search 全历史结果跳转）。 */
  onOpenThread: (id: string) => void
  /** 从一条用户消息创建只继承到该消息的新方向。 */
  onBranchFromMessage?: (seq: number) => void
  /** 点击 AI 回复里的项目文件引用（evo-file://）时打开预览。 */
  onOpenProjectFile?: (relPath: string) => void
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

/** 从会话原始事件提取工具结果（§21.1）：tool/result → callId → {text, isError}。
 * 0.1.3：事件列表经 eventSource 适配（session-events.ts），session face 不再直接带 events。 */
function toolResultsOf(session: any): Record<string, { text: string; isError: boolean }> {
  const map: Record<string, { text: string; isError: boolean }> = {}
  for (const ev of sessionEventsSync(session)) {
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
    title: `${asset.name}${t('clickToEnlarge')}`,
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
function ToolCard({ tool, running, defaultExpanded }: { tool: { name: string; args: string; result?: string; isError?: boolean; engines?: string[] }; running: boolean; defaultExpanded: boolean }) {
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
          // web_search 实际使用的引擎（host 登记，UI 徽标展示；不写入结果文本）
          tool.engines !== undefined && tool.engines.length > 0 && jsx('span', {
            className: 'evo-tool-engines',
            children: tool.engines.map((engine) => jsx('span', { className: 'evo-tool-engine-chip', title: t('webSearchEngineUsedTitle'), children: engine }, engine)),
          }),
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
function ToolCardWithImages({ callId, tool, running, defaultExpanded }: { callId: string; tool: { name: string; args: string; result?: string; isError?: boolean; engines?: string[] }; running: boolean; defaultExpanded: boolean }) {
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
  return jsxs('div', {
    className: `evo-msg-row evo-msg-user${highlight ? ' evo-msg-jump' : ''}`,
    'data-node-key': nodeKey,
    children: [
      jsx('div', { className: 'evo-msg-avatar evo-msg-avatar-user evo-msg-user-body', 'aria-hidden': true, children: jsxs(Fragment, { children: [jsx(User, {})] }) }),
      jsxs('div', {
        className: 'evo-msg-stack',
        children: [
          jsx('span', { className: 'evo-msg-author evo-msg-author-user', children: t('yourMessage') }),
          jsx('div', {
            className: 'evo-msg-bubble evo-msg-bubble-user',
            title: t('yourMessage'),
            'aria-label': `${t('yourMessage')}: ${text}`,
            children: jsxs(Fragment, { children: [
              jsx('div', { className: 'evo-msg-text evo-md', dangerouslySetInnerHTML: { __html: renderMarkdown(displayText) } }),
              // 操作行：DOM 置于气泡内以贴合气泡左下角，视觉上绝对定位在气泡轮廓外
              jsxs('div', {
                className: 'evo-msg-meta',
                children: [
                  jsx('div', { className: 'evo-msg-time', children: fmtTime(time) }),
                  onEdit !== undefined && seq !== undefined && jsx('button', {
                    type: 'button',
                    className: 'evo-msg-copy',
                    title: t('editMsg'),
                    'aria-label': t('editMsg'),
                    onClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); onEdit?.(seq, text) },
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
            ] }),
          }),
        ],
      }),
    ],
  })
}

/** 助手消息（头像 + 内容 + Thinking 折叠 + 工具卡片分组）；continued=连续回复续行（不重复头像）。 */
/** web_search 实际使用的引擎记录（host 端 recent 登记；模块级缓存 30s，避免每条消息重复拉取）。 */
interface WebSearchEngineUsage { query: string; engines: string[]; at: number }
let engineUsageCache: { at: number; list: WebSearchEngineUsage[] } | undefined
let engineUsagePromise: Promise<WebSearchEngineUsage[]> | undefined
function recentEngineUsage(force = false): Promise<WebSearchEngineUsage[]> {
  if (!force && engineUsageCache !== undefined && Date.now() - engineUsageCache.at < 30_000) return Promise.resolve(engineUsageCache.list)
  engineUsagePromise ??= fetch('/evoresearch/fs/web-search-recent-engines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    .then((r) => r.json())
    .then((json) => {
      // 信封 value 本身就是数组（writeOk 直接包 list），不是 { list }
      const list = (json?.ok === true && Array.isArray(json.value) ? json.value : []) as WebSearchEngineUsage[]
      engineUsageCache = { at: Date.now(), list }
      return list
    })
    .catch(() => [] as WebSearchEngineUsage[])
    .finally(() => { engineUsagePromise = undefined })
  return engineUsagePromise
}

function AssistantBubble({ node, nodeKey, highlight, toolResults, sessionId, onOpenProjectFile, continued }: { node: ChatNode; nodeKey?: string; highlight?: boolean; toolResults: Record<string, { text: string; isError: boolean }>; sessionId: string | null; onOpenProjectFile?: (relPath: string) => void; continued?: boolean }) {
  // trim：纯空白文本（部分模型在工具调用前会发空白段）不渲染空气泡，也就不会
  // 在头像旁挂出一个孤儿复制按钮
  const text = assistantText(node).trim()
  const reasoning = assistantReasoning(node)
  const tools = assistantTools(node, toolResults)
  // web_search 卡片标注实际使用的引擎（按查询串匹配最近一次登记；旧消息无登记则不显示）
  const hasWebSearch = tools.some((tl) => tl.name === 'web_search')
  // 已落地的 web_search 结果数：每落地一条强制刷新一次登记（登记在服务端执行搜索时写入）
  const webSearchSettledCount = tools.filter((tl) => tl.name === 'web_search' && tl.result !== undefined).length
  const [engineUsage, setEngineUsage] = useState<WebSearchEngineUsage[]>([])
  useEffect(() => {
    if (!hasWebSearch) return
    let alive = true
    void recentEngineUsage(webSearchSettledCount > 0).then((list) => {
      if (alive) setEngineUsage(list)
    })
    return () => { alive = false }
  }, [hasWebSearch, webSearchSettledCount])
  const enginesFor = (tool: { name: string; args: string }): string[] | undefined => {
    if (tool.name !== 'web_search' || engineUsage.length === 0) return undefined
    let queries: string[] = []
    try {
      const parsed = JSON.parse(tool.args) as { queries?: unknown }
      queries = Array.isArray(parsed?.queries) ? parsed.queries.filter((q): q is string => typeof q === 'string') : []
    } catch { return undefined }
    if (queries.length === 0) return undefined
    const hit = engineUsage.find((u) => queries.some((q) => q === u.query || q.includes(u.query) || u.query.includes(q)))
    return hit?.engines
  }
  const running = node.data.status === 'running'
  const settled = node.data.status === 'settled'
  // 推理默认折叠（§31.6：小号 Thinking 行，展开后左侧 2px 边线 + 次级文字）
  const [thinkingOpen, setThinkingOpen] = useState(false)
  // 工具组：默认折叠已完成的组（§21.1），运行中自动展开
  const [toolsOpen, setToolsOpen] = useState(!settled)
  const anyRunning = tools.some((t) => t.result === undefined)
  // AI 回复中的项目文件引用（renderMarkdown linkify 生成的 evo-file:// 链接）点击处理
  const onRowClick = (e: { target: EventTarget | null; currentTarget: HTMLElement }) => {
    if (onOpenProjectFile === undefined) return
    const a = (e.target as HTMLElement | null)?.closest?.('a[href^="evo-file://"]')
    if (a === null || a === undefined) return
    const href = a.getAttribute('href') ?? ''
    const rel = href.replace('evo-file://', '').trim()
    if (rel !== '') {
      e.preventDefault()
      onOpenProjectFile(rel)
    }
  }
  return jsxs('div', {
    className: `evo-msg-row${continued ? ' evo-msg-cont' : ''}${highlight ? ' evo-msg-jump' : ''}`,
    'data-node-key': nodeKey,
    onClick: onRowClick,
    children: [
      // 续行仍渲染头像占位（visibility 隐藏）保证文本与首条左对齐
      jsx('div', { className: 'evo-msg-avatar evo-msg-avatar-ai', 'aria-hidden': true, children: jsxs(Fragment, { children: [jsx(Atom, {})] }) }),
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
            className: 'evo-msg-stack',
            children: jsx('div', {
              className: 'evo-msg-bubble evo-msg-bubble-assistant',
              children: jsxs(Fragment, { children: [
                jsx('div', { className: 'evo-msg-text evo-md', dangerouslySetInnerHTML: { __html: renderMarkdown(text) } }),
                running && jsx('span', { className: 'evo-msg-cursor' }),
                // 操作行：DOM 置于气泡内以贴合气泡右下角，视觉上绝对定位在气泡轮廓外
                !running && jsxs('div', {
                  className: 'evo-msg-meta',
                  children: [
                    jsx(CopyButton, { text }),
                  ],
                }),
              ] }),
            }),
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
                  return jsx(ToolCardWithImages, { callId, tool: { ...tool, engines: enginesFor(tool) }, running: running || tool.result === undefined, defaultExpanded: anyRunning }, `${node.key}-tool-${i}`)
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

export function ChatArea({ nodes, partial, running, pendingFirst, pendingEcho, error, currentTitle, sessionId, session, cwd, referenceSearch, jobs, onOpenThread, onBranchFromMessage, onOpenProjectFile, onSend }: ChatAreaProps) {
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
  const composerPlainTextRef = useRef<HTMLTextAreaElement | null>(null)
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
    if (markdownPlainText) {
      const textarea = composerPlainTextRef.current
      if (textarea !== null) {
        textarea.focus()
        textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      }
      return
    }
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
  const setComposerMarkdown = (value: string, cursorToEnd = false, syncEditor = true) => {
    setInput(value)
    composerMarkdownRef.current = value
    if (syncEditor && composerEditorRef.current !== null) replaceEditorMarkdown(value)
    if (cursorToEnd) requestAnimationFrame(() => moveCursorToEnd())
  }
  // 滚动容器 = 聊天区自身：.evo-center 只是 overflow:hidden 的外壳，真正滚动发生在
  // .evo-chat（flex 子项、overflow-y:auto）。旧实现误指 .evo-center——scrollTop 写入
  // 与 scroll 监听全部落空，贴底跟随/回到最新等滚动功能整体失效。
  const chatRootRef = useRef<HTMLDivElement | null>(null)
  const scrollBox = (): HTMLElement | null =>
    chatRootRef.current ?? document.querySelector<HTMLElement>('.evo-chat')

  // ── 会话动作（§25.6）：Current / Search / Notify / Shortcuts / Compact / Clear view ──
  const [actionDialog, setActionDialog] = useState<null | 'current' | 'search' | 'shortcuts' | 'compact' | 'wf-clear' | 'auto-approve' | 'edit-resend'>(null)
  const [pendingEdit, setPendingEdit] = useState<{ seq: number; text: string } | null>(null)
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
  // 0.1.3：排队列表在 session face 快照（SessionSnapshot.queue）；rc.2 回退 snapshotCache。
  const queueItems: any[] = session?.getSnapshot?.()?.queue ?? session?.snapshotCache?.queue ?? []

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
  // 0.1.3：pending 来自 SessionPendingInteraction 经 workspace-api 的 HTTP 轮询
  // 通道（hitl.ts），PendingApproval/AskUser 卡片只消费 hitlWaits；wait.answer /
  // wait.cancel 是 hitl.ts 产物的唯一结算入口（respond/payload 回退分支已随
  // rc.2 通道移除，不可达）。
  const hitlWaits = useHitlWaits()
  const pendingApprovals: any[] = hitlWaits.filter((p) => p?.kind === 'approval')
  const respondApproval = (wait: any, outcome: 'allowed-once' | 'rejected') => {
    try {
      void wait.answer(outcome)
    } catch { /* 已结算 */ }
  }

  // ── Ask User 问题卡片（§21.3）：模型 ask_user_question 工具 → pending kind='question' ──
  const pendingQuestions: any[] = hitlWaits.filter((p) => p?.kind === 'question')
  const [questionSelections, setQuestionSelections] = useState<Record<string, string[]>>({})
  const [questionCustom, setQuestionCustom] = useState<Record<string, string>>({})
  const answerQuestion = (wait: any, answers: Array<{ id: string; selected: string[]; custom?: string }>) => {
    try {
      void wait.answer({ answers })
    } catch { /* 已结算 */ }
  }
  const cancelQuestion = (wait: any) => {
    try {
      void wait.cancel()
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
  useEffect(() => {
    setClearView(false)
    setJumpKey(null)
    // 待编辑状态只属于当前会话，切换会话后不得把旧消息序号带到新会话。
    setPendingEdit(null)
    // 回溯/编辑操作锁同样只属于当前会话的操作流，切换后必须解锁。
    setOpBusy(false)
    setRewindConfirm(null)
  }, [sessionId])

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

  // 用户消息编辑（§31.6 编辑图标）：只回填底部输入框，不在此处改动历史。
  const editUserMessage = (seq: number, text: string) => {
    if (opBusy) return
    setPendingEdit({ seq, text })
    historyNavigationRef.current = false
    suppressCandidateTriggerRef.current = false
    historyIndexRef.current = -1
    historyDraftRef.current = null
    setComposerMarkdown(text, true)
    setTrigger(null)
    setPendingImages([])
    requestAnimationFrame(() => moveCursorToEnd())
  }

  // ── §回溯/编辑重发：fork 截断子会话 + git 工作区恢复（index.ts 处理 promote/open）──
  const [opBusy, setOpBusy] = useState(false)
  const [rewindConfirm, setRewindConfirm] = useState<number | null>(null)
  const runRewindOp = (url: string, body: Record<string, unknown>, resend?: string, onSuccess?: () => void) => {
    if (sessionId === null || opBusy) return
    setOpBusy(true)
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((res) => res.json()).then((json) => {
      if (json.ok === true && typeof json.value?.childSessionId === 'string') {
        onSuccess?.()
        if (json.value?.note !== undefined && json.value.note !== '') toast(json.value.note, 'info')
        // 成功路径同样复位：ChatArea 实例在 fork 后继续服务子会话（无 key 重挂载），
        // 此前 opBusy 永久停留 true，一次成功回溯后编辑/回溯全部失效。
        setOpBusy(false)
        window.dispatchEvent(new CustomEvent('evo-rewind', { detail: { childId: json.value.childSessionId, ...(resend !== undefined ? { resend } : {}) } }))
      } else {
        setOpBusy(false)
        toast(json.error?.message ?? t('opFailed'), 'error')
      }
    }).catch(() => { setOpBusy(false); toast(t('opFailed'), 'error') })
  }
  const editAndResend = (seq: number, text: string) => {
    runRewindOp('/evoresearch/fs/usermsg-edit', { sessionId, seq }, text, () => {
      setPendingEdit(null)
      setPendingImages([])
      setComposerMarkdown('')
      setTrigger(null)
      setHistoryIndex(-1)
      historyNavigationRef.current = false
      historyIndexRef.current = -1
      historyDraftRef.current = null
    })
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

  // ── 输入辅助（§23.2–23.5）：斜杠命令 / 官方 @文件与@会话 / 输入历史 ──
  const commandCatalog = useCommandCatalog()
  const [referenceCandidates, setReferenceCandidates] = useState<ReferenceCandidates>({ files: [], sessions: [] })
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
    setReferenceCandidates({ files: [], sessions: [] })
  }, [cwd])

  const mentionQueryRef = useRef<AbortController | null>(null)
  const mentionGenerationRef = useRef(0)
  const referenceSearchRef = useRef(referenceSearch)
  referenceSearchRef.current = referenceSearch
  useEffect(() => {
    mentionQueryRef.current?.abort()
    mentionQueryRef.current = null
    const currentTrigger = trigger
    if (currentTrigger?.kind !== 'mention' || sessionId === null) {
      setReferenceCandidates({ files: [], sessions: [] })
      return
    }
    const controller = new AbortController()
    mentionQueryRef.current = controller
    const generation = ++mentionGenerationRef.current
    // 引号形式（@"…"）只查文件；会话引用与官方 input-trigger 语义一致地跳过。
    void referenceSearchRef.current(currentTrigger.query, controller.signal, currentTrigger.quoted !== true).then((result) => {
      if (!isCurrentReferenceRequest(generation, mentionGenerationRef.current, controller.signal)) return
      setReferenceCandidates(result)
    }).catch(() => {
      if (isCurrentReferenceRequest(generation, mentionGenerationRef.current, controller.signal)) setReferenceCandidates({ files: [], sessions: [] })
    })
    return () => controller.abort()
  }, [trigger?.kind, trigger?.query, trigger?.quoted, sessionId])

  // 触发点变化（换查询/换类型/挪动光标）时回到第一项；键盘导航只改 activeIndex，不会重跑本副作用。
  useEffect(() => { setActiveIndex(0) }, [trigger?.kind, trigger?.start, trigger?.query])

  const candidates = trigger === null
    ? []
    : trigger.kind === 'mention'
      ? buildReferenceCandidates(trigger, referenceCandidates)
      : buildCandidates(trigger, commandCatalog, history)
  candidatesRef.current = candidates
  activeIndexRef.current = activeIndex
  triggerKindRef.current = trigger?.kind ?? null
  historyRef.current = history
  inputRef.current = input

  const applyCandidate = (candidate: Candidate) => {
    historyNavigationRef.current = false
    historyIndexRef.current = -1
    historyDraftRef.current = null
    setHistoryIndex(-1)

    if (candidate.kind === 'history') {
      suppressCandidateTriggerRef.current = true
      setComposerMarkdown(candidate.insert, true)
      setTrigger(null)
      return
    }

    if (markdownPlainText) {
      const current = composerMarkdownRef.current
      const pos = composerPlainTextRef.current?.selectionStart ?? current.length
      const currentTrigger = detectTrigger(current, pos)
      const replacement = replaceTriggerText(current, pos, currentTrigger, candidate.insert)
      // 目录候选以「@dir/」结尾，保持补全打开并立即按新位置重算触发。
      setComposerMarkdown(replacement.value, false, false)
      setTrigger(candidate.kind === 'folder' ? detectTrigger(replacement.value, replacement.cursor) : null)
      requestAnimationFrame(() => {
        const textarea = composerPlainTextRef.current
        if (textarea !== null) {
          textarea.focus()
          textarea.setSelectionRange(replacement.cursor, replacement.cursor)
        }
      })
      return
    }

    composerEditorRef.current?.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      if (!view.state.selection.empty) return
      const { $from } = view.state.selection
      // 光标所在段落内、光标前的文本：官方 grammar 以它判定触发 token，
      // 替换也只发生在这个段落的真实光标位置，绝不改写文档其他部分。
      const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n')
      const currentTrigger = detectTrigger(before, before.length)
      if (currentTrigger === null || (currentTrigger.kind !== 'mention' && currentTrigger.kind !== 'command')) return
      // canonical 会话 mention 经 parser 变成真正的链接内联节点，序列化时
      // 原样还原为 @[label](dsh-session:…)；普通文件 mention 则是纯文本。
      const parsed = ctx.get(parserCtx)(candidate.insert)
      const inline = parsed.firstChild?.content
      if (inline === undefined) return
      const from = $from.pos - (currentTrigger.prefix?.length ?? 0)
      try {
        const tr = view.state.tr.replaceWith(from, $from.pos, inline)
        const cursor = Math.min(from + inline.size, tr.doc.content.size)
        tr.setSelection(TextSelection.near(tr.doc.resolve(cursor)))
        view.dispatch(tr)
      } catch {
        // 代码块等不接受链接 mark 的上下文无法承载 canonical mention：
        // 拒绝这次应用比改写错误位置安全，弹层随下一次输入重新评估。
        suppressCandidateTriggerRef.current = true
        setTrigger(null)
        return
      }
      view.focus()
      // 目录候选保持补全打开（markdownUpdated 会按新 token 重算触发）。
      suppressCandidateTriggerRef.current = candidate.kind === 'folder' ? false : true
      if (candidate.kind !== 'folder') setTrigger(null)
    })
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
  // "位于底部"判定阈值：分式像素缩放（Windows 125%/150%）下 0 与 1px 偏差常见，
  // 阈值过小会把"明明在最下面"误判为已脱离跟随，此后永不吸附——放宽到 48px。
  const NEAR_BOTTOM_PX = 48
  const nearBottomRef = useRef(true)
  const anchorRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null)
  // 加载更早历史后的锚定恢复窗口：期间内容骤增，禁止吸附（避免破坏视觉位置恢复）
  const followFreezeUntilRef = useRef(0)

  const stickToBottom = () => {
    const box = scrollBox()
    if (box !== null) box.scrollTop = box.scrollHeight
  }

  // 新消息/流式更新时：仅当位于底部才滚动到底部（§9.3）
  useEffect(() => {
    if (!nearBottomRef.current) return
    stickToBottom()
  }, [nodes.length, partial?.data.blocks])

  // 切换会话：重置为跟随态并直接落到底部（新会话首屏消息到达后由上面的 effect 接力）
  useEffect(() => {
    nearBottomRef.current = true
    setShowJump(false)
    stickToBottom()
  }, [sessionId])

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
    const near = box.scrollHeight - box.scrollTop - box.clientHeight <= NEAR_BOTTOM_PX
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
    // 短暂冻结吸附：历史展开会让内容骤增，避免 ResizeObserver 误吸到底部破坏锚定
    followFreezeUntilRef.current = performance.now() + 400
    setVisibleCount((v) => v + PAGE_SIZE)
  }

  const jumpToLatest = () => {
    const box = scrollBox()
    if (box !== null) box.scrollTop = box.scrollHeight
    nearBottomRef.current = true
    setShowJump(false)
    // 回到最新后释放旧页（§9.3：位于底部时 DOM 只保留最近一页）。释放会让内容
    // 高度骤缩、浏览器钳制 scrollTop，rAF 等布局完成后再补一次贴底确保到底。
    if (visibleCount > PAGE_SIZE) setVisibleCount(PAGE_SIZE)
    requestAnimationFrame(stickToBottom)
  }

  // ── 斜杠命令直接执行（§23.3）：Enter 执行，结果以文本显示在输入区上方 ──
  const [cmdResult, setCmdResult] = useState<{ line: string; text: string; kind: string } | null>(null)
  const [cmdRunning, setCmdRunning] = useState(false)
  // 斜杠命令执行（P2-4）：带附件时附件以 EncodedImageAttachment 形状透传给
  // commands.execute——声明 input.images 的命令才接收；拒绝则由调用方降级为普通消息。
  const executeCommand = async (line: string, withImages = false): Promise<boolean> => {
    if (sessionId === null) return false
    setCmdRunning(true)
    try {
      const images = withImages
        ? pendingImages
            .filter((img) => img.dataUrl !== '')
            .map((img) => ({ data: img.dataUrl.slice(img.dataUrl.indexOf(',') + 1), mediaType: img.mediaType, ...(img.name ? { name: img.name } : {}) }))
        : undefined
      const res = await fetch('/evoresearch/fs/commands-execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, line, ...(images !== undefined ? { images } : {}) }),
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
    if (opBusy) return
    // 编辑态先确认；确认前不 fork、不删除历史，也不发送新消息。
    if (pendingEdit !== null) {
      setActionDialog('edit-resend')
      return
    }
    // 斜杠命令：单行且以 / 开头 → 直接执行（未知命令降级为普通聊天，§23.3）。
    // P2-4：带附件时也尝试执行——executor 会拒绝未声明 input.images 的命令，
    // 此时把附件还原为普通消息发送（原图不丢）。
    if (text.startsWith('/') && !text.includes('\n')) {
      const matched = pendingImages.length === 0
        ? await executeCommand(text)
        : await executeCommand(text, true)
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
      // 命令带附件但 executor 拒绝 → 降级为普通消息（附件随消息走）
    }
    // @引用采用 DSH 官方 path-only 语义：Host 会话的 file-reference
    // prompt 指引模型按需调用 read；不在浏览器侧重复读取并内联文件正文。
    const resolved = trimPromptEdges(text)
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
    // 捕获阶段监听：① 候选弹层按键（必须在 ProseMirror 之前消费——它的默认
    // Enter 分段/方向键移动会先改文档或光标，让弹层与触发 token 脱节）；
    // ② 空行回车退出代码块。
    const onKeydownCapture = (event: KeyboardEvent) => {
      if (!event.isComposing) {
        const popupCandidates = candidatesRef.current
        if (popupCandidates.length > 0) {
          if (event.key === 'ArrowDown') { event.preventDefault(); event.stopImmediatePropagation(); setActiveIndex((index) => (index + 1) % popupCandidates.length); return }
          if (event.key === 'ArrowUp') { event.preventDefault(); event.stopImmediatePropagation(); setActiveIndex((index) => (index - 1 + popupCandidates.length) % popupCandidates.length); return }
          if (event.key === 'Tab' || event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); applyCandidateRef.current(popupCandidates[activeIndexRef.current] ?? popupCandidates[0]!); return }
          if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setTrigger(null); return }
        }
      }
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
      // 有候选弹层时方向键已在捕获阶段被消费；这里只剩空输入浏览历史等场景。
      const historyNavigation = triggerKindRef.current === 'history'
        || suppressCandidateTriggerRef.current
        || inputRef.current === ''
      if (historyNavigation && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        browseHistory(event.key === 'ArrowUp' ? -1 : 1)
        return
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
          .markdownUpdated((ctx, md) => {
            composerMarkdownRef.current = md
            setInput(md)
            inputRef.current = md
            if (!historyNavigationRef.current) {
              historyIndexRef.current = -1
              historyDraftRef.current = null
              setHistoryIndex(-1)
            }
            if (!suppressCandidateTriggerRef.current) {
              try {
                const selection = ctx.get(editorViewCtx).state.selection
                const parent = selection.$from.parent
                const line = parent.textBetween(0, selection.$from.parentOffset, '\n', '\n')
                setTrigger(detectTrigger(line, line.length))
              } catch {
                // 编辑器视图尚未就绪的首个解析周期：下一次输入会重算触发。
              }
            }
          })
          .selectionUpdated((_ctx, selection) => {
            const parent = selection.$from.parent
            const line = parent.textBetween(0, selection.$from.parentOffset, '\n', '\n')
            if (!suppressCandidateTriggerRef.current) setTrigger(detectTrigger(line, line.length))
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
  const [markdownPlainText, setMarkdownPlainText] = useState(false)
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
  // 「实时 Markdown」切换的是编辑模式；铅笔按钮只负责工具栏显隐。
  const toggleMarkdownEditorMode = () => {
    const nextPlainText = !markdownPlainText
    if (nextPlainText) {
      // 纯文本模式不显示依赖 Milkdown 选区的格式工具栏，并同步收回额外高度。
      if (markdownToolbarOpen) {
        setMarkdownToolbarOpen(false)
        setComposerHeight((height) => height === null ? null : Math.max(COMPOSER_BASE_MIN_HEIGHT, height - MARKDOWN_TOOLBAR_HEIGHT))
      }
      setMarkdownPlainText(true)
      requestAnimationFrame(() => composerPlainTextRef.current?.focus())
      return
    }
    // 切回所见即所得前，先把纯文本编辑器中的最新 Markdown 重新解析到 Milkdown。
    replaceEditorMarkdown(composerMarkdownRef.current)
    setMarkdownPlainText(false)
    requestAnimationFrame(() => {
      focusEditor()
      moveCursorToEnd()
    })
  }
  const onPlainTextInput = (e: { currentTarget: HTMLTextAreaElement }) => {
    const value = e.currentTarget.value
    setComposerMarkdown(value, false, false)
    inputRef.current = value
    if (!historyNavigationRef.current) {
      historyIndexRef.current = -1
      historyDraftRef.current = null
      setHistoryIndex(-1)
    }
    // 纯文本模式没有 Milkdown 的 keydown 复位链：用户每次输入都无条件重算触发，
    // 防止 WYSIWYG 里选完候选留下的 suppress 标记经模式切换泄漏后永久压住弹层。
    suppressCandidateTriggerRef.current = false
    setTrigger(detectTrigger(value, e.currentTarget.selectionStart))
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

  const hasMessages = nodes.length > 0 || partial !== null || pendingFirst !== null
  const ordered = [...nodes].sort((a, b) => a.anchorSeq - b.anchorSeq)

  // 内容实际增高（流式文本/图片/KaTeX/Mermaid/工具卡片）→ 仍在底部则持续吸附。
  // 与 React deps 无关：任何 DOM 增高都跟随；不在底部（用户上滚过）绝不打扰。
  // 依赖 hasMessages：空会话时尚无消息列表 DOM，首条消息渲染后再挂观察器。
  useEffect(() => {
    const root = listRef.current
    if (root === null || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!nearBottomRef.current) return
      if (performance.now() < followFreezeUntilRef.current) return
      stickToBottom()
    })
    ro.observe(root)
    return () => ro.disconnect()
  }, [hasMessages])

  // ── Dynamic Workflow（§24）：workflow-run 节点 → 输入区上方阶段条 ──
  const workflowNodes = (nodes as Array<ChatNode & { data?: any }>).filter((n) => n.kind === 'workflow-run')
  const messageNodes = ordered.filter((n) => n.kind !== 'workflow-run')
  // 仅显示我的消息：只保留 user 节点，隐藏 AI 回复（assistant-step / partial / 系统工具卡片）
  const viewNodes = userOnly ? messageNodes.filter((n) => n.kind === 'user') : messageNodes
  const shown = viewNodes.slice(-visibleCount)
  const hasMore = viewNodes.length > visibleCount
  const showMessages = hasMessages && !clearView
  // 连续 AI 回复分组：上一条可见节点也是 AI 侧（非 user）时，本条不重复渲染头像，
  // 避免同一次回答的多段消息被误解为多次独立回复（头像仅在分组首条出现）。
  const aiContinuedKeys = new Set<string>()
  for (let i = 1; i < shown.length; i++) {
    if (shown[i].kind !== 'user' && shown[i - 1].kind !== 'user') aiContinuedKeys.add(shown[i].key)
  }
  // 流式 partial（不在 shown 里）紧接 AI 侧末条时同样视为续行
  const partialContinued = partial !== null && !shown.some((n) => n.key === partial.key) && shown.length > 0 && shown[shown.length - 1].kind !== 'user'
  // ── 发送即时反馈（§23.8）──
  // 乐观回显：快照尚未回显同文本用户消息时，先在列表末尾本地渲染发送内容。
  const echoVisible = pendingEcho !== null && !shown.some((n) => n.kind === 'user' && (n.data?.text ?? '') === pendingEcho.text)
  // AI 思考指示：prompt 在途（running 或有乐观回显）但 AI 侧还没有任何可见内容
  // （无 partial、最后一条用户消息之后也没有 assistant/工具节点）时，显示加载点。
  const lastUserIdx = (() => { for (let i = shown.length - 1; i >= 0; i--) if (shown[i].kind === 'user') return i; return -1 })()
  const aiReacting = lastUserIdx >= 0 && shown.slice(lastUserIdx + 1).some((n) => n.kind !== 'user')
  const promptInFlight = running || echoVisible || pendingFirst !== null
  // 空会话的加载点由下方 pendingFirst 占位分支自带（含用户气泡），此处不重复
  const showThinking = !userOnly && showMessages && promptInFlight && partial === null && !aiReacting && (echoVisible || lastUserIdx >= 0)
  const toolResults = toolResultsOf(session)
  // 乐观回显/思考点出现时同样贴底跟随（仅当用户本就位于底部）
  useEffect(() => {
    if (nearBottomRef.current) stickToBottom()
  }, [echoVisible, showThinking])
  // P0-2：探测工具结果中的图片资产（命中后触发一次重渲染）
  const [, setToolImagesState] = useState(0)
  setToolImagesTick = setToolImagesState as unknown as (fn: (v: number) => number) => void
  useToolImages(sessionId, toolResults)
  const [wfCleared, setWfCleared] = useState<string[]>(() => {
    const raw = clientStateGet(`evoresearch-dynamic-workflows:${sessionId ?? ''}`)
    try { return JSON.parse(raw ?? '[]') } catch { return [] }
  })
  // ChatArea 不按 sessionId 重挂载：切换会话时在渲染期重读新会话的清除列表
  // （React 官方「props 变化时调整 state」模式）。持久化写入只跟随 wfCleared，
  // 绝不能把依赖挂在 sessionId 上——那会把上一个会话的列表写进新会话的键。
  const wfSessionRef = useRef(sessionId)
  if (wfSessionRef.current !== sessionId) {
    wfSessionRef.current = sessionId
    const raw = clientStateGet(`evoresearch-dynamic-workflows:${sessionId ?? ''}`)
    let next: string[] = []
    try { next = JSON.parse(raw ?? '[]') } catch { next = [] }
    setWfCleared(Array.isArray(next) ? next.filter((x) => typeof x === 'string') : [])
  }
  const [wfTick, setWfTick] = useState(0)
  // 每秒计时仅在有 workflow 节点（阶段条运行时长显示）时才需要驱动重渲染。
  useEffect(() => {
    if (workflowNodes.length === 0) return
    const timer = setInterval(() => setWfTick((v) => v + 1), 1000)
    return () => clearInterval(timer)
  }, [workflowNodes.length])
  useEffect(() => {
    clientStateSet(`evoresearch-dynamic-workflows:${wfSessionRef.current ?? ''}`, JSON.stringify(wfCleared))
  }, [wfCleared])
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
        ref: chatRootRef,
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
                      onEdit: editUserMessage,
                      onRewind: rewindAt,
                      onBranch: onBranchFromMessage,
                      rewindConfirming: rewindConfirm === node.data.seq,
                    }, node.key)
                  : jsx(AssistantBubble, { node, nodeKey: node.key, highlight: node.key === jumpKey, toolResults, sessionId, onOpenProjectFile, continued: aiContinuedKeys.has(node.key) }, node.key)),
                // 首条消息乐观占位：会话尚未建立、真实节点还没出现时，立即显示
                // 「我的消息 + AI 加载中」（真实快照出现后此条件失效，占位自动消失）。
                nodes.length === 0 && partial === null && pendingFirst !== null
                  ? jsxs(Fragment, {
                      children: [
                        jsx(UserBubble, {
                          text: pendingFirst.text,
                          time: pendingFirst.ts,
                          nodeKey: `pending-first-user-${pendingFirst.ts}`,
                          seq: -1,
                        }, `pending-first-user-${pendingFirst.ts}`),
                        jsx('div', {
                          className: 'evo-msg evo-msg-assistant evo-pending-loading',
                          'aria-label': t('thinking'),
                          children: jsxs('div', {
                            className: 'evo-msg-stack',
                            children: [
                              jsx('div', { className: 'evo-msg-avatar evo-msg-avatar-ai', 'aria-hidden': true, children: jsx(Atom, {}) }),
                              jsx('div', {
                                className: 'evo-msg-body',
                                children: jsxs('span', {
                                  className: 'evo-pending-bubbles',
                                  'aria-hidden': true,
                                  children: [
                                    jsx('span', { className: 'evo-pending-dot', children: '' }),
                                    jsx('span', { className: 'evo-pending-dot', children: '' }),
                                    jsx('span', { className: 'evo-pending-dot', children: '' }),
                                  ],
                                })
                              }),
                            ],
                          }),
                        }, `pending-first-ai-${pendingFirst.ts}`),
                      ],
                    })
                  : null,
                partial !== null && !userOnly && !ordered.some((n) => n.key === partial.key) && jsx(AssistantBubble, { node: partial, toolResults, sessionId, onOpenProjectFile, continued: partialContinued }, partial.key),
                // 已有会话的乐观回显：发送后立即显示，快照回显同文本后由 echoVisible 撤销
                echoVisible && jsx(UserBubble, {
                  text: pendingEcho.text,
                  time: pendingEcho.ts,
                  nodeKey: `pending-echo-${pendingEcho.ts}`,
                }, `pending-echo-${pendingEcho.ts}`),
                // AI 思考指示：prompt 在途且 AI 侧尚无任何可见内容时显示加载点，
                // 消除「发出后界面无反应」的空窗（首条消息的加载点由 pendingFirst 分支自带）
                showThinking && jsx('div', {
                  className: 'evo-msg evo-msg-assistant evo-pending-loading',
                  'aria-label': t('thinking'),
                  children: jsxs('div', {
                    className: 'evo-msg-stack',
                    children: [
                      jsx('div', { className: 'evo-msg-avatar evo-msg-avatar-ai', 'aria-hidden': true, children: jsx(Atom, {}) }),
                      jsx('div', {
                        className: 'evo-msg-body',
                        children: jsxs('span', {
                          className: 'evo-pending-bubbles',
                          'aria-hidden': true,
                          children: [
                            jsx('span', { className: 'evo-pending-dot', children: '' }),
                            jsx('span', { className: 'evo-pending-dot', children: '' }),
                            jsx('span', { className: 'evo-pending-dot', children: '' }),
                          ],
                        }),
                      }),
                    ],
                  }),
                }, 'pending-thinking'),
                showJump && jsx('button', {
                  type: 'button',
                  className: 'evo-jump-latest',
                  title: t('jumpToLatest'),
                  'aria-label': t('jumpToLatest'),
                  onClick: jumpToLatest,
                  children: jsx(ChevronDown, {}),
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
                    children: SUGGESTED_PROMPTS.map((key) => jsx('button', {
                      type: 'button',
                      className: 'evo-suggest-card',
                      title: t('suggestionHint'),
                      'aria-label': `${t(key)}（${t('suggestionHint')}）`,
                      onClick: () => {
                        setComposerMarkdown(t(key), true)
                        requestAnimationFrame(() => moveCursorToEnd())
                      },
                      children: t(key),
                    }, key)),
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
            const toolName: string = wait.toolName ?? t('tool')
            const callId = wait.callId
            const reason: string | undefined = wait.reason
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
                    jsx('code', { className: 'evo-approval-tool', children: toolName }),
                    callId !== undefined && jsx('span', { className: 'evo-approval-callid', children: String(callId) }),
                  ],
                }),
                reason !== undefined && reason !== '' && jsx('div', { className: 'evo-approval-reason', children: reason }),
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
            // 0.1.3 PendingQuestion.questions 直读；rc.2 回退 payload.questions
            const questions: Array<{ id: string; question: string; multiSelect?: boolean; options?: Array<{ label: string; description?: string }> }> = wait.questions ?? []
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
                'data-markdown-toolbar-open': markdownToolbarOpen && !markdownPlainText || undefined,
                children: [
                  jsx('span', { className: 'evo-composer-dot', 'data-busy': running || undefined }),
                  jsx('span', { title: currentTitle === null ? t('noActiveConversationHint') : undefined, children: currentTitle === null ? t('noActiveConversation') : running ? t('running') : currentTitle }),
                  jsx(SessionStatusLine, { session }),
                  pendingEdit !== null && jsxs('span', {
                    className: 'evo-composer-editing',
                    title: t('editPendingHint'),
                    children: [
                      jsx(PenLine, {}),
                      jsx('span', { children: t('editingMessage') }),
                      jsx('button', {
                        type: 'button',
                        className: 'evo-composer-editing-cancel',
                        title: t('cancelEdit'),
                        'aria-label': t('cancelEdit'),
                        onClick: () => setPendingEdit(null),
                        children: jsx(XIcon, {}),
                      }),
                    ],
                  }),
                  // 当前工作路径（§25.4）：自适应宽度、中间省略、tooltip 完整路径
                  cwd !== null && jsx(CwdPath, { path: cwd }),
                  // 0.1.3 Open in：在已解析的本地应用中打开工作区目录
                  cwd !== null && jsx(OpenInMenu, { path: cwd }),
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
                    'data-on': markdownPlainText || undefined,
                    title: markdownPlainText ? t('markdownSwitchToWysiwyg') : t('markdownSwitchToSource'),
                    'aria-label': markdownPlainText ? t('markdownSwitchToWysiwyg') : t('markdownSwitchToSource'),
                    'aria-pressed': markdownPlainText,
                    onClick: toggleMarkdownEditorMode,
                    children: markdownPlainText ? t('markdownSourceMode') : t('markdownWysiwyg'),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'evo-composer-markdown-toggle',
                    'data-on': !markdownPlainText && markdownToolbarOpen || undefined,
                    title: markdownPlainText ? t('markdownToolbarWysiwygOnly') : markdownToolbarOpen ? t('hideMarkdownToolbar') : t('showMarkdownToolbar'),
                    'aria-label': markdownToolbarOpen ? t('hideMarkdownToolbar') : t('showMarkdownToolbar'),
                    'aria-pressed': !markdownPlainText && markdownToolbarOpen,
                    'aria-disabled': markdownPlainText || undefined,
                    disabled: markdownPlainText,
                    onClick: toggleMarkdownToolbar,
                    children: jsx(PenLine, {}),
                  }),
                ],
              }),
              jsx('div', {
                className: 'evo-composer-editor',
                'data-markdown-toolbar-open': markdownToolbarOpen && !markdownPlainText || undefined,
                'data-markdown-plain': markdownPlainText || undefined,
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
                      markdownPlainText && jsx('textarea', {
                        ref: composerPlainTextRef,
                        className: 'evo-composer-source',
                        value: input,
                        placeholder: t('askAnything'),
                        spellCheck: true,
                        'aria-label': t('askAnything'),
                        onInput: onPlainTextInput,
                        onKeyDown: (e: { key: string; ctrlKey: boolean; metaKey: boolean; preventDefault: () => void }) => {
                          const currentCandidates = candidatesRef.current
                          if (currentCandidates.length > 0) {
                            if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((index) => (index + 1) % currentCandidates.length); return }
                            if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((index) => (index - 1 + currentCandidates.length) % currentCandidates.length); return }
                            if (e.key === 'Tab') { e.preventDefault(); applyCandidateRef.current(currentCandidates[activeIndexRef.current] ?? currentCandidates[0]!); return }
                            if (e.key === 'Escape') { e.preventDefault(); setTrigger(null); return }
                          }
                          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                            e.preventDefault()
                            submitRef.current()
                            return
                          }
                          if (e.key === 'Escape' && runningRef.current) { e.preventDefault(); stopTurn() }
                        },
                      }),
                      jsx('div', { ref: composerEditorHostRef, className: 'evo-composer-editor-host evo-milkdown' }),
                  !markdownPlainText && input === '' && jsx('div', {
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
                label: trigger?.kind === 'command' ? t('commands') : trigger?.kind === 'mention' ? t('referenceMentions') : t('historyInput'),
                hint: t('candidateKeyboardHint'),
              }),
              jsxs('div', {
                className: 'evo-composer-tools',
                children: [
                  jsx('div', {
                    className: 'evo-composer-tool-start',
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
                    ],
                  }),
                  jsx('div', {
                    className: 'evo-composer-tool-end',
                    children: [
                  // 会话权限（跟随当前会话，非全局）：输入框内切换权限档位
                  jsx(Dropdown, {
                    value: permPreset ?? '',
                    className: 'evo-composer-perm',
                    icon: ShieldCheckIcon,
                    placeholder: t('permission'),
                    title: t('permission'),
                    ariaLabel: t('permission'),
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
      actionDialog === 'edit-resend' && pendingEdit !== null && jsx(ConfirmDialog, {
        title: t('editResendConfirmTitle'),
        message: t('editResendConfirmMsg'),
        confirmLabel: t('editResendConfirm'),
        danger: true,
        onConfirm: () => {
          const edit = pendingEdit
          const resend = trimPromptEdges(composerMarkdownRef.current || input)
          if (edit !== null && resend !== '') editAndResend(edit.seq, resend)
        },
        onClose: () => setActionDialog(null),
      }),
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
