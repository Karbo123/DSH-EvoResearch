/**
 * Chat Graph layout worker.
 *
 * ELK owns the expensive graph calculation.  The small amount of routing
 * post-processing in this file is deliberately deterministic and has no DOM
 * dependency, so it is also used by the regression/performance tests.
 */
import ELK from 'elkjs/lib/elk.bundled.js'

export interface LayoutNodeInput {
  id: string
  x: number
  y: number
  width: number
  height: number
  createdAt?: number
  pinned?: boolean
  selected?: boolean
  groupId?: string
}

export interface LayoutGroupInput {
  id: string
  title?: string
  x?: number
  y?: number
  width?: number
  height?: number
  collapsed?: boolean
  parentId?: string
  pinned?: boolean
  selected?: boolean
  createdAt?: number
}

export interface LayoutEdgeInput {
  id: string
  from: string
  to: string
  toPort: 'context' | 'memory'
  behavior?: 'fork' | 'reference' | 'relation'
  label?: string
}

export interface ChatGraphLayoutRequest {
  nodes: LayoutNodeInput[]
  edges: LayoutEdgeInput[]
  groups?: LayoutGroupInput[]
  /** Nodes with selected=false or pinned=true are anchors and must not move. */
  direction?: 'RIGHT' | 'DOWN'
}

export interface LayoutPosition {
  id: string
  x: number
  y: number
  width?: number
  height?: number
}

export interface LayoutRoutePoint { x: number; y: number }

export interface LayoutEdgeRoute {
  id: string
  points: LayoutRoutePoint[]
  labelPosition?: LayoutRoutePoint
  labelWidth?: number
  labelHeight?: number
  /** True when there was no collision-free label slot; the UI may reveal it on focus. */
  labelHidden?: boolean
}

export interface ChatGraphLayoutResponse {
  positions: LayoutPosition[]
  groupPositions?: LayoutPosition[]
  routes?: LayoutEdgeRoute[]
  engine: 'elk' | 'fallback'
  durationMs: number
  warning?: string
}

interface ElkNode {
  id: string
  x?: number
  y?: number
  width: number
  height: number
  children?: ElkNode[]
  edges?: ElkEdge[]
}

interface ElkSection {
  startPoint?: LayoutRoutePoint
  endPoint?: LayoutRoutePoint
  bendPoints?: LayoutRoutePoint[]
}

interface ElkEdge {
  id: string
  sources: string[]
  targets: string[]
  sections?: ElkSection[]
  layoutOptions?: Record<string, string>
}

interface ElkGraph {
  id: string
  layoutOptions: Record<string, string>
  children: ElkNode[]
  edges: ElkEdge[]
}

const PAD_X = 48
const PAD_Y = 48
const GAP_X = 72
const GAP_Y = 36
const GROUP_PAD_X = 24
const GROUP_PAD_TOP = 36
const LABEL_MIN_W = 52
const LABEL_MAX_W = 280
const LABEL_LINE_H = 18

export interface LabelBox { width: number; height: number; lines: number }

/** Estimate a rendered edge-label box without depending on a browser font. */
export function estimateLabelBox(text: string): LabelBox {
  const value = String(text ?? '').trim()
  if (value === '') return { width: 0, height: 0, lines: 0 }
  const units = [...value].reduce((sum, char) => sum + (/[^\u0000-\u00ff]/.test(char) ? 2 : 1), 0)
  const width = Math.min(LABEL_MAX_W, Math.max(LABEL_MIN_W, Math.ceil(units * 7.1 + 18)))
  const charsPerLine = Math.max(8, Math.floor((width - 18) / 7.1))
  const lines = Math.max(1, Math.ceil(units / charsPerLine))
  return { width, height: Math.min(72, lines * LABEL_LINE_H + 6), lines }
}

function stableNodes(nodes: readonly LayoutNodeInput[]): LayoutNodeInput[] {
  return [...nodes].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id))
}

function stableGroups(groups: readonly LayoutGroupInput[] | undefined): LayoutGroupInput[] {
  return [...(groups ?? [])].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id))
}

function intersects(a: LayoutNodeInput | (LayoutPosition & { width?: number; height?: number }), b: LayoutNodeInput, x: number, y: number): boolean {
  const aw = 'width' in a && typeof a.width === 'number' ? a.width : 176
  const ah = 'height' in a && typeof a.height === 'number' ? a.height : 76
  return x < a.x + aw + GAP_X / 2 && x + b.width + GAP_X / 2 > a.x
    && y < a.y + ah + GAP_Y / 2 && y + b.height + GAP_Y / 2 > a.y
}

