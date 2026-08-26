/**
 * 平台上下文运行时接入（PLAT-03..07）单元测试。
 *
 * 覆盖：压缩探测降级（PLAT-03 + PLAT-21 降级骨架）、工具结果裁剪管线
 * （PLAT-04，wrapToolExecute 注册点）、压缩事件折叠（PLAT-05）、历史修复
 * 重试编排（PLAT-06）、session query 投影/谱系（PLAT-07）。
 * 纯函数级 + 假服务注入（假 ctx / 假 adapters / 假 compaction），
 * 文件持久化用 mkdtemp 临时目录（BASE-02）。
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ContextRuntime, classifyProjection, wrapToolExecute } from '../src/host/platform/context-runtime.js'
import type { PlatformAdapters } from '../src/host/platform/adapters.js'
import { PLATFORM_CAPABILITIES } from '../src/host/platform/capabilities.js'
import type { CapabilityStatus, PlatformCapability } from '../src/host/platform/capabilities.js'
import { ScienceMemory } from '../src/host/science/memory.js'
import type { CompactionRecord } from '../src/host/context/types.js'

/** 临时数据根（BASE-02：测试结束统一清理）。 */
const tmpRoots: string[] = []
function tmpRoot(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `evoresearch-platctx-${prefix}-`))
  tmpRoots.push(dir)
  return dir
}
after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

/** 构造假能力探测（PlatformAdapters 最小形态）。 */
function fakeAdapters(probeStatus: Partial<Record<PlatformCapability, CapabilityStatus>>): PlatformAdapters {
  const probes = PLATFORM_CAPABILITIES.map((capability) => ({
    capability,
    expected: probeStatus[capability] ?? 'missing',
    status: probeStatus[capability] ?? 'missing',
    present: [] as string[],
    absent: [] as string[],
  }))
  return {
    probes,
    warnings: [],
    has: (capability) => (probeStatus[capability] ?? 'missing') !== 'missing',
    require: (capability) => {
      if ((probeStatus[capability] ?? 'missing') === 'missing') throw new Error(`平台能力不可用: ${capability}`)
    },
    summarize: () => 'fake',
    sessions: {} as never,
    models: {} as never,
    tools: {} as never,
    approval: {} as never,
    sandbox: {} as never,
    events: {} as never,
    plugins: {} as never,
  } as PlatformAdapters
}

/** 假 ctx：只提供给定服务名；on/once no-op（guard.attach 订阅事件用）。 */
function fakeCtx(services: Record<string, unknown>): { get(name: string): unknown; on(): () => void; once(): () => void } {
  return { get: (name) => services[name], on: () => () => {}, once: () => () => {} }
}

/** 假 DSH compaction 服务（DshCompactionAdapter 形状）。 */
function fakeCompaction(results: { ifNeeded?: unknown; now?: unknown; region?: unknown } = {}) {
  return {
    compactIfNeeded: async () => results.ifNeeded ?? null,
    compactNow: async () => results.now ?? { compactionId: 'dsh-c1' },
    compactRegion: async () => results.region ?? { compactionId: 'dsh-c2' },
  }
}

/** 轻量会话（PressureSessionLike）。 */
function fakeSession(id: string, messages?: readonly unknown[]): { id: string; deriveMessages: () => readonly unknown[]; events?: readonly unknown[] } {
  return { id, deriveMessages: () => messages ?? [], events: [] }
}

/** 超长工具结果（超过默认裁剪预算阈值）。 */
function longToolResult(chars = 20000): string {
  return 'A'.repeat(chars)
}

/* ------------------------------------------------------------------ */
/* PLAT-03：压缩探测接入与降级（含 PLAT-21 骨架）                         */
/* ------------------------------------------------------------------ */

