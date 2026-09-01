import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyColumnConstraints,
  cubicAt,
  cubicMidpoint,
  COLUMN_GAP,
  directCurveHits,
  edgeCurve,
  fallbackLayout,
  flowColumnKey,
  flowDepths,
  layoutGraph,
  PORT_OFFSETS,
  portAnchor,
  routeWithAstarPoints,
  ROW_GAP,
  smoothPolyline,
  type ChatGraphLayoutRequest,
  type LayoutAlgorithmName,
  type LayoutNodeInput,
} from '../src/client/chatgraph-layout-worker'

const WIDTH = 176
const HEIGHT = 76

/** 三算法 dispatch 矩阵：紧凑树（默认）/ 有向分层 / 约束松弛 → 各自候选名。 */
const ALGORITHMS: ReadonlyArray<{ algorithm: LayoutAlgorithmName; candidate: 'compact-tree' | 'dagre-layered' | 'flow-relax' }> = [
  { algorithm: 'tree', candidate: 'compact-tree' },
  { algorithm: 'dagre', candidate: 'dagre-layered' },
  { algorithm: 'relax', candidate: 'flow-relax' },
]

/** 用与渲染端一致的几何采样一条边（严格右出左进）。 */
function sampledPoints(request: ChatGraphLayoutRequest, positions: Array<{ id: string; x: number; y: number }>, orientation: { id: string; bow?: number }): Array<{ x: number; y: number }> {
  const nodeById = new Map(request.nodes.map((node) => [node.id, node]))
  const posById = new Map(positions.map((position) => [position.id, position]))
  const edge = request.edges.find((item) => item.id === orientation.id)!
  const s = posById.get(edge.from)!
  const t = posById.get(edge.to)!
  const sKind = nodeById.get(edge.from)?.kind
  const tKind = nodeById.get(edge.to)?.kind
  const outY = sKind === undefined ? s.y + nodeById.get(edge.from)!.height / 2 : s.y + (sKind === 'chat' ? PORT_OFFSETS.chat.out : PORT_OFFSETS.memory.out)
  const inY = tKind === undefined ? t.y + nodeById.get(edge.to)!.height / 2 : t.y + (tKind === 'chat' ? PORT_OFFSETS.chat.in[edge.toPort] ?? PORT_OFFSETS.chat.in.default : PORT_OFFSETS.memory.in.default)
  const c = edgeCurve(s.x + nodeById.get(edge.from)!.width, outY, 'right', t.x, inY, 'left', orientation.bow ?? 0)
  return Array.from({ length: 25 }, (_, index) => cubicAt(s.x + nodeById.get(edge.from)!.width, outY, c.c1x, c.c1y, c.c2x, c.c2y, t.x, inY, index / 24))
}

function fixture(count: number): ChatGraphLayoutRequest {
  const nodes: LayoutNodeInput[] = Array.from({ length: count }, (_, index) => ({
    id: `n${index.toString().padStart(4, '0')}`,
    x: 0,
    y: 0,
    width: WIDTH,
    height: HEIGHT,
    createdAt: index,
  }))
  const edges = Array.from({ length: Math.max(0, count - 1) }, (_, index) => ({
    id: `e${index.toString().padStart(4, '0')}`,
    from: `n${index.toString().padStart(4, '0')}`,
    to: `n${(index + 1).toString().padStart(4, '0')}`,
    toPort: 'context' as const,
  }))
  return { nodes, edges }
}

/** 分叉汇聚图：3 个记忆源 + 2 个会话（fork）+ 2 个供给节点（三支线共用 fixture）。 */
function forkMergeFixture(): ChatGraphLayoutRequest {
  return {
    nodes: [
      { id: 'profile', x: 0, y: 0, width: 220, height: 96, kind: 'memory', createdAt: 1 },
      { id: 'guidance', x: 0, y: 0, width: 220, height: 96, kind: 'memory', createdAt: 2 },
      { id: 'turns', x: 0, y: 0, width: 220, height: 96, kind: 'memory', createdAt: 3 },
      { id: 'chat-a', x: 0, y: 0, width: 230, height: 130, kind: 'chat', createdAt: 4 },
      { id: 'chat-b', x: 0, y: 0, width: 230, height: 130, kind: 'chat', createdAt: 5 },
      { id: 'note', x: 0, y: 0, width: 210, height: 96, kind: 'memory', createdAt: 6 },
      { id: 'paper', x: 0, y: 0, width: 210, height: 116, kind: 'memory', createdAt: 7 },
    ],
    edges: [
      { id: 'e-profile', from: 'profile', to: 'chat-a', toPort: 'memory', behavior: 'reference' },
      { id: 'e-guidance', from: 'guidance', to: 'chat-a', toPort: 'memory', behavior: 'reference' },
      { id: 'e-turns-a', from: 'turns', to: 'chat-a', toPort: 'memory', behavior: 'reference' },
      { id: 'e-turns-b', from: 'turns', to: 'chat-b', toPort: 'memory', behavior: 'reference' },
      { id: 'e-fork', from: 'chat-a', to: 'chat-b', toPort: 'context', behavior: 'fork' },
      { id: 'e-note', from: 'note', to: 'chat-a', toPort: 'memory', behavior: 'reference' },
      { id: 'e-paper', from: 'paper', to: 'chat-b', toPort: 'memory', behavior: 'reference' },
    ],
  }
}

