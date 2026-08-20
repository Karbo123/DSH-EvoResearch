/**
 * Chat Graph 面板（§ChatGraph）：聊天图——chat/memory 节点 + 连线。
 *
 * 语义：
 * - chat node：真实会话（sessionId）；左侧两个输入端口：context（唯一，蓝）/ memory（多条，绿），
 *   右侧 output（品牌色）供下游继承上下文。
 * - memory node：内嵌文本（旧节点继续可用）或引用真实资料（ref：note/file/pdf/dir，GRAPH-04）；
 *   引用预览实时读取目标文件（GRAPH-08：文件更新后预览同步），双击打开只读预览（PDF 新窗口）。
 * - 连线：context（唯一，创建时一次性 fork）；memory（多条，持续参考——可连 memory 节点
 *   也可连 chat 节点）；非 context 边可附自然语言说明 label（GRAPH-07，右键编辑/删除）。
 * - 交互：右键画布新建节点；拖 output → input 连线（context 唯一，重复连接自动替换）；
 *   拖节点标题移动位置；双击 chat node 打开会话 / memory 节点编辑内容或打开引用；
 *   右键节点重命名/删除/分出新方向/转笔记；右键连线编辑说明/删除。
 * - 数据：后端 graph-get/graph-save/graph-add-node/graph-add-edge/graph-inherit（按项目存储）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'
import { t } from './i18n'
import { toast } from './toast'
import { MessageSquare, Database, GitBranch, Trash2, Pencil, Globe, FolderGit2, X, FileText, Check, Unlink, File, Search, BookOpen, FlaskConical, Code2, FileCode2 } from 'lucide-react'
import { ChatGraphCanvas } from './chatgraph-canvas'
import type { GraphCanvasMenu } from './chatgraph-canvas'
import type { Connection } from '@xyflow/react'
import { runChatGraphLayout } from './chatgraph-layout'
import { ContextTraceDrawer } from './context-trace'

/**
 * 节点几何（Blender 节点编辑器风格）：
 * - 标题栏 24px（类型色渐变）+ 主体（socket 行 18px）；
 * - chat：标题 24 + padding 4 + ctx 行 + mem 行 + padding 6 → 总高 76；
 * - memory：标题 24 + 主体（标签/预览 两行）→ 总高 58。
 * socket 圆心坐标（画布坐标）与 CSS 内边距对齐。
 */
const NODE_W = 176
const CHAT_H = 76
const MEMORY_H = 58
/** 引用节点：第一行（标签+文件名）+ 第二行（实时预览）→ 58 + 18 */
const MEMORY_REF_H = 76
const TITLE_H = 24

export interface GraphNodeRef {
  kind: 'note' | 'file' | 'pdf' | 'dir' | 'memory' | 'session' | 'paper' | 'experiment' | 'run' | 'log' | 'result' | 'code' | 'latex' | 'manuscript'
  path: string
}

export interface GraphNode {
  id: string
  type: 'chat' | 'memory' | 'resource'
  displayKind?: string
  title: string
  x: number
  y: number
  sessionId?: string
  workspaceDir?: string
  content?: string
  ref?: GraphNodeRef
  locator?: string
  scope?: 'project' | 'global'
  groupId?: string
  pinned?: boolean
  origin?: 'user' | 'agent' | 'imported'
  createdAt?: number
  updatedAt?: number
  status?: 'available' | 'missing' | 'running' | 'failed' | 'indexing'
}
export interface GraphEdge {
  id: string
  from: string
  to: string
  toPort: 'context' | 'memory'
  label?: string
  behavior?: 'fork' | 'reference' | 'relation'
  enabled?: boolean
  routePoints?: Array<{ x: number; y: number }>
  labelPosition?: { x: number; y: number }
  labelWidth?: number
  labelHeight?: number
  labelHidden?: boolean
  routingVersion?: number
}
export interface GraphGroup {
  id: string
  title: string
  kind?: 'exploration' | 'experiment' | 'freeform'
  collapsed?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
  parentId?: string
  pinned?: boolean
  createdAt?: number
}
export interface ChatGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  groups?: GraphGroup[]
}

interface ChatGraphPanelProps {
  cwd: string | null
  currentSessionId?: string | null
  /** 打开会话（切换到对话 tab） */
  onOpenSession: (id: string) => void
  /** 新建真实会话（返回新会话 id；null 表示失败） */
  onCreateSession: () => Promise<string | null>
}

