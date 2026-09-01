import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { t } from './i18n'
import {
  MessageSquare, Database, FileText, Map as MapIcon, Info,
  User, Eye, StickyNote, ListOrdered, FlaskConical, Library, Sparkles, File as FileIcon,
  Beaker, Play, ScrollText, BarChart3, Code, FileCode2, PenLine, Lightbulb, Layers,
  BookMarked, Target,
} from 'lucide-react'
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
  type Connection,
  type EdgeProps,
  type NodeProps,
  type Node as XYNode,
  type Edge as XYEdge,
} from '@xyflow/react'
import { cubicAt, cubicMidpoint, cubicPath, directCurveHits, edgeCurve, PORT_OFFSETS, routeWithAstarPoints, type EdgePosName } from './chatgraph-layout-worker'
import { displayKindLabel, defaultNodeSize, nodeSize, NODE_SCALE_MAX } from './chatgraph'
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
  /** 命中脉冲（graph-recent-hits / 体检卡定位）：约 2 秒发光动画后消退。 */
  pulsing: boolean
  /** 收纳系统连线后，该节点被收起的系统默认连线数（角落小徽标）。 */
  systemEdgeCount: number
  onOpen: (node: GraphNode) => void
  onEdit: (node: GraphNode) => void
  onContextMenu: (event: MouseEvent, node: GraphNode) => void
  /** 右下角拖拽缩放开始/结束：开始时置 interacting 保护（轮询刷新不得把卡片拍回旧尺寸）。 */
  onResizeStart: () => void
  onResizeStop: (id: string, width: number, height: number) => void
}

interface GraphGroupData extends Record<string, unknown> {
  graphGroup: GraphGroup
  memberCount: number
  onToggleGroup: (groupId: string) => void
}

interface GraphEdgeData extends Record<string, unknown> {
  graphEdge: GraphEdge
  interactionState: { current: boolean }
  /** 同一对节点间存在反向读写线：两根紧贴的平行线各一个反向箭头（方案 A）。 */
  parallel?: boolean
  /** 画布上可见节点矩形（徽标/标签锚点避让节点用）。 */
  nodeRects?: Array<{ id: string; x: number; y: number; width: number; height: number; kind: 'chat' | 'memory' }>
  onContextMenu: (event: MouseEvent, edge: GraphEdge) => void
}

type CanvasNode = XYNode<GraphNodeData | GraphGroupData>

export interface ChatGraphCanvasProps {
  graph: ChatGraph
  visibleIds: Set<string>
  matchedIds: Set<string> | null
  focusedNodeId: string | null | undefined
  selectedId: string | null
  refPreviews: Record<string, { ok: boolean; text?: string; error?: string }>
  traceHighlightedIds: Set<string>
  /** 命中脉冲中的节点（父层定时消退）。 */
  pulseIds: Set<string>
  /** 收纳系统连线：system 边折叠隐藏，节点角落显示计数徽标。 */
  collapseSystem: boolean
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
  /** 节点缩放结束（右下角手柄）：持久化尺寸并清除该节点的旧连线路由。 */
  onNodeResize: (id: string, width: number, height: number) => void
  onNarrowOpen: (node: GraphNode) => void
  /** 整理布局确认保存后置 true 一帧，用于触发视野重新适配。 */
  refitSignal?: number
}

const nodeTypes = { graph: GraphNodeView, graphGroup: GraphGroupView }

function refDisplayName(refPath: string): string {
  const base = refPath.split(/[\\/]/).filter((part) => part !== '').pop() ?? refPath
  return base.length > 22 ? `${base.slice(0, 21)}…` : base
}

function nodeHeight(node: GraphNode): number {
  return nodeSize(node).height
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

/** displayKind → 子类型图标（品种标签；未知 displayKind 回退大类图标）。 */
const DISPLAY_KIND_ICONS: Record<string, typeof MessageSquare> = {
  profile: User,
  guidance: BookMarked,
  observation: Eye,
  note: StickyNote,
  turns: ListOrdered,
  science: FlaskConical,
  library: Library,
  skill: Sparkles,
  file: FileIcon,
  paper: FileText,
  experiment: Beaker,
  run: Play,
  log: ScrollText,
  result: BarChart3,
  code: Code,
  latex: FileCode2,
  manuscript: PenLine,
  idea: Lightbulb,
  candidate: Target,
  'memory-collection': Layers,
  memory: Database,
}

function nodeDisplayIcon(node: GraphNode): typeof MessageSquare {
  const byKind = node.displayKind === undefined ? undefined : DISPLAY_KIND_ICONS[node.displayKind]
  if (byKind !== undefined) return byKind
  return kindIcon(nodeKind(node))
}

/** 相对时间（节点"最后活跃"小徽标；title 显示完整时间）。 */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (!Number.isFinite(diff) || diff < 0) return t('graphTimeNow')
  if (diff < 60_000) return t('graphTimeNow')
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return t('graphTimeMin').replace('{n}', String(minutes))
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('graphTimeHour').replace('{n}', String(hours))
  return t('graphTimeDay').replace('{n}', String(Math.floor(hours / 24)))
}

/** 图例（Legend）单行：左侧样式样例 + 右侧一句大白话解释。 */
function legendRow(kind: string, text: string) {
  return jsxs('div', { className: 'evo-graph-legend-row', children: [
    jsx('span', { className: `evo-graph-legend-sample ${kind}`, 'aria-hidden': true }),
    jsx('span', { className: 'evo-graph-legend-text', children: text }),
  ] }, kind)
}

/** 图例（Legend）节点行：左侧迷你节点芯片 + 右侧解释。 */
function legendChip(kind: string, label: string, text: string) {
  return jsxs('div', { className: 'evo-graph-legend-row', children: [
    jsx('span', { className: `evo-graph-legend-chip ${kind}`, 'aria-hidden': true, children: label }),
    jsx('span', { className: 'evo-graph-legend-text', children: text }),
  ] }, kind)
}