/** 跨深度链：源 memory → chat → 台账 memory → 下游 chat（纯源到纯汇，全部非 fork）。 */
function crossDepthFixture(): ChatGraphLayoutRequest {
  return {
    nodes: [
      { id: 'src-memory', x: 0, y: 0, width: 220, height: 96, kind: 'memory', createdAt: 1 },
      { id: 'mid-chat', x: 0, y: 0, width: 230, height: 130, kind: 'chat', createdAt: 2 },
      { id: 'ledger-memory', x: 0, y: 0, width: 210, height: 96, kind: 'memory', createdAt: 3 },
      { id: 'down-chat', x: 0, y: 0, width: 230, height: 130, kind: 'chat', createdAt: 4 },
    ],
    edges: [
      { id: 'e-src', from: 'src-memory', to: 'mid-chat', toPort: 'memory', behavior: 'reference' },
      { id: 'e-ledger', from: 'mid-chat', to: 'ledger-memory', toPort: 'memory', behavior: 'relation' },
      { id: 'e-down', from: 'ledger-memory', to: 'down-chat', toPort: 'memory', behavior: 'reference' },
    ],
  }
}

function assertNoOverlap(request: ChatGraphLayoutRequest, positions: Array<{ id: string; x: number; y: number }>): void {
  const byId = new Map(request.nodes.map((node) => [node.id, node]))
  for (let i = 0; i < positions.length; i += 1) {
    const a = positions[i]!
    const an = byId.get(a.id)
    assert.ok(an)
    for (let j = i + 1; j < positions.length; j += 1) {
      const b = positions[j]!
      const bn = byId.get(b.id)
      assert.ok(bn)
      const separated = a.x + an.width + 8 <= b.x || b.x + bn.width + 8 <= a.x || a.y + an.height + 8 <= b.y || b.y + bn.height + 8 <= a.y
      assert.ok(separated, `overlap: ${a.id} / ${b.id}`)
    }
  }
}

/** 任意两节点矩形边缘间距 ≥ minGap（硬不重叠）。 */
function assertMinGap(request: ChatGraphLayoutRequest, positions: Array<{ id: string; x: number; y: number }>, minGap: number): void {
  const byId = new Map(request.nodes.map((node) => [node.id, node]))
  for (let i = 0; i < positions.length; i += 1) {
    const a = positions[i]!
    const an = byId.get(a.id)!
    for (let j = i + 1; j < positions.length; j += 1) {
      const b = positions[j]!
      const bn = byId.get(b.id)!
      const dx = Math.max(0, Math.max(a.x - (b.x + bn.width), b.x - (a.x + an.width)))
      const dy = Math.max(0, Math.max(a.y - (b.y + bn.height), b.y - (a.y + an.height)))
      const gap = Math.hypot(dx, dy)
      assert.ok(gap >= minGap, `gap(${a.id}, ${b.id}) = ${gap} < ${minGap}`)
    }
  }
}

/** 全对最小分离间隙（AABB 分离轴间隙，负值 = 硬重叠）。 */
function minPairwiseGap(request: ChatGraphLayoutRequest, positions: Array<{ id: string; x: number; y: number }>): number {
  const byId = new Map(request.nodes.map((node) => [node.id, node]))
  let minGap = Infinity
  for (let i = 0; i < positions.length; i += 1) {
    const a = positions[i]!
    const an = byId.get(a.id)!
    for (let j = i + 1; j < positions.length; j += 1) {
      const b = positions[j]!
      const bn = byId.get(b.id)!
      const gapX = Math.max(a.x - (b.x + bn.width), b.x - (a.x + an.width))
      const gapY = Math.max(a.y - (b.y + bn.height), b.y - (a.y + an.height))
      const gap = Math.max(gapX, gapY)
      if (gap < minGap) minGap = gap
    }
  }
  return minGap
}

function assertAllPlaced(request: ChatGraphLayoutRequest, positions: Array<{ id: string; x: number; y: number }>): void {
  assert.equal(positions.length, request.nodes.length, 'every node must be placed')
  const ids = new Set(request.nodes.map((node) => node.id))
  for (const position of positions) {
    assert.ok(ids.has(position.id), `unknown position id: ${position.id}`)
    assert.ok(position.x >= 0, `${position.id}.x = ${position.x} must be >= 0`)
    assert.ok(position.y >= 0, `${position.id}.y = ${position.y} must be >= 0`)
  }
}

// ── 共享几何契约（edgeCurve / cubic* / PORT_OFFSETS / 端口锚点：三引擎同一实现）──

test('edgeCurve 控制点几何与 PORT_OFFSETS 端口偏移', () => {
  // 右出左进：控制点水平外伸，bow=0 时首尾切线水平
  const c = edgeCurve(0, 50, 'right', 200, 50, 'left', 0)
  assert.equal(c.c1y, 50)
  assert.equal(c.c2y, 50)
  assert.ok(c.c1x > 0 && c.c1x < 200, 'c1 must extend right of source')
  assert.ok(c.c2x > 0 && c.c2x < 200, 'c2 must extend left of target')
  // bow 平移两侧控制点（正 = 向下弓）
  const b = edgeCurve(0, 50, 'right', 200, 50, 'left', 30)
  assert.equal(b.c1y, 80)
  assert.equal(b.c2y, 80)
  // PORT_OFFSETS：chat 右出 65 / 左入 context 47 / memory 67；memory 对称 54
  assert.equal(PORT_OFFSETS.chat.out, 65)
  assert.equal(PORT_OFFSETS.chat.in.context, 47)
  assert.equal(PORT_OFFSETS.chat.in.memory, 67)
  assert.equal(PORT_OFFSETS.memory.out, 54)
  assert.equal(PORT_OFFSETS.memory.in.default, 54)
  // portAnchor：输出端口 = 右边缘，输入端口 = 左边缘
  const rect = { x: 0, y: 0, width: 220, height: 96 }
  assert.deepEqual(portAnchor(rect, 'chat', 'out'), { x: 220, y: 65 })
  assert.deepEqual(portAnchor(rect, 'chat', 'in', 'context'), { x: 0, y: 47 })
  assert.deepEqual(portAnchor(rect, 'memory', 'in', 'memory'), { x: 0, y: 54 })
})

