/**
 * Chat Graph 两种连线语义测试（GRAPH-01..12）。
 *
 * 语义基线：
 * - context 连线 = 创建时一次性 fork（graphInherit，api.ts）：读源会话持久化事件
 *   → 清洗为官方 seed（合法 envelope、seq 从 0 重排、丢弃 sourceEventSeqs 与
 *   会话头事件）→ agents.create 新会话 → 目标节点换绑 → context 边唯一替换 →
 *   单次落盘。运行时不再注入上游链（GRAPH-02：递归 graphContextText 已删除，
 *   sessionHistoryText 仅作显式历史读取工具保留）。
 * - memory 连线 = 运行时持续参考：graphMemoryText() 注入所连 memory 节点内容
 *   （去重、每节点 1500 字符、总量预算）；neighborChatText() 读取所连 chat 节点
 *   的最近消息（GRAPH-05：持续参考非继承，多个方向自由汇合）。
 * - memory node 可引用真实资料（GRAPH-04：ref = note/file/pdf/dir，节点只保存
 *   显示名与位置）；previewOf() 实时读文件（GRAPH-08：文件更新后预览同步）。
 * - 非 context 边可附自然语言说明 label（GRAPH-07）；context 边不允许。
 * - 删除图节点/连线不删除目标资料（GRAPH-09）。
 * - 旧内嵌文本节点继续可用，可 convertToNote 转 Markdown 笔记（GRAPH-06）。
 *
 * GRAPH-03 核对结论（对照 api.ts graphInherit 实现，见"graphInherit 原子性"用例）：
 * ① 顺序正确：fork（await agents.create，失败不改图）→ 目标节点换绑 → context
 *    边替换 → 单次 save 落盘（save 返回值已检查）；
 * ② context 边替换 = filter(去掉旧 context 边) + concat(一条新边)，不产生重复边，
 *   且 save 层另有 context 唯一性去重兜底；
 * ③ 自继承（from === to）被拒绝，且不改动图；
 * ④ 以 agents.create 返回的真实会话 id 为准（handle 可能是 {session:{id}} 或 id）。
 */
import { after, describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ChatGraphService, graphMemoryText, neighborChatText, sessionHistoryText, type ChatGraph, type GraphNode } from '../src/host/chat-graph.js'
import { EvoResearchApiService, type HostServices } from '../src/host/api.js'
import { WorkspaceService } from '../src/host/workspace.js'

// 测试卫生（BASE-02）：登记所有临时目录，文件级测试全部结束后统一清理（含失败路径）。
// 用文件级 after() 而非 per-test 清理，避免与各 describe 的 DSH_HOME 保存/恢复钩子互相干扰。
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

// ── 工具 ────────────────────────────────────────────────────────────────────