function rectOf(position: LayoutPosition, node: LayoutNodeInput): { x: number; y: number; width: number; height: number } {
  return { x: position.x, y: position.y, width: node.width, height: node.height }
}

function rectIntersects(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function segmentHitsRect(a: LayoutRoutePoint, b: LayoutRoutePoint, rect: { x: number; y: number; width: number; height: number }): boolean {
  const inset = 2
  const left = rect.x + inset
  const right = rect.x + rect.width - inset
  const top = rect.y + inset
  const bottom = rect.y + rect.height - inset
  if (Math.abs(a.y - b.y) < 0.5) {
    const y = a.y
    return y > top && y < bottom && Math.max(Math.min(a.x, b.x), left) < Math.min(Math.max(a.x, b.x), right)
  }
  if (Math.abs(a.x - b.x) < 0.5) {
    const x = a.x
    return x > left && x < right && Math.max(Math.min(a.y, b.y), top) < Math.min(Math.max(a.y, b.y), bottom)
  }
  // ELK is configured for orthogonal routing. Treat an unexpected diagonal
  // section conservatively by checking its bounding box.
  return rectIntersects({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }, rect)
}

function routeHitsNodes(points: readonly LayoutRoutePoint[], rects: readonly { x: number; y: number; width: number; height: number }[]): boolean {
  for (let i = 1; i < points.length; i += 1) {
    if (rects.some((rect) => segmentHitsRect(points[i - 1]!, points[i]!, rect))) return true
  }
  return false
}

function nodeDepths(nodes: readonly LayoutNodeInput[], edges: readonly LayoutEdgeInput[]): Map<string, number> {
  const parents = new Map<string, string[]>()
  for (const edge of [...edges].sort((a, b) => a.id.localeCompare(b.id))) {
    if (edge.behavior !== 'relation' && edge.toPort === 'context') {
      const list = parents.get(edge.to) ?? []
      list.push(edge.from)
      parents.set(edge.to, list)
    }
  }
  const memo = new Map<string, number>()
  const depthOf = (id: string, visiting = new Set<string>()): number => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0
    visiting.add(id)
    const depth = Math.min(24, Math.max(0, ...(parents.get(id) ?? []).map((parent) => depthOf(parent, visiting) + 1)))
    visiting.delete(id)
    memo.set(id, depth)
    return depth
  }
  for (const node of nodes) depthOf(node.id)
  return memo
}

function collapsedMap(groups: readonly LayoutGroupInput[] | undefined): Map<string, string> {
  const map = new Map<string, string>()
  const byId = new Map((groups ?? []).map((group) => [group.id, group]))
  for (const group of groups ?? []) {
    let current: LayoutGroupInput | undefined = group
    const seen = new Set<string>()
    while (current !== undefined && !seen.has(current.id)) {
      seen.add(current.id)
      if (current.collapsed === true) {
        map.set(group.id, `group:${current.id}`)
        break
      }
      current = current.parentId === undefined ? undefined : byId.get(current.parentId)
    }
  }
  return map
}

function endpointId(id: string, nodeById: Map<string, LayoutNodeInput>, collapsed: Map<string, string>): string {
  return collapsed.get(nodeById.get(id)?.groupId ?? '') ?? id
}

function routeFor(
  edge: LayoutEdgeInput,
  positions: Map<string, LayoutPosition>,
  nodes: Map<string, LayoutNodeInput>,
  collapsed: Map<string, string>,
): LayoutRoutePoint[] {
  const sourceId = endpointId(edge.from, nodes, collapsed)
  const targetId = endpointId(edge.to, nodes, collapsed)
  const source = positions.get(sourceId) ?? positions.get(edge.from)
  const target = positions.get(targetId) ?? positions.get(edge.to)
  const sourceNode = nodes.get(edge.from)
  const targetNode = nodes.get(edge.to)
  if (source === undefined || target === undefined || sourceNode === undefined || targetNode === undefined) return []
  const sourceWidth = sourceId === edge.from ? sourceNode.width : 176
  const sourceHeight = sourceId === edge.from ? sourceNode.height : 58
  const targetHeight = targetId === edge.to ? targetNode.height : 58
  const start = { x: source.x + sourceWidth, y: source.y + sourceHeight / 2 }
  const end = { x: target.x, y: target.y + targetHeight / 2 }
  if (sourceId === targetId) {
    const detourY = Math.max(24, source.y - 42)
    return [start, { x: start.x + 24, y: detourY }, { x: target.x - 24, y: detourY }, end]
  }
  if (start.x + 8 <= end.x) {
    const middleX = Math.round((start.x + end.x) / 2)
    return [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end]
  }
  // Backward/reference edges get a top detour instead of crossing the card.
  const detourY = Math.max(18, Math.min(source.y, target.y) - 48)
  return [start, { x: start.x + 24, y: start.y }, { x: start.x + 24, y: detourY }, { x: end.x - 24, y: detourY }, { x: end.x - 24, y: end.y }, end]
}