function GraphNodeView({ data, selected }: NodeProps<XYNode<GraphNodeData>>) {
  const node = data.graphNode
  const kind = nodeKind(node)
  const isChat = node.type === 'chat'
  const isMemory = kind === 'memory'
  const preview = data.preview
  const Icon = nodeDisplayIcon(node)
  const isEmptyNode = node.empty === true
  const activeAt = node.lastActiveAt ?? node.updatedAt
  const socket = (id: string, type: 'source' | 'target', className: string, top: number) => {
    // 端口悬停提示（大白话）：每个端口是干什么的，一贴即知
    const socketTitle = id === 'context' ? t('graphSocketCtxHint')
      : id === 'memory' ? t('graphSocketMemHint')
        : id === 'in' ? t('graphSocketWriteInHint')
          : isChat ? t('graphSocketOutChatHint') : t('graphSocketOutMemoryHint')
    return jsx(Handle, {
      id,
      type,
      position: type === 'source' ? Position.Right : Position.Left,
      // demo 端点常显：10px gray-400(#99a1af) 圆点、无边框、圆心压在卡片边线上
      className: `evo-graph-socket ${className}`,
      style: { top, transform: 'translateY(-50%)' },
      'aria-label': id === 'context' ? t('graphSocketContext') : id === 'memory' ? t('graphSocketMemory') : id === 'in' ? t('graphSocketWriteIn') : t('graphSocketOutput'),
      title: socketTitle,
    })
  }
  const shortPreview = node.ref !== undefined
    ? preview === undefined ? t('graphReading') : preview.ok ? (preview.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 24) : (preview.error ?? t('graphRefUnavailable')).slice(0, 24)
    : (node.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 24)
  // 缩放（右下角手柄）：下限=设计尺寸、上限=3×默认；尺寸持久化在节点数据里并参与布局计算
  const nodeDef = defaultNodeSize(node)
  // reactflow.dev 首页 hero demo 的卡片结构：半透明圆角卡片 + 等宽小字标题条 + 实色圆角主体。
  // 标题条 = 类型图标 + 等宽类型标签（demo 的 "shape color"/"output" 位），主体 = 标题 + 元信息。
  return jsxs('div', {
    className: `evo-graph-node evo-graph-node-${kind}${selected || data.focused ? ' evo-graph-node-sel' : ''}${data.highlighted ? ' evo-graph-node-trace' : ''}${data.pulsing ? ' evo-graph-node-hit' : ''}${isEmptyNode ? ' evo-graph-node-empty' : ''}${node.origin === 'agent' ? ' evo-graph-node-candidate' : ''}`,
    style: { position: 'relative', width: '100%', height: '100%' },
    'data-node-id': node.id,
    'data-global': node.scope === 'global' || undefined,
    'data-status': node.status,
    'data-pinned': node.pinned === true || undefined,
    tabIndex: 0,
    role: 'group',
    'aria-roledescription': t('graphNodeAriaRole'),
    'aria-label': `${node.title}${t('graphAriaSep')}${displayKindLabel(node.displayKind, node.type)}${data.highlighted ? t('graphReadThisTurn') : ''}`,
    onDoubleClick: () => data.onOpen(node),
    onContextMenu: (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); data.onContextMenu(event, node) },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); data.onOpen(node) }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); data.onContextMenu(event as unknown as MouseEvent, node) }
    },
    children: [
      jsxs('div', { className: 'evo-graph-node-titlebar', children: [
        jsx('span', { className: 'evo-graph-node-icon', 'aria-hidden': true, children: jsx(Icon, {}) }),
        jsx('span', { className: 'evo-graph-node-kind', children: displayKindLabel(node.displayKind, node.type) }),
        jsxs('span', { className: 'evo-graph-node-headermeta', children: [
          node.origin === 'agent' && jsx('span', { className: 'evo-graph-node-candidate-badge', children: t('graphCandidateBadge') }),
          !isChat && node.scope === 'global' && jsx('span', { className: 'evo-graph-node-scopechip', children: t('graphGlobal') }),
          isEmptyNode && jsx('span', { className: 'evo-graph-node-empty-chip', children: t('graphEmptyBadge') }),
          data.systemEdgeCount > 0 && jsx('span', { className: 'evo-graph-node-badge', title: t('graphSystemBadgeTitle').replace('{n}', String(data.systemEdgeCount)), children: String(data.systemEdgeCount) }),
          typeof node.compactionCount === 'number' && node.compactionCount > 0 && jsx('span', {
            className: 'evo-graph-node-badge evo-graph-node-badge-warn',
            title: t('graphCompactionsTitle').replace('{n}', String(node.compactionCount)),
            children: t('graphCompactionsBadge').replace('{n}', String(node.compactionCount)),
          }),
          typeof activeAt === 'number' && jsx('span', { className: 'evo-graph-node-badge', title: new Date(activeAt).toLocaleString(), children: relativeTime(activeAt) }),
        ] }),
      ] }),
      isChat
        ? jsxs('div', { className: 'evo-graph-node-body', children: [
          // 端口偏移来自 PORT_OFFSETS（布局评分与渲染的单一来源，R6 端口语义）
          socket('context', 'target', 'evo-graph-socket-in evo-graph-socket-ctx', PORT_OFFSETS.chat.in.context),
          // 端口小字放卡片外侧（贴端口点、带底色芯片）：不与卡内标题/短 ID 挤在一起
          jsx('span', { className: 'evo-graph-socket-label evo-graph-socket-label-ctx', style: { position: 'absolute', left: -4, top: PORT_OFFSETS.chat.in.context, transform: 'translate(-100%, -50%)' }, children: t('graphBranch') }),
          socket('memory', 'target', 'evo-graph-socket-in evo-graph-socket-mem', PORT_OFFSETS.chat.in.memory),
          jsx('span', { className: 'evo-graph-socket-label evo-graph-socket-label-mem', style: { position: 'absolute', left: -4, top: PORT_OFFSETS.chat.in.memory, transform: 'translate(-100%, -50%)' }, children: t('graphRef') }),
          jsx('span', { className: 'evo-graph-node-title', title: node.title, children: node.title }),
          jsx('span', { className: 'evo-graph-node-sid', title: node.sessionId, children: (node.sessionId ?? '').replace(/^session-/, '').slice(0, 8) }),
          socket('output', 'source', 'evo-graph-socket-out', PORT_OFFSETS.chat.out),
          jsx('span', { className: 'evo-graph-socket-label evo-graph-socket-label-out', style: { position: 'absolute', right: -4, top: PORT_OFFSETS.chat.out, transform: 'translate(100%, -50%)' }, children: t('graphConnect') }),
        ] })
        : jsxs('div', { className: 'evo-graph-node-body', children: [
          jsx('span', { className: 'evo-graph-node-title', title: node.title, children: node.title }),
          jsx('span', { className: node.ref === undefined && isMemory ? 'evo-graph-node-preview' : 'evo-graph-node-ref-name', title: node.ref?.path ?? node.content, children: node.ref === undefined ? shortPreview : refDisplayName(node.ref.path) }),
          // 写线落点：不可见输入端口（普通模式拖 chat → memory 建沉淀通道；不新增可见元素）
          socket('in', 'target', 'evo-graph-socket-ghost', PORT_OFFSETS.memory.in.default),
          jsx('span', { className: 'evo-graph-socket-label evo-graph-socket-label-in', style: { position: 'absolute', left: -4, top: PORT_OFFSETS.memory.in.default, transform: 'translate(-100%, -50%)' }, children: t('graphWriteIn') }),
          socket('output', 'source', 'evo-graph-socket-out', PORT_OFFSETS.memory.out),
          jsx('span', { className: 'evo-graph-socket-label evo-graph-socket-label-out', style: { position: 'absolute', right: -4, top: PORT_OFFSETS.memory.out, transform: 'translate(100%, -50%)' }, children: t('graphConnect') }),
          node.ref !== undefined && jsx('span', { className: `evo-graph-node-preview${preview?.ok === false ? ' evo-graph-node-preview-err' : ''}`, title: preview?.text ?? preview?.error, children: shortPreview }),
        ] }),
      // 四角倒角三角（缩放提示）：几何与配色全部在样式表（外扩 0.5px 压住边框内缝）
      jsx('span', { className: 'evo-resize-chamfer evo-resize-chamfer-tl', 'aria-hidden': true }),
      jsx('span', { className: 'evo-resize-chamfer evo-resize-chamfer-tr', 'aria-hidden': true }),
      jsx('span', { className: 'evo-resize-chamfer evo-resize-chamfer-bl', 'aria-hidden': true }),
      jsx('span', { className: 'evo-resize-chamfer evo-resize-chamfer-br', 'aria-hidden': true }),
      selected && jsx(NodeResizer, {
        isVisible: true,
        minWidth: nodeDef.width,
        minHeight: nodeDef.height,
        maxWidth: nodeDef.width * NODE_SCALE_MAX,
        maxHeight: nodeDef.height * NODE_SCALE_MAX,
        onResizeStart: () => data.onResizeStart(),
        // 注意：这个 xyflow 版本的 prop 名是 onResizeEnd（onResizeStop 会被静默忽略）；
        // jsx() 的 props 无上下文类型，参数需显式标注（与 @xyflow/system ResizeParams 兼容）
        onResizeEnd: (_event: unknown, params: { width: number; height: number }) => data.onResizeStop(node.id, Math.round(params.width), Math.round(params.height)),
      }),
    ],
  })
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

