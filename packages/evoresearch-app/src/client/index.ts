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
import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import {
  PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, SquarePen,
  MessagesSquare, Moon, Sun, Settings, Languages,
} from 'lucide-react'
import { CSS } from './styles'
import { KATEX_CSS } from './katex-css'
import { applyTheme, resolvedTheme, toggleTheme } from './theme'
import { ThreadList, type SideView } from './threadlist'
import { ChatArea, type ChatNode } from './chat'
import { Inspector, type InspectorTab } from './inspector'
import { registerConversation } from './conversation'
import { DesktopTitlebar } from './desktop'
import { SettingsDialog } from './settings'
import { t, readLang, setLang } from './i18n'
import { MemoryPanel, SchedulePanel, SkillsPanel, WorkspacePanel, ChannelsPanel, TeamPanel } from './panels'

const inject = ['slots', 'sessions', 'conversationEvents', 'conversationViews', 'connection']

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

function readPanels(): { left: number; right: number } {
  try {
    const v = JSON.parse(localStorage.getItem(PANELS_KEY) ?? '')
    if (typeof v.left === 'number' && typeof v.right === 'number') return v
  } catch { /* 默认值 */ }
  return { left: 264, right: 320 }
}

/** 会话当前标题（byId[current]）。 */
function currentTitleOf(sessions: any): string | null {
  const id = sessions.current
  if (id === undefined) return null
  const s = sessions.byId[id]
  return s === undefined ? null : (s.displayTitle ?? id.slice(0, 12))
}