function collisionFreeRoute(
  edge: LayoutEdgeInput,
  positions: Map<string, LayoutPosition>,
  nodes: Map<string, LayoutNodeInput>,
  collapsed: Map<string, string>,
  rects: readonly { x: number; y: number; width: number; height: number }[],
): LayoutRoutePoint[] {
  const sourceId = endpointId(edge.from, nodes, collapsed)
  const targetId = endpointId(edge.to, nodes, collapsed)
  const source = positions.get(sourceId) ?? positions.get(edge.from)
  const target = positions.get(targetId) ?? positions.get(edge.to)
  const sourceNode = nodes.get(edge.from)
  const targetNode = nodes.get(edge.to)
  if (source === undefined || target === undefined || sourceNode === undefined || targetNode === undefined) return []
  const sourceWidth = sourceId === edge.from ? sourceNode.width : 176
  const sourceHeight = sourceId === edge.from ? sourceNode.height : 58
  const targetHeight = targetId === edge.to ? targetNode.height : 58
  const start = { x: source.x + sourceWidth, y: source.y + sourceHeight / 2 }
  const end = { x: target.x, y: target.y + targetHeight / 2 }
  const minY = Math.min(source.y, target.y)
  const maxY = Math.max(source.y + sourceHeight, target.y + targetHeight)
  const middleX = Math.round((start.x + end.x) / 2)
  const levels = [
    start.y,
    end.y,
    minY - 48,
    minY - 84,
    maxY + 48,
    maxY + 84,
  ]
  const candidates: LayoutRoutePoint[][] = []
  for (const level of levels) {
    candidates.push([start, { x: middleX, y: start.y }, { x: middleX, y: level }, { x: middleX, y: end.y }, end])
    candidates.push([start, { x: start.x + 28, y: start.y }, { x: start.x + 28, y: level }, { x: end.x - 28, y: level }, { x: end.x - 28, y: end.y }, end])
  }
  // Prefer the shortest valid candidate while keeping stable tie order.
  let best: LayoutRoutePoint[] | undefined
  let bestLength = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    if (routeHitsNodes(candidate, rects)) continue
    let length = 0
    for (let i = 1; i < candidate.length; i += 1) length += Math.abs(candidate[i]!.x - candidate[i - 1]!.x) + Math.abs(candidate[i]!.y - candidate[i - 1]!.y)
    if (length < bestLength) { best = candidate; bestLength = length }
  }
  return best ?? routeFor(edge, positions, nodes, collapsed)
}

function polylineMidpoint(points: readonly LayoutRoutePoint[]): LayoutRoutePoint | undefined {
  if (points.length === 0) return undefined
  if (points.length === 1) return points[0]
  let length = 0
  for (let i = 1; i < points.length; i += 1) length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
  if (length === 0) return points[0]
  let walked = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!
    const b = points[i]!
    const segment = Math.hypot(b.x - a.x, b.y - a.y)
    if (walked + segment >= length / 2) {
      const ratio = (length / 2 - walked) / Math.max(segment, 1)
      return { x: Math.round(a.x + (b.x - a.x) * ratio), y: Math.round(a.y + (b.y - a.y) * ratio) }
    }
    walked += segment
  }
  return points[points.length - 1]
}

function offsetRoute(points: readonly LayoutRoutePoint[], offset: number): LayoutRoutePoint[] {
  if (offset === 0 || points.length < 2) return [...points]
  const horizontal = Math.abs(points[points.length - 1]!.x - points[0]!.x) >= Math.abs(points[points.length - 1]!.y - points[0]!.y)
  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return point
    return horizontal ? { x: point.x, y: point.y + offset } : { x: point.x + offset, y: point.y }
  })
}