/** 写一个会话日志文件（sessions/<w>/<sessionId>/session.jsonl）。 */
function writeSession(sessionId: string, events: unknown[]): void {
  const home = process.env.DSH_HOME ?? ''
  const dir = path.join(home, 'sessions', 'w1', sessionId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'session.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
}

/** graphInherit 测试夹具：真实 WorkspaceService + ChatGraphService + 假 agents/sessions。 */
interface InheritFixture {
  dataRoot: string
  project: { name: string; path: string }
  chatGraph: ChatGraphService
  api: EvoResearchApiService
  agents: { calls: Array<Record<string, unknown>>; create(opts: Record<string, unknown>): Promise<unknown> }
  src: GraphNode
  target: GraphNode
  other: GraphNode
}

const SRC_EVENTS = [
  // 会话头事件：envelope 含 id/cwd 等非法键 → 清洗时剔除（不作为 seed）
  { type: 'session', seq: 0, time: 1, id: 'src-1', cwd: '/none' },
  { type: 'user/message', seq: 1, time: 2, data: { text: '第一问' } },
  // sourceEventSeqs 引用旧 seq → seed 中必须丢弃
  { type: 'assistant/message', seq: 2, time: 3, data: { text: '第一答' }, sourceEventSeqs: [1] },
  { type: 'assistant/chunk', seq: 3, time: 4, data: { turn: 0, step: 0, chunk: { type: 'text-delta', text: '续' } } },
]

function setupInherit(withAgents = true): InheritFixture {
  const tmp = trackTmp('evoresearch-graph-')
  const dataRoot = path.join(tmp, 'data')
  fs.mkdirSync(dataRoot, { recursive: true })
  process.env.DSH_HOME = tmp
  const workspace = new WorkspaceService({ dataRoot })
  const project = workspace.createProject('demo')
  const chatGraph = new ChatGraphService(dataRoot)
  const src = chatGraph.addNode('demo', { type: 'chat', title: '源分支', x: 0, y: 0, sessionId: 'src-1' })
  const target = chatGraph.addNode('demo', { type: 'chat', title: '目标分支', x: 100, y: 0, sessionId: 'old-target' })
  const other = chatGraph.addNode('demo', { type: 'chat', title: '其他分支', x: 0, y: 100, sessionId: 'other-1' })
  chatGraph.addNode('demo', { type: 'memory', title: '记忆', x: 200, y: 200, content: '共享记忆内容', scope: 'project' })
  // 目标已有旧 context 边（将被唯一替换）+ 一条 memory 边（持续参考，必须保留）
  chatGraph.addEdge('demo', { from: other.id, to: target.id, toPort: 'context' })
  const mem = chatGraph.get('demo').nodes.find((n) => n.type === 'memory')!
  chatGraph.addEdge('demo', { from: mem.id, to: target.id, toPort: 'memory' })
  writeSession('src-1', SRC_EVENTS)
  writeSession('old-target', [{ type: 'user/message', seq: 0, time: 1, data: { text: '目标旧内容' } }])
  const ctx = new Context()
  const agents = {
    calls: [] as Array<Record<string, unknown>>,
    create(opts: Record<string, unknown>): Promise<unknown> {
      agents.calls.push(opts)
      return Promise.resolve({ id: opts.sessionId })
    },
  }
  if (withAgents) ctx.provide('agents', agents)
  ctx.provide('sessions', { get: () => ({ header: { cwd: project.path } }) })
  const services = {
    workspace,
    memory: { config: { dataRoot } },
    scheduler: {},
    channels: {},
    autoskills: {},
    experts: {},
    experiments: {},
    chatGraph,
    projectEnv: {},
    rewind: {},
  } as unknown as HostServices
  const api = new EvoResearchApiService(ctx, services)
  return { dataRoot, project, chatGraph, api, agents, src, target, other }
}

// ── GRAPH-01：ChatGraphService 基础语义（get/save/addNode/addEdge）─────────

describe('ChatGraphService：两种连线语义的基础保证（GRAPH-01）', () => {
  let dataRoot: string
  let svc: ChatGraphService

  beforeEach(() => {
    dataRoot = trackTmp('evoresearch-cg-')
    svc = new ChatGraphService(dataRoot)
  })

  it('空图防御：无任何文件时 get 返回空图、rev 为 0', () => {
    assert.deepEqual(svc.get('demo'), { nodes: [], edges: [], schemaVersion: 3 })
    assert.equal(svc.rev('demo'), 0)
    assert.equal(svc.get('不存在').nodes.length, 0)
  })

  it('save/get 往返：节点与边完整落盘可回读', () => {
    const graph: ChatGraph = {
      nodes: [
        { id: 'c1', type: 'chat', title: '聊天', x: 0, y: 0, sessionId: 's1' },
        { id: 'm1', type: 'memory', title: '记忆', x: 1, y: 1, content: '内容', scope: 'project' },
      ],
      edges: [{ id: 'e1', from: 'm1', to: 'c1', toPort: 'memory' }],
    }
    const result = svc.save('demo', graph)
    assert.deepEqual(result, { ok: true })
    assert.deepEqual(svc.get('demo'), {
      ...graph,
      schemaVersion: 3,
      edges: [{ ...graph.edges[0], behavior: 'reference' }],
    })
  })

  it('save 拒绝引用不存在节点的连线（边引用校验）', () => {
    const graph: ChatGraph = {
      nodes: [{ id: 'c1', type: 'chat', title: '聊天', x: 0, y: 0, sessionId: 's1' }],
      edges: [{ id: 'e1', from: '幽灵', to: 'c1', toPort: 'memory' }],
    }
    const result = svc.save('demo', graph)
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /引用不存在的节点/)
  })

  it('save 拒绝非法输入端口类型', () => {
    const graph: ChatGraph = {
      nodes: [
        { id: 'c1', type: 'chat', title: '聊天', x: 0, y: 0, sessionId: 's1' },
        { id: 'm1', type: 'memory', title: '记忆', x: 1, y: 1, content: '内容', scope: 'project' },
      ],
      edges: [{ id: 'e1', from: 'm1', to: 'c1', toPort: 'weird' as never }],
    }
    const result = svc.save('demo', graph)
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /无效的输入端口类型/)
  })

  it('save 语义：同一目标的 context 边只保留一条（后写覆盖先写，不产生重复边）', () => {
    const graph: ChatGraph = {
      nodes: [
        { id: 'c1', type: 'chat', title: '目标', x: 0, y: 0, sessionId: 's1' },
        { id: 'a', type: 'chat', title: 'A', x: 1, y: 1, sessionId: 'sa' },
        { id: 'b', type: 'chat', title: 'B', x: 2, y: 2, sessionId: 'sb' },
      ],
      edges: [
        { id: 'e1', from: 'a', to: 'c1', toPort: 'context' },
        { id: 'e2', from: 'b', to: 'c1', toPort: 'context' }, // 与 e1 冲突 → 被去重
      ],
    }
    assert.equal(svc.save('demo', graph).ok, true)
    const ctxEdges = svc.get('demo').edges.filter((e) => e.to === 'c1' && e.toPort === 'context')
    assert.equal(ctxEdges.length, 1)
    assert.equal(ctxEdges[0]?.from, 'a') // 保留先写的一条
  })

  it('save 语义：同一目标的 memory 边允许多条（多个 Idea 持续参考汇合）', () => {
    const graph: ChatGraph = {
      nodes: [
        { id: 'c1', type: 'chat', title: '综合讨论', x: 0, y: 0, sessionId: 's1' },
        { id: 'm1', type: 'memory', title: '笔记1', x: 1, y: 1, content: 'a', scope: 'project' },
        { id: 'm2', type: 'memory', title: '笔记2', x: 2, y: 2, content: 'b', scope: 'project' },
      ],
      edges: [
        { id: 'e1', from: 'm1', to: 'c1', toPort: 'memory' },
        { id: 'e2', from: 'm2', to: 'c1', toPort: 'memory' },
      ],
    }
    assert.equal(svc.save('demo', graph).ok, true)
    const memEdges = svc.get('demo').edges.filter((e) => e.to === 'c1' && e.toPort === 'memory')
    assert.equal(memEdges.length, 2)
  })

  it('save 语义：global 节点剥离到全局文件、跨项目共享可见', () => {
    const graph: ChatGraph = {
      nodes: [
        { id: 'p1', type: 'memory', title: '项目记忆', x: 0, y: 0, content: '项目级', scope: 'project' },
        { id: 'g1', type: 'memory', title: 'SOUL', x: 1, y: 1, content: '全局偏好', scope: 'global' },
      ],
      edges: [],
    }
    assert.equal(svc.save('alpha', graph).ok, true)
    // 项目文件里只存项目节点；global 节点在全局文件
    const projectFile = path.join(dataRoot, 'plugins', 'chat-graphs', 'alpha.json')
    const globalFile = path.join(dataRoot, 'plugins', 'chat-graphs', '_global_.json')
    const stored = JSON.parse(fs.readFileSync(projectFile, 'utf8')) as ChatGraph
    const storedGlobal = JSON.parse(fs.readFileSync(globalFile, 'utf8')) as ChatGraph
    assert.deepEqual(stored.nodes.map((n) => n.id), ['p1'])
    assert.deepEqual(storedGlobal.nodes.map((n) => n.id), ['g1'])
    // get 合并：两个项目都能看到 global 节点
    const seen = svc.get('alpha').nodes.map((n) => n.id).sort()
    assert.deepEqual(seen, ['g1', 'p1'])
    assert.equal(svc.get('beta').nodes.some((n) => n.id === 'g1'), true)
  })

  it('addNode：自动生成不重复 id 并落盘', () => {
    const n1 = svc.addNode('demo', { type: 'chat', title: '一', x: 0, y: 0, sessionId: 's1' })
    const n2 = svc.addNode('demo', { type: 'chat', title: '二', x: 1, y: 1, sessionId: 's2' })
    assert.notEqual(n1.id, n2.id)
    assert.ok(n1.id.length > 0)
    assert.equal(svc.get('demo').nodes.length, 2)
  })

  it('addEdge：context 边替换旧边（唯一），memory 边可多条', () => {
    const a = svc.addNode('demo', { type: 'chat', title: 'A', x: 0, y: 0, sessionId: 'sa' })
    const b = svc.addNode('demo', { type: 'chat', title: 'B', x: 1, y: 1, sessionId: 'sb' })
    const t = svc.addNode('demo', { type: 'chat', title: 'T', x: 2, y: 2, sessionId: 'st' })
    svc.addEdge('demo', { from: a.id, to: t.id, toPort: 'context' })
    svc.addEdge('demo', { from: b.id, to: t.id, toPort: 'context' }) // 替换 a→t
    const ctxEdges = svc.get('demo').edges.filter((e) => e.to === t.id && e.toPort === 'context')
    assert.equal(ctxEdges.length, 1)
    assert.equal(ctxEdges[0]?.from, b.id)
    // memory 多边
    svc.addEdge('demo', { from: a.id, to: t.id, toPort: 'memory' })
    svc.addEdge('demo', { from: b.id, to: t.id, toPort: 'memory' })
    assert.equal(svc.get('demo').edges.filter((e) => e.to === t.id && e.toPort === 'memory').length, 2)
  })

  it('addEdge：引用不存在的节点抛错', () => {
    const t = svc.addNode('demo', { type: 'chat', title: 'T', x: 0, y: 0, sessionId: 'st' })
    assert.throws(() => svc.addEdge('demo', { from: '幽灵', to: t.id, toPort: 'memory' }), /不存在/)
    assert.throws(() => svc.addEdge('demo', { from: t.id, to: '幽灵', toPort: 'memory' }), /不存在/)
  })

  it('rev：保存后修订号从 0 变为非 0', () => {
    assert.equal(svc.rev('demo'), 0)
    svc.addNode('demo', { type: 'chat', title: '一', x: 0, y: 0, sessionId: 's1' })
    assert.ok(svc.rev('demo') > 0)
  })
})

