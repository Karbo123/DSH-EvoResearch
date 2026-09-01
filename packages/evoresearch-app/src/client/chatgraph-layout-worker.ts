/**
 * Chat Graph layout worker — 三算法合并引擎（按 request.algorithm 分发，缺省 'tree'）。
 *
 * 三个已验证布局算法各为一个引擎函数，共享同一套契约类型、几何（edgeCurve / cubic*）、
 * 端口（PORT_OFFSETS / portPoint）、flowDepth（Tarjan SCC 缩点）与测量器（evaluateLayout）：
 *
 * - 'tree'（默认）compact-tree：ELK mrtree 紧凑树（原样移植 idootop/reactflow-auto-layout）
 *   + A* 网格路由辅助 + 列约束后处理（applyColumnConstraints）。每节点建 ports
 *   （源端口 EAST / 目标端口 WEST，portConstraints=FIXED_ORDER）、无入边节点挂合成根 #root、
 *   方向 RIGHT、间距 120/120；ELK 输出后做两条用户约束的几何后处理（只改几何、不改
 *   mrtree 的排序决策）：① 拓扑流向 flowDepth 定列序；② 同类型同列（列键 `${kind}@${flowDepth}`）。
 * - 'dagre' dagre-layered：@dagrejs/dagre 的 Sugiyama 分层（忠实移植
 *   Jalez/react-flow-automated-layout 的 Dagre.ts：rankdir=LR + ranker='tight-tree'，
 *   margin 0 / nodesep 50 / ranksep 50 / edgesep = max(20, 50/4)，边一律 default 分支
 *   { constraint: true, minlen: 2 }）+ B 的列后处理（applyFlowColumns：flowDepth 覆盖
 *   列归属、同键 x 全等、列内按 dagre y 序堆叠）。
 * - 'relax' flow-relax：yuki-koyama/nodelayout（Blender 插件 arrange_nodes.py）的
 *   Gauss-Seidel 约束投影迭代（两轮：first pass target_space×2、k_v=0.5；second pass
 *   target_space、k_v=0.05、k_overlap=0.9；每轮最多 500 次迭代）。迭代前把非锚点节点
 *   x 硬钉到列 x，迭代中跳过水平距离约束族、防重叠只沿 y 推开；收敛后最终 snap：
 *   x 精确等于列 x，同列按迭代 y 序以 48px 行距重堆叠。
 *
 * 共享段去重：flowDepth（computeFlowDepths/flowDepths 三分支实现完全相同）合并为一份
 * flowDepths；列键合并为一份 flowColumnKey；列间距/行间距常量合并为一份 COLUMN_GAP/ROW_GAP
 * （都是 48）。各引擎自己的列应用函数（A 的迭代内钉定+最终 snap、B 的 applyFlowColumns、
 * C 的 applyColumnConstraints）各自保留。
 *
 * evaluateLayout / flowOrientation 仅作测量（填入 response.report / response.orientations），
 * 不影响位置；A* 网格路由与共享贝塞尔几何被画布（chatgraph-canvas.ts）实时引用
 * （routeWithAstarPoints / directCurveHits / portAnchor / smoothPolyline 必须导出）；
 * fallbackLayout 为引擎异常时的确定性兜底。
 *
 * 关键几何（edgeCurve / cubicPath / cubicAt）同时被本文件（测量采样）与画布
 * （chatgraph-canvas.ts 渲染）引用——测量所见即渲染所得。
 */
import ELK from 'elkjs/lib/elk.bundled.js'
import dagre from '@dagrejs/dagre'

export interface LayoutNodeInput {
  id: string
  x: number
  y: number
  width: number
  height: number
  /** 节点类型：决定输出/输入端口的纵向偏移（与画布 PORT_OFFSETS 同源）。 */
  kind?: 'chat' | 'memory'
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
  /** 与画布 GraphEdge.behavior 同一 union（write 实际会从 host 传入，纯类型修正）。 */
  behavior?: 'fork' | 'reference' | 'write' | 'relation'
  label?: string
}

/** 布局算法偏好：'relax' 约束松弛 / 'dagre' 有向分层 / 'tree' 紧凑树（默认）。 */
export type LayoutAlgorithmName = 'relax' | 'dagre' | 'tree'

export interface ChatGraphLayoutRequest {
  nodes: LayoutNodeInput[]
  edges: LayoutEdgeInput[]
  groups?: LayoutGroupInput[]
  /** 布局算法偏好（缺省 'tree' 紧凑树）。 */
  algorithm?: LayoutAlgorithmName
  /** Nodes with selected=false or pinned=true are anchors and must not move. */
}

export interface LayoutPosition {
  id: string
  x: number
  y: number
  width?: number
  height?: number
}

export type EdgePosName = 'left' | 'right' | 'top' | 'bottom'

/** 布局为每条边挑选的贝塞尔朝向（渲染端与测量端共用同一几何）。 */
export interface LayoutOrientation {
  id: string
  source: EdgePosName
  target: EdgePosName
  /** 首尾近水平对齐时的平行弓形偏移（px，正=向下弓），0 = 无弓。 */
  bow?: number
}

export interface LayoutMetrics {
  /** 节点矩形两两重叠对数（R4，必须为 0）。 */
  overlaps: number
  /** 节点边距小于 MIN_SPACING 的对数（R2）。 */
  spacingViolations: number
  /** 连线两两交叉次数（R4，越少越好）。 */
  crossings: number
  /** 贝塞尔采样点落进非端点节点的次数（R5/R6，越少越好）。 */
  nodeHits: number
  /** 退化为直线段的连线数（R1，越少越好，目标 0）。 */
  straightSegments: number
  /** 需要深度绕行（|bow| > 240）的连线数：布局摆放不当迫使曲线大弯绕行——
      摆放好的布局此项应为 0（R1 曲线自然性的代理指标）。 */
  deepBows: number
  /** 全体连线 |bow| 之和（曲线总畸变 budget，越小越自然）。 */
  bowCost: number
  /** 绕行比 >1.8（曲线长/弦长）的连线数：曲线畸变的直接度量。 */
  detoured: number
  /** 全体节点 AABB 宽高比（R3 仅作展示，不再参与评分）。 */
  aspect: number
  /** 全体节点 AABB 面积（仅作展示，不再参与评分）。 */
  area: number
  /** 平直度：全体前向边端口 |Δy| 之和（px，越小连线越横平——v9 新一等目标）。 */
  slantiness: number
  /** 行对齐：相邻节点中心 y 差 < 24px 视为同行，未共 y 的「散行」节点数（v9 新）。 */
  rowMisalignment: number
}

/** 旧字段：v5 起引擎不再产生拐点路由（连线为单段贝塞尔），恒为空数组，仅为兼容保留。 */
export interface LayoutRoutePoint { x: number; y: number }
export interface LayoutEdgeRoute { id: string; points: LayoutRoutePoint[] }

export interface ChatGraphLayoutResponse {
  positions: LayoutPosition[]
  groupPositions?: LayoutPosition[]
  orientations?: LayoutOrientation[]
  /** 恒为空数组（兼容保留）：连线由 orientations + 共享贝塞尔几何直接渲染。 */
  routes: LayoutEdgeRoute[]
  /** v8-smart：A* 网格路由的平滑曲线（仅「直连会撞节点」的边）。path 为完整 SVG d 串。 */
  routedPaths?: Array<{ id: string; path: string; mid: { x: number; y: number } }>
  engine: 'elk' | 'fallback'
  /** 三算法候选名（历史字段名 engine 保留）：relax→flow-relax、dagre→dagre-layered、tree→compact-tree。 */
  candidate?: 'flow-relax' | 'dagre-layered' | 'compact-tree' | 'fallback'
  report?: LayoutMetrics
  durationMs: number
  warning?: string
}

// ── A* 智能布线（参考 idootop/reactflow-auto-layout 的网格寻路思想）──────────
// 网格 A*：代价 = 路径长 + 转弯惩罚 + 贴节点软惩罚；障碍 = 节点内部格子。
// 起点后首段必须向右、终点前末段必须从左进入（R6 端口语义硬编码进邻居扩展）。
// 产出折线点列后用圆角过渡转分段贝塞尔（平滑、无尖角）。

const GRID_CELL = 24
const GRID_PAD = 120
const ASTAR_TURN_PENALTY = 2.5
const ASTAR_NEAR_PENALTY = 0.8
const ASTAR_CLEARANCE = 12

interface GridSpec {
  x0: number
  y0: number
  cols: number
  rows: number
  /** true = 该格不可通行（节点内部）。 */
  blocked: Uint8Array
  /** true = 距节点 < CLEARANCE（软惩罚）。 */
  near: Uint8Array
}

function buildGrid(rects: ReadonlyMap<string, Rect>): GridSpec {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects.values()) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.width)
    maxY = Math.max(maxY, r.y + r.height)
  }
  const x0 = minX - GRID_PAD
  const y0 = minY - GRID_PAD
  const cols = Math.ceil((maxX + GRID_PAD - x0) / GRID_CELL) + 1
  const rows = Math.ceil((maxY + GRID_PAD - y0) / GRID_CELL) + 1
  const blocked = new Uint8Array(cols * rows)
  const near = new Uint8Array(cols * rows)
  const mark = (r: Rect, inflate: number, grid: Uint8Array) => {
    const c0 = Math.max(0, Math.floor((r.x - inflate - x0) / GRID_CELL))
    const c1 = Math.min(cols - 1, Math.ceil((r.x + r.width + inflate - x0) / GRID_CELL))
    const r0 = Math.max(0, Math.floor((r.y - inflate - y0) / GRID_CELL))
    const r1 = Math.min(rows - 1, Math.ceil((r.y + r.height + inflate - y0) / GRID_CELL))
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) grid[row * cols + col] = 1
    }
  }
  for (const r of rects.values()) {
    mark(r, 0, blocked)
    mark(r, ASTAR_CLEARANCE, near)
  }
  return { x0, y0, cols, rows, blocked, near }
}

