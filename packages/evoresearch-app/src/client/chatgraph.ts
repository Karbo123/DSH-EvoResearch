/**
 * Chat Graph 面板（§ChatGraph）：聊天图——chat/memory 节点 + 连线。
 *
 * 语义：
 * - chat node：真实会话（sessionId）；左侧两个输入端口：context（唯一，蓝）/ memory（多条，绿），
 *   右侧 output（品牌色）供下游继承上下文。
 * - memory node：一段记忆（project 级文本 / global 级如 SOUL.md）；右侧 output 连到
 *   chat node 的 memory 输入 = 该会话使用此记忆。
 * - 交互：右键画布新建节点；拖 output → input 连线（context 唯一，重复连接自动替换）；
 *   拖节点标题移动位置；双击 chat node 打开会话；右键节点重命名/删除。
 * - 数据：后端 graph-get/graph-save（按项目存储）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from './i18n'
import { toast } from './toast'
import { MessageSquare, Database, GitBranch, Plus, Trash2, Pencil, Globe, FolderGit2, X, FileText, Check, Unlink } from 'lucide-react'

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
const TITLE_H = 24

interface GraphNode {
  id: string
  type: 'chat' | 'memory'
  title: string
  x: number
  y: number
  sessionId?: string
  workspaceDir?: string
  content?: string
  scope?: 'project' | 'global'
}
interface GraphEdge {
  id: string
  from: string
  to: string
  toPort: 'context' | 'memory'
}
interface ChatGraph { nodes: GraphNode[]; edges: GraphEdge[] }

/** 端口位置（画布坐标；与 CSS socket 布局对齐：标题栏 24px + 行高 18px）。 */
function portPos(node: GraphNode, port: 'context' | 'memory' | 'output'): { x: number; y: number } {
  if (node.type === 'chat') {
    // ctx 行圆心 y = 24 + 4(padding) + 9(socket 半高) = 37；mem 行 +18 = 55；output 与输入对齐 46
    if (port === 'context') return { x: node.x, y: node.y + 37 }
    if (port === 'memory') return { x: node.x, y: node.y + 55 }
    return { x: node.x + NODE_W, y: node.y + 46 }
  }
  // memory：标题 24 + 主体（标签行）→ output 圆心 y = 24 + 8 = 32
  return { x: node.x + NODE_W, y: node.y + 32 }
}