function labelSlot(
  point: LayoutRoutePoint | undefined,
  box: LabelBox,
  nodeRects: readonly { x: number; y: number; width: number; height: number }[],
  previous: readonly { x: number; y: number; width: number; height: number }[],
): { position?: LayoutRoutePoint; hidden: boolean } {
  if (point === undefined || box.width === 0) return { hidden: box.width > 0 }
  const candidates = [
    point,
    { x: point.x, y: point.y - box.height - 8 },
    { x: point.x, y: point.y + box.height + 8 },
    { x: point.x - box.width / 2 - 12, y: point.y - box.height - 8 },
    { x: point.x + box.width / 2 + 12, y: point.y + box.height + 8 },
  ]
  for (const candidate of candidates) {
    const label = { x: candidate.x - box.width / 2, y: candidate.y - box.height / 2, width: box.width, height: box.height }
    if (!nodeRects.some((rect) => rectIntersects(label, rect)) && !previous.some((rect) => rectIntersects(label, rect))) {
      return { position: candidate, hidden: false }
    }
  }
  return { position: point, hidden: true }
}

function routesFor(
  input: ChatGraphLayoutRequest,
  positions: readonly LayoutPosition[],
  groupPositions: readonly LayoutPosition[] = [],
  elkRoutes?: Map<string, LayoutRoutePoint[]>,
): LayoutEdgeRoute[] {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]))
  const allPositions = new Map([...positions, ...groupPositions].map((position) => [position.id, position]))
  const collapsed = collapsedMap(input.groups)
  const rects = input.nodes
    .filter((node) => !collapsed.has(node.groupId ?? ''))
    .map((node) => {
      const pos = allPositions.get(node.id)
      return pos === undefined ? undefined : rectOf(pos, node)
    })
    .filter((rect): rect is { x: number; y: number; width: number; height: number } => rect !== undefined)
  const pairs = new Map<string, LayoutEdgeInput[]>()
  for (const edge of [...input.edges].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = `${endpointId(edge.from, nodeById, collapsed)}→${endpointId(edge.to, nodeById, collapsed)}`
    const list = pairs.get(key) ?? []
    list.push(edge)
    pairs.set(key, list)
  }
  const labelRects: Array<{ x: number; y: number; width: number; height: number }> = []
  const routes: LayoutEdgeRoute[] = []
  for (const edge of [...input.edges].sort((a, b) => a.id.localeCompare(b.id))) {
    const pair = pairs.get(`${endpointId(edge.from, nodeById, collapsed)}→${endpointId(edge.to, nodeById, collapsed)}`) ?? [edge]
    const index = pair.findIndex((item) => item.id === edge.id)
    const center = (index - (pair.length - 1) / 2) * 16
    const base = elkRoutes?.get(edge.id) ?? routeFor(edge, allPositions, nodeById, collapsed)
    let points = offsetRoute(base, center)
    if (routeHitsNodes(points, rects)) {
      points = offsetRoute(collisionFreeRoute(edge, allPositions, nodeById, collapsed, rects), center)
    }
    const box = estimateLabelBox(edge.label ?? '')
    const slot = labelSlot(polylineMidpoint(points), box, rects, labelRects)
    if (slot.position !== undefined && !slot.hidden) labelRects.push({ x: slot.position.x - box.width / 2, y: slot.position.y - box.height / 2, width: box.width, height: box.height })
    routes.push({ id: edge.id, points, ...(slot.position === undefined ? {} : { labelPosition: slot.position }), ...(box.width === 0 ? {} : { labelWidth: box.width, labelHeight: box.height }), labelHidden: box.width > 0 ? slot.hidden : false })
  }
  return routes
}

export interface LayoutQualityReport {
  nodeOverlaps: Array<[string, string]>
  routeNodeHits: string[]
  labelCollisions: string[]
  parallelEdgeOffsets: Array<{ edgeIds: string[]; distinct: boolean }>
  hiddenLabels: Array<{ edgeId: string; reason: string }>
}

