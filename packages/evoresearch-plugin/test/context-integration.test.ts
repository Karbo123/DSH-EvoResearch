/**
 * CTX 窗口保护层（t5）与 ContextAssembler（t10）协同闭环验证。
 *
 * 1. 完整链路：assembler 渲染 → estimateProjectionTokens 估算 →
 *    ContextWindowRuntime.detectPressure 压力判定 → 超阈值 →
 *    planPrune 裁剪计划 + compaction 建议记录；
 * 2. 预算闭环：预算内渲染 → 压力 high → 压缩建议 → 低相关剔除后重组装 → 预算内；
 * 3. 来源映射：assembler 候选（[定位:]）→ candidatesToContextSources →
 *    ContextSourceReport totals 一致；
 * 4. 降级链：llm 不可用（改写失败）→ 原文查询 → 仍产出可读阅读材料；
 * 5. Graph 加权：连接材料排前（×1.5 生效，未连接不屏蔽）。
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ContextAssembler, type ContextAssemblerDeps } from '../src/host/context/assembler.js'
import { ContextWindowRuntime } from '../src/host/context/guard.js'
import { estimateProjectionTokens, computePressure, resolveWindowTokens } from '../src/host/context/window.js'
import { planPrune, DEFAULT_PRUNE_BUDGET } from '../src/host/context/pruner.js'
import { candidatesToContextSources } from '../src/host/context/sources.js'
import { searchFast, makeCandidate, boostGraphConnections } from '../src/host/context/search.js'
import type { MemoryStoreLike, NotesServiceLike } from '../src/host/context/search.js'
import type { ChatGraph, GraphNode } from '../src/host/chat-graph.js'

// ── 结构 fake（与 context-assembler.test.ts 同形）──────────────────────────

interface FakeTurn {
  turnId: string
  sessionId: string
  userText: string
  assistantText: string
  status: string
  createdAt: number
  updatedAt: number
}

function makeStore(turns: FakeTurn[]): MemoryStoreLike {
  return {
    searchTurnsFts(query: string, limit: number) {
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
    searchObservationsFts() { return [] },
    listTurns(sessionId?: string) {
      return sessionId === undefined ? turns : turns.filter((turn) => turn.sessionId === sessionId)
    },
    getTurn(turnId: string) {
      return turns.find((turn) => turn.turnId === turnId)
    },
    listSegments() { return [] },
  }
}

function makeNotes(): NotesServiceLike {
  return {
    searchIndex(input) {
      return input.query.includes('笔记') || input.query.includes('检索')
        ? [{ noteId: 'n1', title: '检索笔记', snippet: 'RRF 融合参数调优记录', offset: 0, score: 5 }]
        : []
    },
    readAllBackgroundDocs() {
      return { researchMap: { kind: 'researchMap', exists: false, content: '' } }
    },
  }
}

function chatNode(id: string, sessionId: string, title: string): GraphNode {
  return { id, type: 'chat', title, sessionId, x: 0, y: 0 }
}

function memoryNode(id: string, title: string, content: string): GraphNode {
  return { id, type: 'memory', title, content, x: 0, y: 0 }
}

function tmpDataRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-integ-'))
}

function depsFor(store: MemoryStoreLike, graph: ChatGraph, extra: Partial<ContextAssemblerDeps> = {}, dataRoot?: string): ContextAssemblerDeps {
  return {
    store,
    notes: makeNotes(),
    chatGraph: { get: () => graph },
    recentChatText: (sessionId) => `最近消息[${sessionId}] ${'近况'.repeat(100)}`,
    dataRoot: dataRoot ?? tmpDataRoot(),
    ...extra,
  }
}

// ── 1. 完整链路 ────────────────────────────────────────────────────────────

describe('完整链路：渲染 → 估算 → 压力 → 裁剪/压缩建议', () => {
  const tmpDir = tmpDataRoot()
  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  })

  it('assembler 输出 → token 估算 → guard 压力判定（high/critical）→ pruner 计划 + compaction 建议', async () => {
    const store = makeStore([
      { turnId: 't1', sessionId: 's1', userText: '混合检索方案的 RRF 融合实验', assistantText: '精度提升 2 个点', status: 'completed', createdAt: 1, updatedAt: 1 },
      { turnId: 't2', sessionId: 's1', userText: '放弃纯向量检索的原因', assistantText: '召回率不足', status: 'completed', createdAt: 2, updatedAt: 2 },
    ])
    const graph: ChatGraph = {
      nodes: [chatNode('n1', 's1', '分支'), memoryNode('m1', '决策记忆', '决定采用混合检索，RRF 融合为主')],
      edges: [{ id: 'e1', from: 'm1', to: 'n1', toPort: 'memory' }],
    }
    const assembler = new ContextAssembler(depsFor(store, graph, {}, tmpDir), { dataRoot: tmpDir })
    const result = await assembler.assemble({ sessionId: 's1', userQuestion: '混合检索 RRF', projectName: 'p1' })

    // 1a) 渲染 → 估算
    assert.ok(result.text.startsWith('<context_reading_material>'))
    const estimated = estimateProjectionTokens(result.text)
    assert.ok(estimated > 0)
    assert.equal(estimated, result.estimatedTokens)

    // 1b) 估算 → 压力判定（经真实 guard 的启发式路径：deriveMessages 投影）
    const guard = new ContextWindowRuntime({ dataRoot: tmpDir, windowCatalog: { windowTokens: 300 } })
    assert.equal(resolveWindowTokens('deepseek-v4-flash', { windowTokens: 300 }), 300)
    const fakeSession = {
      id: 's1',
      deriveMessages: () => [{ role: 'assistant', content: [{ type: 'text', text: result.text }] }],
    }
    const report = guard.detectPressure(fakeSession, 'deepseek-v4-flash')
    assert.equal(report.windowTokens, 300)
    assert.equal(report.source, 'heuristic')
    assert.ok(['high', 'critical'].includes(report.level), `压力等级应为 high/critical，实际 ${report.level}`)
    assert.equal(report.triggerAutoCompact, true)
    if (report.level === 'critical') assert.equal(report.triggerOverflowRecovery, true)

    // 1c) 超阈值 → pruner 计划（长工具结果按预算裁剪）
    const longToolResult = 'D'.repeat(9000)
    const plan = planPrune(longToolResult, DEFAULT_PRUNE_BUDGET)
    assert.equal(plan.action, 'prune')
    assert.equal(plan.continueOffset, 4000)
    assert.ok(plan.removedChars > 0)
    const prunedText = plan.head + plan.middle + plan.tail
    assert.ok(prunedText.length < longToolResult.length)

    // 1d) 超阈值 → compaction 建议（登记事件，接口待接——不抛异常）
    const suggestion = {
      compactionId: 'suggest-1',
      sessionId: 's1',
      trigger: 'auto' as const,
      status: 'degraded-noop' as const,
      startedAt: Date.now(),
      source: 'evoresearch' as const,
      degradedReason: `协同验证：压力 ${Math.round(report.ratio * 100)}% 超阈值，DSH 压缩引擎未接入，建议已登记`,
    }
    guard.compactionLog.append(suggestion)
    const found = guard.queryCompactions({ sessionId: 's1' })
    assert.equal(found.length, 1)
    assert.equal(found[0]?.compactionId, 'suggest-1')
    assert.equal(found[0]?.status, 'degraded-noop')
  })

  it('computePressure 纯函数与 guard 报告一致（同一窗口规格）', () => {
    const estimated = estimateProjectionTokens('测试文本'.repeat(200))
    const direct = computePressure({ sessionId: 's1', estimatedTokens: estimated, windowTokens: 300 })
    const guard = new ContextWindowRuntime({ dataRoot: tmpDir, windowCatalog: { windowTokens: 300 } })
    const viaGuard = guard.detectPressure(
      { id: 's1', deriveMessages: () => [{ role: 'assistant', content: [{ type: 'text', text: '测试文本'.repeat(200) }] }] },
      'deepseek-v4-flash',
    )
    assert.equal(viaGuard.level, direct.level)
    assert.equal(viaGuard.ratio, direct.ratio)
  })
})

// ── 2. 预算闭环 ────────────────────────────────────────────────────────────

describe('预算闭环：预算内渲染 → 压力高 → 建议 → 剔除低相关重组装 → 预算内', () => {
  const tmpDir = tmpDataRoot()
  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  })

  it('首轮预算内 → guard 压力 high → 压缩建议 → 排除低分候选重组装后 token 下降且仍在预算内', async () => {
    const turns: FakeTurn[] = Array.from({ length: 6 }, (_, index) => ({
      turnId: `t${index + 1}`,
      sessionId: 's1',
      userText: `混合检索实验 ${index + 1} 的详细记录：RRF 融合、参数调优与对比分析。${'细节'.repeat(90)}`,
      assistantText: `第 ${index + 1} 次实验的结论与数据。${'结果'.repeat(145)}`,
      status: 'completed',
      createdAt: index + 1,
      updatedAt: index + 1,
    }))
    const store = makeStore(turns)
    const graph: ChatGraph = {
      nodes: [chatNode('n1', 's1', '分支'), memoryNode('m1', '记忆', 'Graph 连接的关键决策内容')],
      edges: [{ id: 'e1', from: 'm1', to: 'n1', toPort: 'memory' }],
    }
    const assembler = new ContextAssembler(depsFor(store, graph, {}, tmpDir), { dataRoot: tmpDir })

    // 2a) 首轮：预算 6000 内渲染
    const first = await assembler.assemble({ sessionId: 's1', userQuestion: '混合检索', projectName: 'p1' })
    const firstTokens = first.included.reduce((sum, candidate) => sum + candidate.estimatedTokens, 0)
    assert.ok(firstTokens <= 6000, `首轮候选 token ${firstTokens} 应在预算 6000 内`)

    // 2b) guard 压力判定（小窗口模拟长会话接近上限）
    const guard = new ContextWindowRuntime({ dataRoot: tmpDir, windowCatalog: { windowTokens: 2000 } })
    const report = guard.detectPressure(
      { id: 's1', deriveMessages: () => [{ role: 'assistant', content: [{ type: 'text', text: first.text }] }] },
      'deepseek-v4-flash',
    )
    assert.ok(report.triggerAutoCompact, `压力 ${report.level} 应触发自动压缩建议`)
    guard.compactionLog.append({
      compactionId: 'suggest-loop',
      sessionId: 's1',
      trigger: 'auto',
      status: 'degraded-noop',
      startedAt: Date.now(),
      source: 'evoresearch',
      degradedReason: `预算闭环验证：压力 ${Math.round(report.ratio * 100)}%，建议压缩或剔除低相关`,
    })

    // 2c) 剔除低相关（排除分数最低的 3 个候选 id）→ 重组装 → 预算内且 token 下降
    const lowScoreIds = first.included.slice(-3).map((candidate) => candidate.id)
    const second = await assembler.assemble({
      sessionId: 's1', userQuestion: '混合检索', projectName: 'p1',
      options: { excludedIds: lowScoreIds },
    })
    const secondTokens = second.included.reduce((sum, candidate) => sum + candidate.estimatedTokens, 0)
    assert.ok(secondTokens <= 6000, `重组装 token ${secondTokens} 仍在预算内`)
    assert.ok(secondTokens < firstTokens, `剔除低相关后 token 应下降（${secondTokens} < ${firstTokens}）`)
    assert.ok(second.estimatedTokens < first.estimatedTokens)
    // 效果信号记录了移除
    assert.deepEqual([...second.effects.removedIds].sort(), [...lowScoreIds].sort())

    // 2d) 收紧预算也成立：更小预算 → 注入更少
    const tight = await assembler.assemble({
      sessionId: 's1', userQuestion: '混合检索', projectName: 'p1',
      options: { tokenBudget: 200 },
    })
    const tightTokens = tight.included.reduce((sum, candidate) => sum + candidate.estimatedTokens, 0)
    assert.ok(tightTokens <= 200)
    assert.ok(tightTokens < secondTokens)
  })
})

// ── 3. 来源映射 ────────────────────────────────────────────────────────────

describe('来源映射：assembler 候选 → ContextSourceReport（CTX-18）', () => {
  const tmpDir = tmpDataRoot()
  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  })

  it('graph/turn/note/chat 候选映射为条目，totals 与 [定位:] 一致', async () => {
    const store = makeStore([
      { turnId: 't1', sessionId: 's1', userText: '检索方案对比记录', assistantText: '结论', status: 'completed', createdAt: 1, updatedAt: 1 },
    ])
    const graph: ChatGraph = {
      nodes: [chatNode('n1', 's1', '分支'), memoryNode('m1', '记忆', '连接内容')],
      edges: [{ id: 'e1', from: 'm1', to: 'n1', toPort: 'memory' }],
    }
    const assembler = new ContextAssembler(depsFor(store, graph, {}, tmpDir), { dataRoot: tmpDir })
    const result = await assembler.assemble({ sessionId: 's1', userQuestion: '检索方案', projectName: 'p1' })

    // 3a) 候选 → 来源条目
    const entries = candidatesToContextSources('s1', result.candidates)
    assert.ok(entries.length >= 4, `应有 graph/turn/note/chat 条目，实际 ${entries.length}`)

    const graphEntry = entries.find((entry) => entry.kind === 'graph-connection')
    assert.equal(graphEntry?.id, 'm1')
    assert.deepEqual(graphEntry?.location, { kind: 'graph', nodeId: 'm1' })
    const turnEntry = entries.find((entry) => entry.location.kind === 'turn')
    assert.equal(turnEntry?.location.kind, 'turn')
    if (turnEntry?.location.kind === 'turn') assert.equal(turnEntry.location.turnId, 't1')
    const noteEntry = entries.find((entry) => entry.location.kind === 'note')
    assert.equal(noteEntry?.id, 'n1')
    const chatEntry = entries.find((entry) => entry.location.kind === 'chat')
    assert.equal(chatEntry?.location.kind, 'chat')

    // 3b) totals 统计一致
    const graphCount = entries.filter((entry) => entry.kind === 'graph-connection').length
    const snippetCount = entries.filter((entry) => entry.kind === 'original-snippet').length
    assert.equal(graphCount, 1)
    assert.equal(snippetCount, entries.length - 1)
    const tokenSum = entries.reduce((sum, entry) => sum + entry.estimatedTokens, 0)
    assert.equal(tokenSum, result.candidates.reduce((sum, candidate) => sum + candidate.estimatedTokens, 0))

    // 3c) [定位:] 与条目位置一一对应（渲染文本里出现的定位都能在条目中找到）
    for (const entry of entries) {
      const loc = entry.location
      const tag = loc.kind === 'turn' ? `turn:${loc.turnId}`
        : loc.kind === 'note' ? `note:${loc.noteId}@${loc.offset}`
        : loc.kind === 'graph' ? `graph:${loc.nodeId}`
        : loc.kind === 'chat' ? `chat:${loc.sessionId}`
        : undefined
      if (tag !== undefined) {
        // 注入的候选（included）必须出现在渲染文本；预算裁剪的候选可能只在继续读取入口
        const inText = result.text.includes(`[定位: ${tag}]`) || result.text.includes(`（${tag}）`)
        assert.ok(inText, `定位 ${tag} 应出现在渲染文本（来源: ${entry.id}）`)
      }
    }
  })
})

// ── 4. 降级链 ──────────────────────────────────────────────────────────────

describe('降级链：llm 不可用（改写失败）→ 原文查询 → 仍产出可读材料', () => {
  const tmpDir = tmpDataRoot()
  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  })

  it('assembleDeep 在改写/embedding 全部不可用时仍产出阅读材料', async () => {
    const store = makeStore([
      { turnId: 't1', sessionId: 's1', userText: '放弃纯向量检索的原因与实验记录', assistantText: '召回率不足', status: 'completed', createdAt: 1, updatedAt: 1 },
    ])
    const graph: ChatGraph = { nodes: [chatNode('n1', 's1', '分支')], edges: [] }
    const assembler = new ContextAssembler(depsFor(store, graph, {
      llm: { callText: async () => { throw new Error('模型服务不可用') } },
    }, tmpDir), { dataRoot: tmpDir })

    const result = await assembler.assembleDeep({ sessionId: 's1', userQuestion: '放弃纯向量检索', projectName: 'p1' })
    // 降级说明存在
    assert.ok(result.degraded.length > 0)
    assert.ok(result.degraded.some((item) => item.includes('改写') || item.includes('embedding')))
    // 仍产出可读材料：原文查询命中 + Markdown 结构完整
    assert.ok(result.text.startsWith('<context_reading_material>'))
    assert.ok(result.text.includes('放弃纯向量检索的原因与实验记录'))
    assert.ok(result.text.includes('## 当前问题'))
  })
})

// ── 5. Graph 加权 ──────────────────────────────────────────────────────────

describe('Graph 加权：连接材料排前（×1.5 生效，未连接不屏蔽）', () => {
  const tmpDir = tmpDataRoot()
  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  })

  it('searchFast 中 Graph 连接候选排第一且分数为 ×1.5', () => {
    const store = makeStore([
      { turnId: 't1', sessionId: 's1', userText: '向量检索的讨论', assistantText: 'A', status: 'completed', createdAt: 1, updatedAt: 1 },
    ])
    const graphCandidate = makeCandidate({
      kind: 'graph', id: 'm1', title: '决策记忆', snippet: '决定采用混合检索', score: 20, connected: true,
      location: { kind: 'graph', nodeId: 'm1' }, sourceLabel: 'Graph 明确连接',
    })
    const result = searchFast(store, makeNotes(), {
      sessionId: 's1', query: '向量检索', graphCandidates: [graphCandidate],
    })
    assert.equal(result[0]?.id, 'm1')
    assert.equal(result[0]?.score, 30) // 20 × 1.5
    assert.equal(result[0]?.connected, true)
    // 未连接候选仍然存在（不屏蔽）
    assert.ok(result.some((candidate) => candidate.kind === 'turn'))
  })

  it('boostGraphConnections 纯函数：×1.5 加权、未连接不变', () => {
    const candidates = [
      makeCandidate({ kind: 'turn', id: 't1', title: 'A', snippet: 'x', score: 10, connected: false, location: { kind: 'turn', turnId: 't1' }, sourceLabel: 'x' }),
      makeCandidate({ kind: 'graph', id: 'm1', title: 'M', snippet: 'y', score: 10, connected: false, location: { kind: 'graph', nodeId: 'm1' }, sourceLabel: 'g' }),
    ]
    const boosted = boostGraphConnections(candidates, ['m1'])
    assert.equal(boosted.find((c) => c.id === 'm1')?.score, 15)
    assert.equal(boosted.find((c) => c.id === 't1')?.score, 10)
  })
})