describe('PLAT-03 压缩探测接入与降级', () => {
  it('compaction 可用（探测 available + 假服务）→ autoCompact 调用 DSH 服务', async () => {
    const root = tmpRoot('compact-ok')
    let called = false
    const compaction = {
      compactIfNeeded: async () => {
        called = true
        return { compactionId: 'dsh-auto-1', shadowedSeqs: [3, 4, 5], shadowedRange: { start: 3, end: 5 }, summary: '摘要' }
      },
      compactNow: async () => null,
      compactRegion: async () => ({}),
    }
    const runtime = new ContextRuntime({
      dataRoot: root,
      adapters: fakeAdapters({ compaction: 'available', sessionQuery: 'available' }),
    })
    runtime.attach(fakeCtx({ compaction }) as never)
    assert.equal(runtime.status().compaction, 'available')
    assert.equal(runtime.status().degraded, false)
    // force 跳过阈值判定（空会话压力为 0，否则走 skipped）
    const result = await runtime.autoCompact(fakeSession('s1'), { force: true })
    assert.equal(called, true)
    assert.equal(result.applied, true)
    assert.equal(result.record.source, 'dsh')
    assert.equal(result.record.status, 'completed')
    // PLAT-05：记录可查询
    const records = runtime.compactionRecords({ sessionId: 's1' })
    assert.ok(records.length >= 1)
    assert.equal(records[0]?.compactionId, 'dsh-auto-1')
  })

  it('compaction 缺失（探测 missing + 无服务）→ degraded-noop 事件登记，不抛异常（PLAT-21）', async () => {
    const root = tmpRoot('compact-missing')
    const runtime = new ContextRuntime({
      dataRoot: root,
      adapters: fakeAdapters({ compaction: 'missing', sessionQuery: 'missing' }),
    })
    runtime.attach(fakeCtx({}) as never)
    const status = runtime.status()
    assert.equal(status.compaction, 'missing')
    assert.ok(status.degradations.some((d) => d.startsWith('compaction:')))
    assert.equal(status.degraded, true)
    // 降级操作：结构化结果 + 记录，绝不抛（force 跳过阈值，直达降级分支）
    const result = await runtime.autoCompact(fakeSession('s1'), { force: true })
    assert.equal(result.ok, true)
    assert.equal(result.applied, false)
    assert.equal(result.degraded, true)
    assert.equal(result.record.status, 'degraded-noop')
    assert.equal(result.record.source, 'evoresearch')
    // 手动/区域/溢出同样降级
    const manual = await runtime.manualCompact(fakeSession('s1'))
    assert.equal(manual.record.status, 'degraded-noop')
    const region = await runtime.regionCompact(fakeSession('s1'), 0, 10)
    assert.equal(region.record.status, 'degraded-noop')
    const overflow = await runtime.overflowRetry(fakeSession('s1'))
    assert.equal(overflow.degraded, true)
  })

  it('PLAT-21 降级骨架：压缩不可用时科研资料不受损坏', async () => {
    const root = tmpRoot('plat21')
    // 科研资料：先写一条 Ideation 记忆
    const memory = new ScienceMemory(root)
    const entry = memory.add('ideation', { title: '关键 Idea', body: '对比学习在序列数据上。' }, root)
    const memoryFile = path.join(root, 'plugins', 'memories', 'science', 'ideation', entry.fileName)
    const before = fs.readFileSync(memoryFile, 'utf8')
    // 降级运行压缩
    const runtime = new ContextRuntime({ dataRoot: root, adapters: fakeAdapters({ compaction: 'missing' }) })
    runtime.attach(fakeCtx({}) as never)
    await runtime.autoCompact(fakeSession('s1'))
    await runtime.manualCompact(fakeSession('s1'))
    await runtime.overflowRetry(fakeSession('s1'))
    // 记忆文件原样保留
    const after = fs.readFileSync(memoryFile, 'utf8')
    assert.equal(after, before)
    // 笔记/实验资料不经本层写操作（无实验目录被创建）
    assert.ok(!fs.existsSync(path.join(root, 'experiments')))
  })
})

/* ------------------------------------------------------------------ */
/* PLAT-04：工具结果裁剪管线                                            */
/* ------------------------------------------------------------------ */

