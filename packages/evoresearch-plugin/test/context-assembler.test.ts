/**
 * CTX-12 ContextAssembler 回归测试（纯函数/结构 fake 级，无 DSH 运行时）。
 *
 * 覆盖上下文组装的三类核心场景与相邻项：
 * - Graph 连接优先（CTX-07：加权不屏蔽）；
 * - 跨分支防混淆（CTX-02：会话作用域，无 lastActiveSessionId 全局状态）；
 * - embedding 失败降级（CTX-04/12：缺失/抛错都不中断组装）；
 * - 查询改写（CTX-05：自然语言描述，失败降级原文）；
 * - 快速路径来源组合（CTX-03）；深入路径邻域/前后文（CTX-04）；
 * - token 预算（CTX-11：低相关内容不填满预算）；渲染（CTX-08）；
 * - 效果信号（CTX-10）与预览/排除（CTX-09）。
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ChatGraph, GraphNode } from '../src/host/chat-graph.js'
import {
  ContextAssembler,
  DEFAULT_ASSEMBLE_TOKEN_BUDGET,
  REWRITE_SYSTEM_PROMPT,
  questionIdOf,
  type ContextAssemblerDeps,
} from '../src/host/context/assembler.js'
import {
  boostGraphConnections,
  makeCandidate,
  mergeCandidates,
  selectWithinBudget,
  searchFast,
  matchParagraphs,
  type MemoryStoreLike,
  type NotesServiceLike,
} from '../src/host/context/search.js'
import { renderReadingMaterial } from '../src/host/context/render.js'

// ── 结构 fake ──────────────────────────────────────────────────────────────

interface FakeTurn {
  turnId: string
  sessionId: string
  userText: string
  assistantText: string
  status: string
  createdAt: number
  updatedAt: number
}

function makeStore(turns: FakeTurn[], segments: Record<string, Array<{ segmentId: string; kind: string; payload: string }>> = {}): MemoryStoreLike {
  return {
    searchTurnsFts(query: string, limit: number) {
      // 简化 FTS：4-gram 子串命中（近似 FTS5 trigram 对中文的切分行为）；
      // 查询短于 4 字符时退回整串包含。
      const q = query.toLowerCase()
      const ngrams = new Set<string>()
      for (let i = 0; i + 4 <= q.length; i++) ngrams.add(q.slice(i, i + 4))
      return turns
        .filter((turn) => {
          const text = `${turn.userText} ${turn.assistantText}`.toLowerCase()
          if (ngrams.size === 0) return q !== '' && text.includes(q)
          for (const ngram of ngrams) {
            if (text.includes(ngram)) return true
          }
          return false
        })
        .map((turn, index) => ({ turn, score: 10 - index }))
        .slice(0, limit)
    },
    searchObservationsFts(query: string, limit: number) {
      return []
        .slice(0, limit)
        .map(() => ({ observation: { observationId: 'o1', title: '观察', content: '', categories: [], status: 'active' }, score: 1 }))
    },
    listTurns(sessionId?: string) {
      return sessionId === undefined ? turns : turns.filter((turn) => turn.sessionId === sessionId)
    },
    getTurn(turnId: string) {
      return turns.find((turn) => turn.turnId === turnId)
    },
    listSegments(turnId: string) {
      return (segments[turnId] ?? []).map((segment, index) => ({ ...segment, seq: index, createdAt: 0 }))
    },
  }
}

function makeNotes(notes: Array<{ noteId: string; title: string; paragraphs: string[] }>, researchMap = ''): NotesServiceLike {
  return {
    searchIndex(input) {
      const lower = input.query.toLowerCase()
      const hits: Array<{ noteId: string; title: string; snippet: string; offset: number; score: number }> = []
      for (const note of notes) {
        note.paragraphs.forEach((paragraph, index) => {
          if (paragraph.toLowerCase().includes(lower)) {
            hits.push({ noteId: note.noteId, title: note.title, snippet: paragraph, offset: index * 100, score: 5 - hits.length })
          }
        })
      }
      return hits.slice(0, input.limit ?? 8)
    },
    readAllBackgroundDocs() {
      return { researchMap: { kind: 'researchMap', exists: researchMap !== '', content: researchMap } }
    },
  }
}

function chatNode(id: string, sessionId: string, title: string): GraphNode {
  return { id, type: 'chat', title, sessionId, x: 0, y: 0 }
}

function memoryNode(id: string, title: string, content: string): GraphNode {
  return { id, type: 'memory', title, content, x: 0, y: 0 }
}

// ── CTX-07 Graph 连接优先 ──────────────────────────────────────────────────

describe('CTX-07 Graph 连接优先（加权不屏蔽）', () => {
  const store = makeStore([
    { turnId: 't-a', sessionId: 's1', userText: '混合检索的 RRF 融合', assistantText: '答案 A', status: 'completed', createdAt: 1, updatedAt: 1 },
    { turnId: 't-b', sessionId: 's1', userText: '纯向量检索的缺点', assistantText: '答案 B', status: 'completed', createdAt: 2, updatedAt: 2 },
  ])
  const notes = makeNotes([])

  it('Graph 连接候选排序优先于同分 FTS 命中', () => {
    const graphCandidate = makeCandidate({
      kind: 'graph', id: 'm1', title: '记忆节点', snippet: '我们决定放弃纯向量检索，原因是……', score: 20, connected: true,
      location: { kind: 'graph', nodeId: 'm1' }, sourceLabel: 'Graph 明确连接',
    })
    const result = searchFast(store, notes, {
      sessionId: 's1', query: '向量检索', graphCandidates: [graphCandidate],
    })
    assert.equal(result[0]?.id, 'm1')
    assert.equal(result[0]?.connected, true)
  })

  it('boostGraphConnections 加权 ×1.5，未连接候选不被屏蔽', () => {
    const candidates = [
      makeCandidate({ kind: 'turn', id: 't-a', title: 'A', snippet: 'x', score: 10, connected: false, location: { kind: 'turn', turnId: 't-a' }, sourceLabel: '聊天' }),
      makeCandidate({ kind: 'turn', id: 't-b', title: 'B', snippet: 'y', score: 10, connected: false, location: { kind: 'turn', turnId: 't-b' }, sourceLabel: '聊天' }),
      makeCandidate({ kind: 'graph', id: 'm1', title: 'M', snippet: 'z', score: 10, connected: false, location: { kind: 'graph', nodeId: 'm1' }, sourceLabel: '图' }),
    ]
    const boosted = boostGraphConnections(candidates, ['m1'])
    assert.equal(boosted.find((c) => c.id === 'm1')?.score, 15)
    assert.equal(boosted.find((c) => c.id === 'm1')?.connected, true)
    // 未连接的 t-a / t-b 分数不变且仍然存在（不屏蔽）
    assert.equal(boosted.find((c) => c.id === 't-a')?.score, 10)
    assert.equal(boosted.length, 3)
  })

  it('mergeCandidates 按 (kind:id) 去重保留高分', () => {
    const a = makeCandidate({ kind: 'turn', id: 't1', title: 'A', snippet: 'a', score: 3, connected: false, location: { kind: 'turn', turnId: 't1' }, sourceLabel: 'x' })
    const b = makeCandidate({ kind: 'turn', id: 't1', title: 'A', snippet: 'a', score: 8, connected: false, location: { kind: 'turn', turnId: 't1' }, sourceLabel: 'x' })
    const merged = mergeCandidates([a], [b])
    assert.equal(merged.length, 1)
    assert.equal(merged[0]?.score, 8)
  })
})

// ── CTX-02 跨分支防混淆 ────────────────────────────────────────────────────

describe('CTX-02 跨分支防混淆（会话作用域）', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-asmb-'))
  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  })

  function depsFor(graph: ChatGraph): ContextAssemblerDeps {
    return {
      store: makeStore([
        { turnId: 't1', sessionId: 's1', userText: '分支 A 的问题', assistantText: '分支 A 的回答', status: 'completed', createdAt: 1, updatedAt: 1 },
        { turnId: 't2', sessionId: 's2', userText: '分支 B 的问题', assistantText: '分支 B 的回答', status: 'completed', createdAt: 2, updatedAt: 2 },
      ]),
      notes: makeNotes([]),
      chatGraph: { get: () => graph },
      recentChatText: (sessionId) => `最近消息[${sessionId}]`,
      dataRoot: tmpDir,
    }
  }

  it('会话 A 的组装只注入 A 的 Graph 连接与最近消息', async () => {
    const graph: ChatGraph = {
      nodes: [chatNode('n-a', 's1', '分支A'), chatNode('n-b', 's2', '分支B'), memoryNode('m-a', '记忆A', '仅属于分支 A 的记忆内容'), memoryNode('m-b', '记忆B', '仅属于分支 B 的记忆内容')],
      edges: [
        { id: 'e1', from: 'm-a', to: 'n-a', toPort: 'memory' },
        { id: 'e2', from: 'm-b', to: 'n-b', toPort: 'memory' },
      ],
    }
    const assembler = new ContextAssembler(depsFor(graph), { dataRoot: tmpDir })
    const result = await assembler.assemble({ sessionId: 's1', userQuestion: '分支 A 的问题', projectName: 'p1' })
    assert.ok(result.text.includes('仅属于分支 A 的记忆内容'))
    assert.ok(!result.text.includes('仅属于分支 B 的记忆内容'))
    assert.ok(result.text.includes('最近消息[s1]'))
    assert.ok(!result.text.includes('最近消息[s2]'))
  })

  it('连续组装两个会话互不串包（无 lastActiveSessionId 状态）', async () => {
    const graph: ChatGraph = {
      nodes: [chatNode('n-a', 's1', '分支A'), chatNode('n-b', 's2', '分支B'), memoryNode('m-a', '记忆A', '内容 AAAA'), memoryNode('m-b', '记忆B', '内容 BBBB')],
      edges: [
        { id: 'e1', from: 'm-a', to: 'n-a', toPort: 'memory' },
        { id: 'e2', from: 'm-b', to: 'n-b', toPort: 'memory' },
      ],
    }
    const assembler = new ContextAssembler(depsFor(graph), { dataRoot: tmpDir })
    const first = await assembler.assemble({ sessionId: 's1', userQuestion: 'q1', projectName: 'p1' })
    const second = await assembler.assemble({ sessionId: 's2', userQuestion: 'q2', projectName: 'p1' })
    assert.ok(first.text.includes('内容 AAAA'))
    assert.ok(!first.text.includes('内容 BBBB'))
    assert.ok(second.text.includes('内容 BBBB'))
    assert.ok(!second.text.includes('内容 AAAA'))
    assert.equal(first.sessionId, 's1')
    assert.equal(second.sessionId, 's2')
  })
})

// ── CTX-12 embedding 失败降级 / CTX-05 查询改写 ────────────────────────────

describe('CTX-04/12 embedding 与 CTX-05 查询改写（失败降级不中断）', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-asmb-'))
  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  })

  const store = makeStore([
    { turnId: 't1', sessionId: 's1', userText: '第一次尝试混合检索', assistantText: '我们对比了两种方案', status: 'completed', createdAt: 1, updatedAt: 1 },
  ])
  const notes = makeNotes([])
  const graph: ChatGraph = { nodes: [chatNode('n1', 's1', '分支')], edges: [] }

  it('embedding 提供者抛错 → 深入路径仍成功，结果含 FTS 命中', async () => {
    const embeddings = {
      ready: true,
      async embed(): Promise<number[]> { throw new Error('embedding 服务不可用') },
      similarity(): number { return 1 },
    }
    const assembler = new ContextAssembler({
      store, notes, chatGraph: { get: () => graph }, embeddings, dataRoot: tmpDir,
    })
    const result = await assembler.assembleDeep({ sessionId: 's1', userQuestion: '混合检索', projectName: 'p1' })
    assert.ok(result.text.includes('第一次尝试混合检索'))
    assert.ok(result.degraded.some((item) => item.includes('embedding')))
  })

  it('embedding 缺失（undefined）→ 静默降级，degraded 说明', async () => {
    const assembler = new ContextAssembler({ store, notes, chatGraph: { get: () => graph }, dataRoot: tmpDir })
    const result = await assembler.assembleDeep({ sessionId: 's1', userQuestion: '混合检索', projectName: 'p1' })
    assert.ok(result.text.includes('第一次尝试混合检索'))
    assert.ok(result.degraded.some((item) => item.includes('embedding')))
  })

  it('查询改写成功 → 改写后的自然语言描述参与检索', async () => {
    let called = false
    const llm = {
      async callText(options: { messages: string[] }): Promise<string> {
        called = true
        assert.equal(options.messages[0], '用户问题原文')
        return '用户正在比较两个检索方案，需要找回以前放弃纯向量检索的原因与相关实验结果'
      },
    }
    const assembler = new ContextAssembler({
      store: makeStore([
        { turnId: 't-r', sessionId: 's1', userText: '放弃纯向量检索的原因', assistantText: '因为召回率不足', status: 'completed', createdAt: 1, updatedAt: 1 },
      ]),
      notes,
      chatGraph: { get: () => graph },
      llm,
      dataRoot: tmpDir,
    })
    const result = await assembler.assembleDeep({ sessionId: 's1', userQuestion: '用户问题原文', projectName: 'p1' })
    assert.equal(called, true)
    assert.ok(result.text.includes('放弃纯向量检索的原因'))
  })

  it('查询改写失败 → 使用原文，degraded 记录', async () => {
    const llm = {
      async callText(): Promise<string> { throw new Error('模型不可用') },
    }
    const assembler = new ContextAssembler({ store, notes, chatGraph: { get: () => graph }, llm, dataRoot: tmpDir })
    const result = await assembler.assembleDeep({ sessionId: 's1', userQuestion: '混合检索', projectName: 'p1' })
    assert.ok(result.text.includes('第一次尝试混合检索'))
    assert.ok(result.degraded.some((item) => item.includes('改写失败') || item.includes('不可用')))
  })

  it('REWRITE_SYSTEM_PROMPT 是自然语言描述指令（无固定科研阶段分类）', () => {
    assert.ok(REWRITE_SYSTEM_PROMPT.includes('本轮需要找回什么'))
    assert.ok(!REWRITE_SYSTEM_PROMPT.includes('idea/experiment'))
  })
})

// ── CTX-03 快速路径来源组合 ────────────────────────────────────────────────

describe('CTX-03 快速路径来源组合', () => {
  it('最近消息 + Graph 连接 + FTS 轮次 + 笔记段落 + 研究近况页段落', () => {
    const store = makeStore([
      { turnId: 't1', sessionId: 's1', userText: 'RRF 融合实验', assistantText: '结果不错', status: 'completed', createdAt: 1, updatedAt: 1 },
    ])
    const notes = makeNotes(
      [{ noteId: 'n1', title: '检索笔记', paragraphs: ['RRF 融合的参数调优记录'] }],
      '研究近况\n\n我们最近比较了 RRF 与加权求和两种融合方式。\n\n其他内容',
    )
    const graphCandidate = makeCandidate({
      kind: 'graph', id: 'm1', title: '决策记忆', snippet: '决定采用混合检索', score: 20, connected: true,
      location: { kind: 'graph', nodeId: 'm1' }, sourceLabel: 'Graph 明确连接',
    })
    const result = searchFast(store, notes, {
      sessionId: 's1', query: 'RRF', recentChatText: '最近: 讨论 RRF 参数', graphCandidates: [graphCandidate],
    })
    const kinds = new Set(result.map((candidate) => candidate.kind))
    assert.ok(kinds.has('chat')) // 最近消息
    assert.ok(kinds.has('graph')) // Graph 连接
    assert.ok(kinds.has('turn')) // FTS 轮次
    assert.ok(kinds.has('note')) // 笔记段落
    assert.ok(kinds.has('background')) // 研究近况页
  })

  it('matchParagraphs 确定性相关段落匹配', () => {
    const content = '第一段：讨论了 A 方案。\n\n第二段：B 方案的实验结果显示精度提升。\n\n第三段：与主题无关。'
    const hits = matchParagraphs(content, '实验 精度')
    assert.equal(hits.length, 1)
    assert.ok(hits[0]?.includes('B 方案'))
  })

  it('searchFast 不抛异常（来源失败被降级跳过）', () => {
    const brokenStore: MemoryStoreLike = {
      searchTurnsFts() { throw new Error('FTS 损坏') },
      searchObservationsFts() { throw new Error('损坏') },
      listTurns() { return [] },
      getTurn() { return undefined },
      listSegments() { return [] },
    }
    const result = searchFast(brokenStore, makeNotes([]), { sessionId: 's1', query: 'x' })
    assert.ok(Array.isArray(result))
  })
})

// ── CTX-11 token 预算 / CTX-08 渲染 ────────────────────────────────────────

describe('CTX-11 token 预算（低相关不填满预算）', () => {
  it('selectWithinBudget 按分数注入、超额裁剪、不填充', () => {
    const candidates = [
      makeCandidate({ kind: 'turn', id: 't1', title: 'A', snippet: 'x'.repeat(300), score: 10, connected: false, location: { kind: 'turn', turnId: 't1' }, sourceLabel: 'x' }), // ~100 token
      makeCandidate({ kind: 'turn', id: 't2', title: 'B', snippet: 'y'.repeat(300), score: 9, connected: false, location: { kind: 'turn', turnId: 't2' }, sourceLabel: 'x' }),
      makeCandidate({ kind: 'turn', id: 't3', title: 'C', snippet: 'z'.repeat(300), score: 8, connected: false, location: { kind: 'turn', turnId: 't3' }, sourceLabel: 'x' }),
    ]
    const selection = selectWithinBudget(candidates, 120)
    assert.equal(selection.included.length, 1)
    assert.equal(selection.included[0]?.id, 't1')
    assert.equal(selection.excluded.length, 2)
    assert.deepEqual(selection.prunedIds, ['t2', 't3'])
  })

  it('预算充足时全部注入；零候选不填充', () => {
    const candidates = [
      makeCandidate({ kind: 'turn', id: 't1', title: 'A', snippet: 'x'.repeat(90), score: 5, connected: false, location: { kind: 'turn', turnId: 't1' }, sourceLabel: 'x' }),
    ]
    assert.equal(selectWithinBudget(candidates, 100).included.length, 1)
    assert.equal(selectWithinBudget([], 100).included.length, 0)
  })

  it('组装整体受 token 预算约束（小预算 → 片段被截断但继续读取入口保留）', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-asmb-'))
    after(() => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
    })
    const store = makeStore([
      { turnId: 't1', sessionId: 's1', userText: `q ${'A'.repeat(9000)}`, assistantText: 'B'.repeat(9000), status: 'completed', createdAt: 1, updatedAt: 1 },
    ])
    const assembler = new ContextAssembler({
      store,
      notes: makeNotes([]),
      chatGraph: { get: () => ({ nodes: [chatNode('n1', 's1', '分支')], edges: [] }) },
      dataRoot: tmpDir,
    })
    const result = await assembler.assemble({
      sessionId: 's1', userQuestion: 'q', projectName: 'p1',
      options: { tokenBudget: 40 },
    })
    assert.ok(result.text.includes('继续深入读取'))
    assert.ok(result.effects.prunedIds.length > 0)
    assert.ok(result.estimatedTokens <= DEFAULT_ASSEMBLE_TOKEN_BUDGET * 2) // 预算 40 token 的渲染文本不应失控
  })
})

describe('CTX-08 渲染为可读 Markdown 阅读材料', () => {
  it('渲染含问题/背景/片段定位/继续读取入口', () => {
    const rendered = renderReadingMaterial({
      sessionId: 's1',
      question: '比较两种检索方案',
      branchBackground: '最近在讨论 RRF 与向量检索。',
      snippets: [
        { id: 't1', kind: 'turn', title: '放弃纯向量检索', text: '原因是召回率不足。', location: 'turn:t1' },
      ],
      continueRead: [{ label: '阅读轮次', hint: 'read_research_turn(turnId=t1)', location: 'turn:t1' }],
    })
    assert.ok(rendered.text.startsWith('<context_reading_material>'))
    assert.ok(rendered.text.includes('## 当前问题'))
    assert.ok(rendered.text.includes('## 当前分支背景'))
    assert.ok(rendered.text.includes('## 相关原文片段'))
    assert.ok(rendered.text.includes('[定位: turn:t1]'))
    assert.ok(rendered.text.includes('## 继续深入读取'))
    assert.ok(rendered.text.includes('read_research_turn(turnId=t1)'))
    assert.ok(rendered.estimatedTokens > 0)
    assert.ok(rendered.sections.length >= 4)
  })

  it('定位行格式', () => {
    const rendered = renderReadingMaterial({
      sessionId: 's1', question: 'q',
      snippets: [{ id: 'n1', kind: 'note', title: '笔记', text: '正文', location: 'note:n1@200' }],
    })
    assert.ok(rendered.text.includes('[定位: note:n1@200]'))
  })
})

// ── CTX-01/09/10 组装入口、预览与效果信号 ──────────────────────────────────

describe('CTX-01/09/10 组装入口、预览、效果信号', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-asmb-'))
  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  })

  function makeAssembler(): { assembler: ContextAssembler; store: MemoryStoreLike } {
    const store = makeStore([
      { turnId: 't1', sessionId: 's1', userText: '关于混合检索的决定', assistantText: '采用 RRF', status: 'completed', createdAt: 1, updatedAt: 1 },
    ])
    const assembler = new ContextAssembler({
      store,
      notes: makeNotes([]),
      chatGraph: { get: () => ({ nodes: [chatNode('n1', 's1', '分支'), memoryNode('m1', '记忆', '关键记忆内容')], edges: [{ id: 'e1', from: 'm1', to: 'n1', toPort: 'memory' }] }) },
      dataRoot: tmpDir,
    })
    return { assembler, store }
  }

  it('assemble 以 (sessionId, userQuestion) 为唯一入口，输出 Markdown', async () => {
    const { assembler } = makeAssembler()
    const result = await assembler.assemble({ sessionId: 's1', userQuestion: '混合检索', projectName: 'p1' })
    assert.ok(result.text.includes('混合检索'))
    assert.ok(result.text.includes('关键记忆内容'))
    assert.equal(result.questionId, questionIdOf('s1', '混合检索'))
    assert.ok(result.estimatedTokens > 0)
    assert.equal(result.deep, false)
  })

  it('CTX-09 预览列出参考内容与包含状态；excludedIds 移除材料', async () => {
    const { assembler } = makeAssembler()
    const preview = await assembler.preview({ sessionId: 's1', userQuestion: '混合检索', projectName: 'p1' })
    assert.ok(preview.items.length >= 2)
    const graphItem = preview.items.find((item) => item.kind === 'graph')
    assert.equal(graphItem?.included, true)
    assert.equal(graphItem?.reason, 'Graph 明确连接')

    const excluded = await assembler.assemble({
      sessionId: 's1', userQuestion: '混合检索', projectName: 'p1',
      options: { excludedIds: ['m1'] },
    })
    assert.ok(!excluded.text.includes('关键记忆内容'))
    assert.deepEqual(excluded.effects.removedIds, ['m1'])
  })

  it('CTX-10 效果信号：自动登记 + markReadMore + 查询', async () => {
    const { assembler } = makeAssembler()
    const result = await assembler.assemble({ sessionId: 's1', userQuestion: '混合检索', projectName: 'p1' })
    assert.equal(result.effects.sessionId, 's1')
    assert.equal(result.effects.readMore, false)
    assert.ok(result.effects.injected > 0)

    assembler.markReadMore(result.questionId)
    const latest = assembler.queryEffects({ questionId: result.questionId, limit: 1 })[0]
    assert.equal(latest?.readMore, true)
    assert.equal(assembler.queryEffects({ sessionId: 's9' }).length, 0)
  })

  it('includedIds 白名单限制注入', async () => {
    const { assembler } = makeAssembler()
    const result = await assembler.assemble({
      sessionId: 's1', userQuestion: '混合检索', projectName: 'p1',
      options: { includedIds: ['m1'] },
    })
    assert.ok(result.text.includes('关键记忆内容'))
    assert.ok(!result.text.includes('关于混合检索的决定')) // 白名单外的 FTS 命中不注入
  })

  it('深入路径含邻域扩展与前后文片段', async () => {
    const store = makeStore(
      [
        { turnId: 't1', sessionId: 's1', userText: '讨论主题 X', assistantText: '结论', status: 'completed', createdAt: 1, updatedAt: 1 },
      ],
      { t1: [
        { segmentId: 'seg-1', kind: 'assistant', payload: '前后文片段内容 ABC' },
        { segmentId: 'seg-2', kind: 'tool', payload: '工具输出' },
      ] },
    )
    const graph: ChatGraph = {
      nodes: [chatNode('n-a', 's1', '当前分支'), chatNode('n-b', 's2', '兄弟分支'), memoryNode('m1', '记忆', '共享记忆')],
      edges: [
        { id: 'e1', from: 'm1', to: 'n-a', toPort: 'memory' },
        { id: 'e2', from: 'm1', to: 'n-b', toPort: 'memory' },
      ],
    }
    const assembler = new ContextAssembler({
      store, notes: makeNotes([]), chatGraph: { get: () => graph }, dataRoot: tmpDir,
    })
    const result = await assembler.assembleDeep({ sessionId: 's1', userQuestion: '主题 X', projectName: 'p1' })
    assert.ok(result.text.includes('前后文片段内容 ABC'))
    assert.ok(result.text.includes('邻域聊天'))
    assert.equal(result.deep, true)
    // 邻域候选标记 neighborhood
    const neighbor = result.candidates.find((candidate) => candidate.neighborhood === true)
    assert.ok(neighbor !== undefined)
  })
})
