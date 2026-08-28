import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'
import { t } from './i18n'
import { MessageSquare, Database, FileText, Map as MapIcon } from 'lucide-react'
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  getBezierPath,
  type Connection,
  type EdgeProps,
  type NodeProps,
  type Node as XYNode,
  type Edge as XYEdge,
} from '@xyflow/react'
import type { ChatGraph, GraphEdge, GraphGroup, GraphNode } from './chatgraph'

export interface GraphCanvasMenu {
  x: number
  y: number
  nodeId?: string
  edgeId?: string
}

interface GraphNodeData extends Record<string, unknown> {
  graphNode: GraphNode
  preview?: { ok: boolean; text?: string; error?: string }
  focused: boolean
  highlighted: boolean
  advancedMode: boolean
  onOpen: (node: GraphNode) => void
  onEdit: (node: GraphNode) => void
  onContextMenu: (event: MouseEvent, node: GraphNode) => void
}

interface GraphGroupData extends Record<string, unknown> {
  graphGroup: GraphGroup
  memberCount: number
  onToggleGroup: (groupId: string) => void
}

type CanvasNode = XYNode<GraphNodeData | GraphGroupData>

export interface ChatGraphCanvasProps {
  graph: ChatGraph
  visibleIds: Set<string>
  matchedIds: Set<string> | null
  focusedNodeId: string | null | undefined
  selectedId: string | null
  refPreviews: Record<string, { ok: boolean; text?: string; error?: string }>
  advancedMode: boolean
  traceHighlightedIds: Set<string>
  menu: GraphCanvasMenu | null
  menuElement?: unknown
  busy: boolean
  onSelect: (id: string | null) => void
  onOpen: (node: GraphNode) => void
  onEdit: (node: GraphNode) => void
  onDelete: (id: string) => void
  onContextMenu: (menu: GraphCanvasMenu | null) => void
  onNodeContextMenu: (event: MouseEvent, node: GraphNode) => void
  onEdgeContextMenu: (event: MouseEvent, edge: GraphEdge) => void
  onConnect: (connection: Connection) => void
  onToggleGroup: (groupId: string) => void
  onNodePositionsChange: (positions: Array<{ id: string; x: number; y: number }>) => void
  onNarrowOpen: (node: GraphNode) => void
  /** 整理布局确认保存后置 true 一帧，用于触发视野重新适配。 */
  refitSignal?: number
}

const nodeTypes = { graph: GraphNodeView, graphGroup: GraphGroupView }
const edgeTypes = { graph: GraphEdgeView }

function refDisplayName(refPath: string): string {
  const base = refPath.split(/[\\/]/).filter((part) => part !== '').pop() ?? refPath
  return base.length > 22 ? `${base.slice(0, 21)}…` : base
}

function nodeHeight(node: GraphNode): number {
  return node.type === 'chat' ? 84 : node.ref !== undefined ? 84 : 66
}

function nodeKind(node: GraphNode): 'chat' | 'memory' | 'resource' {
  return node.type === 'chat' ? 'chat' : node.type === 'memory' || node.displayKind === 'memory' || node.displayKind === 'memory-collection' ? 'memory' : 'resource'
}

function GraphGroupView({ data }: NodeProps<XYNode<GraphGroupData>>) {
  const group = data.graphGroup
  return jsxs('div', {
    className: `evo-graph-group evo-graph-group-${group.kind ?? 'freeform'}${group.collapsed ? ' collapsed' : ''}`,
    role: 'group',
    'aria-label': `${group.title}${t('graphAriaSep')}${t('graphMemberCount').replace('{n}', String(data.memberCount))}${group.collapsed ? t('graphGroupCollapsed') : ''}`,
    children: [
      jsxs('div', { className: 'evo-graph-group-header', children: [
        jsx('button', {
          type: 'button',
          className: 'evo-graph-group-toggle',
          'aria-expanded': group.collapsed !== true,
          'aria-label': (group.collapsed === true ? t('graphGroupExpandAria') : t('graphGroupCollapseAria')).replace('{title}', group.title),
          onClick: (event: MouseEvent) => { event.stopPropagation(); data.onToggleGroup(group.id) },
          children: jsx('span', { className: 'evo-graph-group-title', children: group.title }),
        }),
        jsx('span', { className: 'evo-graph-group-count', 'aria-label': t('graphMemberCount').replace('{n}', String(data.memberCount)), children: `${data.memberCount}` }),
      ]}),
    ],
  })
}