function cellOf(grid: GridSpec, x: number, y: number): { col: number; row: number } {
  return { col: Math.max(0, Math.min(grid.cols - 1, Math.round((x - grid.x0) / GRID_CELL))), row: Math.max(0, Math.min(grid.rows - 1, Math.round((y - grid.y0) / GRID_CELL))) }
}

/**
 * A* 网格寻路（4 邻接 + 转弯惩罚）。
 * forward：起点后首段必须向右、终点前末段必须从左来（R6 前向边）；
 * 反馈边：起点后首段向左、终点前末段从右进入（曲线从源右端口出发先绕行再折回）。
 */
function astarPath(grid: GridSpec, start: { x: number; y: number }, end: { x: number; y: number }, feedback = false): Array<{ x: number; y: number }> | undefined {
  const s = cellOf(grid, start.x, start.y)
  const t = cellOf(grid, end.x, end.y)
  const total = grid.cols * grid.rows
  const idx = (col: number, row: number) => row * grid.cols + col
  const gCost = new Float64Array(total).fill(Infinity)
  const from = new Int32Array(total).fill(-1)
  const fromDir = new Int8Array(total).fill(-1) // 0右 1下 2左 3上
  const open: Array<{ i: number; f: number }> = []
  const h = (col: number, row: number) => Math.abs(col - t.col) + Math.abs(row - t.row)
  const sIdx = idx(s.col, s.row)
  const tIdx = idx(t.col, t.row)
  // 端口格必须可通行：端口就在节点边上，格子常被判为节点内部——临时解除起终点格障碍
  grid.blocked[sIdx] = 0
  grid.blocked[tIdx] = 0
  // 首段/末段方向约束：前向边首段必须向右（端口切线方向）、末段从左进入；
  // 反馈边从右端口出发先沿垂直方向绕行（物理上不可能向左——那是源节点身体），
  // 末段允许从上/下折回目标左侧。
  const firstDirs = feedback ? [1, 3] : [0]
  const lastDirs = feedback ? [1, 3] : [0]
  gCost[sIdx] = 0
  open.push({ i: sIdx, f: h(s.col, s.row) })
  const DIRS: Array<[number, number, number]> = [[1, 0, 0], [0, 1, 1], [-1, 0, 2], [0, -1, 3]]
  const closed = new Uint8Array(total)
  while (open.length > 0) {
    let bi = 0
    for (let k = 1; k < open.length; k += 1) if (open[k]!.f < open[bi]!.f) bi = k
    const { i: cur } = open.splice(bi, 1)[0]!
    if (closed[cur]) continue
    closed[cur] = 1
    const col = cur % grid.cols
    const row = Math.floor(cur / grid.cols)
    if (cur === tIdx) break
    for (const [dc, dr, dir] of DIRS) {
      const nc = col + dc
      const nr = row + dr
      if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue
      const ni = idx(nc, nr)
      if (grid.blocked[ni] || closed[ni]) continue
      // 起点首段方向约束（R6：前向右出；反馈先垂直绕开源节点身体）
      if (cur === sIdx && !firstDirs.includes(dir)) continue
      // 终点末段方向约束
      if (ni === tIdx && !lastDirs.includes(dir)) continue
      let step = 1
      if (grid.near[ni]) step += ASTAR_NEAR_PENALTY
      const prevDir = fromDir[cur]!
      if (prevDir >= 0 && prevDir !== dir) step += ASTAR_TURN_PENALTY
      const ng = gCost[cur]! + step
      if (ng < gCost[ni]!) {
        gCost[ni] = ng
        from[ni] = cur
        fromDir[ni] = dir
        open.push({ i: ni, f: ng + h(nc, nr) })
      }
    }
  }
  if (from[tIdx] === -1 && tIdx !== sIdx) return undefined
  const cells: Array<{ col: number; row: number }> = []
  for (let cur = tIdx; cur !== -1; cur = from[cur]!) cells.push({ col: cur % grid.cols, row: Math.floor(cur / grid.cols) })
  cells.reverse()
  // 共线压缩（保留拐点）
  const poly: Array<{ x: number; y: number }> = [{ x: start.x, y: start.y }]
  const at = (c: { col: number; row: number }) => ({ x: grid.x0 + c.col * GRID_CELL, y: grid.y0 + c.row * GRID_CELL })
  for (let i = 1; i < cells.length - 1; i += 1) {
    const a = at(cells[i - 1]!)
    const b = at(cells[i]!)
    const c = at(cells[i + 1]!)
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)
    if (!collinear) poly.push(b)
  }
  poly.push({ x: end.x, y: end.y })
  return poly
}

/** 折线 → 平滑 SVG path：直线段保持直线，拐点处用二次贝塞尔圆角（半径≤14px）。
    相比 Catmull-Rom 全点插值，圆角过渡不会在拐点处过冲甩出控制点（过冲会扫到节点）。 */