/** Deterministic post-layout audit used by tests and the acceptance report. */
export function inspectLayout(input: ChatGraphLayoutRequest, response: ChatGraphLayoutResponse): LayoutQualityReport {
  const nodeMap = new Map(input.nodes.map((node) => [node.id, node]))
  const positions = new Map(response.positions.map((position) => [position.id, position]))
  const collapsed = collapsedMap(input.groups)
  const rects = input.nodes
    .filter((node) => !collapsed.has(node.groupId ?? ''))
    .map((node) => ({ node, position: positions.get(node.id) }))
    .filter((item): item is { node: LayoutNodeInput; position: LayoutPosition } => item.position !== undefined)
  const nodeOverlaps: Array<[string, string]> = []
  for (let i = 0; i < rects.length; i += 1) for (let j = i + 1; j < rects.length; j += 1) {
    const left = rects[i]!, right = rects[j]!
    if (rectIntersects({ x: left.position.x, y: left.position.y, width: left.node.width, height: left.node.height }, { x: right.position.x, y: right.position.y, width: right.node.width, height: right.node.height })) nodeOverlaps.push([left.node.id, right.node.id])
  }
  const nodeRects = rects.map(({ node, position }) => ({ x: position.x, y: position.y, width: node.width, height: node.height }))
  const routeNodeHits = (response.routes ?? []).filter((route) => routeHitsNodes(route.points, nodeRects)).map((route) => route.id)
  const labelBoxes = (response.routes ?? []).filter((route) => route.labelWidth !== undefined && route.labelHeight !== undefined && route.labelPosition !== undefined).map((route) => ({ route, rect: { x: route.labelPosition!.x - route.labelWidth! / 2, y: route.labelPosition!.y - route.labelHeight! / 2, width: route.labelWidth!, height: route.labelHeight! } }))
  const labelCollisions: string[] = []
  for (let i = 0; i < labelBoxes.length; i += 1) for (let j = i + 1; j < labelBoxes.length; j += 1) {
    if (rectIntersects(labelBoxes[i]!.rect, labelBoxes[j]!.rect)) labelCollisions.push(`${labelBoxes[i]!.route.id}:${labelBoxes[j]!.route.id}`)
  }
  const pairs = new Map<string, string[]>()
  for (const edge of input.edges) {
    const key = `${endpointId(edge.from, nodeMap, collapsed)}→${endpointId(edge.to, nodeMap, collapsed)}`
    const list = pairs.get(key) ?? []
    list.push(edge.id)
    pairs.set(key, list)
  }
  const parallelEdgeOffsets = [...pairs.values()].filter((ids) => ids.length > 1).map((edgeIds) => {
    const points = edgeIds.map((id) => response.routes?.find((route) => route.id === id)?.labelPosition).filter((point): point is LayoutRoutePoint => point !== undefined)
    return { edgeIds, distinct: new Set(points.map((point) => `${Math.round(point.x)}:${Math.round(point.y)}`)).size === points.length }
  })
  const hiddenLabels = (response.routes ?? []).filter((route) => route.labelHidden === true).map((route) => ({ edgeId: route.id, reason: 'hiddenLabelReason' }))
  return { nodeOverlaps, routeNodeHits, labelCollisions, parallelEdgeOffsets, hiddenLabels }
}

function placeReferenceNodes(
  input: ChatGraphLayoutRequest,
  positions: LayoutPosition[],
  groupPositions: readonly LayoutPosition[],
): void {
  const nodeMap = new Map(input.nodes.map((node) => [node.id, node]))
  const positionMap = new Map(positions.map((position) => [position.id, position]))
  const groupMap = new Map(groupPositions.map((position) => [position.id, position]))
  const occupied = () => input.nodes
    .filter((node) => node.groupId === undefined || !input.groups?.some((group) => group.id === node.groupId && group.collapsed === true))
    .map((node) => {
      const p = positionMap.get(node.id) ?? (node.groupId === undefined ? undefined : groupMap.get(`group:${node.groupId}`))
      return p === undefined ? undefined : { x: p.x, y: p.y, width: node.width, height: node.height }
    })
    .filter((rect): rect is { x: number; y: number; width: number; height: number } => rect !== undefined)
  const edges = input.edges.filter((edge) => edge.behavior === 'reference' || (edge.toPort === 'memory' && edge.behavior === undefined))
  for (const edge of edges) {
    const source = nodeMap.get(edge.from)
    const target = nodeMap.get(edge.to)
    if (source === undefined || target === undefined) continue
    if (source.pinned === true || source.selected === false || source.groupId !== undefined) continue
    const targetPosition = positionMap.get(target.id)
    if (targetPosition === undefined) continue
    const candidates = [
      { x: Math.round(targetPosition.x + (target.width - source.width) / 2), y: Math.max(PAD_Y, targetPosition.y - source.height - 48) },
      { x: Math.round(targetPosition.x + (target.width - source.width) / 2), y: targetPosition.y + target.height + 48 },
      { x: Math.round(targetPosition.x - source.width - 48), y: targetPosition.y },
      { x: targetPosition.x + target.width + 48, y: targetPosition.y },
    ]
    const current = positionMap.get(source.id)
    for (const candidate of candidates) {
      const rect = { ...candidate, width: source.width, height: source.height }
      if (!occupied().some((other) => other.x === current?.x && other.y === current?.y ? false : rectIntersects(rect, other))) {
        const next = { id: source.id, x: candidate.x, y: candidate.y }
        positionMap.set(source.id, next)
        const at = positions.findIndex((position) => position.id === source.id)
        if (at >= 0) positions[at] = next
        break
      }
    }
  }
}