/** 水平贝塞尔连线路径。 */
function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = Math.max(28, (to.x - from.x) / 2)
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`
}

interface ChatGraphPanelProps {
  cwd: string | null
  /** 打开会话（切换到对话 tab） */
  onOpenSession: (id: string) => void
  /** 新建真实会话（返回新会话 id；null 表示失败） */
  onCreateSession: () => Promise<string | null>
}

export function ChatGraphPanel({ cwd, onOpenSession, onCreateSession }: ChatGraphPanelProps) {
  const [graph, setGraph] = useState<ChatGraph>({ nodes: [], edges: [] })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null)
  const [linking, setLinking] = useState<{ from: string; toX: number; toY: number } | null>(null)
  const [dragNode, setDragNode] = useState<{ id: string; dx: number; dy: number } | null>(null)
  // 记忆节点内容编辑（双击或菜单打开）
  const [editing, setEditing] = useState<GraphNode | null>(null)
  const [editText, setEditText] = useState('')
  // 端口实测坐标（画布坐标）：以 DOM socket 圆心为锚点，保证连线与圆点像素级对齐
  const [portMap, setPortMap] = useState<Record<string, { x: number; y: number }>>({})
  const hoverPortRef = useRef<{ nodeId: string; port: 'context' | 'memory' } | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  // 图修订号（乐观并发：整图保存携带，服务端比对不一致则拒绝）
  const revRef = useRef<number | null>(null)
  // 整图保存串行化：同窗口连续操作按序提交，避免互相冲突
  const saveChainRef = useRef<Promise<void>>(Promise.resolve())

  const load = () => {
    setError(null)
    void api<{ graph?: ChatGraph; rev?: number; error?: string }>('graph-get', { workspaceDir: cwd ?? undefined })
      .then((r) => {
        if (typeof r?.error === 'string' && r.error !== '') { setError(r.error); return }
        setGraph({ nodes: r?.graph?.nodes ?? [], edges: r?.graph?.edges ?? [] })
        revRef.current = typeof r?.rev === 'number' ? r.rev : null
      })
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }
  useEffect(() => { load() }, [cwd])

  /** 整图保存（乐观并发 + FIFO 串行）。冲突 → 提示并重新加载最新状态。 */
  const saveGraph = (next: ChatGraph) => {
    setError(null)
    saveChainRef.current = saveChainRef.current.then(async () => {
      try {
        const r = await api<{ ok: boolean; conflict?: boolean; rev?: number; error?: string }>('graph-save', {
          workspaceDir: cwd ?? undefined, graph: next, rev: revRef.current ?? undefined,
        })
        if (r?.ok === true && typeof r.rev === 'number') revRef.current = r.rev
        else if (r?.conflict === true) { toast(t('graphConflict')); load() }
        else if (typeof r?.error === 'string' && r.error !== '') setError(r.error)
      } catch (e: unknown) {
        setError(String((e as Error)?.message ?? e))
      }
    }).catch(() => undefined)
  }

  // 节点/socket 渲染后（含拖拽过程中每帧移动后）重新测量端口圆心；
  // 连线据此绘制，避免手算几何与真实 CSS 布局的偏差。
  useLayoutEffect(() => {
    const cr = canvasRef.current?.getBoundingClientRect()
    if (cr === undefined) return
    const map: Record<string, { x: number; y: number }> = {}
    document.querySelectorAll('.evo-graph-socket').forEach((el) => {
      const nodeEl = (el as HTMLElement).closest('.evo-graph-node')
      const nid = nodeEl?.getAttribute('data-node-id')
      if (nid === null || nid === undefined || nid === '') return
      const cls = (el as HTMLElement).classList
      const port = cls.contains('evo-graph-socket-out') ? 'output' : cls.contains('evo-graph-socket-ctx') ? 'context' : 'memory'
      const r = (el as HTMLElement).getBoundingClientRect()
      map[`${nid}:${port}`] = { x: r.left - cr.left + r.width / 2, y: r.top - cr.top + r.height / 2 }
    })
    setPortMap(map)
  }, [graph])

  /** 端口画布坐标：优先实测值（与 socket 圆心像素对齐），首帧回退几何估算。 */
  const portOf = (node: GraphNode, port: 'context' | 'memory' | 'output') =>
    portMap[`${node.id}:${port}`] ?? portPos(node, port)

  // ── 连线拖拽：window 级 move/up ──
  useEffect(() => {
    if (linking === null) return
    const onMove = (e: PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      setLinking((v) => (v === null ? null : { ...v, toX: e.clientX - rect.left, toY: e.clientY - rect.top }))
    }
    const onUp = (e: PointerEvent) => {
      // 命中检测：找鼠标附近（12px 内）最近的输入端口——不依赖精确像素命中，
      // 节点重叠/遮挡时依然可连
      let target: { nodeId: string; port: 'context' | 'memory' } | null = null
      let bestDist = 12
      const inPorts = document.querySelectorAll<HTMLElement>('.evo-graph-socket-in')
      for (const el of inPorts) {
        const r = el.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const d = Math.hypot(e.clientX - cx, e.clientY - cy)
        if (d < bestDist) {
          bestDist = d
          target = {
            nodeId: el.closest('.evo-graph-node')?.getAttribute('data-node-id') ?? '',
            port: el.classList.contains('evo-graph-socket-ctx') ? 'context' as const : 'memory' as const,
          }
        }
      }
      if (target === null) target = hoverPortRef.current
      if (target !== null && target.nodeId !== '' && linking !== null && target.nodeId !== linking.from) {
        if (target.port === 'context') {
          // §上下文初始化继承：context 连线由 graph-inherit 原子完成
          // （fork 源会话历史 → 目标节点重新绑定 → context 边唯一替换 → 落盘），
          // 避免与前端 graph-save 竞争覆盖；只有一层、非递归、非运行时注入
          void api<{ ok: boolean; sessionId?: string; replaced?: boolean; notice?: string; error?: string }>(
            'graph-inherit',
            { workspaceDir: cwd ?? undefined, fromNodeId: linking.from, toNodeId: target.nodeId },
          )
            .then((r) => {
              if (!r?.ok) setError(r?.error ?? t('graphInheritFailed'))
              else {
                if (typeof r.notice === 'string' && r.notice !== '') toast(r.notice)
                load()
              }
            })
            .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
        } else {
          setGraph((prev) => {
            const id = `e${Date.now().toString(36)}`
            const next = { ...prev, edges: [...prev.edges, { id, from: linking.from, to: target.nodeId, toPort: 'memory' as const }] }
            saveGraph(next)
            return next
          })
        }
      }
      setLinking(null)
      hoverPortRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [linking, cwd])

  // ── 节点拖拽 ──
  useEffect(() => {
    if (dragNode === null) return
    const onMove = (e: PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      const x = Math.max(0, Math.round(e.clientX - rect.left - dragNode.dx))
      const y = Math.max(0, Math.round(e.clientY - rect.top - dragNode.dy))
      setGraph((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.id === dragNode.id ? { ...n, x, y } : n)) }))
    }
    const onUp = () => {
      setDragNode(null)
      setGraph((prev) => {
        saveGraph(prev)
        return prev
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [dragNode, cwd])

  // ── 操作 ──
  /** 新节点坐标：优先菜单位置；否则找画布空白区域（避开已有节点矩形）。 */
  const freeSpot = (fallbackX: number, fallbackY: number): { x: number; y: number } => {
    const occupied = graph.nodes.map((n) => ({ x: n.x, y: n.y, w: NODE_W, h: n.type === 'chat' ? CHAT_H : MEMORY_H }))
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

  const createMemoryNode = (scope: 'project' | 'global') => {
    setMenu(null)
    if (cwd === null) { setError(t('graphNeedProject')); return }
    const spot = freeSpot(menu?.x ?? 60, menu?.y ?? 60)
    const node: Omit<GraphNode, 'id'> = {
      type: 'memory',
      title: scope === 'global' ? t('graphGlobalMemory') : t('graphProjectMemory'),
      x: spot.x,
      y: spot.y,
      scope,
      content: '',
    }
    void api<{ node: GraphNode; rev?: number }>('graph-add-node', { workspaceDir: cwd, node })
      .then((created) => {
        setGraph((prev) => ({ ...prev, nodes: [...prev.nodes, created.node] }))
        if (typeof created.rev === 'number') revRef.current = created.rev
      })
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }

  const deleteNode = (id: string) => {
    setMenu(null)
    setSelectedId(null)
    setGraph((prev) => {
      const next = { nodes: prev.nodes.filter((n) => n.id !== id), edges: prev.edges.filter((e) => e.from !== id && e.to !== id) }
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

  const startEditMemory = (node: GraphNode) => {
    setMenu(null)
    setEditing(node)
    setEditText(node.content ?? '')
  }
  const saveEditMemory = () => {
    if (editing === null) return
    const id = editing.id
    const content = editText
    setEditing(null)
    setGraph((prev) => {
      const next = { ...prev, nodes: prev.nodes.map((n) => (n.id === id ? { ...n, content } : n)) }
      saveGraph(next)
      return next
    })
  }

  const nodeById = (id: string): GraphNode | undefined => graph.nodes.find((n) => n.id === id)

  return jsxs('div', {
    className: 'evo-graph',
    children: [
      jsxs('div', { className: 'evo-graph-toolbar', children: [
        jsx('span', { className: 'evo-graph-title', children: t('chatGraph') }),
        jsx('span', { style: { flex: 1 } }),
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
      ]}),
      error !== null && jsx('div', { className: 'evo-panel-error', children: error }),
      jsx('div', {
        ref: canvasRef,
        className: 'evo-graph-canvas',
        onContextMenu: (e) => {
          e.preventDefault()
          const rect = canvasRef.current?.getBoundingClientRect()
          if (rect === undefined) return
          setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top })
        },
        onClick: () => { setSelectedId(null); setMenu(null) },
        children: [
          // 节点层（防御：graph 字段缺失时按空数组渲染）
          ...(graph?.nodes ?? []).map((node) => {
            const selected = selectedId === node.id
            const isChat = node.type === 'chat'
            const h = isChat ? CHAT_H : MEMORY_H
            return jsxs('div', {
              className: `evo-graph-node evo-graph-node-${node.type}${selected ? ' evo-graph-node-sel' : ''}${dragNode !== null && dragNode.id === node.id ? ' evo-graph-node-dragging' : ''}`,
              style: { left: node.x, top: node.y, width: NODE_W, height: h },
              'data-node-id': node.id,
              'data-global': node.scope === 'global' || undefined,
              onPointerDown: (e) => {
                e.stopPropagation()
                setSelectedId(node.id)
                const rect = canvasRef.current?.getBoundingClientRect()
                if (rect === undefined) return
                setDragNode({ id: node.id, dx: e.clientX - rect.left - node.x, dy: e.clientY - rect.top - node.y })
              },
              onDoubleClick: () => {
                // chat → 打开会话；memory → 编辑内容
                if (node.type === 'chat') openChatNode(node)
                else startEditMemory(node)
              },
              onContextMenu: (e) => {
                e.preventDefault()
                e.stopPropagation()
                const rect = canvasRef.current?.getBoundingClientRect()
                if (rect === undefined) return
                setSelectedId(node.id)
                setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, nodeId: node.id })
              },
              children: [
                // Blender 风格：顶部类型色标题栏 + 主体 socket 行（左输入/右输出带标签）
                jsxs('div', { className: 'evo-graph-node-titlebar', children: [
                  jsx('span', { className: 'evo-graph-node-dot' }),
                  jsx('span', { className: 'evo-graph-node-title', title: node.title, children: node.title }),
                ]}),
                jsxs('div', { className: 'evo-graph-node-body', children: [
                  isChat
                    ? jsxs(Fragment, { children: [
                        jsxs('div', { className: 'evo-graph-socket-row', children: [
                          jsx('span', {
                            className: 'evo-graph-socket evo-graph-socket-in evo-graph-socket-ctx',
                            title: t('graphContextPort'),
                            onPointerDown: (e) => e.stopPropagation(),
                            onPointerEnter: () => { hoverPortRef.current = { nodeId: node.id, port: 'context' } },
                            onPointerLeave: () => { if (hoverPortRef.current?.nodeId === node.id) hoverPortRef.current = null },
                          }),
                          jsx('span', { className: 'evo-graph-socket-label', children: 'Context' }),
                        ]}),
                        jsxs('div', { className: 'evo-graph-socket-row', children: [
                          jsx('span', {
                            className: 'evo-graph-socket evo-graph-socket-in evo-graph-socket-mem',
                            title: t('graphMemoryPort'),
                            onPointerDown: (e) => e.stopPropagation(),
                            onPointerEnter: () => { hoverPortRef.current = { nodeId: node.id, port: 'memory' } },
                            onPointerLeave: () => { if (hoverPortRef.current?.nodeId === node.id) hoverPortRef.current = null },
                          }),
                          jsx('span', { className: 'evo-graph-socket-label', children: 'Memory' }),
                          jsx('span', { style: { flex: 1 } }),
                          jsx('span', { className: 'evo-graph-node-sid', title: node.sessionId, children: (node.sessionId ?? '').slice(0, 8) }),
                        ]}),
                        jsxs('div', { className: 'evo-graph-socket-row evo-graph-socket-row-out', children: [
                          jsx('span', { style: { flex: 1 } }),
                          jsx('span', { className: 'evo-graph-socket-label', children: 'Output' }),
                          jsx('span', {
                            className: 'evo-graph-socket evo-graph-socket-out',
                            title: t('graphOutputPort'),
                            onPointerDown: (e) => {
                              e.stopPropagation()
                              const rect = canvasRef.current?.getBoundingClientRect()
                              if (rect === undefined) return
                              const fp = portPos(node, 'output')
                              setLinking({ from: node.id, toX: fp.x + 8, toY: fp.y })
                            },
                            onPointerEnter: () => { hoverPortRef.current = { nodeId: node.id, port: 'memory' } },
                            onPointerLeave: () => { if (hoverPortRef.current?.nodeId === node.id) hoverPortRef.current = null },
                          }),
                        ]}),
                      ]})
                    : jsxs(Fragment, { children: [
                        jsxs('div', { className: 'evo-graph-socket-row', children: [
                          jsx('span', { className: 'evo-graph-node-tag', children: node.scope === 'global' ? t('graphGlobal') : t('graphProject') }),
                          (node.content ?? '').trim() !== '' && jsx('span', {
                            className: 'evo-graph-node-preview',
                            title: node.content,
                            children: (node.content ?? '').replace(/\s+/g, ' ').slice(0, 16) + ((node.content ?? '').length > 16 ? '…' : ''),
                          }),
                          jsx('span', { style: { flex: 1 } }),
                          jsx('span', { className: 'evo-graph-socket-label', children: 'Output' }),
                          jsx('span', {
                            className: 'evo-graph-socket evo-graph-socket-out',
                            title: t('graphOutputPort'),
                            onPointerDown: (e) => {
                              e.stopPropagation()
                              const rect = canvasRef.current?.getBoundingClientRect()
                              if (rect === undefined) return
                              const fp = portPos(node, 'output')
                              setLinking({ from: node.id, toX: fp.x + 8, toY: fp.y })
                            },
                            onPointerEnter: () => { hoverPortRef.current = { nodeId: node.id, port: 'memory' } },
                            onPointerLeave: () => { if (hoverPortRef.current?.nodeId === node.id) hoverPortRef.current = null },
                          }),
                        ]}),
                      ]}),
                ]}),
              ],
            }, node.id)
          }),
          // 连线层（绘制于节点之上，Blender noodle 风格；pointer-events: none 不挡交互）
          jsx('svg', {
            className: 'evo-graph-svg',
            children: [
              ...(graph?.edges ?? []).map((edge) => {
              const from = nodeById(edge.from)
              const to = nodeById(edge.to)
              if (from === undefined || to === undefined) return null
              const fp = portOf(from, 'output')
              const tp = portOf(to, edge.toPort)
              const isCtx = edge.toPort === 'context'
              return jsx('path', {
                d: edgePath(fp, tp),
                className: `evo-graph-edge${isCtx ? ' evo-graph-edge-ctx' : ' evo-graph-edge-mem'}`,
              }, edge.id)
            }),
              ...(linking !== null ? (() => {
                const from = nodeById(linking.from)
                if (from === undefined) return []
                const fp = portOf(from, 'output')
                return [jsx('path', { d: edgePath(fp, { x: linking.toX, y: linking.toY }), className: 'evo-graph-edge evo-graph-edge-linking' }, 'link-tmp')]
              })() : []),
              ],
            }),
          // 右键菜单
          menu !== null && jsxs('div', {
            className: 'evo-graph-menu',
            style: { left: menu.x, top: menu.y },
            onClick: (e) => e.stopPropagation(),
            children: [
              menu.nodeId === undefined && jsx('button', {
                type: 'button', className: 'evo-graph-menu-item', disabled: busy || cwd === null,
                onClick: () => { void createChatNode() },
                children: jsxs(Fragment, { children: [jsx(MessageSquare, {}), jsx('span', { children: t('graphNewChat') })] }),
              }),
              menu.nodeId === undefined && jsx('button', {
                type: 'button', className: 'evo-graph-menu-item', disabled: cwd === null,
                onClick: () => createMemoryNode('project'),
                children: jsxs(Fragment, { children: [jsx(Database, {}), jsx('span', { children: t('graphNewMemory') })] }),
              }),
              menu.nodeId === undefined && jsx('button', {
                type: 'button', className: 'evo-graph-menu-item', disabled: cwd === null,
                onClick: () => createMemoryNode('global'),
                children: jsxs(Fragment, { children: [jsx(Globe, {}), jsx('span', { children: t('graphNewGlobal') })] }),
              }),
              menu.nodeId !== undefined && jsx('button', {
                type: 'button', className: 'evo-graph-menu-item',
                onClick: () => renameNode(menu.nodeId as string),
                children: jsxs(Fragment, { children: [jsx(Pencil, {}), jsx('span', { children: t('graphRename') })] }),
              }),
              menu.nodeId !== undefined && nodeById(menu.nodeId)?.type === 'memory' && jsx('button', {
                type: 'button', className: 'evo-graph-menu-item',
                onClick: () => { const n = nodeById(menu.nodeId as string); if (n !== undefined) startEditMemory(n) },
                children: jsxs(Fragment, { children: [jsx(FileText, {}), jsx('span', { children: t('graphEditContent') })] }),
              }),
              // 断开上下文继承（仅对有 context 边的 chat 节点显示）
              menu.nodeId !== undefined && nodeById(menu.nodeId)?.type === 'chat'
                && graph.edges.some((e) => e.to === menu.nodeId && e.toPort === 'context') && jsx('button', {
                  type: 'button', className: 'evo-graph-menu-item',
                  onClick: () => disconnectContext(menu.nodeId as string),
                  children: jsxs(Fragment, { children: [jsx(Unlink, {}), jsx('span', { children: t('graphDisconnectContext') })] }),
                }),
              menu.nodeId !== undefined && jsx('button', {
                type: 'button', className: 'evo-graph-menu-item evo-graph-menu-danger',
                onClick: () => deleteNode(menu.nodeId as string),
                children: jsxs(Fragment, { children: [jsx(Trash2, {}), jsx('span', { children: t('graphDelete') })] }),
              }),
            ],
          }),
        ],
      }),
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
    ],
  })
}

/** 简单 POST JSON 封装（与 panels.ts 同款）。 */
async function api<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`/evoresearch/fs/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(json.error?.message ?? '请求失败')
  return json.value as T
}