describe('PLAT-04 工具结果裁剪管线', () => {
  it('pruneToolResult：超预算 → 归档 + 继续读取位置注入 + 记录查询', () => {
    const root = tmpRoot('prune')
    const runtime = new ContextRuntime({ dataRoot: root, adapters: fakeAdapters({}) })
    runtime.attach(fakeCtx({}) as never)
    const output = runtime.pruneToolResult({ sessionId: 's1', callId: 'c1', toolName: 'bash', text: longToolResult() })
    assert.equal(output.applied, true)
    assert.ok(output.record)
    assert.ok(output.prunedText.length < output.record.charsBefore)
    assert.ok(output.prunedText.includes('已裁剪'))
    // 完整原文归档存在 + 继续读取位置
    assert.ok(fs.existsSync(output.record.archive.path))
    assert.equal(output.record.continueRead.offset, output.plan.continueOffset)
    assert.equal(output.record.sessionId, 's1')
    const records = runtime.pruneRecords('s1')
    assert.equal(records.length, 1)
    assert.equal(records[0]?.callId, 'c1')
  })

  it('未超预算 → 原样返回，不归档', () => {
    const root = tmpRoot('prune-keep')
    const runtime = new ContextRuntime({ dataRoot: root, adapters: fakeAdapters({}) })
    runtime.attach(fakeCtx({}) as never)
    const output = runtime.pruneToolResult({ sessionId: 's1', callId: 'c2', toolName: 'fs', text: 'short' })
    assert.equal(output.applied, false)
    assert.equal(output.record, undefined)
    assert.equal(output.prunedText, 'short')
  })

  it('wrapToolExecute 管线注册点：超长结果被裁剪替换，错误结果透传，无会话不裁剪', async () => {
    const root = tmpRoot('wrap')
    const runtime = new ContextRuntime({ dataRoot: root, adapters: fakeAdapters({}) })
    runtime.attach(fakeCtx({}) as never)
    // 假 execute：返回超长 text 块
    const execute = async () => ({ content: [{ type: 'text', text: longToolResult() }], isError: false })
    const wrapped = wrapToolExecute(execute, (input) => runtime.pruneToolResult(input))
    const result = await wrapped.execute({ name: 'bash', arguments: {}, agent: { session: { id: 's1' } } })
    assert.equal(result.isError, false)
    const text = (result.content[0] as { text?: string }).text ?? ''
    assert.ok(text.length < 10000)
    assert.ok(text.includes('已裁剪'))
    assert.equal(runtime.pruneRecords('s1').length, 1)
    // 错误结果透传（不裁剪）
    const errExecute = async () => ({ content: [{ type: 'text', text: longToolResult() }], isError: true })
    const wrappedErr = wrapToolExecute(errExecute, (input) => runtime.pruneToolResult(input))
    const errResult = await wrappedErr.execute({ name: 'bash', arguments: {}, agent: { session: { id: 's1' } } })
    assert.equal(errResult.isError, true)
    assert.equal((errResult.content[0] as { text?: string }).text?.length, longToolResult().length)
    // 无会话 id → 不裁剪
    const noSession = await wrapped.execute({ name: 'bash', arguments: {} })
    assert.equal((noSession.content[0] as { text?: string }).text?.length, longToolResult().length)
  })
})

/* ------------------------------------------------------------------ */
/* PLAT-05：DSH 压缩事件折叠                                           */
/* ------------------------------------------------------------------ */

describe('PLAT-05 压缩事件订阅折叠进 compactions.jsonl', () => {
  it('session/event 中 DSH compaction/start|summary|end 折叠为记录并持久化', async () => {
    const root = tmpRoot('fold')
    const ctx = new Context()
    const runtime = new ContextRuntime({ dataRoot: root, adapters: fakeAdapters({}) })
    runtime.attach(ctx)
    const session = { id: 's1', header: {} }
    // DSH 引擎事件（只读折叠，不改原始事件）
    ctx.emit('session/event' as never, session, {
      type: 'compaction/start',
      time: 1000,
      data: { compactionId: 'dsh-fold-1' },
    } as never)
    ctx.emit('session/event' as never, session, {
      type: 'compaction/summary',
      time: 1100,
      data: {
        compactionId: 'dsh-fold-1',
        shadowedRange: { start: 2, end: 5 },
        shadowedSeqs: [2, 3, 4, 5],
        shadowedTokenCount: 1200,
        summary: [{ type: 'text', text: '折叠摘要' }],
      },
    } as never)
    ctx.emit('session/event' as never, session, {
      type: 'compaction/end',
      time: 1200,
      data: { compactionId: 'dsh-fold-1' },
    } as never)
    const records = runtime.compactionRecords({ sessionId: 's1' })
    const folded = records.find((r) => r.compactionId === 'dsh-fold-1')
    assert.ok(folded)
    assert.equal(folded.status, 'completed')
    assert.equal(folded.source, 'dsh')
    assert.equal(folded.summaryText, '折叠摘要')
    assert.deepEqual(folded.messageRange?.shadowedSeqs, [2, 3, 4, 5])
    // 持久化到 compactions.jsonl
    const lines = fs.readFileSync(path.join(root, 'plugins', 'context', 'compactions.jsonl'), 'utf8')
      .split('\n').filter((l) => l.trim() !== '')
    assert.ok(lines.some((line) => line.includes('dsh-fold-1')))
  })
})