// ── GRAPH-01：graphMemoryText（memory 持续参考注入）────────────────────────

describe('graphMemoryText：memory 连线运行时注入（GRAPH-01）', () => {
  it('按 memory 边注入记忆内容：重复边去重、每节点截断、总量预算', () => {
    const graph: ChatGraph = {
      nodes: [
        { id: 'c1', type: 'chat', title: '聊天', x: 0, y: 0, sessionId: 's1' },
        { id: 'm1', type: 'memory', title: '记忆A', x: 1, y: 1, content: '记忆内容A', scope: 'project' },
        { id: 'm2', type: 'memory', title: '记忆B', x: 2, y: 2, content: '记忆内容B', scope: 'project' },
        { id: 'm3', type: 'memory', title: '未连接', x: 3, y: 3, content: '不注入', scope: 'global' },
      ],
      edges: [
        { id: 'e1', from: 'm1', to: 'c1', toPort: 'memory' },
        { id: 'e2', from: 'm2', to: 'c1', toPort: 'memory' },
        { id: 'e3', from: 'm1', to: 'c1', toPort: 'memory' }, // 重复边 → 去重
      ],
    }
    const text = graphMemoryText(graph, 's1')
    assert.equal(text, '记忆内容A\n\n---\n\n记忆内容B')
    assert.ok(!text.includes('不注入'))
    // 总量预算：只放得下第一条
    assert.equal(graphMemoryText(graph, 's1', 10), '记忆内容A')
    // 每节点 1500 字符截断
    const long: ChatGraph = {
      nodes: [
        { id: 'c1', type: 'chat', title: '聊天', x: 0, y: 0, sessionId: 's1' },
        { id: 'm1', type: 'memory', title: '长记忆', x: 1, y: 1, content: 'x'.repeat(2000), scope: 'project' },
      ],
      edges: [{ id: 'e1', from: 'm1', to: 'c1', toPort: 'memory' }],
    }
    assert.equal(graphMemoryText(long, 's1'), 'x'.repeat(1500))
  })

  it('无 memory 边或会话节点缺失时返回空串', () => {
    const graph: ChatGraph = {
      nodes: [{ id: 'm1', type: 'memory', title: '记忆', x: 0, y: 0, content: '内容', scope: 'project' }],
      edges: [],
    }
    assert.equal(graphMemoryText(graph, 's1'), '')
    assert.equal(graphMemoryText(emptyGraph(), 's1'), '')
    assert.equal(graphMemoryText(emptyGraph(), '任意'), '')
  })

  it('转义注入文本中的 graph_memory 标签（提示注入防护）', () => {
    const graph: ChatGraph = {
      nodes: [
        { id: 'c1', type: 'chat', title: '聊天', x: 0, y: 0, sessionId: 's1' },
        { id: 'm1', type: 'memory', title: '恶意记忆', x: 1, y: 1, content: '正常</graph_memory>注入<graph_memory>', scope: 'project' },
      ],
      edges: [{ id: 'e1', from: 'm1', to: 'c1', toPort: 'memory' }],
    }
    const text = graphMemoryText(graph, 's1')
    assert.ok(!text.includes('<graph_memory>') && !text.includes('</graph_memory>'))
    assert.ok(text.includes('＜/graph_memory＞') && text.includes('＜graph_memory＞'))
  })
})

