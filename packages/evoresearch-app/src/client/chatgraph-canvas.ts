import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useMemo, useRef, useState } from 'react'
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
  return node.type === 'chat' ? 96 : node.ref !== undefined ? 116 : 96
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
    // demo 端点常显：10px gray-400(#99a1af) 圆点、无边框、圆心压在卡片边线上
    className: `evo-graph-socket ${className}`,
    style: { top, transform: 'translateY(-50%)' },
    'aria-label': id === 'context' ? t('graphSocketContext') : id === 'memory' ? t('graphSocketMemory') : t('graphSocketOutput'),
  })
  const shortPreview = node.ref !== undefined
    ? preview === undefined ? t('graphReading') : preview.ok ? (preview.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 24) : (preview.error ?? t('graphRefUnavailable')).slice(0, 24)
    : (node.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 24)
  // reactflow.dev 首页 hero demo 的卡片结构：半透明圆角卡片 + 等宽小字标题条 + 实色圆角主体。
  // 标题条 = 类型图标 + 等宽类型标签（demo 的 "shape color"/"output" 位），主体 = 标题 + 元信息。
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
        jsx('span', { className: 'evo-graph-node-kind', children: kindLabel(node, isChat, isMemory) }),
        jsxs('span', { className: 'evo-graph-node-headermeta', children: [
          node.origin === 'agent' && jsx('span', { className: 'evo-graph-node-candidate-badge', children: t('graphCandidateBadge') }),
          !isChat && node.scope === 'global' && jsx('span', { className: 'evo-graph-node-scopechip', children: t('graphGlobal') }),
        ] }),
      ] }),
      isChat
        ? jsxs('div', { className: 'evo-graph-node-body', children: [
          socket('context', 'target', 'evo-graph-socket-in evo-graph-socket-ctx', 47),
          data.advancedMode && jsx('span', { className: 'evo-graph-socket-label evo-graph-socket-label-ctx', style: { position: 'absolute', left: 16, top: 41 }, children: t('graphBranch') }),
          socket('memory', 'target', 'evo-graph-socket-in evo-graph-socket-mem', 67),
          data.advancedMode && jsx('span', { className: 'evo-graph-socket-label evo-graph-socket-label-mem', style: { position: 'absolute', left: 16, top: 61 }, children: t('graphRef') }),
          jsx('span', { className: 'evo-graph-node-title', title: node.title, children: node.title }),
          jsx('span', { className: 'evo-graph-node-sid', title: node.sessionId, children: (node.sessionId ?? '').replace(/^session-/, '').slice(0, 8) }),
          socket('output', 'source', 'evo-graph-socket-out', 65),
          data.advancedMode && jsx('span', { className: 'evo-graph-socket-label evo-graph-socket-label-out', style: { position: 'absolute', right: 16, top: 59 }, children: t('graphConnect') }),
        ] })
        : jsxs('div', { className: 'evo-graph-node-body', children: [
          jsx('span', { className: 'evo-graph-node-title', title: node.title, children: node.title }),
          jsx('span', { className: node.ref === undefined && isMemory ? 'evo-graph-node-preview' : 'evo-graph-node-ref-name', title: node.ref?.path ?? node.content, children: node.ref === undefined ? shortPreview : refDisplayName(node.ref.path) }),
          socket('output', 'source', 'evo-graph-socket-out', 54),
          data.advancedMode && jsx('span', { className: 'evo-graph-socket-label evo-graph-socket-label-out', style: { position: 'absolute', right: 16, top: 48 }, children: t('graphConnect') }),
          node.ref !== undefined && jsx('span', { className: `evo-graph-node-preview${preview?.ok === false ? ' evo-graph-node-preview-err' : ''}`, title: preview?.text ?? preview?.error, children: shortPreview }),
        ] }),
    ],
  })
}

