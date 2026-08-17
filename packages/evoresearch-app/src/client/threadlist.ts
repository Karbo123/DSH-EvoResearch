/**
 * 左侧栏（会话历史）：
 * 标题 + New Chat + 导航菜单（Import Project / Research Skills / EvoMemory /
 * Scheduled）+ 搜索框 + Recents 会话列表。
 * 数据来自 framework kit 的 useSessions（DSH client-runtime 镜像）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState, useEffect } from 'react'
import { FolderGit2, GraduationCap, BrainCircuit, Clock, Cable, Users, SquarePen, Search, MessageSquare, MessagesSquare, Pencil, Check, FileJson, FileText, Pin, Palette, Trash2, Archive, ArchiveRestore, ChevronRight, FlaskConical, Copy, MoreHorizontal, ArrowLeft, StickyNote, BookOpen, ListFilter, GripVertical } from 'lucide-react'
import { t } from './i18n'

/** 导航视图（点击菜单项切换中间面板；None = 聊天）。 */
export type SideView = null | 'skills' | 'memory' | 'schedule' | 'workspace' | 'channels' | 'team' | 'experiments' | 'notes' | 'library'

const MENU = [
  { key: 'import', label: t('importProject'), icon: FolderGit2 },
  { key: 'skills', label: t('researchSkills'), icon: GraduationCap },
  { key: 'memory', label: t('evomemory'), icon: BrainCircuit },
  { key: 'schedule', label: t('scheduled'), icon: Clock },
  { key: 'notes', label: t('notesPanel'), icon: StickyNote },
  { key: 'experiments', label: t('experiments'), icon: FlaskConical },
  { key: 'library', label: t('libraryPanel'), icon: BookOpen },
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
  /** 新建聊天；传入项目工作区路径 = 在该项目下新建子聊天 */
  onNewChat: (cwd?: string) => void
  /** 是否有活跃（非 blank）会话 */
  hasActive: boolean
  /** 重命名会话（官方 session.rename；返回是否成功）。 */
  onRename: (id: string, title: string) => Promise<boolean>
  /** 以某会话为起点创建继承型 Side Chat（官方 session.fork；返回结果）。 */
  onForkSideChat: (id: string) => Promise<{ ok: boolean; id?: string; error?: string }>
  /** 复制历史到新对话（fork 后提升为主聊天；返回结果）。 */
  onCopyHistory: (id: string) => Promise<{ ok: boolean; id?: string; error?: string }>
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
  /** 已归档会话 id（§26.3 Archive：从 Recents 隐藏但保留数据，可恢复）。 */
  archivedIds: Set<string>
  /** 归档/恢复会话（client-side 持久化）。 */
  onToggleArchive: (id: string) => void
  /** 运行/停止中的会话 id（§26.3 行内运行状态点）。 */
  runningIds: Set<string>
  /** 已提升为主聊天的复制会话 id（§5.3：有 parentSessionId 但不再按侧聊对待）。 */
  promotedIds: Set<string>
}

/** 标签调色板（§26.3）。 */
const TAG_PALETTE = ['#e05d5d', '#e08a3c', '#d9b13b', '#5dbe85', '#3b9cb0', '#7a6fe0', '#b05dc4', '#908d83']

type SortMode = 'recent' | 'title' | 'updated' | 'manual'
type ManualOrder = { projects: string[]; chats: Record<string, string[]> }
const SORT_KEY = 'evoresearch-thread-sort'
const ORDER_KEY = 'evoresearch-thread-order'

function readSortMode(): SortMode {
  try {
    const value = localStorage.getItem(SORT_KEY)
    return value === 'title' || value === 'updated' || value === 'manual' ? value : 'recent'
  } catch { return 'recent' }
}

function readManualOrder(): ManualOrder {
  try {
    const raw = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '{}') as Partial<ManualOrder>
    const chats: Record<string, string[]> = {}
    if (raw.chats !== null && typeof raw.chats === 'object') {
      for (const [key, value] of Object.entries(raw.chats)) {
        if (Array.isArray(value)) chats[key] = value.filter((v): v is string => typeof v === 'string')
      }
    }
    return {
      projects: Array.isArray(raw.projects) ? raw.projects.filter((v): v is string => typeof v === 'string') : [],
      chats,
    }
  } catch { return { projects: [], chats: {} } }
}

