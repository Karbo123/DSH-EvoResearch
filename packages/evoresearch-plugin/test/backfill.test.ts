/**
 * v2 backfill 回填 + v3 工具收据钩子测试。
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ResearchMemoryStore } from '../src/host/memory/store.js'
import { backfillSessions, fingerprintEvents } from '../src/host/memory/backfill.js'
import { MemoryRuntime } from '../src/host/memory/index.js'

/** 构造会话事件流（user 消息 + assistant 消息 + 工具调用）。 */
function sessionEvents(): unknown[] {
  return [
    { type: 'user/message', seq: 1, time: 1, data: { id: 'm1', role: 'user', content: [{ type: 'text', text: '第一轮提问' }], source: { kind: 'user' } } },
    { type: 'assistant/message', seq: 2, time: 2, data: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '第一轮回答' }], source: { kind: 'model', provider: 'x', model: 'y' } } },
    { type: 'tool/call', seq: 3, time: 3, data: { turn: 0, step: 0, callId: 'call-1', name: 'read', arguments: '{}' } },
    { type: 'tool/result', seq: 4, time: 4, data: { turn: 0, step: 0, message: { id: 'tr1', role: 'user', content: [{ type: 'tool-result', callId: 'call-1', content: [{ type: 'text', text: 'ok' }] }], source: { kind: 'tool', callId: 'call-1' } } } },
    { type: 'user/message', seq: 5, time: 5, data: { id: 'm2', role: 'user', content: [{ type: 'text', text: '第二轮提问' }], source: { kind: 'user' } } },
    { type: 'plugin/user/message', seq: 6, time: 6, data: { id: 'm3', role: 'user', content: [{ type: 'text', text: '注入通知' }], source: { kind: 'plugin', plugin: 'x' } } },
  ]
}

describe('backfillSessions', () => {
  it('把会话历史回填为 completed Turn + 归档（跳过注入消息）', async () => {
    const store = ResearchMemoryStore.openMemory()
    const events = sessionEvents()
    const created = await backfillSessions(store, {
      sessionIds: ['s-old-1'],
      eventsOf: async () => events,
      workspaceDir: '/w',
    })
    assert.equal(created, 2) // 两个 user 消息（注入消息不建）
    const turns = store.listTurns(undefined, 10)
    assert.equal(turns.length, 2)
    // 第一轮关联 assistant 回答并归档
    const first = turns.find((t) => t.userText === '第一轮提问')!
    assert.equal(first.status, 'completed')
    assert.equal(first.assistantText, '第一轮回答')
    const segments = store.listSegments(first.turnId)
    assert.ok(segments.some((s) => s.kind === 'assistant'))
    store.close()
  })

  it('幂等：重复回填不重复创建', async () => {
    const store = ResearchMemoryStore.openMemory()
    const events = sessionEvents()
    const options = { sessionIds: ['s-old-1'], eventsOf: async () => events, workspaceDir: '/w' }
    const first = await backfillSessions(store, options)
    const second = await backfillSessions(store, options)
    assert.equal(first, 2)
    assert.equal(second, 0)
    assert.equal(store.listTurns(undefined, 10).length, 2)
    store.close()
  })

  it('事件指纹稳定', () => {
    const events = sessionEvents()
    assert.equal(fingerprintEvents(events), fingerprintEvents(events))
    assert.notEqual(fingerprintEvents(events), fingerprintEvents([...events, { type: 'user/message' }]))
  })
})

describe('工具收据钩子（session/event tool/call 与 tool/result）', () => {
  let dataRoot: string
  let ctx: Context
  let runtime: MemoryRuntime
  let dispose: () => void

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-receipt-'))
    ctx = new Context()
    runtime = new MemoryRuntime({ dataRoot })
    dispose = runtime.attach(ctx)
  })

  it('tool/call 记录 started，tool/result 补记 completed', async () => {
    const session = { id: 's-r1', header: { cwd: dataRoot } }
    // 先建一个活跃轮次（通过 user/message + turn/start 语义）
    ctx.emit('session/event', session, { type: 'user/message', seq: 1, time: Date.now(), data: { id: 'm1', role: 'user', content: [{ type: 'text', text: '分析一下' }], source: { kind: 'user' } } })
    await new Promise((resolve) => setTimeout(resolve, 100))
    // 工具调用开始
    ctx.emit('session/event', session, { type: 'tool/call', seq: 2, time: Date.now(), data: { turn: 0, step: 0, callId: 'call-x', name: 'read', arguments: '{}' } })
    const store = runtime.storeFor(dataRoot)
    await waitFor(() => store.listUnknownTools().length === 1)
    const unknown = store.listUnknownTools()
    assert.equal(unknown[0]?.toolCallId, 'call-x')
    // 工具结果 → completed（不再出现在 unknown 列表）
    ctx.emit('session/event', session, {
      type: 'tool/result',
      seq: 3,
      time: Date.now(),
      data: { turn: 0, step: 0, message: { id: 'tr1', role: 'user', content: [], source: { kind: 'tool', callId: 'call-x' } } },
    })
    await waitFor(() => store.listUnknownTools().length === 0)
    assert.equal(store.listUnknownTools().length, 0)
  })

  afterEach(() => {
    dispose()
    // 测试卫生（BASE-02）：清理 beforeEach 创建的临时数据根
    fs.rmSync(dataRoot, { recursive: true, force: true })
  })
})

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  assert.fail('等待条件超时')
}
