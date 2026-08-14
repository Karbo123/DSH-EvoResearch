/**
 * 核心数据流闭环测试：真实 cordis 上下文 + MemoryRuntime，
 * 手动 emit session/event，验证「用户消息 → Turn Catalog → 分类/topic state
 * → 记忆包 → turn/end 归档」的完整链路（LLM 不可用时走确定性回退）。
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { MemoryRuntime } from '../src/host/memory/index.js'

/** 构造一个 user/message 会话事件。 */
function userMessageEvent(messageId: string, text: string): unknown {
  return {
    type: 'user/message',
    seq: 1,
    time: Date.now(),
    data: {
      id: messageId,
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    },
  }
}

/** turn/end 会话事件。 */
function turnEndEvent(reason: string): unknown {
  return {
    type: 'turn/end',
    seq: 2,
    time: Date.now(),
    data: { turn: 0, reason: { kind: reason } },
  }
}

/** 等待条件成立（轮询）。 */
async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  assert.fail('等待条件超时')
}

describe('MemoryRuntime 数据流闭环', () => {
  let dataRoot: string
  let ctx: Context
  let runtime: MemoryRuntime
  let dispose: () => void

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'EVORESEARCH-flow-'))
    ctx = new Context()
    runtime = new MemoryRuntime({ dataRoot })
    dispose = runtime.attach(ctx)
  })

  it('用户消息 → pending Turn → 后台分类（确定性回退）→ 记忆包', async () => {
    const session = { id: 's-flow-1', header: { cwd: dataRoot } }
    ctx.emit('session/event', session, userMessageEvent('m1', '我们提出了一个新的注意力机制方法，并在 CIFAR 上做了实验验证'))

    // pending Turn 立即落库
    const store = runtime.storeFor(dataRoot)
    assert.equal(store.listTurns(undefined, 10).length, 1)

    // 等待后台分类完成（无 llm 服务 → 确定性回退，不阻塞）
    await waitFor(() => {
      const turn = store.listTurns(undefined, 10)[0]
      return turn !== undefined && turn.categories.length > 0
    })
    const turn = store.listTurns(undefined, 10)[0]!
    assert.ok(turn.categories.includes('method') || turn.categories.includes('experiment'))
    assert.ok(turn.topicKeys.length > 0)

    // topic state 写入
    const states = store.listTopicStates()
    assert.ok(states.length > 0)

    // 记忆包缓存构建（查询文本 = 用户消息）
    await waitFor(() => runtime.packetFor('s-flow-1') !== undefined)
    const packet = runtime.packetFor('s-flow-1')!
    assert.ok(packet.text.includes('<research_memory_packet>'))
    assert.ok(packet.estimatedTokens > 0)
  })

  it('turn/end → completed + Raw Turn Archive 归档', async () => {
    const session = { id: 's-flow-2', header: { cwd: dataRoot } }
    ctx.emit('session/event', session, userMessageEvent('m2', '分析一下实验结果'))
    const store = runtime.storeFor(dataRoot)
    await waitFor(() => store.listTurns(undefined, 10).length === 1)

    ctx.emit('session/event', session, turnEndEvent('stop'))
    await waitFor(() => {
      const turn = store.listTurns(undefined, 10)[0]
      return turn?.status === 'completed'
    })
    // 归档：user 段已写入
    await waitFor(() => store.listSegments(store.listTurns(undefined, 10)[0]!.turnId).length > 0)
    const segments = store.listSegments(store.listTurns(undefined, 10)[0]!.turnId)
    assert.ok(segments.some((s) => s.kind === 'user'))
  })

  it('turn/end(rejected) → interrupted（user_stop）', async () => {
    const session = { id: 's-flow-3', header: { cwd: dataRoot } }
    ctx.emit('session/event', session, userMessageEvent('m3', '跑一下代码'))
    const store = runtime.storeFor(dataRoot)
    await waitFor(() => store.listTurns(undefined, 10).length === 1)

    ctx.emit('session/event', session, turnEndEvent('rejected'))
    await waitFor(() => {
      const turn = store.listTurns(undefined, 10)[0]
      return turn?.status === 'interrupted'
    })
    const turn = store.listTurns(undefined, 10)[0]!
    assert.equal(turn.interruptReason, 'user_stop')
  })

  it('注入类消息（source: plugin）不建 Turn', () => {
    const session = { id: 's-flow-4', header: { cwd: dataRoot } }
    ctx.emit('session/event', session, {
      type: 'user/message',
      seq: 1,
      time: Date.now(),
      data: {
        id: 'm4',
        role: 'user',
        content: [{ type: 'text', text: '定时任务通知' }],
        source: { kind: 'plugin', plugin: 'EVORESEARCH:scheduler' },
      },
    })
    assert.equal(runtime.storeFor(dataRoot).listTurns(undefined, 10).length, 0)
  })

  it('长程文本触发 Goal 提取失败不中断记忆包', async () => {
    const session = { id: 's-flow-5', header: { cwd: dataRoot } }
    const longText = '这是一个长期研究项目，我们计划分三个阶段完成整个实验流程，第一阶段完成数据收集与文献综述，第二阶段实现核心算法原型，第三阶段进行大规模实验评估，目标是实现完全可复现的科研流程。'
    ctx.emit('session/event', session, userMessageEvent('m5', longText))
    const store = runtime.storeFor(dataRoot)
    // 无 llm 服务 → Goal 提取抛错被隔离，记忆包仍构建
    await waitFor(() => runtime.packetFor('s-flow-5') !== undefined)
    assert.ok(runtime.packetFor('s-flow-5')!.text.length > 0)
  })

  afterEach(() => {
    dispose()
  })
})