/** Deterministic no-overlap fallback used when ELK cannot be constructed. */
export function fallbackLayout(input: ChatGraphLayoutRequest): LayoutPosition[] {
  const ordered = stableNodes(input.nodes)
  const depths = nodeDepths(ordered, input.edges)
  const collapsed = collapsedMap(input.groups)
  const result = new Map<string, LayoutPosition>()
  for (const node of ordered) {
    if (node.pinned === true || node.selected === false || collapsed.has(node.groupId ?? '')) {
      result.set(node.id, { id: node.id, x: Math.max(0, node.x), y: Math.max(0, node.y) })
    }
  }
  const rowByDepth = new Map<number, number>()
  for (const node of ordered) {
    if (result.has(node.id)) continue
    const depth = depths.get(node.id) ?? 0
    let row = rowByDepth.get(depth) ?? 0
    const x = PAD_X + depth * (176 + GAP_X)
    let y = PAD_Y + row * (76 + GAP_Y)
    while ([...result.values()].some((placed) => intersects(placed, node, x, y))) {
      row += 1
      y = PAD_Y + row * (76 + GAP_Y)
    }
    rowByDepth.set(depth, row + 1)
    result.set(node.id, { id: node.id, x, y })
  }
  const positions = ordered.map((node) => result.get(node.id) ?? { id: node.id, x: node.x, y: node.y })
  return positions
}

/** Compute compound group bounds for the deterministic fallback as well as ELK. */
function fallbackGroupPositions(input: ChatGraphLayoutRequest, positions: readonly LayoutPosition[]): LayoutPosition[] {
  const groups = stableGroups(input.groups)
  const byId = new Map(groups.map((group) => [group.id, group]))
  const positionById = new Map(positions.map((position) => [position.id, position]))
  const visiting = new Set<string>()
  const boundsOf = (group: LayoutGroupInput): LayoutPosition | undefined => {
    if (visiting.has(group.id)) return undefined
    visiting.add(group.id)
    const rects: Array<{ x: number; y: number; width: number; height: number }> = []
    for (const node of input.nodes) {
      if (node.groupId !== group.id) continue
      const position = positionById.get(node.id)
      if (position !== undefined) rects.push({ x: position.x, y: position.y, width: node.width, height: node.height })
    }
    for (const child of groups.filter((candidate) => candidate.parentId === group.id)) {
      const position = boundsOf(child)
      if (position !== undefined) rects.push({ x: position.x, y: position.y, width: position.width ?? 220, height: position.height ?? 120 })
    }
    visiting.delete(group.id)
    if (rects.length === 0 && group.collapsed !== true) return undefined
    const minX = rects.length === 0 ? group.x ?? PAD_X : Math.min(...rects.map((rect) => rect.x))
    const minY = rects.length === 0 ? group.y ?? PAD_Y : Math.min(...rects.map((rect) => rect.y))
    const maxX = rects.length === 0 ? minX + 176 : Math.max(...rects.map((rect) => rect.x + rect.width))
    const maxY = rects.length === 0 ? minY + 76 : Math.max(...rects.map((rect) => rect.y + rect.height))
    return {
      id: `group:${group.id}`,
      x: Math.max(0, group.x ?? minX - GROUP_PAD_X),
      y: Math.max(0, group.y ?? minY - GROUP_PAD_TOP),
      width: group.collapsed === true ? Math.max(group.width ?? 0, 208) : Math.max(group.width ?? 0, 220, maxX - minX + GROUP_PAD_X * 2),
      height: group.collapsed === true ? Math.max(group.height ?? 0, 86) : Math.max(group.height ?? 0, 120, maxY - minY + GROUP_PAD_TOP + GROUP_PAD_X),
    }
  }
  return groups
    .filter((group) => group.parentId === undefined || !byId.has(group.parentId))
    .map((group) => boundsOf(group))
    .filter((position): position is LayoutPosition => position !== undefined)
}

