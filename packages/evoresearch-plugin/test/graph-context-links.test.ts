import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { LinkResolver } from '../src/host/context/link-resolver.js'
import { ContextAssembler } from '../src/host/context/assembler.js'
import { ChatGraphService, normalizeGraph } from '../src/host/chat-graph.js'

test('LinkResolver resolves inline, internal and sidecar links with bounds', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-link-test-'))
  const workspace = path.join(root, 'project')
  fs.mkdirSync(path.join(workspace, 'results'), { recursive: true })
  fs.writeFileSync(path.join(workspace, 'results', 'metrics.csv'), 'accuracy,0.91\n', 'utf8')
  try {
    const resolver = new LinkResolver(root)
    const links = resolver.mergeSidecar(
      '[metrics](results/metrics.csv) [chat](chat:session-1) https://example.com',
      [{ label: 'same metrics', target: 'results/metrics.csv', kind: 'result' }],
      { workspaceDir: workspace, maxTargets: 8 },
    )
    assert.equal(links.length, 3)
    assert.equal(new Set(links.map((link) => link.locator)).size, 3)
    const local = links.find((link) => link.target === 'results/metrics.csv')!
    assert.equal(local.exists, true)
    assert.match(resolver.read(local, 'graph:m').text, /0\.91/)
    const escaped = resolver.resolveText('[escape](../outside.txt)', { workspaceDir: workspace })[0]!
    assert.equal(escaped.exists, false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('ContextAssembler follows a relevant Memory link and exposes trace', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-context-link-'))
  const workspace = path.join(root, 'project')
  fs.mkdirSync(path.join(workspace, 'experiments'), { recursive: true })
  fs.writeFileSync(path.join(workspace, 'experiments', 'failed.log'), 'OOM after batch 8\n', 'utf8')
  const graph = {
    nodes: [
      { id: 'chat', type: 'chat' as const, title: 'chat', x: 0, y: 0, sessionId: 's1' },
      { id: 'memory', type: 'memory' as const, title: 'memory', x: 200, y: 0, content: '实验失败复盘见 [训练日志](experiments/failed.log)。' },
    ],
    edges: [{ id: 'e1', from: 'memory', to: 'chat', toPort: 'memory' as const, behavior: 'reference' as const }],
  }
  try {
    const assembler = new ContextAssembler({
      dataRoot: root,
      store: {
        searchTurnsFts: () => [], searchObservationsFts: () => [], listTurns: () => [], getTurn: () => undefined, listSegments: () => [],
      },
      notes: { searchIndex: () => [], readAllBackgroundDocs: () => ({}) },
      chatGraph: { get: () => graph },
      recentChatText: () => '',
      previewOf: () => ({ ok: false }),
    })
    const result = await assembler.assemble({ sessionId: 's1', projectName: 'project', workspaceDir: workspace, userQuestion: '实验失败日志原因' })
    assert.match(result.text, /OOM after batch 8/)
    assert.equal(result.linkTrace.length, 1)
    assert.equal(result.linkTrace[0]?.opened, true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resource Memory nodes participate in context while relation edges stay inert', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-resource-memory-'))
  const workspace = path.join(root, 'project')
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, 'evidence.md'), 'resource evidence', 'utf8')
  const graph = {
    nodes: [
      { id: 'chat', type: 'chat' as const, title: 'chat', x: 0, y: 0, sessionId: 's1' },
      { id: 'resource', type: 'resource' as const, displayKind: 'memory' as const, title: 'resource memory', x: 200, y: 0, ref: { kind: 'file' as const, path: 'evidence.md' } },
      { id: 'relation', type: 'resource' as const, displayKind: 'file' as const, title: 'relation only', x: 200, y: 100, content: 'must not be injected' },
    ],
    edges: [
      { id: 'reference', from: 'resource', to: 'chat', toPort: 'memory' as const, behavior: 'reference' as const },
      { id: 'relation', from: 'relation', to: 'chat', toPort: 'memory' as const, behavior: 'relation' as const, enabled: false },
    ],
  }
  try {
    const assembler = new ContextAssembler({
      dataRoot: root,
      store: { searchTurnsFts: () => [], searchObservationsFts: () => [], listTurns: () => [], getTurn: () => undefined, listSegments: () => [] },
      notes: { searchIndex: () => [], readAllBackgroundDocs: () => ({}) },
      chatGraph: { get: () => graph },
      recentChatText: () => '',
      previewOf: (node, dir) => {
        const file = path.join(dir ?? workspace, node.ref?.path ?? '')
        return { ok: fs.existsSync(file), text: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined }
      },
    })
    const result = await assembler.assemble({ sessionId: 's1', projectName: 'project', workspaceDir: workspace, userQuestion: 'resource evidence' })
    assert.match(result.text, /resource evidence/)
    assert.doesNotMatch(result.text, /must not be injected/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('ChatGraph incremental operations are idempotent and preserve groups', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-graph-ops-'))
  try {
    const service = new ChatGraphService(root)
    const node = service.addNode('project', { type: 'chat', title: 'chat', x: 0, y: 0, sessionId: 's1' })
    const group = { id: 'g1', title: '探索', kind: 'exploration' as const }
    assert.equal(service.addGroup('project', group).ok, true)
    assert.equal(service.updateNode('project', node.id, { groupId: 'g1' }).ok, true)
    const result = service.applyOperation('move-1', () => service.moveNodes('project', [{ id: node.id, x: 32, y: 48, pinned: true }]))
    assert.deepEqual(service.applyOperation('move-1', () => ({ ok: false })), result)
    const current = service.get('project')
    assert.equal(current.nodes.find((item) => item.id === node.id)?.x, 32)
    assert.equal(current.groups?.[0]?.id, 'g1')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('layoutCurated 人工策展标志：moveNodes 置位、normalize/save 往返保留', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-graph-curated-'))
  try {
    const service = new ChatGraphService(root)
    const node = service.addNode('project', { type: 'chat', title: 'chat', x: 0, y: 0, sessionId: 's1' })
    // 新图未策展
    assert.notEqual(service.get('project').layoutCurated, true)
    // 人工拖拽 = 置位策展
    service.moveNodes('project', [{ id: node.id, x: 100, y: 120 }])
    assert.equal(service.get('project').layoutCurated, true)
    // 持久化往返（新实例重读磁盘）后标志仍在
    const reloaded = new ChatGraphService(root)
    assert.equal(reloaded.get('project').layoutCurated, true)
    // normalizeGraph 保留 true；false/缺省不写入
    const saved = reloaded.get('project')
    const normalized = normalizeGraph({ ...saved, layoutCurated: true })
    assert.equal(normalized.layoutCurated, true)
    const uncurated = normalizeGraph({ nodes: [{ ...node, x: 5, y: 5 }], edges: [] })
    assert.notEqual(uncurated.layoutCurated, true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