test('edgeCurve 数值契约：控制点长度 = min(0.45×跨度, 0.5×弦长)，bow 垂直平移', () => {
  // 弦长 200 → cap=100；kx = min(100, max(12, 200×0.45=90)) = 90；ky = min(100, max(12, 0)) = 12
  assert.deepEqual(edgeCurve(0, 0, 'right', 200, 0, 'left'), { c1x: 90, c1y: 0, c2x: 110, c2y: 0 })
  // bow 把两个控制点垂直平移
  const bowed = edgeCurve(0, 0, 'right', 200, 0, 'left', 30)
  assert.deepEqual(bowed, { c1x: 90, c1y: 30, c2x: 110, c2y: 30 })
  // 竖直边：bottom → top
  assert.deepEqual(edgeCurve(0, 0, 'bottom', 0, 200, 'top'), { c1x: 0, c1y: 90, c2x: 0, c2y: 110 })
})

test('cubicAt / cubicMidpoint：t=0.5 中点落在对称贝塞尔上', () => {
  assert.deepEqual(cubicAt(0, 0, 100, 0, 200, 0, 300, 0, 0.5), { x: 150, y: 0 })
  // c1y=c2y=60、ty=0：y = 3u²t×60 + 3ut²×60 + t³×0 = 45
  assert.deepEqual(cubicAt(0, 0, 100, 60, 200, 60, 300, 0, 0.5), { x: 150, y: 45 })
  assert.deepEqual(cubicMidpoint(0, 0, 100, 0, 200, 0, 300, 0), { x: 150, y: 0 })
})

// ── 分发入口（algorithm → 三引擎，候选名/契约一致）────────────────────────

test('缺省不传 algorithm 时走默认紧凑树（candidate=compact-tree）', async () => {
  const request = fixture(12)
  const result = await layoutGraph(request)
  assert.equal(result.engine, 'elk', `engine: ${result.engine} warning: ${result.warning ?? ''}`)
  assert.equal(result.candidate, 'compact-tree')
})

for (const { algorithm, candidate } of ALGORITHMS) {
  test(`dispatch[${algorithm}]：候选名正确、锚点固定、全放置、确定性（18 链）`, async () => {
    const request = fixture(18)
    request.nodes[0]!.pinned = true
    request.nodes[0]!.x = 700
    request.nodes[0]!.y = 120
    request.nodes[17]!.selected = false
    request.nodes[17]!.x = 1400
    request.nodes[17]!.y = 360
    request.algorithm = algorithm
    const first = await layoutGraph(request)
    assert.equal(first.engine, 'elk', `engine: ${first.engine} warning: ${first.warning ?? ''}`)
    assert.equal(first.candidate, candidate)
    // 锚点（pinned / selected=false）逐字节保持输入位置
    assert.deepEqual(first.positions.find((position) => position.id === 'n0000'), { id: 'n0000', x: 700, y: 120 })
    assert.deepEqual(first.positions.find((position) => position.id === 'n0017'), { id: 'n0017', x: 1400, y: 360 })
    assertAllPlaced(request, first.positions)
    assertNoOverlap(request, first.positions)
    // 引擎不产生拐点路由（单段贝塞尔）
    assert.equal(first.routes.length, 0)
    // 确定性：同一输入两次运行完全一致
    const second = await layoutGraph(request)
    assert.deepEqual(second.positions, first.positions)
    assert.deepEqual(second.orientations, first.orientations)
    assert.deepEqual(second.report, first.report)
  })
}

for (const { algorithm, candidate } of ALGORITHMS) {
  test(`dispatch[${algorithm}]：分叉汇聚图全对不重叠、orientations 覆盖每条边、前向边右出左进`, async () => {
    const request = forkMergeFixture()
    request.algorithm = algorithm
    const result = await layoutGraph(request)
    assert.equal(result.engine, 'elk', `engine: ${result.engine} warning: ${result.warning ?? ''}`)
    assert.equal(result.candidate, candidate)
    assert.ok(result.report !== undefined)
    assert.equal(result.report.overlaps, 0, `report overlaps: ${JSON.stringify(result.report)}`)
    assertAllPlaced(request, result.positions)
    assert.ok(minPairwiseGap(request, result.positions) >= 1, `hard overlap: min gap = ${minPairwiseGap(request, result.positions).toFixed(3)}px`)
    // orientations 覆盖每条边；前向边曲线出发段向右、进入段从左靠入
    assert.ok(result.orientations !== undefined && result.orientations.length === request.edges.length, 'orientations must cover every edge')
    const posById = new Map(result.positions.map((position) => [position.id, position]))
    for (const orientation of result.orientations ?? []) {
      assert.equal(orientation.source, 'right')
      assert.equal(orientation.target, 'left')
      const edge = request.edges.find((item) => item.id === orientation.id)!
      const s = posById.get(edge.from)!
      const t = posById.get(edge.to)!
      if (t.x > s.x + 8) {
        const points = sampledPoints(request, result.positions, orientation)
        assert.ok(points[1]!.x > points[0]!.x, `${orientation.id} must leave rightward`)
        assert.ok(points[points.length - 2]!.x < points[points.length - 1]!.x, `${orientation.id} must enter from the left`)
      }
    }
  })
}

// ── 共享用户约束层（拓扑流向 flowDepth + 同类型同列，规格间距 48/48，三引擎一致）──