/** 静止边绕行结果（三级降级）：② = 单段弓形贝塞尔（bow）；③ = A* 样条（spline + samples）。 */
interface EdgeDetour {
  /** 第 2 级：直连曲线的弓形偏移（控制点 y 平移量，端口切线保持水平）。 */
  bow?: number
  /** 第 3 级：Catmull-Rom 样条的完整 SVG path（多段 C 命令）。 */
  spline?: string
  /** 第 3 级：样条内部采样点（标签锚点避让用，不含端点）。 */
  samples?: Array<{ x: number; y: number }>
}

/** A* 航路折线 → 拐点序列：近邻（<2px）合并 + 近共线中点（点到弦距离 < 0.5px）合并。 */
function polylineCorners(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const deduped: Array<{ x: number; y: number }> = []
  for (const point of points) {
    const last = deduped[deduped.length - 1]
    if (last !== undefined && Math.hypot(point.x - last.x, point.y - last.y) < 2) continue
    deduped.push(point)
  }
  const corners: Array<{ x: number; y: number }> = []
  for (const point of deduped) {
    if (corners.length >= 2) {
      const a = corners[corners.length - 2]!
      const b = corners[corners.length - 1]!
      const chord = Math.hypot(point.x - a.x, point.y - a.y)
      const distance = chord === 0
        ? Math.hypot(b.x - point.x, b.y - point.y)
        : Math.abs((point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x)) / chord
      if (distance < 0.5) {
        corners[corners.length - 1] = point // b 落在 a→point 弦上：吞掉中拐点
        continue
      }
    }
    corners.push(point)
  }
  return corners
}