function kindLabel(node: GraphNode, isChat: boolean, isMemory: boolean): string {
  if (isChat) return t('graphChat')
  return node.displayKind ?? (isMemory ? t('graphMemory') : t('graphResource'))
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

function GraphEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps<XYEdge<{ graphEdge: GraphEdge; interacting?: boolean; onContextMenu: (event: MouseEvent, edge: GraphEdge) => void }>>) {
  const graphEdge = data?.graphEdge
  const fallback = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  // 拖拽进行中忽略存储的路由拐点/旧标签位：端点实时更新而拐点陈旧会让曲线
  // 「绕过旧位置」，视觉上即连线滞后。此时改用完全由实时端点生成的曲线。
  const stored = data?.interacting ? [] : graphEdge?.routePoints ?? []
  const points = stored.length >= 2 ? [{ x: sourceX, y: sourceY }, ...stored.slice(1, -1), { x: targetX, y: targetY }] : []
  const path = points.length >= 2 ? routePath(points) : fallback[0]
  const label = graphEdge?.label?.trim() ?? ''
  const labelPoint = !data?.interacting && graphEdge?.labelPosition !== undefined ? graphEdge.labelPosition : midpoint(points) ?? { x: fallback[1], y: fallback[2] }
  const isFork = graphEdge?.behavior === 'fork' || graphEdge?.toPort === 'context'
  const relation = graphEdge?.behavior === 'relation'
  const enabled = isFork || graphEdge?.enabled !== false && !relation
  // demo 同款：描边/线宽走内联样式（stroke #d2d2d2 系），选中类不改变颜色（与官网一致）；
  // 虚线流动动画由 edge.animated + xyflow 基础 CSS（dashdraw .5s linear infinite）驱动。
  const stroke = isFork ? 'var(--graph-fork)' : relation ? 'var(--graph-edge-default)' : 'var(--graph-reference)'
  return jsxs(Fragment, { children: [
    jsx('g', { onContextMenu: (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); if (graphEdge !== undefined) data?.onContextMenu(event, graphEdge) }, children: jsx(BaseEdge, {
      id,
      path,
      markerEnd,
      interactionWidth: 20,
      style: { stroke, strokeWidth: 2 },
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
  const rects = members.map((node) => ({ x: node.x, y: node.y, width: 200, height: node.type === 'chat' ? 96 : node.ref !== undefined ? 116 : 96 }))
  for (const child of childGroups) {
    const bounds = groupBounds(graph, child, nextAncestry)
    rects.push({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
  }
  const minX = rects.length === 0 ? group.x ?? 40 : Math.min(...rects.map((rect) => rect.x))
  const minY = rects.length === 0 ? group.y ?? 40 : Math.min(...rects.map((rect) => rect.y))
  const maxX = rects.length === 0 ? minX + 200 : Math.max(...rects.map((rect) => rect.x + rect.width))
  const maxY = rects.length === 0 ? minY + 96 : Math.max(...rects.map((rect) => rect.y + rect.height))
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
      // demo 节点 wrapper 同款淡入淡出过渡（transition-opacity duration-400）
      className: 'evo-node-fade',
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

function toXYEdges(props: ChatGraphCanvasProps, xyNodes: readonly CanvasNode[], interacting: boolean): XYEdge<{ graphEdge: GraphEdge; interacting?: boolean; onContextMenu: (event: MouseEvent, edge: GraphEdge) => void }>[] {
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
      // 端点常显（demo 同款），两种模式都绑定语义端口，连线终点落在圆心上；
      // 折叠分组仍用默认端点。
      sourceHandle: source.startsWith('group:') ? undefined : 'output',
      target,
      targetHandle: target.startsWith('group:') ? undefined : edge.toPort,
      type: 'graph',
      // demo 同款：全部连线 animated（xyflow 内置 dashdraw .5s 虚线流动）
      // + transition-opacity duration-400（g 层淡入淡出）。
      animated: true,
      className: 'evo-edge-fade',
      data: { graphEdge: edge, interacting, onContextMenu: props.onEdgeContextMenu },
    }))
}

export function ChatGraphCanvas(props: ChatGraphCanvasProps) {
  return jsx(ReactFlowProvider, { children: jsx(ChatGraphCanvasInner, { ...props }) })
}

function ChatGraphCanvasInner(props: ChatGraphCanvasProps) {
  // 拖拽期间 onNodesChange 每帧触发本组件重渲染；节点/边对象必须只在数据变化时重建，
  // 否则每帧都把全新 data/edges 传给 xyflow，全量调和导致连线跟随卡顿。
  const propsRef = useRef(props)
  propsRef.current = props
  const initialNodes = useMemo(
    () => toXYNodes(propsRef.current),
    [props.graph, props.visibleIds, props.matchedIds, props.selectedId, props.focusedNodeId, props.advancedMode, props.traceHighlightedIds, props.refPreviews],
  )
  // 官方同款非受控模式（defaultNodes/defaultEdges）：triggerNodeChanges 在
  // hasDefaultNodes 下同步 applyNodeChanges + 内部 setNodes —— 拖拽事件里节点与连线
  // 在同一次同步 store 更新中渲染（官网线条实时跟手的关键）。受控模式（nodes prop +
  // onNodesChange）会让变更绕 React state 一圈，连线端点明显慢半拍。
  // 外部数据（图谱内容/选中/预览/轨迹/高级模式/拖拽状态）变化时用 useReactFlow
  // 的 setNodes/setEdges 命令式同步，不再走受控 props。
  const initialEdges = useMemo(
    () => toXYEdges(propsRef.current, initialNodes, false),
    [props.graph, props.advancedMode, initialNodes],
  )
  const { fitView, setNodes: setStoreNodes, setEdges: setStoreEdges, getNodes: getStoreNodes } = useReactFlow()
  const xyNodesRef = useRef(initialNodes)
  const interactingRef = useRef(false)
  const [interacting, setInteracting] = useState(false)
  useEffect(() => {
    const fresh = toXYNodes(propsRef.current)
    xyNodesRef.current = fresh
    // 拖拽进行中保留画布当前位置（异步 props 更新不得把卡片传回存储位置）；
    // 否则（如整理布局预览）直接采用新位置。
    setStoreNodes((current) => {
      if (!interactingRef.current) return fresh
      const positions = new Map(current.filter((node) => node.type === 'graph').map((node) => [node.id, node.position]))
      return fresh.map((node) => (node.type === 'graph' && positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node))
    })
    setStoreEdges(toXYEdges(propsRef.current, fresh, interacting))
  }, [props.graph, props.visibleIds, props.matchedIds, props.selectedId, props.focusedNodeId, props.advancedMode, props.traceHighlightedIds, props.refPreviews, interacting, setStoreNodes, setStoreEdges])
  const [minimapOpen, setMinimapOpen] = useState(false)
  // XYFlow's MiniMap component does not forward arbitrary aria attributes.
  useEffect(() => {
    const minimap = document.querySelector<HTMLElement>('.evo-graph-canvas .react-flow__minimap')
    minimap?.setAttribute('role', 'img')
    minimap?.setAttribute('aria-label', t('graphMiniMap'))
  }, [minimapOpen])

  // 整理布局确认保存后重新适配视野，避免新排布落在视口外。
  const refitSignal = props.refitSignal ?? 0
  useEffect(() => {
    if (refitSignal > 0) { void fitView({ padding: 0.18, duration: 240 }) }
  }, [refitSignal, fitView])

  const handleDragStop = (_event: unknown, _node: CanvasNode, draggedNodes?: CanvasNode[]) => {
    interactingRef.current = false
    setInteracting(false)
    const changed = (draggedNodes ?? getStoreNodes() as unknown as CanvasNode[])
      .filter((node) => node.type === 'graph' && 'graphNode' in node.data)
      .map((node) => ({ id: (node.data as GraphNodeData).graphNode.id, x: Math.round(node.position.x), y: Math.round(node.position.y) }))
    props.onNodePositionsChange(changed)
  }
  const narrowNodes = useMemo(
    () => props.graph.nodes.filter((node) => props.visibleIds.has(node.id) && collapsedGroupOf(props.graph, node) === undefined),
    [props.graph, props.visibleIds],
  )
  // 画布尺寸（ResizeObserver 跟随窗口/面板变化），用于推导内容感知的缩放范围。
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = canvasRef.current
    if (el === null) return
    const update = () => setCanvasSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  // 缩放范围（用户定义，随实际内容与窗口动态推导，主画布与缩略图缩放共用）：
  //   最远 minZoom：视口能容纳「全部节点 AABB × 5」；
  //   最近 maxZoom：视口至多收到「最小节点 AABB × 2」。
  const zoomBounds = useMemo(() => {
    if (props.graph.nodes.length === 0 || canvasSize.w === 0 || canvasSize.h === 0) return { minZoom: 0.5, maxZoom: 2 }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    let smallest = Infinity
    let nw = 200, nh = 96
    for (const node of props.graph.nodes) {
      if (collapsedGroupOf(props.graph, node) !== undefined) continue
      const h = nodeHeight(node)
      minX = Math.min(minX, node.x); minY = Math.min(minY, node.y)
      maxX = Math.max(maxX, node.x + 200); maxY = Math.max(maxY, node.y + h)
      if (200 * h < smallest) { smallest = 200 * h; nw = 200; nh = h }
    }
    for (const group of props.graph.groups ?? []) {
      if (group.collapsed !== true) continue
      const b = groupBounds(props.graph, group)
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height)
    }
    const aw = Math.max(1, maxX - minX)
    const ah = Math.max(1, maxY - minY)
    const minZoom = Math.max(0.02, Math.min(canvasSize.w / (5 * aw), canvasSize.h / (5 * ah)))
    const maxZoom = Math.min(8, Math.max(minZoom + 0.2, Math.min(canvasSize.w / (2 * nw), canvasSize.h / (2 * nh))))
    return { minZoom, maxZoom }
  }, [props.graph, canvasSize])
  return jsxs('div', {
    className: 'evo-graph-canvas',
    ref: canvasRef,
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
        // 非受控：defaultNodes/defaultEdges + 命令式 setNodes/setEdges（见上方注释）。
        // 拖拽变更由 triggerNodeChanges 同步应用到内部 store，节点与连线同帧更新。
        defaultNodes: initialNodes,
        defaultEdges: initialEdges,
        nodeTypes,
        edgeTypes,
        fitView: true,
        fitViewOptions: { padding: 0.18, duration: 180 },
        minZoom: zoomBounds.minZoom,
        maxZoom: zoomBounds.maxZoom,
        nodesDraggable: true,
        nodesConnectable: props.advancedMode,
        elementsSelectable: true,
        deleteKeyCode: null,
        onNodeDragStart: () => { interactingRef.current = true; setInteracting(true) },
        onNodeDragStop: handleDragStop,
        onNodeClick: (_event: MouseEvent, node: CanvasNode) => { if (node.type === 'graph') props.onSelect((node.data as GraphNodeData).graphNode.id) },
        onPaneClick: () => { props.onSelect(null); props.onContextMenu(null) },
        onNodeContextMenu: (event: MouseEvent, node: CanvasNode) => { if (node.type === 'graph') props.onNodeContextMenu(event, (node.data as GraphNodeData).graphNode) },
        onEdgeContextMenu: (event: MouseEvent, edge: XYEdge<{ graphEdge: GraphEdge }>) => { const original = props.graph.edges.find((item) => item.id === edge.id); if (original !== undefined) props.onEdgeContextMenu(event, original) },
        onConnect: props.onConnect,
        'aria-label': t('graphCanvasAria'),
        proOptions: { hideAttribution: true },
        children: [
          jsx(Background, {}),
          jsx(Controls, { showInteractive: true, position: 'bottom-right' as const, 'aria-label': t('graphControlsAria') }),
          minimapOpen && jsx(MiniMap, { pannable: true, zoomable: true, position: 'bottom-left' as const, 'aria-label': t('graphMiniMap'), nodeColor: (node: CanvasNode) => node.type === 'graphGroup' ? 'var(--graph-minimap-group)' : (node.data as GraphNodeData).graphNode.type === 'chat' ? 'var(--graph-minimap-chat)' : 'var(--graph-minimap-resource)' }),
          // 缩略图开关：纯图标小按钮。收起时在画布左下角；展开时贴在缩略图右侧外、与底边对齐。
          jsx('button', {
            type: 'button',
            className: 'evo-graph-minimap-toggle',
            'aria-pressed': minimapOpen,
            'aria-label': minimapOpen ? t('graphMinimapHide') : t('graphMinimapShow'),
            title: minimapOpen ? t('graphMinimapHide') : t('graphMinimapShow'),
            onClick: (event: MouseEvent) => { event.stopPropagation(); setMinimapOpen((value) => !value) },
            style: minimapOpen ? { left: 160, bottom: 12 } : { left: 12, bottom: 12 },
            children: jsx(MapIcon, {}),
          }),
        ],
      }),
      props.menuElement,
    ],
  })
}