for (const { algorithm, candidate } of ALGORITHMS) {
  test(`约束 2[${algorithm}]：同列键节点 x 逐字节相等（非锚点，fork 汇聚图）`, async () => {
    const request = forkMergeFixture()
    request.algorithm = algorithm
    const result = await layoutGraph(request)
    assert.equal(result.engine, 'elk')
    assert.equal(result.candidate, candidate)
    const depths = flowDepths(request.nodes, request.edges)
    const xByKey = new Map<string, number>()
    for (const node of request.nodes) {
      if (node.pinned === true || node.selected === false) continue
      const key = flowColumnKey(node, depths.get(node.id) ?? 0)
      const position = result.positions.find((item) => item.id === node.id)!
      const seen = xByKey.get(key)
      if (seen === undefined) xByKey.set(key, position.x)
      else assert.equal(position.x, seen, `同列键 ${key} 的 ${node.id} x 必须逐字节相等`)
    }
    // 预期列：五个记忆源 memory@0 + 两个会话 chat@1（fork 边不计深度）
    assert.deepEqual([...xByKey.keys()].sort(), ['chat@1', 'memory@0'])
  })

  test(`约束 1+2[${algorithm}]：列 x 随 depth 升序，列间距恰为 ${COLUMN_GAP}px（列宽=列内最大节点宽）`, async () => {
    const request = crossDepthFixture()
    request.algorithm = algorithm
    const result = await layoutGraph(request)
    assert.equal(result.engine, 'elk')
    const depths = flowDepths(request.nodes, request.edges)
    const byKey = new Map<string, Array<{ width: number; x: number }>>()
    for (const node of request.nodes) {
      const key = flowColumnKey(node, depths.get(node.id) ?? 0)
      const position = result.positions.find((item) => item.id === node.id)!
      const list = byKey.get(key) ?? []
      list.push({ width: node.width, x: position.x })
      byKey.set(key, list)
    }
    // 列序：depth 升序、kind 名升序
    const order = [...byKey.keys()].sort((a, b) => {
      const kindA = a.split('@')[0]!
      const kindB = b.split('@')[0]!
      return Number(a.split('@')[1]) - Number(b.split('@')[1]) || kindA.localeCompare(kindB)
    })
    let expectedX: number | undefined
    for (const key of order) {
      const column = byKey.get(key)!
      const x = column[0]!.x
      for (const member of column) assert.equal(member.x, x, `列 ${key} 内 x 全等`)
      if (expectedX !== undefined) {
        assert.equal(x, expectedX, `列 ${key} 的 x 必须等于上一列 x + 列宽 + ${COLUMN_GAP}px（归一化平移不改列间差）`)
      }
      expectedX = x + Math.max(...column.map((member) => member.width)) + COLUMN_GAP
    }
    // x 随 depth 严格升序
    for (let i = 1; i < order.length; i += 1) {
      const prev = byKey.get(order[i - 1]!)!
      const cur = byKey.get(order[i]!)!
      assert.ok(cur[0]!.x > prev[0]!.x, `列 ${order[i]} 的 x 必须大于列 ${order[i - 1]} 的 x`)
    }
    // 纯源最左、纯汇最右：整链从左流向右
    const xOf = new Map(result.positions.map((position) => [position.id, position.x]))
    assert.equal(depths.get('src-memory'), 0, '纯源（入度 0）flowDepth=0')
    assert.equal(depths.get('down-chat'), 3, '纯汇（出度 0）flowDepth 最大')
    assert.ok(xOf.get('src-memory')! < xOf.get('mid-chat')!)
    assert.ok(xOf.get('mid-chat')! < xOf.get('ledger-memory')!)
    assert.ok(xOf.get('ledger-memory')! < xOf.get('down-chat')!)
  })

  test(`约束 2[${algorithm}]：fork 边两端同列，fork 兄弟按 ${ROW_GAP}px 行距堆叠`, async () => {
    const request: ChatGraphLayoutRequest = {
      nodes: [
        { id: 'parent', x: 0, y: 0, width: 230, height: 130, kind: 'chat', createdAt: 1 },
        { id: 'child-a', x: 0, y: 0, width: 230, height: 130, kind: 'chat', createdAt: 2 },
        { id: 'child-b', x: 0, y: 0, width: 230, height: 130, kind: 'chat', createdAt: 3 },
      ],
      edges: [
        { id: 'f1', from: 'parent', to: 'child-a', toPort: 'context', behavior: 'fork' },
        { id: 'f2', from: 'parent', to: 'child-b', toPort: 'context', behavior: 'fork' },
      ],
    }
    request.algorithm = algorithm
    const result = await layoutGraph(request)
    assert.equal(result.engine, 'elk')
    const posById = new Map(result.positions.map((position) => [position.id, position]))
    const parent = posById.get('parent')!
    const childA = posById.get('child-a')!
    const childB = posById.get('child-b')!
    // fork 不计深度：父与两个分叉子会话同列（x 逐字节相等）
    assert.equal(childA.x, parent.x, 'fork 子会话必须与父同列')
    assert.equal(childB.x, parent.x, 'fork 子会话必须与父同列')
    // 同列内按 48px 行距自上而下堆叠（高度 130 + 48 = 178，与堆叠顺序无关）
    const ys = [parent.y, childA.y, childB.y].sort((a, b) => a - b)
    assert.equal(ys[1]! - ys[0]!, 130 + ROW_GAP)
    assert.equal(ys[2]! - ys[1]!, 130 + ROW_GAP)
    // fork 汇聚图同样成立：e-fork 两端 chat-a / chat-b 同列
    const forkMergeRequest = forkMergeFixture()
    forkMergeRequest.algorithm = algorithm
    const forkMerge = await layoutGraph(forkMergeRequest)
    const forkPos = new Map(forkMerge.positions.map((position) => [position.id, position]))
    assert.equal(forkPos.get('chat-a')!.x, forkPos.get('chat-b')!.x, 'fork 汇聚图的 fork 边两端必须同列')
  })

  test(`约束层[${algorithm}]：列钉定下锚点固定、无硬重叠、确定性`, async () => {
    const request = forkMergeFixture()
    const turns = request.nodes.find((node) => node.id === 'turns')!
    turns.pinned = true
    turns.x = 1200
    turns.y = 800
    const paper = request.nodes.find((node) => node.id === 'paper')!
    paper.selected = false
    paper.x = 1600
    paper.y = 200
    request.algorithm = algorithm
    const first = await layoutGraph(request)
    const second = await layoutGraph(request)
    // 确定性
    assert.deepEqual(first.positions, second.positions)
    assert.deepEqual(first.orientations, second.orientations)
    // 锚点（pinned / selected=false）保持输入位置，不参与列钉定
    assert.deepEqual(first.positions.find((position) => position.id === 'turns'), { id: 'turns', x: 1200, y: 800 })
    assert.deepEqual(first.positions.find((position) => position.id === 'paper'), { id: 'paper', x: 1600, y: 200 })
    // 无硬重叠（含锚点在内的全对 gap ≥ 1px）
    assert.ok(minPairwiseGap(request, first.positions) >= 1, `hard overlap: min gap = ${minPairwiseGap(request, first.positions).toFixed(3)}px`)
  })
}