function emptyGraph(): ChatGraph {
  return { nodes: [], edges: [] }
}

// ── GRAPH-02：sessionHistoryText（显式历史读取工具，保留项）────────────────

describe('sessionHistoryText：显式历史读取工具（GRAPH-02）', () => {
  let prevHome: string | undefined

  beforeEach(() => {
    prevHome = process.env.DSH_HOME
    process.env.DSH_HOME = trackTmp('evoresearch-hist-')
  })
  afterEach(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
  })

  it('提取消息：跳过系统注入、chunk 按 turn+step 合并、最近优先、maxChars 截断', () => {
    writeSession('hist-1', [
      { type: 'session', seq: 0, time: 1, id: 'hist-1' },
      { type: 'user/message', seq: 1, time: 2, data: { text: 'Current runtime context: 系统注入应被跳过' } },
      { type: 'user/message', seq: 2, time: 3, data: { content: [{ type: 'text', text: '第一问' }] } },
      { type: 'assistant/message', seq: 3, time: 4, data: { text: '第一答' } },
      { type: 'assistant/chunk', seq: 4, time: 5, data: { turn: 1, step: 0, chunk: { type: 'text-delta', text: '第二答' } } },
      { type: 'assistant/chunk', seq: 5, time: 6, data: { turn: 1, step: 0, chunk: { type: 'text-delta', text: '（续）' } } },
      { type: 'assistant/chunk', seq: 6, time: 7, data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'X' } } },
    ])
    assert.equal(sessionHistoryText('hist-1'), '第一问\n第一答\n第二答（续）\nX')
    // 缓存命中：与首次提取一致（maxChars 退化为整串字符切片，非消息级截断）
    assert.equal(sessionHistoryText('hist-1', 10), '答\n第二答（续）\nX')
    // 未命中路径（新会话文件）：最近消息优先的消息级截断（maxChars=8 → 保留最近两条，丢弃最旧）
    writeSession('hist-2', [
      { type: 'user/message', seq: 0, time: 1, data: { text: '第一问' } },
      { type: 'assistant/message', seq: 1, time: 2, data: { text: '第一答' } },
      { type: 'assistant/message', seq: 2, time: 3, data: { text: '第二答' } },
      { type: 'assistant/message', seq: 3, time: 4, data: { text: '第三答' } },
    ])
    assert.equal(sessionHistoryText('hist-2', 8), '第二答\n第三答')
  })

  it('会话不存在返回空串（不抛错）', () => {
    assert.equal(sessionHistoryText('no-such-session-xyz'), '')
  })
})

// ── GRAPH-03：graphInherit 原子性（fork → 换绑 → context 边替换 → 单次落盘）─

