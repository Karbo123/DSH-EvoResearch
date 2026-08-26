/**
 * 左侧栏（会话历史）：
 * 标题 + New Chat + 导航菜单（Import Project / Research Skills / EvoMemory /
 * Scheduled）+ 搜索框 + Recents 会话列表。
 * 数据来自 framework kit 的 useSessions（DSH client-runtime 镜像）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useState, useEffect, useRef } from 'react'
import { FolderGit2, GraduationCap, BrainCircuit, Clock, Cable, Users, Search, MessageSquare, Pencil, Check, FileJson, FileText, Pin, Palette, Trash2, Archive, ArchiveRestore, ChevronRight, FlaskConical, Copy, MoreHorizontal, ArrowLeft, StickyNote, BookOpen, ListFilter, GripVertical, History } from 'lucide-react'
import { t } from './i18n'
import { ConfirmDialog } from './session-actions'
import { clientStateGet, clientStateSet } from './client-state'

/** 导航视图（点击菜单项切换中间面板；None = 聊天）。 */
export type SideView = null | 'skills' | 'memory' | 'schedule' | 'workspace' | 'channels' | 'team' | 'experiments' | 'notes' | 'library'

/** 工作台导航菜单（由左上角 EvoResearch logo 的右键菜单复用）。 */
export const MENU = [
  { key: 'import', label: t('importProject'), icon: FolderGit2, desc: t('menuImportHint') },
  { key: 'skills', label: t('researchSkills'), icon: GraduationCap, desc: t('menuSkillsHint') },
  { key: 'memory', label: t('evomemory'), icon: BrainCircuit, desc: t('menuMemoryHint') },
  { key: 'schedule', label: t('scheduled'), icon: Clock, desc: t('menuScheduleHint') },
  { key: 'notes', label: t('notesPanel'), icon: StickyNote, desc: t('menuNotesHint') },
  { key: 'experiments', label: t('experiments'), icon: FlaskConical, desc: t('menuExperimentsHint') },
  { key: 'library', label: t('libraryPanel'), icon: BookOpen, desc: t('menuLibraryHint') },
  { key: 'channels', label: t('channels'), icon: Cable, desc: t('menuChannelsHint') },
  { key: 'team', label: t('team'), icon: Users, desc: t('menuTeamHint') },
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
  /** 工作区注册表，用于显示 AI 标题而不改变实际项目路径。 */
  useWorkspaces: (selector: (s: any) => any) => any
  /** 打开（选中）一个会话 */
  onOpen: (id: string) => void
  /** 新建聊天；传入项目工作区路径 = 在该项目下新建子聊天 */
  onNewChat: (cwd?: string) => void
  /** 把左侧当前项目/子聊天作用域同步给页面级发送入口。 */
  onProjectModeChange: (project: { name: string; path: string } | null) => void
  /** 是否有活跃（非 blank）会话 */
  hasActive: boolean
  /** 重命名会话（官方 session.rename；返回是否成功）。 */
  onRename: (id: string, title: string) => Promise<boolean>
  /** 重命名项目（Workspace 显示标题；返回是否成功）。 */
  onRenameProject: (path: string, title: string) => Promise<boolean>
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
  /** 项目标签颜色（client 侧持久化；null 清除）。 */
  projectTagColors: Record<string, string>
  onSetProjectTagColor: (path: string, color: string | null) => void
  /** 应从 Recents 隐藏的会话 id（侧聊/内部线程，§22.1）。 */
  hideIds: Set<string>
  /** 已删除会话 id（client-side 持久化；live 残留过滤，重启后彻底消失）。 */
  deletedIds: Set<string>
  /** 删除会话（host 删除持久化数据；返回是否成功）。 */
  onDelete: (id: string) => Promise<{ ok: boolean; error?: string }>
  /** 删除项目（删除其全部子聊天与项目级状态；deleteDisk 可选地同时删除磁盘文件；返回是否成功）。 */
  onDeleteProject: (path: string, opts?: { deleteDisk?: boolean }) => Promise<{ ok: boolean; error?: string }>
  /** 已归档会话 id（§26.3 Archive：从 Recents 隐藏但保留数据，可恢复）。 */
  archivedIds: Set<string>
  /** 归档/恢复会话（client-side 持久化）。 */
  onToggleArchive: (id: string) => void
  /** 已归档项目路径集合（client 侧持久化；项目由会话 cwd 派生）。 */
  archivedProjects: Set<string>
  /** 归档/恢复项目（同时归档/恢复其全部子聊天）。 */
  onToggleProjectArchive: (path: string) => void
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
  const value = clientStateGet(SORT_KEY)
  return value === 'title' || value === 'updated' || value === 'manual' ? value : 'recent'
}