function kindIcon(kind: 'chat' | 'memory' | 'resource') {
  return kind === 'chat' ? MessageSquare : kind === 'memory' ? Database : FileText
}

function GraphNodeView({ data, selected }: NodeProps<XYNode<GraphNodeData>>) {
  const node = data.graphNode
  const kind = nodeKind(node)
  const isChat = node.type === 'chat'
  const isMemory = kind === 'memory'
  const preview = data.preview
  const Icon = kindIcon(kind)
  const socket = (id: string, type: 'source' | 'target', className: string, top: number) => jsx(Handle, {
    id,
    type,
    position: type === 'source' ? Position.Right : Position.Left,
    className: `evo-graph-socket ${className}${data.advancedMode ? '' : ' evo-graph-socket-hidden'}`,
    style: { top, transform: 'translateY(-50%)' },
    'aria-label': id === 'context' ? t('graphSocketContext') : id === 'memory' ? t('graphSocketMemory') : t('graphSocketOutput'),
    'aria-hidden': data.advancedMode ? undefined : true,
  })
  const shortPreview = node.ref !== undefined
    ? preview === undefined ? t('graphReading') : preview.ok ? (preview.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 24) : (preview.error ?? t('graphRefUnavailable')).slice(0, 24)
    : (node.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 24)
  return jsxs('div', {
    className: `evo-graph-node evo-graph-node-${kind}${selected || data.focused ? ' evo-graph-node-sel' : ''}${data.highlighted ? ' evo-graph-node-trace' : ''}${node.origin === 'agent' ? ' evo-graph-node-candidate' : ''}`,
    style: { width: 200, height: nodeHeight(node) },
    'data-node-id': node.id,
    'data-global': node.scope === 'global' || undefined,
    'data-status': node.status,
    'data-pinned': node.pinned === true || undefined,
    tabIndex: 0,
    role: 'group',
    'aria-roledescription': t('graphNodeAriaRole'),
    'aria-label': `${node.title}${t('graphAriaSep')}${isChat ? t('graphChat') : (node.displayKind ?? t('graphResource'))}${data.highlighted ? t('graphReadThisTurn') : ''}`,
    onDoubleClick: () => data.onOpen(node),
    onContextMenu: (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); data.onContextMenu(event, node) },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); data.onOpen(node) }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); data.onContextMenu(event as unknown as MouseEvent, node) }
    },
    children: [
      jsxs('div', { className: 'evo-graph-node-titlebar', children: [
        jsx('span', { className: 'evo-graph-node-icon', 'aria-hidden': true, children: jsx(Icon, {}) }),
        jsx('span', { className: 'evo-graph-node-title', title: node.title, children: node.title }),
        node.origin === 'agent' && jsx('span', { className: 'evo-graph-node-candidate-badge', children: t('graphCandidateBadge') }),
      ] }),
      isChat
        ? jsxs('div', { className: 'evo-graph-node-body', children: [
          socket('context', 'target', 'evo-graph-socket-in evo-graph-socket-ctx', 44),
          data.advancedMode && jsx('span', { className: 'evo-graph-socket-label evo-graph-socket-label-ctx', style: { position: 'absolute', left: 16, top: 37 }, children: t('graphBranch') }),
          socket('memory', 'target', 'evo-graph-socket-in evo-graph-socket-mem', 62),
          data.advancedMode && jsx('span', { className: 'evo-graph-socket-label evo-graph-socket-label-mem', style: { position: 'absolute', left: 16, top: 55 }, children: t('graphRef') }),
          jsx('span', { className: 'evo-graph-node-sid', title: node.sessionId, children: (node.sessionId ?? '').replace(/^session-/, '').slice(0, 8) }),
          socket('output', 'source', 'evo-graph-socket-out', 53),
          data.advancedMode && jsx('span', { className: 'evo-graph-socket-label evo-graph-socket-label-out', style: { position: 'absolute', right: 16, top: 46 }, children: t('graphConnect') }),
        ] })
        : jsxs('div', { className: 'evo-graph-node-body', children: [
          jsx('span', { className: 'evo-graph-node-tag', children: node.scope === 'global' ? t('graphGlobal') : (isMemory ? t('graphMemory') : t('graphProject')) }),
          jsx('span', { className: node.ref === undefined && isMemory ? 'evo-graph-node-preview' : 'evo-graph-node-ref-name', title: node.ref?.path ?? node.content, children: node.ref === undefined ? shortPreview : refDisplayName(node.ref.path) }),
          socket('output', 'source', 'evo-graph-socket-out', 38),
          data.advancedMode && jsx('span', { className: 'evo-graph-socket-label evo-graph-socket-label-out', style: { position: 'absolute', right: 16, top: 31 }, children: t('graphConnect') }),
          node.ref !== undefined && jsx('span', { className: `evo-graph-node-preview${preview?.ok === false ? ' evo-graph-node-preview-err' : ''}`, title: preview?.text ?? preview?.error, children: shortPreview }),
        ] }),
    ],
  })
}