describe('graphInherit：context 一次性 fork 的原子性（GRAPH-03）', () => {
  let prevHome: string | undefined

  beforeEach(() => {
    prevHome = process.env.DSH_HOME
  })
  afterEach(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
  })

  it('原子完成：fork 新会话 + 目标换绑 + context 边唯一替换 + 单次落盘', async () => {
    const fx = setupInherit()
    const result = await fx.api.graphInherit({ workspaceDir: fx.project.path, fromNodeId: fx.src.id, toNodeId: fx.target.id })
    assert.equal(result.ok, true, result.error)
    assert.ok(result.sessionId?.startsWith('session-'))
    assert.equal(result.replaced, true)
    assert.match(result.notice ?? '', /重新绑定/)

    // ① fork：agents.create 恰好一次，seed 已清洗为官方形状
    assert.equal(fx.agents.calls.length, 1)
    const opts = fx.agents.calls[0]!
    assert.equal(opts.sessionId, result.sessionId)
    const seed = opts.seed as Array<Record<string, unknown>>
    assert.equal(seed.length, 3) // 会话头事件被剔除
    assert.ok(!seed.some((ev) => ev.type === 'session'))
    assert.deepEqual(seed.map((ev) => ev.seq), [0, 1, 2]) // seq 从 0 连续重排
    assert.equal(seed[0]?.type, 'user/message')
    assert.equal(seed[1]?.type, 'assistant/message')
    assert.equal((seed[1] as Record<string, unknown>).sourceEventSeqs, undefined) // 引用被丢弃
    assert.equal(seed[2]?.type, 'assistant/chunk')
    const meta = opts.meta as Record<string, unknown>
    assert.equal(meta.parentSession, 'src-1')
    assert.equal(meta.inherited, true)
    assert.equal(meta.seedLength, 3)
    assert.equal(meta.cwd, fx.project.path) // live 会话头 cwd 生效

    // ② 换绑 + ③ context 边唯一替换 + memory 边保留（内存视图）
    const graph = fx.chatGraph.get('demo')
    const targetNow = graph.nodes.find((n) => n.id === fx.target.id)!
    assert.equal(targetNow.sessionId, result.sessionId)
    const ctxEdges = graph.edges.filter((e) => e.to === fx.target.id && e.toPort === 'context')
    assert.equal(ctxEdges.length, 1)
    assert.equal(ctxEdges[0]?.from, fx.src.id)
    assert.equal(graph.edges.filter((e) => e.toPort === 'context' && e.to === fx.target.id && e.from === fx.other.id).length, 0)
    assert.equal(graph.edges.filter((e) => e.to === fx.target.id && e.toPort === 'memory').length, 1)

    // ④ 单次落盘：磁盘文件与内存一致，无重复 context 边
    const file = path.join(fx.dataRoot, 'plugins', 'chat-graphs', 'demo.json')
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as ChatGraph
    assert.equal(stored.nodes.find((n) => n.id === fx.target.id)?.sessionId, result.sessionId)
    assert.equal(stored.edges.filter((e) => e.to === fx.target.id && e.toPort === 'context').length, 1)
    assert.equal(result.rev, fx.chatGraph.rev('demo'))
  })

  it('自继承被拒绝：不改图、不调用 agents.create', async () => {
    const fx = setupInherit()
    const before = JSON.stringify(fx.chatGraph.get('demo'))
    const result = await fx.api.graphInherit({ workspaceDir: fx.project.path, fromNodeId: fx.src.id, toNodeId: fx.src.id })
    assert.equal(result.ok, false)
    assert.equal(result.error, '不能继承自己的上下文')
    assert.equal(fx.agents.calls.length, 0)
    assert.equal(JSON.stringify(fx.chatGraph.get('demo')), before)
  })

  it('agents 服务不可用时拒绝（fork 前置校验）', async () => {
    const fx = setupInherit(false)
    const result = await fx.api.graphInherit({ workspaceDir: fx.project.path, fromNodeId: fx.src.id, toNodeId: fx.target.id })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'agents 服务不可用')
  })

  it('源聊天节点未绑定会话时拒绝', async () => {
    const fx = setupInherit()
    const detached = fx.chatGraph.addNode('demo', { type: 'chat', title: '未绑定', x: 300, y: 0 })
    const result = await fx.api.graphInherit({ workspaceDir: fx.project.path, fromNodeId: detached.id, toNodeId: fx.target.id })
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /源聊天节点未绑定会话/)
  })
})

// ── GRAPH-04/08：资料引用节点与实时预览（previewOf）────────────────────────

