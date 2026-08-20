/**
 * EvoResearch 工作台（browser half）。
 *
 * 结构：
 * - 顶栏：品牌 + 侧栏/新建 + 右侧（连接状态 / Side chats / 语言 / 主题 /
 *   inspector / 设置）；
 * - 三栏：左 ThreadList（会话历史）、中 Chat（欢迎页 + 输入面板）、
 *   右 Inspector（Workspace / Agents / Side chats）；
 * - 默认：侧栏与 inspector 收起，仅顶栏 + 中间。
 *
 * 数据全部来自 DSH client-runtime（useSessions / sessions.open），
 * 后端能力（会话、模型、工具）由 dsh-base 提供 —— 不重复造轮子。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState, useEffect, useRef, useSyncExternalStore, Component } from 'react'
import {
  PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, SquarePen,
  MessagesSquare, Moon, Sun, Settings, Languages, X, Plus, FileText, FileCode2, Save, FolderOpen,
} from 'lucide-react'
import { CSS } from './styles'
import { KATEX_CSS } from './katex-css'
import { applyTheme, resolvedTheme, toggleTheme } from './theme'
import { ThreadList, normalizeSessionsSnapshot, type SideView } from './threadlist'
import { ChatArea, type ChatNode } from './chat'
import { Inspector, type InspectorTab } from './inspector'
import { registerConversation } from './conversation'
import { DesktopTitlebar } from './desktop'
import { SettingsDialog } from './settings'
import { t, readLang, setLang } from './i18n'
import { toast, ToastHost } from './toast'
import { MemoryPanel, SchedulePanel, SkillsPanel, WorkspacePanel, ChannelsPanel, TeamPanel } from './panels'
import { ExperimentsPanel } from './experiments'
import { ResearchNotesPanel } from './research-notes'
import { LibraryPanel } from './library-panel'
import { TrajectoryPanel } from './trajectory'
import { ChatGraphPanel } from './chatgraph'
import { WorkspaceTabPicker } from './tab-files'

const inject = ['slots', 'sessions', 'workspaces', 'conversationEvents', 'conversationViews', 'connection']

/** 桌面模式（无边框窗口 + 自绘标题栏）：由 Tauri 壳以 ?desktop=1 加载。 */
function isDesktop(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('desktop') === '1'
}

/** 连接状态源（ctx.connection.hostDescription，apply 时写入；快照存在 = 已握手）。 */
let connectionSource: { getSnapshot(): unknown; subscribe(fn: () => void): () => void } | null = null

/** 插件激活时由 apply 写入的会话服务（组件经闭包使用）。 */
let sessionsService: {
  open(id: string): void
  binding(id: string): { session: any } | undefined
  create(opts?: { cwd?: string; workspaceId?: string }): Promise<string>
  /** 官方 session.fork 在服务内部 manager 上（复制源会话历史创建子会话）。 */
  manager?: { fork?(opts: { sessionId: string; atSeq?: number }): Promise<{ ok: boolean; value?: { sessionId: string } }> }
} | null = null

let workspacesService: {
  create(input: { path: string }): Promise<any>
  rename(workspaceId: string, title: string): Promise<any>
  /** 删除 Workspace 注册（不触碰目录、文件与会话日志；会话转为未分组）。 */
  delete(workspaceId: string): Promise<void>
} | null = null

type AutoTitleKind = 'project' | 'subchat'
type AutoTitleState = {
  kind: AutoTitleKind
  inputs: string[]
  attempt: number
  finalized: boolean
  workspaceId?: string
}
const AUTO_TITLE_KEY = 'evoresearch-auto-title-state'

function readAutoTitleStates(): Record<string, AutoTitleState> {
  try {
    const raw = JSON.parse(localStorage.getItem(AUTO_TITLE_KEY) ?? '{}') as Record<string, unknown>
    const states: Record<string, AutoTitleState> = {}
    for (const [id, value] of Object.entries(raw)) {
      const item = value as Partial<AutoTitleState>
      if ((item.kind === 'project' || item.kind === 'subchat') && Array.isArray(item.inputs)) {
        states[id] = {
          kind: item.kind,
          inputs: item.inputs.filter((text): text is string => typeof text === 'string').slice(0, 10),
          attempt: Math.min(10, Math.max(0, Number(item.attempt) || 0)),
          finalized: item.finalized === true,
          ...(typeof item.workspaceId === 'string' ? { workspaceId: item.workspaceId } : {}),
        }
      }
    }
    return states
  } catch { return {} }
}

function writeAutoTitleStates(states: Record<string, AutoTitleState>): void {
  try { localStorage.setItem(AUTO_TITLE_KEY, JSON.stringify(states)) } catch { /* 本地缓存不可用不影响聊天 */ }
}

// 与插件端 core/title.ts 的 isLowInformationInput 保持同一套规则。
function lowInformationTitleInput(text: string): boolean {
  return /^(你好|您好|嗨|哈喽|hello|hi|hey|谢谢|感谢|好的|好|嗯|嗯嗯|ok|okay|继续|收到|明白|在吗|(你|您)(可以|能|会)?(做|干|有|提供|帮忙)?(什么|啥|哪些|嘛)(事情|工作|功能)?|(你|您)(是|叫)什么|(你|您)是谁|介绍(一下)?(你|这个)?(自己)?|这(是|有)什么(用|意思|功能)?|(你|这)能帮我吗|what can you do|who are you|can you help me|how do you work)[!！?？。,.，、\s]*$/i.test(text.trim())
}

function localTitleFallback(kind: AutoTitleKind, inputs: string[]): string {
  const meaningful = inputs.find((text) => !lowInformationTitleInput(text))
  const seed = (meaningful ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28)
  return seed !== '' ? seed : kind === 'subchat' ? '未命名研究子对话' : '未命名科研项目'
}

/** 空白 Side Chat 追踪键（每 workspace；fork 型由 parentSessionId 识别，无需记录）。 */
function sideChatKey(cwd: string | null): string {
  return `evoresearch-sidechats:${cwd ?? '__new__'}`
}
function readSideChats(cwd: string | null): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(sideChatKey(cwd)) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function recordSideChat(cwd: string | null, id: string): void {
  try {
    const list = readSideChats(cwd)
    if (!list.includes(id)) localStorage.setItem(sideChatKey(cwd), JSON.stringify([...list, id]))
  } catch { /* 忽略 */ }
}
function forgetSideChat(cwd: string | null, id: string): void {
  try {
    const list = readSideChats(cwd)
    if (list.includes(id)) localStorage.setItem(sideChatKey(cwd), JSON.stringify(list.filter((x) => x !== id)))
  } catch { /* 忽略 */ }
}

/** 注入样式（data-plugin-css 模式，可被 HMR 清理）。 */
function installCss() {
  const sheets: Array<[string, string]> = [
    ['@evoresearch/dsh-app/workspace.css', CSS],
    ['@evoresearch/dsh-app/katex.css', KATEX_CSS],
  ]
  for (const [tagId, css] of sheets) {
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${tagId}"]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = '@evoresearch/dsh-app'
      tag.dataset.pluginCss = tagId
      tag.textContent = css
      document.head.appendChild(tag)
    }
  }
}

const PANELS_KEY = 'evoresearch-panels'

/** URL 查询状态（§43.5）：可分享/可恢复的导航状态（threadId/view/inspector…）。 */
function patchUrl(patch: Record<string, string | null>): void {
  try {
    const params = new URLSearchParams(location.search)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key)
      else params.set(key, value)
    }
    const qs = params.toString()
    history.replaceState(null, '', qs === '' ? location.pathname : `${location.pathname}?${qs}`)
  } catch { /* URL 更新失败不影响功能 */ }
}

function readPanels(): { left: number; right: number } {
  try {
    const v = JSON.parse(localStorage.getItem(PANELS_KEY) ?? '')
    if (typeof v.left === 'number' && typeof v.right === 'number') return v
  } catch { /* 默认值 */ }
  return { left: 264, right: 320 }
}

/** 会话当前标题（byId[current]）；子对话显示为「项目名/子对话名」。 */
function currentTitleOf(sessions: any, workspaces: any): string | null {
  const id = sessions.current
  if (id === undefined) return null
  const s = sessions.byId[id]
  if (s === undefined) return null
  const title = s.displayTitle ?? id.slice(0, 12)
  const cwd = typeof s.cwd === 'string' && s.cwd !== '' ? s.cwd.replace(/[\\/]+$/, '') : null
  if (cwd === null) return title
  const workspace = (workspaces?.items ?? []).find((w: any) => typeof w?.path === 'string' && w.path.replace(/[\\/]+$/, '') === cwd)
  const projectName = typeof workspace?.title === 'string' && workspace.title.trim() !== ''
    ? workspace.title
    : (cwd.split(/[\\/]/).pop() ?? cwd)
  return title === projectName ? projectName : `${projectName}/${title}`
}

/**
 * 页面级错误边界（§33.4）：渲染失败时提供 Reload（保留 URL threadId/project）
 * 与 Go back（回首页）。
 */