function sessionSearchText(session: any): string {
  const parts = [session.displayTitle, session.title]
  const nodes = session.snapshotCache?.chat?.legacy?.nodes
  if (Array.isArray(nodes)) for (const node of nodes) if (typeof node?.data?.text === 'string') parts.push(node.data.text)
  if (Array.isArray(session.events)) for (const event of session.events) {
    if (typeof event?.data?.text === 'string') parts.push(event.data.text)
    if (Array.isArray(event?.data?.content)) for (const block of event.data.content) if (typeof block?.text === 'string') parts.push(block.text)
  }
  return parts.filter((v): v is string => typeof v === 'string').join('\n').toLocaleLowerCase()
}

function hitSessionId(hit: any): string | null {
  for (const key of ['sessionId', 'threadId', 'id']) if (typeof hit?.[key] === 'string') return hit[key]
  return null
}

function moveId(ids: string[], from: string, to: string): string[] {
  const next = ids.filter((id) => id !== from)
  const index = next.indexOf(to)
  next.splice(index < 0 ? next.length : index, 0, from)
  return next
}

export function ThreadList({ useSessions, view, onView, onOpen, onNewChat, hasActive, onRename, onForkSideChat, onCopyHistory, onExport, pinnedIds, onTogglePin, tagColors, onSetTagColor, hideIds, deletedIds, onDelete, archivedIds, onToggleArchive, runningIds, promotedIds }: ThreadListProps) {
  const sessions = useSessions((s) => s)
  const currentId = sessions.current
  const [colorFor, setColorFor] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  // 「⋯」更多菜单外点击关闭
  useEffect(() => {
    if (menuFor === null) return
    const onDoc = () => setMenuFor(null)
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuFor])
  const isPromoted = (id: string): boolean => promotedIds.has(id)
  // Recents 只列主 Agent 线程（§22.1：fork 子线程与内部线程不得混入普通列表；
  // §5.3 提升后的复制会话除外——它已是独立主聊天）
  const rows = (sessions.ids ?? [])
    .map((id) => sessions.byId[id])
    .filter((s) => s !== undefined && s.blank !== true && (s.parentSessionId === undefined || isPromoted(s.id)) && !hideIds.has(s.id) && !deletedIds.has(s.id) && !archivedIds.has(s.id))
  // 已归档线程（§26.3 Archive：保留数据，可恢复）
  const archivedRows = (sessions.ids ?? [])
    .map((id) => sessions.byId[id])
    .filter((s) => s !== undefined && s.blank !== true && (s.parentSessionId === undefined || isPromoted(s.id)) && !hideIds.has(s.id) && !deletedIds.has(s.id) && archivedIds.has(s.id))
    .sort((a, b) => (archivedIds.has(b.id) ? 1 : 0) - (archivedIds.has(a.id) ? 1 : 0))
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>(readSortMode)
  const [manualOrder, setManualOrder] = useState<ManualOrder>(readManualOrder)
  const [contentHitIds, setContentHitIds] = useState<Set<string>>(new Set())
  const [searching, setSearching] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [forkError, setForkError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  // §ChatGraph/§二级聊天：左侧按项目分类——null = 项目列表视图；非 null = 该项目子聊天列表
  const [projectMode, setProjectMode] = useState<{ name: string; path: string } | null>(null)
  // 菜单内两段式删除确认：第一次点击进入确认态，5 秒无操作还原
  const [delArm, setDelArm] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const runDelete = (id: string) => {
    setDeleteError(null)
    void onDelete(id).then((result) => {
      if (!result.ok) {
        setDeleteError(result.error ?? '删除失败')
        setTimeout(() => setDeleteError(null), 5000)
      }
      setDelArm(null)
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

  const copyRow = (id: string) => {
    setForkError(null)
    void onCopyHistory(id).then((result) => {
      if (result.ok && result.id !== undefined) { onOpen(result.id); return }
      setForkError(result.error ?? '复制历史失败')
      setTimeout(() => setForkError(null), 5000)
    })
  }

  // ── 项目分组（§二级聊天）：由会话 cwd 派生项目列表 ──
  const cwdBase = (cwd: unknown): string | null =>
    typeof cwd === 'string' && cwd !== '' ? cwd.replace(/[\\/]+$/, '') : null

  const persistOrder = (next: ManualOrder) => {
    setManualOrder(next)
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)) } catch { /* 离线缓存失败不影响当前排序 */ }
  }
  const updateSortMode = (value: SortMode) => {
    setSortMode(value)
    try { localStorage.setItem(SORT_KEY, value) } catch { /* 离线缓存失败不影响当前排序 */ }
  }
  const orderWithManual = <T extends { id?: string; path?: string }>(items: T[], scope: 'projects' | 'chats', key: string): T[] => {
    const stored = scope === 'projects' ? manualOrder.projects : (manualOrder.chats[key] ?? [])
    const ids = items.map((item) => scope === 'projects' ? item.path ?? '' : item.id ?? '')
    const orderedIds = [...stored.filter((id) => ids.includes(id)), ...ids.filter((id) => !stored.includes(id))]
    return orderedIds.map((id) => items.find((item) => (scope === 'projects' ? item.path : item.id) === id)).filter((item): item is T => item !== undefined)
  }
  const sortSessions = (items: any[], scopeKey: string): any[] => {
    if (sortMode === 'manual') return orderWithManual(items, 'chats', scopeKey)
    return [...items].sort((a, b) => {
      const pinDelta = (pinnedIds.has(b.id) ? 1 : 0) - (pinnedIds.has(a.id) ? 1 : 0)
      if (pinDelta !== 0) return pinDelta
      if (sortMode === 'title') return String(a.displayTitle ?? a.id).localeCompare(String(b.displayTitle ?? b.id), 'zh-Hans')
      if (sortMode === 'updated') return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
      return (b.titleTime ?? b.updatedAt ?? 0) - (a.titleTime ?? a.updatedAt ?? 0)
    })
  }
  const searchNeedle = query.trim().toLocaleLowerCase()
  const matchesSession = (s: any): boolean => searchNeedle === '' || sessionSearchText(s).includes(searchNeedle) || contentHitIds.has(s.id)
  useEffect(() => {
    const needle = query.trim()
    if (needle === '') { setContentHitIds(new Set()); setSearching(false); return }
    setContentHitIds(new Set())
    let cancelled = false
    const timer = window.setTimeout(() => {
      setSearching(true)
      void fetch('/evoresearch/fs/threads-search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: needle, limit: 100 }),
      }).then((response) => response.json()).then((payload) => {
        if (cancelled) return
        const ids = new Set<string>()
        for (const hit of payload?.value?.hits ?? []) {
          const id = hitSessionId(hit)
          if (id !== null) ids.add(id)
        }
        setContentHitIds(ids)
        setSearching(false)
      }).catch(() => { if (!cancelled) { setContentHitIds(new Set()); setSearching(false) } })
    }, 240)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query])

  // 搜索同时覆盖标题、已加载正文，以及后端的全历史正文索引。
  const visibleRows = sortSessions(rows.filter(matchesSession), projectMode?.path ?? '')

  const projectList = (() => {
    const map = new Map<string, { path: string; count: number; updatedAt: number }>()
    for (const s of rows) {
      const base = cwdBase(s.cwd)
      if (base === null) continue
      const name = base.split(/[\\/]/).pop() ?? base
      const cur = map.get(name)
      if (cur !== undefined) {
        cur.count += 1
        if ((s.updatedAt ?? 0) > cur.updatedAt) cur.updatedAt = s.updatedAt ?? 0
      } else {
        map.set(name, { path: base, count: 1, updatedAt: s.updatedAt ?? 0 })
      }
    }
    const list = [...map.entries()].map(([name, v]) => ({ name, ...v }))
    const filtered = searchNeedle === '' ? list : list.filter((p) => p.name.toLocaleLowerCase().includes(searchNeedle) || rows.some((s) => cwdBase(s.cwd) === p.path && matchesSession(s)))
    if (sortMode === 'manual') return orderWithManual(filtered, 'projects', 'projects')
    return filtered.sort((a, b) => {
      if (sortMode === 'title') return a.name.localeCompare(b.name, 'zh-Hans')
      return b.updatedAt - a.updatedAt
    })
  })()
  // 当前项目视图下的会话（精确路径匹配）
  const scopedRows = projectMode === null
    ? []
    : visibleRows.filter((s) => cwdBase(s.cwd) === projectMode.path)
  const currentProject = (() => {
    const cur = currentId === undefined ? undefined : sessions.byId[currentId]
    const base = cwdBase(cur?.cwd)
    return base === null ? null : (base.split(/[\\/]/).pop() ?? base)
  })()
  const reorderProjects = (from: string, to: string) => {
    const ids = projectList.map((p) => p.path)
    persistOrder({ ...manualOrder, projects: moveId(ids, from, to) })
  }
  const reorderChats = (from: string, to: string) => {
    const scope = projectMode?.path ?? ''
    const ids = sortSessions(rows.filter((s) => cwdBase(s.cwd) === scope), scope).map((s) => s.id)
    persistOrder({ ...manualOrder, chats: { ...manualOrder.chats, [scope]: moveId(ids, from, to) } })
  }
  const dragStart = (id: string) => (e: { dataTransfer?: { setData(type: string, value: string): void } }) => {
    e.dataTransfer?.setData('text/plain', id)
  }
  const dragOver = (e: { preventDefault(): void }) => e.preventDefault()
  const dropProject = (to: string) => (e: { preventDefault(): void; dataTransfer?: { getData(type: string): string } }) => {
    e.preventDefault()
    const from = e.dataTransfer?.getData('text/plain') ?? ''
    if (from !== '' && from !== to) reorderProjects(from, to)
  }
  const dropChat = (to: string) => (e: { preventDefault(): void; dataTransfer?: { getData(type: string): string } }) => {
    e.preventDefault()
    const from = e.dataTransfer?.getData('text/plain') ?? ''
    if (from !== '' && from !== to) reorderChats(from, to)
  }

  const isActive = (key: string) =>
    (key === 'skills' && view === 'skills') ||
    (key === 'memory' && view === 'memory') ||
    (key === 'schedule' && view === 'schedule') ||
    (key === 'channels' && view === 'channels') ||
    (key === 'team' && view === 'team') ||
    (key === 'experiments' && view === 'experiments') ||
    (key === 'notes' && view === 'notes') ||
    (key === 'library' && view === 'library') ||
    (key === 'import' && view === 'workspace')

  return jsxs('div', {
    className: 'evo-tl',
    children: [
      jsxs('div', {
        className: 'evo-tl-head',
        children: [
          jsx('span', { className: 'evo-tl-head-title', children: t('projects') }),
        ],
      }),
      jsx('nav', {
        className: 'evo-tl-menu',
        children: [
          jsx('button', {
            type: 'button',
            className: 'evo-tl-item evo-tl-newchat-item',
            onClick: () => onNewChat(projectMode?.path),
            children: jsxs(Fragment, { children: [jsx(SquarePen, {}), jsx('span', { children: t('newChat') })] }),
          }),
          ...MENU.map((item) => {
            const Icon = item.icon
            return jsx('button', {
              type: 'button',
              className: 'evo-tl-item',
              'data-active': isActive(item.key) || undefined,
              onClick: () => onView(item.key === 'import' ? 'workspace' : (item.key as SideView)),
              children: jsxs(Fragment, { children: [jsx(Icon, {}), jsx('span', { children: item.label })] }),
            }, item.key)
          }),
        ],
      }),
      jsxs('div', {
        className: 'evo-tl-tools',
        children: [
          jsxs('label', {
            className: 'evo-tl-search',
            children: [
              jsx(Search, {}),
              jsx('input', {
                type: 'search',
                placeholder: t('searchResearch'),
                value: query,
                'aria-label': t('searchResearch'),
                onInput: (e) => setQuery(e.currentTarget.value),
              }),
              searching && jsx('span', { className: 'evo-tl-searching', 'aria-live': 'polite', children: t('searchRunning') }),
            ],
          }),
          jsxs('label', {
            className: 'evo-tl-sort',
            title: t('searchSort'),
            children: [
              jsx(ListFilter, {}),
              jsx('select', {
                value: sortMode,
                'aria-label': t('searchSort'),
                onChange: (e) => updateSortMode(e.currentTarget.value as SortMode),
                children: [
                  jsx('option', { value: 'recent', children: t('sortRecent') }),
                  jsx('option', { value: 'title', children: t('sortTitle') }),
                  jsx('option', { value: 'updated', children: t('sortUpdated') }),
                  jsx('option', { value: 'manual', children: t('sortManual') }),
                ],
              }),
            ],
          }),
        ],
      }),
      jsxs('div', {
        className: 'evo-tl-body',
        children: [
          projectMode === null
            ? // ── 项目列表视图（§二级聊天）──
              projectList.length === 0
                ? jsxs('div', {
                    className: 'evo-tl-empty',
                    children: [
                      jsx(FolderGit2, {}),
                      jsx('div', { children: t('noProjectsYet') }),
                    ],
                  })
                : projectList.map((p) => jsxs('div', {
                    className: 'evo-tl-row evo-tl-project-row',
                    'data-active': currentProject === p.name || undefined,
                    draggable: sortMode === 'manual' || undefined,
                    onDragStart: sortMode === 'manual' ? dragStart(p.path) : undefined,
                    onDragOver: sortMode === 'manual' ? dragOver : undefined,
                    onDrop: sortMode === 'manual' ? dropProject(p.path) : undefined,
                    onClick: () => { setProjectMode({ name: p.name, path: p.path }); setMenuFor(null) },
                    children: [
                      sortMode === 'manual' && jsx(GripVertical, { className: 'evo-tl-drag-grip', title: t('dragToReorder') }),
                      jsx(FolderGit2, {}),
                      jsxs('div', {
                        className: 'evo-tl-project-main',
                        children: [
                          jsx('span', { className: 'evo-tl-title-text', children: p.name }),
                          jsx('span', { className: 'evo-tl-row-sub', children: t('subchatCount').replace('{n}', String(p.count)) }),
                        ],
                      }),
                      jsx(ChevronRight, {}),
                    ],
                  }, p.path))
            : // ── 项目内子聊天列表（对应图谱 Chat Node）──
              jsxs(Fragment, {
                children: [
                  jsxs('div', {
                    className: 'evo-tl-section evo-tl-subchat-section',
                    children: [
                      jsxs('div', {
                        className: 'evo-tl-section-head',
                        children: [
                          jsx('span', { className: 'evo-tl-section-title', children: t('subchats') }),
                          jsx('button', {
                            type: 'button',
                            className: 'evo-tl-section-action',
                            title: t('projectBack'),
                            'aria-label': t('projectBack'),
                            onClick: () => { setProjectMode(null); setQuery(''); setMenuFor(null) },
                            children: jsx(ArrowLeft, {}),
                          }),
                        ],
                      }),
                      jsx('span', { className: 'evo-tl-project-context', children: projectMode.name }),
                      forkError !== null && jsx('span', { className: 'evo-tl-fork-error', children: forkError }),
                      deleteError !== null && jsx('span', { className: 'evo-tl-fork-error', children: deleteError }),
                    ],
                  }),
          scopedRows.length === 0
            ? jsxs('div', {
                className: 'evo-tl-empty',
                children: [
                  jsx(MessageSquare, {}),
                  jsx('div', { children: hasActive ? t('noMatchingResearch') : t('noResearchYet') }),
                ],
              })
            : scopedRows.map((s) => {
                if (renaming === s.id) {
                  return jsxs('div', {
                    className: 'evo-tl-row evo-tl-rename',
                    children: [
                      jsx('input', {
                        type: 'text',
                        className: 'evo-tl-rename-input',
                        value: renameValue,
                        autoFocus: true,
                        placeholder: t('renameSession'),
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
                        title: t('save'),
                        'aria-label': t('save'),
                        onClick: () => { void onRename(s.id, renameValue.trim()).then((ok) => { if (ok) setRenaming(null) }) },
                        children: jsx(Check, {}),
                      }),
                    ],
                  }, s.id)
                }
                return jsxs('div', {
                  className: 'evo-tl-row',
                  'data-active': s.id === currentId || undefined,
                  draggable: sortMode === 'manual' || undefined,
                  onDragStart: sortMode === 'manual' ? dragStart(s.id) : undefined,
                  onDragOver: sortMode === 'manual' ? dragOver : undefined,
                  onDrop: sortMode === 'manual' ? dropChat(s.id) : undefined,
                  children: [
                    sortMode === 'manual' && jsx(GripVertical, { className: 'evo-tl-drag-grip', title: t('dragToReorder') }),
                    jsx('button', {
                      type: 'button',
                      className: 'evo-tl-row-main',
                      onClick: () => onOpen(s.id),
                      children: jsxs(Fragment, {
                        children: [
                          jsxs('div', {
                            className: 'evo-tl-row-title',
                            children: [
                              runningIds.has(s.id) && jsx('span', { className: 'evo-tl-running', title: t('runningDot') }),
                              tagColors[s.id] !== undefined && jsx('span', { className: 'evo-tl-color-dot', style: { background: tagColors[s.id] }, title: t('tagged') }),
                              pinnedIds.has(s.id) && jsx('span', { className: 'evo-tl-pin-badge', title: t('pinned'), children: jsx(Pin, {}) }),
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
                        title: tagColors[s.id] === color ? t('removeTag') : t('tag'),
                        'aria-label': tagColors[s.id] === color ? t('removeTagColor') : t('setTagColor'),
                        onClick: (e: { stopPropagation(): void }) => {
                          e.stopPropagation()
                          onSetTagColor(s.id, tagColors[s.id] === color ? null : color)
                          setColorFor(null)
                        },
                      }, color)),
                    }),
                    jsx('div', {
                      className: 'evo-tl-row-acts',
                      'data-menu-open': menuFor === s.id || undefined,
                      children: [
                        jsx('button', {
                          type: 'button',
                          className: 'evo-tl-row-act',
                          title: pinnedIds.has(s.id) ? t('unpin') : t('pin'),
                          'aria-label': pinnedIds.has(s.id) ? t('unpin') : t('pin'),
                          'data-on': pinnedIds.has(s.id) || undefined,
                          onClick: (e: { stopPropagation(): void }) => {
                            e.stopPropagation()
                            onTogglePin(s.id)
                          },
                          children: jsx(Pin, {}),
                        }),
                        // 「⋯」更多菜单（§侧栏重构：低频/高风险操作收纳，避免横排占满）
                        jsxs('div', {
                          className: 'evo-tl-row-more',
                          children: [
                            jsx('button', {
                              type: 'button',
                              className: 'evo-tl-row-act',
                              title: t('moreActions'),
                              'aria-label': t('moreActions'),
                              'data-on': menuFor === s.id || undefined,
                              onClick: (e: { stopPropagation(): void }) => {
                                e.stopPropagation()
                                setMenuFor((v) => (v === s.id ? null : s.id))
                              },
                              children: jsx(MoreHorizontal, {}),
                            }),
                            menuFor === s.id && jsx('div', {
                              className: 'evo-tl-row-menu',
                              onClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
                              children: [
                                jsx('button', {
                                  type: 'button',
                                  className: 'evo-tl-menu-item',
                                  onClick: () => { setMenuFor(null); setRenameValue(s.displayTitle ?? ''); setRenaming(s.id) },
                                  children: jsxs(Fragment, { children: [jsx(Pencil, {}), jsx('span', { children: t('rename') })] }),
                                }),
                                jsx('button', {
                                  type: 'button',
                                  className: 'evo-tl-menu-item',
                                  onClick: () => { setMenuFor(null); setColorFor((v) => (v === s.id ? null : s.id)) },
                                  children: jsxs(Fragment, { children: [jsx(Palette, {}), jsx('span', { children: t('tagColor') })] }),
                                }),
                                jsx('button', {
                                  type: 'button',
                                  className: 'evo-tl-menu-item',
                                  onClick: () => { setMenuFor(null); onToggleArchive(s.id) },
                                  children: jsxs(Fragment, { children: [jsx(Archive, {}), jsx('span', { children: t('archive') })] }),
                                }),
                                jsx('div', { className: 'evo-tl-menu-sep' }),
                                // §ChatGraph：侧边对话入口已整合进图谱（chat graph）——
                                // 复制历史仍保留（生成独立会话）
                                jsx('button', {
                                  type: 'button',
                                  className: 'evo-tl-menu-item',
                                  onClick: () => { setMenuFor(null); copyRow(s.id) },
                                  children: jsxs(Fragment, { children: [jsx(Copy, {}), jsx('span', { children: t('menuCopyHistory') })] }),
                                }),
                                jsx('div', { className: 'evo-tl-menu-sep' }),
                                jsx('button', {
                                  type: 'button',
                                  className: 'evo-tl-menu-item',
                                  onClick: () => { setMenuFor(null); onExport(s.id, 'json', s.displayTitle ?? s.id.slice(0, 12)) },
                                  children: jsxs(Fragment, { children: [jsx(FileJson, {}), jsx('span', { children: t('exportJson') })] }),
                                }),
                                jsx('button', {
                                  type: 'button',
                                  className: 'evo-tl-menu-item',
                                  onClick: () => { setMenuFor(null); onExport(s.id, 'markdown', s.displayTitle ?? s.id.slice(0, 12)) },
                                  children: jsxs(Fragment, { children: [jsx(FileText, {}), jsx('span', { children: t('exportMarkdown') })] }),
                                }),
                                jsx('div', { className: 'evo-tl-menu-sep' }),
                                delArm === s.id
                                  ? jsx('button', {
                                      type: 'button',
                                      className: 'evo-tl-menu-item evo-tl-menu-danger',
                                      onClick: () => { setMenuFor(null); setDelArm(null); runDelete(s.id) },
                                      children: jsx('span', { children: t('deleteQ') }),
                                    })
                                  : jsx('button', {
                                      type: 'button',
                                      className: 'evo-tl-menu-item evo-tl-menu-danger',
                                      onClick: () => {
                                        setDelArm(s.id)
                                        setTimeout(() => setDelArm((v) => (v === s.id ? null : v)), 5000)
                                      },
                                      children: jsxs(Fragment, { children: [jsx(Trash2, {}), jsx('span', { children: t('deleteSession') })] }),
                                    }),
                              ],
                            }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }, s.id)
              }),
                ],
              }),
        // ── 已归档分区（§26.3 Archive：保留数据，可恢复）──
        archivedRows.length > 0 && jsxs('div', {
          className: 'evo-tl-section',
          children: [
            jsxs('button', {
              type: 'button',
              className: 'evo-tl-archived-toggle',
              'aria-expanded': showArchived || undefined,
              onClick: () => setShowArchived((v) => !v),
              children: [
                jsx(ChevronRight, { className: `evo-tool-chev${showArchived ? ' open' : ''}` }),
                jsx(Archive, {}),
                jsx('span', { children: `${t('archived')} (${archivedRows.length})` }),
              ],
            }),
            showArchived && jsx('div', {
              className: 'evo-tl-archived-list',
              children: archivedRows.map((s) => jsxs('div', {
                className: 'evo-tl-row evo-tl-archived-row',
                'data-active': s.id === currentId || undefined,
                children: [
                  jsx('button', {
                    type: 'button',
                    className: 'evo-tl-row-main',
                    onClick: () => onOpen(s.id),
                    children: jsxs(Fragment, {
                      children: [
                        jsx('span', { className: 'evo-tl-title-text', children: s.displayTitle ?? s.id.slice(0, 12) }),
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
                        title: t('unarchive'),
                        'aria-label': t('unarchive'),
                        onClick: (e: { stopPropagation(): void }) => {
                          e.stopPropagation()
                          onToggleArchive(s.id)
                        },
                        children: jsx(ArchiveRestore, {}),
                      }),
                    ],
                  }),
                ],
              }, s.id)),
            }),
          ],
        }),
      ],
    }),
    ],
  })
}