// ── 紧凑树引擎（ELK mrtree + 列约束，默认算法）专属 ───────────────────────

test('mrtree 布局全对不硬重叠（gap ≥ 1px）且放置所有节点', async () => {
  const request = forkMergeFixture()
  const result = await layoutGraph(request)
  assert.equal(result.engine, 'elk', `engine: ${result.engine} warning: ${result.warning ?? ''}`)
  assertAllPlaced(request, result.positions)
  assertMinGap(request, result.positions, 1)
  assert.ok(result.report !== undefined)
  assert.equal(result.report.overlaps, 0, `report overlaps: ${JSON.stringify(result.report)}`)
  // 40 节点链
  const chain = fixture(40)
  const chainResult = await layoutGraph(chain)
  assert.equal(chainResult.engine, 'elk', `engine: ${chainResult.engine} warning: ${chainResult.warning ?? ''}`)
  assertAllPlaced(chain, chainResult.positions)
  assertNoOverlap(chain, chainResult.positions)
})

test('mrtree 引擎列分配单测：同列内按 ELK y 顺序堆叠、x 全等，锚点/折叠子节点不入列', () => {
  const request: ChatGraphLayoutRequest = {
    nodes: [
      { id: 'n-a', x: 0, y: 0, width: 100, height: 50, kind: 'chat', createdAt: 1 },
      { id: 'n-b', x: 0, y: 0, width: 120, height: 60, kind: 'chat', createdAt: 2 },
      { id: 'n-c', x: 0, y: 0, width: 100, height: 50, kind: 'chat', createdAt: 3 },
      { id: 'm-a', x: 0, y: 0, width: 90, height: 40, kind: 'memory', createdAt: 4 },
      { id: 'anchor', x: 500, y: 500, width: 100, height: 50, kind: 'memory', createdAt: 5, pinned: true },
      { id: 'hidden', x: 0, y: 0, width: 100, height: 50, kind: 'chat', groupId: 'g', createdAt: 6 },
    ],
    edges: [],
  }
  // 模拟 mrtree 输出：n-b 与 n-c 的 ELK y 相同（稳定 tie-break 按 id：n-b 在前），n-a 最下
  const elkPositions = new Map([
    ['n-a', { x: 300, y: 200 }],
    ['n-b', { x: 300, y: 50 }],
    ['n-c', { x: 300, y: 50 }],
    ['m-a', { x: 40, y: 60 }],
    ['anchor', { x: 900, y: 900 }],
    ['hidden', { x: 300, y: 300 }],
  ])
  const assignment = applyColumnConstraints(request, elkPositions, new Map([['g', 'group:g']]))
  // 锚点与折叠子节点不入列（keyOf/positionOf 均不含）
  assert.equal(assignment.keyOf.size, 4)
  assert.ok(!assignment.keyOf.has('anchor'))
  assert.ok(!assignment.keyOf.has('hidden'))
  assert.ok(!assignment.positionOf.has('anchor'))
  assert.ok(!assignment.positionOf.has('hidden'))
  // 列序：同 depth 按 kind 名（chat@0 → memory@0）
  assert.deepEqual(assignment.columnOrder, ['chat@0', 'memory@0'])
  // 列宽 = 该列最大节点宽（chat 列 120），列间距 48px
  assert.equal(assignment.columnX.get('chat@0'), 0)
  assert.equal(assignment.columnX.get('memory@0'), 120 + COLUMN_GAP)
  // 列内按 ELK y 升序堆叠，同 y 按 id：n-b → n-c → n-a；行距 = 上一节点高 + 48px
  assert.equal(assignment.rankOf.get('n-b'), 0)
  assert.equal(assignment.rankOf.get('n-c'), 1)
  assert.equal(assignment.rankOf.get('n-a'), 2)
  assert.equal(assignment.positionOf.get('n-b')!.y, 0)
  assert.equal(assignment.positionOf.get('n-c')!.y, 60 + ROW_GAP)
  assert.equal(assignment.positionOf.get('n-a')!.y, 60 + ROW_GAP + 50 + ROW_GAP)
  // 同键 x 完全相等，且等于本列的列 x
  assert.equal(assignment.positionOf.get('n-a')!.x, assignment.positionOf.get('n-b')!.x)
  assert.equal(assignment.positionOf.get('n-b')!.x, assignment.positionOf.get('n-c')!.x)
  assert.equal(assignment.positionOf.get('n-b')!.x, assignment.columnX.get('chat@0'))
  assert.equal(assignment.positionOf.get('m-a')!.x, assignment.columnX.get('memory@0'))
})

