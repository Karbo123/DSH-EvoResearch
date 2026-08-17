import test from 'node:test'
import assert from 'node:assert/strict'
import { fallbackLayout, inspectLayout, layoutGraph, type ChatGraphLayoutRequest, type LayoutNodeInput } from '../src/client/chatgraph-layout-worker'

const WIDTH = 176
const HEIGHT = 76

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

function assertNoOverlap(request: ChatGraphLayoutRequest, positions: Array<{ id: string; x: number; y: number }>): void {
  const byId = new Map(request.nodes.map((node) => [node.id, node]))
  for (let i = 0; i < positions.length; i += 1) {
    const a = positions[i]
    const an = byId.get(a.id)
    assert.ok(an)
    for (let j = i + 1; j < positions.length; j += 1) {
      const b = positions[j]
      const bn = byId.get(b.id)
      assert.ok(bn)
      const separated = a.x + an.width + 8 <= b.x || b.x + bn.width + 8 <= a.x || a.y + an.height + 8 <= b.y || b.y + bn.height + 8 <= a.y
      assert.ok(separated, `overlap: ${a.id} / ${b.id}`)
    }
  }
}

test('fallback layout is deterministic, anchored, and non-overlapping', () => {
  const request = fixture(40)
  request.nodes[0].pinned = true
  request.nodes[0].x = 920
  request.nodes[0].y = 240
  request.nodes[1].selected = false
  request.nodes[1].x = 1180
  request.nodes[1].y = 240
  const first = fallbackLayout(request)
  const second = fallbackLayout(request)
  assert.deepEqual(first, second)
  assert.deepEqual(first[0], { id: 'n0000', x: 920, y: 240 })
  assert.deepEqual(first[1], { id: 'n0001', x: 1180, y: 240 })
  assertNoOverlap(request, first)
})

test('ELK layout preserves pinned and unselected anchors', async () => {
  const request = fixture(18)
  request.nodes[0].pinned = true
  request.nodes[0].x = 700
  request.nodes[0].y = 120
  request.nodes[17].selected = false
  request.nodes[17].x = 1400
  request.nodes[17].y = 360
  const result = await layoutGraph(request)
  assert.ok(result.engine === 'elk' || result.engine === 'fallback')
  assert.deepEqual(result.positions.find((position) => position.id === 'n0000'), { id: 'n0000', x: 700, y: 120 })
  assert.deepEqual(result.positions.find((position) => position.id === 'n0017'), { id: 'n0017', x: 1400, y: 360 })
  assertNoOverlap(request, result.positions)
})

for (const count of [100, 200, 300, 600]) {
  test(`layout performance: ${count} nodes`, async () => {
    const request = fixture(count)
    const started = performance.now()
    const result = await layoutGraph(request)
    const elapsed = performance.now() - started
    assert.equal(result.positions.length, count)
    assertNoOverlap(request, result.positions)
    // This is an intentionally generous CI guard, not a micro-benchmark.
    assert.ok(elapsed < 15_000, `${count}-node layout took ${Math.round(elapsed)}ms`)
  })
}

test('layout routes references near chats and audits parallel edges and labels', async () => {
  const request: ChatGraphLayoutRequest = {
    nodes: [
      { id: 'chat-a', x: 0, y: 0, width: 220, height: 96, createdAt: 1 },
      { id: 'chat-b', x: 0, y: 0, width: 220, height: 96, createdAt: 2 },
      { id: 'paper', x: 0, y: 0, width: 220, height: 96, createdAt: 3 },
    ],
    edges: [
      { id: 'fork', from: 'chat-a', to: 'chat-b', toPort: 'context', behavior: 'fork' },
      { id: 'reference', from: 'paper', to: 'chat-b', toPort: 'memory', behavior: 'reference', label: '关键论文与方法对照' },
      { id: 'relation', from: 'chat-a', to: 'chat-b', toPort: 'memory', behavior: 'relation', label: '普通研究关系' },
    ],
  }
  const result = await layoutGraph(request)
  const report = inspectLayout(request, result)
  assert.ok(result.routes?.every((route) => route.points.length >= 2))
  assert.equal(report.nodeOverlaps.length, 0)
  assert.equal(report.routeNodeHits.length, 0)
  assert.equal(report.labelCollisions.length, 0)
  assert.ok(result.routes?.find((route) => route.id === 'reference')?.labelPosition !== undefined)
})

test('compound exploration and experiment groups produce stable bounds and collapsed nodes', async () => {
  const request: ChatGraphLayoutRequest = {
    nodes: [
      { id: 'idea-a', x: 0, y: 0, width: 180, height: 76, groupId: 'explore', createdAt: 1 },
      { id: 'idea-b', x: 220, y: 0, width: 180, height: 76, groupId: 'explore', createdAt: 2 },
      { id: 'run-a', x: 0, y: 180, width: 180, height: 76, groupId: 'experiment', createdAt: 3 },
      { id: 'chat', x: 460, y: 80, width: 180, height: 76, createdAt: 4 },
    ],
    groups: [
      { id: 'explore', title: '探索组', kind: 'exploration', createdAt: 1 },
      { id: 'experiment', title: '实验组', kind: 'experiment', collapsed: true, x: 20, y: 240, createdAt: 2 },
    ],
    edges: [
      { id: 'idea-edge', from: 'idea-a', to: 'chat', toPort: 'context', behavior: 'fork' },
      { id: 'run-edge', from: 'run-a', to: 'chat', toPort: 'memory', behavior: 'reference' },
    ],
  }
  const result = await layoutGraph(request)
  assert.ok((result.groupPositions ?? []).some((group) => group.id === 'group:explore'))
  assert.ok((result.groupPositions ?? []).some((group) => group.id === 'group:experiment'))
  assert.deepEqual(result.positions.find((position) => position.id === 'run-a'), { id: 'run-a', x: 0, y: 180 })
  const report = inspectLayout(request, result)
  assert.equal(report.nodeOverlaps.length, 0)
})