function readManualOrder(): ManualOrder {
  try {
    const raw = JSON.parse(clientStateGet(ORDER_KEY) ?? '{}') as Partial<ManualOrder>
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

function moveIdToIndex(ids: string[], id: string, index: number): string[] {
  const next = ids.filter((value) => value !== id)
  next.splice(Math.max(0, Math.min(index, next.length)), 0, id)
  return next
}

/** 项目级 UI 键（菜单/调色板/删除/重命名状态）：与会话 id 隔离，避免路径撞键。 */
const projKey = (path: string): string => `proj:${path}`

type DragScope = 'projects' | 'chats'
type DragState = {
  scope: DragScope
  id: string
  label: string
  detail: string
  startX: number
  startY: number
  clientX: number
  clientY: number
  insertIndex: number
  active: boolean
}

/**
 * dsh-client-runtime 的会话列表快照以 `items + sessionId` 表示；旧版界面
 * 使用 `ids + byId + id`。在 UI 边界统一成后者，避免列表和当前会话分别
 * 读取两种快照形态，尤其是新建会话后出现“服务里有、侧栏没行”的情况。
 */
export function normalizeSessionsSnapshot(input: any): any {
  if (input === null || typeof input !== 'object') return { ids: [], byId: {}, current: undefined, jobsBySession: {} }
  const sourceItems = Array.isArray(input.items)
    ? input.items
    : Array.isArray(input.list?.items)
      ? input.list.items
      : []
  const ids: string[] = Array.isArray(input.ids)
    ? input.ids.filter((id: unknown): id is string => typeof id === 'string')
    : []
  const byId: Record<string, any> = input.byId !== null && typeof input.byId === 'object' ? { ...input.byId } : {}
  for (const raw of sourceItems) {
    const id = typeof raw?.id === 'string' ? raw.id : raw?.sessionId
    if (typeof id !== 'string' || id === '') continue
    const projections = raw?.projections?.projectionValues ?? raw?.projections?.values ?? {}
    const title = raw.displayTitle ?? raw.title ?? raw?.projections?.title ?? projections.title ?? null
    byId[id] = {
      ...raw,
      id,
      displayTitle: typeof title === 'string' && title.trim() !== '' ? title : undefined,
      title: typeof title === 'string' && title.trim() !== '' ? title : undefined,
      titleTime: raw.titleTime ?? raw.updatedAt,
      parentSessionId: raw.parentSessionId ?? (raw.depth > 0 ? raw.parentId : undefined),
      running: raw.running === true,
      blank: raw.blank === true,
    }
    if (!ids.includes(id)) ids.push(id)
  }
  for (const id of Object.keys(byId)) if (!ids.includes(id)) ids.push(id)
  const current = typeof input.current === 'string'
    ? input.current
    : typeof input.currentAddress?.sessionId === 'string' ? input.currentAddress.sessionId : undefined
  return { ...input, ids, byId, current, jobsBySession: input.jobsBySession ?? {} }
}

export function ThreadList({ useSessions, useWorkspaces, onOpen, onNewChat, onProjectModeChange, hasActive, onRename, onRenameProject, onForkSideChat, onCopyHistory, onExport, pinnedIds, onTogglePin, tagColors, onSetTagColor, projectTagColors, onSetProjectTagColor, hideIds, deletedIds, onDelete, onDeleteProject, archivedIds, onToggleArchive, archivedProjects, onToggleProjectArchive, runningIds, promotedIds }: ThreadListProps) {
  const sessions = normalizeSessionsSnapshot(useSessions((s) => s))
  const workspaces = useWorkspaces((s) => s)
  const currentId = sessions.current
  const [colorFor, setColorFor] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [sortOpen, setSortOpen] = useState(false)
  const sortRef = useRef<HTMLDivElement | null>(null)
  const menuAnchorRef = useRef<HTMLDivElement | null>(null)
  const colorAnchorRef = useRef<HTMLDivElement | null>(null)
  // 「⋯」更多菜单外点击关闭：mousedown 时若点击目标在打开的菜单/触发按钮内则不关闭，
  // 否则 mousedown 阶段就卸载菜单，后续 click 永远落不到菜单项上（真实鼠标点击失效）。
  useEffect(() => {
    if (menuFor === null && colorFor === null) return
    const onDoc = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof Node && (menuAnchorRef.current?.contains(target) || colorAnchorRef.current?.contains(target))) return
      setMenuFor(null)
      setColorFor(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuFor, colorFor])
  useEffect(() => {
    if (!sortOpen) return
    const onDoc = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node) || !sortRef.current?.contains(target)) setSortOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [sortOpen])
  const isPromoted = (id: string): boolean => promotedIds.has(id)
  // Recents 只列主 Agent 线程（§22.1：fork 子线程与内部线程不得混入普通列表；
  // §5.3 提升后的复制会话除外——它已是独立主聊天）
  const sessionIds: string[] = Array.isArray(sessions.ids) ? sessions.ids : Object.keys(sessions.byId ?? {})
  const rows = sessionIds
    .map((id) => sessions.byId[id])
    .filter((s) => s !== undefined && s.blank !== true && (s.parentSessionId === undefined || isPromoted(s.id)) && !hideIds.has(s.id) && !deletedIds.has(s.id) && !archivedIds.has(s.id))
  // 已归档线程（§26.3 Archive：保留数据，可恢复）
  const archivedRows = sessionIds
    .map((id) => sessions.byId[id])
    .filter((s) => s !== undefined && s.blank !== true && (s.parentSessionId === undefined || isPromoted(s.id)) && !hideIds.has(s.id) && !deletedIds.has(s.id) && archivedIds.has(s.id))
    // 已归档项目的子对话已归在“已归档项目”下，不再重复出现在“已归档对话”里
    .filter((s) => {
      const base = typeof s?.cwd === 'string' && s.cwd !== '' ? s.cwd.replace(/[\\/]+$/, '') : null
      return base === null || !archivedProjects.has(base)
    })
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
  const [showArchivedProjects, setShowArchivedProjects] = useState(false)
  const [expandedArchivedProject, setExpandedArchivedProject] = useState<string | null>(null)
  const [confirmDeleteProjectPath, setConfirmDeleteProjectPath] = useState<string | null>(null)
  const [deleteProjectDisk, setDeleteProjectDisk] = useState(false)
  // 归档项目后自动展开“已归档项目”区，让用户能立刻看到项目去了哪里
  useEffect(() => {
    const expand = () => setShowArchivedProjects(true)
    window.addEventListener('evo:project-archived', expand)
    return () => window.removeEventListener('evo:project-archived', expand)
  }, [])
  const [dragState, setDragState] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  // §ChatGraph/§二级聊天：左侧按项目分类——null = 项目列表视图；非 null = 该项目子聊天列表
  const [projectMode, setProjectMode] = useState<{ name: string; path: string } | null>(null)
  const setProjectScope = (next: { name: string; path: string } | null) => {
    setProjectMode(next)
    onProjectModeChange(next)
  }
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
  /** 删除项目：成功后清排序记录并退出该项目视图。 */
  const runDeleteProject = (path: string, deleteDisk = false) => {
    setDeleteError(null)
    void onDeleteProject(path, { deleteDisk }).then((result) => {
      if (!result.ok) {
        setDeleteError(result.error ?? '删除项目失败')
        setTimeout(() => setDeleteError(null), 5000)
      } else {
        const nextOrder: ManualOrder = { projects: manualOrder.projects.filter((p) => p !== path), chats: { ...manualOrder.chats } }
        delete nextOrder.chats[path]
        persistOrder(nextOrder)
        if (projectMode?.path === path) setProjectScope(null)
      }
      setDelArm(null)
      setMenuFor(null)
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

  // 项目注册表（host projects/ 目录，权威列表）：新建/导入的项目即使还没有任何会话
  // 也应显示在工作台中，并与 EvoMemory 等面板保持一致（注册表为准）。
  // 周期刷新（静默），使新建/导入的项目在几秒内出现在左侧列表。
  const [registryProjects, setRegistryProjects] = useState<Array<{ name: string; path: string }>>([])
  useEffect(() => {
    let cancelled = false
    const fetchRegistry = () => fetch('/evoresearch/fs/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).then((res) => res.json()).then((payload) => {
      if (cancelled) return
      const list = Array.isArray(payload?.value) ? payload.value : []
      setRegistryProjects(list.map((p: { name?: string; path?: string }) => ({
        name: typeof p?.name === 'string' ? p.name : '',
        path: typeof p?.path === 'string' ? p.path.replace(/[\\/]+$/, '') : '',
      })).filter((p: { name: string; path: string }) => p.name !== ''))
    }).catch(() => { /* 注册表拉取失败时不阻塞，仅回退到会话派生列表 */ })
    void fetchRegistry()
    const timer = setInterval(fetchRegistry, 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  const persistOrder = (next: ManualOrder) => {
    setManualOrder(next)
    clientStateSet(ORDER_KEY, JSON.stringify(next))
  }
  const updateSortMode = (value: SortMode) => {
    setSortMode(value)
    setSortOpen(false)
    clientStateSet(SORT_KEY, value)
  }
  const sortOptions: Array<{ value: SortMode; label: string; icon: typeof ListFilter }> = [
    { value: 'recent', label: t('sortRecent'), icon: Clock },
    { value: 'title', label: t('sortTitle'), icon: ListFilter },
    { value: 'updated', label: t('sortUpdated'), icon: Pencil },
    { value: 'manual', label: t('sortManual'), icon: GripVertical },
  ]
  const activeSortLabel = sortOptions.find((option) => option.value === sortMode)?.label ?? t('sortRecent')
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
  const canReorder = sortMode === 'manual' && searchNeedle === ''
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
    // 注册表对齐：把「项目注册表里存在、但还没有任何会话」的项目也纳入左侧列表
    // （新建/导入的项目立刻可见，与 EvoMemory 的 registry 列表保持一致）。
    for (const reg of registryProjects) {
      if (reg.path === '' || map.has(reg.name)) continue
      if (archivedProjects.has(reg.path)) continue
      if (reg.name.startsWith('.')) continue
      map.set(reg.name, { path: reg.path, count: 0, updatedAt: 0 })
    }
    const list = [...map.entries()].map(([name, v]) => {
      const workspace = (workspaces.items ?? []).find((item: any) => typeof item?.path === 'string' && cwdBase(item.path) === v.path)
      return { name: typeof workspace?.title === 'string' && workspace.title.trim() !== '' ? workspace.title : name, path: v.path, count: v.count, updatedAt: v.updatedAt }
    })
    const filtered = searchNeedle === '' ? list : list.filter((p) => p.name.toLocaleLowerCase().includes(searchNeedle) || rows.some((s) => cwdBase(s.cwd) === p.path && matchesSession(s)))
    if (sortMode === 'manual') return orderWithManual(filtered, 'projects', 'projects')
    return filtered.sort((a, b) => {
      if (sortMode === 'title') return a.name.localeCompare(b.name, 'zh-Hans')
      return b.updatedAt - a.updatedAt
    })
  })()
  // 已归档项目（由 archivedProjects 路径集合派生；名称/子聊天数取全部会话）
  const archivedProjectList = (() => {
    const allSessions = sessionIds
      .map((id) => sessions.byId[id])
      .filter((s) => s !== undefined && s.blank !== true && !hideIds.has(s.id) && !deletedIds.has(s.id))
    return [...archivedProjects].map((path) => {
      const base = path.split(/[\\/]/).pop() ?? path
      const workspace = (workspaces.items ?? []).find((item: any) => typeof item?.path === 'string' && cwdBase(item.path) === path)
      const count = allSessions.filter((s) => cwdBase(s.cwd) === path).length
      const updatedAt = allSessions
        .filter((s) => cwdBase(s.cwd) === path)
        .reduce((max, s) => Math.max(max, s.updatedAt ?? 0), 0)
      return {
        name: typeof workspace?.title === 'string' && workspace.title.trim() !== '' ? workspace.title : base,
        path,
        count,
        updatedAt,
      }
    }).sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, 'zh-Hans'))
  })()
  // 归档项目展开时展示的子聊天（该项目的全部子会话）
  const archivedProjectChats = (path: string) => sessionIds
    .map((id) => sessions.byId[id])
    .filter((s) => s !== undefined && s.blank !== true && !hideIds.has(s.id) && !deletedIds.has(s.id) && cwdBase(s.cwd) === path)
    .sort((a, b) => (b.titleTime ?? b.updatedAt ?? 0) - (a.titleTime ?? a.updatedAt ?? 0))
  // 当前项目视图下的会话（精确路径匹配）
  const scopedRows = projectMode === null
    ? []
    : visibleRows.filter((s) => cwdBase(s.cwd) === projectMode.path)
  const currentProject = (() => {
    const cur = currentId === undefined ? undefined : sessions.byId[currentId]
    const base = cwdBase(cur?.cwd)
    return base === null ? null : (base.split(/[\\/]/).pop() ?? base)
  })()
  const finishDrag = () => {
    const session = dragRef.current
    dragCleanupRef.current?.()
    dragRef.current = null
    setDragState(null)
    if (session === null || !session.active) return
    if (session.scope === 'projects') {
      const ids = projectList.map((p) => p.path)
      persistOrder({ ...manualOrder, projects: moveIdToIndex(ids, session.id, session.insertIndex) })
    } else {
      const scope = projectMode?.path ?? ''
      const ids = sortSessions(rows.filter((s) => cwdBase(s.cwd) === scope), scope).map((s) => s.id)
      persistOrder({ ...manualOrder, chats: { ...manualOrder.chats, [scope]: moveIdToIndex(ids, session.id, session.insertIndex) } })
    }
  }
  const startPointerDrag = (scope: DragScope, id: string, label: string, detail: string) => (e: { clientX: number; clientY: number; currentTarget: HTMLElement; pointerId: number; preventDefault(): void; stopPropagation(): void }) => {
    e.preventDefault()
    e.stopPropagation()
    dragCleanupRef.current?.()
    const initial: DragState = { scope, id, label, detail, startX: e.clientX, startY: e.clientY, clientX: e.clientX, clientY: e.clientY, insertIndex: 0, active: false }
    dragRef.current = initial
    const grip = e.currentTarget
    grip.setPointerCapture(e.pointerId)
    const update = (event: PointerEvent) => {
      const session = dragRef.current
      if (session === null) return
      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY)
      if (!session.active && distance < 6) return
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-evo-dnd-id]')
      const sameScope = row?.dataset.evoDndScope === session.scope
      const targetId = sameScope ? row?.dataset.evoDndId : undefined
      const items = session.scope === 'projects'
        ? projectList.map((p) => p.path)
        : sortSessions(rows.filter((s) => cwdBase(s.cwd) === (projectMode?.path ?? '')), projectMode?.path ?? '').map((s) => s.id)
      const sourceIndex = Math.max(0, items.indexOf(session.id))
      let insertIndex = sourceIndex
      if (targetId !== undefined && targetId !== session.id) {
        const remaining = items.filter((item) => item !== session.id)
        const targetIndex = remaining.indexOf(targetId)
        if (targetIndex >= 0) insertIndex = targetIndex + (event.clientY >= (row?.getBoundingClientRect().top ?? 0) + (row?.getBoundingClientRect().height ?? 0) / 2 ? 1 : 0)
      }
      const next = { ...session, clientX: event.clientX, clientY: event.clientY, insertIndex, active: true }
      dragRef.current = next
      setDragState(next)
    }
    const end = () => finishDrag()
    const cancel = () => {
      dragCleanupRef.current = null
      dragRef.current = null
      setDragState(null)
      document.removeEventListener('pointermove', update)
      document.removeEventListener('pointerup', end)
      document.removeEventListener('pointercancel', cancel)
    }
    dragCleanupRef.current = cancel
    document.addEventListener('pointermove', update)
    document.addEventListener('pointerup', end)
    document.addEventListener('pointercancel', cancel)
  }
  useEffect(() => () => { dragCleanupRef.current?.() }, [])

  const isDragging = (scope: DragScope, id: string) => dragState?.active === true && dragState.scope === scope && dragState.id === id
  const placeholder = (key: string) => jsx('div', { className: 'evo-tl-drop-placeholder', 'aria-hidden': true }, key)
  const dragGrip = (scope: DragScope, id: string, label: string, detail: string) => jsx('button', {
    type: 'button',
    className: 'evo-tl-drag-grip',
    title: t('dragToReorder'),
    'aria-label': `${t('dragToReorder')}：${label}`,
    onPointerDown: startPointerDrag(scope, id, label, detail),
    onClick: (event: { stopPropagation(): void }) => event.stopPropagation(),
    children: jsx(GripVertical, {}),
  })

  const projectRenderItems: Array<{ kind: 'project'; value: typeof projectList[number] } | { kind: 'placeholder'; key: string }> = (() => {
    const source = dragState?.scope === 'projects' && dragState.active ? projectList.filter((p) => p.path !== dragState.id) : projectList
    if (dragState?.scope !== 'projects' || !dragState.active) return source.map((value) => ({ kind: 'project', value }))
    const result: typeof projectRenderItems = []
    source.forEach((value, index) => {
      if (index === dragState.insertIndex) result.push({ kind: 'placeholder', key: `project-drop-${index}` })
      result.push({ kind: 'project', value })
    })
    if (dragState.insertIndex >= source.length) result.push({ kind: 'placeholder', key: `project-drop-${source.length}` })
    return result
  })()

  const chatRenderItems: Array<{ kind: 'chat'; value: any } | { kind: 'placeholder'; key: string }> = (() => {
    const source = dragState?.scope === 'chats' && dragState.active ? scopedRows.filter((s) => s.id !== dragState.id) : scopedRows
    if (dragState?.scope !== 'chats' || !dragState.active) return source.map((value) => ({ kind: 'chat', value }))
    const result: typeof chatRenderItems = []
    source.forEach((value, index) => {
      if (index === dragState.insertIndex) result.push({ kind: 'placeholder', key: `chat-drop-${index}` })
      result.push({ kind: 'chat', value })
    })
    if (dragState.insertIndex >= source.length) result.push({ kind: 'placeholder', key: `chat-drop-${source.length}` })
    return result
  })()

  // 工作台导航已迁移到左上角 EvoResearch logo 的右键菜单（index.ts）。

  return jsxs('div', {
    className: 'evo-tl',
    'data-dragging': dragState?.active || undefined,
    children: [
      jsxs('div', {
        className: 'evo-tl-head',
        children: [
          jsx('span', { className: 'evo-tl-head-title evo-current-projects', children: t('currentProjects') }),
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
          jsxs('div', {
            ref: sortRef,
            className: 'evo-tl-sort-wrap',
            children: [
              jsx('button', {
                type: 'button',
                className: 'evo-tl-sort-btn',
                title: `${t('searchSort')}：${activeSortLabel}`,
                'aria-label': `${t('searchSort')}：${activeSortLabel}`,
                'aria-expanded': sortOpen,
                'aria-haspopup': 'menu',
                onClick: () => setSortOpen((open) => !open),
                children: jsx(ListFilter, {}),
              }),
              sortOpen && jsx('div', {
                className: 'evo-tl-sort-menu',
                role: 'menu',
                'aria-label': t('searchSort'),
                children: sortOptions.map((option) => {
                  const Icon = option.icon
                  const active = option.value === sortMode
                  return jsxs('button', {
                    type: 'button',
                    className: 'evo-tl-sort-option',
                    'data-active': active || undefined,
                    role: 'menuitemradio',
                    'aria-checked': active,
                    onClick: () => updateSortMode(option.value),
                    children: [
                      jsx(Icon, {}),
                      jsx('span', { children: option.label }),
                      active && jsx(Check, {}),
                    ],
                  }, option.value)
                }),
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
              jsxs(Fragment, {
                children: [
                  deleteError !== null && jsx('span', { className: 'evo-tl-fork-error evo-tl-project-error', children: deleteError }),
                  projectList.length === 0
                ? archivedProjectList.length === 0
                  ? jsxs('div', {
                      className: 'evo-tl-empty',
                      children: [
                        jsx(FolderGit2, {}),
                        jsx('div', { children: t('noProjectsYet') }),
                      ],
                    })
                  : jsx('div', { className: 'evo-tl-empty evo-tl-empty-compact', children: t('noActiveProjects') })
                : projectRenderItems.map((item) => item.kind === 'placeholder'
                  ? placeholder(item.key)
                  : (() => {
                    const p = item.value
                    const key = projKey(p.path)
                    if (renaming === key) {
                      return jsxs('div', {
                        className: 'evo-tl-row evo-tl-rename evo-tl-project-row',
                        children: [
                          jsx(FolderGit2, {}),
                          jsx('input', {
                            type: 'text',
                            className: 'evo-tl-rename-input',
                            value: renameValue,
                            autoFocus: true,
                            placeholder: t('renameProjectInput'),
                            onInput: (e) => setRenameValue(e.currentTarget.value),
                            onKeyDown: (e) => {
                              if (e.key === 'Enter') {
                                void onRenameProject(p.path, renameValue.trim()).then((ok) => { if (ok) setRenaming(null) })
                              }
                              if (e.key === 'Escape') setRenaming(null)
                            },
                          }),
                          jsx('button', {
                            type: 'button',
                            className: 'evo-tl-row-act',
                            title: t('save'),
                            'aria-label': t('save'),
                            onClick: (e: { stopPropagation(): void }) => {
                              e.stopPropagation()
                              void onRenameProject(p.path, renameValue.trim()).then((ok) => { if (ok) setRenaming(null) })
                            },
                            children: jsx(Check, {}),
                          }),
                        ],
                      }, p.path)
                    }
                    return jsxs('div', {
                      className: `evo-tl-row evo-tl-project-row${isDragging('projects', p.path) ? ' evo-tl-row-dragging' : ''}`,
                      'data-active': currentProject === p.name || undefined,
                      'data-evo-dnd-id': p.path,
                      'data-evo-dnd-scope': 'projects',
                      onClick: () => { setProjectScope({ name: p.name, path: p.path }); setMenuFor(null); setColorFor(null) },
                      children: [
                        canReorder && dragGrip('projects', p.path, p.name, t('subchatCount').replace('{n}', String(p.count))),
                        jsx(FolderGit2, {}),
                        projectTagColors[p.path] !== undefined && jsx('span', {
                          className: 'evo-tl-color-dot',
                          style: { background: projectTagColors[p.path] },
                          title: t('tagged'),
                        }),
                        jsxs('div', {
                          className: 'evo-tl-project-main',
                          children: [
                            jsx('span', { className: 'evo-tl-title-text', children: p.name }),
                            jsx('span', { className: 'evo-tl-row-sub', children: t('subchatCount').replace('{n}', String(p.count)) }),
                          ],
                        }),
                        colorFor === key && jsx('div', {
                          className: 'evo-tl-palette',
                          ref: colorAnchorRef,
                          children: TAG_PALETTE.map((color) => jsx('button', {
                            type: 'button',
                            className: 'evo-tl-color-swatch',
                            'data-active': projectTagColors[p.path] === color || undefined,
                            style: { background: color },
                            title: projectTagColors[p.path] === color ? t('removeTag') : t('tag'),
                            'aria-label': projectTagColors[p.path] === color ? t('removeTagColor') : t('setTagColor'),
                            onClick: (e: { stopPropagation(): void }) => {
                              e.stopPropagation()
                              onSetProjectTagColor(p.path, projectTagColors[p.path] === color ? null : color)
                              setColorFor(null)
                            },
                          }, color)),
                        }),
                        jsx('div', {
                          className: 'evo-tl-row-acts',
                          'data-menu-open': menuFor === key || undefined,
                          onClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
                          children: [
                            jsxs('div', {
                              className: 'evo-tl-row-more',
                              ref: menuFor === key ? menuAnchorRef : undefined,
                              children: [
                                jsx('button', {
                                  type: 'button',
                                  className: 'evo-tl-row-act',
                                  title: t('moreActions'),
                                  'aria-label': t('moreActions'),
                                  'data-on': menuFor === key || undefined,
                                  onClick: (e: { stopPropagation(): void }) => {
                                    e.stopPropagation()
                                    setMenuFor((v) => (v === key ? null : key))
                                  },
                                  children: jsx(MoreHorizontal, {}),
                                }),
                                menuFor === key && jsx('div', {
                                  className: 'evo-tl-row-menu',
                                  onClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
                                  children: [
                                    jsx('button', {
                                      type: 'button',
                                      className: 'evo-tl-menu-item',
                                      onClick: () => { setMenuFor(null); setRenameValue(p.name); setRenaming(key) },
                                      children: jsxs(Fragment, { children: [jsx(Pencil, {}), jsx('span', { children: t('renameProject') })] }),
                                    }),
                                    jsx('button', {
                                      type: 'button',
                                      className: 'evo-tl-menu-item',
                                      onClick: () => { setMenuFor(null); setColorFor((v) => (v === key ? null : key)) },
                                      children: jsxs(Fragment, { children: [jsx(Palette, {}), jsx('span', { children: t('tagColor') })] }),
                                    }),
                                    jsx('button', {
                                      type: 'button',
                                      className: 'evo-tl-menu-item',
                                      onClick: () => { setMenuFor(null); onToggleProjectArchive(p.path) },
                                      children: jsxs(Fragment, { children: [jsx(Archive, {}), jsx('span', { children: t('archiveProject') })] }),
                                    }),
                                    jsx('div', { className: 'evo-tl-menu-sep' }),
                                    jsx('button', {
                                      type: 'button',
                                      className: 'evo-tl-menu-item evo-tl-menu-danger',
                                      onClick: () => { setMenuFor(null); setConfirmDeleteProjectPath(p.path) },
                                      children: jsxs(Fragment, { children: [jsx(Trash2, {}), jsx('span', { children: t('deleteProject') })] }),
                                    }),
                                  ],
                                }),
                              ],
                            }),
                          ],
                        }),
                        jsx(ChevronRight, {}),
                      ],
                    }, p.path)
                  })()
                  ),
                ],
              })
            : // ── 项目内子聊天列表（对应图谱 Chat Node）──
              jsxs(Fragment, {
                children: [
                  jsxs('div', {
                    className: 'evo-tl-section evo-tl-subchat-section',
                    children: [
                      jsxs('div', {
                        className: 'evo-tl-subchat-head',
                        children: [
                          jsxs('span', {
                            className: 'evo-tl-subchat-project',
                            children: [
                              jsx(FolderGit2, {}),
                              jsx('span', { children: projectMode.name }),
                            ],
                          }),
                          jsx('button', {
                            type: 'button',
                            className: 'evo-tl-section-action',
                            title: t('projectBack'),
                            'aria-label': t('projectBack'),
                            onClick: () => { setProjectScope(null); setQuery(''); setMenuFor(null) },
                            children: jsx(ArrowLeft, {}),
                          }),
                        ],
                      }),
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
            : chatRenderItems.map((item) => item.kind === 'placeholder'
              ? placeholder(item.key)
              : (() => {
                const s = item.value
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
                  className: `evo-tl-row${isDragging('chats', s.id) ? ' evo-tl-row-dragging' : ''}`,
                  'data-active': s.id === currentId || undefined,
                  'data-evo-dnd-id': s.id,
                  'data-evo-dnd-scope': 'chats',
                  children: [
                    canReorder && dragGrip('chats', s.id, s.displayTitle ?? s.id.slice(0, 12), formatWhen(s.titleTime ?? s.updatedAt)),
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
                      ref: colorAnchorRef,
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
                          ref: menuFor === s.id ? menuAnchorRef : undefined,
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
              })()),
                ],
              }),
        // ── 已归档分区（§26.3 Archive：保留数据，可恢复）──
        archivedRows.length > 0 && jsxs('div', {
          className: 'evo-tl-section evo-tl-archived-sessions',
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
        dragState?.active === true && jsxs('div', {
          className: 'evo-tl-drag-preview',
          'aria-hidden': true,
          style: { left: dragState.clientX + 14, top: dragState.clientY + 14 },
          children: [
            jsx(dragState.scope === 'projects' ? FolderGit2 : MessageSquare, {}),
            jsxs('span', {
              children: [
                jsx('strong', { children: dragState.label }),
                dragState.detail !== '' && jsx('small', { children: dragState.detail }),
              ],
            }),
          ],
        }),
      ],
    }),
    // ── 已归档项目（置底固定：不随列表滚动，展开可查看子聊天）──
    archivedProjectList.length > 0 && jsxs('div', {
      className: 'evo-tl-footer',
      children: [
        jsxs('button', {
          type: 'button',
          className: 'evo-tl-archived-toggle',
          'aria-expanded': showArchivedProjects || undefined,
          onClick: () => setShowArchivedProjects((v) => !v),
          children: [
            jsx(ChevronRight, { className: `evo-tool-chev${showArchivedProjects ? ' open' : ''}` }),
            jsx(Archive, {}),
            jsx('span', { children: `${t('archivedProjects')} (${archivedProjectList.length})` }),
          ],
        }),
        showArchivedProjects && jsx('div', {
          className: 'evo-tl-archived-list',
          children: archivedProjectList.map((p) => jsxs(Fragment, {
            children: [
              jsxs('div', {
                className: `evo-tl-row evo-tl-archived-row evo-tl-project-row${expandedArchivedProject === p.path ? ' evo-tl-archived-open' : ''}`,
                'data-evo-dnd-id': p.path,
                'data-evo-dnd-scope': 'projects',
                onClick: () => { setExpandedArchivedProject((v) => (v === p.path ? null : p.path)); setMenuFor(null); setColorFor(null) },
                children: [
                  jsx(ChevronRight, { className: `evo-tool-chev${expandedArchivedProject === p.path ? ' open' : ''}` }),
                  jsx(FolderGit2, {}),
                  projectTagColors[p.path] !== undefined && jsx('span', {
                    className: 'evo-tl-color-dot',
                    style: { background: projectTagColors[p.path] },
                    title: t('tagged'),
                  }),
                  jsxs('div', {
                    className: 'evo-tl-project-main',
                    children: [
                      jsx('span', { className: 'evo-tl-title-text', children: p.name }),
                      jsx('span', { className: 'evo-tl-row-sub', children: t('subchatCount').replace('{n}', String(p.count)) }),
                    ],
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
                              onToggleProjectArchive(p.path)
                            },
                            children: jsx(ArchiveRestore, {}),
                          }),
                          jsx('button', {
                            type: 'button',
                            className: 'evo-tl-row-act evo-tl-row-act-del',
                            title: t('deleteProject'),
                            'aria-label': t('deleteProject'),
                            onClick: (e: { stopPropagation(): void }) => {
                              e.stopPropagation()
                              setConfirmDeleteProjectPath(p.path)
                            },
                            children: jsx(Trash2, {}),
                          }),
                        ],
                      }),
                    ],
              }),
              expandedArchivedProject === p.path && jsx('div', {
                className: 'evo-tl-archived-subchats',
                children: archivedProjectChats(p.path).map((s) => jsxs('div', {
                  className: 'evo-tl-row evo-tl-archived-row evo-tl-archived-subrow',
                  'data-active': s.id === currentId || undefined,
                  children: [
                    jsx('button', {
                      type: 'button',
                      className: 'evo-tl-row-main',
                      title: s.displayTitle ?? s.id.slice(0, 12),
                      onClick: () => onOpen(s.id),
                      children: jsxs(Fragment, {
                        children: [
                          jsx('span', { className: 'evo-tl-title-text', children: s.displayTitle ?? s.id.slice(0, 12) }),
                          jsx('div', { className: 'evo-tl-row-sub', children: formatWhen(s.titleTime ?? s.updatedAt) }),
                        ],
                      }),
                    }),
                  ],
                }, s.id)),
              }),
            ],
          }, p.path)),
        }),
      ],
    }),
    confirmDeleteProjectPath !== null && jsx(ConfirmDialog, {
      title: t('deleteProject'),
      message: t('deleteArchivedProjectMsg'),
      confirmLabel: t('deleteProject'),
      danger: true,
      children: jsxs('label', {
        className: 'evo-confirm-check',
        children: [
          jsx('input', {
            type: 'checkbox',
            checked: deleteProjectDisk,
            onChange: (e: { currentTarget: HTMLInputElement }) => setDeleteProjectDisk(e.currentTarget.checked),
          }),
          jsx('span', { children: t('deleteDiskFiles') }),
        ],
      }),
      onConfirm: () => { if (confirmDeleteProjectPath !== null) runDeleteProject(confirmDeleteProjectPath, deleteProjectDisk) },
      onClose: () => { setConfirmDeleteProjectPath(null); setDeleteProjectDisk(false) },
    }),
    ],
  })
}