function routePath(points: readonly { x: number; y: number }[]): string {
  if (points.length < 2) return ''
  const fmt = (point: { x: number; y: number }) => `${Math.round(point.x)} ${Math.round(point.y)}`
  // 直连或用户只给了起终点：保持直线
  if (points.length === 2) return `M ${fmt(points[0]!)} L ${fmt(points[1]!)}`
  // 折线转平滑曲线：每个拐点用二次贝塞尔圆角，保留路由避障形状
  const radius = 16
  let d = `M ${fmt(points[0]!)}`
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]!
    const cur = points[i]!
    const next = points[i + 1]!
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    const inX = cur.x - ((cur.x - prev.x) / (inLen || 1)) * r
    const inY = cur.y - ((cur.y - prev.y) / (inLen || 1)) * r
    const outX = cur.x + ((next.x - cur.x) / (outLen || 1)) * r
    const outY = cur.y + ((next.y - cur.y) / (outLen || 1)) * r
    d += ` L ${fmt({ x: inX, y: inY })} Q ${fmt(cur)} ${fmt({ x: outX, y: outY })}`
  }
  d += ` L ${fmt(points[points.length - 1]!)}`
  return d
}

function midpoint(points: readonly { x: number; y: number }[]): { x: number; y: number } | undefined {
  if (points.length === 0) return undefined
  let length = 0
  for (let i = 1; i < points.length; i += 1) length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
  let walked = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!
    const b = points[i]!
    const segment = Math.hypot(b.x - a.x, b.y - a.y)
    if (walked + segment >= length / 2) {
      const ratio = segment === 0 ? 0 : (length / 2 - walked) / segment
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio }
    }
    walked += segment
  }
  return points[points.length - 1]
}

function GraphEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps<XYEdge<{ graphEdge: GraphEdge; onContextMenu: (event: MouseEvent, edge: GraphEdge) => void }>>) {
  const graphEdge = data?.graphEdge
  const fallback = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const stored = graphEdge?.routePoints ?? []
  const points = stored.length >= 2 ? [{ x: sourceX, y: sourceY }, ...stored.slice(1, -1), { x: targetX, y: targetY }] : []
  const path = points.length >= 2 ? routePath(points) : fallback[0]
  const label = graphEdge?.label?.trim() ?? ''
  const labelPoint = graphEdge?.labelPosition ?? midpoint(points) ?? { x: fallback[1], y: fallback[2] }
  const isFork = graphEdge?.behavior === 'fork' || graphEdge?.toPort === 'context'
  const relation = graphEdge?.behavior === 'relation'
  const enabled = isFork || graphEdge?.enabled !== false && !relation
  return jsxs(Fragment, { children: [
    jsx('g', { onContextMenu: (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); if (graphEdge !== undefined) data?.onContextMenu(event, graphEdge) }, children: jsx(BaseEdge, {
      id,
      path,
      markerEnd,
      interactionWidth: 24,
      className: `evo-graph-edge ${isFork ? 'evo-graph-edge-ctx' : relation ? 'evo-graph-edge-relation' : 'evo-graph-edge-mem'}${enabled ? '' : ' evo-graph-edge-disabled'}`,
    }) }),
    !isFork && label !== '' && jsx(EdgeLabelRenderer, { children: jsx('div', {
      className: `evo-graph-edge-label${graphEdge?.labelHidden === true ? ' evo-graph-edge-label-hidden' : ''}`,
      'aria-label': graphEdge?.labelHidden === true ? t('graphEdgeLabelHidden').replace('{label}', label) : t('graphEdgeLabel').replace('{label}', label),
      style: {
        transform: `translate(-50%, -50%) translate(${labelPoint.x}px,${labelPoint.y - 6}px)`,
        ...(graphEdge?.labelWidth !== undefined ? { width: `${graphEdge.labelWidth}px` } : {}),
        ...(graphEdge?.labelHeight !== undefined ? { minHeight: `${graphEdge.labelHeight}px` } : {}),
      },
      title: label,
      children: label.length > 42 ? `${label.slice(0, 41)}…` : label,
    }) }),
  ] })
}

function collapsedGroupOf(graph: ChatGraph, node: GraphNode): GraphGroup | undefined {
  const groups = new Map((graph.groups ?? []).map((group) => [group.id, group]))
  let current = node.groupId === undefined ? undefined : groups.get(node.groupId)
  const seen = new Set<string>()
  while (current !== undefined && !seen.has(current.id)) {
    if (current.collapsed === true) return current
    seen.add(current.id)
    current = current.parentId === undefined ? undefined : groups.get(current.parentId)
  }
  return undefined
}

function groupContainsNode(graph: ChatGraph, groupId: string, node: GraphNode): boolean {
  const groups = new Map((graph.groups ?? []).map((group) => [group.id, group]))
  let current = node.groupId
  const seen = new Set<string>()
  while (current !== undefined && !seen.has(current)) {
    if (current === groupId) return true
    seen.add(current)
    current = groups.get(current)?.parentId
  }
  return false
}