/** 工作台根组件（root slot）。 */
function EvoFrame({ useSessions, useWorkspaces }: { useSessions: any; useWorkspaces: any }) {
  const sessions = useSessions((s) => s)
  const workspaces = useWorkspaces((w) => w)
  const [sidebar, setSidebar] = useState(() => typeof window !== 'undefined' ? new URLSearchParams(location.search).get('sidebar') === '1' : false)
  const [inspector, setInspector] = useState(() => typeof window !== 'undefined' ? new URLSearchParams(location.search).get('inspector') === '1' : false)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('workspace')
  const [view, setView] = useState<SideView>(null)
  const [themeDark, setThemeDark] = useState(() => resolvedTheme() === 'dark')
  const [panels, setPanels] = useState(readPanels)
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const desktop = isDesktop()

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

  const current = sessions.current
  const currentTitle = currentTitleOf(sessions)
  const running = current !== undefined && sessions.byId[current]?.running === true

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
  const nodes: ChatNode[] = (chatLegacy?.nodes ?? []).filter((n: any) => n !== null && n.visibility === 'visible')
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

  const openSession = (id: string) => { sessionsService?.open(id) }
  const startNewChat = () => {
    setView(null)
    // 创建空白会话并打开（host 侧默认工作目录；目录选择接入后经 pickDirectory）
    void sessionsService?.create({}).then((id) => sessionsService?.open(id))
  }

  // ── Recents 操作（§26.3）与 Side Chat（§22.3）──
  const renameSession = async (id: string, title: string): Promise<boolean> => {
    if (title === '') return false
    const session = sessionsService?.binding(id)?.session
    if (session?.rename === undefined) return false
    const result = await session.rename(title)
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
    if (s !== undefined) for (const sc of readSideChats(s.cwd ?? null)) sideChatIds.add(sc)
  }
  const sideChats: Array<{ id: string; title: string; kind: 'fork' | 'blank' }> = (sessions.ids ?? [])
    .map((id) => sessions.byId[id])
    .filter((s) => s !== undefined && s.cwd === cwdNow)
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
  const toggleLanguage = () => {
    setLang(readLang() === 'zh' ? 'en' : 'zh')
    location.reload()
  }
  const sendMessage = (text: string) => {
    const s = current === undefined ? undefined : sessionsService?.binding(current)?.session
    if (s === undefined || text.trim() === '') return
    // content 是内容块数组，mode 必填（queue = 追加到当前轮次之后）
    void s.prompt([{ type: 'text', text }], 'queue').catch(() => { /* 失败落在 snapshot.promptError */ })
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
            onToggleInspector: () => setInspector((v) => !v),
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
                title: 'Go to home',
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
                title: sidebar ? 'Hide navigation' : 'Show navigation',
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
                title: connected ? 'Connected' : 'Reconnecting',
                children: [jsx('span', { style: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block', background: connected ? 'var(--color-success)' : 'var(--color-warning)' } }), jsx('span', { children: connected ? 'Connected' : 'Reconnecting' })],
              }),
              jsx('button', {
                type: 'button',
                className: 'evo-icon-btn',
                onClick: () => { setInspector(true); setInspectorTab('chats') },
                title: 'Side chats',
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
                title: themeDark ? 'Switch to light mode' : 'Switch to dark mode',
                children: themeDark ? jsx(Moon, {}) : jsx(Sun, {}),
              }),
              jsx('button', {
                type: 'button',
                className: 'evo-icon-btn',
                onClick: () => setInspector((v) => !v),
                title: inspector ? 'Hide inspector' : 'Show workspace',
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
        children: [
          sidebar && jsxs(Fragment, {
            children: [
              jsx('aside', {
                className: 'evo-left',
                style: { width: panels.left },
                children: jsx(ThreadList, {
                  useSessions,
                  view,
                  onView: setView,
                  onOpen: openSession,
                  onNewChat: startNewChat,
                  hasActive: (sessions.ids ?? []).some((id: string) => sessions.byId[id]?.blank !== true),
                  onRename: renameSession,
                  onForkSideChat: forkSideChat,
                  hideIds: sideChatIds,
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
                    ? jsx(MemoryPanel, {})
                    : view === 'schedule'
                      ? jsx(SchedulePanel, {})
                      : view === 'skills'
                        ? jsx(SkillsPanel, {})
                        : view === 'workspace'
                          ? jsx(WorkspacePanel, {})
                          : view === 'channels'
                            ? jsx(ChannelsPanel, {})
                            : view === 'team'
                              ? jsx(TeamPanel, {})
                              : null,
                })
              : jsx(ChatArea, {
                  nodes,
                  partial,
                  running,
                  error: promptError,
                  currentTitle,
                  sessionId: current ?? null,
                  session: sessionObj,
                  cwd: current === undefined ? null : (sessions.byId[current]?.cwd ?? null),
                  onOpenThread: openSession,
                  onSend: sendMessage,
                }),
          }),
          inspector && jsxs(Fragment, {
            children: [
              jsx('div', {
                className: 'evo-resize-handle',
                'data-dragging': dragging === 'right' || undefined,
                onPointerDown: onDragStart('right'),
                onPointerMove: onDragMove('right'),
                onPointerUp: onDragEnd('right'),
              }),
              jsx('aside', {
                className: 'evo-right',
                style: { width: panels.right },
                children: jsx(Inspector, {
                  tab: inspectorTab,
                  onTab: setInspectorTab,
                  onClose: () => setInspector(false),
                  cwd: current === undefined ? null : (sessions.byId[current]?.cwd ?? null),
                  sessionId: current ?? null,
                  sideChats,
                  onNewSideChat: newSideChat,
                  onOpenSideChat: openSession,
                }),
              }),
            ],
          }),
          settingsOpen && jsx(SettingsDialog, {
            onClose: () => setSettingsOpen(false),
            sessionId: current ?? null,
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
    // 调试钩子：浏览器控制台可访问会话服务（开发诊断用）
    ;(window as any).__evoresearch = { sessions: sessionsService }
    // 连接状态源：快照存在 = 已握手；断连/重连经 subscribe 通知 UI。
    connectionSource = ctx.get('connection')?.hostDescription ?? null
    const disposeService = ctx.reflect.provide('layout', {
      toggleSidebar() {},
      openDetails() {},
      closeDetails() {},
    })
    const disposeRegistration = ctx.slots.register({ name: 'root' }, EvoFrame)
    return () => {
      disposeRegistration()
      disposeService()
      connectionSource = null
      sessionsService = null
    }
  }, 'evoresearch-ui: layout 服务 + root 注册')
}

export { apply, inject }