export function smoothPolyline(points: Array<{ x: number; y: number }>): string {
  const fmt = (v: number) => v.toFixed(1)
  if (points.length < 2) return ''
  if (points.length === 2) {
    const [a, b] = points
    const mx = (a!.x + b!.x) / 2
    const my = (a!.y + b!.y) / 2
    return `M ${fmt(a!.x)} ${fmt(a!.y)} Q ${fmt(mx)} ${fmt(my)}, ${fmt(b!.x)} ${fmt(b!.y)}`
  }
  const radius = Math.min(14, GRID_CELL * 0.6)
  let d = `M ${fmt(points[0]!.x)} ${fmt(points[0]!.y)}`
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
    d += ` L ${fmt(inX)} ${fmt(inY)} Q ${fmt(cur.x)} ${fmt(cur.y)}, ${fmt(outX)} ${fmt(outY)}`
  }
  const last = points[points.length - 1]!
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`
  return d
}

/** 为撞节点的边生成 A* 平滑路由（起点右出、终点左入已编码在寻路规则里）。 */
export function routeWithAstarPoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  toPort: 'context' | 'memory',
  rects: ReadonlyMap<string, Rect>,
  fromKind: 'chat' | 'memory' | undefined,
  toKind: 'chat' | 'memory' | undefined,
): Array<{ x: number; y: number }> | undefined {
  const grid = buildGrid(rects)
  const feedback = to.x - from.x < 8
  // 起终点若落在障碍格里，先沿行/列平移到最近空闲格（端口贴节点边时可能发生）
  const freeSpot = (pt: { x: number; y: number }): { x: number; y: number } => {
    const c = cellOf(grid, pt.x, pt.y)
    if (!grid.blocked[c.row * grid.cols + c.col]) return pt
    for (let d = 1; d <= 8; d += 1) {
      for (const dr of [-d, d]) {
        const rr = c.row + dr
        if (rr >= 0 && rr < grid.rows && !grid.blocked[rr * grid.cols + c.col]) return { x: pt.x, y: grid.y0 + rr * GRID_CELL }
      }
      for (const dc of [-d, d]) {
        const cc = c.col + dc
        if (cc >= 0 && cc < grid.cols && !grid.blocked[c.row * grid.cols + cc]) return { x: grid.x0 + cc * GRID_CELL, y: pt.y }
      }
    }
    return pt
  }
  const start = freeSpot(from)
  const end = freeSpot(to)
  const poly = astarPath(grid, start, end, feedback)
  if (poly === undefined || poly.length < 2) return undefined
  // 首末点贴回真实端口（寻路在网格上起步/收尾，最后对齐端口锚点）
  poly[0] = from
  poly[poly.length - 1] = to
  void toPort
  void fromKind
  void toKind
  return poly
}

/** 判断「右出左进直连曲线」是否撞中间节点（画布实时避障探测用）。
    bow：弓形偏移（与 edgeCurve 同义，控制点 y 平移量），默认 0 = 无弓直连——
    画布弓形搜索复用本函数逐候选验证单段贝塞尔是否完全不穿节点。 */
export function directCurveHits(
  from: { x: number; y: number },
  to: { x: number; y: number },
  rects: ReadonlyArray<{ id: string; x: number; y: number; width: number; height: number }>,
  fromId: string,
  toId: string,
  bow = 0,
): boolean {
  if (to.x - from.x < 8) return false
  const c = edgeCurve(from.x, from.y, 'right', to.x, to.y, 'left', bow)
  for (const rect of rects) {
    if (rect.id === fromId || rect.id === toId) continue
    for (let i = 1; i < SAMPLES; i += 1) {
      const p = cubicAt(from.x, from.y, c.c1x, c.c1y, c.c2x, c.c2y, to.x, to.y, i / SAMPLES)
      if (p.x > rect.x - HIT_TOLERANCE && p.x < rect.x + rect.width + HIT_TOLERANCE
        && p.y > rect.y - HIT_TOLERANCE && p.y < rect.y + rect.height + HIT_TOLERANCE) return true
    }
  }
  return false
}

/** 端口锚点（画布实时 A* 需要与布局同一套端口几何）。 */
export function portAnchor(
  rect: { x: number; y: number; width: number; height: number },
  kind: 'chat' | 'memory' | undefined,
  role: 'out' | 'in',
  toPort?: 'context' | 'memory',
): { x: number; y: number } {
  return portPoint(rect, kind, role, toPort)
}

const PAD_X = 48
const PAD_Y = 48
const GAP_X = 72
const GAP_Y = 36
const GROUP_PAD_X = 24
const GROUP_PAD_TOP = 36
/** R2：节点之间的最小边距（px，任意两矩形边缘距离下限）。 */
export const MIN_SPACING = 24
/** R5：穿越检测的采样数与贴边容差。48 点消除长曲线快速段的采样混叠
   （18 点曾在 t≈0.8 的回升段漏检节点穿越）。 */
const SAMPLES = 48
const HIT_TOLERANCE = 2

// ── 端口几何（R6：画布 socket 位置的唯一来源，测量与渲染共用）────────────────

/**
 * 节点类型 → 端口相对卡片左上角的偏移（px）。
 * chat：左入 context=47 / memory=67，右出=65；memory：左入=54，右出=54。
 * 画布 socket 的 top 值必须引用本常量，保证"测量所见 = 渲染所见"。
 */
export const PORT_OFFSETS = {
  chat: { in: { context: 47, memory: 67, default: 57 }, out: 65 },
  memory: { in: { default: 54 }, out: 54 },
} as const

/** 某节点某角色的端口绝对坐标（R6 锚点：右出、左入）。 */
function portPoint(rect: Rect, kind: 'chat' | 'memory' | undefined, role: 'in' | 'out', toPort?: 'context' | 'memory'): { x: number; y: number } {
  if (kind === undefined) return { x: role === 'out' ? rect.x + rect.width : rect.x, y: rect.y + rect.height / 2 }
  const table = PORT_OFFSETS[kind]
  const offset = role === 'out' ? table.out : 'in' in table ? (table.in as Record<string, number>)[toPort ?? 'default'] ?? (table.in as Record<string, number>).default! : rect.height / 2
  return { x: role === 'out' ? rect.x + rect.width : rect.x, y: rect.y + offset }
}

// ── 共享贝塞尔几何（worker 测量与画布渲染的同一实现）─────────────────────────

/**
 * 端口朝向 → 三次贝塞尔控制点。sourcePos/targetPos 为曲线离开/进入端口的切线方向。
 * bow：首尾近水平对齐时叠加的平行弓形偏移，避免退化为纯直线段（R1）。
 */
export function edgeCurve(
  sx: number, sy: number, sourcePos: EdgePosName,
  tx: number, ty: number, targetPos: EdgePosName,
  bow = 0,
): { c1x: number; c1y: number; c2x: number; c2y: number } {
  // 控制点长度 = 0.45×跨度，硬夹在 [12, 0.5×弦长] 内：控制多边形永远不会大出弦长一半，
  // 曲线贴着最短路走（v6 曾允许 260px 固定上限，短边控制点占弦长 65% 导致松垮拖沓）。
  const chord = Math.hypot(tx - sx, ty - sy)
  const cap = Math.max(12, chord * 0.5)
  const kx = Math.min(cap, Math.max(12, Math.abs(tx - sx) * 0.45))
  const ky = Math.min(cap, Math.max(12, Math.abs(ty - sy) * 0.45))
  let c1x = sx
  let c1y = sy
  let c2x = tx
  let c2y = ty
  if (sourcePos === 'right') c1x = sx + kx
  else if (sourcePos === 'left') c1x = sx - kx
  else if (sourcePos === 'top') c1y = sy - ky
  else c1y = sy + ky
  if (targetPos === 'left') c2x = tx - kx
  else if (targetPos === 'right') c2x = tx + kx
  else if (targetPos === 'top') c2y = ty - ky
  else c2y = ty + ky
  if (bow !== 0) {
    // 弓形：控制点垂直平移 |bow|（≤ 半垂直跨度），曲线恒为贴弦的平缓弧
    c1y += bow
    c2y += bow
  }
  return { c1x, c1y, c2x, c2y }
}

/** 渲染端直接可用的单段三次贝塞尔路径（无中途点、平滑）。 */
export function cubicPath(sx: number, sy: number, c1x: number, c1y: number, c2x: number, c2y: number, tx: number, ty: number): string {
  const f = (v: number) => Math.round(v * 100) / 100
  return `M ${f(sx)} ${f(sy)} C ${f(c1x)} ${f(c1y)}, ${f(c2x)} ${f(c2y)}, ${f(tx)} ${f(ty)}`
}

export function cubicAt(sx: number, sy: number, c1x: number, c1y: number, c2x: number, c2y: number, tx: number, ty: number, t: number): { x: number; y: number } {
  const u = 1 - t
  return {
    x: u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * tx,
    y: u * u * u * sy + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ty,
  }
}

/** 贝塞尔中点（t=0.5），无持久化标签位时的标签锚点。 */
export function cubicMidpoint(sx: number, sy: number, c1x: number, c1y: number, c2x: number, c2y: number, tx: number, ty: number): { x: number; y: number } {
  return cubicAt(sx, sy, c1x, c1y, c2x, c2y, tx, ty, 0.5)
}

// ── 基础工具（沿袭 v4）────────────────────────────────────────────────────

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

function rectIntersects(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
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

// ── ELK 布局核心（原样移植 idootop/reactflow-auto-layout 的 ELK 算法）───────
//
// 参考文件：
// - ref-rf-auto/src/layout/node/algorithms/elk.ts —— 算法主体：ports / #root / layoutOptions
// - ref-rf-auto/src/layout/node/index.ts —— 默认配置：algorithm 'elk-mr-tree'、horizontal、spacing {x:120, y:120}
//
// 本项目边模型 {from, to, toPort} → 参考实现 node.data.sourceHandles/targetHandles → ports
// 的等价映射：目标端口按入边 toPort 去重生成（`${id}:in:context` / `${id}:in:memory`），
// 源端口一个（`${id}:out`）；边连 sources: [`${from}:out`]、targets: [`${to}:in:${toPort}`]。

interface ElkPortSpec {
  id: string
  properties: { side: 'EAST' | 'WEST' }
}

interface ElkNodeSpec {
  id: string
  width: number
  height: number
  ports?: ElkPortSpec[]
  properties?: { 'org.eclipse.elk.portConstraints': 'FIXED_ORDER' }
}

interface ElkEdgeSpec {
  id: string
  sources: string[]
  targets: string[]
}

interface ElkGraphSpec {
  id: string
  children: ElkNodeSpec[]
  edges: ElkEdgeSpec[]
  layoutOptions: Record<string, string>
}

interface ElkLayoutResult {
  children?: Array<ElkNodeSpec & { x?: number; y?: number }>
}

/** 参考实现唯一的 ELK 实例（module 级单例，elkjs bundled 含 layered + mrtree）。 */
const elk = new ELK({ algorithms: ['layered', 'mrtree'] })

/** 合成根：无入边节点都连到它（参考实现的 sub-workflow 根节点处理），不进输出。 */
const ROOT_ID = '#root'

/** 参考实现默认间距（index.ts：spacing {x:120, y:120}）。 */
const REFERENCE_SPACING = { x: 120, y: 120 }

/** 参考实现的 layoutOptions（horizontal → direction RIGHT、spacing.nodeNode 取 spacing.y、
    nodeNodeBetweenLayers 取 spacing.x；后者在 mrtree 下即使无效也按参考原样设置）。 */
const MRTREE_LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'mrtree',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': REFERENCE_SPACING.y.toString(),
  'elk.layered.spacing.nodeNodeBetweenLayers': REFERENCE_SPACING.x.toString(),
}

/** 目标端口生成顺序（确定性：context 在前、memory 在后）。 */
const TARGET_PORT_ORDER: Array<'context' | 'memory'> = ['context', 'memory']

/**
 * 构建参考实现的 ELK 输入图（扁平结构：组不进 ELK，组框由 fallbackGroupPositions
 * 依据子节点包围盒计算）。确定性：节点与边均按 id 排序后喂给 ELK。
 */
function mrtreeGraph(input: ChatGraphLayoutRequest): { graph: ElkGraphSpec; collapsed: Map<string, string> } {
  const nodes = stableNodes(input.nodes)
  const collapsed = collapsedMap(input.groups)
  // 折叠组的子节点不进图（输出保持原位），其连边一并剔除（ELK 不允许边引用缺失节点）
  const hidden = new Set(nodes.filter((node) => collapsed.has(node.groupId ?? '')).map((node) => node.id))
  const visibleIds = new Set(nodes.filter((node) => !hidden.has(node.id)).map((node) => node.id))
  const edges = [...input.edges]
    .filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to))
    .sort((a, b) => a.id.localeCompare(b.id))
  // 每个节点的目标端口 = 入边 toPort 去重
  const incomingPorts = new Map<string, Set<'context' | 'memory'>>()
  for (const edge of edges) {
    const set = incomingPorts.get(edge.to) ?? new Set<'context' | 'memory'>()
    set.add(edge.toPort)
    incomingPorts.set(edge.to, set)
  }
  const children: ElkNodeSpec[] = nodes
    .filter((node) => !hidden.has(node.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((node) => ({
      id: node.id,
      width: node.width,
      height: node.height,
      ports: [
        ...TARGET_PORT_ORDER.filter((port) => incomingPorts.get(node.id)?.has(port) === true)
          .map((port) => ({ id: `${node.id}:in:${port}`, properties: { side: 'WEST' as const } })),
        { id: `${node.id}:out`, properties: { side: 'EAST' as const } },
      ],
      properties: { 'org.eclipse.elk.portConstraints': 'FIXED_ORDER' as const },
    }))
  const layoutEdges: ElkEdgeSpec[] = edges.map((edge) => ({
    id: edge.id,
    sources: [`${edge.from}:out`],
    targets: [`${edge.to}:in:${edge.toPort}`],
  }))
  // 无入边节点连合成根 #root（参考：connect sub-workflows' root nodes to the rootNode）
  const rootNode: ElkNodeSpec = { id: ROOT_ID, width: 1, height: 1 }
  for (const node of children) {
    if (!edges.some((edge) => edge.to === node.id)) {
      layoutEdges.push({ id: `${ROOT_ID}-${node.id}`, sources: [ROOT_ID], targets: [node.id] })
    }
  }
  return {
    graph: {
      id: '@root',
      children: [...children, rootNode],
      edges: layoutEdges,
      layoutOptions: { ...MRTREE_LAYOUT_OPTIONS },
    },
    collapsed,
  }
}

// ── 共享用户约束层（三条支线统一规格，间距参数固定 48/48，不得调优）─────────
//
// 约束 1 拓扑流向：flowDepth = 非 fork 边（behavior==='fork' 不计深度，分叉子会话与父
// 同层）上从纯源（入度 0）出发的最长路径深度；纯源最左、纯汇最右；出度大→靠左，
// 入度大→靠右；reference/write/relation 等一切非 fork 行为都传播。
// 约束 2 同类型同列：列键 = `${kind ?? 'unknown'}@${flowDepth}`，同键节点 x 完全相等；
// 列按 (depth 升序, kind 名) 确定性排序；列宽 = 该列最大节点宽；列间距 48px；
// 列内按各引擎给出的 y 序（稳定 tie-break 按 id）自上而下堆叠，行间距 48px。
//
// 三个分支对以上两段的实现逐字节相同，合并为下面的共享实现（flowDepths / flowColumnKey /
// COLUMN_GAP / ROW_GAP），三个引擎各自的列应用函数只负责「怎么把列几何应用到自己的输出上」。

/** 约束 2：列间距（px，规格固定 48/48，不得调优）。 */
export const COLUMN_GAP = 48
/** 约束 2：同列行间距（px，规格固定 48/48，不得调优）。 */
export const ROW_GAP = 48

/**
 * 约束 1：每节点的拓扑流向深度（非 fork 边最长路径）。
 * 入度 0 的纯源 depth=0，出度 0 的纯汇 depth 最大——出度大靠左、入度大靠右。
 * 环语义：Tarjan SCC 缩点后在缩点 DAG（必然无环）上求最长路，环成员同深度——
 * 此前 memo+visiting 的回边忽略法对环的打破方向依赖 DFS 起点顺序（两节点环会被
 * 起点顺序随机拆成 source/下游两极，write 边反向），缩点法顺序无关。
 * 锚点/折叠节点也参与计算（host 契约：锚点只豁免列钉定，不豁免深度传播）。
 * 三分支共享实现（原 computeFlowDepths / flowDepths 合并），导出供测试与引擎复用。
 */
export function flowDepths(nodes: ReadonlyArray<{ id: string }>, edges: readonly LayoutEdgeInput[]): Map<string, number> {
  const ids = [...new Set(nodes.map((node) => node.id))].sort((a, b) => a.localeCompare(b))
  const idSet = new Set(ids)
  const adj = new Map<string, string[]>()
  for (const edge of [...edges].sort((a, b) => a.id.localeCompare(b.id))) {
    if (edge.behavior === 'fork') continue
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue
    const list = adj.get(edge.from) ?? []
    list.push(edge.to)
    adj.set(edge.from, list)
  }
  // ── Tarjan SCC（邻接表已排序保证确定性）──
  let counter = 0
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const sccOf = new Map<string, number>()
  const stronglyConnect = (v: string): void => {
    index.set(v, counter)
    low.set(v, counter)
    counter += 1
    stack.push(v)
    onStack.add(v)
    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) {
        stronglyConnect(w)
        low.set(v, Math.min(low.get(v)!, low.get(w)!))
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!))
      }
    }
    if (low.get(v) === index.get(v)) {
      const scc = sccOf.size
      let w: string
      do {
        w = stack.pop()!
        onStack.delete(w)
        sccOf.set(w, scc)
      } while (w !== v)
    }
  }
  for (const v of ids) if (!index.has(v)) stronglyConnect(v)
  // ── 缩点 DAG 最长路：环内边消失（环成员同深度）──
  const sccParents = new Map<number, number[]>()
  for (const edge of [...edges].sort((a, b) => a.id.localeCompare(b.id))) {
    if (edge.behavior === 'fork') continue
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue
    const from = sccOf.get(edge.from)!
    const to = sccOf.get(edge.to)!
    if (from === to) continue
    const list = sccParents.get(to) ?? []
    if (!list.includes(from)) list.push(from)
    sccParents.set(to, list)
  }
  const sccDepth = new Map<number, number>()
  const sccDepthOf = (s: number): number => {
    const cached = sccDepth.get(s)
    if (cached !== undefined) return cached
    let depth = 0
    for (const p of [...(sccParents.get(s) ?? [])].sort((a, b) => a - b)) depth = Math.max(depth, sccDepthOf(p) + 1)
    sccDepth.set(s, depth)
    return depth
  }
  const result = new Map<string, number>()
  for (const v of ids) result.set(v, sccDepthOf(sccOf.get(v)!))
  return result
}

/** 约束 2：列键 = `${kind ?? 'unknown'}@${flowDepth}`（三分支共享实现，导出供测试）。 */
export function flowColumnKey(node: Pick<LayoutNodeInput, 'kind'>, depth: number): string {
  return `${node.kind ?? 'unknown'}@${depth}`
}

// ── 引擎 1（默认）：ELK mrtree 紧凑树 + 列约束后处理（C 支线）───────────────
//
// 约束层的列分配结果（列键/列 x/列内堆叠，未归一化坐标从 0 起；导出供测试）。

/** 约束层的列分配结果（导出供测试）。 */
export interface ColumnAssignment {
  /** 列键顺序（depth 升序、kind 名升序）。 */
  columnOrder: string[]
  /** 列键 → 列左边缘 x（未归一化）。 */
  columnX: Map<string, number>
  /** 可摆放节点 id → 列键。 */
  keyOf: Map<string, string>
  /** 可摆放节点 id → 列内名次（mrtree y 序，稳定 tie-break 按 id）。 */
  rankOf: Map<string, number>
  /** 可摆放节点 id → 堆叠 y（未归一化）。 */
  yOf: Map<string, number>
  /** 可摆放节点 id → 最终几何（列 x + 堆叠 y）。 */
  positionOf: Map<string, { x: number; y: number }>
}

/**
 * 约束 2 + 约束 1 的列分配：对非锚点（pinned!==true && selected!==false）、非折叠子节点、
 * ELK 已摆放的节点生效。ELK y 仅作为列内垂直顺序输入（mrtree 的排序决策不被改动）。
 * 锚点保持输入位置不参与列钉定，但其连边照常参与 flowDepth 计算。
 */
export function applyColumnConstraints(
  input: ChatGraphLayoutRequest,
  elkPositions: ReadonlyMap<string, { x: number; y: number }>,
  collapsed: ReadonlyMap<string, string>,
): ColumnAssignment {
  const depths = flowDepths(stableNodes(input.nodes), input.edges)
  const keyOf = new Map<string, string>()
  const members = new Map<string, LayoutNodeInput[]>()
  for (const node of stableNodes(input.nodes)) {
    if (node.pinned === true || node.selected === false || collapsed.has(node.groupId ?? '')) continue
    if (!elkPositions.has(node.id)) continue
    const key = flowColumnKey(node, depths.get(node.id) ?? 0)
    keyOf.set(node.id, key)
    const list = members.get(key) ?? []
    list.push(node)
    members.set(key, list)
  }
  const depthOfKey = new Map<string, number>()
  const kindOfKey = new Map<string, string>()
  for (const key of members.keys()) {
    const at = key.lastIndexOf('@')
    kindOfKey.set(key, key.slice(0, at))
    depthOfKey.set(key, Number(key.slice(at + 1)))
  }
  const columnOrder = [...members.keys()].sort((a, b) =>
    depthOfKey.get(a)! - depthOfKey.get(b)!
    || (kindOfKey.get(a) ?? '').localeCompare(kindOfKey.get(b) ?? '')
    || a.localeCompare(b))
  const columnX = new Map<string, number>()
  const rankOf = new Map<string, number>()
  const yOf = new Map<string, number>()
  const positionOf = new Map<string, { x: number; y: number }>()
  let cursorX = 0
  for (const key of columnOrder) {
    const column = members.get(key)!
    const width = Math.max(...column.map((node) => node.width))
    const columnLeft = cursorX
    columnX.set(key, columnLeft)
    cursorX = columnLeft + width + COLUMN_GAP
    // 列内垂直顺序 = mrtree 给出的 y（稳定 tie-break 按 id），自上而下精确 48px 行距堆叠
    const stacked = [...column].sort((a, b) =>
      (elkPositions.get(a.id)!.y - elkPositions.get(b.id)!.y) || a.id.localeCompare(b.id))
    let cursorY = 0
    stacked.forEach((node, index) => {
      rankOf.set(node.id, index)
      yOf.set(node.id, cursorY)
      positionOf.set(node.id, { x: columnLeft, y: cursorY })
      cursorY += node.height + ROW_GAP
    })
  }
  return { columnOrder, columnX, keyOf, rankOf, yOf, positionOf }
}

/**
 * 引擎 1（compact-tree）：ELK mrtree 布局 + 约束后处理（flowDepths/applyColumnConstraints）。
 * C 支线主流程抽出：锚点/折叠子节点输出用输入位置覆盖，非锚点整体平移使 min(x,y) ≥ 12。
 */
async function layoutByMrtree(input: ChatGraphLayoutRequest, collapsed: ReadonlyMap<string, string>): Promise<LayoutPosition[]> {
  const { graph } = mrtreeGraph(input)
  const layouted = await elk.layout(graph as any) as ElkLayoutResult
  if (layouted.children === undefined) throw new Error('ELK layout returned no children')
  const layoutedPositions = new Map<string, { x: number; y: number }>()
  for (const child of layouted.children) {
    if (child.id === ROOT_ID) continue
    layoutedPositions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 })
  }
  // 约束后处理：拓扑流向列序 + 同类型同列（只改几何，不改 mrtree 的排序决策）
  const columns = applyColumnConstraints(input, layoutedPositions, collapsed)
  const ordered = stableNodes(input.nodes)
  const anchored = (node: LayoutNodeInput): boolean =>
    node.pinned === true || node.selected === false || collapsed.has(node.groupId ?? '')
  const positions: LayoutPosition[] = ordered.map((node) => {
    const placed = columns.positionOf.get(node.id)
    // 锚点（pinned / selected=false）与折叠子节点：输出用输入位置覆盖（保持原位）
    if (anchored(node) || placed === undefined) return { id: node.id, x: Math.max(0, node.x), y: Math.max(0, node.y) }
    return { id: node.id, x: placed.x, y: placed.y }
  })
  // 非锚点（约束层摆放的）节点整体平移使全局 min(x,y) ≥ 12；锚点与折叠子节点不动。
  const shiftable: LayoutPosition[] = []
  ordered.forEach((node, index) => {
    const position = positions[index]!
    if (!anchored(node) && columns.positionOf.has(node.id)) shiftable.push(position)
  })
  let minX = Infinity
  let minY = Infinity
  for (const position of shiftable) {
    minX = Math.min(minX, position.x)
    minY = Math.min(minY, position.y)
  }
  if (Number.isFinite(minX) && Number.isFinite(minY) && (minX < 12 || minY < 12)) {
    const dx = minX < 12 ? 12 - minX : 0
    const dy = minY < 12 ? 12 - minY : 0
    for (const position of shiftable) {
      position.x += dx
      position.y += dy
    }
  }
  return positions
}

// ── 引擎 2：nodelayout 约束迭代（A 支线，yuki-koyama/nodelayout 移植 + 列钉定）──
//
// 对应关系（参考实现 → 本文件）：
//   arrange_nodes()                    → nodelayoutArrange()
//   _arrange_nodes_internal_routine()  → nodelayoutInternalRoutine()
//   node_tree.nodes                    → 可见节点数组（含锚点：锚点参与约束检测，位置不更新）
//   node_tree.links                    → 两端均可见的边数组
//   target_nodes                       → 非锚点节点（pinned!==true && selected!==false）
//   use_current_layout_as_initial_guess=false → 非锚点节点初始位置：x=列 x（约束层钉定）、y=0
//   socket y = location − 20×socket_index → portPoint(rect, kind, 'out'/'in', toPort).y
//   node.width / _get_height(node)     → node.width / node.height（本项目直接有真实高度）
// 与参考实现的偏差（用户约束层要求，见「共享用户约束层」注释）：
//   fix_horizontal_location 整族跳过（x 已钉列，迭代中 x 不可更新）；
//   fix_overlaps 不再取「更容易」方向，恒沿 y 推开（x 钉死）；
//   arrange 输出前做最终 snap（x 回列 x、同列 48px 重堆叠）与 min ≥ 12 归一。

/** 参考实现 _arrange_nodes_internal_routine 的 epsilon（终止条件阈值）。 */
const NODELAYOUT_EPSILON = 1e-5
/** 参考实现 arrange_nodes 默认 max_num_iters=500。 */
const NODELAYOUT_MAX_ITERS = 500
/** 参考实现 arrange_nodes 默认 target_space=50。 */
const NODELAYOUT_TARGET_SPACE = 50.0

interface NodelayoutNode {
  id: string
  x: number
  y: number
  width: number
  height: number
  kind: 'chat' | 'memory' | undefined
  /** 参考实现的 target_nodes 成员：仅此类节点的位置会被更新。 */
  target: boolean
}

interface NodelayoutLink {
  fromIndex: number
  toIndex: number
  toPort: 'context' | 'memory'
}

/**
 * 参考实现 _arrange_nodes_internal_routine 的移植（含约束层钉定的两处偏差）。
 * isSecondStage=false（第一轮）：target_space×2、k_v=0.5、无防重叠；
 * isSecondStage=true（第二轮）：target_space、k_v=0.05、防重叠 k=0.9。
 * 偏差（用户约束层，x 已在迭代前钉死到列 x）：
 * ① fix_horizontal_location 整族跳过——参考实现里该族只更新 x；
 * ② fix_overlaps 不再沿「更容易」的方向推开，恒沿 y 推开（x 不可更新）。
 * fix_vertical_location（垂直对齐族）逐行保持参考实现不变。
 */
function nodelayoutInternalRoutine(
  nodes: NodelayoutNode[],
  links: NodelayoutLink[],
  maxNumIters: number,
  targetSpace: number,
  isSecondStage: boolean,
): number {
  const epsilon = NODELAYOUT_EPSILON
  const space = isSecondStage ? targetSpace : 2.0 * targetSpace
  // kHorizontalDistance 随水平距离族一并移除：x 由约束层钉死，该族唯一效果是更新 x。
  const kVerticalDistance = isSecondStage ? 0.05 : 0.5

  // Gauss-Seidel-style iterations
  let previousSquaredDeltasSum = Number.MAX_VALUE
  let iterCount = 0
  for (iterCount = 0; iterCount < maxNumIters; iterCount += 1) {
    let squaredDeltasSum = 0.0

    // fix_horizontal_location：约束层已把每个非锚点节点的 x 硬钉到列 x（迭代前赋值），
    // 迭代中 x 不可更新——参考实现里本族只更新 x，故整族跳过。

    // fix_vertical_location：源 out 端口 y 与目标 in 端口 y 对齐
    // （参考实现用 socket y = location − socket_offset×socket_index；本项目 portPoint 即真实端口 y，
    //   参考的 socket_offset=20×socket_index 已被真实端口语义取代）
    for (const link of links) {
      const from = nodes[link.fromIndex]!
      const to = nodes[link.toIndex]!

      const yFrom = portPoint(from, from.kind, 'out').y
      const yTo = portPoint(to, to.kind, 'in', link.toPort).y
      const c = yFrom - yTo
      const gradCyFrom = 1.0
      const gradCyTo = -1.0
      const lagrange = c / (gradCyFrom * gradCyFrom + gradCyTo * gradCyTo)
      const deltaYFrom = -lagrange * gradCyFrom
      const deltaYTo = -lagrange * gradCyTo

      // Update positions only when the node is in the target node list
      if (from.target) {
        from.y += kVerticalDistance * deltaYFrom
        squaredDeltasSum += kVerticalDistance * kVerticalDistance * deltaYFrom * deltaYFrom
      }
      if (to.target) {
        to.y += kVerticalDistance * deltaYTo
        squaredDeltasSum += kVerticalDistance * kVerticalDistance * deltaYTo * deltaYTo
      }
    }

    // fix_overlaps and is_second_stage：全部节点对 AABB 防重叠
    if (isSecondStage) {
      const k = 0.9
      const margin = 0.5 * space

      // Examine all node pairs
      for (const node1 of nodes) {
        for (const node2 of nodes) {
          if (node1 === node2) continue

          const x1 = node1.x
          const x2 = node2.x
          const w1 = node1.width
          const w2 = node2.width
          const cx1 = x1 + 0.5 * w1
          const cx2 = x2 + 0.5 * w2
          const rx1 = 0.5 * w1 + margin
          const rx2 = 0.5 * w2 + margin

          const y1 = node1.y
          const y2 = node2.y
          const h1 = node1.height
          const h2 = node2.height
          // 参考实现为 Blender y 向上坐标（cy = y − 0.5h）；本项目屏幕坐标 y 向下（cy = y + 0.5h）。
          // 两者在 |Δ| 与符号翻转的对称结构下完全等价。
          const cy1 = y1 + 0.5 * h1
          const cy2 = y2 + 0.5 * h2
          const ry1 = 0.5 * h1 + margin
          const ry2 = 0.5 * h2 + margin

          const cx = Math.abs(cx1 - cx2) - (rx1 + rx2)
          const cy = Math.abs(cy1 - cy2) - (ry1 + ry2)

          // If no collision, just skip
          if (cx >= 0.0 || cy >= 0.0) continue

          // x 钉死（约束层）：不再取「更容易」的方向，恒沿 y 推开（其余与参考实现一致）
          const gradCy1 = cy1 - cy2 >= 0.0 ? 1.0 : -1.0
          const gradCy2 = cy1 - cy2 >= 0.0 ? -1.0 : 1.0
          const lagrange = cy / (gradCy1 * gradCy1 + gradCy2 * gradCy2)
          const deltaY1 = -lagrange * gradCy1
          const deltaY2 = -lagrange * gradCy2

          if (node1.target) {
            node1.y += k * deltaY1
            squaredDeltasSum += k * k * deltaY1 * deltaY1
          }
          if (node2.target) {
            node2.y += k * deltaY2
            squaredDeltasSum += k * k * deltaY2 * deltaY2
          }
        }
      }
    }

    // Check the termination condition
    if (Math.abs(previousSquaredDeltasSum - squaredDeltasSum) < epsilon) break
    previousSquaredDeltasSum = squaredDeltasSum
  }
  return iterCount
}

/** 一列的钉定信息：x 为列左缘（归一化前），width 为列内最大节点宽。 */
interface FlowColumn {
  key: string
  kind: 'chat' | 'memory' | 'unknown'
  depth: number
  x: number
  width: number
  nodeIds: string[]
}

/**
 * 约束 ②（A 引擎内部）：列分配。按 (depth 升序, kind 名) 确定性排序，从左到右布置；
 * 列宽 = 列内最大节点宽，列间距 COLUMN_GAP。entries 由调用方筛选
 * （仅非锚点可见节点；锚点不参与列钉定）。
 */
function assignFlowColumns(
  entries: ReadonlyArray<{ id: string; kind?: 'chat' | 'memory'; width: number }>,
  depths: ReadonlyMap<string, number>,
): FlowColumn[] {
  const kindName = (kind: 'chat' | 'memory' | undefined): string => kind ?? 'unknown'
  const byKey = new Map<string, { kind: 'chat' | 'memory' | undefined; depth: number; nodes: Array<{ id: string; width: number }> }>()
  for (const entry of entries) {
    const depth = depths.get(entry.id) ?? 0
    const key = flowColumnKey(entry, depth)
    const bucket = byKey.get(key) ?? { kind: entry.kind, depth, nodes: [] }
    bucket.nodes.push({ id: entry.id, width: entry.width })
    byKey.set(key, bucket)
  }
  const ordered = [...byKey.values()].sort((a, b) => a.depth - b.depth || kindName(a.kind).localeCompare(kindName(b.kind)))
  let cursor = 0
  return ordered.map(({ kind, depth, nodes }) => {
    const width = Math.max(...nodes.map((node) => node.width))
    const column: FlowColumn = { key: flowColumnKey({ kind }, depth), kind: kindName(kind) as 'chat' | 'memory' | 'unknown', depth, x: cursor, width, nodeIds: nodes.map((node) => node.id) }
    cursor += width + COLUMN_GAP
    return column
  })
}

/**
 * 引擎 2（flow-relax）核心：参考实现 arrange_nodes 的移植 + 用户约束层（列钉定 / 最终 snap）。
 * 非锚点节点：x 在迭代前硬钉到列 x（约束 ②，列由 flowDepth + kind 决定），y 从 0 起
 * 交由两轮迭代决定序（use_current_layout_as_initial_guess=false 语义：y 初始为 0）；
 * 锚点（pinned===true || selected===false）不钉列、不更新位置（但参与 flowDepth 与约束检测）。
 * 迭代中 x 不可更新（水平距离族跳过）、防重叠只推 y（见 nodelayoutInternalRoutine）。
 * 收敛后最终 snap：x 精确等于列 x；同列按迭代结果 y 排序（稳定 tie-break 按 id）自上而下
 * 以 ROW_GAP 精确堆叠（无重叠）——snap 不改变迭代产生的 y 顺序。
 * 最后整体平移使非锚点节点全局 min(x,y) ≥ 12（锚点不动）。
 */
function nodelayoutArrange(input: ChatGraphLayoutRequest, collapsed: ReadonlyMap<string, string>): LayoutPosition[] {
  const ordered = stableNodes(input.nodes)
  const states = new Map<string, NodelayoutNode>()
  const nodes: NodelayoutNode[] = ordered
    .filter((node) => !collapsed.has(node.groupId ?? ''))
    .map((node) => {
      const state: NodelayoutNode = {
        id: node.id,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        kind: node.kind,
        target: node.pinned !== true && node.selected !== false,
      }
      states.set(node.id, state)
      return state
    })
  const indexById = new Map(nodes.map((node, index) => [node.id, index]))

  // node_tree.links 的等价：两端均可见的边（更新仍只作用于 target 节点，与参考一致）
  const links: NodelayoutLink[] = []
  for (const edge of input.edges) {
    const fromIndex = indexById.get(edge.from)
    const toIndex = indexById.get(edge.to)
    if (fromIndex === undefined || toIndex === undefined) continue
    links.push({ fromIndex, toIndex, toPort: edge.toPort })
  }

  // 约束 ①：flowDepth（可见节点 + 两端可见的边；锚点参与计算，折叠组子节点不参与布局）
  const depths = flowDepths(nodes, input.edges.filter((edge) => indexById.has(edge.from) && indexById.has(edge.to)))
  // 约束 ②：列分配（仅非锚点节点钉列；锚点保持输入位置）
  const columns = assignFlowColumns(
    nodes.filter((node) => node.target).map((node) => ({ id: node.id, kind: node.kind, width: node.width })),
    depths,
  )
  const columnXById = new Map<string, number>()
  for (const column of columns) {
    for (const id of column.nodeIds) columnXById.set(id, column.x)
  }

  // use_current_layout_as_initial_guess=false 的钉定版：target 节点 x=列 x（硬钉）、y=0（锚点原位）
  for (const node of nodes) {
    if (!node.target) continue
    node.x = columnXById.get(node.id)!
    node.y = 0.0
  }

  // First pass / Second pass（x 钉死：水平距离族跳过、防重叠只推 y、垂直对齐族不变）
  nodelayoutInternalRoutine(nodes, links, NODELAYOUT_MAX_ITERS, NODELAYOUT_TARGET_SPACE, false)
  nodelayoutInternalRoutine(nodes, links, NODELAYOUT_MAX_ITERS, NODELAYOUT_TARGET_SPACE, true)

  // 最终 snap：x 精确回列 x；同列按迭代结果 y 排序（稳定 tie-break 按 id）自上而下
  // 以 ROW_GAP 精确堆叠（无重叠）；不改变迭代产生的 y 顺序。
  const snapped = new Map<string, { x: number; y: number }>()
  for (const column of columns) {
    const members = column.nodeIds
      .map((id) => states.get(id)!)
      .sort((a, b) => a.y - b.y || a.id.localeCompare(b.id))
    let cursorY = 0
    for (const member of members) {
      snapped.set(member.id, { x: column.x, y: cursorY })
      cursorY += member.height + ROW_GAP
    }
  }

  // 输出前整体平移：非锚点节点全局 min(x,y) ≥ 12（锚点不动）
  let minX = Infinity
  let minY = Infinity
  for (const position of snapped.values()) {
    minX = Math.min(minX, position.x)
    minY = Math.min(minY, position.y)
  }
  const dx = Number.isFinite(minX) && minX < 12 ? 12 - minX : 0
  const dy = Number.isFinite(minY) && minY < 12 ? 12 - minY : 0
  return ordered.map((node) => {
    const state = states.get(node.id)
    if (state === undefined) return { id: node.id, x: node.x, y: node.y } // 折叠组子节点：原位
    if (!state.target) return { id: node.id, x: node.x, y: node.y } // 锚点：不动
    const position = snapped.get(node.id)!
    return { id: node.id, x: position.x + dx, y: position.y + dy }
  })
}

// ── 引擎 3：dagre tight-tree 有向分层（B 支线，Jalez/react-flow-automated-layout 移植）──
//
// @dagrejs/dagre 单次同步布局：rankdir=LR + ranker='tight-tree'，setGraph 参数全部照抄
// 参考默认；边一律走参考的 default 分支 { constraint: true, minlen: 2 }；映射回左上角
// 坐标走参考 default 'topLeft' 分支（x = cx − w/2, y = cy − h/2）。分层布局之后叠加
// B 自己的列后处理 applyFlowColumns（flowDepth 覆盖列归属，同键 x 全等）。

/** 参考实现的默认节点尺寸（Dagre.ts DEFAULT_NODE_WIDTH/HEIGHT）：
    仅当节点缺少有效宽高时兜底，正常路径一律用真实测量值。 */
const DEFAULT_NODE_WIDTH = 172
const DEFAULT_NODE_HEIGHT = 36

/**
 * 约束列后处理（B 引擎内部，只改几何，不改 dagre 的排序决策）：flowDepth 覆盖列归属
 * （与 dagre rank 冲突以 flowDepth 为准），同键节点 x 完全相等；列内按 dagre 中心 y 升序
 * （稳定 tie-break 按 id）自上而下堆叠，行间距 ROW_GAP——dagre 的贡献 = 列内垂直排序 +
 * 列间流向校验。
 */
function applyFlowColumns(
  topLeft: Map<string, LayoutPosition>,
  layoutable: readonly LayoutNodeInput[],
  depths: ReadonlyMap<string, number>,
  dagreCenterY: ReadonlyMap<string, number>,
): void {
  interface DagreFlowColumn { kind: string; depth: number; nodes: LayoutNodeInput[] }
  const columns = new Map<string, DagreFlowColumn>()
  for (const node of layoutable) {
    const depth = depths.get(node.id) ?? 0
    const key = flowColumnKey(node, depth)
    const column = columns.get(key)
    if (column !== undefined) column.nodes.push(node)
    else columns.set(key, { kind: node.kind ?? 'unknown', depth, nodes: [node] })
  }
  const ordered = [...columns.values()].sort((a, b) => a.depth - b.depth || a.kind.localeCompare(b.kind))
  let columnX = 0
  for (const column of ordered) {
    const width = Math.max(...column.nodes.map((node) => Number(node.width) || DEFAULT_NODE_WIDTH))
    const stacked = [...column.nodes].sort((a, b) => (dagreCenterY.get(a.id) ?? 0) - (dagreCenterY.get(b.id) ?? 0) || a.id.localeCompare(b.id))
    let y = 0
    for (const node of stacked) {
      topLeft.set(node.id, { id: node.id, x: columnX, y })
      y += (Number(node.height) || DEFAULT_NODE_HEIGHT) + ROW_GAP
    }
    columnX += width + COLUMN_GAP
  }
}

/**
 * 引擎 3（dagre-layered）：dagre tight-tree 单次布局 + B 的列后处理。
 * ① setGraph 全部照抄参考默认；② setNode 用真实测量宽高（参考默认 172/36 仅缺失兜底）；
 * ③ 边一律 default 分支 { constraint: true, minlen: 2 }；④ 输出按参考 'topLeft' 分支映射；
 * ⑤ 锚点照常进 dagre 图（保证边引用完整），输出时用输入位置覆盖（保持原位）；
 * ⑥ 折叠组子节点不进 dagre 图、保持原位；⑦ 引擎可摆放节点整体平移使 min(x,y) ≥ 12。
 */
function layoutByDagre(input: ChatGraphLayoutRequest, collapsed: ReadonlyMap<string, string>): LayoutPosition[] {
  const nodes = input.nodes
    .filter((node) => !collapsed.has(node.groupId ?? '')) // 折叠组子节点不进 dagre 图
    .sort((a, b) => a.id.localeCompare(b.id)) // 确定性：按 id 排序再喂（dagre 本身确定）
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = input.edges
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .sort((a, b) => a.id.localeCompare(b.id))

  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({
    rankdir: 'LR',
    marginx: 0,
    marginy: 0,
    nodesep: 50,
    ranksep: 50,
    edgesep: Math.max(20, 50 / 4),
    // When we have siblings, we want their top edges to be aligned
    ranker: 'tight-tree',
  })

  // add nodes
  for (const node of nodes) {
    const width = Number(node.width) || DEFAULT_NODE_WIDTH
    const height = Number(node.height) || DEFAULT_NODE_HEIGHT
    dagreGraph.setNode(node.id, { width, height })
  }

  // add edges（参考 default 分支：ranking edge with extra separation）
  for (const edge of edges) {
    dagreGraph.setEdge(edge.from, edge.to, { constraint: true, minlen: 2 })
  }

  // run layout
  dagre.layout(dagreGraph)

  // 参考实现 default 'topLeft' 分支：dagre 输出中心坐标 → ChatGraph 左上角坐标。
  // dagreCenterY 留给列后处理做「列内垂直排序」（dagre 的交叉最小化序）。
  const topLeft = new Map<string, LayoutPosition>()
  const dagreCenterY = new Map<string, number>()
  for (const node of nodes) {
    const dgNode = dagreGraph.node(node.id)
    dagreCenterY.set(node.id, dgNode.y)
    topLeft.set(node.id, { id: node.id, x: dgNode.x - dgNode.width / 2, y: dgNode.y - dgNode.height / 2 })
  }

  // 用户约束列后处理（只改几何，不改 dagre 的排序决策）：锚点不参与列钉定
  // （但已随全图参与 flowDepth 计算）；折叠组子节点不在图内、无从参与。
  applyFlowColumns(
    topLeft,
    nodes.filter((node) => !(node.pinned === true || node.selected === false)),
    flowDepths(nodes, edges),
    dagreCenterY,
  )

  // 输出归一：把引擎可摆放的非锚点节点整体平移到 min(x,y) ≥ 12。锚点与折叠组
  // 子节点保持原位（规格⑦⑧），因此最小值只取这批可摆放节点——它们才是本引擎的输出。
  let minX = Infinity
  let minY = Infinity
  for (const node of nodes) {
    if (node.pinned === true || node.selected === false) continue
    const position = topLeft.get(node.id)!
    minX = Math.min(minX, position.x)
    minY = Math.min(minY, position.y)
  }
  if (Number.isFinite(minX) && Number.isFinite(minY) && (minX < 12 || minY < 12)) {
    const dx = minX < 12 ? 12 - minX : 0
    const dy = minY < 12 ? 12 - minY : 0
    for (const node of nodes) {
      if (node.pinned === true || node.selected === false) continue
      const position = topLeft.get(node.id)!
      position.x += dx
      position.y += dy
    }
  }

  return [...input.nodes].sort((a, b) => a.id.localeCompare(b.id)).map((node) => {
    if (node.pinned === true || node.selected === false) {
      // 锚点：照常进了 dagre 图（保证边引用完整），输出用输入位置覆盖（保持原位）。
      return { id: node.id, x: node.x, y: node.y }
    }
    if (collapsed.has(node.groupId ?? '')) {
      // 折叠组子节点：保持原位。
      return { id: node.id, x: node.x, y: node.y }
    }
    return topLeft.get(node.id)!
  })
}

// ── 确定性兜底布局 ────────────────────────────────────────────────────────

/** Deterministic no-overlap fallback used when an engine cannot be constructed. */
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

/** Compute compound group bounds for the deterministic fallback as well as the engines. */
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

// ── 测量（evaluateLayout 只测量，不影响位置）──────────────────────────────

interface Rect { x: number; y: number; width: number; height: number }

interface ScoredOrientation extends LayoutOrientation {
  hits: number
  length: number
}

function pathLength(points: Array<{ x: number; y: number }>): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
  return total
}

/**
 * R6 严格端口语义：一律右出左进（方向性布局保证边整体向右流动，不穿节点）。
 * v7 曲线纪律（第一性原理：不穿节点是布局的性质，曲线只负责微调）：
 * ① 候选 = [0, ±小弓]：小弓上限 = 0.5×垂直跨度（自然弧，绕行比恒 <1.6）；
 * ② 反馈边（目标在源左侧/同层）允许 ±通道绕行（base = 半垂直跨度，上限 700）；
 * ③ 禁止一切深度绕行/回环——曲线只做测量采样，不再反推布局。
 */
const BOW_NATURAL_MAX = 240
const BOW_LOOP_FEEDBACK_MAX = 700

function flowOrientation(
  edge: LayoutEdgeInput,
  rects: ReadonlyMap<string, Rect>,
  kinds: ReadonlyMap<string, 'chat' | 'memory' | undefined>,
): ScoredOrientation {
  const src = rects.get(edge.from)
  const tgt = rects.get(edge.to)
  if (src === undefined || tgt === undefined) return { id: edge.id, source: 'right', target: 'left', hits: 0, length: 0 }
  const from = portPoint(src, kinds.get(edge.from), 'out')
  const to = portPoint(tgt, kinds.get(edge.to), 'in', edge.toPort)
  const forward = to.x - from.x
  const feedback = forward < 8
  const hitCount = (bow: number): { points: Array<{ x: number; y: number }>; hits: number; length: number } => {
    const c = edgeCurve(from.x, from.y, 'right', to.x, to.y, 'left', bow)
    const points = Array.from({ length: SAMPLES + 1 }, (_, index) => cubicAt(from.x, from.y, c.c1x, c.c1y, c.c2x, c.c2y, to.x, to.y, index / SAMPLES))
    const minX = Math.min(from.x, to.x, ...points.map((p) => p.x)) - HIT_TOLERANCE
    const maxX = Math.max(from.x, to.x, ...points.map((p) => p.x)) + HIT_TOLERANCE
    const minY = Math.min(from.y, to.y, ...points.map((p) => p.y)) - HIT_TOLERANCE
    const maxY = Math.max(from.y, to.y, ...points.map((p) => p.y)) + HIT_TOLERANCE
    let hits = 0
    for (const point of points) {
      for (const [, rect] of others) {
        if (rect.x > maxX || rect.x + rect.width < minX || rect.y > maxY || rect.y + rect.height < minY) continue
        if (point.x > rect.x - HIT_TOLERANCE && point.x < rect.x + rect.width + HIT_TOLERANCE
          && point.y > rect.y - HIT_TOLERANCE && point.y < rect.y + rect.height + HIT_TOLERANCE) {
          hits += 1
          break
        }
      }
    }
    return { points, hits, length: pathLength(points) }
  }
  const others = [...rects.entries()].filter(([id]) => id !== edge.from && id !== edge.to)
  const chordDeviation = (points: Array<{ x: number; y: number }>): number => {
    const first = points[0]!
    const last = points[points.length - 1]!
    const chord = Math.hypot(last.x - first.x, last.y - first.y)
    if (chord <= 1) return Infinity
    let maxDev = 0
    for (const point of points) {
      const dev = Math.abs((point.y - first.y) * (last.x - first.x) - (point.x - first.x) * (last.y - first.y)) / chord
      if (dev > maxDev) maxDev = dev
    }
    return maxDev
  }
  const dy = Math.abs(to.y - from.y)
  let bows: number[]
  if (feedback) {
    // 反馈边：向上/下通道绕行，上限 700（绕行比可控）
    const base = Math.max(90, dy * 0.6)
    bows = [0, base, -base, Math.min(BOW_LOOP_FEEDBACK_MAX, base * 2), -Math.min(BOW_LOOP_FEEDBACK_MAX, base * 2)]
  } else {
    const small = Math.max(24, Math.min(BOW_NATURAL_MAX, dy * 0.5))
    const zero = hitCount(0)
    if (zero.hits === 0) {
      // 无遮挡：小弓即可（仅当近直线时加微量弓保持曲线性）
      bows = chordDeviation(zero.points) < 0.75 ? [0, small * 0.12, -small * 0.12] : [0]
    } else {
      // 有遮挡：小弓上下试探；仍穿 → 保留最小弓（hits 只作测量记录）
      bows = [0, small, -small, small * 1.6, -small * 1.6]
    }
  }
  let best: ScoredOrientation | undefined
  let bestScore = Infinity
  for (const bow of bows) {
    const { hits, length } = hitCount(bow)
    const score = hits * 1000 + length + (bow === 0 ? -20 : 0)
    if (score < bestScore) {
      bestScore = score
      best = { id: edge.id, source: 'right', target: 'left', bow: bow === 0 ? undefined : Math.round(bow), hits, length }
    }
  }
  return best ?? { id: edge.id, source: 'right', target: 'left', hits: 0, length: 0 }
}

function segmentsCross(a1: { x: number; y: number }, a2: { x: number; y: number }, b1: { x: number; y: number }, b2: { x: number; y: number }): boolean {
  const d1 = (b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x)
  const d2 = (b2.x - b1.x) * (a2.y - b1.y) - (b2.y - b1.y) * (a2.x - b1.x)
  const d3 = (a2.x - a1.x) * (b1.y - a1.y) - (a2.y - a1.y) * (b1.x - a1.x)
  const d4 = (a2.x - a1.x) * (b2.y - a1.y) - (a2.y - a1.y) * (b2.x - a1.x)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)))
  const dy = Math.max(0, Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)))
  return Math.hypot(dx, dy)
}

function sampleCubicPoints(edge: LayoutEdgeInput, orientation: LayoutOrientation, sourceRect: Rect, targetRect: Rect, kinds: ReadonlyMap<string, 'chat' | 'memory' | undefined>): Array<{ x: number; y: number }> {
  const from = portPoint(sourceRect, kinds.get(edge.from), 'out')
  const to = portPoint(targetRect, kinds.get(edge.to), 'in', edge.toPort)
  const c = edgeCurve(from.x, from.y, orientation.source, to.x, to.y, orientation.target, orientation.bow ?? 0)
  return Array.from({ length: SAMPLES + 1 }, (_, index) => cubicAt(from.x, from.y, c.c1x, c.c1y, c.c2x, c.c2y, to.x, to.y, index / SAMPLES))
}

/** 统一度量一个布局（R1–R6 全部量化，只作测量与展示）。 */
export function evaluateLayout(
  input: ChatGraphLayoutRequest,
  positions: readonly LayoutPosition[],
  orientations: readonly LayoutOrientation[],
  opts: { collapsed?: ReadonlySet<string> } = {},
): LayoutMetrics {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]))
  const positionById = new Map(positions.map((position) => [position.id, position]))
  const kinds = new Map(input.nodes.map((node) => [node.id, node.kind]))
  const collapsed = opts.collapsed ?? new Set<string>()
  const visible = input.nodes
    .filter((node) => !collapsed.has(node.groupId ?? '') && positionById.has(node.id))
    .map((node) => ({ id: node.id, rect: { ...positionById.get(node.id)!, width: node.width, height: node.height } }))
  let overlaps = 0
  let spacingViolations = 0
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      const a = visible[i]!.rect
      const b = visible[j]!.rect
      if (rectIntersects(a, b)) overlaps += 1
      else if (rectGap(a, b) < MIN_SPACING) spacingViolations += 1
    }
  }
  // 每条边的采样折线（用被选中的朝向 + 类型感知的端口锚点）
  const sampled: Array<{ id: string; points: Array<{ x: number; y: number }> }> = []
  let nodeHits = 0
  let straightSegments = 0
  let deepBows = 0
  let bowCost = 0
  let detoured = 0
  // v9 平直度：前向边端口 y 差绝对值之和（连线越横平越好看）
  let slantiness = 0
  for (const orientation of orientations) {
    const edge = input.edges.find((item) => item.id === orientation.id)
    if (edge === undefined) continue
    const sourceRect = visible.find((item) => item.id === edge.from)?.rect
    const targetRect = visible.find((item) => item.id === edge.to)?.rect
    if (sourceRect === undefined || targetRect === undefined) continue
    const fromPort = portPoint(sourceRect, kinds.get(edge.from), 'out')
    const toPort = portPoint(targetRect, kinds.get(edge.to), 'in', edge.toPort)
    if (toPort.x - fromPort.x >= 8) slantiness += Math.abs(toPort.y - fromPort.y)
    const points = sampleCubicPoints(edge, orientation, sourceRect, targetRect, kinds)
    sampled.push({ id: edge.id, points })
    // R1 曲线自然度：深度绕行（大 bow）说明摆放迫使曲线大弯——布局级缺陷，累计记录
    const bowMag = Math.abs(orientation.bow ?? 0)
    bowCost += bowMag
    if (bowMag > BOW_NATURAL_MAX) deepBows += 1
    // R1 绕行比（曲线长/弦长）：>1.8 即畸变（控制点失控或摆放逼出深绕行）
    const firstPt = points[0]!
    const lastPt = points[points.length - 1]!
    const chordLen = Math.hypot(lastPt.x - firstPt.x, lastPt.y - firstPt.y)
    if (chordLen > 1) {
      const arc = pathLength(points)
      if (arc / chordLen > 1.8) detoured += 1
    }
    // R1 反退化统计：采样点距首尾弦的最大垂距 ≈ 0 → 曲线退化为直线段
    const first = points[0]!
    const last = points[points.length - 1]!
    const chord = Math.hypot(last.x - first.x, last.y - first.y)
    if (chord > 1) {
      let maxDev = 0
      for (const point of points) {
        const dev = Math.abs((point.y - first.y) * (last.x - first.x) - (point.x - first.x) * (last.y - first.y)) / chord
        if (dev > maxDev) maxDev = dev
      }
      if (maxDev < 0.75) straightSegments += 1
    }
    const minX = Math.min(...points.map((p) => p.x)) - HIT_TOLERANCE
    const maxX = Math.max(...points.map((p) => p.x)) + HIT_TOLERANCE
    const minY = Math.min(...points.map((p) => p.y)) - HIT_TOLERANCE
    const maxY = Math.max(...points.map((p) => p.y)) + HIT_TOLERANCE
    const others = visible.filter((item) => item.id !== edge.from && item.id !== edge.to
      && !(item.rect.x > maxX || item.rect.x + item.rect.width < minX || item.rect.y > maxY || item.rect.y + item.rect.height < minY))
    for (const point of points) {
      for (const other of others) {
        if (point.x > other.rect.x - HIT_TOLERANCE && point.x < other.rect.x + other.rect.width + HIT_TOLERANCE
          && point.y > other.rect.y - HIT_TOLERANCE && point.y < other.rect.y + other.rect.height + HIT_TOLERANCE) {
          nodeHits += 1
          break
        }
      }
    }
  }
  // 交叉计数：AABB 预筛选后的折线段两两求交
  let crossings = 0
  for (let i = 0; i < sampled.length; i += 1) {
    const a = sampled[i]!
    const boxA = { minX: Math.min(...a.points.map((p) => p.x)), maxX: Math.max(...a.points.map((p) => p.x)), minY: Math.min(...a.points.map((p) => p.y)), maxY: Math.max(...a.points.map((p) => p.y)) }
    for (let j = i + 1; j < sampled.length; j += 1) {
      const b = sampled[j]!
      const boxB = { minX: Math.min(...b.points.map((p) => p.x)), maxX: Math.max(...b.points.map((p) => p.x)), minY: Math.min(...b.points.map((p) => p.y)), maxY: Math.max(...b.points.map((p) => p.y)) }
      if (boxA.maxX < boxB.minX || boxB.maxX < boxA.minX || boxA.maxY < boxB.minY || boxB.maxY < boxA.minY) continue
      for (let s = 1; s < a.points.length; s += 1) {
        for (let t = 1; t < b.points.length; t += 1) {
          if (segmentsCross(a.points[s - 1]!, a.points[s]!, b.points[t - 1]!, b.points[t]!)) crossings += 1
        }
      }
    }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const item of visible) {
    minX = Math.min(minX, item.rect.x)
    minY = Math.min(minY, item.rect.y)
    maxX = Math.max(maxX, item.rect.x + item.rect.width)
    maxY = Math.max(maxY, item.rect.y + item.rect.height)
  }
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  // v9 行对齐：把中心 y 相差 < ROW_EPS 的节点聚成行，散行数 = 节点数 − 最大可归行数。
  const ROW_EPS = 24
  const centersY = visible.map((item) => item.rect.y + item.rect.height / 2).sort((a, b) => a - b)
  let rows = 0
  let anchor = -Infinity
  for (const cy of centersY) {
    if (cy - anchor >= ROW_EPS) { rows += 1; anchor = cy }
  }
  const rowMisalignment = Math.max(0, visible.length - rows)
  return {
    overlaps,
    spacingViolations,
    crossings,
    nodeHits,
    straightSegments,
    deepBows,
    bowCost,
    detoured,
    aspect: Math.round((width / height) * 1000) / 1000,
    area: Math.round(width * height),
    slantiness,
    rowMisalignment,
  }
}

// ── 主流程：按 algorithm 分发到三个引擎 → 共享测量（测量绝不影响位置）──────

/** 候选名映射（response.candidate 的三算法取值）。 */
const CANDIDATE_BY_ALGORITHM: Record<LayoutAlgorithmName, 'flow-relax' | 'dagre-layered' | 'compact-tree'> = {
  relax: 'flow-relax',
  dagre: 'dagre-layered',
  tree: 'compact-tree',
}

/**
 * 主流程：request.algorithm（缺省 'tree'）分发到三个引擎；输出经同一套测量
 * （flowOrientation + evaluateLayout，纯测量绝不影响位置）组装 response。
 * 任一引擎异常 → catch → 确定性 fallbackLayout + fallbackGroupPositions。
 */
export async function layoutGraph(input: ChatGraphLayoutRequest): Promise<ChatGraphLayoutResponse> {
  const started = Date.now()
  if (input.nodes.length === 0) return { positions: [], groupPositions: [], routes: [], orientations: [], engine: 'fallback', candidate: 'fallback', durationMs: 0 }
  const collapsed = collapsedMap(input.groups)
  try {
    const algorithm: LayoutAlgorithmName = input.algorithm === 'relax' || input.algorithm === 'dagre' ? input.algorithm : 'tree'
    const positions = algorithm === 'relax'
      ? nodelayoutArrange(input, collapsed)
      : algorithm === 'dagre'
        ? layoutByDagre(input, collapsed)
        : await layoutByMrtree(input, collapsed)
    const groupPositions = fallbackGroupPositions(input, positions)
    // 纯测量：orientations（渲染曲线形态）与 report（质量度量）不参与/不影响位置。
    const ordered = stableNodes(input.nodes)
    const positionById = new Map(positions.map((position) => [position.id, position]))
    const kinds = new Map(ordered.map((node) => [node.id, node.kind]))
    const rects = new Map<string, Rect>()
    for (const node of ordered) {
      const position = positionById.get(node.id)
      if (position !== undefined) rects.set(node.id, { x: position.x, y: position.y, width: node.width, height: node.height })
    }
    const orientations = input.edges
      .filter((edge) => rects.has(edge.from) && rects.has(edge.to))
      .map((edge) => flowOrientation(edge, rects, kinds))
    const report = evaluateLayout(input, positions, orientations, { collapsed: new Set(collapsed.keys()) })
    return {
      positions,
      groupPositions,
      orientations,
      routes: [],
      routedPaths: [],
      engine: 'elk',
      candidate: CANDIDATE_BY_ALGORITHM[algorithm],
      report,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    const positions = fallbackLayout(input)
    const groupPositions = fallbackGroupPositions(input, positions)
    return {
      positions,
      groupPositions,
      orientations: [],
      routes: [],
      engine: 'fallback',
      candidate: 'fallback',
      durationMs: Date.now() - started,
      warning: error instanceof Error ? error.message : String(error),
    }
  }
}

declare const self: { onmessage?: (event: MessageEvent<ChatGraphLayoutRequest>) => void; postMessage: (value: ChatGraphLayoutResponse) => void } | undefined
if (typeof self !== 'undefined' && self !== undefined) {
  self.onmessage = (event) => { void layoutGraph(event.data).then((response) => self.postMessage(response)) }
}
