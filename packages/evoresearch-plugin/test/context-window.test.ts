/**
 * CTX-19 上下文窗口保护层 回归测试（纯函数级，无 sidecar/无 DSH 运行时）。
 *
 * 覆盖：
 * - 不同模型窗口参数化的压力检测 / 自动压缩阈值 / 溢出恢复判定（CTX-14）；
 * - 工具结果头部/中部/尾部裁剪与继续读取偏移（CTX-15）；
 * - compaction 事件折叠、消息范围、摘要版本与查询回读（CTX-16）；
 * - 工具调用序列修复（缺配对/无主/重复），修复前后分别保留（CTX-17）；
 * - 当前上下文来源组成查询（CTX-18）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computePressure,
  estimateProjectionTokens,
  pressureLevel,
  resolveWindowTokens,
  resolveWindowSpec,
  retainedTokensAfterCompaction,
  DEFAULT_WINDOW_SPEC,
  MODEL_WINDOW_CATALOG,
} from '../src/host/context/window.js'
import {
  DEFAULT_PRUNE_BUDGET,
  PRUNE_MARKER,
  codePointLength,
  planPrune,
  pruneToolResultText,
  renderPrunedText,
  sliceCodePoints,
} from '../src/host/context/pruner.js'
import {
  CompactionLog,
  filterCompactions,
  foldCompactionEvent,
  nextSummaryVersion,
  parseCompactionLine,
  toCompactionLine,
} from '../src/host/context/compaction-log.js'
import {
  analyzeToolHistory,
  buildRepairedProjection,
  createRepairRecord,
  serializeProjection,
  type RepairMessage,
} from '../src/host/context/history-repair.js'
import { describeContextSources } from '../src/host/context/sources.js'
import type { CompactionRecord, PruneBudget } from '../src/host/context/types.js'

// ── CTX-14 窗口解析与压力检测（按不同模型窗口参数化）───────────────────────

describe('resolveWindowTokens（不同模型窗口）', () => {
  const windows = Object.entries(MODEL_WINDOW_CATALOG)
  it('catalog 中的每个模型返回其窗口', () => {
    for (const [model, expected] of windows) {
      assert.equal(resolveWindowTokens(model), expected, `model=${model}`)
    }
  })

  it('显式 windowTokens 覆盖 catalog', () => {
    assert.equal(resolveWindowTokens('deepseek-v4', { windowTokens: 32_000 }), 32_000)
  })

  it('windowTokensByModel 覆盖 catalog', () => {
    assert.equal(resolveWindowTokens('deepseek-v4', { windowTokensByModel: { 'deepseek-v4': 256_000 } }), 256_000)
  })

  it('未知模型回退默认窗口', () => {
    assert.equal(resolveWindowTokens('unknown-model-x'), 128_000)
    assert.equal(resolveWindowTokens(undefined), 128_000)
    assert.equal(resolveWindowTokens('unknown-model-x', { defaultWindowTokens: 64_000 }), 64_000)
  })
})

describe('computePressure（参数化：窗口 × 占用比例）', () => {
  // 不同模型窗口下的压力判定表：[窗口, 估算 token, 期望等级]
  const cases: Array<[number, number, string]> = [
    [64_000, 38_000, 'ok'], // 0.59
    [64_000, 39_000, 'watch'], // 0.61
    [128_000, 102_400, 'high'], // 0.80 触发自动压缩
    [128_000, 121_600, 'critical'], // 0.95 触发溢出恢复
    [200_000, 100_000, 'ok'], // 0.50
    [200_000, 190_000, 'critical'],
    [32_000, 32_000, 'critical'],
  ]
  for (const [window, tokens, level] of cases) {
    it(`window=${window} tokens=${tokens} → ${level}`, () => {
      const report = computePressure({
        sessionId: 's1',
        estimatedTokens: tokens,
        windowTokens: window,
      })
      assert.equal(report.level, level)
      assert.equal(report.triggerAutoCompact, level === 'high' || level === 'critical')
      assert.equal(report.triggerOverflowRecovery, level === 'critical')
      assert.equal(report.windowTokens, window)
    })
  }

  it('压力等级边界函数', () => {
    const spec = DEFAULT_WINDOW_SPEC
    assert.equal(pressureLevel(0.59, spec), 'ok')
    assert.equal(pressureLevel(0.6, spec), 'watch')
    assert.equal(pressureLevel(0.79, spec), 'watch')
    assert.equal(pressureLevel(0.8, spec), 'high')
    assert.equal(pressureLevel(0.94, spec), 'high')
    assert.equal(pressureLevel(0.95, spec), 'critical')
  })

  it('自动压缩阈值随窗口缩放（参数化）', () => {
    const specs = [
      { window: 64_000, threshold: 51_200 },
      { window: 128_000, threshold: 102_400 },
      { window: 200_000, threshold: 160_000 },
    ]
    for (const { window, threshold } of specs) {
      const spec = resolveWindowSpec({}, undefined, { windowTokens: window })
      assert.equal(Math.round(spec.windowTokens * spec.autoCompactThresholdRatio), threshold)
      const at = computePressure({ sessionId: 's', estimatedTokens: threshold, windowTokens: window })
      assert.equal(at.triggerAutoCompact, true)
      const below = computePressure({ sessionId: 's', estimatedTokens: threshold - 1, windowTokens: window })
      assert.equal(below.triggerAutoCompact, false)
    }
  })

  it('保留近程 token 预算随窗口缩放', () => {
    assert.equal(retainedTokensAfterCompaction({ ...DEFAULT_WINDOW_SPEC, windowTokens: 64_000 }), 10_240)
    assert.equal(retainedTokensAfterCompaction({ ...DEFAULT_WINDOW_SPEC, windowTokens: 128_000 }), 20_480)
  })

  it('token-meter 来源与适配可用性透传', () => {
    const report = computePressure({
      sessionId: 's1',
      estimatedTokens: 100,
      windowTokens: 1000,
      source: 'token-meter',
      adapters: { compaction: true, tokenMeter: true, toolResultPruner: true },
    })
    assert.equal(report.source, 'token-meter')
    assert.deepEqual(report.adapter, { compaction: true, tokenMeter: true, toolResultPruner: true })
  })

  it('estimateProjectionTokens 字符/token 近似', () => {
    assert.equal(estimateProjectionTokens(''), 0)
    assert.equal(estimateProjectionTokens('abc'), 1)
    assert.equal(estimateProjectionTokens('abcdef'), 2)
    assert.equal(estimateProjectionTokens('abcdef', 2), 3)
  })
})

// ── CTX-15 工具结果裁剪 ─────────────────────────────────────────────────────

describe('planPrune（头部/中部/尾部保留）', () => {
  it('未超预算 → keep', () => {
    const plan = planPrune('short result', DEFAULT_PRUNE_BUDGET)
    assert.equal(plan.action, 'keep')
    assert.equal(plan.removedChars, 0)
  })

  it('超预算 → head/middle/tail 按默认预算（head 4000 / mid 2000 / tail 2000）', () => {
    const text = 'A'.repeat(10_000)
    const plan = planPrune(text)
    assert.equal(plan.action, 'prune')
    assert.equal(codePointLength(plan.head), 4000)
    assert.equal(codePointLength(plan.middle), 2000)
    assert.equal(codePointLength(plan.tail), 2000)
    assert.equal(plan.removedChars, 2000)
    assert.equal(plan.continueOffset, 4000)
  })

  it('自定义预算（参数化）', () => {
    const budgets: Array<{ budget: PruneBudget; total: number; head: number; middle: number; tail: number }> = [
      { budget: { thresholdChars: 20, headChars: 8, middleChars: 4, tailChars: 4 }, total: 100, head: 8, middle: 4, tail: 4 },
      { budget: { thresholdChars: 30, headChars: 10, middleChars: 5, tailChars: 10 }, total: 60, head: 10, middle: 5, tail: 10 },
      { budget: { thresholdChars: 50, headChars: 20, middleChars: 0, tailChars: 20 }, total: 80, head: 20, middle: 0, tail: 20 },
    ]
    for (const { budget, total, head, middle, tail } of budgets) {
      const plan = planPrune('x'.repeat(total), budget)
      assert.equal(plan.action, 'prune')
      assert.equal(codePointLength(plan.head), head, `head ${budget.headChars}`)
      assert.equal(codePointLength(plan.middle), middle, `middle ${budget.middleChars}`)
      assert.equal(codePointLength(plan.tail), tail, `tail ${budget.tailChars}`)
    }
  })

  it('Unicode 代理对不被切断（emoji 完整保留）', () => {
    const text = '🧪实验'.repeat(3000) // 每个重复含代理对
    const plan = planPrune(text, { thresholdChars: 100, headChars: 50, middleChars: 20, tailChars: 20 })
    const head = [...plan.head]
    // 每个 "🧪实验" 是 3 个 code point，任何切片边界都不应落在代理对中间
    assert.equal(head.length, 50)
    assert.ok(!head.includes('�'))
    // 裁剪确实移除了内容，且保留段长度等于各预算之和
    assert.ok(plan.removedChars > 0)
    assert.equal(codePointLength(plan.head) + codePointLength(plan.middle) + codePointLength(plan.tail), 90)
  })

  it('sliceCodePoints 边界', () => {
    assert.equal(sliceCodePoints('abcde', 1, 3), 'bc')
    assert.equal(sliceCodePoints('abcde', 3, 1), '')
    assert.equal(sliceCodePoints('abcde', 0, 99), 'abcde')
  })

  it('renderPrunedText 包含裁剪标记与继续读取位置', () => {
    const plan = planPrune('A'.repeat(9000))
    const rendered = renderPrunedText(plan, { path: 'C:/archive/t.txt', offset: 4000 })
    assert.ok(rendered.includes(PRUNE_MARKER))
    assert.ok(rendered.includes('C:/archive/t.txt#4000'))
  })

  it('pruneToolResultText 便捷入口：未超预算原样返回', () => {
    const { prunedText, plan } = pruneToolResultText('tiny')
    assert.equal(prunedText, 'tiny')
    assert.equal(plan.action, 'keep')
  })
})

// ── CTX-16 compaction 事件记录与回读 ───────────────────────────────────────

describe('foldCompactionEvent / CompactionLog（start → summary → end 生命周期）', () => {
  function makeEvent(type: string, data: unknown): { type: string; data: unknown } {
    return { type, data }
  }

  it('完整生命周期折叠出 completed 记录（含消息范围/摘要文本/版本）', () => {
    let records: readonly CompactionRecord[] = []
    const start = foldCompactionEvent(records, makeEvent('compaction/start', { compactionId: 'c1' }), { sessionId: 's1', now: 1000 })
    records = start.records
    assert.equal(start.changed, true)
    assert.equal(records.length, 1)
    assert.equal(records[0]?.status, 'running')

    const summary = foldCompactionEvent(records, makeEvent('compaction/summary', {
      compactionId: 'c1',
      shadowedRange: { start: 5, end: 20 },
      shadowedSeqs: [5, 6, 7, 8],
      shadowedTokenCount: 3000,
      summary: [{ type: 'text', text: '第一段总结。' }, { type: 'text', text: '第二段。' }],
    }), { sessionId: 's1', now: 2000 })
    records = summary.records
    assert.equal(records[0]?.summaryText, '第一段总结。\n第二段。')
    assert.deepEqual(records[0]?.messageRange?.shadowedSeqs, [5, 6, 7, 8])
    assert.equal(records[0]?.summaryVersion, 1)

    const end = foldCompactionEvent(records, makeEvent('compaction/end', { compactionId: 'c1' }), { sessionId: 's1', now: 3000 })
    records = end.records
    assert.equal(records[0]?.status, 'completed')
    assert.equal(records[0]?.endedAt, 3000)
  })

  it('end 带 error → failed', () => {
    let records = foldCompactionEvent([], makeEvent('compaction/start', { compactionId: 'c2' }), { sessionId: 's1' }).records
    records = foldCompactionEvent(records, makeEvent('compaction/end', { compactionId: 'c2', error: 'summarization failed' }), { sessionId: 's1' }).records
    assert.equal(records[0]?.status, 'failed')
    assert.equal(records[0]?.error, 'summarization failed')
  })

  it('未知事件 / 缺 compactionId 不改变记录', () => {
    const result = foldCompactionEvent([], makeEvent('compaction/start', {}), { sessionId: 's1' })
    assert.equal(result.changed, false)
    assert.equal(result.changedRecords.length, 0)
    const unknown = foldCompactionEvent([], makeEvent('assistant/message', {}), { sessionId: 's1' })
    assert.equal(unknown.changed, false)
  })

  it('CompactionLog 折叠 + 查询（session/trigger/status/limit）', () => {
    const log = new CompactionLog()
    const appended: CompactionRecord[] = []
    log.onAppend = (record) => appended.push(record)
    log.append({
      compactionId: 'm1', sessionId: 's1', trigger: 'manual', status: 'completed',
      startedAt: 10, endedAt: 20, source: 'evoresearch', summaryText: '手动摘要',
    })
    log.append({
      compactionId: 'm2', sessionId: 's2', trigger: 'auto', status: 'completed',
      startedAt: 30, endedAt: 40, source: 'evoresearch', summaryText: '自动摘要',
    })
    log.fold(makeEvent('compaction/start', { compactionId: 'c3' }), { sessionId: 's1', now: 50 })

    assert.equal(log.query({ sessionId: 's1' }).length, 2)
    assert.equal(log.query({ trigger: 'manual' }).length, 1)
    assert.equal(log.query({ status: 'running' }).length, 1)
    assert.equal(log.query({ sessionId: 's1', limit: 1 })[0]?.compactionId, 'c3')
    assert.equal(appended.length, 3) // 两条 append + 一条 fold 新增
  })

  it('filterCompactions 时间过滤与倒序', () => {
    const records: CompactionRecord[] = [
      { compactionId: 'a', sessionId: 's1', trigger: 'auto', status: 'completed', startedAt: 100, source: 'evoresearch' },
      { compactionId: 'b', sessionId: 's1', trigger: 'manual', status: 'completed', startedAt: 200, source: 'evoresearch' },
      { compactionId: 'c', sessionId: 's1', trigger: 'region', status: 'failed', startedAt: 300, source: 'evoresearch' },
    ]
    assert.deepEqual(filterCompactions(records, { since: 150 }).map((r) => r.compactionId), ['c', 'b'])
    assert.deepEqual(filterCompactions(records, { limit: 2 }).map((r) => r.compactionId), ['c', 'b'])
  })

  it('nextSummaryVersion 递增', () => {
    const records: CompactionRecord[] = [
      { compactionId: 'a', sessionId: 's1', trigger: 'auto', status: 'completed', startedAt: 1, source: 'evoresearch', summaryVersion: 1 },
      { compactionId: 'b', sessionId: 's1', trigger: 'auto', status: 'completed', startedAt: 2, source: 'evoresearch', summaryVersion: 2 },
      { compactionId: 'c', sessionId: 's2', trigger: 'auto', status: 'completed', startedAt: 3, source: 'evoresearch', summaryVersion: 1 },
    ]
    assert.equal(nextSummaryVersion(records, 's1'), 3)
    assert.equal(nextSummaryVersion(records, 's2'), 2)
    assert.equal(nextSummaryVersion([], 's9'), 1)
  })

  it('JSONL 往返：损坏行容忍', () => {
    const record: CompactionRecord = {
      compactionId: 'j1', sessionId: 's1', trigger: 'auto', status: 'completed',
      startedAt: 1, source: 'evoresearch', summaryText: '摘要',
    }
    const line = toCompactionLine(record)
    assert.deepEqual(parseCompactionLine(line), record)
    assert.equal(parseCompactionLine('{broken json'), undefined)
    assert.equal(parseCompactionLine(''), undefined)
    assert.equal(parseCompactionLine('"just a string"'), undefined)
  })
})

// ── CTX-17 工具历史修复 ────────────────────────────────────────────────────

describe('analyzeToolHistory / buildRepairedProjection', () => {
  function assistant(calls: Array<{ id: string; name?: string }>): RepairMessage {
    return {
      role: 'assistant',
      content: calls.map((call) => ({ type: 'tool-call' as const, id: call.id, name: call.name ?? 'read_file', arguments: '{}' })),
    }
  }
  function userResult(callId: string, isError = false): RepairMessage {
    return {
      role: 'user',
      content: [{ type: 'tool-result' as const, toolCallId: callId, content: [{ type: 'text' as const, text: 'ok' }], isError }],
    }
  }
  function userText(text: string): RepairMessage {
    return { role: 'user', content: [{ type: 'text' as const, text }] }
  }

  it('完全配对序列 → balanced，无需修复', () => {
    const messages = [userText('跑一下'), assistant([{ id: 'c1' }]), userResult('c1'), assistant([])]
    const analysis = analyzeToolHistory(messages)
    assert.equal(analysis.balanced, true)
    assert.deepEqual(analysis.openCalls, [])
    const repaired = buildRepairedProjection(messages, analysis)
    assert.equal(repaired.actions.length, 0)
    assert.deepEqual(repaired.messages, messages)
  })

  it('缺配对结果（TOOL_OUTCOME_UNKNOWN）→ 插入错误结果闭合', () => {
    const messages = [userText('查询'), assistant([{ id: 'c1' }, { id: 'c2' }]), userResult('c1')]
    const analysis = analyzeToolHistory(messages)
    assert.equal(analysis.balanced, false)
    assert.deepEqual(analysis.openCalls, ['c2'])
    assert.ok(analysis.issues.some((issue) => issue.kind === 'missing-result' && issue.callId === 'c2'))

    const repaired = buildRepairedProjection(messages, analysis)
    const inserts = repaired.actions.filter((action) => action.kind === 'insert-error-result')
    assert.equal(inserts.length, 1)
    assert.equal(inserts[0]?.callId, 'c2')
    // 修复后：插入的 user 消息紧随调用消息之后
    const callIndex = repaired.messages.findIndex((message) => message.role === 'assistant' && message.content.some((b) => b.type === 'tool-call'))
    const inserted = repaired.messages[callIndex + 1]
    assert.equal(inserted?.role, 'user')
    const block = inserted?.content[0]
    assert.equal(block?.type, 'tool-result')
    if (block?.type === 'tool-result') {
      assert.equal(block.toolCallId, 'c2')
      assert.equal(block.isError, true)
    }
  })

  it('无主结果（TOOL_NOT_STARTED）→ 丢弃', () => {
    const messages = [userText('x'), userResult('ghost')]
    const analysis = analyzeToolHistory(messages)
    assert.deepEqual(analysis.orphanResults, ['ghost'])
    const repaired = buildRepairedProjection(messages, analysis)
    assert.ok(repaired.actions.some((action) => action.kind === 'drop-orphan-result' && action.callId === 'ghost'))
    assert.ok(!repaired.messages.some((message) => message.content.some((b) => b.type === 'tool-result' && b.toolCallId === 'ghost')))
  })

  it('重复结果 → 保留第一条', () => {
    const messages = [userText('x'), assistant([{ id: 'c1' }]), userResult('c1'), userResult('c1')]
    const analysis = analyzeToolHistory(messages)
    assert.ok(analysis.issues.some((issue) => issue.kind === 'duplicate-result'))
    const repaired = buildRepairedProjection(messages, analysis)
    const results = repaired.messages.flatMap((message) => message.content.filter((b) => b.type === 'tool-result' && b.toolCallId === 'c1'))
    assert.equal(results.length, 1)
  })

  it('中断的末条 assistant 消息（open-turn）被识别', () => {
    const messages = [userText('x'), assistant([{ id: 'c1' }])]
    const analysis = analyzeToolHistory(messages)
    assert.ok(analysis.issues.some((issue) => issue.kind === 'open-turn'))
    assert.deepEqual(analysis.openCalls, ['c1'])
  })

  it('createRepairRecord 修复前后分别保存', () => {
    const messages = [userText('x'), assistant([{ id: 'c1' }])]
    const analysis = analyzeToolHistory(messages)
    const repaired = buildRepairedProjection(messages, analysis)
    const record = createRepairRecord('s1', messages, analysis, repaired)
    assert.equal(record.status, 'proposed')
    assert.equal(record.originalProjection, serializeProjection(messages))
    assert.equal(record.repairedProjection, serializeProjection(repaired.messages))
    assert.notEqual(record.originalProjection, record.repairedProjection)
    assert.ok(record.repairId.length > 0)
  })
})

// ── CTX-18 当前上下文来源查询 ───────────────────────────────────────────────

describe('describeContextSources', () => {
  it('组合摘要 / 原文 / 工具结果 / Graph 连接并统计', () => {
    const report = describeContextSources({
      sessionId: 's1',
      compactions: [{
        compactionId: 'c1', sessionId: 's1', trigger: 'auto', status: 'completed',
        startedAt: 1, source: 'dsh', summaryText: '旧对话总结', summaryVersion: 1,
        messageRange: { start: 1, end: 10, shadowedSeqs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      }],
      surfaceEvents: [
        { seq: 11, type: 'user/message', label: '帮我分析', estimatedTokens: 10 },
        { seq: 12, type: 'assistant/message', label: '好的', estimatedTokens: 20 },
      ],
      prunedToolResults: [{
        callId: 't1', toolName: 'read_file', sessionId: 's1', archivedAt: 1,
        charsBefore: 9000, charsAfter: 120,
        archive: { path: 'C:/a/t1.txt', offset: 0 },
        continueRead: { path: 'C:/a/t1.txt', offset: 4000 },
        prunedText: '头部…',
      }],
      graphConnections: [{ nodeId: 'n1', label: '相关论文' }],
    })
    assert.equal(report.totals.summaries, 1)
    assert.equal(report.totals.originalSnippets, 0) // detailMessages 默认细分 user/assistant
    assert.equal(report.totals.toolResults, 1)
    assert.equal(report.totals.graphConnections, 1)
    assert.ok(report.totals.estimatedTokens > 0)
    const summary = report.entries.find((entry) => entry.kind === 'summary')
    assert.ok(summary?.detail.includes('1..10'))
    const tool = report.entries.find((entry) => entry.kind === 'tool-result')
    assert.deepEqual(tool?.location, { kind: 'archive', path: 'C:/a/t1.txt', offset: 4000 })
  })

  it('detailMessages=false 时原文统一归为 original-snippet', () => {
    const report = describeContextSources({
      sessionId: 's1',
      surfaceEvents: [{ seq: 1, type: 'user/message', label: 'x', estimatedTokens: 1 }],
      detailMessages: false,
    })
    assert.equal(report.totals.originalSnippets, 1)
    assert.equal(report.entries[0]?.kind, 'original-snippet')
  })

  it('空输入返回零统计', () => {
    const report = describeContextSources({ sessionId: 's1' })
    assert.deepEqual(report.totals, { summaries: 0, originalSnippets: 0, toolResults: 0, graphConnections: 0, estimatedTokens: 0 })
    assert.deepEqual(report.entries, [])
  })
})
