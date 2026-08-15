/**
 * 左侧栏（会话历史）：
 * 标题 + New Chat + 导航菜单（Import Project / Research Skills / EvoMemory /
 * Scheduled）+ 搜索框 + Recents 会话列表。
 * 数据来自 framework kit 的 useSessions（DSH client-runtime 镜像）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState } from 'react'
import { FolderGit2, GraduationCap, BrainCircuit, Clock, Cable, Users, SquarePen, Search, MessageSquare, MessagesSquare, Pencil, Check, FileJson, FileText, Pin, Palette, Trash2 } from 'lucide-react'
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
  /** 导出会话（json | markdown，§26.3/§41.8）。 */
  onExport: (id: string, format: 'json' | 'markdown', title: string) => void
  /** 置顶会话 id 集合（client-side 持久化）。 */
  pinnedIds: Set<string>
  onTogglePin: (id: string) => void
  /** 会话标签颜色（§26.3，client-side 持久化；null 清除）。 */
  tagColors: Record<string, string>
  onSetTagColor: (id: string, color: string | null) => void
  /** 应从 Recents 隐藏的会话 id（侧聊/内部线程，§22.1）。 */
  hideIds: Set<string>
  /** 已删除会话 id（client-side 持久化；live 残留过滤，重启后彻底消失）。 */
  deletedIds: Set<string>
  /** 删除会话（host 删除持久化数据；返回是否成功）。 */
  onDelete: (id: string) => Promise<{ ok: boolean; error?: string }>
  /** 运行/停止中的会话 id（§26.3 行内运行状态点）。 */
  runningIds: Set<string>
}

/** 标签调色板（§26.3）。 */
const TAG_PALETTE = ['#e05d5d', '#e08a3c', '#d9b13b', '#5dbe85', '#3b9cb0', '#7a6fe0', '#b05dc4', '#908d83']