describe('GRAPH-04/08：memory node 引用真实资料 + previewOf 实时预览', () => {
  let dataRoot: string
  let projectDir: string
  let svc: ChatGraphService

  beforeEach(() => {
    dataRoot = trackTmp('evoresearch-ref-')
    projectDir = path.join(dataRoot, 'projects', 'demo')
    fs.mkdirSync(projectDir, { recursive: true })
    svc = new ChatGraphService(dataRoot)
  })

  it('ref 节点保存/读取往返：ref 字段完整落盘', () => {
    const node = svc.addNode('demo', {
      type: 'memory', title: '实验日志', x: 0, y: 0, scope: 'project',
      ref: { kind: 'file', path: 'logs/run-1.log' },
    })
    const loaded = svc.get('demo').nodes.find((n) => n.id === node.id)
    assert.deepEqual(loaded?.ref, { kind: 'file', path: 'logs/run-1.log' })
    // 磁盘文件也包含 ref
    const file = path.join(dataRoot, 'plugins', 'chat-graphs', 'demo.json')
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as ChatGraph
    assert.deepEqual(stored.nodes.find((n) => n.id === node.id)?.ref, { kind: 'file', path: 'logs/run-1.log' })
  })

  it('previewOf：文本文件实时读取 + 截断 + 文件更新后预览同步', () => {
    const file = path.join(projectDir, 'note.md')
    fs.writeFileSync(file, '第一版内容', 'utf8')
    const node: GraphNode = { id: 'n1', type: 'memory', title: '笔记', x: 0, y: 0, ref: { kind: 'file', path: 'note.md' } }
    const first = svc.previewOf(node, projectDir)
    assert.equal(first.ok, true)
    assert.equal(first.text, '第一版内容')
    assert.equal(first.path, file)
    assert.equal(typeof first.mtimeMs, 'number')
    // GRAPH-08：文件更新后预览随之更新（实时读取，无内容缓存）
    fs.writeFileSync(file, '第二版内容，更长一些', 'utf8')
    const second = svc.previewOf(node, projectDir)
    assert.equal(second.ok, true)
    assert.equal(second.text, '第二版内容，更长一些')
    assert.notEqual(second.mtimeMs, first.mtimeMs)
    // 截断：maxChars 生效
    const small = svc.previewOf(node, projectDir, 6)
    assert.equal(small.ok, true)
    assert.equal(small.truncated, true)
    assert.ok((small.text ?? '').startsWith('第二版内容'))
  })

  it('previewOf：note 引用按笔记目录解析（相对路径）', () => {
    const notesDir = path.join(projectDir, '.evoresearch-data', 'memories', 'notes')
    fs.mkdirSync(notesDir, { recursive: true })
    fs.writeFileSync(path.join(notesDir, 'idea-ab12cd34.md'), '# 想法\n\n研究笔记内容', 'utf8')
    const node: GraphNode = { id: 'n1', type: 'memory', title: '想法', x: 0, y: 0, ref: { kind: 'note', path: 'idea-ab12cd34.md' } }
    const result = svc.previewOf(node, projectDir)
    assert.equal(result.ok, true)
    assert.equal(result.text, '# 想法\n\n研究笔记内容')
  })

  it('previewOf：目录引用列出条目（文件/子目录标记）', () => {
    const dir = path.join(projectDir, 'data')
    fs.mkdirSync(path.join(dir, 'raw'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'result.csv'), 'a,b', 'utf8')
    const node: GraphNode = { id: 'n1', type: 'memory', title: '数据', x: 0, y: 0, ref: { kind: 'dir', path: 'data' } }
    const result = svc.previewOf(node, projectDir)
    assert.equal(result.ok, true)
    assert.ok((result.text ?? '').includes('raw/'))
    assert.ok((result.text ?? '').includes('result.csv'))
  })

  it('previewOf：PDF/二进制返回打开提示，不读内容', () => {
    const file = path.join(projectDir, 'paper.pdf')
    fs.writeFileSync(file, '%PDF-1.4 fake', 'utf8')
    const node: GraphNode = { id: 'n1', type: 'memory', title: '论文', x: 0, y: 0, ref: { kind: 'pdf', path: 'paper.pdf' } }
    const result = svc.previewOf(node, projectDir)
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /二进制|标签页打开/)
    assert.equal(result.path, file)
  })

  it('previewOf：引用缺失返回错误；类型与目标不符返回错误', () => {
    const node: GraphNode = { id: 'n1', type: 'memory', title: '幽灵', x: 0, y: 0, ref: { kind: 'file', path: 'missing.txt' } }
    assert.equal(svc.previewOf(node, projectDir).ok, false)
    // 类型不符：file 引用指向目录
    fs.mkdirSync(path.join(projectDir, 'some-dir'), { recursive: true })
    const wrong: GraphNode = { id: 'n2', type: 'memory', title: '错配', x: 0, y: 0, ref: { kind: 'file', path: 'some-dir' } }
    assert.equal(svc.previewOf(wrong, projectDir).ok, false)
  })

  it('previewOf：旧内嵌文本节点返回 content（GRAPH-06 兼容，无需 ref）', () => {
    const node: GraphNode = { id: 'n1', type: 'memory', title: '旧节点', x: 0, y: 0, content: '内嵌记忆内容', scope: 'project' }
    const result = svc.previewOf(node, projectDir)
    assert.equal(result.ok, true)
    assert.equal(result.text, '内嵌记忆内容')
    assert.equal(result.path, undefined)
  })
})

// ── GRAPH-05：chat 节点作为持续参考（neighborChatText）────────────────────