function graphForElk(input: ChatGraphLayoutRequest): { graph: ElkGraph; collapsed: Map<string, string> } {
  const nodes = stableNodes(input.nodes)
  const groups = stableGroups(input.groups)
  const collapsed = collapsedMap(groups)
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const ids = new Set<string>(nodes.map((node) => node.id))
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const directNodes = new Map<string, LayoutNodeInput[]>()
  for (const node of nodes) {
    if (node.groupId === undefined || !groupById.has(node.groupId)) continue
    const list = directNodes.get(node.groupId) ?? []
    list.push(node)
    directNodes.set(node.groupId, list)
  }
  const directGroups = new Map<string | undefined, LayoutGroupInput[]>()
  for (const group of groups) {
    const parent = group.parentId !== undefined && groupById.has(group.parentId) ? group.parentId : undefined
    const list = directGroups.get(parent) ?? []
    list.push(group)
    directGroups.set(parent, list)
  }
  const groupedIds = new Set<string>()
  const building = new Set<string>()
  const buildGroup = (group: LayoutGroupInput, parentX = 0, parentY = 0): ElkNode | undefined => {
    if (building.has(group.id)) return undefined
    building.add(group.id)
    const originX = group.x ?? 0
    const originY = group.y ?? 0
    const childNodes = stableNodes(directNodes.get(group.id) ?? [])
    for (const child of childNodes) groupedIds.add(child.id)
    const nested = stableGroups(directGroups.get(group.id) ?? [])
    const childGroups = nested.map((child) => buildGroup(child, originX, originY)).filter((child): child is ElkNode => child !== undefined)
    const children: ElkNode[] = [
      ...childNodes.map((node) => ({ id: node.id, x: Math.max(0, node.x - originX), y: Math.max(0, node.y - originY), width: node.width, height: node.height })),
      ...childGroups,
    ].sort((a, b) => a.id.localeCompare(b.id))
    building.delete(group.id)
    if (children.length === 0 && group.collapsed !== true) return undefined
    return {
      id: `group:${group.id}`,
      x: group.x === undefined ? undefined : Math.max(0, group.x - parentX),
      y: group.y === undefined ? undefined : Math.max(0, group.y - parentY),
      width: group.collapsed === true ? Math.max(group.width ?? 0, 208) : Math.max(group.width ?? 0, 220),
      height: group.collapsed === true ? Math.max(group.height ?? 0, 86) : Math.max(group.height ?? 0, 120),
      children: group.collapsed === true ? undefined : children,
    }
  }
  const rootGroups = stableGroups(directGroups.get(undefined) ?? [])
    .map((group) => buildGroup(group))
    .filter((group): group is ElkNode => group !== undefined)
  const topLevel = nodes
    .filter((node) => !groupedIds.has(node.id) && node.groupId === undefined)
    .map((node) => ({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height }))
  const children = [...topLevel, ...rootGroups].sort((a, b) => a.id.localeCompare(b.id))
  const edges = input.edges
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((edge) => {
      const source = endpointId(edge.from, nodeById, collapsed)
      const target = endpointId(edge.to, nodeById, collapsed)
      const weight = edge.behavior === 'fork' || edge.toPort === 'context' ? '100' : edge.behavior === 'relation' ? '1' : '15'
      return {
        id: edge.id,
        sources: [source],
        targets: [target],
        layoutOptions: { 'org.eclipse.elk.layered.priority': weight },
      }
    })
  // Disconnected nodes are laid out by ELK as independent components packed into a
  // tight grid (20px default gap), which both looks scattered and trips the overlap
  // guard into the single-column fallback. A zero-priority virtual backbone keeps the
  // whole graph connected so layered produces one coherent multi-column flow.
  const connected = new Set<string>()
  for (const edge of edges) { connected.add(edge.sources[0]!); connected.add(edge.targets[0]!) }
  const orphans = children.filter((node) => !connected.has(node.id))
  const CHUNK = 4
  for (let index = 0; index < orphans.length; index += CHUNK) {
    const head = orphans[index]!
    if (index > 0) {
      edges.push({ id: `virtual:chain:${head.id}`, sources: [orphans[index - CHUNK]!.id], targets: [head.id], layoutOptions: { 'org.eclipse.elk.layered.priority': '0' } })
    }
    for (let member = index + 1; member < Math.min(index + CHUNK, orphans.length); member += 1) {
      edges.push({ id: `virtual:member:${orphans[member]!.id}`, sources: [head.id], targets: [orphans[member]!.id], layoutOptions: { 'org.eclipse.elk.layered.priority': '0' } })
    }
  }
  return {
    graph: {
      id: 'chat-graph',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': input.direction ?? 'RIGHT',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': '36',
        'elk.layered.spacing.nodeNodeBetweenLayers': '72',
        'elk.spacing.edgeNode': '28',
        'elk.layered.spacing.edgeNodeBetweenLayers': '32',
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      },
      children,
      edges,
    },
    collapsed,
  }
}