export function ThreadList({ useSessions, view, onView, onOpen, onNewChat, hasActive, onRename, onForkSideChat, onExport, pinnedIds, onTogglePin, tagColors, onSetTagColor, hideIds, deletedIds, onDelete, runningIds }: ThreadListProps) {
  const sessions = useSessions((s) => s)
  const currentId = sessions.current
  const [colorFor, setColorFor] = useState<string | null>(null)
  // Recents 只列主 Agent 线程（§22.1：fork 子线程与内部线程不得混入普通列表）
  const rows = (sessions.ids ?? [])
    .map((id) => sessions.byId[id])
    .filter((s) => s !== undefined && s.blank !== true && s.parentSessionId === undefined && !hideIds.has(s.id) && !deletedIds.has(s.id))
    // 置顶会话排最前（§26.3 Pin）
    .sort((a, b) => (pinnedIds.has(b.id) ? 1 : 0) - (pinnedIds.has(a.id) ? 1 : 0))
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [forkError, setForkError] = useState<string | null>(null)
  // 两段式删除确认：第一次点击进入确认态，5 秒无操作还原
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const armDelete = (id: string) => {
    setConfirmDelete(id)
    setTimeout(() => setConfirmDelete((v) => (v === id ? null : v)), 5000)
  }
  const runDelete = (id: string) => {
    setDeleteError(null)
    void onDelete(id).then((result) => {
      if (!result.ok) {
        setDeleteError(result.error ?? '删除失败')
        setTimeout(() => setDeleteError(null), 5000)
      }
      setConfirmDelete(null)
    })
  }

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
              deleteError !== null && jsx('span', { className: 'evo-tl-fork-error', children: deleteError }),
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
                          jsxs('div', {
                            className: 'evo-tl-row-title',
                            children: [
                              runningIds.has(s.id) && jsx('span', { className: 'evo-tl-running', title: 'Running' }),
                              tagColors[s.id] !== undefined && jsx('span', { className: 'evo-tl-color-dot', style: { background: tagColors[s.id] }, title: 'Tagged' }),
                              pinnedIds.has(s.id) && jsx('span', { className: 'evo-tl-pin-badge', title: 'Pinned', children: jsx(Pin, {}) }),
                              jsx('span', { className: 'evo-tl-title-text', children: s.displayTitle ?? s.id.slice(0, 12) }),
                            ],
                          }),
                          jsx('div', { className: 'evo-tl-row-sub', children: formatWhen(s.titleTime ?? s.updatedAt) }),
                        ],
                      }),
                    }),
                    colorFor === s.id && jsx('div', {
                      className: 'evo-tl-palette',
                      children: TAG_PALETTE.map((color) => jsx('button', {
                        type: 'button',
                        className: 'evo-tl-color-swatch',
                        'data-active': tagColors[s.id] === color || undefined,
                        style: { background: color },
                        title: tagColors[s.id] === color ? 'Remove tag' : 'Tag',
                        'aria-label': tagColors[s.id] === color ? 'Remove tag color' : 'Set tag color',
                        onClick: (e: { stopPropagation(): void }) => {
                          e.stopPropagation()
                          onSetTagColor(s.id, tagColors[s.id] === color ? null : color)
                          setColorFor(null)
                        },
                      }, color)),
                    }),
                    jsx('div', {
                      className: 'evo-tl-row-acts',
                      children: [
                        jsx('button', {
                          type: 'button',
                          className: 'evo-tl-row-act',
                          title: 'Tag color',
                          'aria-label': 'Tag color',
                          'data-on': colorFor === s.id || undefined,
                          onClick: (e: { stopPropagation(): void }) => {
                            e.stopPropagation()
                            setColorFor((v) => (v === s.id ? null : s.id))
                          },
                          children: jsx(Palette, {}),
                        }),
                        jsx('button', {
                          type: 'button',
                          className: 'evo-tl-row-act',
                          title: pinnedIds.has(s.id) ? 'Unpin' : 'Pin',
                          'aria-label': pinnedIds.has(s.id) ? 'Unpin' : 'Pin',
                          'data-on': pinnedIds.has(s.id) || undefined,
                          onClick: (e: { stopPropagation(): void }) => {
                            e.stopPropagation()
                            onTogglePin(s.id)
                          },
                          children: jsx(Pin, {}),
                        }),
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
                        jsx('button', {
                          type: 'button',
                          className: 'evo-tl-row-act',
                          title: 'Export JSON',
                          'aria-label': 'Export JSON',
                          onClick: (e: { stopPropagation(): void }) => {
                            e.stopPropagation()
                            onExport(s.id, 'json', s.displayTitle ?? s.id.slice(0, 12))
                          },
                          children: jsx(FileJson, {}),
                        }),
                        jsx('button', {
                          type: 'button',
                          className: 'evo-tl-row-act',
                          title: 'Export Markdown',
                          'aria-label': 'Export Markdown',
                          onClick: (e: { stopPropagation(): void }) => {
                            e.stopPropagation()
                            onExport(s.id, 'markdown', s.displayTitle ?? s.id.slice(0, 12))
                          },
                          children: jsx(FileText, {}),
                        }),
                        confirmDelete === s.id
                          ? jsx('button', {
                              type: 'button',
                              className: 'evo-tl-row-act evo-tl-del-confirm',
                              title: 'Confirm delete — this cannot be undone',
                              'aria-label': 'Confirm delete',
                              onClick: (e: { stopPropagation(): void }) => {
                                e.stopPropagation()
                                runDelete(s.id)
                              },
                              children: 'Delete?',
                            })
                          : jsx('button', {
                              type: 'button',
                              className: 'evo-tl-row-act evo-tl-del',
                              title: 'Delete session',
                              'aria-label': 'Delete session',
                              onClick: (e: { stopPropagation(): void }) => {
                                e.stopPropagation()
                                armDelete(s.id)
                              },
                              children: jsx(Trash2, {}),
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
