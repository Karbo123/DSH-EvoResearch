/**
 * 左侧栏（会话历史）：
 * 标题 + New Chat + 导航菜单（Import Project / Research Skills / EvoMemory /
 * Scheduled）+ 搜索框 + Recents 会话列表。
 * 数据来自 framework kit 的 useSessions（DSH client-runtime 镜像）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState } from 'react'
import { FolderGit2, GraduationCap, BrainCircuit, Clock, Cable, Users, SquarePen, Search, MessageSquare, MessagesSquare, Pencil, Check } from 'lucide-react'
import { t } from './i18n'

/** 导航视图（点击菜单项切换中间面板；None = 聊天）。 */
export type SideView = null | 'skills' | 'memory' | 'schedule' | 'workspace' | 'channels' | 'team'

const MENU = [
  { key: 'import', label: t('importProject'), icon: FolderGit2 },
  { key: 'skills', label: t('researchSkills'), icon: GraduationCap },
  { key: 'memory', label: t('evomemory'), icon: BrainCircuit },
  { key: 'schedule', label: t('scheduled'), icon: Clock },
  { key: 'channels', label: t('channels'), icon: Cable },
  { key: 'team', label: t('team'), icon: Users },
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
  /** 重命名会话（官方 session.rename；返回是否成功）。 */
  onRename: (id: string, title: string) => Promise<boolean>
  /** 以某会话为起点创建继承型 Side Chat（官方 session.fork；返回结果）。 */
  onForkSideChat: (id: string) => Promise<{ ok: boolean; id?: string; error?: string }>
  /** 应从 Recents 隐藏的会话 id（侧聊/内部线程，§22.1）。 */
  hideIds: Set<string>
}

export function ThreadList({ useSessions, view, onView, onOpen, onNewChat, hasActive, onRename, onForkSideChat, hideIds }: ThreadListProps) {
  const sessions = useSessions((s) => s)
  const currentId = sessions.current
  // Recents 只列主 Agent 线程（§22.1：fork 子线程与内部线程不得混入普通列表）
  const rows = (sessions.ids ?? [])
    .map((id) => sessions.byId[id])
    .filter((s) => s !== undefined && s.blank !== true && s.parentSessionId === undefined && !hideIds.has(s.id))
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [forkError, setForkError] = useState<string | null>(null)

  const forkRow = (id: string) => {
    setForkError(null)
    void onForkSideChat(id).then((result) => {
      if (result.ok && result.id !== undefined) { onOpen(result.id); return }
      setForkError(result.error ?? 'Side chat 创建失败')
      setTimeout(() => setForkError(null), 5000)
    })
  }

  // 搜索过滤（本地状态；组件内 useState）
  const results = query.trim()
    ? rows.filter((s) => (s.displayTitle ?? '').toLowerCase().includes(query.trim().toLowerCase()))
    : rows

  const isActive = (key: string) =>
    (key === 'skills' && view === 'skills') ||
    (key === 'memory' && view === 'memory') ||
    (key === 'schedule' && view === 'schedule') ||
    (key === 'channels' && view === 'channels') ||
    (key === 'team' && view === 'team') ||
    (key === 'import' && view === 'workspace')

  return jsxs('div', {
    className: 'evo-tl',
    children: [
      jsxs('div', {
        className: 'evo-tl-head',
        children: [
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
              forkError !== null && jsx('span', { className: 'evo-tl-fork-error', children: forkError }),
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
            : results.map((s) => {
                if (renaming === s.id) {
                  return jsxs('div', {
                    className: 'evo-tl-row evo-tl-rename',
                    children: [
                      jsx('input', {
                        type: 'text',
                        className: 'evo-tl-rename-input',
                        value: renameValue,
                        autoFocus: true,
                        placeholder: 'Rename session',
                        onInput: (e) => setRenameValue(e.currentTarget.value),
                        onKeyDown: (e) => {
                          if (e.key === 'Enter') {
                            void onRename(s.id, renameValue.trim()).then((ok) => { if (ok) setRenaming(null) })
                          }
                          if (e.key === 'Escape') setRenaming(null)
                        },
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'evo-tl-row-act',
                        title: 'Save',
                        'aria-label': 'Save',
                        onClick: () => { void onRename(s.id, renameValue.trim()).then((ok) => { if (ok) setRenaming(null) }) },
                        children: jsx(Check, {}),
                      }),
                    ],
                  }, s.id)
                }
                return jsxs('div', {
                  className: 'evo-tl-row',
                  'data-active': s.id === currentId || undefined,
                  children: [
                    jsx('button', {
                      type: 'button',
                      className: 'evo-tl-row-main',
                      onClick: () => onOpen(s.id),
                      children: jsxs(Fragment, {
                        children: [
                          jsx('div', { className: 'evo-tl-row-title', children: s.displayTitle ?? s.id.slice(0, 12) }),
                          jsx('div', { className: 'evo-tl-row-sub', children: formatWhen(s.titleTime ?? s.updatedAt) }),
                        ],
                      }),
                    }),
                    jsx('div', {
                      className: 'evo-tl-row-acts',
                      children: [
                        jsx('button', {
                          type: 'button',
                          className: 'evo-tl-row-act',
                          title: 'Rename',
                          'aria-label': 'Rename',
                          onClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); setRenameValue(s.displayTitle ?? ''); setRenaming(s.id) },
                          children: jsx(Pencil, {}),
                        }),
                        jsx('button', {
                          type: 'button',
                          className: 'evo-tl-row-act',
                          title: 'Side chat from this session',
                          'aria-label': 'Side chat',
                          onClick: (e: { stopPropagation(): void }) => {
                            e.stopPropagation()
                            forkRow(s.id)
                          },
                          children: jsx(MessagesSquare, {}),
                        }),
                      ],
                    }),
                  ],
                }, s.id)
              }),
        ],
      }),
    ],
  })
}