describe('GRAPH-05：chat 节点持续参考（neighborChatText）', () => {
  let prevHome: string | undefined

  beforeEach(() => {
    prevHome = process.env.DSH_HOME
    process.env.DSH_HOME = trackTmp('evoresearch-nbr-')
  })
  afterEach(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
  })

  function graphWith(srcId: string, dstId: string, extraEdges: Array<{ from: string; to: string; toPort: 'memory' }> = []): ChatGraph {
    return {
      nodes: [
        { id: srcId, type: 'chat', title: '源分支', x: 0, y: 0, sessionId: 'src-1' },
        { id: dstId, type: 'chat', title: '综合讨论', x: 100, y: 0, sessionId: 'dst-1' },
      ],
      edges: [{ id: 'e1', from: srcId, to: dstId, toPort: 'memory' }, ...extraEdges],
    }
  }

  it('memory 边连 chat 节点 → 读取其最近消息，标注来源（持续参考非继承）', () => {
    writeSession('src-1', [
      { type: 'user/message', seq: 0, time: 1, data: { text: '源分支的讨论内容' } },
      { type: 'assistant/message', seq: 1, time: 2, data: { text: '源分支的结论' } },
    ])
    const graph = graphWith('a', 'b')
    const text = neighborChatText(graph, 'dst-1')
    assert.ok(text.includes('【持续参考：源分支】'))
    assert.ok(text.includes('源分支的讨论内容'))
    assert.ok(text.includes('源分支的结论'))
  })

  it('无 chat 来源 / 目标会话缺失返回空串', () => {
    const graph: ChatGraph = {
      nodes: [
        { id: 'm', type: 'memory', title: '记忆', x: 0, y: 0, content: '文本', scope: 'project' },
        { id: 'c', type: 'chat', title: '聊天', x: 100, y: 0, sessionId: 'dst-1' },
      ],
      edges: [{ id: 'e1', from: 'm', to: 'c', toPort: 'memory' }],
    }
    // memory 来源不参与 chat 参考文本（走 graphMemoryText 路径）
    assert.equal(neighborChatText(graph, 'dst-1'), '')
    // 目标会话不在图中
    assert.equal(neighborChatText(graph, 'ghost-1'), '')
  })

  it('同一 chat 源多条边去重，只读取一次', () => {
    writeSession('src-1', [{ type: 'user/message', seq: 0, time: 1, data: { text: '只读一次' } }])
    const graph = graphWith('a', 'b', [
      { from: 'a', to: 'b', toPort: 'memory' },
    ])
    const text = neighborChatText(graph, 'dst-1')
    assert.equal((text.match(/只读一次/g) ?? []).length, 1)
  })
})

// ── GRAPH-06：内嵌文本 memory node → Markdown 笔记 ─────────────────────────

describe('GRAPH-06：convertToNote（内嵌文本转 Markdown 笔记）', () => {
  let dataRoot: string
  let svc: ChatGraphService

  beforeEach(() => {
    dataRoot = trackTmp('evoresearch-cvt-')
    svc = new ChatGraphService(dataRoot)
  })

  it('转换：调用笔记写入器 + 节点改为 ref note（content 保留为快照）', () => {
    const node = svc.addNode('demo', {
      type: 'memory', title: '旧想法', x: 0, y: 0, scope: 'project', content: '# 旧想法\n\n一段内嵌内容',
    })
    const calls: Array<Record<string, unknown>> = []
    const notes = {
      createNote(input: { workspaceDir?: string; title?: string; body: string }) {
        calls.push(input)
        return { noteId: 'old-idea-a1b2c3d4', fileName: 'old-idea-a1b2c3d4.md' }
      },
    }
    const result = svc.convertToNote('demo', node.id, path.join(dataRoot, 'projects', 'demo'), notes)
    assert.equal(result.ok, true)
    // 笔记写入器收到标题与正文
    assert.deepEqual(calls[0]?.title, '旧想法')
    assert.deepEqual(calls[0]?.body, '# 旧想法\n\n一段内嵌内容')
    // 节点改为引用笔记，content 保留
    const updated = svc.get('demo').nodes.find((n) => n.id === node.id)!
    assert.deepEqual(updated.ref, { kind: 'note', path: 'old-idea-a1b2c3d4.md' })
    assert.equal(updated.content, '# 旧想法\n\n一段内嵌内容')
  })

  it('空内容节点 / 已是引用节点被拒绝', () => {
    const empty = svc.addNode('demo', { type: 'memory', title: '空', x: 0, y: 0, scope: 'project', content: '   ' })
    const notes = { createNote() { throw new Error('不应被调用') } }
    assert.equal(svc.convertToNote('demo', empty.id, undefined, notes).ok, false)
    const refNode = svc.addNode('demo', { type: 'memory', title: '已引用', x: 1, y: 1, scope: 'project', content: 'x', ref: { kind: 'file', path: 'a.txt' } })
    assert.equal(svc.convertToNote('demo', refNode.id, undefined, notes).ok, false)
  })
})

// ── GRAPH-07：连线自然语言说明（label）────────────────────────────────────