/* ------------------------------------------------------------------ */
/* PLAT-06：历史修复与重试编排                                          */
/* ------------------------------------------------------------------ */

describe('PLAT-06 repairAndRetry 编排', () => {
  it('未配对工具序列 → 修复记录 + 重试载荷（修复前后分别保存）', () => {
    const root = tmpRoot('repair')
    const runtime = new ContextRuntime({ dataRoot: root, adapters: fakeAdapters({}) })
    runtime.attach(fakeCtx({}) as never)
    // 会话消息：assistant 发起 tool-call 但没有 tool-result（未配对）
    const messages = [
      { role: 'user', content: [{ type: 'text', text: '运行实验' }] },
      { role: 'assistant', content: [
        { type: 'tool-call', id: 'tc1', name: 'bash', arguments: '{}' },
      ] },
      { role: 'assistant', content: [{ type: 'text', text: '继续回答' }] },
    ]
    const session = fakeSession('s1', messages)
    const output = runtime.repairAndRetry(session)
    assert.ok(output.record)
    assert.equal(output.record.sessionId, 's1')
    assert.ok(output.record.originalProjection.length > 0)
    assert.ok(output.record.repairedProjection.length > 0)
    assert.ok(output.retryPayload !== null && output.retryPayload.length > 0)
    // 修复记录回读
    const records = runtime.repairRecords('s1')
    assert.equal(records.length, 1)
    assert.equal(records[0]?.status, 'proposed')
  })

  it('配对平衡的序列 → 无需修复（record undefined / retryPayload null）', () => {
    const root = tmpRoot('repair-balanced')
    const runtime = new ContextRuntime({ dataRoot: root, adapters: fakeAdapters({}) })
    runtime.attach(fakeCtx({}) as never)
    const messages = [
      { role: 'user', content: [{ type: 'text', text: '运行实验' }] },
      { role: 'assistant', content: [
        { type: 'tool-call', id: 'tc1', name: 'bash', arguments: '{}' },
      ] },
      { role: 'assistant', content: [
        { type: 'tool-result', toolCallId: 'tc1', content: [{ type: 'text', text: 'ok' }] },
      ] },
    ]
    const output = runtime.repairAndRetry(fakeSession('s1', messages))
    assert.equal(output.record, undefined)
    assert.equal(output.retryPayload, null)
  })
})

/* ------------------------------------------------------------------ */
/* PLAT-07：session query 投影适配（current/shadowed/log-only + lineage） */
/* ------------------------------------------------------------------ */