/** Douglas-Peucker 抽稀（拐点抽稀后仍 > 6 段时的兜底，eps = 点到弦的允许偏差 px）。 */
function thinPolyline(points: Array<{ x: number; y: number }>, eps: number): Array<{ x: number; y: number }> {
  if (points.length <= 2) return [...points]
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [start, end] = stack.pop()!
    if (end - start < 2) continue
    const a = points[start]!
    const b = points[end]!
    const chord = Math.hypot(b.x - a.x, b.y - a.y)
    let maxDistance = -1
    let maxIndex = -1
    for (let i = start + 1; i < end; i += 1) {
      const point = points[i]!
      const distance = chord === 0
        ? Math.hypot(point.x - a.x, point.y - a.y)
        : Math.abs((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / chord
      if (distance > maxDistance) {
        maxDistance = distance
        maxIndex = i
      }
    }
    if (maxIndex > 0 && maxDistance > eps) {
      keep[maxIndex] = 1
      stack.push([start, maxIndex], [maxIndex, end])
    }
  }
  return points.filter((_, index) => keep[index] === 1)
}

/**
 * 拐点折线 → Catmull-Rom 三次贝塞尔样条（多段 C 命令，C1 连续，无直角感）：
 * 每段 Hermite 转贝塞尔 c1 = P0 + T0/3、c2 = P1 − T1/3；内部节点切线取相邻点
 * 中心差分保证 C1；首段切线钳制水平向右、末段切线钳制水平左进（c1x > 源端口x、
 * c2x < 目标端口x——样条段同样满足右出左进的端口切线契约）。
 * 同时输出每段 7 个内部采样点（标签锚点避让用，不含端点）。
 */
function cornerSpline(corners: ReadonlyArray<{ x: number; y: number }>): { path: string; samples: Array<{ x: number; y: number }> } {
  const fmt = (v: number) => Math.round(v * 100) / 100
  const last = corners.length - 1
  const tangents = corners.map((point, index) => {
    if (index === 0) return { x: Math.max(corners[1]!.x - point.x, 24), y: 0 }
    if (index === last) return { x: Math.max(point.x - corners[last - 1]!.x, 24), y: 0 }
    return { x: (corners[index + 1]!.x - corners[index - 1]!.x) / 2, y: (corners[index + 1]!.y - corners[index - 1]!.y) / 2 }
  })
  let d = `M ${fmt(corners[0]!.x)} ${fmt(corners[0]!.y)}`
  const samples: Array<{ x: number; y: number }> = []
  for (let i = 1; i < corners.length; i += 1) {
    const p0 = corners[i - 1]!
    const p1 = corners[i]!
    const c1x = p0.x + tangents[i - 1]!.x / 3
    const c1y = p0.y + tangents[i - 1]!.y / 3
    const c2x = p1.x - tangents[i]!.x / 3
    const c2y = p1.y - tangents[i]!.y / 3
    d += ` C ${fmt(c1x)} ${fmt(c1y)}, ${fmt(c2x)} ${fmt(c2y)}, ${fmt(p1.x)} ${fmt(p1.y)}`
    for (let k = 1; k < 8; k += 1) samples.push(cubicAt(p0.x, p0.y, c1x, c1y, c2x, c2y, p1.x, p1.y, k / 8))
  }
  return { path: d, samples }
}

/** 双向平行线偏移量（px）：同一对节点的读/写两根线各自向相反侧平移。 */
const PARALLEL_OFFSET = 5

/** 箭头 marker 定义（主题感知：fill 走 CSS 变量，明暗切换自动跟随）。 */
function arrowMarker(id: string, color: string, opacity: number) {
  return jsx('marker', {
    id,
    viewBox: '0 0 12 12',
    refX: '9.5',
    refY: '6',
    markerWidth: '5.5',
    markerHeight: '5.5',
    orient: 'auto',
    markerUnits: 'strokeWidth',
    children: jsx('path', { d: 'M 1 1 L 11 6 L 1 11 z', style: { fill: color, opacity } }),
  })
}

const GraphEdgeView = memo(function GraphEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<XYEdge<GraphEdgeData>>) {
  const graphEdge = data?.graphEdge
  const interacting = data?.interactionState?.current === true
  // 平行偏移：按自身方向取法向平移；反向线因方向相反自然偏到另一侧
  let offsetX = 0
  let offsetY = 0
  if (data?.parallel === true) {
    const dx = targetX - sourceX
    const dy = targetY - sourceY
    const len = Math.hypot(dx, dy)
    if (len > 0.001) {
      offsetX = (-dy / len) * PARALLEL_OFFSET
      offsetY = (dx / len) * PARALLEL_OFFSET
    }
  }
  const sx = sourceX + offsetX
  const sy = sourceY + offsetY
  const tx = targetX + offsetX
  const ty = targetY + offsetY
  // v6：连线 = 单段三次贝塞尔，严格右出左进（R6 端口语义，无条件覆盖旧持久化朝向）；
  // 渲染与布局评分共用 edgeCurve 几何——所见即评分所见。
  const srcPos: EdgePosName = 'right'
  const tgtPos: EdgePosName = 'left'
  // v8/v10：历史拐点（routePoints）与折线路径永久废弃——它们是旧几何下的"方案"，
  // 节点挪动后必然失配；连线恒为按当前坐标实时推导的平滑贝塞尔（禁止横平竖直折线）。
  // v8-robust：bow = 端点几何的连续函数（渲染时实时推导，不读持久化——杜绝方案失配剧变）
  // 拖拽中：曲线用极小弓跟随（几何失配最小化）；静止：三级降级，全部输出平滑贝塞尔
  // 且端口处切线恒水平（bow 只平移控制点 y，不动 x）：
  // ① 直连单段贝塞尔（bow=0）不撞任何中间节点 → 直接用；
  // ② 撞节点 → 弓形搜索：edgeCurve 单段贝塞尔叠加 bow，候选 = 两符号 × 递增幅值
  //    （base = |dy|/2 + 40 的 0.5/1/1.5/2/3/4 倍，下限 24、上限 600），按 (|bow|, bow)
  //    升序取第一个采样完全不穿节点的——绝大多数撞节点边停在这一级（单段、低阶）；
  // ③ 弓形全部失败（罕见密集）→ A* 航路 → 抽稀到拐点 → Catmull-Rom 三次贝塞尔样条
  //    （首段切线水平向右、末段切线水平左进）。
  const liveBow = (() => {
    const dy = Math.abs(ty - sy)
    const dxAbs = Math.abs(tx - sx)
    if (dxAbs < 8) return 0 // 反馈向边交给 orientation 逻辑（静态场景才有）
    if (dy < 3) return 12 * (ty >= sy ? 1 : -1) // 近等高：固定微量弓防直线退化
    return 0
  })()
  const detour: EdgeDetour | undefined = (() => {
    if (interacting) return undefined // 拖拽中一律 liveBow 单段贝塞尔平滑跟随
    if (Math.abs(tx - sx) < 8) return undefined // 反馈向边交给 orientation 逻辑（静态场景才有）
    const rects = data?.nodeRects ?? []
    const fromId = graphEdge?.from ?? ''
    const toId = graphEdge?.to ?? ''
    // 第 1 级：直连不撞 → 单段贝塞尔（bow=0）
    if (!directCurveHits({ x: sx, y: sy }, { x: tx, y: ty }, rects, fromId, toId)) return undefined
    // 第 2 级：弓形搜索（单段三次贝塞尔，控制点与端口共 y + bow）
    const bowBase = Math.abs(ty - sy) * 0.5 + 40
    const bowCandidates = [...new Set(
      [0.5, 1, 1.5, 2, 3, 4].flatMap((factor) => {
        const magnitude = Math.min(600, Math.max(24, bowBase * factor))
        return [-magnitude, magnitude]
      }),
    )].sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)
    for (const bow of bowCandidates) {
      if (!directCurveHits({ x: sx, y: sy }, { x: tx, y: ty }, rects, fromId, toId, bow)) return { bow }
    }
    // 第 3 级：A* 航路 → 拐点抽稀 → Catmull-Rom 样条（段数 = 拐点数，> 6 段再抽稀）
    const rectMap = new Map(rects.map((rect) => [rect.id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }]))
    const poly = routeWithAstarPoints(
      { x: sx, y: sy }, { x: tx, y: ty }, graphEdge?.toPort ?? 'context', rectMap,
      rects.find((rect) => rect.id === fromId)?.kind, rects.find((rect) => rect.id === toId)?.kind,
    )
    if (poly === undefined || poly.length < 2) return undefined
    let corners = polylineCorners(poly)
    for (let eps = 12; corners.length > 7 && eps <= 96; eps *= 2) corners = thinPolyline(corners, eps)
    if (corners.length < 2) return undefined
    const spline = cornerSpline(corners)
    return { spline: spline.path, samples: spline.samples }
  })()
  const bow = interacting ? liveBow : (detour?.bow ?? 0)
  const curve = edgeCurve(sx, sy, srcPos, tx, ty, tgtPos, bow)
  const path = detour?.spline ?? cubicPath(sx, sy, curve.c1x, curve.c1y, curve.c2x, curve.c2y, tx, ty)
  const label = graphEdge?.label?.trim() ?? ''
  const storedLabelPoint = !interacting && graphEdge?.labelPosition !== undefined
    ? { x: graphEdge.labelPosition.x + offsetX, y: graphEdge.labelPosition.y + offsetY }
    : undefined
  // 徽标/标签锚点：无持久化位置时，在渲染曲线上挑"离所有节点卡片最远"的采样点——
  // 大弧线中点容易漂到某张卡片上压住文字（文字重叠的主要来源），择空而居。
  // 样条边（第 3 级）用样条采样点，其余用单段贝塞尔采样点。
  const anchorPoint = (() => {
    const anchorSamples = detour?.samples
      ?? Array.from({ length: 24 }, (_, index) => cubicAt(sx, sy, curve.c1x, curve.c1y, curve.c2x, curve.c2y, tx, ty, (index + 1) / 25))
    const candidates = (data?.nodeRects ?? []).filter((rect) => rect.id !== graphEdge?.from && rect.id !== graphEdge?.to)
    if (candidates.length === 0 || anchorSamples.length === 0) return undefined
    let bestPoint = anchorSamples[0]!
    let bestDist = -1
    for (const point of anchorSamples) {
      let minDist = Infinity
      for (const rect of candidates) {
        const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width))
        const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height))
        minDist = Math.min(minDist, Math.hypot(dx, dy))
      }
      if (minDist > bestDist) {
        bestDist = minDist
        bestPoint = point
      }
    }
    return bestDist > 0 ? bestPoint : undefined
  })()
  const splineLabelPoint = detour?.samples !== undefined ? midpoint(detour.samples) : undefined
  const labelPoint = storedLabelPoint ?? anchorPoint ?? splineLabelPoint
    ?? cubicMidpoint(sx, sy, curve.c1x, curve.c1y, curve.c2x, curve.c2y, tx, ty)
  const isFork = graphEdge?.behavior === 'fork' || graphEdge?.toPort === 'context'
  const relation = graphEdge?.behavior === 'relation'
  const isWrite = graphEdge?.behavior === 'write'
  // 存量 relation 已迁移为"带说明的读线"：与 reference 同视觉（绿色实线）
  const systemEdge = graphEdge?.system === true && !isFork && !isWrite
  const enabled = isFork || isWrite || graphEdge?.enabled !== false
  // 描边/线宽走内联样式；animated 由外层 EdgeWrapper + xyflow dashdraw 驱动。
  const stroke = isFork ? 'var(--graph-fork)' : isWrite ? 'var(--graph-write)' : 'var(--graph-reference)'
  const edgeClassName = `evo-graph-edge ${isFork ? 'evo-graph-edge-ctx' : isWrite ? 'evo-graph-edge-write' : 'evo-graph-edge-mem'}${relation ? ' evo-graph-edge-relation' : ''}${systemEdge ? ' evo-graph-edge-system' : ''}${enabled ? '' : ' evo-graph-edge-disabled'}`
  // hover 一句话说明（大白话；系统默认连线注明来源）
  const tooltip = isFork
    ? t('graphEdgeTooltipFork')
    : isWrite
      ? t('graphEdgeTooltipWrite')
      : systemEdge
        ? t('graphEdgeTooltipSystem')
        : t('graphEdgeTooltipRead')
  const writeCount = graphEdge?.writeCount
  // 方向箭头：按边类型选对应颜色的 marker（定义见画布容器内的 <defs>）
  const arrowId = isFork ? 'evo-arrow-fork' : isWrite ? 'evo-arrow-write' : systemEdge ? 'evo-arrow-system' : 'evo-arrow-read'
  return jsxs(Fragment, { children: [
    jsxs('g', { onContextMenu: (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); if (graphEdge !== undefined) data?.onContextMenu(event, graphEdge) }, children: [
      jsx('title', { children: tooltip }),
      jsx(BaseEdge, { id, path, markerEnd: `url(#${arrowId})`, interactionWidth: 20, style: { stroke, strokeWidth: systemEdge ? 1.2 : 2 }, className: edgeClassName }),
    ] }),
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
    isWrite && typeof writeCount === 'number' && writeCount > 0 && jsx(EdgeLabelRenderer, { children: jsx('div', {
      className: 'evo-graph-edge-badge',
      title: t('graphWriteCountTitle')
        .replace('{n}', String(writeCount))
        .replace('{time}', typeof graphEdge?.lastWriteAt === 'number' ? new Date(graphEdge.lastWriteAt).toLocaleString() : '—'),
      style: { transform: `translate(-50%, -50%) translate(${labelPoint.x}px,${labelPoint.y - (label !== '' ? 22 : 10)}px)` },
      children: t('graphWriteCount').replace('{n}', String(writeCount)),
    }) }),
  ] })
})