test('约束 1+2（compact-tree 数值）：跨深度链列间距逐列恰为 列宽+48px', async () => {
  const request = crossDepthFixture()
  request.algorithm = 'tree'
  const result = await layoutGraph(request)
  assert.equal(result.candidate, 'compact-tree')
  const posById = new Map(result.positions.map((position) => [position.id, position]))
  // 同类型不同深度 → 相邻列（保流向的必然），列间距恰为 48px（列宽 = memory 220 / chat 230 / memory 210）
  assert.equal(posById.get('mid-chat')!.x - posById.get('src-memory')!.x, 220 + COLUMN_GAP)
  assert.equal(posById.get('ledger-memory')!.x - posById.get('mid-chat')!.x, 230 + COLUMN_GAP)
  assert.equal(posById.get('down-chat')!.x - posById.get('ledger-memory')!.x, 210 + COLUMN_GAP)
})

// ── 有向分层引擎（dagre tight-tree）专属 ─────────────────────────────────

test('dagre：7 节点分叉汇聚图正常布局、同列内按 dagre y 序堆叠、行间距恰为 48px', async () => {
  const request = forkMergeFixture()
  request.algorithm = 'dagre'
  const result = await layoutGraph(request)
  assert.equal(result.engine, 'elk', `engine: ${result.engine} warning: ${result.warning ?? ''}`)
  assert.equal(result.candidate, 'dagre-layered')
  assert.ok(result.report !== undefined)
  assert.equal(result.positions.length, request.nodes.length, '每个节点都必须被放置')
  assertNoOverlap(request, result.positions)
  // memory@0 列内 5 节点自上而下堆叠，相邻 y 差 = 上方节点高 + 48
  const depths = flowDepths(request.nodes, request.edges)
  const posById = new Map(result.positions.map((position) => [position.id, position]))
  const memoryStack = request.nodes
    .filter((node) => flowColumnKey(node, depths.get(node.id) ?? 0) === 'memory@0')
    .map((node) => ({ node, y: posById.get(node.id)!.y }))
    .sort((a, b) => a.y - b.y)
  assert.equal(memoryStack.length, 5)
  for (let i = 1; i < memoryStack.length; i += 1) {
    assert.equal(memoryStack[i]!.y - memoryStack[i - 1]!.y, memoryStack[i - 1]!.node.height + ROW_GAP, `memory@0 列内第 ${i} 行间距必须恰为 48px`)
  }
  const chatYs = ['chat-a', 'chat-b'].map((id) => posById.get(id)!.y).sort((a, b) => a - b)
  assert.equal(chatYs[1]! - chatYs[0]!, 130 + ROW_GAP)
})

test('dagre：40 节点链正常布局（全部放置、无硬重叠、坐标非负）', async () => {
  const request = fixture(40)
  request.algorithm = 'dagre'
  const result = await layoutGraph(request)
  assert.equal(result.engine, 'elk', `engine: ${result.engine} warning: ${result.warning ?? ''}`)
  assert.equal(result.candidate, 'dagre-layered')
  assert.equal(result.positions.length, 40)
  assertNoOverlap(request, result.positions)
  for (const position of result.positions) {
    assert.ok(position.x >= 0 && position.y >= 0, `${position.id} 坐标必须非负: ${position.x},${position.y}`)
  }
  assert.ok(result.report !== undefined)
})

// ── 约束松弛引擎（nodelayout 约束迭代）专属 ───────────────────────────────

test('relax：40 节点链在有限时间内收敛完成（两轮迭代 + snap）', async () => {
  const request = fixture(40)
  request.algorithm = 'relax'
  const started = performance.now()
  const result = await layoutGraph(request)
  const elapsed = performance.now() - started
  assert.equal(result.engine, 'elk')
  assert.equal(result.candidate, 'flow-relax')
  assert.equal(result.positions.length, 40)
  assert.ok(result.report !== undefined)
  assert.ok(result.routes.length === 0, '引擎不产生拐点路由（单段贝塞尔）')
  // 迭代收敛（500 迭代上限 × 两轮）的宽松 CI 守卫，不是微基准
  assert.ok(elapsed < 5_000, `40-node chain layout took ${Math.round(elapsed)}ms`)
})

test('relax：纯源列 x < 纯汇列 x（memory 源 → 2 chat → 台账 memory → chat 汇）', async () => {
  const request: ChatGraphLayoutRequest = {
    nodes: [
      { id: 'source', x: 0, y: 0, width: 220, height: 96, kind: 'memory', createdAt: 1 },
      { id: 'chat-a', x: 0, y: 0, width: 230, height: 130, kind: 'chat', createdAt: 2 },
      { id: 'chat-b', x: 0, y: 0, width: 230, height: 130, kind: 'chat', createdAt: 3 },
      { id: 'ledger', x: 0, y: 0, width: 220, height: 96, kind: 'memory', createdAt: 4 },
      { id: 'chat-c', x: 0, y: 0, width: 230, height: 130, kind: 'chat', createdAt: 5 },
    ],
    edges: [
      { id: 'e-sa', from: 'source', to: 'chat-a', toPort: 'memory', behavior: 'reference' },
      { id: 'e-sb', from: 'source', to: 'chat-b', toPort: 'memory', behavior: 'reference' },
      { id: 'e-al', from: 'chat-a', to: 'ledger', toPort: 'memory', behavior: 'reference' },
      { id: 'e-bl', from: 'chat-b', to: 'ledger', toPort: 'memory', behavior: 'reference' },
      { id: 'e-lc', from: 'ledger', to: 'chat-c', toPort: 'memory', behavior: 'reference' },
    ],
    algorithm: 'relax',
  }
  const result = await layoutGraph(request)
  assert.equal(result.engine, 'elk')
  assert.equal(result.candidate, 'flow-relax')
  // 纯源：source 入度 0；纯汇：chat-c 出度 0
  assert.ok(!request.edges.some((edge) => edge.to === 'source'), 'source 应为纯源（入度 0）')
  assert.ok(!request.edges.some((edge) => edge.from === 'chat-c'), 'chat-c 应为纯汇（出度 0）')
  const pos = (id: string) => result.positions.find((position) => position.id === id)!
  assert.ok(pos('source').x < pos('ledger').x, `纯源 x ${pos('source').x} 应 < 台账 x ${pos('ledger').x}`)
  assert.ok(pos('ledger').x < pos('chat-c').x, `台账 x ${pos('ledger').x} 应 < 纯汇 x ${pos('chat-c').x}`)
})

