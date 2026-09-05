/**
 * Chat Graph v4 测试（TODO-chatgraph v3.1 Phase 1+2+3 后端契约）。
 *
 * 覆盖：
 * - schemaVersion 3→4 迁移：resource 并入 memory、relation 边转 reference 读线
 *  （保留 label、enabled 置 true）、坐标/分组/标签保留、幂等、旧图与 _global_.json
 *   打开不报错、迁移本身不产生墓碑；
 * - 墓碑（§6.3）：graph-save 时服务端 diff——消失的节点/边写入墓碑；自动同步
 *   前置检查（tombstoneHasNode/Edge）；restoreTombstones 清空；重新出现的键自动清墓碑；
 * - 节点唯一复用（§4.3）：addNode 按 locator 判重（chat/memory 均适用）；
 * - 写线（§5.2）：addEdge 按 from|to|behavior|system 判重、支持 behavior 'write'；
 *   upsertWriteEdge 累加 writeCount/lastWriteAt；appendMemorySection 带时间戳小节
 *   追加不覆盖（ref 原文 frontmatter 保留）；
 * - 自动同步（§6.1）：新会话首条真人消息 → chat 节点 + 常驻节点（画像/指引/台账，
 *   empty 实时计算）+ 默认连线（system: true）；写工具 → 事实写线；turn/end →
 *   台账写线 bump；会话删除 → 摘除节点 + 墓碑（不再补种）；
 * - 检索命中环形缓冲（≤100，同会话同节点 5s 内去重）。
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  CHAT_GRAPH_SCHEMA_VERSION,
  ChatGraphService,
  PERSISTENT_NODE_LOCATORS,
  chatNodeLocator,
  edgeKeyOf,
} from '../src/host/chat-graph.js'
import type { ChatGraph } from '../src/host/chat-graph.js'
import { ChatGraphSyncService } from '../src/host/chat-graph-sync.js'
import type { Context } from '@deepseek-ai/cordis'

// 测试卫生：登记临时目录，文件级结束后统一清理（含失败路径）。
const tmpDirs: string[] = []
function trackTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}
after(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // 清理失败不阻断测试结论
    }
  }
})

/** 直接写一个旧版（v3）图文件到 graphs 目录。 */
function writeV3Graph(dataRoot: string, projectName: string, graph: Record<string, unknown>): void {
  const dir = path.join(dataRoot, 'plugins', 'chat-graphs')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${projectName}.json`), JSON.stringify(graph, null, 2), 'utf8')
}

/** 最小假 cordis 上下文：只捕获 session/event 处理器。 */
function fakeCtx(): { ctx: Context; dispatch: (session: unknown, event: unknown) => void } {
  let handler: ((session: unknown, event: unknown) => void) | undefined
  const ctx = {
    on: (_name: string, fn: (session: unknown, event: unknown) => void) => {
      handler = fn
      return () => { handler = undefined }
    },
  } as unknown as Context
  return { ctx, dispatch: (session, event) => handler?.(session, event) }
}

// ── v3→v4 迁移 ──────────────────────────────────────────────────────────────

describe('ChatGraph v4：schemaVersion 3→4 迁移', () => {
  it('resource 并入 memory、relation 边转 reference（保留 label、enabled 置 true）、坐标保留', () => {
    const dataRoot = trackTmp('evoresearch-cgv4-mig-')
    writeV3Graph(dataRoot, 'demo', {
      schemaVersion: 3,
      nodes: [
        { id: 'c1', type: 'chat', title: '聊天', x: 11, y: 22, sessionId: 's1' },
        { id: 'r1', type: 'resource', displayKind: 'file', title: '资料', x: 33, y: 44, ref: { kind: 'file', path: 'a.txt' }, scope: 'project' },
      ],
      edges: [
        { id: 'e1', from: 'r1', to: 'c1', toPort: 'memory', behavior: 'relation', enabled: false, label: 'EA 实验资料' },
      ],
      groups: [{ id: 'g1', title: '组', kind: 'freeform' }],
    })
    const svc = new ChatGraphService(dataRoot)
    const graph = svc.get('demo')
    assert.equal(graph.schemaVersion, 4)
    const resource = graph.nodes.find((node) => node.id === 'r1')
    assert.equal(resource?.type, 'memory')
    assert.equal(resource?.displayKind, 'file')
    assert.equal(resource?.x, 33)
    assert.equal(resource?.y, 44)
    const edge = graph.edges.find((item) => item.id === 'e1')
    assert.equal(edge?.behavior, 'reference')
    assert.equal(edge?.enabled, true)
    assert.equal(edge?.label, 'EA 实验资料')
    assert.equal(graph.groups?.[0]?.id, 'g1')
  })

  it('迁移幂等：第二次 get 结果一致且不再改写文件', () => {
    const dataRoot = trackTmp('evoresearch-cgv4-idem-')
    writeV3Graph(dataRoot, 'demo', {
      schemaVersion: 3,
      nodes: [{ id: 'r1', type: 'resource', title: '资料', x: 1, y: 2, content: '正文', scope: 'project' }],
      edges: [],
    })
    const svc = new ChatGraphService(dataRoot)
    const first = svc.get('demo')
    const file = path.join(dataRoot, 'plugins', 'chat-graphs', 'demo.json')
    const afterFirst = fs.readFileSync(file, 'utf8')
    const second = svc.get('demo')
    assert.deepEqual(second, first)
    assert.equal(fs.readFileSync(file, 'utf8'), afterFirst)
  })

  it('旧图迁移不产生墓碑；_global_.json 旧数据打开不报错', () => {
    const dataRoot = trackTmp('evoresearch-cgv4-tomb-')
    writeV3Graph(dataRoot, 'demo', {
      schemaVersion: 3,
      nodes: [{ id: 'm1', type: 'memory', title: '记忆', x: 1, y: 2, content: '正文', scope: 'project' }],
      edges: [],
    })
    writeV3Graph(dataRoot, '_global_', {
      schemaVersion: 3,
      nodes: [{ id: 'g1', type: 'memory', title: '全局', x: 0, y: 0, content: 'SOUL', scope: 'global' }],
      edges: [],
    })
    const svc = new ChatGraphService(dataRoot)
    const graph = svc.get('demo')
    assert.equal(graph.schemaVersion, CHAT_GRAPH_SCHEMA_VERSION)
    assert.deepEqual(svc.tombstonesOf('demo'), { nodes: [], edges: [] })
    assert.equal(graph.nodes.some((node) => node.scope === 'global'), true)
  })
})

// ── 墓碑（§6.3）─────────────────────────────────────────────────────────────

describe('ChatGraph v4：墓碑 diff 与恢复', () => {
  it('graph-save diff：消失的节点写入墓碑（locator 优先），随节点消失的边不单独记墓碑', () => {
    const dataRoot = trackTmp('evoresearch-cgv4-node-')
    const svc = new ChatGraphService(dataRoot)
    const base: ChatGraph = {
      nodes: [
        { id: 'c1', type: 'chat', title: '聊天', x: 0, y: 0, sessionId: 's1', locator: chatNodeLocator('s1') },
        { id: 'm1', type: 'memory', title: '记忆', x: 1, y: 1, content: 'a', scope: 'project', locator: 'project:note:m1' },
      ],
      edges: [{ id: 'e1', from: 'm1', to: 'c1', toPort: 'memory', behavior: 'reference' }],
      schemaVersion: 4,
    }
    assert.deepEqual(svc.save('demo', base), { ok: true })
    // 删除 m1：其连线两端不再齐全 → 只记节点墓碑
    const withoutMemory: ChatGraph = { ...base, nodes: [base.nodes[0]!], edges: [] }
    assert.deepEqual(svc.save('demo', withoutMemory), { ok: true })
    const tombstones = svc.tombstonesOf('demo')
    assert.deepEqual(tombstones.nodes, ['project:note:m1'])
    assert.deepEqual(tombstones.edges, [])
    // 自动同步前置检查生效
    assert.equal(svc.tombstoneHasNode('demo', 'project:note:m1'), true)
    assert.equal(svc.tombstoneHasNode('demo', 'project:note:无'), false)
  })

  it('graph-save diff：两端仍在的边消失才记边墓碑；重新出现后墓碑自动清除', () => {
    const dataRoot = trackTmp('evoresearch-cgv4-edge-')
    const svc = new ChatGraphService(dataRoot)
    const c1 = { id: 'c1', type: 'chat' as const, title: '聊天', x: 0, y: 0, sessionId: 's1' }
    const m1 = { id: 'm1', type: 'memory' as const, title: '记忆', x: 1, y: 1, content: 'a', scope: 'project' as const }
    const m2 = { id: 'm2', type: 'memory' as const, title: '记忆2', x: 2, y: 2, content: 'b', scope: 'project' as const }
    const full: ChatGraph = {
      nodes: [c1, m1, m2],
      edges: [
        { id: 'e1', from: 'm1', to: 'c1', toPort: 'memory', behavior: 'reference' },
        { id: 'e2', from: 'm2', to: 'c1', toPort: 'memory', behavior: 'reference' },
      ],
      schemaVersion: 4,
    }
    assert.deepEqual(svc.save('demo', full), { ok: true })
    const dropOneEdge: ChatGraph = { ...full, edges: [full.edges[0]!] }
    assert.deepEqual(svc.save('demo', dropOneEdge), { ok: true })
    assert.deepEqual(svc.tombstonesOf('demo').edges, ['m2|c1|reference|0'])
    // 用户手动重建同一条边 → 该墓碑清除
    assert.deepEqual(svc.save('demo', full), { ok: true })
    assert.deepEqual(svc.tombstonesOf('demo').edges, [])
  })

  it('restoreTombstones 清空墓碑（不走 diff 回写）', () => {
    const dataRoot = trackTmp('evoresearch-cgv4-restore-')
    const svc = new ChatGraphService(dataRoot)
    const base: ChatGraph = {
      nodes: [
        { id: 'c1', type: 'chat', title: '聊天', x: 0, y: 0, sessionId: 's1' },
        { id: 'm1', type: 'memory', title: '记忆', x: 1, y: 1, content: 'a', scope: 'project' },
      ],
      edges: [],
      schemaVersion: 4,
    }
    assert.deepEqual(svc.save('demo', base), { ok: true })
    assert.deepEqual(svc.save('demo', { ...base, nodes: [base.nodes[0]!] }), { ok: true })
    assert.equal(svc.tombstonesOf('demo').nodes.length, 1)
    const restored = svc.restoreTombstones('demo')
    assert.deepEqual(restored, { restoredNodes: 1, restoredEdges: 0 })
    assert.deepEqual(svc.tombstonesOf('demo'), { nodes: [], edges: [] })
  })
})

// ── 判重与写线（§4.3/§5.2）──────────────────────────────────────────────────

describe('ChatGraph v4：节点唯一复用与写线', () => {
  it('addNode 按 locator 判重：chat 与 memory 节点都复用现有节点', () => {
    const dataRoot = trackTmp('evoresearch-cgv4-dup-')
    const svc = new ChatGraphService(dataRoot)
    const first = svc.addNode('demo', { type: 'chat', title: '聊天', x: 0, y: 0, sessionId: 's1', locator: chatNodeLocator('s1') })
    const second = svc.addNode('demo', { type: 'chat', title: '换个标题', x: 9, y: 9, sessionId: 's1', locator: chatNodeLocator('s1') })
    assert.equal(second.id, first.id)
    assert.equal(svc.get('demo').nodes.length, 1)
    const memFirst = svc.addNode('demo', { type: 'memory', title: '记忆', x: 1, y: 1, content: 'a', scope: 'project', locator: 'project:note:m1' })
    const memSecond = svc.addNode('demo', { type: 'memory', title: '重复', x: 5, y: 5, content: 'b', scope: 'project', locator: 'project:note:m1' })
    assert.equal(memSecond.id, memFirst.id)
  })

  it('addEdge 按 from|to|behavior|system 判重；write 写线可创建', () => {
    const dataRoot = trackTmp('evoresearch-cgv4-edge-dup-')
    const svc = new ChatGraphService(dataRoot)
    svc.addNode('demo', { type: 'chat', title: '聊天', x: 0, y: 0, sessionId: 's1' })
    svc.addNode('demo', { type: 'memory', title: '记忆', x: 1, y: 1, content: 'a', scope: 'project' })
    const graph = svc.get('demo')
    const chat = graph.nodes.find((node) => node.type === 'chat')!
    const memory = graph.nodes.find((node) => node.type === 'memory')!
    const first = svc.addEdge('demo', { from: chat.id, to: memory.id, toPort: 'memory', behavior: 'write', system: true })
    const second = svc.addEdge('demo', { from: chat.id, to: memory.id, toPort: 'memory', behavior: 'write', system: true })
    assert.equal(second.id, first.id)
    // 通道线（system: false）与事实线（system: true）是两条不同的线
    const channel = svc.addEdge('demo', { from: chat.id, to: memory.id, toPort: 'memory', behavior: 'write', system: false })
    assert.notEqual(channel.id, first.id)
    const writeEdges = svc.get('demo').edges.filter((edge) => edge.behavior === 'write')
    assert.equal(writeEdges.length, 2)
  })

  it('upsertWriteEdge 累加 writeCount/lastWriteAt', () => {
    const dataRoot = trackTmp('evoresearch-cgv4-bump-')
    const svc = new ChatGraphService(dataRoot)
    svc.addNode('demo', { type: 'chat', title: '聊天', x: 0, y: 0, sessionId: 's1' })
    svc.addNode('demo', { type: 'memory', title: '记忆', x: 1, y: 1, content: 'a', scope: 'project' })
    const graph = svc.get('demo')
    const chat = graph.nodes.find((node) => node.type === 'chat')!
    const memory = graph.nodes.find((node) => node.type === 'memory')!
    const first = svc.upsertWriteEdge('demo', chat.id, memory.id, true)
    assert.equal(first.ok, true)
    assert.equal(first.edge?.writeCount, 1)
    const second = svc.upsertWriteEdge('demo', chat.id, memory.id, true, 1)
    assert.equal(second.edge?.writeCount, 2)
    assert.equal((second.edge?.lastWriteAt ?? 0) >= (first.edge?.lastWriteAt ?? 1), true)
  })

  it('appendMemorySection：ref 原文 frontmatter 保留、带时间戳小节追加不覆盖', () => {
    const dataRoot = trackTmp('evoresearch-cgv4-append-')
    const svc = new ChatGraphService(dataRoot)
    const workspace = path.join(dataRoot, 'projects', 'demo')
    const noteFile = path.join(workspace, 'notes.md')
    fs.mkdirSync(workspace, { recursive: true })
    fs.writeFileSync(noteFile, '---\ntitle: 观察一\n---\n\n原始正文\n', 'utf8')
    svc.addNode('demo', {
      type: 'memory', title: '观察一', x: 1, y: 1, scope: 'project',
      ref: { kind: 'file', path: noteFile }, locator: 'project:note:o1',
    })
    const node = svc.get('demo').nodes.find((item) => item.locator === 'project:note:o1')!
    const result = svc.appendMemorySection('demo', node.id, workspace, '\n\n## 沉淀 · 2026-08-29\n\n要点一\n')
    assert.equal(result.ok, true)
    const raw = fs.readFileSync(noteFile, 'utf8')
    assert.match(raw, /^---\ntitle: 观察一\n---/)
    assert.match(raw, /原始正文/)
    assert.match(raw, /## 沉淀 · 2026-08-29/)
    // 再次追加不覆盖
    svc.appendMemorySection('demo', node.id, workspace, '\n\n## 沉淀 · 2026-08-30\n\n要点二\n')
    const raw2 = fs.readFileSync(noteFile, 'utf8')
    assert.match(raw2, /要点一/)
    assert.match(raw2, /要点二/)
  })
})

// ── 自动同步（§6.1）─────────────────────────────────────────────────────────

describe('ChatGraphSyncService：新会话入图 / 写线事实 / 台账 / 删除', () => {
  interface Fixture {
    dataRoot: string
    workspace: string
    svc: ChatGraphService
    sync: ChatGraphSyncService
    dispatch: (session: unknown, event: unknown) => void
  }

  function setup(): Fixture {
    const dataRoot = trackTmp('evoresearch-cgv4-sync-')
    const workspace = path.join(dataRoot, 'projects', 'demo')
    fs.mkdirSync(workspace, { recursive: true })
    const chatGraph = new ChatGraphService(dataRoot)
    const sync = new ChatGraphSyncService({
      dataRoot,
      chatGraph,
      guidanceCandidates: () => [path.join(workspace, 'AGENTS.md')],
      // 模拟真实 observationLookup（host/index.ts 经 memory.storeFor 反查观察文件
      // frontmatter 标题）：只有真实存在的观察文件才返回文件自身标题；
      // 未知 id 返回 undefined（实现退回工具参数标题，绝不裸用 id/文件名）。
      observationLookup: (workspaceDir, observationId) => observationId === 'O-abc'
        ? {
            title: '观察甲',
            absolutePath: path.join(workspaceDir, '.evoresearch-data', 'memories', 'observations', 'global', `${observationId}.md`),
          }
        : undefined,
    })
    const { ctx, dispatch } = fakeCtx()
    sync.attach(ctx)
    return { dataRoot, workspace, svc: chatGraph, sync, dispatch }
  }

  const sessionOf = (workspace: string, sessionId: string): unknown => ({ id: sessionId, header: { cwd: workspace } })

  it('新会话首条真人消息 → chat 节点 + 常驻节点（empty）+ 默认连线自动生成', () => {
    const f = setup()
    f.dispatch(sessionOf(f.workspace, 'session-abc'), {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第一问' }] },
    })
    const graph = f.svc.get('demo')
    const chat = graph.nodes.find((node) => node.type === 'chat')
    assert.equal(chat?.sessionId, 'session-abc')
    assert.equal(chat?.locator, chatNodeLocator('session-abc'))
    assert.equal(chat?.title, '第一问')
    // 常驻节点：画像 / 指引 / 台账，均 empty（资料不存在）
    for (const kind of ['profile', 'guidance', 'turns'] as const) {
      const node = graph.nodes.find((item) => item.displayKind === kind)
      assert.notEqual(node, undefined, kind)
      assert.equal(node?.system, true)
      assert.equal(node?.empty, true)
    }
    // 默认连线：3 条常驻 → chat（system: true）
    const defaults = graph.edges.filter((edge) => edge.to === chat?.id && edge.system === true)
    assert.equal(defaults.length, 3)
    for (const edge of defaults) assert.equal(edge.behavior, 'reference')
    // 幂等：重复消息不重复建
    f.dispatch(sessionOf(f.workspace, 'session-abc'), {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第二问' }] },
    })
    assert.equal(f.svc.get('demo').nodes.filter((node) => node.type === 'chat').length, 1)
  })

  it('写工具（create_research_note）→ note 节点 + 事实写线；create_observation 旧格式 → observation 节点', () => {
    const f = setup()
    f.dispatch(sessionOf(f.workspace, 'session-abc'), {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '记一下' }] },
    })
    f.dispatch(sessionOf(f.workspace, 'session-abc'), {
      type: 'tool/call',
      data: { callId: 'call-1', name: 'create_research_note', arguments: JSON.stringify({ title: '实验笔记', content: '正文' }) },
    })
    f.dispatch(sessionOf(f.workspace, 'session-abc'), {
      type: 'tool/result',
      data: { message: { source: { callId: 'call-1' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: JSON.stringify({ note_id: 'n1', file_name: 'n1.md' }) }] }] } },
    })
    let graph = f.svc.get('demo')
    const note = graph.nodes.find((node) => node.locator === 'project:note:n1')
    assert.equal(note?.displayKind, 'note')
    assert.equal(note?.title, '实验笔记')
    const chat = graph.nodes.find((node) => node.type === 'chat')!
    const writeEdge = graph.edges.find((edge) => edge.to === note?.id && edge.behavior === 'write')
    assert.equal(writeEdge?.from, chat.id)
    assert.equal(writeEdge?.system, true)
    assert.equal(writeEdge?.writeCount, 1)
    // 旧 Observation 路径
    f.dispatch(sessionOf(f.workspace, 'session-abc'), {
      type: 'tool/call',
      data: { callId: 'call-2', name: 'create_observation', arguments: JSON.stringify({ title: '观察甲', content: '结论' }) },
    })
    f.dispatch(sessionOf(f.workspace, 'session-abc'), {
      type: 'tool/result',
      data: { message: { source: { callId: 'call-2' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: JSON.stringify({ observation_id: 'O-abc' }) }] }] } },
    })
    graph = f.svc.get('demo')
    const observation = graph.nodes.find((node) => node.locator === 'project:note:O-abc')
    assert.equal(observation?.displayKind, 'observation')
    // 标题取观察文件自身标题（frontmatter；store.getObservation 反查），不是文件名/id
    assert.equal(observation?.title, '观察甲')
    assert.equal(observation?.ref?.path.includes('observations/global/O-abc.md'), true)
    // lookup 未命中（文件缺失等）→ 退回工具参数标题，仍不裸用 observation id
    f.dispatch(sessionOf(f.workspace, 'session-abc'), {
      type: 'tool/call',
      data: { callId: 'call-2b', name: 'create_observation', arguments: JSON.stringify({ title: '观察乙', content: '结论乙' }) },
    })
    f.dispatch(sessionOf(f.workspace, 'session-abc'), {
      type: 'tool/result',
      data: { message: { source: { callId: 'call-2b' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: JSON.stringify({ observation_id: 'O-xyz' }) }] }] } },
    })
    graph = f.svc.get('demo')
    const fallback = graph.nodes.find((node) => node.locator === 'project:note:O-xyz')
    assert.equal(fallback?.displayKind, 'observation')
    assert.equal(fallback?.title, '观察乙')
  })

  it('update_profile → 常驻画像节点转实（empty false）+ 事实写线', () => {
    const f = setup()
    f.dispatch(sessionOf(f.workspace, 'session-abc'), {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '记住我' }] },
    })
    f.dispatch(sessionOf(f.workspace, 'session-abc'), {
      type: 'tool/call',
      data: { callId: 'call-3', name: 'update_profile', arguments: JSON.stringify({ file: 'SOUL.md', content: '# 我是谁' }) },
    })
    f.dispatch(sessionOf(f.workspace, 'session-abc'), {
      type: 'tool/result',
      data: { message: { source: { callId: 'call-3' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }] } },
    })
    const graph = f.svc.get('demo')
    const profile = graph.nodes.find((node) => node.locator === PERSISTENT_NODE_LOCATORS.profile)
    assert.equal(profile?.empty, false)
    const chat = graph.nodes.find((node) => node.type === 'chat')!
    assert.equal(graph.edges.some((edge) => edge.from === chat.id && edge.to === profile?.id && edge.behavior === 'write'), true)
  })

  it('turn/end → chat → 台账写线 bump（writeCount 累加）+ lastActiveAt 显式更新', () => {
    const f = setup()
    f.dispatch(sessionOf(f.workspace, 'session-abc'), {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第一问' }] },
    })
    f.dispatch(sessionOf(f.workspace, 'session-abc'), { type: 'turn/end', data: { turn: 0, reason: { kind: 'completed' } } })
    f.dispatch(sessionOf(f.workspace, 'session-abc'), { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    const graph = f.svc.get('demo')
    const turns = graph.nodes.find((node) => node.locator === PERSISTENT_NODE_LOCATORS.turns)!
    const chat = graph.nodes.find((node) => node.type === 'chat')!
    const edge = graph.edges.find((item) => item.from === chat.id && item.to === turns.id && item.behavior === 'write')
    assert.equal(edge?.writeCount, 2)
    // §6.1 活跃时间：显式 lastActiveAt（时间戳），晚于等于节点创建时间
    assert.equal(typeof chat.lastActiveAt === 'number', true)
    assert.equal((chat.lastActiveAt ?? 0) >= (chat.createdAt ?? Number.MAX_SAFE_INTEGER), true)
  })

  it('压缩完成 → chat 节点 compactionCount 累加；同 compactionId 双路径去重', () => {
    const f = setup()
    f.dispatch(sessionOf(f.workspace, 'session-abc'), {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第一问' }] },
    })
    // 同一 compactionId 两次到达（guard 直接登记 + DSH 事件折叠双路径）只计一次
    f.sync.bumpCompaction('session-abc', 'cmp-1')
    f.sync.bumpCompaction('session-abc', 'cmp-1')
    f.sync.bumpCompaction('session-abc', 'cmp-2')
    const graph = f.svc.get('demo')
    const chat = graph.nodes.find((node) => node.type === 'chat')!
    assert.equal(chat.compactionCount, 2)
    // 未入图会话不抛错、静默跳过
    f.sync.bumpCompaction('session-none', 'cmp-3')
    assert.equal(f.svc.get('demo').nodes.find((node) => node.type === 'chat')?.compactionCount, 2)
  })

  it('会话删除 → 摘除节点 + 墓碑；再入图被跳过（skippedTombstone）', () => {
    const f = setup()
    f.dispatch(sessionOf(f.workspace, 'session-abc'), {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第一问' }] },
    })
    const removed = f.sync.sessionRemoved('session-abc')
    assert.equal(removed.removed, true)
    const graph = f.svc.get('demo')
    assert.equal(graph.nodes.some((node) => node.type === 'chat'), false)
    // 常驻节点保留（项目级资产），默认连线随之消失
    assert.equal(graph.edges.length, 0)
    assert.equal(f.svc.tombstoneHasNode('demo', chatNodeLocator('session-abc')), true)
    // 自动同步不再补种
    const again = f.sync.ensureChatNode('demo', 'session-abc', f.workspace, '标题')
    assert.equal(again.added, false)
    assert.equal(again.skippedTombstone, true)
  })

  it('session/title 事件 → chat 节点标题同步', () => {
    const f = setup()
    f.dispatch(sessionOf(f.workspace, 'session-abc'), {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第一问' }] },
    })
    f.dispatch(sessionOf(f.workspace, 'session-abc'), { type: 'session/title', data: { title: '新研究方向' } })
    const graph = f.svc.get('demo')
    assert.equal(graph.nodes.find((node) => node.type === 'chat')?.title, '新研究方向')
  })

  it('AutoSkills 审批 → skill 节点唯一落图 + 来源观察溯源连线', () => {
    const f = setup()
    f.dispatch(sessionOf(f.workspace, 'session-abc'), {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第一问' }] },
    })
    // 预置一个来源观察节点
    f.svc.addNode('demo', { type: 'memory', title: '观察一', x: 1, y: 1, scope: 'project', locator: 'project:note:O-src' })
    const result = f.sync.skillApproved({
      name: 'record-experiment',
      workspaceDir: f.workspace,
      sourceObservationIds: ['O-src'],
    })
    assert.equal(result.ok, true)
    const graph = f.svc.get('demo')
    const skill = graph.nodes.find((node) => node.locator === 'project:skill:record-experiment')
    assert.equal(skill?.displayKind, 'skill')
    assert.equal(skill?.system, true)
    // 幂等：再次审批复用同一节点
    const again = f.sync.skillApproved({ name: 'record-experiment', workspaceDir: f.workspace })
    assert.equal(again.nodeId, skill?.id)
    assert.equal(graph.nodes.filter((node) => node.displayKind === 'skill').length, 1)
  })

  it('文献入库 → library 节点唯一落图（按 paperId 判重）', () => {
    const f = setup()
    const paper = { paperId: 'p1', filePath: '/tmp/paper.pdf', title: 'A Study' }
    const first = f.sync.papersAdded({ project: 'demo', papers: [paper] })
    assert.equal(first.added, 1)
    const second = f.sync.papersAdded({ project: 'demo', papers: [paper] })
    assert.equal(second.added, 0)
    const graph = f.svc.get('demo')
    const library = graph.nodes.filter((node) => node.displayKind === 'library')
    assert.equal(library.length, 1)
    assert.equal(library[0]?.locator, 'project:library:p1')
  })
})

// ── 命中环形缓冲（graph-recent-hits）────────────────────────────────────────

describe('ChatGraphSyncService：检索命中环形缓冲', () => {
  it('≤100 条环形上限；同会话同节点 5 秒内去重；按会话过滤', () => {
    const dataRoot = trackTmp('evoresearch-cgv4-hits-')
    const sync = new ChatGraphSyncService({ dataRoot, chatGraph: new ChatGraphService(dataRoot) })
    for (let i = 0; i < 120; i += 1) {
      sync.recordGraphHits({ sessionId: 's1', hits: [{ nodeId: `n${i}`, title: `节点${i}`, score: i }] })
    }
    assert.equal(sync.recentHits().length, 100)
    assert.equal(sync.recentHits()[0]?.nodeId, 'n119')
    // 去重：同会话同节点连续注入只记一次
    sync.recordGraphHits({ sessionId: 's2', hits: [{ nodeId: 'x', title: 'X' }] })
    sync.recordGraphHits({ sessionId: 's2', hits: [{ nodeId: 'x', title: 'X' }] })
    assert.equal(sync.recentHits('s2').length, 1)
    assert.equal(sync.recentHits('s3').length, 0)
  })
})

// ── versionOf（graph-version 轮询）──────────────────────────────────────────

describe('ChatGraphService.versionOf', () => {
  it('返回 rev/节点数/连线数（含全局节点），无文件时为 0', () => {
    const dataRoot = trackTmp('evoresearch-cgv4-ver-')
    const svc = new ChatGraphService(dataRoot)
    const empty = svc.versionOf('demo')
    assert.equal(empty.rev, 0)
    assert.equal(empty.nodeCount, 0)
    assert.equal(empty.edgeCount, 0)
    svc.addNode('demo', { type: 'chat', title: '聊天', x: 0, y: 0, sessionId: 's1' })
    svc.addNode('demo', { type: 'memory', title: '全局记忆', x: 1, y: 1, content: 'a', scope: 'global' })
    const version = svc.versionOf('demo')
    assert.equal(version.nodeCount, 2)
    assert.equal(version.edgeCount, 0)
    assert.equal(version.rev > 0, true)
    assert.equal(version.serverTime > 0, true)
  })
})

// ── 边判重键一致性 ───────────────────────────────────────────────────────────

describe('edgeKeyOf（contract：from|to|behavior|system）', () => {
  it('system 缺省按 false；behavior 缺省按 toPort 推断', () => {
    assert.equal(edgeKeyOf({ from: 'a', to: 'b', behavior: 'reference', system: true }), 'a|b|reference|1')
    assert.equal(edgeKeyOf({ from: 'a', to: 'b', behavior: 'reference' }), 'a|b|reference|0')
    assert.equal(edgeKeyOf({ from: 'a', to: 'b', behavior: 'fork' }), 'a|b|fork|0')
    assert.equal(edgeKeyOf({ from: 'a', to: 'b', behavior: 'write', system: true }), 'a|b|write|1')
  })
})
