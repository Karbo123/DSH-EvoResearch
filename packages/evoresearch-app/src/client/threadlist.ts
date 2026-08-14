/**
 * 左侧栏（会话历史）：
 * 标题 + New Chat + 导航菜单（Import Project / Research Skills / EvoMemory /
 * Scheduled）+ 搜索框 + Recents 会话列表。
 * 数据来自 framework kit 的 useSessions（DSH client-runtime 镜像）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState } from 'react'
import { FolderGit2, GraduationCap, BrainCircuit, Clock, SquarePen, Search, MessageSquare } from 'lucide-react'
import { t } from './i18n'

/** 导航视图（点击菜单项切换中间面板；None = 聊天）。 */
export type SideView = null | 'skills' | 'memory' | 'schedule' | 'workspace'

const MENU = [
  { key: 'import', label: t('importProject'), icon: FolderGit2 },
  { key: 'skills', label: t('researchSkills'), icon: GraduationCap },
  { key: 'memory', label: t('evomemory'), icon: BrainCircuit },
  { key: 'schedule', label: t('scheduled'), icon: Clock },
] as const

/**
 * 会话行时间格式化（简化：显示"刚刚/分钟前"或短日期）。
 */
function formatWhen(iso: string | undefined): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export interface ThreadListProps {
  /** framework kit 注入 */
  useSessions: (selector: (s: any) => any) => any
  view: SideView
  onView: (v: SideView) => void
  /** 打开（选中）一个会话 */
  onOpen: (id: string) => void
  onNewChat: () => void
  /** 是否有活跃（非 blank）会话 */
  hasActive: boolean
}

export function ThreadList({ useSessions, view, onView, onOpen, onNewChat, hasActive }: ThreadListProps) {
  const sessions = useSessions((s) => s)
  const currentId = sessions.current
  const rows = (sessions.ids ?? []).map((id) => sessions.byId[id]).filter((s) => s !== undefined && s.blank !== true)
  const [query, setQuery] = useState('')

  // 搜索过滤（本地状态；组件内 useState）
  const results = query.trim()
    ? rows.filter((s) => (s.displayTitle ?? '').toLowerCase().includes(query.trim().toLowerCase()))
    : rows

  const isActive = (key: string) =>
    (key === 'skills' && view === 'skills') ||
    (key === 'memory' && view === 'memory') ||
    (key === 'schedule' && view === 'schedule') ||
    (key === 'import' && view === 'workspace')

  return jsxs('div', {
    className: 'evo-tl',
    children: [
      jsxs('div', {
        className: 'evo-tl-head',
        children: [
          jsxs('div', {
            className: 'evo-tl-title',
            children: [
              jsx('img', { className: 'evo-brand-logo', src: '/favicon.svg', alt: 'EvoResearch', width: 28, height: 28 }),
              jsx('div', { className: 'evo-tl-title-name', children: 'EvoResearch' }),
            ],
          }),
          jsx('button', {
            type: 'button',
            className: 'evo-tl-newchat',
            onClick: onNewChat,
            children: jsxs(Fragment, {
              children: [jsx(SquarePen, {}), jsx('span', { children: t('newChat') })],
            }),
          }),
        ],
      }),
      jsx('nav', {
        className: 'evo-tl-menu',
        children: MENU.map((item) => {
          const Icon = item.icon
          return jsx('button', {
            type: 'button',
            className: 'evo-tl-item',
            'data-active': isActive(item.key) || undefined,
            onClick: () => onView(item.key === 'import' ? 'workspace' : (item.key as SideView)),
            children: jsxs(Fragment, { children: [jsx(Icon, {}), jsx('span', { children: item.label })] }),
          }, item.key)
        }),
      }),
      jsxs('div', {
        className: 'evo-tl-search',
        children: [
          jsx(Search, {}),
          jsx('input', {
            type: 'text',
            placeholder: t('searchResearch'),
            value: query,
            onInput: (e) => setQuery(e.currentTarget.value),
          }),
        ],
      }),
      jsxs('div', {
        className: 'evo-tl-body',
        children: [
          jsxs('div', {
            className: 'evo-tl-section',
            children: [
              jsx('span', { className: 'evo-tl-section-title', children: t('recents') }),
            ],
          }),
          results.length === 0
            ? jsxs('div', {
                className: 'evo-tl-empty',
                children: [
                  jsx(MessageSquare, {}),
                  jsx('div', { children: hasActive ? t('noMatchingResearch') : t('noResearchYet') }),
                ],
              })
            : results.map((s) => jsx('button', {
                type: 'button',
                className: 'evo-tl-row',
                'data-active': s.id === currentId || undefined,
                onClick: () => onOpen(s.id),
                children: jsxs(Fragment, {
                  children: [
                    jsx('div', { className: 'evo-tl-row-title', children: s.displayTitle ?? s.id.slice(0, 12) }),
                    jsx('div', { className: 'evo-tl-row-sub', children: formatWhen(s.titleTime ?? s.updatedAt) }),
                  ],
                }),
              }, s.id)),
        ],
      }),
    ],
  })
}