// ── 分组 / 折叠（三引擎一致）──────────────────────────────────────────────

for (const { algorithm, candidate } of ALGORITHMS) {
  test(`分组[${algorithm}]：复合边界保持稳定、折叠节点保持锚定`, async () => {
    const request: ChatGraphLayoutRequest = {
      nodes: [
        { id: 'idea-a', x: 0, y: 0, width: 180, height: 76, groupId: 'explore', createdAt: 1 },
        { id: 'idea-b', x: 220, y: 0, width: 180, height: 76, groupId: 'explore', createdAt: 2 },
        { id: 'run-a', x: 0, y: 600, width: 180, height: 76, groupId: 'experiment', createdAt: 3 },
        { id: 'chat', x: 460, y: 80, width: 180, height: 76, createdAt: 4 },
      ],
      groups: [
        { id: 'explore', title: '探索组', createdAt: 1 },
        { id: 'experiment', title: '实验组', collapsed: true, x: 20, y: 560, createdAt: 2 },
      ],
      edges: [
        { id: 'idea-edge', from: 'idea-a', to: 'chat', toPort: 'context', behavior: 'fork' },
        { id: 'run-edge', from: 'run-a', to: 'chat', toPort: 'memory', behavior: 'reference' },
      ],
      algorithm,
    }
    const result = await layoutGraph(request)
    assert.equal(result.engine, 'elk', `engine: ${result.engine} warning: ${result.warning ?? ''}`)
    assert.equal(result.candidate, candidate)
    assert.ok((result.groupPositions ?? []).some((group) => group.id === 'group:explore'))
    assert.ok((result.groupPositions ?? []).some((group) => group.id === 'group:experiment'))
    // 折叠组子节点是锚：位置原样
    assert.deepEqual(result.positions.find((position) => position.id === 'run-a'), { id: 'run-a', x: 0, y: 600 })
    assertAllPlaced(request, result.positions)
    assertNoOverlap(request, result.positions)
  })
}

// ── 兜底与共享环语义 ─────────────────────────────────────────────────────

test('fallback layout is deterministic, anchored, and non-overlapping', () => {
  const request = fixture(40)
  request.nodes[0]!.pinned = true
  request.nodes[0]!.x = 920
  request.nodes[0]!.y = 240
  request.nodes[1]!.selected = false
  request.nodes[1]!.x = 1180
  request.nodes[1]!.y = 240
  const first = fallbackLayout(request)
  const second = fallbackLayout(request)
  assert.deepEqual(first, second)
  assert.deepEqual(first[0], { id: 'n0000', x: 920, y: 240 })
  assert.deepEqual(first[1], { id: 'n0001', x: 1180, y: 240 })
  assertNoOverlap(request, first)
})

test('约束①环语义（共享 flowDepth）：SCC 缩点后环成员同深度、下游 +1，且与输入顺序无关', () => {
  const nodes = [
    { id: 'a', x: 0, y: 0, width: 176, height: 76 },
    { id: 'b', x: 0, y: 0, width: 176, height: 76 },
    { id: 's', x: 0, y: 0, width: 176, height: 76 },
    { id: 't', x: 0, y: 0, width: 176, height: 76 },
  ]
  const edges = [
    { id: 'e1', from: 's', to: 'a', toPort: 'memory' as const, behavior: 'write' as const },
    { id: 'e2', from: 'a', to: 'b', toPort: 'memory' as const, behavior: 'reference' as const },
    { id: 'e3', from: 'b', to: 'a', toPort: 'memory' as const, behavior: 'reference' as const },
    { id: 'e4', from: 'b', to: 't', toPort: 'memory' as const, behavior: 'reference' as const },
  ]
  const depths = flowDepths(nodes, edges)
  assert.equal(depths.get('s'), 0)
  assert.equal(depths.get('a'), 1, '环成员 a 与 b 同深度（SCC 缩点）')
  assert.equal(depths.get('b'), 1, '环成员 b 与 a 同深度（SCC 缩点）')
  assert.equal(depths.get('t'), 2, '环下游深度 = 环深度 + 1')
  // 输入顺序无关：环的打破不再依赖 DFS 起点顺序
  const shuffled = flowDepths([nodes[2]!, nodes[0]!, nodes[3]!, nodes[1]!], [...edges].reverse())
  assert.deepEqual([...shuffled.entries()], [...depths.entries()])
})

// ── A* 智能布线（画布实时引用的导出，三算法共享渲染层）────────────────────