export function ChatGraphPanel({ cwd, currentSessionId, onOpenSession, onCreateSession }: ChatGraphPanelProps) {
  const [graph, setGraph] = useState<ChatGraph>({ nodes: [], edges: [] })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 右键菜单：nodeId 或 edgeId 二选一（都是画布坐标弹层）
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId?: string; edgeId?: string } | null>(null)
  // 记忆节点内容编辑（双击或菜单打开）
  const [editing, setEditing] = useState<GraphNode | null>(null)
  const [editText, setEditText] = useState('')
  // 引用节点只读预览弹窗（双击引用节点打开；GRAPH-04/08）
  const [viewer, setViewer] = useState<GraphNode | null>(null)
  const [viewerText, setViewerText] = useState('')
  const [viewerError, setViewerError] = useState<string | null>(null)
  // 引用节点预览缓存：nodeId → 预览结果（实时读取，graph 引用集合变化时刷新）
  const [refPreviews, setRefPreviews] = useState<Record<string, { ok: boolean; text?: string; error?: string }>>({})
  // 节点搜索（GRAPH-11：顶部搜索框过滤节点与边）
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<'all' | 'neighbors' | 'branch'>('all')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [layoutUndo, setLayoutUndo] = useState<ChatGraph | null>(null)
  const [layoutPreview, setLayoutPreview] = useState<{ previous: ChatGraph; next: ChatGraph; warning?: string } | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [advancedMode, setAdvancedMode] = useState(false)
  const [contextDrawerOpen, setContextDrawerOpen] = useState(false)
  const [contextQuestion, setContextQuestion] = useState('')
  const [traceHighlightedIds, setTraceHighlightedIds] = useState<Set<string>>(new Set())
  // 图修订号（乐观并发：整图保存携带，服务端比对不一致则拒绝）
  const revRef = useRef<number | null>(null)
  // 整图保存串行化：同窗口连续操作按序提交，避免互相冲突
  const saveChainRef = useRef<Promise<void>>(Promise.resolve())

  const load = () => {
    setError(null)
    void api<{ graph?: ChatGraph; rev?: number; error?: string }>('graph-get', { workspaceDir: cwd ?? undefined })
      .then((r) => {
        if (typeof r?.error === 'string' && r.error !== '') { setError(r.error); return }
        setGraph({ nodes: r?.graph?.nodes ?? [], edges: r?.graph?.edges ?? [], groups: r?.graph?.groups })
        revRef.current = typeof r?.rev === 'number' ? r.rev : null
      })
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }
  useEffect(() => { load() }, [cwd])

  // ChatArea publishes the question at the beginning of a turn.  A new turn
  // clears the previous temporary trace highlight; persisted graph data is
  // never changed by this visual state.
  useEffect(() => {
    const onQuestion = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; question?: string }>).detail
      if (detail?.sessionId !== currentSessionId) return
      setContextQuestion(typeof detail.question === 'string' ? detail.question : '')
      setTraceHighlightedIds(new Set())
    }
    window.addEventListener('evo-context-question', onQuestion)
    return () => window.removeEventListener('evo-context-question', onQuestion)
  }, [currentSessionId])

  /** 整图保存（乐观并发 + FIFO 串行）。冲突 → 提示并重新加载最新状态。 */
  const saveGraph = (next: ChatGraph): Promise<boolean> => {
    setError(null)
    const pending = saveChainRef.current.then(async () => {
      try {
        const r = await api<{ ok: boolean; conflict?: boolean; rev?: number; error?: string }>('graph-save', {
          workspaceDir: cwd ?? undefined, graph: next, rev: revRef.current ?? undefined,
        })
        if (r?.ok === true && typeof r.rev === 'number') { revRef.current = r.rev; return true }
        if (r?.conflict === true) toast(t('graphConflict'))
        if (typeof r?.error === 'string' && r.error !== '') setError(r.error)
        load()
        return false
      } catch (e: unknown) {
        setError(String((e as Error)?.message ?? e))
        load()
        return false
      }
    })
    saveChainRef.current = pending.then(() => undefined, () => undefined)
    return pending
  }

  // ── 引用资料预览（GRAPH-04/08）──

  /** 引用目标绝对路径（note 相对笔记目录；file/pdf/dir 相对项目工作区或绝对）。 */
  const absRefPath = (node: GraphNode): string | null => {
    const ref = node.ref
    if (ref === undefined || cwd === null) return null
    const join = (base: string, p: string) => (base.endsWith('\\') || base.endsWith('/') ? base + p : `${base}\\${p}`)
    // Global Memory nodes may store an absolute note locator. Resolve it before
    // applying the project note root; otherwise a valid global document would
    // be looked up below the currently open project.
    if (ref.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(ref.path)) return ref.path
    if (ref.kind === 'note') return join(join(cwd, '.evoresearch-data\\memories\\notes'), ref.path)
    if (ref.kind === 'session' || ref.kind === 'memory') return null
    return join(cwd, ref.path)
  }

  /** 读取引用节点预览（实时读文件；优先新增 Remote graph-preview，未接入时回退现有 fs 接口）。返回预览文本或 null。 */
  const loadRefPreview = async (node: GraphNode): Promise<string | null> => {
    if (node.ref === undefined) return null
    try {
      const r = await api<{ ok?: boolean; text?: string; error?: string; preview?: { ok?: boolean; text?: string; error?: string } }>('graph-preview', { workspaceDir: cwd ?? undefined, nodeId: node.id })
      const preview = r.preview ?? r
      if (preview.ok === true && typeof preview.text === 'string') {
        setRefPreviews((prev) => ({ ...prev, [node.id]: { ok: true, text: preview.text } }))
        setGraph((prev) => ({ ...prev, nodes: prev.nodes.map((item) => item.id === node.id ? { ...item, status: 'available' as const } : item) }))
        return preview.text
      }
      const err = preview.error ?? ''
      setRefPreviews((prev) => ({ ...prev, [node.id]: { ok: false, error: err } }))
      setGraph((prev) => ({ ...prev, nodes: prev.nodes.map((item) => item.id === node.id ? { ...item, status: 'missing' as const } : item) }))
      return null
    } catch {
      // 回退：直接读文件/目录（现有 /evoresearch/fs/read、/list）
      try {
        const abs = absRefPath(node)
        if (abs === null) return null
        if (node.ref.kind === 'dir') {
          const res = await fetch('/evoresearch/fs/list', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: abs }),
          })
          const json = await res.json()
          if (json.ok) {
            const entries = (json.value.entries as Array<{ name: string; isDir: boolean }>).slice(0, 20)
            const text = entries.map((e) => (e.isDir ? `${e.name}/` : e.name)).join('\n')
            setRefPreviews((prev) => ({ ...prev, [node.id]: { ok: true, text } }))
            return text
          }
          const err = String((json.error as { message?: string })?.message ?? '')
          setRefPreviews((prev) => ({ ...prev, [node.id]: { ok: false, error: err } }))
          return null
        }
        const res = await fetch('/evoresearch/fs/read', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: abs }),
        })
        const json = await res.json()
        if (json.ok) {
          const text = String((json.value as { text?: string })?.text ?? '')
          setRefPreviews((prev) => ({ ...prev, [node.id]: { ok: true, text } }))
          return text
        }
        const err = String((json.error as { message?: string })?.message ?? '')
        setRefPreviews((prev) => ({ ...prev, [node.id]: { ok: false, error: err } }))
        return null
      } catch {
        setRefPreviews((prev) => ({ ...prev, [node.id]: { ok: false, error: t('graphRefMissing') } }))
        return null
      }
    }
  }

  // 引用集合变化（新增/换引用/换项目）时刷新预览；同一引用不重复读
  const refSetKey = graph.nodes.filter((n) => n.ref !== undefined).map((n) => `${n.id}:${n.ref!.kind}:${n.ref!.path}`).join('|')
  useEffect(() => {
    if (refSetKey === '') return
    for (const node of graph.nodes) {
      if (node.ref !== undefined) void loadRefPreview(node)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refSetKey, cwd])

  // ── 操作 ──
  /** 新节点坐标：优先菜单位置；否则找画布空白区域（避开已有节点矩形）。 */
  const freeSpot = (fallbackX: number, fallbackY: number): { x: number; y: number } => {
    const occupied = graph.nodes.map((n) => ({ x: n.x, y: n.y, w: NODE_W, h: n.type === 'chat' ? CHAT_H : (n.ref !== undefined ? MEMORY_REF_H : MEMORY_H) }))
    const hit = (x: number, y: number) => occupied.some((o) => x < o.x + o.w + 16 && x + NODE_W + 16 > o.x && y < o.y + o.h + 16 && y + MEMORY_H + 16 > o.y)
    if (!hit(fallbackX, fallbackY)) return { x: fallbackX, y: fallbackY }
    // 螺旋搜索空白（步长 40，半径 4 圈）
    for (let r = 1; r <= 6; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const x = fallbackX + dx * 48
          const y = fallbackY + dy * 48
          if (x < 0 || y < 0) continue
          if (!hit(x, y)) return { x, y }
        }
      }
    }
    return { x: fallbackX + 40, y: fallbackY + 40 }
  }

  const createChatNode = async () => {
    setMenu(null)
    if (cwd === null) { setError(t('graphNeedProject')); return }
    setBusy(true)
    try {
      const sessionId = await onCreateSession()
      if (sessionId === null) { setError(t('graphCreateSessionFailed')); return }
      const spot = freeSpot(menu?.x ?? 60, menu?.y ?? 60)
      const node: Omit<GraphNode, 'id'> = {
        type: 'chat',
        title: t('graphNewChat'),
        x: spot.x,
        y: spot.y,
        sessionId,
        workspaceDir: cwd,
      }
      const created = await api<{ node: GraphNode; rev?: number }>('graph-add-node', { workspaceDir: cwd, node })
      setGraph((prev) => ({ ...prev, nodes: [...prev.nodes, created.node] }))
      if (typeof created.rev === 'number') revRef.current = created.rev
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const appendCreatedNode = (created: { node: GraphNode; rev?: number }) => {
    setGraph((prev) => ({ ...prev, nodes: [...prev.nodes, created.node] }))
    setSelectedId(created.node.id)
    if (typeof created.rev === 'number') revRef.current = created.rev
  }

  const createMemoryNode = (scope: 'project' | 'global') => {
    setMenu(null)
    if (cwd === null) { setError(t('graphNeedProject')); return }
    const spot = freeSpot(menu?.x ?? 60, menu?.y ?? 60)
    void api<{ node: GraphNode; rev?: number }>('graph-memory-create', {
      workspaceDir: cwd,
      title: scope === 'global' ? t('graphGlobalMemory') : t('graphProjectMemory'),
      scope, x: spot.x, y: spot.y,
    })
      .then(appendCreatedNode)
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }

  const createMemoryCollection = (scope: 'project' | 'global' = 'project') => {
    setMenu(null)
    if (cwd === null) { setError(t('graphNeedProject')); return }
    const spot = freeSpot(menu?.x ?? 60, menu?.y ?? 60)
    void api<{ node: GraphNode; rev?: number }>('graph-memory-collection', {
      workspaceDir: cwd,
      title: scope === 'global' ? t('graphGlobalCollection') : t('graphProjectCollection'),
      scope, x: spot.x, y: spot.y,
    })
      .then(appendCreatedNode)
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }

  const copyMemoryNode = (nodeId: string) => {
    setMenu(null)
    if (cwd === null) { setError(t('graphNeedProject')); return }
    const source = nodeById(nodeId)
    if (source === undefined) return
    void api<{ node: GraphNode; rev?: number }>('graph-memory-copy', {
      workspaceDir: cwd, nodeId, title: t('graphCopyTitle').replace('{title}', source.title),
      ...freeSpot(source.x + NODE_W + 36, source.y),
    })
      .then(appendCreatedNode)
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }

  /** Reuse a single existing Memory locator; when not on the graph, add one reference node. */
  const useExistingMemory = () => {
    setMenu(null)
    if (cwd === null) { setError(t('graphNeedProject')); return }
    const raw = window.prompt(t('graphUseMemoryPrompt'), '')
    if (raw === null || raw.trim() === '') return
    const value = raw.trim().toLowerCase()
    const matches = graph.nodes.filter((node) =>
      (node.type === 'memory' || node.displayKind === 'memory' || node.displayKind === 'memory-collection')
      && [node.title, node.locator ?? '', node.ref?.path ?? ''].some((candidate) => candidate.toLowerCase().includes(value)),
    )
    const existing = matches[0]
    if (existing !== undefined) {
      setSelectedId(existing.id)
      setViewMode('all')
      connectReferenceFromNode(existing)
      return
    }
    const isCollection = /collection|集合/i.test(raw)
    const kind: GraphNodeRef['kind'] = isCollection ? 'memory' : 'note'
    const spot = freeSpot(menu?.x ?? 60, menu?.y ?? 60)
    void api<{ node: GraphNode; rev?: number }>('graph-add-node', {
      workspaceDir: cwd,
      operationId: `memory-reference-${raw}`,
      node: {
        type: 'resource', displayKind: isCollection ? 'memory-collection' : 'memory',
        title: raw.split(/[\\/]/).filter(Boolean).pop() ?? raw,
        x: spot.x, y: spot.y, scope: 'project', origin: 'user',
        ref: { kind, path: raw }, locator: `project:${isCollection ? 'collection' : 'memory'}:${raw}`,
      },
    }).then((created) => {
      appendCreatedNode(created)
      connectReferenceFromNode(created.node)
    }).catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }

  const deleteNode = (id: string) => {
    setMenu(null)
    setSelectedId(null)
    setGraph((prev) => {
      const next = { ...prev, nodes: prev.nodes.filter((n) => n.id !== id), edges: prev.edges.filter((e) => e.from !== id && e.to !== id) }
      saveGraph(next)
      return next
    })
  }

  /** 断开某节点的上下文继承（移除其 context 边；已 fork 的会话保留、独立演进）。 */
  const disconnectContext = (id: string) => {
    setMenu(null)
    setGraph((prev) => {
      const next = { ...prev, edges: prev.edges.filter((e) => !(e.to === id && e.toPort === 'context')) }
      saveGraph(next)
      return next
    })
  }

  const renameNode = (id: string) => {
    setMenu(null)
    const node = graph.nodes.find((n) => n.id === id)
    if (node === undefined) return
    const title = window.prompt(t('graphRename'), node.title)
    if (title === null || title.trim() === '') return
    setGraph((prev) => {
      const next = { ...prev, nodes: prev.nodes.map((n) => (n.id === id ? { ...n, title: title.trim() } : n)) }
      saveGraph(next)
      return next
    })
  }

  const openChatNode = (node: GraphNode) => {
    if (node.type === 'chat' && node.sessionId !== undefined) onOpenSession(node.sessionId)
  }

  const openTraceResource = (target: string, kind: string) => {
    if (kind === 'url') {
      window.open(target, '_blank', 'noopener,noreferrer')
      return
    }
    if (kind === 'chat' || kind === 'session') {
      onOpenSession(target)
      return
    }
    const base = cwd ?? ''
    const absolute = /^[A-Za-z]:[\\/]/.test(target) || target.startsWith('/')
      ? target
      : `${base.replace(/[\\/]$/, '')}/${target.replace(/^[\\/]+/, '')}`
    window.open(`/evoresearch/fs/file?path=${encodeURIComponent(absolute)}`, '_blank', 'noopener,noreferrer')
  }

  /** 双击引用节点：打开只读预览（文本弹窗；PDF/二进制新窗口打开标签页）。 */
  const openRefViewer = (node: GraphNode) => {
    setMenu(null)
    if (node.ref === undefined) return
    const abs = absRefPath(node)
    if (node.ref.kind === 'pdf' || node.ref.kind === 'paper') {
      if (abs !== null) window.open(`/evoresearch/fs/file?path=${encodeURIComponent(abs)}`, '_blank')
      return
    }
    setViewer(node)
    setViewerText('')
    setViewerError(null)
    void loadRefPreview(node).then((text) => {
      if (text !== null) { setViewerText(text); setViewerError(null) }
      else {
        const p = refPreviews[node.id]
        setViewerError(p?.error ?? t('graphRefMissing'))
      }
    })
  }

  /** 从当前聊天分出新方向（GRAPH-10 语义的图内入口）：新建 chat 节点 + context 继承连线。 */
  const forkDirection = async (nodeId: string) => {
    setMenu(null)
    if (cwd === null) { setError(t('graphNeedProject')); return }
    const source = nodeById(nodeId)
    if (source === undefined) return
    setBusy(true)
    let created: { node: GraphNode; rev?: number } | null = null
    try {
      const sessionId = await onCreateSession()
      if (sessionId === null) { setError(t('graphCreateSessionFailed')); return }
      // 新节点放在源节点右侧（避开已有节点）
      const spot = freeSpot(source.x + NODE_W + 48, source.y)
      const node: Omit<GraphNode, 'id'> = {
        type: 'chat', title: t('graphNewBranch'), x: spot.x, y: spot.y, sessionId, workspaceDir: cwd,
      }
      created = await api<{ node: GraphNode; rev?: number }>('graph-add-node', { workspaceDir: cwd, node })
      if (typeof created.rev === 'number') revRef.current = created.rev
      // context 连线由 graph-inherit 原子完成（fork 源会话历史 → 换绑新节点）
      const r = await api<{ ok: boolean; sessionId?: string; notice?: string; error?: string; rev?: number }>('graph-inherit', {
        workspaceDir: cwd, fromNodeId: nodeId, toNodeId: created.node.id,
      })
      if (r.ok !== true) {
        setError(r.error ?? t('graphForkFailed'))
        // 回滚：删除刚建的节点（继承失败时图不应残留空分支）
        setGraph((prev) => {
          const next = { ...prev, nodes: prev.nodes.filter((n) => n.id !== created?.node.id), edges: prev.edges.filter((e) => e.from !== created?.node.id && e.to !== created?.node.id) }
          saveGraph(next)
          return next
        })
        return
      }
      if (typeof r.notice === 'string' && r.notice !== '') toast(r.notice)
      load()
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  /** 内嵌文本 memory node → Markdown 笔记（GRAPH-06；Remote graph-convert-note）。 */
  const convertNodeToNote = (nodeId: string) => {
    setMenu(null)
    if (cwd === null) { setError(t('graphNeedProject')); return }
    void api<{ ok: boolean; noteId?: string; error?: string }>('graph-convert-note', { workspaceDir: cwd, nodeId })
      .then((r) => {
        if (r.ok !== true) { setError(r.error ?? t('graphConvertFailed')); return }
        toast(t('graphConverted'))
        load()
      })
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }

  /** 编辑连线自然语言说明（GRAPH-07；仅非 context 边）。 */
  const editEdgeLabel = (edgeId: string) => {
    setMenu(null)
    const edge = graph.edges.find((e) => e.id === edgeId)
    if (edge === undefined || edge.toPort === 'context') return
    const label = window.prompt(t('graphEdgeLabelHint'), edge.label ?? '')
    if (label === null) return
    setGraph((prev) => {
      const next = {
        ...prev,
        edges: prev.edges.map((e) => (e.id === edgeId ? { ...e, label: label.trim() === '' ? undefined : label.trim() } : e)),
      }
      saveGraph(next)
      return next
    })
  }

  /** 删除连线（只删视图引用，GRAPH-09）。 */
  const deleteEdge = (edgeId: string) => {
    setMenu(null)
    setGraph((prev) => {
      const next = { ...prev, edges: prev.edges.filter((e) => e.id !== edgeId) }
      saveGraph(next)
      return next
    })
  }

  const startEditMemory = (node: GraphNode) => {
    setMenu(null)
    setEditing(node)
    setEditText(node.content ?? '')
    if (node.ref !== undefined) {
      void loadRefPreview(node).then((text) => { if (text !== null) setEditText(text) })
    }
  }
  const saveEditMemory = () => {
    if (editing === null) return
    const id = editing.id
    const content = editText
    setEditing(null)
    if (editing.ref !== undefined) {
      void api<{ ok?: boolean; node?: GraphNode; error?: string }>('graph-memory-write', {
        workspaceDir: cwd ?? undefined, nodeId: id, content,
        operationId: `memory-write-${id}-${Date.now().toString(36)}`,
      }).then((result) => {
        if (result.ok !== true) { setError(result.error ?? t('graphMemoryWriteFailed')); return }
        if (result.node !== undefined) setGraph((previous) => ({ ...previous, nodes: previous.nodes.map((node) => node.id === id ? result.node! : node) }))
      }).catch((error: unknown) => setError(String((error as Error)?.message ?? error)))
      return
    }
    setGraph((prev) => {
      const next = { ...prev, nodes: prev.nodes.map((n) => (n.id === id ? { ...n, content } : n)) }
      saveGraph(next)
      return next
    })
  }

  const nodeById = (id: string): GraphNode | undefined => graph.nodes.find((n) => n.id === id)

  // GRAPH-11 搜索过滤：匹配节点 id 集合（空 query 时不过滤）；边仅两端都匹配时显示
  const matchedIds = (() => {
    const q = query.trim().toLowerCase()
    if (q === '') return null
    return new Set(graph.nodes.filter((n) => n.title.toLowerCase().includes(q)
      || (n.ref !== undefined && n.ref.path.toLowerCase().includes(q))).map((n) => n.id))
  })()

  const focusedNodeId = graph.nodes.find((node) => node.type === 'chat' && node.sessionId === currentSessionId)?.id
    ?? selectedId
  const visibleIds = (() => {
    const all = new Set(graph.nodes.map((node) => node.id))
    if (viewMode === 'all' && collapsedGroups.size === 0) return all
    const keep = new Set<string>()
    if (viewMode === 'all') graph.nodes.forEach((node) => keep.add(node.id))
    if (focusedNodeId !== undefined && focusedNodeId !== null) {
      keep.add(focusedNodeId)
      const connected = graph.edges.filter((edge) => edge.from === focusedNodeId || edge.to === focusedNodeId)
      for (const edge of connected) { keep.add(edge.from); keep.add(edge.to) }
      if (viewMode === 'branch') {
        let changed = true
        while (changed) {
          changed = false
          for (const edge of graph.edges) {
            if (edge.toPort !== 'context') continue
            if (keep.has(edge.to) && !keep.has(edge.from)) { keep.add(edge.from); changed = true }
            if (keep.has(edge.from) && !keep.has(edge.to)) { keep.add(edge.to); changed = true }
          }
        }
      }
      if (viewMode === 'neighbors') {
        for (const edge of connected) {
          const secondHop = graph.edges.filter((candidate) => candidate.from === edge.to || candidate.to === edge.to)
          for (const candidate of secondHop) { keep.add(candidate.from); keep.add(candidate.to) }
        }
      }
    }
    for (const node of graph.nodes) {
      const group = node.groupId
      const collapsed = group !== undefined && (collapsedGroups.has(group) || graph.groups?.some((item) => item.id === group && item.collapsed) === true)
      if (collapsed) keep.delete(node.id)
    }
    return keep
  })()

  const layoutVisible = () => {
    const selected = new Set([...visibleIds].filter((id) => selectedId === null || id === selectedId || viewMode !== 'all'))
    const targets = graph.nodes
      .filter((node) => selected.has(node.id) && node.pinned !== true)
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id))
    if (targets.length === 0) return
    setBusy(true)
    void runChatGraphLayout({
      nodes: graph.nodes.filter((node) => visibleIds.has(node.id)).map((node) => ({
        id: node.id, x: node.x, y: node.y, width: NODE_W, height: node.type === 'chat' ? CHAT_H : node.ref !== undefined ? MEMORY_REF_H : MEMORY_H,
        createdAt: node.createdAt, pinned: node.pinned, selected: selected.has(node.id), groupId: node.groupId,
      })),
      groups: (graph.groups ?? []).filter((group) => graph.nodes.some((node) => node.groupId === group.id && visibleIds.has(node.id))).map((group) => ({
        id: group.id, title: group.title, x: group.x, y: group.y, width: group.width, height: group.height,
        collapsed: group.collapsed || collapsedGroups.has(group.id), parentId: group.parentId, pinned: group.pinned, createdAt: group.createdAt,
      })),
      edges: graph.edges.filter((edge) => visibleIds.has(edge.from) || visibleIds.has(edge.to)),
    }).then((result) => {
      const changes = new Map(result.positions.map((position) => [position.id, position]))
      const groupChanges = new Map((result.groupPositions ?? []).map((position) => [position.id.replace(/^group:/, ''), position]))
      const routeChanges = new Map((result.routes ?? []).map((route) => [route.id, route]))
      const next = {
        ...graph,
        nodes: graph.nodes.map((node) => { const position = changes.get(node.id); return position === undefined ? node : { ...node, x: position.x, y: position.y } }),
        groups: (graph.groups ?? []).map((group) => {
          const position = groupChanges.get(group.id)
          return position === undefined ? group : { ...group, x: position.x, y: position.y }
        }),
        edges: graph.edges.map((edge) => {
          const route = routeChanges.get(edge.id)
          return route === undefined ? edge : {
            ...edge,
            routePoints: route.points,
            ...(route.labelPosition === undefined ? {} : { labelPosition: route.labelPosition }),
            labelHidden: route.labelHidden === true,
            routingVersion: (edge.routingVersion ?? 0) + 1,
          }
        }),
      }
      setGraph(next)
      setLayoutPreview({ previous: graph, next, ...(result.warning === undefined ? {} : { warning: result.warning }) })
      if (result.warning !== undefined) toast(t('graphLayoutFallback').replace('{msg}', result.warning))
    }).catch((error: unknown) => setError(String((error as Error)?.message ?? error))).finally(() => setBusy(false))
  }

  const confirmLayout = () => {
    if (layoutPreview === null) return
    const preview = layoutPreview
    void saveGraph(preview.next).then((ok) => {
      if (!ok) {
        setGraph(preview.previous)
        return
      }
      setLayoutUndo(preview.previous)
      setLayoutPreview(null)
    })
  }

  const cancelLayout = () => {
    if (layoutPreview === null) return
    setGraph(layoutPreview.previous)
    setLayoutPreview(null)
  }

  /** 可选人工固定资料入口；自动 Memory 链接发现不依赖此操作。 */
  const addResourceNode = () => {
    setMenu(null)
    if (cwd === null) { setError(t('graphNeedProject')); return }
    const rawPath = window.prompt(t('graphResourcePathPrompt'), '')
    if (rawPath === null || rawPath.trim() === '') return
    const value = rawPath.trim()
    const lower = value.toLowerCase()
    const kind = lower.endsWith('.pdf') ? 'paper'
      : lower.endsWith('.tex') || lower.endsWith('.bib') ? 'latex'
        : /\.(py|ts|tsx|js|jsx|java|cpp|c|rs|go)$/.test(lower) ? 'code'
          : /(^|[\\/])(experiments?)([\\/]|$)/.test(lower) ? 'experiment'
            : 'file'
    const title = value.split(/[\\/]/).filter(Boolean).pop() ?? value
    const spot = freeSpot(menu?.x ?? 60, menu?.y ?? 60)
    void api<{ node: GraphNode; rev?: number }>('graph-add-node', {
      workspaceDir: cwd,
      node: { type: 'resource', displayKind: kind, title, x: spot.x, y: spot.y, ref: { kind, path: value }, scope: 'project', origin: 'user' },
    }).then((created) => {
      setGraph((prev) => ({ ...prev, nodes: [...prev.nodes, created.node] }))
      if (typeof created.rev === 'number') revRef.current = created.rev
    }).catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }

  const undoLayout = () => {
    if (layoutPreview !== null) { cancelLayout(); return }
    if (layoutUndo === null) return
    const previous = layoutUndo
    setLayoutUndo(null)
    setGraph(previous)
    saveGraph(previous)
  }

  const toggleEdgeMode = (edgeId: string) => {
    setMenu(null)
    setGraph((prev) => {
      const next = { ...prev, edges: prev.edges.map((edge) => {
        if (edge.id !== edgeId || edge.toPort === 'context') return edge
        const behavior: GraphEdge['behavior'] = edge.behavior === 'relation' ? 'reference' : 'relation'
        return { ...edge, behavior, enabled: behavior === 'reference' ? true : false }
      }) }
      saveGraph(next)
      return next
    })
  }

  const toggleEdgeEnabled = (edgeId: string) => {
    setMenu(null)
    setGraph((prev) => {
      const next = { ...prev, edges: prev.edges.map((edge) => edge.id === edgeId && edge.toPort !== 'context' ? { ...edge, enabled: edge.enabled === false } : edge) }
      saveGraph(next)
      return next
    })
  }

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
    setGraph((prev) => {
      const next = {
        ...prev,
        groups: (prev.groups ?? []).map((group) => group.id === groupId ? { ...group, collapsed: !group.collapsed } : group),
      }
      saveGraph(next)
      return next
    })
  }

  const removeGroup = (groupId: string) => {
    const group = graph.groups?.find((item) => item.id === groupId)
    if (group === undefined || cwd === null) return
    setCollapsedGroups((previous) => {
      const next = new Set(previous)
      next.delete(groupId)
      return next
    })
    void api<{ ok?: boolean; error?: string }>('graph-remove-group', {
      workspaceDir: cwd, groupId, operationId: `group-remove-${groupId}-${Date.now().toString(36)}`,
    }).then((result) => {
      if (result.ok !== true) { setError(result.error ?? t('graphDeleteGroupFailed')); return }
      load()
    }).catch((error: unknown) => setError(String((error as Error)?.message ?? error)))
  }

  const togglePinned = (nodeId: string) => {
    setMenu(null)
    setGraph((previous) => {
      const next = { ...previous, nodes: previous.nodes.map((node) => node.id === nodeId ? { ...node, pinned: node.pinned !== true } : node) }
      saveGraph(next)
      return next
    })
  }

  const selectedNode = selectedId === null ? undefined : graph.nodes.find((node) => node.id === selectedId)
  const selectedParents = selectedNode === undefined ? [] : graph.edges.filter((edge) => edge.to === selectedNode.id).map((edge) => graph.nodes.find((node) => node.id === edge.from)).filter((node): node is GraphNode => node !== undefined)
  const selectedChildren = selectedNode === undefined ? [] : graph.edges.filter((edge) => edge.from === selectedNode.id).map((edge) => graph.nodes.find((node) => node.id === edge.to)).filter((node): node is GraphNode => node !== undefined)
  const selectedReferenceEdges = selectedNode === undefined ? [] : graph.edges.filter((edge) => edge.to === selectedNode.id && edge.toPort === 'memory' && edge.behavior !== 'relation')
  const selectedRelationEdges = selectedNode === undefined ? [] : graph.edges.filter((edge) => (edge.from === selectedNode.id || edge.to === selectedNode.id) && edge.behavior === 'relation')

  const canvasMenuPosition = (event: MouseEvent): GraphCanvasMenu => {
    const canvas = (event.currentTarget as HTMLElement | null)?.closest('.evo-graph-canvas')
    const rect = canvas?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }
  const onCanvasNodeContextMenu = (event: MouseEvent, node: GraphNode) => {
    setSelectedId(node.id)
    setMenu({ ...canvasMenuPosition(event), nodeId: node.id })
  }
  const onCanvasEdgeContextMenu = (event: MouseEvent, edge: GraphEdge) => {
    setSelectedId(null)
    setMenu({ ...canvasMenuPosition(event), edgeId: edge.id })
  }
  const onCanvasConnect = (connection: Connection) => {
    if (connection.source === null || connection.target === null || connection.source === connection.target) return
    const targetPort = connection.targetHandle === 'context' ? 'context' : 'memory'
    setMenu(null)
    if (targetPort === 'context') {
      void api<{ ok: boolean; notice?: string; error?: string }>('graph-inherit', { workspaceDir: cwd ?? undefined, fromNodeId: connection.source, toNodeId: connection.target })
        .then((result) => { if (result.ok !== true) setError(result.error ?? t('graphInheritFailed')); else { if (result.notice !== undefined) toast(result.notice); load() } })
        .catch((error: unknown) => setError(String((error as Error)?.message ?? error)))
      return
    }
    void api<{ edge?: GraphEdge; rev?: number; error?: string }>('graph-add-edge', {
      workspaceDir: cwd ?? undefined,
      operationId: `canvas-reference-${connection.source}-${connection.target}-${Date.now().toString(36)}`,
      edge: { from: connection.source, to: connection.target, toPort: 'memory', behavior: 'reference', enabled: true },
    }).then((result) => {
      if (result.edge === undefined) { setError(result.error ?? t('graphRefEdgeSaveFailed')); load(); return }
      setGraph((previous) => ({ ...previous, edges: [...previous.edges, result.edge!] }))
      if (typeof result.rev === 'number') revRef.current = result.rev
    }).catch((error: unknown) => { setError(String((error as Error)?.message ?? error)); load() })
  }

  const currentChatNode = graph.nodes.find((node) => node.type === 'chat' && node.sessionId === currentSessionId)
    ?? (selectedId === null ? undefined : graph.nodes.find((node) => node.id === selectedId && node.type === 'chat'))

  /** 普通模式的自然语言操作：不要求研究者理解 Handle/port。 */
  const connectReferenceFromNode = (source: GraphNode) => {
    const target = currentChatNode
    if (target === undefined || source.id === target.id) { setError(t('graphNeedTargetChat')); return }
    if (graph.edges.some((edge) => edge.from === source.id && edge.to === target.id && edge.toPort === 'memory' && edge.behavior !== 'relation')) return
    void api<{ edge?: GraphEdge; rev?: number }>('graph-add-edge', {
      workspaceDir: cwd ?? undefined,
      operationId: `reference-${source.id}-${target.id}`,
      edge: { from: source.id, to: target.id, toPort: 'memory', behavior: 'reference', enabled: true },
    }).then((result) => {
      if (result.edge !== undefined) setGraph((previous) => ({ ...previous, edges: [...previous.edges, result.edge!] }))
      if (typeof result.rev === 'number') revRef.current = result.rev
    }).catch((error: unknown) => setError(String((error as Error)?.message ?? error)))
  }

  const createNaturalRelation = (node: GraphNode) => {
    const source = currentChatNode
    if (source === undefined || source.id === node.id) { setError(t('graphNeedTargetChat')); return }
    const label = window.prompt(t('graphRelationLabelPrompt'), '')
    if (label === null) return
    void api<{ edge?: GraphEdge; rev?: number }>('graph-add-edge', {
      workspaceDir: cwd ?? undefined,
      operationId: `relation-${source.id}-${node.id}-${Date.now().toString(36)}`,
      edge: { from: source.id, to: node.id, toPort: 'memory', behavior: 'relation', enabled: false, label: label.trim() },
    }).then((result) => {
      if (result.edge !== undefined) setGraph((previous) => ({ ...previous, edges: [...previous.edges, result.edge!] }))
      if (typeof result.rev === 'number') revRef.current = result.rev
    }).catch((error: unknown) => setError(String((error as Error)?.message ?? error)))
  }
  const onCanvasPositionsChange = (positions: Array<{ id: string; x: number; y: number }>) => {
    if (positions.length === 0) return
    setGraph((previous) => {
      const changes = new Map(positions.map((position) => [position.id, position]))
      const movedIds = new Set(positions.map((position) => position.id))
      const next = {
        ...previous,
        nodes: previous.nodes.map((node) => { const position = changes.get(node.id); return position === undefined ? node : { ...node, x: Math.max(0, Math.round(position.x)), y: Math.max(0, Math.round(position.y)) } }),
        // A manual move invalidates only incident route geometry; it must not
        // leave a stale ELK path crossing the newly moved card.
        edges: previous.edges.map((edge) => movedIds.has(edge.from) || movedIds.has(edge.to)
          ? { ...edge, routePoints: undefined, labelPosition: undefined }
          : edge),
      }
      saveGraph(next)
      return next
    })
  }
  const graphMenu = menu === null ? null : jsxs('div', {
    className: 'evo-graph-menu',
    style: { left: menu.x, top: menu.y },
    onClick: (event: MouseEvent) => event.stopPropagation(),
    children: [
      menu.nodeId === undefined && menu.edgeId === undefined && jsx('button', { type: 'button', className: 'evo-graph-menu-item', disabled: busy || cwd === null, onClick: () => { void createChatNode() }, children: t('graphNewChat') }),
      menu.nodeId === undefined && menu.edgeId === undefined && jsx('button', { type: 'button', className: 'evo-graph-menu-item', disabled: cwd === null, onClick: () => createMemoryNode('project'), children: t('graphNewMemory') }),
      menu.edgeId !== undefined && jsx('button', { type: 'button', className: 'evo-graph-menu-item', onClick: () => editEdgeLabel(menu.edgeId as string), children: t('graphEditLabel') }),
      menu.edgeId !== undefined && jsx('button', { type: 'button', className: 'evo-graph-menu-item', onClick: () => toggleEdgeMode(menu.edgeId as string), children: t('graphToggleEdge') }),
      menu.edgeId !== undefined && jsx('button', { type: 'button', className: 'evo-graph-menu-item evo-graph-menu-danger', onClick: () => deleteEdge(menu.edgeId as string), children: t('graphDeleteEdge') }),
      menu.nodeId !== undefined && jsx('button', { type: 'button', className: 'evo-graph-menu-item', onClick: () => renameNode(menu.nodeId as string), children: t('graphRename') }),
      menu.nodeId !== undefined && jsx('button', { type: 'button', className: 'evo-graph-menu-item', onClick: () => togglePinned(menu.nodeId as string), children: nodeById(menu.nodeId)?.pinned === true ? t('graphUnpinNode') : t('graphPinNode') }),
      menu.nodeId !== undefined && nodeById(menu.nodeId)?.type === 'chat' && jsx('button', { type: 'button', className: 'evo-graph-menu-item', disabled: busy, onClick: () => forkDirection(menu.nodeId as string), children: t('graphBranchFromHere') }),
      menu.nodeId !== undefined && nodeById(menu.nodeId)?.type !== 'chat' && jsx('button', { type: 'button', className: 'evo-graph-menu-item', onClick: () => { const node = nodeById(menu.nodeId as string); if (node !== undefined) startEditMemory(node) }, children: t('graphEditMemory') }),
      menu.nodeId !== undefined && nodeById(menu.nodeId)?.type !== 'chat' && jsx('button', { type: 'button', className: 'evo-graph-menu-item', onClick: () => useExistingMemory(), children: t('graphUseExistingMemory') }),
      menu.nodeId !== undefined && nodeById(menu.nodeId)?.type !== 'chat' && (nodeById(menu.nodeId)?.displayKind === 'memory' || nodeById(menu.nodeId)?.displayKind === 'memory-collection' || nodeById(menu.nodeId)?.type === 'memory') && jsx('button', { type: 'button', className: 'evo-graph-menu-item', onClick: () => copyMemoryNode(menu.nodeId as string), children: t('graphCopyMemory') }),
      menu.nodeId !== undefined && jsx('button', { type: 'button', className: 'evo-graph-menu-item evo-graph-menu-danger', onClick: () => deleteNode(menu.nodeId as string), children: t('graphDeleteNode') }),
    ],
  })

  return jsxs('div', {
    className: 'evo-graph',
    children: [
      jsxs('div', { className: 'evo-graph-toolbar', children: [
        jsx('span', { className: 'evo-graph-title', children: t('chatGraph') }),
        jsx('span', { style: { flex: 1 } }),
        // GRAPH-11：节点搜索（过滤标题/引用路径）
        jsxs('label', { className: 'evo-graph-search', children: [
          jsx(Search, { 'aria-hidden': true }),
          jsx('input', {
            type: 'text',
            'aria-label': t('graphSearchAria'),
            placeholder: t('graphSearchNodes'),
            value: query,
            onInput: (e) => setQuery(e.currentTarget.value),
          }),
        ]}),
        jsx('button', {
          type: 'button', className: 'evo-graph-btn', disabled: busy || cwd === null,
          title: t('graphNewChat'), onClick: () => { setMenu({ x: 40, y: 40 }); void createChatNode() },
          children: jsxs(Fragment, { children: [jsx(MessageSquare, {}), jsx('span', { children: t('graphNewChat') })] }),
        }),
        jsx('button', {
          type: 'button', className: 'evo-graph-btn', disabled: cwd === null,
          title: t('graphNewMemory'), onClick: () => createMemoryNode('project'),
          children: jsxs(Fragment, { children: [jsx(Database, {}), jsx('span', { children: t('graphNewMemory') })] }),
        }),
        jsx('button', {
          type: 'button', className: 'evo-graph-btn', disabled: cwd === null,
          title: t('graphNewGlobal'), onClick: () => createMemoryNode('global'),
          children: jsxs(Fragment, { children: [jsx(Globe, {}), jsx('span', { children: t('graphNewGlobal') })] }),
        }),
        jsx('button', {
          type: 'button', className: 'evo-graph-btn', disabled: cwd === null,
          title: t('graphUseExistingMemory'), onClick: useExistingMemory,
          children: jsxs(Fragment, { children: [jsx(Database, {}), jsx('span', { children: t('graphUseExisting') })] }),
        }),
        jsx('button', {
          type: 'button', className: 'evo-graph-btn', disabled: cwd === null,
          title: t('graphNewCollection'), onClick: () => createMemoryCollection(),
          children: jsxs(Fragment, { children: [jsx(FolderGit2, {}), jsx('span', { children: t('graphNewCollectionShort') })] }),
        }),
        jsx('button', {
          type: 'button', className: 'evo-graph-btn', disabled: cwd === null,
          title: t('graphPinResource'), onClick: addResourceNode,
          children: jsxs(Fragment, { children: [jsx(File, {}), jsx('span', { children: t('graphPinResource') })] }),
        }),
        jsx('button', {
          type: 'button', className: 'evo-graph-btn', title: t('graphFocusNeighbors'),
          onClick: () => setViewMode((mode) => mode === 'neighbors' ? 'all' : 'neighbors'),
          children: t('graphFocusNeighbors'),
        }),
        jsx('button', {
          type: 'button', className: 'evo-graph-btn', title: t('graphFocusBranch'),
          onClick: () => setViewMode((mode) => mode === 'branch' ? 'all' : 'branch'),
          children: t('graphFocusBranch'),
        }),
        jsx('button', {
          type: 'button', className: 'evo-graph-btn', title: t('graphLayout'), disabled: busy,
          onClick: layoutVisible,
          children: layoutPreview === null ? t('graphLayoutBtn') : t('graphRelayoutBtn'),
        }),
        layoutPreview !== null && jsx('button', {
          type: 'button', className: 'evo-graph-btn evo-graph-btn-primary', title: t('graphConfirmLayoutTitle'), onClick: confirmLayout,
          children: t('graphConfirmSave'),
        }),
        layoutPreview !== null && jsx('button', {
          type: 'button', className: 'evo-graph-btn', title: t('graphCancelLayoutTitle'), onClick: cancelLayout,
          children: t('graphCancelPreview'),
        }),
        layoutUndo !== null && jsx('button', {
          type: 'button', className: 'evo-graph-btn', title: t('graphUndoLayout'), onClick: undoLayout,
          children: t('graphUndoLayout'),
        }),
        jsx('button', {
          type: 'button', className: `evo-graph-btn${advancedMode ? ' active' : ''}`, title: advancedMode ? t('graphHidePortsTitle') : t('graphShowPortsTitle'),
          'aria-pressed': advancedMode,
          onClick: () => setAdvancedMode((value) => !value),
          children: advancedMode ? t('graphAdvancedPorts') : t('graphNormalOps'),
        }),
        jsx('button', {
          type: 'button', className: 'evo-graph-btn', title: t('graphViewTurnRefsTitle'),
          onClick: () => setContextDrawerOpen(true),
          children: t('contextTraceTitle'),
        }),
        ...(graph.groups ?? []).map((group) => jsx('button', {
          type: 'button', className: 'evo-graph-btn', title: group.collapsed || collapsedGroups.has(group.id) ? t('graphExpandGroupTitle') : t('graphCollapseGroupTitle'),
          onClick: () => toggleGroup(group.id),
          children: `${group.collapsed || collapsedGroups.has(group.id) ? t('graphExpand') : t('graphCollapse')} ${group.title}`,
        }, `group-${group.id}`)),
        ...(graph.groups ?? []).map((group) => jsx('button', {
          type: 'button', className: 'evo-graph-btn evo-graph-btn-danger', title: t('graphDeleteGroupTitle').replace('{title}', group.title),
          onClick: () => removeGroup(group.id),
          children: t('graphDeleteGroup').replace('{title}', group.title),
        }, `remove-group-${group.id}`)),
      ]}),
      error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
      jsx(ChatGraphCanvas, {
        graph,
        visibleIds,
        matchedIds,
        focusedNodeId,
        selectedId,
        refPreviews,
        advancedMode,
        traceHighlightedIds,
        menu,
        menuElement: graphMenu,
        busy,
        onSelect: (id: string | null) => { setSelectedId(id); setMenu(null) },
        onOpen: (node: GraphNode) => { if (node.type === 'chat') openChatNode(node); else if (node.displayKind === 'memory' || node.displayKind === 'memory-collection' || node.type === 'memory') startEditMemory(node); else if (node.ref !== undefined) openRefViewer(node); else startEditMemory(node) },
        onEdit: startEditMemory,
        onDelete: deleteNode,
        onContextMenu: setMenu,
        onNodeContextMenu: onCanvasNodeContextMenu,
        onEdgeContextMenu: onCanvasEdgeContextMenu,
        onConnect: onCanvasConnect,
        onNaturalBranch: (node: GraphNode) => { void forkDirection(node.id) },
        onNaturalReference: connectReferenceFromNode,
        onNaturalRelation: createNaturalRelation,
        onToggleGroup: toggleGroup,
        onNodePositionsChange: onCanvasPositionsChange,
        onNarrowOpen: (node: GraphNode) => { setSelectedId(node.id); if (node.type === 'chat') openChatNode(node); else if (node.displayKind === 'memory' || node.displayKind === 'memory-collection' || node.type === 'memory') startEditMemory(node); else if (node.ref !== undefined) openRefViewer(node); else startEditMemory(node) },
      }),
      contextDrawerOpen && jsx(ContextTraceDrawer, {
        sessionId: currentSessionId ?? '',
        workspaceDir: cwd ?? undefined,
        question: contextQuestion,
        graph,
        onClose: () => setContextDrawerOpen(false),
        onOpenNode: (nodeId: string) => { setSelectedId(nodeId); setTraceHighlightedIds((previous) => new Set([...previous, nodeId])) },
        onOpenSession,
        onOpenResource: openTraceResource,
        onGraphChanged: load,
        onHighlight: (ids: Set<string>) => setTraceHighlightedIds(ids),
        onError: (message: string) => setError(message),
      }),
      selectedNode !== undefined && inspectorOpen && jsxs('aside', {
        className: 'evo-graph-inspector',
        'aria-label': t('graphInspectorAria'),
        children: [
          jsxs('div', { className: 'evo-graph-inspector-head', children: [
            jsx('strong', { children: selectedNode.title }),
            jsx('span', { style: { flex: 1 } }),
            jsx('button', { type: 'button', className: 'evo-icon-btn', title: t('graphCloseInspector'), 'aria-label': t('graphCloseInspector'), onClick: () => setInspectorOpen(false), children: jsx(X, {}) }),
          ]}),
          jsxs('div', { className: 'evo-graph-inspector-meta', children: [
            jsx('span', { children: selectedNode.type === 'chat' ? t('graphChat') : (selectedNode.displayKind ?? t('graphResource')) }),
            jsx('span', { children: selectedNode.scope === 'global' ? t('graphGlobal') : t('graphProject') }),
            selectedNode.status !== undefined && jsx('span', { className: `evo-graph-status evo-graph-status-${selectedNode.status}`, children: selectedNode.status }),
          ]}),
          selectedNode.sessionId !== undefined && jsx('code', { children: selectedNode.sessionId }),
          selectedNode.ref !== undefined && jsx('code', { title: selectedNode.ref.path, children: selectedNode.ref.path }),
          selectedNode.content !== undefined && selectedNode.content.trim() !== '' && jsx('p', { className: 'evo-graph-inspector-preview', children: selectedNode.content.replace(/\s+/g, ' ').slice(0, 260) }),
          selectedNode.type === 'chat' && jsx('button', { type: 'button', className: 'evo-graph-inspector-action', onClick: () => openChatNode(selectedNode), children: t('graphOpenChat') }),
          (selectedNode.displayKind === 'memory' || selectedNode.displayKind === 'memory-collection' || selectedNode.type === 'memory') && jsx('button', { type: 'button', className: 'evo-graph-inspector-action', onClick: () => startEditMemory(selectedNode), children: t('graphEditMemory') }),
          selectedNode.ref !== undefined && jsx('button', { type: 'button', className: 'evo-graph-inspector-action', onClick: () => openRefViewer(selectedNode), children: t('graphOpenResource') }),
          selectedNode.type === 'chat' && selectedReferenceEdges.length > 0 && jsxs('div', { className: 'evo-graph-inspector-links', children: [
            jsx('span', { children: t('graphAnswerRefs') }),
            ...selectedReferenceEdges.map((edge) => {
              const source = graph.nodes.find((node) => node.id === edge.from)
              return jsxs('div', { className: 'evo-graph-inspector-reference', children: [
                jsx('button', { type: 'button', onClick: () => source !== undefined && setSelectedId(source.id), children: source?.title ?? edge.from }),
                jsx('button', { type: 'button', className: 'evo-graph-inspector-toggle', 'aria-pressed': edge.enabled !== false, onClick: () => toggleEdgeEnabled(edge.id), children: edge.enabled === false ? t('graphEnabledOff') : t('graphEnabledOn') }),
              ] }, `reference-${edge.id}`)
            }),
          ] }),
          selectedRelationEdges.length > 0 && jsxs('div', { className: 'evo-graph-inspector-links', children: [jsx('span', { children: t('graphRelation') }), ...selectedRelationEdges.map((edge) => jsx('button', { type: 'button', onClick: () => editEdgeLabel(edge.id), children: edge.label || t('graphUnnamedRelation') }, `relation-${edge.id}`))] }),
          selectedParents.length > 0 && jsxs('div', { className: 'evo-graph-inspector-links', children: [jsx('span', { children: t('graphUpstream') }), ...selectedParents.map((node) => jsx('button', { type: 'button', onClick: () => setSelectedId(node.id), children: node.title }, `parent-${node.id}`))] }),
          selectedChildren.length > 0 && jsxs('div', { className: 'evo-graph-inspector-links', children: [jsx('span', { children: t('graphDownstream') }), ...selectedChildren.map((node) => jsx('button', { type: 'button', onClick: () => setSelectedId(node.id), children: node.title }, `child-${node.id}`))] }),
        ],
      }),
      selectedNode !== undefined && !inspectorOpen && jsx('button', { type: 'button', className: 'evo-graph-inspector-reopen', title: t('graphOpenInspector'), 'aria-label': t('graphOpenInspector'), onClick: () => setInspectorOpen(true), children: t('graphInspector') }),
      graph.nodes.length === 0 && jsx('div', { className: 'evo-graph-hint', children: jsxs(Fragment, { children: [
        jsx(GitBranch, {}),
        jsx('span', { children: t('graphEmptyHint') }),
      ]})}),
      // 记忆节点内容编辑弹窗
      editing !== null && jsxs('div', {
        className: 'evo-graph-editor-mask',
        onClick: () => setEditing(null),
        children: [
          jsxs('div', {
            className: 'evo-graph-editor',
            onClick: (e) => e.stopPropagation(),
            children: [
              jsxs('div', { className: 'evo-graph-editor-head', children: [
                jsx('span', { className: 'evo-graph-editor-title', children: editing.title }),
                jsx('span', { style: { flex: 1 } }),
                jsx('button', {
                  type: 'button', className: 'evo-icon-btn', title: t('graphClose'),
                  'aria-label': t('graphClose'),
                  onClick: () => setEditing(null),
                  children: jsx(X, {}),
                }),
              ]}),
              jsx('textarea', {
                className: 'evo-graph-editor-text',
                value: editText,
                placeholder: t('graphEditContentHint'),
                autoFocus: true,
                onInput: (e) => setEditText(e.currentTarget.value),
              }),
              jsxs('div', { className: 'evo-graph-editor-foot', children: [
                jsx('span', { className: 'evo-graph-editor-hint', children: t('graphEditContentHint2') }),
                jsx('span', { style: { flex: 1 } }),
                jsx('button', {
                  type: 'button', className: 'evo-btn evo-btn-run',
                  onClick: saveEditMemory,
                  children: jsxs(Fragment, { children: [jsx(Check, {}), jsx('span', { children: t('save') })] }),
                }),
              ]}),
            ],
          }),
        ],
      }),
      // 引用资料只读预览弹窗（GRAPH-04/08：双击引用节点打开；实时读取目标文件）
      viewer !== null && jsxs('div', {
        className: 'evo-graph-editor-mask',
        onClick: () => setViewer(null),
        children: [
          jsxs('div', {
            className: 'evo-graph-editor evo-graph-viewer',
            onClick: (e) => e.stopPropagation(),
            children: [
              jsxs('div', { className: 'evo-graph-editor-head', children: [
                jsx('span', { className: 'evo-graph-editor-title', children: jsxs(Fragment, { children: [
                  viewer.title,
                  jsx('span', { className: 'evo-graph-viewer-path', children: viewer.ref?.path ?? '' }),
                ]})}),
                jsx('span', { style: { flex: 1 } }),
                jsx('button', {
                  type: 'button', className: 'evo-icon-btn', title: t('graphClose'),
                  'aria-label': t('graphClose'),
                  onClick: () => setViewer(null),
                  children: jsx(X, {}),
                }),
              ]}),
              viewerError !== null
                ? jsx('div', { className: 'evo-graph-viewer-error', children: viewerError })
                : jsx('pre', { className: 'evo-graph-viewer-text', children: viewerText }),
              jsxs('div', { className: 'evo-graph-editor-foot', children: [
                jsx('span', { className: 'evo-graph-editor-hint', children: t('graphOpenRef') }),
                jsx('span', { style: { flex: 1 } }),
                viewer.ref !== undefined && (viewer.ref.kind === 'pdf' || viewer.ref.kind === 'paper') && jsx('button', {
                  type: 'button', className: 'evo-btn',
                  onClick: () => { const abs = absRefPath(viewer); if (abs !== null) window.open(`/evoresearch/fs/file?path=${encodeURIComponent(abs)}`, '_blank') },
                  children: jsxs(Fragment, { children: [jsx(FileText, {}), jsx('span', { children: t('graphOpenTab') })] }),
                }),
              ]}),
            ],
          }),
        ],
      }),
    ],
  })
}

/** 引用类型图标（GRAPH-04 节点展示）。 */
function refKindIcon(kind: GraphNodeRef['kind']): typeof File {
  if (kind === 'dir') return FolderGit2
  if (kind === 'pdf' || kind === 'paper') return BookOpen
  if (kind === 'experiment' || kind === 'run' || kind === 'log') return FlaskConical
  if (kind === 'code') return Code2
  if (kind === 'latex' || kind === 'manuscript') return FileCode2
  return File
}

/** 引用显示名：路径 basename（截断）。 */
export function refDisplayName(refPath: string): string {
  const base = refPath.split(/[\\/]/).filter((s) => s !== '').pop() ?? refPath
  return base.length > 18 ? `${base.slice(0, 17)}…` : base
}

/** 简单 POST JSON 封装（与 panels.ts 同款）。 */
async function api<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`/evoresearch/fs/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(json.error?.message ?? t('graphApiFailed'))
  return json.value as T
}