class ErrorBoundary extends (Component as any) {
  state: { failed: boolean } = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown, info: unknown) {
    console.error('[EvoResearch] 渲染错误:', error, info)
  }
  render() {
    if (this.state.failed) {
      return jsxs('div', {
        className: 'evo-fatal',
        children: [
          jsx('h2', { children: '页面无法加载' }),
          jsx('p', { children: '渲染发生错误。Reload 将保留当前会话；Go back 返回首页。' }),
          jsxs('div', {
            className: 'evo-fatal-acts',
            children: [
              jsx('button', { type: 'button', className: 'evo-btn evo-btn-run', onClick: () => location.reload(), children: t('reload') }),
              jsx('button', {
                type: 'button',
                className: 'evo-btn',
                onClick: () => { location.href = location.origin + location.pathname },
                children: t('goBack'),
              }),
            ],
          }),
        ],
      })
    }
    return (this.props as any).children
  }
}

/** 工作台根组件（root slot）。 */
function EvoFrame({ useSessions, useWorkspaces }: { useSessions: any; useWorkspaces: any }) {  const sessions = normalizeSessionsSnapshot(useSessions((s) => s))
  const workspaces = useWorkspaces((w) => w)
  const [projectScope, setProjectScope] = useState<{ name: string; path: string } | null>(null)
  const [sidebar, setSidebar] = useState(() => typeof window !== 'undefined' ? new URLSearchParams(location.search).get('sidebar') !== '0' : true)
  const [inspector, setInspector] = useState(() => typeof window !== 'undefined' ? new URLSearchParams(location.search).get('inspector') === '1' : false)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(() => {
    if (typeof window === 'undefined') return 'workspace'
    const t = new URLSearchParams(location.search).get('inspectorTab')
    return t === 'agents' || t === 'chats' ? t : 'workspace'
  })
  const [view, setView] = useState<SideView>(null)
  const [themeDark, setThemeDark] = useState(() => resolvedTheme() === 'dark')
  const [panels, setPanels] = useState(readPanels)
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const desktop = isDesktop()

  // 没有明确 threadId 的首页不跟随 sessions 服务异步恢复上一次会话。
  // 否则首帧会短暂显示欢迎区，服务恢复 current 后又立刻切成旧对话，形成闪烁。
  const [homeMode, setHomeMode] = useState(() => {
    if (typeof window === 'undefined') return true
    const params = new URLSearchParams(location.search)
    return params.get('threadId') === null && params.get('view') === null
  })
  // 首次发送创建会话后，视图快照可能晚一拍；用短生命周期引用承接紧接着的第二条输入。
  const justCreatedSessionRef = useRef<string | null>(null)

  // 响应式（§26.1）：<768px 左右栏改为抽屉 + 黑色 40% 遮罩
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 连接状态（Health 指示器）：hostDescription 快照存在 = 已握手；订阅断连/重连。
  const [connected, setConnected] = useState(() => connectionSource?.getSnapshot() !== undefined)
  useEffect(() => {
    const source = connectionSource
    if (source === null) return
    setConnected(source.getSnapshot() !== undefined)
    return source.subscribe(() => setConnected(source.getSnapshot() !== undefined))
  }, [])

  // 主题：初始化 + 跟随系统变化（pref=system 时）
  useEffect(() => {
    applyTheme()
    document.documentElement.classList.toggle('evo-desktop', isDesktop())
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      setThemeDark(resolvedTheme() === 'dark')
      applyTheme()
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const restoredCurrent = sessions.current
  const current = homeMode ? undefined : restoredCurrent
  const currentTitle = current === undefined ? null : currentTitleOf(sessions, workspaces)
  const running = current !== undefined && sessions.byId[current]?.running === true
  // 当前会话的后台任务（§21.6：jobsBySession 快照）
  const currentJobs: Array<{ id: string; kind: string; label: string; status: string; detail?: string; startedAt?: number; finishedAt?: number }>
    = current === undefined ? [] : ((sessions.jobsBySession ?? {})[current] ?? [])

  const ensureWorkspace = async (path: string): Promise<any | null> => {
    const existing = (workspaces.items ?? []).find((item: any) => typeof item?.path === 'string' && item.path.replace(/[\\/]+$/, '') === path.replace(/[\\/]+$/, ''))
    if (existing !== undefined) return existing
    try {
      return await workspacesService?.create({ path }) ?? null
    } catch {
      return null
    }
  }

  const judgeAutoTitle = async (kind: AutoTitleKind, inputs: string[], attempt: number): Promise<{ title: string | null; final: boolean }> => {
    try {
      const response = await fetch('/evoresearch/fs/project-title-suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, inputs: inputs.slice(0, 10), attempt }),
      })
      const json = await response.json()
      if (json.ok === true && (json.value?.title === null || typeof json.value?.title === 'string')) {
        return { title: json.value.title, final: json.value.final === true }
      }
    } catch { /* 标题辅助失败时走本地第 10 次兜底 */ }
    return { title: attempt >= 10 ? localTitleFallback(kind, inputs) : null, final: attempt >= 10 }
  }

  const applyAutoTitle = async (sessionId: string, kind: AutoTitleKind, workspaceId?: string): Promise<void> => {
    const states = readAutoTitleStates()
    const previous = states[sessionId] ?? { kind, inputs: [], attempt: 0, finalized: false }
    if (previous.finalized || previous.inputs.length === 0) return
    const next = { ...previous, kind, ...(workspaceId === undefined ? {} : { workspaceId }) }
    const result = await judgeAutoTitle(kind, next.inputs, next.attempt)
    // 模型请求期间用户可能已经手动重命名；手动标题拥有最高优先级。
    const latest = readAutoTitleStates()[sessionId]
    if (latest?.finalized === true) return
    if (result.title !== null && result.title.trim() !== '') {
      const title = result.title.trim()
      const session = sessionsService?.binding(sessionId)?.session
      if (session?.rename !== undefined) {
        try { await session.rename(title) } catch { /* 标题失败不影响消息 */ }
      }
      if (next.workspaceId !== undefined) {
        try { await workspacesService?.rename(next.workspaceId, title) } catch { /* 工作区标题失败保留会话标题 */ }
      }
      states[sessionId] = { ...next, finalized: true }
    } else {
      states[sessionId] = next
    }
    writeAutoTitleStates(states)
  }

  const rememberAutoTitleInput = (sessionId: string, kind: AutoTitleKind, text: string, workspaceId?: string): void => {
    const states = readAutoTitleStates()
    const previous = states[sessionId] ?? { kind, inputs: [], attempt: 0, finalized: false }
    if (previous.finalized || previous.inputs.length >= 10) return
    states[sessionId] = {
      ...previous,
      kind,
      inputs: [...previous.inputs, text.trim()].slice(0, 10),
      attempt: Math.min(10, previous.attempt + 1),
      ...(workspaceId === undefined ? {} : { workspaceId }),
    }
    writeAutoTitleStates(states)
  }
  // Recents 运行状态（§26.3：agent 运行中或后台 job 进行中的会话行显示状态点）
  const runningIds = new Set<string>()
  for (const sid of sessions.ids ?? []) {
    const s = sessions.byId[sid]
    if (s?.running === true) { runningIds.add(sid); continue }
    const jobs = (sessions.jobsBySession ?? {})[sid] ?? []
    if (jobs.some((j) => j.status === 'running' || j.status === 'stopping')) runningIds.add(sid)
  }

  // ── 会话快照订阅：notifier → snapshotCache（chat legacy 节点 + promptError）──
  const sessionSnapshot = useSyncExternalStore(
    (onChange) => {
      const s = current === undefined ? undefined : sessionsService?.binding(current)?.session
      return s === undefined ? () => {} : s.notifier.subscribe(onChange)
    },
    () => {
      const s = current === undefined ? undefined : sessionsService?.binding(current)?.session
      return s === undefined ? null : s.snapshotCache
    },
  )
  const chatLegacy = sessionSnapshot?.chat?.legacy
  // Bug #3：系统级上下文不得泄漏到聊天界面——dsh-system-prompt 的 runtime context /
  // 策略说明与科研记忆/身份/代码模式 XML 包会以 visibility='visible' 的节点出现，
  // 渲染前按文本前缀过滤（内容匹配，与可见性无关，防御上游变更）。
  const SYSTEM_LEAK_PREFIXES = [
    'Current runtime context',
    'Current DSH file policy',
    'Approval prompts are disabled',
    '<code_mode>',
    '<research_memory_packet>',
    '<identity_profile>',
    '<project_env>',
  ]
  const isSystemLeak = (n: any): boolean => {
    if (n === null || n.data === undefined) return false
    const blocks = n.data.blocks
    if (Array.isArray(blocks)) {
      for (const b of blocks) {
        if (b?.kind === 'text' && typeof b.text === 'string' && SYSTEM_LEAK_PREFIXES.some((p) => b.text.trimStart().startsWith(p))) return true
      }
    }
    const text = n.data.text
    return typeof text === 'string' && SYSTEM_LEAK_PREFIXES.some((p) => text.trimStart().startsWith(p))
  }
  const nodes: ChatNode[] = (chatLegacy?.nodes ?? []).filter((n: any) => n !== null && n.visibility === 'visible' && !isSystemLeak(n))
  const partial: ChatNode | null = chatLegacy?.partial ?? null
  const promptError: string | null = sessionSnapshot?.promptError?.error?.message ?? null

  // 会话对象（投影/排队数据读取入口）
  const sessionObj = current === undefined ? null : (sessionsService?.binding(current)?.session ?? null)
  // 投影订阅：sessionStats/tokenUsage/contextPressure/permissions/goal 变化时重渲染
  const [, setProjTick] = useState(0)
  useEffect(() => {
    const s = current === undefined ? undefined : sessionsService?.binding(current)?.session
    return s === undefined ? undefined : s.projections?.subscribeAny(() => setProjTick((v) => v + 1))
  }, [current])

  const openSession = (id: string) => {
    justCreatedSessionRef.current = null
    setHomeMode(false)
    sessionsService?.open(id)
    // Bug：仅 patchUrl 清 view 会造成 state/URL 失步（面板残留主区域）——state 一并清
    setView(null)
    patchUrl({ threadId: id, view: null })
  }
  const startNewChat = (projectCwd?: string) => {
    justCreatedSessionRef.current = null
    setView(null)
    // 创建过程完成前仍保持首页/空白状态，避免旧会话在中间短暂闪回。
    setHomeMode(true)
    // Home 操作清除 thread/project/定位状态（§43.5），关闭不合适的面板
    patchUrl({ threadId: null, view: null })
    // 新对话：优先指定项目工作区（左侧项目内新建）；否则继承当前会话所在项目；无则空白
    const cwd = projectCwd !== undefined && projectCwd !== '' ? projectCwd : undefined
    // 延迟到用户真正发送时再创建：这样项目列表创建项目、项目内列表创建子聊天，
    // 且“新建对话”不会先制造一个没有标题/首条消息的空会话。
    if (cwd !== undefined) {
      if (projectScope === null) {
        const name = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? cwd
        setProjectScope({ name, path: cwd })
      }
    } else {
      // 从项目列表发起的新对话必须创建新项目，不能沿用上一次项目视图的残留状态。
      setProjectScope(null)
    }
  }

  // §43.5/§33.4：URL threadId 恢复（刷新或分享链接打开对应会话）；?resend= 编辑重发
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const threadId = params.get('threadId')
    const resend = params.get('resend')
    if (threadId === null || threadId === '') return
    setHomeMode(false)
    if (resend !== null) {
      // 编辑重发：清除参数，打开会话后自动发送修正文本（走官方 prompt 流程）
      history.replaceState(null, '', `${location.pathname}${location.search.replace(/([?&])resend=[^&]*/, '$1').replace(/[?&]$/, '')}${location.hash}`)
    }
    let cancelled = false
    let attempts = 0
    const tryOpen = () => {
      if (cancelled) return
      if (sessionsService === null || attempts > 30) return
      attempts += 1
      try {
        sessionsService.open(threadId)
      } catch {
        setTimeout(tryOpen, 300)
      }
    }
    tryOpen()
    if (resend !== null && resend !== '') {
      // 等会话绑定就绪后自动重发
      const timer = setInterval(() => {
        if (cancelled) { clearInterval(timer); return }
        const s = sessionsService?.binding(threadId)?.session
        if (s !== undefined) {
          clearInterval(timer)
          void s.prompt([{ type: 'text', text: resend }], 'queue').catch(() => { /* 失败落在 snapshot.promptError */ })
        }
      }, 200)
      setTimeout(() => clearInterval(timer), 20000)
    }
    return () => { cancelled = true }
  }, [])

  // §26.6：Scheduled 面板 "Report to main chat" —— 以普通用户消息回送当前主对话
  useEffect(() => {
    const onReport = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text
      if (typeof text === 'string' && text !== '') sendMessage(text)
    }
    window.addEventListener('evo-report-to-chat', onReport)
    return () => window.removeEventListener('evo-report-to-chat', onReport)
  }, [current])

  // ── §42.4 浏览器通知事件 ──
  const notifyEnabled = (): boolean =>
    typeof Notification !== 'undefined' && Notification.permission === 'granted' && (() => {
      try { return localStorage.getItem('evoresearch-notifications') === '1' } catch { return false }
    })()
  // 1) Scheduled 任务完成：10s 轮询 + 首次 baseline（不补发）+ taskId:lastRunAt 去重（跨刷新持久化）
  useEffect(() => {
    if (typeof Notification === 'undefined') return
    const KEY = 'evoresearch-sched-notified'
    let known = new Set<string>()
    let baseline = true
    try {
      const raw = localStorage.getItem(KEY)
      if (raw !== null) {
        known = new Set(JSON.parse(raw))
        baseline = false // 已有去重键：后续新完成事件立即通知
      }
    } catch { /* 损坏则视为首次运行 */ }
    const timer = setInterval(() => {
      if (!notifyEnabled()) return
      void fetch('/evoresearch/fs/scheduler-list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then((r) => r.json())
        .then((json) => {
          const tasks: Array<{ taskId?: string; name?: string; lastRunAt?: number }> = json?.value ?? []
          let changed = false
          for (const t of tasks) {
            if (t.taskId === undefined || t.lastRunAt === undefined) continue
            const key = `${t.taskId}:${t.lastRunAt}`
            if (known.has(key)) continue
            known.add(key)
            changed = true
            if (!baseline) {
              try { new Notification(`Scheduled 任务完成：${t.name ?? t.taskId}`) } catch { /* 静默退化 */ }
            }
          }
          if (changed) {
            try { localStorage.setItem(KEY, JSON.stringify([...known])) } catch { /* 忽略 */ }
          }
          baseline = false
        })
        .catch(() => { /* 网络失败静默 */ })
    }, 10000)
    return () => clearInterval(timer)
  }, [])
  // 2) Ask User / 工具审批出现时通知（仅新出现的 pending）
  const prevPendingRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const pending: Array<{ kind?: string; key?: string }> = sessionSnapshot?.pending ?? []
    const keys = new Set(pending.map((p) => `${p.kind ?? ''}:${p.key ?? ''}`))
    const fresh = [...keys].filter((k) => !prevPendingRef.current.has(k))
    prevPendingRef.current = keys
    if (fresh.length > 0 && notifyEnabled() && current !== undefined) {
      const labels = fresh.map((k) => (k.startsWith('question') ? 'Ask User 提问' : '工具审批'))
      try { new Notification(`${labels.join('、')} 等待处理`) } catch { /* 静默退化 */ }
    }
  }, [sessionSnapshot])

  // §43.5：view / inspector 状态写入 URL（可分享/可恢复）
  const setViewAndUrl = (v: SideView) => {
    setView(v)
    patchUrl({ view: v })
  }
  const toggleInspector = () => {
    setInspector((v) => {
      patchUrl({ inspector: v ? null : '1', inspectorTab: v ? null : inspectorTab })
      return !v
    })
  }
  // §43.5：Inspector 子标签写入 URL（workspace/agents/chats 可分享恢复）
  const setInspectorTabUrl = (t: InspectorTab) => {
    setInspectorTab(t)
    patchUrl({ inspectorTab: t })
  }

  // ── Recents 操作（§26.3）与 Side Chat（§22.3）──
  const renameSession = async (id: string, title: string): Promise<boolean> => {
    if (title === '') return false
    const session = sessionsService?.binding(id)?.session
    if (session?.rename === undefined) return false
    const result = await session.rename(title)
    if (result?.ok === true) {
      const states = readAutoTitleStates()
      const state = states[id]
      if (state !== undefined) {
        states[id] = { ...state, finalized: true }
        writeAutoTitleStates(states)
        // 项目初始会话的手动标题同时作为项目显示标题；子聊天不改项目名。
        if (state.kind === 'project' && state.workspaceId !== undefined) {
          try { await workspacesService?.rename(state.workspaceId, title) } catch { /* 会话标题已保存 */ }
        }
      }
      toast('会话已重命名', 'success')
    }
    return result?.ok === true
  }
  const forkSideChat = async (id: string): Promise<{ ok: boolean; id?: string; error?: string }> => {
    const manager = sessionsService?.manager
    if (manager?.fork === undefined) return { ok: false, error: 'fork 服务不可用' }
    let result
    try {
      // 保持 this 绑定（manager 方法依赖 this.summaries / this.api）
      result = await manager.fork.call(manager, { sessionId: id })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    if (result?.ok === true && result.value?.sessionId !== undefined) {
      // 摘要刷新可能丢失 parentSessionId，双写 localStorage 追踪（§22.3）
      recordSideChat(sessions.byId[id]?.cwd ?? null, result.value.sessionId)
      return { ok: true, id: result.value.sessionId }
    }
    // 官方 fork 要求源会话存在已完成轮次（host 错误原文透出）
    const message = (result?.error as { message?: string } | undefined)?.message
    return { ok: false, error: message ?? 'fork 失败' }
  }
  const createBlankSideChat = async (cwd: string | null): Promise<string | null> => {
    const id = await sessionsService?.create(cwd === null ? {} : { cwd })
    if (id !== undefined) {
      recordSideChat(cwd, id)
      sessionsService?.open(id)
      return id
    }
    return null
  }

  // ── 会话导出（§26.3 / §41.8）：JSON 诊断/迁移 + Markdown 人读 ──
  const exportSession = (id: string, format: 'json' | 'markdown', title: string) => {
    void fetch('/evoresearch/fs/session-export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: id, format, title }),
    }).then((res) => res.json()).then((json) => {
      if (!json.ok || json.value?.content === undefined) return
      const blob = new Blob([json.value.content], { type: format === 'markdown' ? 'text/markdown' : 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = json.value.filename ?? `evoresearch-${id.slice(0, 8)}.${format === 'markdown' ? 'md' : 'json'}`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }).catch(() => {})
  }

  // ── Recents 置顶（§26.3 Pin）：后端持久化（§29 session-meta），localStorage 作启动缓存 ──
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('evoresearch-pinned') ?? '[]')
      return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
    } catch {
      return new Set()
    }
  })
  const persistPin = (id: string, value: boolean) => {
    try { void fetch('/evoresearch/fs/session-meta-set', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: id, pinned: value }) }).catch(() => {}) } catch { /* 忽略 */ }
  }
  const togglePin = (id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev)
      const value = next.has(id) ? (next.delete(id), false) : (next.add(id), true)
      try { localStorage.setItem('evoresearch-pinned', JSON.stringify([...next])) } catch { /* 忽略 */ }
      persistPin(id, value)
      return next
    })
  }

  // ── Recents 标签颜色（§26.3）：后端持久化（§29），localStorage 作启动缓存 ──
  const [tagColors, setTagColors] = useState<Record<string, string>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('evoresearch-tagcolors') ?? '{}')
      return typeof raw === 'object' && raw !== null ? raw : {}
    } catch {
      return {}
    }
  })
  const persistTagColor = (id: string, color: string | null) => {
    try { void fetch('/evoresearch/fs/session-meta-set', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: id, tagColor: color }) }).catch(() => {}) } catch { /* 忽略 */ }
  }
  const setTagColor = (id: string, color: string | null) => {
    setTagColors((prev) => {
      const next = { ...prev }
      if (color === null) delete next[id]
      else next[id] = color
      try { localStorage.setItem('evoresearch-tagcolors', JSON.stringify(next)) } catch { /* 忽略 */ }
      persistTagColor(id, color)
      return next
    })
  }

  // ── 会话归档（§26.3 Archive）：后端持久化（§29），localStorage 作启动缓存 ──
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('evoresearch-archived') ?? '[]')
      return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
    } catch {
      return new Set()
    }
  })
  const persistArchive = (id: string, value: boolean) => {
    try { void fetch('/evoresearch/fs/session-meta-set', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: id, archived: value }) }).catch(() => {}) } catch { /* 忽略 */ }
  }
  const toggleArchive = (id: string) => {
    setArchivedIds((prev) => {
      const next = new Set(prev)
      const value = next.has(id) ? (next.delete(id), false) : (next.add(id), true)
      try { localStorage.setItem('evoresearch-archived', JSON.stringify([...next])) } catch { /* 忽略 */ }
      persistArchive(id, value)
      return next
    })
  }

  // ── 项目级状态（标签颜色 / 归档）：后端 project-meta 持久化（§29），
  // localStorage 仅作启动缓存；换浏览器后仍以后端文件为准恢复。──
  const PROJECT_TAG_KEY = 'evoresearch-project-tagcolors'
  const PROJECT_ARCHIVED_KEY = 'evoresearch-project-archived'
  const normCwd = (cwd: unknown): string | null =>
    typeof cwd === 'string' && cwd !== '' ? cwd.replace(/[\\/]+$/, '') : null

  const [projectTagColors, setProjectTagColors] = useState<Record<string, string>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(PROJECT_TAG_KEY) ?? '{}')
      return typeof raw === 'object' && raw !== null ? raw : {}
    } catch {
      return {}
    }
  })
  const [archivedProjects, setArchivedProjects] = useState<Set<string>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(PROJECT_ARCHIVED_KEY) ?? '[]')
      return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
    } catch {
      return new Set()
    }
  })
  /** 写穿到后端 project-meta.json（失败不影响本地状态，下次启动以后端为准）。 */
  const persistProjectMeta = (path: string, patch: { archived?: boolean; tagColor?: string | null }) => {
    void fetch('/evoresearch/fs/project-meta-set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, ...patch }),
    }).catch(() => {})
  }
  const setProjectTagColor = (path: string, color: string | null) => {
    setProjectTagColors((prev) => {
      const next = { ...prev }
      if (color === null) delete next[path]
      else next[path] = color
      try { localStorage.setItem(PROJECT_TAG_KEY, JSON.stringify(next)) } catch { /* 忽略 */ }
      return next
    })
    persistProjectMeta(path, { tagColor: color })
    toast(color === null ? '已清除标签颜色' : '已设置标签颜色', 'success')
  }
  /** 归档/恢复项目：同步归档/恢复其全部子聊天（后端 session-meta 持久化）。 */
  const toggleProjectArchive = (path: string) => {
    const isArchived = archivedProjects.has(path)
    const ids = (sessions.ids ?? []).filter((id: string) => {
      const s = sessions.byId[id]
      return s !== undefined && normCwd(s.cwd) === path && !deletedIds.has(id)
    })
    for (const id of ids) {
      const shouldFlip = isArchived ? archivedIds.has(id) : !archivedIds.has(id)
      if (shouldFlip) toggleArchive(id)
    }
    setArchivedProjects((prev) => {
      const next = new Set(prev)
      if (isArchived) next.delete(path)
      else next.add(path)
      try { localStorage.setItem(PROJECT_ARCHIVED_KEY, JSON.stringify([...next])) } catch { /* 忽略 */ }
      return next
    })
    persistProjectMeta(path, { archived: !isArchived })
    if (!isArchived) {
      toast('项目已归档，可在底部“已归档项目”中恢复', 'success')
      window.dispatchEvent(new CustomEvent('evo:project-archived'))
    } else {
      toast('项目已恢复', 'success')
    }
  }
  /** 项目重命名：改 Workspace 显示标题；同时终止项目内会话的自动标题。 */
  const renameProject = async (path: string, title: string): Promise<boolean> => {
    const trimmed = title.trim()
    if (trimmed === '') return false
    try {
      const existing = (workspaces.items ?? []).find((w: any) => typeof w?.path === 'string' && normCwd(w.path) === path)
      let workspace = existing
      if (workspace === undefined) workspace = await ensureWorkspace(path)
      if (workspace?.workspaceId === undefined) return false
      await workspacesService?.rename(workspace.workspaceId, trimmed)
      // 手动命名后，该项目内会话的自动标题全部定稿，避免后续 AI 标题覆盖显示名。
      const states = readAutoTitleStates()
      let changed = false
      for (const sid of sessions.ids ?? []) {
        const s = sessions.byId[sid]
        const state = states[sid]
        if (s !== undefined && normCwd(s.cwd) === path && state !== undefined && state.finalized !== true) {
          states[sid] = { ...state, finalized: true }
          changed = true
        }
      }
      if (changed) writeAutoTitleStates(states)
      toast('项目已重命名', 'success')
      return true
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error')
      return false
    }
  }

  // §29：启动时以后端 session-meta 为准合并三态（localStorage 仅作离线缓存）
  useEffect(() => {
    let cancelled = false
    void fetch('/evoresearch/fs/session-meta-get', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled || !json.ok) return
        const meta = json.value as Record<string, { pinned?: boolean; tagColor?: string | null; archived?: boolean }>
        const pinNext = new Set<string>()
        const tagNext: Record<string, string> = {}
        const archNext = new Set<string>()
        for (const [sid, m] of Object.entries(meta)) {
          if (m.pinned === true) pinNext.add(sid)
          if (typeof m.tagColor === 'string') tagNext[sid] = m.tagColor
          if (m.archived === true) archNext.add(sid)
        }
        setPinnedIds((prev) => (pinNext.size > 0 || Object.keys(meta).length > 0 ? pinNext : prev))
        setTagColors((prev) => (Object.keys(tagNext).length > 0 ? tagNext : prev))
        setArchivedIds((prev) => (archNext.size > 0 || Object.keys(meta).length > 0 ? archNext : prev))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // §29：项目元数据（归档/标签色）以后端 project-meta 为准（localStorage 仅作启动缓存）
  useEffect(() => {
    let cancelled = false
    void fetch('/evoresearch/fs/project-meta-get', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled || !json.ok) return
        const meta = json.value as Record<string, { archived?: boolean; tagColor?: string | null }>
        const archNext = new Set<string>()
        const tagNext: Record<string, string> = {}
        for (const [path, m] of Object.entries(meta)) {
          if (m.archived === true) archNext.add(path)
          if (typeof m.tagColor === 'string') tagNext[path] = m.tagColor
        }
        setArchivedProjects((prev) => (archNext.size > 0 || Object.keys(meta).length > 0 ? archNext : prev))
        setProjectTagColors((prev) => (Object.keys(tagNext).length > 0 ? tagNext : prev))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // ── 会话删除（附录 B-2/B-9）：host 删除持久化数据；live 残留由本集合过滤，重启后彻底消失 ──
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('evoresearch-deleted') ?? '[]')
      return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
    } catch {
      return new Set()
    }
  })
  const markDeleted = (id: string, cwd: string | null) => {
    setDeletedIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      try { localStorage.setItem('evoresearch-deleted', JSON.stringify([...next])) } catch { /* 忽略 */ }
      return next
    })
    setPinnedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      try { localStorage.setItem('evoresearch-pinned', JSON.stringify([...next])) } catch { /* 忽略 */ }
      return next
    })
    setTagColors((prev) => { const next = { ...prev }; delete next[id]; return next })
    forgetSideChat(cwd, id)
  }
  const deleteSessionById = async (id: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/evoresearch/fs/session-delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: id }),
      })
      const json = await res.json()
      if (json.ok !== true) return { ok: false, error: (json.error as { message?: string } | undefined)?.message ?? '删除失败' }
      const cwd = sessions.byId[id]?.cwd ?? null
      markDeleted(id, cwd)
      toast('会话已删除', 'success')
      // 删除的是当前会话 → 跳到新会话
      if (sessions.current === id) startNewChat()
      window.dispatchEvent(new CustomEvent('evo-sidechats-refresh'))
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  const deleteSession: typeof deleteSessionById = deleteSessionById

  /**
   * 删除项目：删除该项目下的全部子聊天（host 删除持久化数据），
   * 清理项目级标签/归档状态与 Workspace 注册。
   * 磁盘上的项目目录与用户文件保留（与 Workspace 注册删除语义一致），
   * 避免把可能仍有价值的文件一并销毁。
   */
  const deleteProject = async (path: string): Promise<{ ok: boolean; error?: string }> => {
    const ids = (sessions.ids ?? []).filter((id: string) => {
      const s = sessions.byId[id]
      return s !== undefined && normCwd(s.cwd) === path
    })
    let failed: string | null = null
    for (const id of ids) {
      const result = await deleteSessionById(id)
      if (!result.ok && failed === null) failed = result.error ?? '删除失败'
    }
    setProjectTagColors((prev) => {
      const next = { ...prev }
      delete next[path]
      try { localStorage.setItem(PROJECT_TAG_KEY, JSON.stringify(next)) } catch { /* 忽略 */ }
      return next
    })
    setArchivedProjects((prev) => {
      const next = new Set(prev)
      next.delete(path)
      try { localStorage.setItem(PROJECT_ARCHIVED_KEY, JSON.stringify([...next])) } catch { /* 忽略 */ }
      return next
    })
    persistProjectMeta(path, { archived: false, tagColor: null })
    try {
      const workspace = (workspaces.items ?? []).find((w: any) => typeof w?.path === 'string' && normCwd(w.path) === path)
      if (workspace?.workspaceId !== undefined) await workspacesService?.delete(workspace.workspaceId)
    } catch { /* 注册清理失败不影响删除 */ }
    if (failed === null) toast('项目已删除（对话已移除，磁盘文件保留）', 'success')
    else toast(failed, 'error')
    window.dispatchEvent(new CustomEvent('evo-sidechats-refresh'))
    return { ok: failed === null, error: failed ?? undefined }
  }

  // ── 复制历史到新对话（§5.3）：fork 出独立会话后「提升」为主聊天 ──
  // 官方 fork 的子会话带 parentSessionId 血缘，前端据此归入 Side chats；提升后
  // 该 id 进入 promotedIds（localStorage 持久化），从侧聊集合剔除并出现在 Recents。
  const PROMOTED_KEY = 'evoresearch-promoted'
  const readPromoted = (): Set<string> => {
    try {
      const raw = JSON.parse(localStorage.getItem(PROMOTED_KEY) ?? '[]')
      return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
    } catch {
      return new Set()
    }
  }
  const [promotedIds, setPromotedIds] = useState<Set<string>>(readPromoted)

  // ── Side chats 列表（§22.3-22.4）：当前 workspace 的 fork 子会话 + 空白侧聊 ──
  const [, setSideTick] = useState(0)
  useEffect(() => {
    const refresh = () => setSideTick((v) => v + 1)
    window.addEventListener('evo-sidechats-refresh', refresh)
    return () => window.removeEventListener('evo-sidechats-refresh', refresh)
  }, [])
  const cwdNow = current === undefined ? null : (sessions.byId[current]?.cwd ?? null)
  // 全局侧聊 id 集合（供 Recents 隐藏；§22.1 内部/侧聊线程不混入普通列表）
  const sideChatIds = new Set<string>()
  for (const sid of sessions.ids ?? []) {
    const s = sessions.byId[sid]
    if (s !== undefined && !deletedIds.has(sid)) for (const sc of readSideChats(s.cwd ?? null)) sideChatIds.add(sc)
  }
  const sideChats: Array<{ id: string; title: string; kind: 'fork' | 'blank' }> = (sessions.ids ?? [])
    .map((id) => sessions.byId[id])
    // cwd 未设置时镜像字段为 undefined，统一 null 化后再与 cwdNow 比较（§22.4 只展示当前 workspace）
    .filter((s) => s !== undefined && !deletedIds.has(s.id) && (s.cwd ?? null) === cwdNow && !promotedIds.has(s.id))
    // fork 子会话（parentSessionId 或本地记录）或本地记录的空白侧聊（§22.4 只展示当前 workspace）
    .filter((s) => s.parentSessionId !== undefined || readSideChats(cwdNow).includes(s.id))
    .map((s) => ({
      id: s.id,
      title: s.displayTitle ?? s.id.slice(0, 12),
      kind: (s.parentSessionId !== undefined ? 'fork' : 'blank') as 'fork' | 'blank',
    }))
  const newSideChat = (kind: 'inherit' | 'blank') => {
    if (current === undefined) return
    if (kind === 'inherit') {
      void forkSideChat(current).then((childId) => { if (childId !== null) { sessionsService?.open(childId); setSideTick((v) => v + 1) } })
    } else {
      void createBlankSideChat(cwdNow).then(() => setSideTick((v) => v + 1))
    }
  }

  const promoteSession = (id: string) => {
    setPromotedIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      try { localStorage.setItem(PROMOTED_KEY, JSON.stringify([...next])) } catch { /* 忽略 */ }
      return next
    })
    forgetSideChat(cwdNow, id)
  }
  const copyHistoryToNewChat = async (id: string): Promise<{ ok: boolean; id?: string; error?: string }> => {
    const result = await forkSideChat(id)
    if (result.ok && result.id !== undefined) {
      promoteSession(result.id)
      sessionsService?.open(result.id)
      window.dispatchEvent(new CustomEvent('evo-sidechats-refresh'))
      toast('History copied to new chat', 'success')
      return result
    }
    return result
  }

  // ── 浏览器式标签栏（§5.2）：聊天/图谱/轨迹（固定）/ PDF 预览 / 文本编辑器 ──
  interface WorkspaceTab {
    id: string
    kind: 'chat' | 'pdf' | 'editor' | 'trajectory' | 'chatgraph'
    title: string
    filePath?: string
    root?: string
    draft?: string
  }
  const [tabs, setTabs] = useState<WorkspaceTab[]>([
    { id: 'chat', kind: 'chat', title: t('chatTab') },
    { id: 'chatgraph', kind: 'chatgraph', title: t('chatGraphTab') },
    { id: 'trajectory', kind: 'trajectory', title: t('trajectoryTab') },
  ])
  const [activeTabId, setActiveTabId] = useState<string>('chat')
  const [tabMenuOpen, setTabMenuOpen] = useState(false)
  const [tabPickerOpen, setTabPickerOpen] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [tabBusy, setTabBusy] = useState(false)
  const tabFileInputRef = useRef<HTMLInputElement | null>(null)
  const tabNewRef = useRef<HTMLDivElement | null>(null)
  // + 菜单位置（fixed 定位：脱离 tabbar 的 overflow 裁剪）
  const [tabMenuPos, setTabMenuPos] = useState<{ top: number; left: number } | null>(null)
  const toggleTabMenu = () => {
    const next = !tabMenuOpen
    setTabMenuOpen(next)
    if (next) {
      // 菜单固定定位在标签栏下方（以 tabbar 底边为基准，避免与标签栏重叠）
      const tabbar = document.querySelector<HTMLElement>('.evo-tabbar')
      const r = tabbar?.getBoundingClientRect()
      setTabMenuPos(r === undefined ? null : { top: Math.round(r.bottom + 4), left: Math.max(8, Math.round(r.left)) })
    }
  }
  // 菜单外点击关闭（+ 菜单）
  useEffect(() => {
    if (!tabMenuOpen) return
    const onDocClick = (e: MouseEvent) => {
      const wrap = document.querySelector('.evo-tab-new-wrap')
      if (wrap !== null && !wrap.contains(e.target as Node)) { setTabMenuOpen(false); setTabPickerOpen(false) }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [tabMenuOpen])
  const closeTabMenu = () => { setTabMenuOpen(false); setTabPickerOpen(false) }
  const pickWorkspaceFile = (path: string) => {
    const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
    const root = cwdNow ?? ''
    if (ext === '.pdf') openTabPdf(path, root)
    else openTabEditor(path, root)
    closeTabMenu()
  }
  // 同步镜像（setState updater 在 React 18 是延迟执行的，不能在里面捕获 targetId）
  const tabsRef = useRef<WorkspaceTab[]>(tabs)
  tabsRef.current = tabs
  const tabNameOf = (path: string): string => path.slice(path.lastIndexOf('\\') + 1).slice(path.lastIndexOf('/') + 1) || path
  const activateTab = (id: string) => { setActiveTabId(id); setTabMenuOpen(false) }
  const openTabPdf = (path: string, root: string) => {
    const existing = tabsRef.current.find((tab) => tab.kind === 'pdf' && tab.filePath === path)
    if (existing !== undefined) { setActiveTabId(existing.id); setTabMenuOpen(false); return }
    const tab: WorkspaceTab = { id: `pdf-${Date.now().toString(36)}`, kind: 'pdf', title: tabNameOf(path), filePath: path, root }
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
    setTabMenuOpen(false)
  }
  const openTabEditor = (path: string, root: string, draft?: string) => {
    const existing = tabsRef.current.find((tab) => tab.kind === 'editor' && tab.filePath === path)
    if (existing !== undefined) { setActiveTabId(existing.id); setTabMenuOpen(false); return }
    const tab: WorkspaceTab = { id: `editor-${Date.now().toString(36)}`, kind: 'editor', title: tabNameOf(path), filePath: path, root, draft }
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
    setTabMenuOpen(false)
  }
  const updateTabDraft = (id: string, draft: string) => {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, draft } : tab)))
  }
  const closeTab = (id: string) => {
    setTabs((prev) => {
      const next = prev.filter((tab) => tab.id !== id)
      if (activeTabId === id) setActiveTabId('chat')
      return next
    })
  }
  const createTabEditor = (root: string) => {
    const name = newFileName.trim()
    if (name === '' || root === '') return
    setTabBusy(true)
    // 允许子目录（如 notes/draft.md）；仅净化危险字符
    const safe = name.replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    const path = `${root.replace(/[\\/]$/, '')}\\${safe.replace(/\//g, '\\')}`
    void fetch('/evoresearch/fs/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root, path, text: '' }),
    }).then((res) => res.json()).then((json) => {
      setTabBusy(false)
      if (json.ok === true) { setNewFileName(''); openTabEditor(path, root, '') }
      else toast(json.error?.message ?? '创建文件失败', 'error')
    }).catch(() => { setTabBusy(false); toast('创建文件失败', 'error') })
  }
  const uploadPdfTab = (root: string, file: File) => {
    if (root === '') return
    setTabBusy(true)
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '')
      const data = dataUrl.slice(dataUrl.indexOf(',') + 1)
      const safe = file.name.replace(/[^\w.\- ]/g, '_')
      void fetch('/evoresearch/fs/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root, path: `papers/${safe}`, data }),
      }).then((r) => r.json()).then((json) => {
        setTabBusy(false)
        if (json.ok === true) openTabPdf(json.value.path, root)
        else toast(json.error?.message ?? '上传失败', 'error')
      }).catch(() => { setTabBusy(false); toast('上传失败', 'error') })
    }
    reader.readAsDataURL(file)
  }
  // 工作区文件「在标签页打开」（workspace-files.ts 派发 evo-open-tab 事件）
  useEffect(() => {
    const onOpenTab = (e: Event) => {
      const detail = (e as CustomEvent<{ path?: string; root?: string; kind?: string }>).detail
      if (typeof detail?.path !== 'string' || detail.path === '') return
      const root = typeof detail.root === 'string' && detail.root !== '' ? detail.root : cwdNow ?? ''
      if (detail.kind === 'pdf') openTabPdf(detail.path, root)
      else openTabEditor(detail.path, root)
    }
    window.addEventListener('evo-open-tab', onOpenTab)
    return () => window.removeEventListener('evo-open-tab', onOpenTab)
  }, [])
  // 轨迹面板「查看对话」→ 切回对话标签
  useEffect(() => {
    const onJumpChat = () => { setActiveTabId('chat'); setTabMenuOpen(false) }
    window.addEventListener('evo-traj-jump-chat', onJumpChat)
    return () => window.removeEventListener('evo-traj-jump-chat', onJumpChat)
  }, [])
  // §回溯/编辑重发：chat.ts 派发 evo-rewind → 提升子会话为主聊天 + 打开（编辑场景自动重发）
  useEffect(() => {
    const onRewind = (e: Event) => {
      const detail = (e as CustomEvent<{ childId?: string; resend?: string }>).detail
      if (typeof detail?.childId !== 'string' || detail.childId === '') return
      void (async () => {
        promoteSession(detail.childId)
        const manager = sessionsService?.manager as { mergeSummary?(s: Record<string, unknown>): unknown; refreshList?(): Promise<unknown> } | undefined
        const cwd = current === undefined ? undefined : (sessions.byId[current]?.cwd ?? undefined)
        // 本地合成摘要（对齐 manager.fork 的摘要形状）→ 可立即 select
        try {
          manager?.mergeSummary?.({ sessionId: detail.childId, updatedAt: Date.now(), running: false, blank: false, ...(cwd === undefined ? {} : { cwd }) })
        } catch { /* 摘要合并失败则依赖 refreshList */ }
        // select + 必要时的列表刷新重试（host 侧 fork 的子会话需进入目录）
        for (let i = 0; i < 20; i++) {
          try { sessionsService?.open(detail.childId); break } catch {
            try { await manager?.refreshList?.() } catch { /* 忽略 */ }
            await new Promise((r) => setTimeout(r, 250))
          }
        }
        if (typeof detail.resend === 'string' && detail.resend !== '') {
          // 编辑重发：绑定就绪后以修正文本走官方 prompt 流程
          for (let i = 0; i < 60; i++) {
            const s = sessionsService?.binding(detail.childId)?.session
            if (s !== undefined) {
              void s.prompt([{ type: 'text', text: detail.resend }], 'queue').catch(() => { /* 失败落在 snapshot.promptError */ })
              return
            }
            await new Promise((r) => setTimeout(r, 250))
          }
        }
      })()
    }
    window.addEventListener('evo-rewind', onRewind)
    return () => window.removeEventListener('evo-rewind', onRewind)
  }, [])
  // 编辑标签保存（写入工作区；root 为当前会话 cwd）
  const saveTabEditor = (tab: WorkspaceTab) => {
    if (tab.kind !== 'editor' || tab.filePath === undefined || tab.root === undefined) return
    void fetch('/evoresearch/fs/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: tab.root, path: tab.filePath, text: tab.draft ?? '' }),
    }).then((res) => res.json()).then((json) => {
      if (json.ok === true) toast('Saved', 'success')
      else toast(json.error?.message ?? '保存失败', 'error')
    }).catch(() => { toast('保存失败', 'error') })
  }

  const toggleLanguage = () => {
    setLang(readLang() === 'zh' ? 'en' : 'zh')
    location.reload()
  }
  const sendMessage = (text: string, images?: Array<{ data: string; mediaType: string; name?: string }>) => {
    const normalized = text.trim()
    if (normalized === '') return
    // content 是内容块数组（§23.7 附件：文本 + 图片块），mode 必填（queue = 追加到当前轮次之后）
    const content: Array<{ type: string; text?: string; data?: string; mediaType?: string; name?: string }> = [{ type: 'text', text: normalized }]
    for (const image of images ?? []) content.push({ type: 'image', data: image.data, mediaType: image.mediaType, ...(image.name !== undefined ? { name: image.name } : {}) })
    const effectiveCurrent = current ?? justCreatedSessionRef.current ?? undefined
    const s = effectiveCurrent === undefined ? undefined : sessionsService?.binding(effectiveCurrent)?.session
    if (s !== undefined && effectiveCurrent !== undefined) {
      void s.prompt(content, 'queue').catch(() => { /* 失败落在 snapshot.promptError */ })
      const autoState = readAutoTitleStates()[effectiveCurrent]
      if (autoState !== undefined && !autoState.finalized) {
        rememberAutoTitleInput(effectiveCurrent, autoState.kind, normalized, autoState.workspaceId)
        void applyAutoTitle(effectiveCurrent, autoState.kind, autoState.workspaceId)
      }
      return
    }

    // 欢迎页无活跃会话：左侧项目列表创建新项目；项目内子聊天列表创建该项目的新子聊天。
    // 先判断首条输入是否足以命名，低信息输入仍会进入会话并等待后续输入。
    void (async () => {
      const kind: AutoTitleKind = projectScope === null ? 'project' : 'subchat'
      const initialTitle = await judgeAutoTitle(kind, [normalized], 1)
      let cwd: string | undefined = projectScope?.path
      let workspaceId: string | undefined

      if (kind === 'project') {
        try {
          const res = await fetch('/evoresearch/fs/projects-auto', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ description: initialTitle.title ?? normalized }),
          })
          const json = await res.json()
          if (json.ok === true && typeof json.value?.path === 'string') cwd = json.value.path
        } catch { /* 自动建项目失败时继续尝试空白会话 */ }
      }

      const workspace = cwd === undefined ? null : await ensureWorkspace(cwd)
      if (typeof workspace?.workspaceId === 'string') workspaceId = workspace.workspaceId
      const createOptions = workspaceId !== undefined
        ? { workspaceId }
        : cwd === undefined ? {} : { cwd }
      const id = await sessionsService?.create(createOptions)
      if (id === undefined || id === '') return
      justCreatedSessionRef.current = id
      const states = readAutoTitleStates()
      states[id] = {
        kind,
        inputs: [normalized],
        attempt: 1,
        finalized: false,
        ...(workspaceId === undefined ? {} : { workspaceId }),
      }
      writeAutoTitleStates(states)
      setHomeMode(false)
      sessionsService?.open(id)
      for (let i = 0; i < 30; i++) {
        const created = sessionsService?.binding(id)?.session
        if (created !== undefined) {
          if (initialTitle.title === null) {
            try { await created.rename(kind === 'subchat' ? '新子对话' : '新项目') } catch { /* 占位标题失败不影响消息 */ }
            if (workspaceId !== undefined && kind === 'project') {
              try { await workspacesService?.rename(workspaceId, '新项目') } catch { /* 占位标题失败不影响消息 */ }
            }
          }
          await created.prompt(content, 'queue').catch(() => { /* 失败落在 snapshot.promptError */ })
          const manager = sessionsService?.manager as { refreshList?(): Promise<unknown> } | undefined
          try { await manager?.refreshList?.() } catch { /* 列表刷新失败不影响当前会话 */ }
          if (initialTitle.title !== null && initialTitle.title !== '') await applyAutoTitle(id, kind, workspaceId)
          return
        }
        await new Promise((r) => setTimeout(r, 150))
      }
    })()
  }

  // 从具体用户消息分支：后端按事件 seq 截断 seed，并同时写入 Graph fork anchor。
  const branchFromMessage = (seq: number) => {
    if (current === undefined || cwdNow === null) return
    void fetch('/evoresearch/fs/graph-fork-from-message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceDir: cwdNow, sourceSessionId: current, sourceEventSeq: seq }),
    }).then((res) => res.json()).then(async (json) => {
      if (json.ok !== true || typeof json.value?.sessionId !== 'string') {
        toast(json.error?.message ?? '从消息分支失败', 'error')
        return
      }
      try { await (sessionsService?.manager as { refreshList?(): Promise<unknown> } | undefined)?.refreshList?.() } catch { /* 依赖会话服务下次刷新 */ }
      openSession(json.value.sessionId)
    }).catch(() => toast('从消息分支失败', 'error'))
  }

  const persistPanels = (p: { left: number; right: number }) => {
    setPanels(p)
    try { localStorage.setItem(PANELS_KEY, JSON.stringify(p)) } catch { /* 忽略 */ }
  }

  // 拖拽分隔条（简单实现，参照官方 ui-layout DragHandle 模式）
  const onDragStart = (side: 'left' | 'right') => (e: { pointerId: number; currentTarget: HTMLElement; clientX: number; preventDefault(): void }) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(side)
  }
  const onDragMove = (side: 'left' | 'right') => (e: { currentTarget: HTMLElement; clientX: number }) => {
    if (dragging !== side || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    const frame = frameRef.current
    if (frame === null) return
    const rect = frame.getBoundingClientRect()
    if (side === 'left') {
      const w = Math.min(420, Math.max(200, e.clientX - rect.left))
      persistPanels({ ...panels, left: w })
    } else {
      const w = Math.min(480, Math.max(260, rect.right - e.clientX))
      persistPanels({ ...panels, right: w })
    }
  }
  const onDragEnd = (side: 'left' | 'right') => (e: { currentTarget: HTMLElement; pointerId: number }) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(null)
  }

  return jsxs('div', {
    ref: frameRef,
    className: 'evo-app',
    'data-desktop': desktop || undefined,
    children: [
      jsx(ToastHost, {}),
      // ── 桌面模式：自绘标题栏（替代网页顶栏）；网页模式：普通顶栏 ──
      desktop
        ? jsx(DesktopTitlebar, {
            connected,
            themeDark,
            onHome: startNewChat,
            onToggleSidebar: () => setSidebar((v) => !v),
            onNewChat: startNewChat,
            onSideChats: () => { setInspector(true); setInspectorTab('chats') },
            onToggleTheme: () => { toggleTheme(); setThemeDark(resolvedTheme() === 'dark') },
            onToggleLanguage: toggleLanguage,
            onToggleInspector: toggleInspector,
            onSettings: () => setSettingsOpen(true),
          })
        : jsxs('header', {
        className: 'evo-topbar',
        children: [
          jsxs('div', {
            className: 'evo-topbar-group',
            children: [
              jsx('button', {
                type: 'button',
                className: 'evo-brand-btn',
                onClick: startNewChat,
                title: t('goHome'),
                children: jsxs(Fragment, {
                  children: [
                    jsx('img', { className: 'evo-brand-logo', src: '/favicon.svg', alt: 'EvoResearch', width: 28, height: 28 }),
                    sidebar && jsx('span', { className: 'evo-brand-name', children: 'EvoResearch' }),
                  ],
                }),
              }),
              jsx('button', {
                type: 'button',
                className: 'evo-icon-btn',
                onClick: () => setSidebar((v) => !v),
                title: sidebar ? t('hideNavigation') : t('showNavigation'),
                children: sidebar ? jsx(PanelLeftClose, {}) : jsx(PanelLeft, {}),
              }),
              !sidebar && jsx('button', {
                type: 'button',
                className: 'evo-icon-btn',
                onClick: startNewChat,
                title: t('newChat'),
                children: jsx(SquarePen, {}),
              }),
            ],
          }),
          jsxs('div', {
            className: 'evo-topbar-group',
            children: [
              jsxs('span', {
                style: { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--color-text-tertiary)', padding: '0 8px' },
                title: connected ? t('connected') : t('reconnecting'),
                children: [jsx('span', { style: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block', background: connected ? 'var(--color-success)' : 'var(--color-warning)' } }), jsx('span', { children: connected ? t('connected') : t('reconnecting') })],
              }),
              jsx('button', {
                type: 'button',
                className: 'evo-icon-btn',
                onClick: () => { setInspector(true); setInspectorTab('chats') },
                title: t('sideChats'),
                children: jsx(MessagesSquare, {}),
              }),
              jsx('button', {
                type: 'button',
                className: 'evo-icon-btn',
                onClick: toggleLanguage,
                title: t('language'),
                children: jsx(Languages, {}),
              }),
              jsx('button', {
                type: 'button',
                className: 'evo-icon-btn',
                onClick: () => { toggleTheme(); setThemeDark(resolvedTheme() === 'dark') },
                title: themeDark ? t('switchToLight') : t('switchToDark'),
                children: themeDark ? jsx(Moon, {}) : jsx(Sun, {}),
              }),
              jsx('button', {
                type: 'button',
                className: 'evo-icon-btn',
                onClick: toggleInspector,
                title: inspector ? t('hideInspector') : t('showWorkspace'),
                children: inspector ? jsx(PanelRightClose, {}) : jsx(PanelRight, {}),
              }),
              jsx('button', {
                type: 'button',
                className: 'evo-icon-btn',
                onClick: () => setSettingsOpen(true),
                title: t('settings'),
                children: jsx(Settings, {}),
              }),
            ],
          }),
        ],
      }),
      // ── 三栏 ──
      jsxs('div', {
        className: 'evo-cols',
        'data-narrow': narrow || undefined,
        children: [
          // 响应式抽屉遮罩（§26.1：黑色 40%）
          narrow && sidebar && jsx('div', { className: 'evo-drawer-mask', onClick: () => setSidebar(false) }),
          sidebar && jsxs(Fragment, {
            children: [
              jsx('aside', {
                className: 'evo-left',
                style: narrow ? undefined : { width: panels.left },
                children: jsx(ThreadList, {
                  useSessions,
                  useWorkspaces,
                  view,
                  onView: setViewAndUrl,
                  onOpen: openSession,
                  onNewChat: startNewChat,
                  onProjectModeChange: setProjectScope,
                  hasActive: (sessions.ids ?? []).some((id: string) => sessions.byId[id]?.blank !== true),
                  onRename: renameSession,
                  onRenameProject: renameProject,
                  onForkSideChat: forkSideChat,
                  onCopyHistory: copyHistoryToNewChat,
                  onExport: exportSession,
                  pinnedIds,
                  onTogglePin: togglePin,
                  tagColors,
                  onSetTagColor: setTagColor,
                  projectTagColors,
                  onSetProjectTagColor: setProjectTagColor,
                  hideIds: sideChatIds,
                  deletedIds,
                  onDelete: deleteSession,
                  onDeleteProject: deleteProject,
                  archivedIds,
                  onToggleArchive: toggleArchive,
                  archivedProjects,
                  onToggleProjectArchive: toggleProjectArchive,
                  runningIds,
                  promotedIds,
                }),
              }),
              jsx('div', {
                className: 'evo-resize-handle',
                'data-dragging': dragging === 'left' || undefined,
                onPointerDown: onDragStart('left'),
                onPointerMove: onDragMove('left'),
                onPointerUp: onDragEnd('left'),
              }),
            ],
          }),
          jsx('main', {
            className: 'evo-center',
            children: view !== null
              ? jsx('div', {
                  className: 'evo-view',
                  children: view === 'memory'
                    ? jsx(MemoryPanel, { onOpenThread: openSession })
                    : view === 'schedule'
                      ? jsx(SchedulePanel, { onOpenThread: openSession })
                      : view === 'skills'
                        ? jsx(SkillsPanel, {})
                        : view === 'workspace'
                          ? jsx(WorkspacePanel, {})
                          : view === 'channels'
                            ? jsx(ChannelsPanel, {})
                            : view === 'team'
                              ? jsx(TeamPanel, {})
                              : view === 'experiments'
                                ? jsx(ExperimentsPanel, { cwd: current === undefined ? null : (sessions.byId[current]?.cwd ?? null), sessionId: current ?? null, onOpenSession: openSession })
                                : view === 'notes'
                                  ? jsx(ResearchNotesPanel, { cwd: current === undefined ? null : (sessions.byId[current]?.cwd ?? null) })
                                  : view === 'library'
                                    ? jsx(LibraryPanel, { cwd: current === undefined ? null : (sessions.byId[current]?.cwd ?? null) })
                                    : null,
                })
              : jsxs('div', {
                  className: 'evo-tabwrap',
                  children: [
                    // ── 浏览器式标签栏（§5.2）──
                    jsxs('div', {
                      className: 'evo-tabbar',
                      children: [
                        tabs.map((tab) => jsxs('div', {
                          className: 'evo-tab',
                          'data-active': activeTabId === tab.id || undefined,
                          onClick: () => activateTab(tab.id),
                          children: [
                            jsx('span', { className: 'evo-tab-title', children: tab.title }),
                            (tab.kind === 'pdf' || tab.kind === 'editor') && jsx('button', {
                              type: 'button',
                              className: 'evo-tab-close',
                              title: t('closeTab'),
                              'aria-label': t('closeTab'),
                              onClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); closeTab(tab.id) },
                              children: jsx(X, {}),
                            }),
                          ],
                        }, tab.id)),
                        jsxs('div', {
                          ref: tabNewRef,
                          className: 'evo-tab-new-wrap',
                          children: [
                            jsx('button', {
                              type: 'button',
                              className: 'evo-tab-new',
                              title: t('newTab'),
                              'aria-label': t('newTab'),
                              onClick: toggleTabMenu,
                              children: jsx(Plus, {}),
                            }),
                            tabMenuOpen && jsxs('div', {
                              className: 'evo-tab-menu',
                              style: tabMenuPos ?? undefined,
                              children: [
                                // 从工作区打开（懒加载目录树）
                                jsx('button', {
                                  type: 'button',
                                  className: 'evo-tab-menu-item',
                                  disabled: cwdNow === null || tabBusy,
                                  onClick: () => setTabPickerOpen((v) => !v),
                                  children: jsxs(Fragment, { children: [jsx(FolderOpen, {}), jsx('span', { children: t('openFromWorkspace') })] }),
                                }),
                                tabPickerOpen && cwdNow !== null && jsx(WorkspaceTabPicker, { root: cwdNow, onPick: pickWorkspaceFile }),
                                cwdNow !== null && jsx('div', { className: 'evo-tab-menu-hint evo-tab-menu-help', children: t('workspaceTabHelp') }),
                                // 本地上传 PDF → 预览标签
                                jsx('button', {
                                  type: 'button',
                                  className: 'evo-tab-menu-item',
                                  disabled: cwdNow === null || tabBusy,
                                  onClick: () => tabFileInputRef.current?.click(),
                                  children: jsxs(Fragment, { children: [jsx(FileText, {}), jsx('span', { children: t('openPdfTab') })] }),
                                }),
                                jsx('input', {
                                  ref: tabFileInputRef,
                                  type: 'file',
                                  accept: 'application/pdf,.pdf',
                                  hidden: true,
                                  onChange: (e) => {
                                    const file = e.currentTarget.files?.[0]
                                    if (file !== undefined) { uploadPdfTab(cwdNow ?? '', file); closeTabMenu() }
                                    e.currentTarget.value = ''
                                  },
                                }),
                                // 新建文本文件
                                jsxs('div', {
                                  className: 'evo-tab-menu-item evo-tab-menu-newfile',
                                  children: [
                                    jsx(FileCode2, {}),
                                    jsx('input', {
                                      type: 'text',
                                      className: 'evo-tab-newfile-input',
                                      placeholder: t('newFileName'),
                                      value: newFileName,
                                      disabled: tabBusy || cwdNow === null,
                                      onInput: (e) => setNewFileName(e.currentTarget.value),
                                      onKeyDown: (e) => {
                                        if (e.key === 'Enter' && cwdNow !== null) { createTabEditor(cwdNow); closeTabMenu() }
                                      },
                                    }),
                                    jsx('button', {
                                      type: 'button',
                                      className: 'evo-tab-newfile-go',
                                      disabled: tabBusy || newFileName.trim() === '' || cwdNow === null,
                                      onClick: () => { if (cwdNow !== null) { createTabEditor(cwdNow); closeTabMenu() } },
                                      children: t('newFileCreate'),
                                    }),
                                  ],
                                }),
                                cwdNow === null && jsx('div', { className: 'evo-tab-menu-hint', children: t('openSessionHint') }),
                              ],
                            }),
                          ],
                        }),
                      ],
                    }),
                    // ── 标签内容 ──
                    (() => {
                      const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
                      if (activeTab === undefined) return null
                      if (activeTab.kind === 'trajectory') {
                        return jsx(TrajectoryPanel, { session: sessionObj })
                      }
                      if (activeTab.kind === 'chatgraph') {
                        // Chat Graph：右键新建/连线，双击 chat 节点打开会话（并切回对话标签）
                        return jsx(ChatGraphPanel, {
                          cwd: current === undefined ? null : (sessions.byId[current]?.cwd ?? null),
                          currentSessionId: current ?? null,
                          onOpenSession: (id: string) => {
                            openSession(id)
                            setActiveTabId('chat')
                          },
                          onCreateSession: async () => {
                            const cwdNow = current === undefined ? undefined : (sessions.byId[current]?.cwd ?? undefined)
                            try {
                              const id = await sessionsService?.create(cwdNow === undefined ? {} : { cwd: cwdNow })
                              return typeof id === 'string' && id !== '' ? id : null
                            } catch {
                              return null
                            }
                          },
                        })
                      }
                      if (activeTab.kind === 'pdf' && activeTab.filePath !== undefined) {
                        return jsx('div', {
                          className: 'evo-tab-body',
                          children: jsx('iframe', {
                            className: 'evo-tab-frame',
                            src: `/evoresearch/fs/file?path=${encodeURIComponent(activeTab.filePath)}`,
                            title: activeTab.title,
                            sandbox: '',
                          }),
                        })
                      }
                      if (activeTab.kind === 'editor' && activeTab.filePath !== undefined) {
                        return jsxs('div', {
                          className: 'evo-tab-body evo-tab-editor-body',
                          children: [
                            jsxs('div', {
                              className: 'evo-tab-editor-head',
                              children: [
                                jsx('span', { className: 'evo-tab-editor-path', children: activeTab.filePath }),
                                jsx('span', { style: { flex: 1 } }),
                                jsx('button', {
                                  type: 'button',
                                  className: 'evo-btn evo-btn-run',
                                  onClick: () => saveTabEditor(activeTab),
                                  children: jsxs(Fragment, { children: [jsx(Save, {}), jsx('span', { children: t('save') })] }),
                                }),
                              ],
                            }),
                            jsx('textarea', {
                              className: 'evo-tab-editor',
                              value: activeTab.draft ?? '',
                              spellCheck: false,
                              onInput: (e) => updateTabDraft(activeTab.id, e.currentTarget.value),
                              onKeyDown: (e) => {
                                if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveTabEditor(activeTab) }
                              },
                            }),
                          ],
                        })
                      }
                      return jsx(ChatArea, {
                        nodes,
                        partial,
                        running,
                        error: promptError,
                        currentTitle,
                        sessionId: current ?? null,
                        session: sessionObj,
                        cwd: cwdNow,
                        jobs: currentJobs,
                        onOpenThread: openSession,
                        onBranchFromMessage: branchFromMessage,
                        onSend: sendMessage,
                      })
                    })(),
                  ],
                }),
          }),
          inspector && jsxs(Fragment, {
            children: [
              narrow && jsx('div', { className: 'evo-drawer-mask', onClick: () => setInspector(false) }),
              jsx('div', {
                className: 'evo-resize-handle evo-resize-right',
                'data-dragging': dragging === 'right' || undefined,
                onPointerDown: onDragStart('right'),
                onPointerMove: onDragMove('right'),
                onPointerUp: onDragEnd('right'),
              }),
              jsx('aside', {
                className: 'evo-right',
                style: narrow ? undefined : { width: panels.right },
                children: jsx(Inspector, {
                  tab: inspectorTab,
                  onTab: setInspectorTabUrl,
                  onClose: () => setInspector(false),
                  cwd: current === undefined ? null : (sessions.byId[current]?.cwd ?? null),
                  sessionId: current ?? null,
                  sideChats,
                  onNewSideChat: newSideChat,
                  onOpenSideChat: openSession,
                  onDeleteSideChat: deleteSession,
                }),
              }),
            ],
          }),
          settingsOpen && jsx(SettingsDialog, {
            onClose: () => setSettingsOpen(false),
          }),
        ],
      }),
    ],
  })
}

/** 客户端插件主体。 */
function apply(ctx: any) {
  installCss()
  applyTheme()
  registerConversation(ctx)
  ctx.effect(() => {
    sessionsService = ctx.sessions ?? null
    workspacesService = ctx.workspaces ?? null
    // 调试钩子：浏览器控制台可访问会话服务（开发诊断用）
    ;(window as any).__evoresearch = { sessions: sessionsService }
    // 连接状态源：快照存在 = 已握手；断连/重连经 subscribe 通知 UI。
    connectionSource = ctx.get('connection')?.hostDescription ?? null
    const disposeService = ctx.reflect.provide('layout', {
      toggleSidebar() {},
      openDetails() {},
      closeDetails() {},
    })
    const disposeRegistration = ctx.slots.register({ name: 'root' }, (props: any) => jsx(ErrorBoundary, { children: jsx(EvoFrame, props) }))
    return () => {
      disposeRegistration()
      disposeService()
      connectionSource = null
      sessionsService = null
      workspacesService = null
    }
  }, 'evoresearch-ui: layout 服务 + root 注册')
}

export { apply, inject }