describe('GRAPH-07：非 context 边可附自然语言说明', () => {
  let dataRoot: string
  let svc: ChatGraphService

  beforeEach(() => {
    dataRoot = trackTmp('evoresearch-label-')
    svc = new ChatGraphService(dataRoot)
  })

  it('memory 边 label 保存/读取往返', () => {
    const graph: ChatGraph = {
      nodes: [
        { id: 'c1', type: 'chat', title: '讨论', x: 0, y: 0, sessionId: 's1' },
        { id: 'm1', type: 'memory', title: '论文', x: 1, y: 1, ref: { kind: 'pdf', path: 'p.pdf' }, scope: 'project' },
      ],
      edges: [{ id: 'e1', from: 'm1', to: 'c1', toPort: 'memory', label: '这篇论文启发了这个 Idea' }],
    }
    assert.equal(svc.save('demo', graph).ok, true)
    assert.deepEqual(svc.get('demo').edges[0]?.label, '这篇论文启发了这个 Idea')
  })

  it('context 边不允许附加说明（系统语义保持纯净）', () => {
    const graph: ChatGraph = {
      nodes: [
        { id: 'a', type: 'chat', title: 'A', x: 0, y: 0, sessionId: 'sa' },
        { id: 'b', type: 'chat', title: 'B', x: 1, y: 1, sessionId: 'sb' },
      ],
      edges: [{ id: 'e1', from: 'a', to: 'b', toPort: 'context', label: '分叉说明' }],
    }
    const result = svc.save('demo', graph)
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /context 连线不允许附加说明/)
  })

  it('addEdge 携带 label 落盘；label 为空的边正常', () => {
    const m = svc.addNode('demo', { type: 'memory', title: 'M', x: 0, y: 0, content: 'x', scope: 'project' })
    const c = svc.addNode('demo', { type: 'chat', title: 'C', x: 1, y: 1, sessionId: 'sc' })
    const edge = svc.addEdge('demo', { from: m.id, to: c.id, toPort: 'memory', label: '实验反驳了上面的猜测' })
    assert.equal(svc.get('demo').edges.find((e) => e.id === edge.id)?.label, '实验反驳了上面的猜测')
    const plain = svc.addEdge('demo', { from: m.id, to: c.id, toPort: 'memory' })
    assert.equal(svc.get('demo').edges.find((e) => e.id === plain.id)?.label, undefined)
  })
})

// ── GRAPH-09：删除图节点/连线不删除目标资料 ────────────────────────────────

describe('GRAPH-09：删除节点/连线只删视图引用，不删目标资料', () => {
  let dataRoot: string
  let projectDir: string
  let svc: ChatGraphService
  let prevHome: string | undefined

  beforeEach(() => {
    prevHome = process.env.DSH_HOME
    process.env.DSH_HOME = trackTmp('evoresearch-del-')
    dataRoot = trackTmp('evoresearch-del2-')
    projectDir = path.join(dataRoot, 'projects', 'demo')
    fs.mkdirSync(projectDir, { recursive: true })
    svc = new ChatGraphService(dataRoot)
  })
  afterEach(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
  })

  it('删除引用节点后目标文件仍在（节点只是视图引用）', () => {
    const file = path.join(projectDir, 'note.md')
    fs.writeFileSync(file, '重要内容', 'utf8')
    const node = svc.addNode('demo', { type: 'memory', title: '笔记', x: 0, y: 0, scope: 'project', ref: { kind: 'file', path: 'note.md' } })
    assert.equal(svc.previewOf(node, projectDir).ok, true)
    // 删除 = 从图里移除节点（连带其边），图保存
    const graph = svc.get('demo')
    const next = { nodes: graph.nodes.filter((n) => n.id !== node.id), edges: graph.edges.filter((e) => e.from !== node.id && e.to !== node.id) }
    assert.equal(svc.save('demo', next).ok, true)
    assert.equal(svc.get('demo').nodes.length, 0)
    // 目标文件安然无恙
    assert.equal(fs.readFileSync(file, 'utf8'), '重要内容')
  })

  it('删除 chat 节点后关联会话文件仍在（会话独立于图）', () => {
    writeSession('kept-session', [{ type: 'user/message', seq: 0, time: 1, data: { text: '会话内容' } }])
    const node = svc.addNode('demo', { type: 'chat', title: '聊天', x: 0, y: 0, sessionId: 'kept-session' })
    const graph = svc.get('demo')
    const next = { nodes: graph.nodes.filter((n) => n.id !== node.id), edges: [] }
    assert.equal(svc.save('demo', next).ok, true)
    // 会话日志仍存在
    const dir = path.join(process.env.DSH_HOME ?? '', 'sessions', 'w1', 'kept-session')
    assert.equal(fs.existsSync(path.join(dir, 'session.jsonl')), true)
  })

  it('删除连线不删除两端节点与资料', () => {
    const m = svc.addNode('demo', { type: 'memory', title: 'M', x: 0, y: 0, content: 'x', scope: 'project' })
    const c = svc.addNode('demo', { type: 'chat', title: 'C', x: 1, y: 1, sessionId: 'sc' })
    const edge = svc.addEdge('demo', { from: m.id, to: c.id, toPort: 'memory' })
    const graph = svc.get('demo')
    const next = { ...graph, edges: graph.edges.filter((e) => e.id !== edge.id) }
    assert.equal(svc.save('demo', next).ok, true)
    assert.equal(svc.get('demo').edges.length, 0)
    assert.equal(svc.get('demo').nodes.length, 2)
  })
})
