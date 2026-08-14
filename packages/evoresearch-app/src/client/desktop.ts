/**
 * 桌面版自绘标题栏（无边框窗口）—— 视觉与交互规范：
 *
 * - 36px 高，fixed top；深色 #18181b/#3f3f46/#d4d4d8，浅色 #f4f4f5/#e4e4e7/#52525b
 * - 左：品牌（R logo + 名称，点击回首页）
 * - 左组（tools）：sidebar、new-chat
 * - 右组（actions）：health 状态、side-chats、language、theme、inspector、settings
 * - 最右（controls）：最小化 / 最大化(还原) / 关闭（hover 红 #e81123）
 * - 空白区拖拽移动窗口（阈值后调 Tauri start_dragging），双击最大化
 *
 * 实现说明：标题栏与网页顶栏是同一 React 应用，直接调用同一批 handler。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'

const TB_ICONS = {
  sidebar: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 4v16" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`,
  'new-chat': `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m14 5 5 5M12 12l7.5-7.5a1.4 1.4 0 0 1 2 2L14 14l-4 1 1-4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  'side-chats': `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 17v3l4-3M10 10h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-2v3l-4-3h-4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  language: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h10M9 3v2M6 9c2 3 5 5 8 6M13 7c-1 4-4 7-8 9M15 12h5M17.5 10l4 10M14 20l3.5-10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  theme: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.5A8 8 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  inspector: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15 4v16" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.3V9.6h.1A1.7 1.7 0 0 0 4.1 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.56 3.7l.06.06A1.7 1.7 0 0 0 8.5 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.3h4.04v.1A1.7 1.7 0 0 0 15 4.1a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8.5a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4.04h-.1A1.7 1.7 0 0 0 19.4 15Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
}

const MIN_ICON = `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`
const MAX_ICON = `<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true"><rect x="2" y="2" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`
const RESTORE_ICON = `<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true"><rect x="2.5" y="3.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4.5 3.5v-1.5h6v6h-1.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`
const CLOSE_ICON = `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`

/** 调用 Tauri 窗口命令（浏览器环境静默失败）。 */
function callWindow(method: string): void {
  try {
    const tauri = (window as any).__TAURI__
    if (tauri?.core?.invoke) void tauri.core.invoke(method)
  } catch { /* 浏览器环境 */ }
}

const DRAG_THRESHOLD = 4

/** 标题栏 JS 拖拽（阈值后调 Tauri start_dragging）。 */
function useTitlebarDrag(): { onPointerDown(e: PointerEvent): void } {
  let state: { pointerId: number; startX: number; startY: number; active: boolean } | null = null

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.evo-tb-tools, .evo-tb-actions, .evo-tb-controls, .evo-tb-brand')) return
    state = { pointerId: e.pointerId, startX: e.screenX, startY: e.screenY, active: false }
  }

  window.addEventListener('pointermove', (e: PointerEvent) => {
    if (!state || state.pointerId !== e.pointerId) return
    if (!state.active) {
      const dx = e.screenX - state.startX
      const dy = e.screenY - state.startY
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      state.active = true
      e.preventDefault()
      callWindow('window_start_drag') // OS 接管拖动
    }
  })
  window.addEventListener('pointerup', () => { state = null })
  window.addEventListener('pointercancel', () => { state = null })

  return { onPointerDown }
}

export interface DesktopTitlebarProps {
  connected: boolean
  themeDark: boolean
  onHome: () => void
  onToggleSidebar: () => void
  onNewChat: () => void
  onSideChats: () => void
  onToggleTheme: () => void
  onToggleInspector: () => void
  onSettings: () => void
}

/** 36px 自绘标题栏（无边框窗口）。 */
export function DesktopTitlebar(props: DesktopTitlebarProps) {
  const { connected, themeDark, onHome, onToggleSidebar, onNewChat, onSideChats, onToggleTheme, onToggleInspector, onSettings } = props
  const { onPointerDown } = useTitlebarDrag()

  const icon = (name: keyof typeof TB_ICONS, title: string, onClick: () => void) =>
    jsx('button', {
      type: 'button',
      className: 'evo-tb-btn',
      title,
      'aria-label': title,
      dangerouslySetInnerHTML: { __html: TB_ICONS[name] },
      onClick: (e: { preventDefault(): void; stopPropagation(): void }) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      },
    }, title)

  return jsxs('div', {
    className: 'evo-tb',
    onPointerDown: onPointerDown as any,
    onDoubleClick: () => callWindow('window_toggle_maximize'),
    children: [
      jsx('button', {
        type: 'button',
        className: 'evo-tb-brand',
        title: 'Home',
        'aria-label': 'Home',
        onClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); onHome() },
        children: jsxs(Fragment, {
          children: [
            jsx('img', { src: '/favicon.svg', width: 20, height: 20, style: { borderRadius: 5, boxShadow: '0 1px 3px rgba(0,0,0,.2)' }, alt: 'EvoResearch' }),
            jsx('span', { children: 'EvoResearch' }),
          ],
        }),
      }),
      jsxs('div', {
        className: 'evo-tb-tools',
        children: [
          icon('sidebar', 'Show navigation', onToggleSidebar),
          icon('new-chat', 'New chat', onNewChat),
        ],
      }),
      jsxs('div', {
        className: 'evo-tb-actions',
        children: [
          jsx('button', {
            type: 'button',
            className: 'evo-tb-btn evo-tb-health',
            title: connected ? 'Connected' : 'Offline',
            onClick: (e: { preventDefault(): void; stopPropagation(): void }) => { e.preventDefault(); e.stopPropagation() },
            children: jsxs(Fragment, {
              children: [
                jsx('span', { className: `evo-tb-dot${connected ? '' : ' disconnected'}` }),
                jsx('span', { children: connected ? 'Connected' : 'Offline' }),
              ],
            }),
          }),
          icon('side-chats', 'Side chats', onSideChats),
          icon('language', 'Language', () => {}),
          icon('theme', themeDark ? 'Switch to light mode' : 'Switch to dark mode', onToggleTheme),
          icon('inspector', 'Show workspace', onToggleInspector),
          icon('settings', 'Settings', onSettings),
        ],
      }),
      jsxs('div', {
        className: 'evo-tb-controls',
        children: [
          jsx('button', {
            type: 'button',
            className: 'evo-tb-win evo-tb-min',
            title: 'Minimize',
            'aria-label': 'Minimize',
            dangerouslySetInnerHTML: { __html: MIN_ICON },
            onClick: () => callWindow('window_minimize'),
          }),
          jsx('button', {
            type: 'button',
            className: 'evo-tb-win evo-tb-max',
            title: 'Maximize',
            'aria-label': 'Maximize',
            dangerouslySetInnerHTML: { __html: MAX_ICON },
            onClick: () => callWindow('window_toggle_maximize'),
          }),
          jsx('button', {
            type: 'button',
            className: 'evo-tb-win evo-tb-close',
            title: 'Close',
            'aria-label': 'Close',
            dangerouslySetInnerHTML: { __html: CLOSE_ICON },
            onClick: () => callWindow('window_close'),
          }),
        ],
      }),
    ],
  })
}