function flattenChildren(children: readonly ElkNode[], offsetX = 0, offsetY = 0): Map<string, LayoutPosition> {
  const result = new Map<string, LayoutPosition>()
  for (const child of children) {
    const x = offsetX + (child.x ?? 0)
    const y = offsetY + (child.y ?? 0)
    result.set(child.id, { id: child.id, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), width: child.width, height: child.height })
    if (child.children !== undefined) for (const [id, position] of flattenChildren(child.children, x, y)) result.set(id, position)
  }
  return result
}

function flattenEdgeSections(edges: readonly ElkEdge[], children: readonly ElkNode[] = [], offsetX = 0, offsetY = 0): Map<string, LayoutRoutePoint[]> {
  const result = new Map<string, LayoutRoutePoint[]>()
  for (const edge of edges) {
    const section = edge.sections?.[0]
    if (section?.startPoint === undefined || section.endPoint === undefined) continue
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
      .map((point) => ({ x: Math.round(point.x + offsetX), y: Math.round(point.y + offsetY) }))
    result.set(edge.id, points)
  }
  for (const child of children) {
    const childX = offsetX + (child.x ?? 0)
    const childY = offsetY + (child.y ?? 0)
    for (const [id, points] of flattenEdgeSections(child.edges ?? [], child.children ?? [], childX, childY)) result.set(id, points)
  }
  return result
}

/** Run ELK, then generate stable route points and collision-aware label slots. */
export async function layoutGraph(input: ChatGraphLayoutRequest): Promise<ChatGraphLayoutResponse> {
  const started = Date.now()
  if (input.nodes.length === 0) return { positions: [], groupPositions: [], routes: [], engine: 'fallback', durationMs: 0 }
  try {
    const { graph, collapsed } = graphForElk(input)
    const elk = new ELK()
    const output = await elk.layout(graph as any) as ElkGraph
    const flattened = flattenChildren(output.children ?? [])
    const original = new Map(input.nodes.map((node) => [node.id, node]))
    const groupInputs = stableGroups(input.groups)
    const groupPositions = groupInputs
      .filter((group) => flattened.has(`group:${group.id}`))
      .map((group) => flattened.get(`group:${group.id}`)!)
    const positions = stableNodes(input.nodes).map((node) => {
      const placed = flattened.get(node.id)
      if (node.pinned === true || node.selected === false || collapsed.has(node.groupId ?? '')) return { id: node.id, x: Math.max(0, node.x), y: Math.max(0, node.y) }
      return { id: node.id, x: Math.max(0, placed?.x ?? node.x), y: Math.max(0, placed?.y ?? node.y) }
    })
    // Reference materials are deliberately kept near their target instead of
    // being allowed to stretch the left-to-right fork reading order.
    placeReferenceNodes(input, positions, groupPositions)
    const visibleForOverlap = positions.filter((position) => !collapsed.has(original.get(position.id)?.groupId ?? ''))
    const overlap = visibleForOverlap.some((position, index) => visibleForOverlap.slice(index + 1).some((other) => {
      const left = original.get(position.id)
      const right = original.get(other.id)
      return left !== undefined && right !== undefined && intersects({ ...position, width: left.width, height: left.height }, right, other.x, other.y)
    }))
    if (overlap) throw new Error('ELK returned overlapping nodes')
    const elkRoutes = flattenEdgeSections(output.edges ?? [])
    return {
      positions,
      groupPositions,
      routes: routesFor(input, positions, groupPositions, elkRoutes),
      engine: 'elk',
      durationMs: Date.now() - started,
    }
  } catch (error) {
    const positions = fallbackLayout(input)
    const groupPositions = fallbackGroupPositions(input, positions)
    return {
      positions,
      groupPositions,
      routes: routesFor(input, positions, groupPositions),
      engine: 'fallback',
      durationMs: Date.now() - started,
      warning: error instanceof Error ? error.message : String(error),
    }
  }
}

declare const self: { onmessage?: (event: MessageEvent<ChatGraphLayoutRequest>) => void; postMessage: (value: ChatGraphLayoutResponse) => void } | undefined
if (typeof self !== 'undefined' && self !== undefined) {
  self.onmessage = (event) => { void layoutGraph(event.data).then((response) => self.postMessage(response)) }
}
