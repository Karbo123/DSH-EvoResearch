/**
 * EvoResearch 工作台（browser half）—— 阶段 1：视觉复刻 EvoScientist WebUI。
 *
 * 结构（对照 WebUI page.tsx）：
 * - 顶栏：品牌 + 侧栏/新建 + 右侧（连接状态 / Side chats / 语言 / 主题 /
 *   inspector / 设置）；
 * - 三栏：左 ThreadList（会话历史）、中 Chat（欢迎页 + 输入面板）、
 *   右 Inspector（Workspace / Agents / Side chats）；
 * - 默认与 WebUI 一致：侧栏与 inspector 收起，仅顶栏 + 中间。
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
import { applyTheme, resolvedTheme, toggleTheme } from './theme'
import { ThreadList, type SideView } from './threadlist'
import { ChatArea, type ChatNode } from './chat'
import { Inspector, type InspectorTab } from './inspector'
import { registerConversation } from './conversation'

const inject = ['slots', 'sessions', 'conversationEvents', 'conversationViews']

/** 插件激活时由 apply 写入的会话服务（组件经闭包使用）。 */
let sessionsService: {
  open(id: string): void
  binding(id: string): { session: any } | undefined
  create(opts?: { cwd?: string; workspaceId?: string }): Promise<string>
} | null = null

/** 注入样式（data-plugin-css 模式，可被 HMR 清理）。 */
function installCss() {
  const tagId = '@evoresearch/dsh-app/workspace.css'
  if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${tagId}"]`) === null) {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@evoresearch/dsh-app'
    tag.dataset.pluginCss = tagId
    tag.textContent = CSS
    document.head.appendChild(tag)
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
  const frameRef = useRef<HTMLDivElement | null>(null)

  // 主题：初始化 + 跟随系统变化（pref=system 时）
  useEffect(() => {
    applyTheme()
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

  const openSession = (id: string) => { sessionsService?.open(id) }
  const startNewChat = () => {
    setView(null)
    // 创建空白会话并打开（host 侧默认工作目录；目录选择接入后经 pickDirectory）
    void sessionsService?.create({}).then((id) => sessionsService?.open(id))
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
    children: [
      // ── 顶栏 ──
      jsxs('header', {
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
                title: 'New chat',
                children: jsx(SquarePen, {}),
              }),
            ],
          }),
          jsxs('div', {
            className: 'evo-topbar-group',
            children: [
              jsxs('span', {
                style: { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--color-text-tertiary)', padding: '0 8px' },
                children: [jsx('span', { style: { width: 8, height: 8, borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block' } }), jsx('span', { children: 'Connected' })],
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
                title: 'Language',
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
                title: 'Settings',
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
                  children: jsxs('div', {
                    className: 'evo-insp-empty',
                    children: [
                      jsx('div', { children: `View: ${view}` }),
                      jsx('div', { children: '（阶段 2 接入：Skills / EvoMemory / Scheduled 面板）' }),
                    ],
                  }),
                })
              : jsx(ChatArea, {
                  nodes,
                  partial,
                  running,
                  error: promptError,
                  currentTitle,
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
                  workspaceName: null,
                }),
              }),
            ],
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
    const disposeService = ctx.reflect.provide('layout', {
      toggleSidebar() {},
      openDetails() {},
      closeDetails() {},
    })
    const disposeRegistration = ctx.slots.register({ name: 'root' }, EvoFrame)
    return () => {
      disposeRegistration()
      disposeService()
      sessionsService = null
    }
  }, 'evoresearch-ui: layout 服务 + root 注册')
}

export { apply, inject }
