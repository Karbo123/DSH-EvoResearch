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
import { useEffect, useRef, useState } from 'react'
import { t } from './i18n'
import { MessageSquare, Database, GitBranch, Plus, Trash2, Pencil, Globe, FolderGit2, X } from 'lucide-react'

/** 节点宽度/高度（画布内固定尺寸，端口偏移据此计算）。 */
const NODE_W = 168
const CHAT_H = 64
const MEMORY_H = 46

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

/** 端口位置（画布坐标，固定尺寸推导）。 */
function portPos(node: GraphNode, port: 'context' | 'memory' | 'output'): { x: number; y: number } {
  if (node.type === 'chat') {
    if (port === 'context') return { x: node.x, y: node.y + 22 }
    if (port === 'memory') return { x: node.x, y: node.y + 44 }
    return { x: node.x + NODE_W, y: node.y + 33 }
  }
  return { x: node.x + NODE_W, y: node.y + 23 }
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
  const hoverPortRef = useRef<{ nodeId: string; port: 'context' | 'memory' } | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)

  const load = () => {
    setError(null)
    void api<ChatGraph>('graph-get', { workspaceDir: cwd ?? undefined })
      .then((g) => setGraph(g ?? { nodes: [], edges: [] }))
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }
  useEffect(() => { load() }, [cwd])

  const persist = (next: ChatGraph) => {
    setGraph(next)
    setError(null)
    void api<{ ok: boolean }>('graph-save', { workspaceDir: cwd ?? undefined, graph: next }).catch((e: unknown) =>
      setError(String((e as Error)?.message ?? e)))
  }

  // ── 连线拖拽：window 级 move/up ──
  useEffect(() => {
    if (linking === null) return
    const onMove = (e: PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      setLinking((v) => (v === null ? null : { ...v, toX: e.clientX - rect.left, toY: e.clientY - rect.top }))
    }
    const onUp = (e: PointerEvent) => {
      // 命中检测：优先用真实指针位置 elementFromPoint（比 pointerenter 更可靠）
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const portEl = el?.closest?.('.evo-graph-port-in') as HTMLElement | null
      const target = portEl !== null
        ? { nodeId: portEl.closest('.evo-graph-node')?.getAttribute('data-node-id') ?? '', port: portEl.classList.contains('evo-graph-port-ctx') ? 'context' as const : 'memory' as const }
        : hoverPortRef.current
      if (target !== null && target.nodeId !== '' && linking !== null && target.nodeId !== linking.from) {
        setGraph((prev) => {
          let edges = [...prev.edges]
          if (target.port === 'context') edges = edges.filter((e) => !(e.to === target.nodeId && e.toPort === 'context'))
          const id = `e${Date.now().toString(36)}`
          edges = [...edges, { id, from: linking.from, to: target.nodeId, toPort: target.port }]
          void api<{ ok: boolean }>('graph-save', { workspaceDir: cwd ?? undefined, graph: { ...prev, edges } })
            .catch(() => undefined)
          return { ...prev, edges }
        })
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
        void api<{ ok: boolean }>('graph-save', { workspaceDir: cwd ?? undefined, graph: prev }).catch(() => undefined)
        return prev
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [dragNode, cwd])

  // ── 操作 ──
  const createChatNode = async () => {
    setMenu(null)
    if (cwd === null) { setError(t('graphNeedProject')); return }
    setBusy(true)
    try {
      const sessionId = await onCreateSession()
      if (sessionId === null) { setError(t('graphCreateSessionFailed')); return }
      const node: Omit<GraphNode, 'id'> = {
        type: 'chat',
        title: t('graphNewChat'),
        x: menu?.x ?? 40 + Math.floor(Math.random() * 120),
        y: menu?.y ?? 40 + Math.floor(Math.random() * 120),
        sessionId,
        workspaceDir: cwd,
      }
      const created = await api<GraphNode>('graph-add-node', { workspaceDir: cwd, node })
      setGraph((prev) => ({ ...prev, nodes: [...prev.nodes, created] }))
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const createMemoryNode = (scope: 'project' | 'global') => {
    setMenu(null)
    if (cwd === null) { setError(t('graphNeedProject')); return }
    const node: Omit<GraphNode, 'id'> = {
      type: 'memory',
      title: scope === 'global' ? t('graphGlobalMemory') : t('graphProjectMemory'),
      x: menu?.x ?? 40 + Math.floor(Math.random() * 120),
      y: menu?.y ?? 40 + Math.floor(Math.random() * 120),
      scope,
      content: '',
    }
    void api<GraphNode>('graph-add-node', { workspaceDir: cwd, node })
      .then((created) => setGraph((prev) => ({ ...prev, nodes: [...prev.nodes, created] })))
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }

  const deleteNode = (id: string) => {
    setMenu(null)
    setSelectedId(null)
    setGraph((prev) => {
      const next = { nodes: prev.nodes.filter((n) => n.id !== id), edges: prev.edges.filter((e) => e.from !== id && e.to !== id) }
      void api<{ ok: boolean }>('graph-save', { workspaceDir: cwd ?? undefined, graph: next }).catch(() => undefined)
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
      void api<{ ok: boolean }>('graph-save', { workspaceDir: cwd ?? undefined, graph: next }).catch(() => undefined)
      return next
    })
  }

  const openChatNode = (node: GraphNode) => {
    if (node.type === 'chat' && node.sessionId !== undefined) onOpenSession(node.sessionId)
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
          // 连线层
          jsx('svg', {
            className: 'evo-graph-svg',
            children: graph.edges.map((edge) => {
              const from = nodeById(edge.from)
              const to = nodeById(edge.to)
              if (from === undefined || to === undefined) return null
              const fp = portPos(from, 'output')
              const tp = portPos(to, edge.toPort)
              return jsx('path', {
                d: edgePath(fp, tp),
                className: `evo-graph-edge${edge.toPort === 'context' ? ' evo-graph-edge-ctx' : ''}`,
              }, edge.id)
            }),
            ...(linking !== null ? (() => {
              const from = nodeById(linking.from)
              if (from === undefined) return []
              const fp = portPos(from, 'output')
              return [jsx('path', { d: edgePath(fp, { x: linking.toX, y: linking.toY }), className: 'evo-graph-edge evo-graph-edge-linking' }, 'link-tmp')]
            })() : []),
          }),
          // 节点层
          ...graph.nodes.map((node) => {
            const selected = selectedId === node.id
            const isChat = node.type === 'chat'
            const h = isChat ? CHAT_H : MEMORY_H
            return jsxs('div', {
              className: `evo-graph-node evo-graph-node-${node.type}${selected ? ' evo-graph-node-sel' : ''}`,
              style: { left: node.x, top: node.y, width: NODE_W, height: h },
              'data-node-id': node.id,
              onPointerDown: (e) => {
                e.stopPropagation()
                setSelectedId(node.id)
                const rect = canvasRef.current?.getBoundingClientRect()
                if (rect === undefined) return
                setDragNode({ id: node.id, dx: e.clientX - rect.left - node.x, dy: e.clientY - rect.top - node.y })
              },
              onDoubleClick: () => openChatNode(node),
              onContextMenu: (e) => {
                e.preventDefault()
                e.stopPropagation()
                const rect = canvasRef.current?.getBoundingClientRect()
                if (rect === undefined) return
                setSelectedId(node.id)
                setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, nodeId: node.id })
              },
              children: [
                // 输入端口（chat：context + memory；memory 无输入）
                isChat && jsx('span', {
                  className: 'evo-graph-port evo-graph-port-in evo-graph-port-ctx',
                  title: t('graphContextPort'),
                  onPointerDown: (e) => e.stopPropagation(),
                  onPointerEnter: () => { hoverPortRef.current = { nodeId: node.id, port: 'context' } },
                  onPointerLeave: () => { if (hoverPortRef.current?.nodeId === node.id) hoverPortRef.current = null },
                }),
                isChat && jsx('span', {
                  className: 'evo-graph-port evo-graph-port-in evo-graph-port-mem',
                  title: t('graphMemoryPort'),
                  onPointerDown: (e) => e.stopPropagation(),
                  onPointerEnter: () => { hoverPortRef.current = { nodeId: node.id, port: 'memory' } },
                  onPointerLeave: () => { if (hoverPortRef.current?.nodeId === node.id) hoverPortRef.current = null },
                }),
                jsx('span', {
                  className: 'evo-graph-port evo-graph-port-out',
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
                jsxs('div', { className: 'evo-graph-node-head', children: [
                  isChat ? jsx(MessageSquare, {}) : (node.scope === 'global' ? jsx(Globe, {}) : jsx(Database, {})),
                  jsx('span', { className: 'evo-graph-node-title', children: node.title }),
                ]}),
                isChat
                  ? jsxs('div', { className: 'evo-graph-node-sub', children: [
                      jsx('span', { className: 'evo-graph-node-tag', children: 'chat' }),
                      jsx('span', { className: 'evo-graph-node-sid', title: node.sessionId, children: (node.sessionId ?? '').slice(0, 8) }),
                    ]})
                  : jsx('div', { className: 'evo-graph-node-sub', children: jsx('span', { className: 'evo-graph-node-tag', children: node.scope === 'global' ? t('graphGlobal') : t('graphProject') }) }),
              ],
            }, node.id)
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