const edgeTypes = { graph: GraphEdgeView }

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

function toXYNodes(props: ChatGraphCanvasProps, resizeHooks?: { onResizeStart: () => void; onResizeStop: (id: string, width: number, height: number) => void }): CanvasNode[] {
  // 收纳系统连线时统计每个节点被收起的系统默认连线数（角落小徽标）
  const hiddenSystemCounts = new Map<string, number>()
  if (props.collapseSystem === true) {
    for (const edge of props.graph.edges) {
      if (edge.system !== true) continue
      hiddenSystemCounts.set(edge.from, (hiddenSystemCounts.get(edge.from) ?? 0) + 1)
      hiddenSystemCounts.set(edge.to, (hiddenSystemCounts.get(edge.to) ?? 0) + 1)
    }
  }
  const nodes: CanvasNode[] = props.graph.nodes
    .filter((node) => props.visibleIds.has(node.id) && (props.matchedIds === null || props.matchedIds.has(node.id)) && collapsedGroupOf(props.graph, node) === undefined)
    .map((node) => ({
      id: node.id,
      type: 'graph',
      position: { x: node.x, y: node.y },
      width: nodeSize(node).width,
      height: nodeSize(node).height,
      // demo 节点 wrapper 同款淡入淡出过渡（transition-opacity duration-400）
      className: 'evo-node-fade',
      selected: props.selectedId === node.id,
      data: {
        graphNode: node,
        preview: props.refPreviews[node.id],
        focused: props.focusedNodeId === node.id,
        highlighted: props.traceHighlightedIds.has(node.id),
        pulsing: props.pulseIds.has(node.id),
        systemEdgeCount: hiddenSystemCounts.get(node.id) ?? 0,
        onOpen: props.onOpen,
        onEdit: props.onEdit,
        onContextMenu: props.onNodeContextMenu,
        onResizeStart: resizeHooks?.onResizeStart ?? (() => {}),
        onResizeStop: resizeHooks?.onResizeStop ?? props.onNodeResize,
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

function toXYEdges(props: ChatGraphCanvasProps, xyNodes: readonly CanvasNode[], interactionState: { current: boolean }): XYEdge<GraphEdgeData>[] {
  const ids = new Set(xyNodes.map((node) => node.id))
  // 可见节点矩形：徽标/标签锚点避让 + 实时 A* 避障探测用（kind 供端口锚点几何）
  const nodeRects = xyNodes
    .filter((node) => node.type === 'graph' && 'graphNode' in node.data)
    .map((node) => {
      const graphNode = (node.data as GraphNodeData).graphNode
      const kind = nodeKind(graphNode)
      return { id: graphNode.id, x: node.position.x, y: node.position.y, width: node.width ?? 200, height: node.height ?? 96, kind: kind === 'chat' ? 'chat' as const : 'memory' as const }
    })
  const nodeById = new Map(props.graph.nodes.map((node) => [node.id, node]))
  const endpoint = (id: string): string => {
    const node = nodeById.get(id)
    const collapsed = node === undefined ? undefined : collapsedGroupOf(props.graph, node)
    return collapsed === undefined ? id : `group:${collapsed.id}`
  }
  // 双向读写平行线判定：同一对节点同时存在方向相反的两根线（读+写）时各自偏移
  const directedPairs = new Set(props.graph.edges
    .filter((edge) => edge.toPort !== 'context' && edge.behavior !== 'fork')
    .map((edge) => `${edge.from}\u2192${edge.to}`))
  return props.graph.edges
    .map((edge) => ({ edge, source: endpoint(edge.from), target: endpoint(edge.to) }))
    .filter(({ edge, source, target }) => {
      if (!ids.has(source) || !ids.has(target) || source === target) return false
      // 收纳系统连线：system 边折叠隐藏（节点角落以徽标计数）
      if (props.collapseSystem === true && edge.system === true) return false
      return true
    })
    .map(({ edge, source, target }) => {
      const isFork = edge.behavior === 'fork' || edge.toPort === 'context'
      const relation = edge.behavior === 'relation'
      const isWrite = edge.behavior === 'write'
      const systemEdge = edge.system === true && !isFork && !isWrite
      const enabled = isFork || isWrite || edge.enabled !== false
      const stroke = isFork ? 'var(--graph-fork)' : isWrite ? 'var(--graph-write)' : 'var(--graph-reference)'
      const semanticClass = `${isFork ? 'evo-graph-edge-ctx' : isWrite ? 'evo-graph-edge-write' : 'evo-graph-edge-mem'}${relation ? ' evo-graph-edge-relation' : ''}${systemEdge ? ' evo-graph-edge-system' : ''}`
      const parallel = !isFork && directedPairs.has(`${edge.to}\u2192${edge.from}`)
      return {
        id: edge.id,
        source,
        // 端点常显（demo 同款），两种模式都绑定语义端口，连线终点落在圆心上；
        // 写线落到 memory 节点的不可见输入端口 'in'；折叠分组仍用默认端点。
        sourceHandle: source.startsWith('group:') ? undefined : 'output',
        target,
        targetHandle: target.startsWith('group:') ? undefined : isWrite ? 'in' : edge.toPort,
        // 自定义 graph edge 始终保持同一组件实例；拖拽只切换 path 数据，避免
        // graph/default 类型切换导致 SVG 卸载、动画重置或出现一帧空边。
        type: 'graph',
        style: { stroke, strokeWidth: systemEdge ? 1.2 : 2 },
        animated: true,
        className: `evo-edge-fade evo-graph-edge ${semanticClass}${enabled ? '' : ' evo-graph-edge-disabled'}`,
        data: { graphEdge: edge, interactionState, nodeRects, ...(parallel ? { parallel: true } : {}), onContextMenu: props.onEdgeContextMenu },
      }
    })
}

export function ChatGraphCanvas(props: ChatGraphCanvasProps) {
  return jsx(ReactFlowProvider, { children: jsx(ChatGraphCanvasInner, { ...props }) })
}

function ChatGraphCanvasInner(props: ChatGraphCanvasProps) {
  // 拖拽期间 onNodesChange 每帧触发本组件重渲染；节点/边对象必须只在数据变化时重建，
  // 否则每帧都把全新 data/edges 传给 xyflow，全量调和导致连线跟随卡顿。
  const propsRef = useRef(props)
  propsRef.current = props
  // 节点缩放与拖拽共用 interacting 保护：缩放期间轮询刷新不得用旧尺寸把卡片拍回去。
  // 注意：必须先于 initialNodes 声明（useMemo 回调里会引用）。
  const resizeHooksRef = useRef<{ onResizeStart: () => void; onResizeStop: (id: string, width: number, height: number) => void }>({
    onResizeStart: () => { interactingRef.current = true },
    onResizeStop: (id, width, height) => {
      interactingRef.current = false
      pendingSizesRef.current.set(id, { width, height })
      propsRef.current.onNodeResize(id, width, height)
    },
  })
  // 拖拽/缩放结束 → 保存落账之间的竞态守卫：这段窗口内轮询同步不得用旧图数据
  // 把节点拍回旧位置/旧尺寸（用户感知为"松手被吸附"）。待定值在 props 追平后清除。
  const pendingPositionsRef = useRef(new Map<string, { x: number; y: number }>())
  const pendingSizesRef = useRef(new Map<string, { width: number; height: number }>())
  const initialNodes = useMemo(
    () => toXYNodes(propsRef.current, resizeHooksRef.current),
    [props.graph, props.visibleIds, props.matchedIds, props.selectedId, props.focusedNodeId, props.traceHighlightedIds, props.refPreviews, props.pulseIds, props.collapseSystem],
  )
  // 官方同款非受控模式（defaultNodes/defaultEdges）：triggerNodeChanges 在
  // hasDefaultNodes 下同步 applyNodeChanges + 内部 setNodes —— 拖拽事件里节点与连线
  // 在同一次同步 store 更新中渲染（官网线条实时跟手的关键）。受控模式（nodes prop +
  // onNodesChange）会让变更绕 React state 一圈，连线端点明显慢半拍。
  const interactingRef = useRef(false)
  // 外部数据通过公开的 store API 同步到非受控画布；拖拽期间只保留内部位置与
  // 测量值，避免异步 props 重置 handleBounds，令 EdgeWrapper 短暂失去端点。
  const initialEdges = useMemo(
    () => toXYEdges(propsRef.current, initialNodes, interactingRef),
    [props.graph, initialNodes],
  )
  const { fitView, getNodes: getStoreNodes } = useReactFlow()
  const flowStore = useStoreApi<CanvasNode, XYEdge<GraphEdgeData>>()
  useEffect(() => {
    const fresh = initialNodes
    // 拖拽进行中保留画布当前位置（异步 props 更新不得把卡片传回存储位置）；
    // 否则（如整理布局预览）直接采用新位置。
    const current = flowStore.getState().nodes
    const currentById = new Map(current.map((node) => [node.id, node]))
    const internals = flowStore.getState().nodeLookup
    const next = fresh.map((node) => {
      const currentNode = currentById.get(node.id)
      const currentPosition = currentNode?.position
      const measured = internals.get(node.id)?.measured
      const isGraphNode = node.type === 'graph'
      const pendingPos = isGraphNode ? pendingPositionsRef.current.get(node.id) : undefined
      const pendingSize = isGraphNode ? pendingSizesRef.current.get(node.id) : undefined
      // props 已追平的待定值清掉：此后位置/尺寸以图数据为准
      if (pendingPos !== undefined && node.position.x === pendingPos.x && node.position.y === pendingPos.y) pendingPositionsRef.current.delete(node.id)
      if (pendingSize !== undefined && node.width === pendingSize.width && node.height === pendingSize.height) pendingSizesRef.current.delete(node.id)
      return {
        ...node,
        ...(measured?.width !== undefined && measured.height !== undefined ? { measured } : {}),
        ...(interactingRef.current && isGraphNode && currentPosition !== undefined ? { position: currentPosition }
          : pendingPos !== undefined ? { position: { x: pendingPos.x, y: pendingPos.y } } : {}),
        ...(interactingRef.current && isGraphNode && currentNode?.width !== undefined && currentNode?.height !== undefined
          ? { width: currentNode.width, height: currentNode.height }
          : pendingSize !== undefined ? { width: pendingSize.width, height: pendingSize.height } : {}),
        ...(interactingRef.current && currentNode?.dragging === true ? { dragging: true } : {}),
      }
    })
    flowStore.getState().setNodes(next)
  }, [initialNodes, flowStore])
  useEffect(() => {
    flowStore.getState().setEdges(toXYEdges(propsRef.current, initialNodes, interactingRef))
  }, [props.graph, props.collapseSystem, initialNodes, flowStore])
  const [minimapOpen, setMinimapOpen] = useState(false)
  // 图例（Legend）：解释连线/节点含义的悬浮说明卡
  const [legendOpen, setLegendOpen] = useState(false)
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
    const changed = (draggedNodes ?? getStoreNodes() as unknown as CanvasNode[])
      .filter((node) => node.type === 'graph' && 'graphNode' in node.data)
      .map((node) => {
        const position = { id: (node.data as GraphNodeData).graphNode.id, x: Math.round(node.position.x), y: Math.round(node.position.y) }
        pendingPositionsRef.current.set(position.id, { x: position.x, y: position.y })
        return position
      })
    props.onNodePositionsChange(changed)
  }
  const narrowNodes = useMemo(
    () => props.graph.nodes.filter((node) => props.visibleIds.has(node.id) && collapsedGroupOf(props.graph, node) === undefined),
    [props.graph, props.visibleIds],
  )
  // 画布尺寸（ResizeObserver 跟随窗口/面板变化），用于推导内容感知的缩放范围。
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })
  // 缩略图随画布等比自适应：大窗口大图、移动端小图（夹在 [110, 280] 宽度内，约 3:2 比例）
  const minimapSize = useMemo(() => {
    const width = Math.round(Math.min(280, Math.max(110, canvasSize.w * 0.16)))
    return { width, height: Math.round(width * 0.68) }
  }, [canvasSize.w])
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
      // 箭头 marker 定义：fill 走 CSS 变量（明暗主题自动跟随），四种边类型各一枚
      jsx('svg', { className: 'evo-graph-arrow-defs', width: 0, height: 0, 'aria-hidden': true, focusable: false, style: { position: 'absolute' }, children: jsx('defs', { children: [
        arrowMarker('evo-arrow-read', 'var(--graph-reference)', 1),
        arrowMarker('evo-arrow-system', 'var(--graph-reference)', 0.45),
        arrowMarker('evo-arrow-write', 'var(--graph-write)', 1),
        arrowMarker('evo-arrow-fork', 'var(--graph-fork)', 1),
      ] }) }),
      jsx('div', { className: 'evo-graph-narrow-list', 'aria-label': t('graphNodeListAria'), children: narrowNodes.map((node) => jsx('button', {
      type: 'button',
        className: `evo-graph-narrow-item${node.id === props.focusedNodeId ? ' active' : ''}`,
        'aria-label': `${node.title}${t('graphAriaSep')}${displayKindLabel(node.displayKind, node.type)}${t('graphAriaSep')}${node.scope === 'global' ? t('graphGlobal') : t('graphProject')}`,
        onClick: () => props.onNarrowOpen(node),
        children: jsxs(Fragment, { children: [
          jsx('span', { className: 'evo-graph-narrow-kind', children: displayKindLabel(node.displayKind, node.type) }),
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
        // 普通模式即可拖线（强制需求）；高级端口开关只保留 socket 标签显示。
        nodesConnectable: true,
        elementsSelectable: true,
        // 滚轮缩放（用户要求恢复）：在画布上滚动 = 整体 zoom in/out，并阻止页面跟随滚动
        preventScrolling: true,
        zoomOnScroll: true,
        panOnDrag: canvasSize.w > 1024,
        // 官网 hero 明确关闭自动平移；否则拖到画布边缘时 viewport 在另一个
        // requestAnimationFrame 管线移动，视觉上会把边的跟随误认为延迟。
        autoPanOnNodeDrag: false,
        autoPanOnConnect: false,
        deleteKeyCode: null,
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
          jsx(Background, {}),
          jsx(Controls, { showInteractive: true, position: 'bottom-right' as const, 'aria-label': t('graphControlsAria') }),
          minimapOpen && jsx(MiniMap, { pannable: true, zoomable: true, position: 'bottom-left' as const, style: { width: minimapSize.width, height: minimapSize.height }, 'aria-label': t('graphMiniMap'), nodeColor: (node: CanvasNode) => node.type === 'graphGroup' ? 'var(--graph-minimap-group)' : (node.data as GraphNodeData).graphNode.type === 'chat' ? 'var(--graph-minimap-chat)' : 'var(--graph-minimap-resource)' }),
          // 缩略图开关：纯图标小按钮。收起时在画布左下角；展开时贴在缩略图右侧外、与底边对齐（随缩略图宽度自适应）。
          jsx('button', {
            type: 'button',
            className: 'evo-graph-minimap-toggle',
            'aria-pressed': minimapOpen,
            'aria-label': minimapOpen ? t('graphMinimapHide') : t('graphMinimapShow'),
            title: minimapOpen ? t('graphMinimapHide') : t('graphMinimapShow'),
            onClick: (event: MouseEvent) => { event.stopPropagation(); setMinimapOpen((value) => !value) },
            style: minimapOpen ? { left: minimapSize.width + 20, bottom: 12 } : { left: 12, bottom: 12 },
            children: jsx(MapIcon, {}),
          }),
          // 图例（Legend）：与缩略图开关同列纵排（左下角），随缩略图开合联动移动；
          // 展开面板锚在同一列上方，避开缩略图本体
          jsx('button', {
            type: 'button',
            className: 'evo-graph-legend-toggle',
            'aria-pressed': legendOpen,
            'aria-label': t('graphLegendToggle'),
            title: t('graphLegendToggle'),
            onClick: (event: MouseEvent) => { event.stopPropagation(); setLegendOpen((value) => !value) },
            style: minimapOpen ? { left: minimapSize.width + 20, bottom: 46 } : { left: 12, bottom: 46 },
            children: jsx(Info, {}),
          }),
          legendOpen && jsxs('div', { className: 'evo-graph-legend', role: 'dialog', 'aria-label': t('graphLegendToggle'), onClick: (event: MouseEvent) => event.stopPropagation(), style: minimapOpen ? { left: 12, bottom: minimapSize.height + 24 } : { left: 12, bottom: 80 }, children: [
            jsxs('div', { className: 'evo-graph-legend-head', children: [
              jsx('strong', { children: t('graphLegendToggle') }),
              jsx('button', {
                type: 'button',
                className: 'evo-graph-legend-close',
                'aria-label': t('graphLegendClose'),
                title: t('graphLegendClose'),
                onClick: () => setLegendOpen(false),
                children: '✕',
              }),
            ] }),
            jsx('div', { className: 'evo-graph-legend-note', children: t('graphLegendEdgesTitle') }),
            legendRow('sample-read', t('graphLegendRead')),
            legendRow('sample-system', t('graphLegendSystem')),
            legendRow('sample-hit', t('graphLegendHit')),
            legendRow('sample-write', t('graphLegendWrite')),
            legendRow('sample-fork', t('graphLegendFork')),
            jsx('div', { className: 'evo-graph-legend-note', children: t('graphLegendNodesTitle') }),
            legendChip('chip-chat', t('graphLegendNodeChat').slice(0, 2), t('graphLegendNodeChat')),
            legendChip('chip-memory', t('graphLegendNodeMemory').slice(0, 2), t('graphLegendNodeMemory')),
            legendChip('chip-empty', t('graphEmptyBadge'), t('graphLegendEmpty')),
            jsx('div', { className: 'evo-graph-legend-tips', children: t('graphLegendTips') }),
          ] }),
        ],
      }),
      props.menuElement,
    ],
  })
}