test('A* 智能布线与弓形搜索：锚定障碍图上单段弓形可绕开、航路点不穿节点', () => {
  // v9：A* 移至画布实时执行（连线=位置的连续函数，不持久化路由）。
  // v10：画布不再渲染折线——撞节点边首选「弓形搜索」单段贝塞尔（directCurveHits + bow
  // 逐候选验证，端口切线恒水平），弓形全部失败才用 A* 航路 + Catmull-Rom 样条。
  // 本测试验证两级避障的几何基础。
  // 锚定障碍图：直连必撞墙 → directCurveHits 命中
  const rects = [
    { id: 'a', x: 0, y: 40, width: 200, height: 96, kind: 'chat' as const },
    { id: 'wall', x: 300, y: 60, width: 150, height: 40, kind: 'memory' as const },
    { id: 'b', x: 550, y: 40, width: 200, height: 96, kind: 'chat' as const },
  ]
  const rectMap = new Map(rects.map((rect) => [rect.id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }]))
  const from = portAnchor({ x: rects[0]!.x, y: rects[0]!.y, width: rects[0]!.width, height: rects[0]!.height }, 'chat', 'out')
  const to = portAnchor({ x: rects[2]!.x, y: rects[2]!.y, width: rects[2]!.width, height: rects[2]!.height }, 'chat', 'in', 'context')
  // 前置：直连确实撞墙（否则本 fixture 无意义）
  assert.equal(directCurveHits(from, to, rects, 'a', 'b'), true, 'straight curve must hit the wall node')
  // 第 2 级契约：画布弓形搜索的候选序列（base = |dy|/2 + 40 的 0.5~4 倍，夹 [24, 600]，
  // 按 (|bow|, bow) 升序）里必有一个 bow 让单段贝塞尔完全不穿墙
  const bowBase = Math.abs(to.y - from.y) * 0.5 + 40
  const bowCandidates = [...new Set(
    [0.5, 1, 1.5, 2, 3, 4].flatMap((factor) => {
      const magnitude = Math.min(600, Math.max(24, bowBase * factor))
      return [-magnitude, magnitude]
    }),
  )].sort((x, y) => Math.abs(x) - Math.abs(y) || x - y)
  const clearing = bowCandidates.find((bow) => !directCurveHits(from, to, rects, 'a', 'b', bow))
  assert.ok(clearing !== undefined, `bow search must clear the wall (candidates: ${bowCandidates.map((bow) => bow.toFixed(1)).join(', ')})`)
  // 第 3 级契约：A* 航路点本身不穿墙节点（拐点抽稀与样条拟合的输入）
  const poly = routeWithAstarPoints(from, to, 'context', rectMap, 'chat', 'chat')
  assert.ok(poly !== undefined && poly.length >= 2, 'A* must route around the wall')
  for (const point of poly) {
    const inside = point.x > rects[1]!.x - 2 && point.x < rects[1]!.x + rects[1]!.width + 2
      && point.y > rects[1]!.y - 2 && point.y < rects[1]!.y + rects[1]!.height + 2
    assert.ok(!inside, `A* path point (${point.x},${point.y}) passes through wall`)
  }
  // smoothPolyline（worker 导出保留）对航路折线仍可用；画布已不再渲染折线路径
  assert.ok(smoothPolyline(poly).startsWith('M '), 'smoothPolyline stays usable for the route')
})

// ── 曲线形态契约（三引擎共享渲染几何）────────────────────────────────────

test('曲线形态契约：单段三次贝塞尔、端口处切线水平（控制点与端口共 y）', async () => {
  // v10：一切连线（含撞节点绕行）的渲染形态都是平滑贝塞尔，端口切线水平——
  // 布局给出的每个 orientation 叠加 edgeCurve 后必须满足：控制点在端口外侧（切线
  // 沿端口法向水平伸出）、控制点 y = 端口 y + bow（bow 只平移控制点、不改切线方向）。
  const request = fixture(12)
  const result = await layoutGraph(request)
  assert.equal(result.engine, 'elk', `engine: ${result.engine} warning: ${result.warning ?? ''}`)
  const posById = new Map(result.positions.map((position) => [position.id, position]))
  for (const orientation of result.orientations ?? []) {
    assert.equal(orientation.source, 'right', `${orientation.id} 右出`)
    assert.equal(orientation.target, 'left', `${orientation.id} 左进`)
    const edge = request.edges.find((item) => item.id === orientation.id)!
    const s = posById.get(edge.from)!
    const t = posById.get(edge.to)!
    const sn = request.nodes.find((node) => node.id === edge.from)!
    const tn = request.nodes.find((node) => node.id === edge.to)!
    const outY = s.y + sn.height / 2
    const inY = t.y + tn.height / 2
    const bow = orientation.bow ?? 0
    const c = edgeCurve(s.x + sn.width, outY, 'right', t.x, inY, 'left', bow)
    assert.ok(c.c1x > s.x + sn.width, `${orientation.id} 起点控制点在端口右侧 → 起点切线水平`)
    assert.ok(c.c2x < t.x, `${orientation.id} 终点控制点在端口左侧 → 终点切线水平`)
    assert.equal(c.c1y, outY + bow, `${orientation.id} 起点控制点与端口共 y（含 bow 平移）→ 切线水平`)
    assert.equal(c.c2y, inY + bow, `${orientation.id} 终点控制点与端口共 y（含 bow 平移）→ 切线水平`)
  }
})

// ── 性能守卫（宽松 CI 上限，不是微基准）──────────────────────────────────

for (const count of [100, 300, 600]) {
  test(`layout performance (compact-tree): ${count} nodes`, async () => {
    const request = fixture(count)
    request.algorithm = 'tree'
    const started = performance.now()
    const result = await layoutGraph(request)
    const elapsed = performance.now() - started
    assert.equal(result.positions.length, count)
    assertAllPlaced(request, result.positions)
    assertNoOverlap(request, result.positions)
    assert.ok(elapsed < 15_000, `${count}-node layout took ${Math.round(elapsed)}ms`)
  })
}

test('layout performance (dagre): 600 nodes', async () => {
  const request = fixture(600)
  request.algorithm = 'dagre'
  const started = performance.now()
  const result = await layoutGraph(request)
  const elapsed = performance.now() - started
  assert.equal(result.positions.length, 600)
  assertNoOverlap(request, result.positions)
  assert.ok(elapsed < 15_000, `600-node dagre layout took ${Math.round(elapsed)}ms`)
})