describe('PLAT-07 投影分类与查询', () => {
  it('classifyProjection 纯函数：surface=current / shadowedSeqs=shadowed / 其余=log-only', () => {
    const events = [
      { seq: 0, type: 'turn/start', time: 1 },
      { seq: 1, type: 'user/message', time: 2 },
      { seq: 2, type: 'assistant/message', time: 3 },
      { seq: 3, type: 'assistant/chunk', time: 4 },
      { seq: 4, type: 'user/message', time: 5 },
      { seq: 5, type: 'assistant/message', time: 6 },
    ]
    const compactions: CompactionRecord[] = [{
      compactionId: 'c1',
      sessionId: 's1',
      trigger: 'auto',
      status: 'completed',
      startedAt: 1,
      source: 'dsh',
      messageRange: { start: 1, end: 2, shadowedSeqs: [1, 2] },
    }]
    const classified = classifyProjection(events, compactions)
    const bySeq = new Map(classified.map((e) => [e.seq, e]))
    assert.equal(bySeq.get(1)?.projection, 'shadowed')
    assert.equal(bySeq.get(1)?.shadowedByCompactionId, 'c1')
    assert.equal(bySeq.get(2)?.projection, 'shadowed')
    assert.equal(bySeq.get(4)?.projection, 'current')
    assert.equal(bySeq.get(0)?.projection, 'log-only') // turn/start 非 surface
    assert.equal(bySeq.get(3)?.projection, 'log-only') // chunk 非 surface
    // 显式 surfaceSeqs 覆盖类型判断
    const explicit = classifyProjection(events, [], [0, 3])
    assert.equal(explicit[0]?.projection, 'current')
    assert.equal(explicit.find((e) => e.seq === 3)?.projection, 'current')
    assert.equal(explicit.find((e) => e.seq === 1)?.projection, 'log-only')
  })

  it('queryProjection：live store 优先；投影过滤 + bounded read + truncated', async () => {
    const root = tmpRoot('proj-live')
    const events = [
      { seq: 0, type: 'turn/start', time: 1 },
      { seq: 1, type: 'user/message', time: 2 },
      { seq: 2, type: 'assistant/message', time: 3 },
      { seq: 3, type: 'assistant/chunk', time: 4 },
    ]
    const sessionStore = {
      get: (id: string) => (id === 's1' ? { id: 's1', header: {}, events } : undefined),
    }
    const runtime = new ContextRuntime({ dataRoot: root, adapters: fakeAdapters({ sessionQuery: 'partial' }) })
    runtime.attach(fakeCtx({ sessions: sessionStore }) as never)
    const all = await runtime.queryProjection('s1')
    assert.equal(all.source, 'live')
    assert.equal(all.events.length, 4)
    // 只取 current
    const current = await runtime.queryProjection('s1', { projection: 'current' })
    assert.equal(current.events.length, 2)
    assert.ok(current.events.every((e) => e.projection === 'current'))
    // bounded read：seq 范围 + limit
    const bounded = await runtime.queryProjection('s1', { bounded: { startSeq: 1, endSeq: 3 } })
    assert.deepEqual(bounded.events.map((e) => e.seq), [1, 2, 3])
    const limited = await runtime.queryProjection('s1', { bounded: { limit: 2 } })
    assert.equal(limited.events.length, 2)
    assert.equal(limited.truncated, true)
  })

  it('queryProjection：live 与 sessionQuery 均不可用 → unavailable（不抛）', async () => {
    const root = tmpRoot('proj-unavail')
    const runtime = new ContextRuntime({ dataRoot: root, adapters: fakeAdapters({ sessionQuery: 'missing' }) })
    runtime.attach(fakeCtx({}) as never)
    const result = await runtime.queryProjection('ghost')
    assert.equal(result.source, 'unavailable')
    assert.equal(result.events.length, 0)
  })

  it('queryLineage：header.parentSession 链 → 祖先链（root 在前）；无父 → 自身', async () => {
    const root = tmpRoot('lineage')
    const sessionStore = {
      get: (id: string) => {
        if (id === 'grand') return { id: 'grand', header: {} }
        if (id === 'parent') return { id: 'parent', header: { parentSession: 'grand' } }
        if (id === 'child') return { id: 'child', header: { parentSession: 'parent' } }
        return undefined
      },
    }
    const runtime = new ContextRuntime({ dataRoot: root, adapters: fakeAdapters({ sessionQuery: 'missing' }) })
    runtime.attach(fakeCtx({ sessions: sessionStore }) as never)
    const lineage = await runtime.queryLineage('child')
    assert.equal(lineage.source, 'header-meta')
    assert.equal(lineage.root, 'grand')
    assert.deepEqual(lineage.chain.map((e) => e.sessionId), ['grand', 'parent', 'child'])
    assert.deepEqual(lineage.chain.map((e) => e.depth), [0, 1, 2])
    assert.equal(lineage.chain[1]?.parentSessionId, 'grand')
    // 无父 → 自身为根
    const single = await runtime.queryLineage('grand')
    assert.equal(single.root, 'grand')
    assert.equal(single.chain.length, 1)
    // 未知会话 → unavailable（不抛）
    const unknown = await runtime.queryLineage('ghost')
    assert.equal(unknown.source, 'unavailable')
  })
})