function groupBounds(graph: ChatGraph, group: GraphGroup, ancestry = new Set<string>()): { x: number; y: number; width: number; height: number } {
  if (ancestry.has(group.id)) return { x: group.x ?? 40, y: group.y ?? 40, width: group.width ?? 220, height: group.height ?? 120 }
  const nextAncestry = new Set(ancestry)
  nextAncestry.add(group.id)
  const groupById = new Map((graph.groups ?? []).map((item) => [item.id, item]))
  const isDescendant = (node: GraphNode): boolean => {
    let current = node.groupId
    const seen = new Set<string>()
    while (current !== undefined && !seen.has(current)) {
      if (current === group.id) return true
      seen.add(current)
      current = groupById.get(current)?.parentId
    }
    return false
  }
  const members = graph.nodes.filter(isDescendant)
  const childGroups = (graph.groups ?? []).filter((candidate) => {
    let current = candidate.parentId
    const seen = new Set<string>()
    while (current !== undefined && !seen.has(current)) {
      if (current === group.id) return true
      seen.add(current)
      current = groupById.get(current)?.parentId
    }
    return false
  })
  if (group.collapsed === true) return { x: group.x ?? 40, y: group.y ?? 40, width: group.width ?? 208, height: group.height ?? 86 }
  const rects = members.map((node) => ({ x: node.x, y: node.y, width: 200, height: node.type === 'chat' ? 84 : node.ref !== undefined ? 84 : 66 }))
  for (const child of childGroups) {
    const bounds = groupBounds(graph, child, nextAncestry)
    rects.push({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
  }
  const minX = rects.length === 0 ? group.x ?? 40 : Math.min(...rects.map((rect) => rect.x))
  const minY = rects.length === 0 ? group.y ?? 40 : Math.min(...rects.map((rect) => rect.y))
  const maxX = rects.length === 0 ? minX + 176 : Math.max(...rects.map((rect) => rect.x + rect.width))
  const maxY = rects.length === 0 ? minY + 76 : Math.max(...rects.map((rect) => rect.y + rect.height))
  const x = group.x ?? minX - 24
  const y = group.y ?? minY - 36
  return { x, y, width: group.width ?? Math.max(220, maxX - x + 24), height: group.height ?? Math.max(120, maxY - y + 24) }
}

function toXYNodes(props: ChatGraphCanvasProps): CanvasNode[] {
  const nodes: CanvasNode[] = props.graph.nodes
    .filter((node) => props.visibleIds.has(node.id) && (props.matchedIds === null || props.matchedIds.has(node.id)) && collapsedGroupOf(props.graph, node) === undefined)
    .map((node) => ({
      id: node.id,
      type: 'graph',
      position: { x: node.x, y: node.y },
      width: 200,
      height: nodeHeight(node),
      selected: props.selectedId === node.id,
      data: {
        graphNode: node,
        preview: props.refPreviews[node.id],
        focused: props.focusedNodeId === node.id,
        highlighted: props.traceHighlightedIds.has(node.id),
        advancedMode: props.advancedMode,
        onOpen: props.onOpen,
        onEdit: props.onEdit,
        onContextMenu: props.onNodeContextMenu,
      },
    }))
  for (const group of props.graph.groups ?? []) {
    const members = props.graph.nodes.filter((node) => groupContainsNode(props.graph, group.id, node))
    if (members.length === 0) continue
    const parent = group.parentId === undefined ? undefined : props.graph.groups?.find((item) => item.id === group.parentId)
    if (parent !== undefined && collapsedGroupOf(props.graph, { id: '__group__', type: 'resource', title: '', x: 0, y: 0, groupId: parent.id }) !== undefined) continue
    const bounds = groupBounds(props.graph, group)
    nodes.unshift({
      id: `group:${group.id}`,
      type: 'graphGroup',
      position: { x: bounds.x, y: bounds.y },
      width: bounds.width,
      height: bounds.height,
      draggable: false,
      selectable: false,
      zIndex: -1,
      hidden: false,
      data: { graphGroup: group, memberCount: members.length, onToggleGroup: props.onToggleGroup },
    })
  }
  // A collapsed group is rendered as one compact node; its children are not
  // exposed to the canvas hit-test, but remain in persisted graph data.
  for (const group of props.graph.groups ?? []) {
    if (group.collapsed !== true) continue
    const members = props.graph.nodes.filter((node) => groupContainsNode(props.graph, group.id, node))
    if (members.length === 0) continue
    const parent = group.parentId === undefined ? undefined : props.graph.groups?.find((item) => item.id === group.parentId)
    if (parent !== undefined && collapsedGroupOf(props.graph, { id: '__group__', type: 'resource', title: '', x: 0, y: 0, groupId: parent.id }) !== undefined) continue
    const bounds = groupBounds(props.graph, group)
    const index = nodes.findIndex((node) => node.id === `group:${group.id}`)
    if (index >= 0) nodes[index] = { ...nodes[index]!, zIndex: 1, selectable: true, data: { graphGroup: group, memberCount: members.length, onToggleGroup: props.onToggleGroup } }
    else nodes.push({ id: `group:${group.id}`, type: 'graphGroup', position: { x: bounds.x, y: bounds.y }, width: bounds.width, height: bounds.height, zIndex: 1, selectable: true, data: { graphGroup: group, memberCount: members.length, onToggleGroup: props.onToggleGroup } })
  }
  return nodes
}

function toXYEdges(props: ChatGraphCanvasProps, xyNodes: readonly CanvasNode[]): XYEdge<{ graphEdge: GraphEdge; onContextMenu: (event: MouseEvent, edge: GraphEdge) => void }>[] {
  const ids = new Set(xyNodes.map((node) => node.id))
  const nodeById = new Map(props.graph.nodes.map((node) => [node.id, node]))
  const endpoint = (id: string): string => {
    const node = nodeById.get(id)
    const collapsed = node === undefined ? undefined : collapsedGroupOf(props.graph, node)
    return collapsed === undefined ? id : `group:${collapsed.id}`
  }
  return props.graph.edges
    .map((edge) => ({ edge, source: endpoint(edge.from), target: endpoint(edge.to) }))
    .filter(({ source, target }) => ids.has(source) && ids.has(target) && source !== target)
    .map(({ edge, source, target }) => ({
      id: edge.id,
      source,
      // Ordinary mode intentionally hides the technical handles. Use
      // React Flow's default endpoints there so persisted edges remain
      // visible; advanced mode binds the explicit semantic ports.
      sourceHandle: !props.advancedMode || source.startsWith('group:') ? undefined : 'output',
      target,
      targetHandle: !props.advancedMode || target.startsWith('group:') ? undefined : edge.toPort,
      type: 'graph',
      data: { graphEdge: edge, onContextMenu: props.onEdgeContextMenu },
    }))
}

export function ChatGraphCanvas(props: ChatGraphCanvasProps) {
  return jsx(ReactFlowProvider, { children: jsx(ChatGraphCanvasInner, { ...props }) })
}

function ChatGraphCanvasInner(props: ChatGraphCanvasProps) {
  const initialNodes = toXYNodes(props)
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initialNodes)
  const edges = toXYEdges(props, initialNodes)
  const [minimapOpen, setMinimapOpen] = useState(false)
  const { fitView } = useReactFlow()
  // Async prop updates (file previews, trace highlights, selection) must not
  // teleport cards back to their stored positions in the middle of a drag,
  // so while the user interacts we keep whatever position the canvas shows;
  // otherwise incoming graph positions (e.g. 整理布局 preview) must apply.
  const interactingRef = useRef(false)
  useEffect(() => {
    setNodes((current) => {
      if (!interactingRef.current) return initialNodes
      const positions = new Map(current.filter((node) => node.type === 'graph').map((node) => [node.id, node.position]))
      return initialNodes.map((node) => (node.type === 'graph' && positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node))
    })
  }, [props.graph, props.visibleIds, props.matchedIds, props.selectedId, props.focusedNodeId, props.advancedMode, props.traceHighlightedIds, props.refPreviews, setNodes])
  // XYFlow's MiniMap component does not forward arbitrary aria attributes.
  useEffect(() => {
    const minimap = document.querySelector<HTMLElement>('.evo-graph-canvas .react-flow__minimap')
    minimap?.setAttribute('role', 'img')
    minimap?.setAttribute('aria-label', t('graphMiniMap'))
  })

  // 整理布局确认保存后重新适配视野，避免新排布落在视口外。
  const refitSignal = props.refitSignal ?? 0
  useEffect(() => {
    if (refitSignal > 0) { void fitView({ padding: 0.18, duration: 240 }) }
  }, [refitSignal, fitView])

  const handleDragStop = (_event: unknown, _node: CanvasNode, draggedNodes?: CanvasNode[]) => {
    interactingRef.current = false
    const changed = (draggedNodes ?? nodes)
      .filter((node) => node.type === 'graph' && 'graphNode' in node.data)
      .map((node) => ({ id: (node.data as GraphNodeData).graphNode.id, x: Math.round(node.position.x), y: Math.round(node.position.y) }))
    props.onNodePositionsChange(changed)
  }
  const narrowNodes = props.graph.nodes.filter((node) => props.visibleIds.has(node.id) && collapsedGroupOf(props.graph, node) === undefined)
  return jsxs('div', {
    className: 'evo-graph-canvas',
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault()
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      props.onContextMenu({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    },
    children: [
      jsx('div', { className: 'evo-graph-narrow-list', 'aria-label': t('graphNodeListAria'), children: narrowNodes.map((node) => jsx('button', {
      type: 'button',
        className: `evo-graph-narrow-item${node.id === props.focusedNodeId ? ' active' : ''}`,
        'aria-label': `${node.title}${t('graphAriaSep')}${node.type === 'chat' ? t('graphChat') : (node.displayKind ?? t('graphResource'))}${t('graphAriaSep')}${node.scope === 'global' ? t('graphGlobal') : t('graphProject')}`,
        onClick: () => props.onNarrowOpen(node),
        children: jsxs(Fragment, { children: [
          jsx('span', { className: 'evo-graph-narrow-kind', children: node.type === 'chat' ? t('graphChat') : (node.displayKind ?? t('graphResource')) }),
          jsx('span', { className: 'evo-graph-narrow-title', children: node.title }),
          jsx('span', { className: 'evo-graph-narrow-meta', children: node.scope === 'global' ? t('graphGlobal') : t('graphProject') }),
        ] }),
      }, node.id)) }),
      jsx(ReactFlow, {
        nodes,
        edges,
        nodeTypes,
        edgeTypes,
        fitView: true,
        fitViewOptions: { padding: 0.18, duration: 180 },
        nodesDraggable: true,
        nodesConnectable: props.advancedMode,
        elementsSelectable: true,
        deleteKeyCode: null,
        onNodesChange,
        onNodeDragStart: () => { interactingRef.current = true },
        onNodeDragStop: handleDragStop,
        onNodeClick: (_event: MouseEvent, node: CanvasNode) => { if (node.type === 'graph') props.onSelect((node.data as GraphNodeData).graphNode.id) },
        onPaneClick: () => { props.onSelect(null); props.onContextMenu(null) },
        onNodeContextMenu: (event: MouseEvent, node: CanvasNode) => { if (node.type === 'graph') props.onNodeContextMenu(event, (node.data as GraphNodeData).graphNode) },
        onEdgeContextMenu: (event: MouseEvent, edge: XYEdge<{ graphEdge: GraphEdge }>) => { const original = props.graph.edges.find((item) => item.id === edge.id); if (original !== undefined) props.onEdgeContextMenu(event, original) },
        onConnect: props.onConnect,
        'aria-label': t('graphCanvasAria'),
        proOptions: { hideAttribution: true },
        children: [
          jsx(Background, { gap: 22, size: 1.1, color: 'var(--graph-grid)' }),
          jsx(Controls, { showInteractive: true, position: 'bottom-right' as const, 'aria-label': t('graphControlsAria') }),
          minimapOpen && jsx(MiniMap, { pannable: true, zoomable: true, position: 'bottom-left' as const, 'aria-label': t('graphMiniMap'), nodeColor: (node: CanvasNode) => node.type === 'graphGroup' ? 'var(--graph-minimap-group)' : (node.data as GraphNodeData).graphNode.type === 'chat' ? 'var(--graph-minimap-chat)' : 'var(--graph-minimap-resource)' }),
          jsx('button', {
            type: 'button',
            className: 'evo-graph-minimap-toggle',
            'aria-pressed': minimapOpen,
            'aria-label': minimapOpen ? t('graphMinimapHide') : t('graphMinimapShow'),
            title: minimapOpen ? t('graphMinimapHide') : t('graphMinimapShow'),
            onClick: (event: MouseEvent) => { event.stopPropagation(); setMinimapOpen((value) => !value) },
            style: minimapOpen ? { left: 'auto', right: 12 } : undefined,
            children: jsxs(Fragment, { children: [jsx(MapIcon, {}), jsx('span', { children: minimapOpen ? t('graphMinimapHide') : t('graphMinimapShow') })] }),
          }),
        ],
      }),
      props.menuElement,
    ],
  })
}
