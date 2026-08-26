/**
 * P1-4 上下文超限监视器测试（fake ctx + fake guard，无真实运行时）。
 *
 * 覆盖：matchContextLimitError 特征命中/未命中、turn/end 异常结束触发一次
 * overflowRetry、冷却窗口内不重复触发、正常结束不触发、compaction=false
 * 不触发且告警只打一次、同 turn 去重、detach 后不再触发。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CONTEXT_LIMIT_PATTERNS, OverflowWatch, matchContextLimitError } from '../src/host/context/overflow-watch.js'

/** fake ctx：on(event, listener) 收集 listener 到数组；disposer 真正移除监听。 */
function fakeCtx(): {
  on(event: string, listener: (...args: unknown[]) => void): () => void
  listeners: Array<(...args: unknown[]) => void>
} {
  const listeners: Array<(...args: unknown[]) => void> = []
  return {
    listeners,
    on: (_event, listener) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
  }
}

/** fake guard：记录 overflowRetry 调用与入参。 */
function fakeGuard(compaction: boolean) {
  const calls: Array<{ session: unknown; options: unknown }> = []
  return {
    calls,
    status: () => ({ compaction }),
    overflowRetry: (session: unknown, options?: unknown) => {
      calls.push({ session, options })
      return Promise.resolve({ ok: true })
    },
  }
}

/** 构造 turn/end 会话事件。 */
function turnEndEvent(turn: number, reason: Record<string, unknown>): { type: string; data: Record<string, unknown> } {
  return { type: 'turn/end', data: { turn, reason } }
}

describe('matchContextLimitError', () => {
  it('各 provider 的超限特征样例命中并返回 pattern 字符串', () => {
    const samples = [
      'This model\'s maximum context length is 65536 tokens',
      'context_length_exceeded: the request exceeds the available context length',
      'Your input is longer than the model\'s context window',
      'too many tokens in the request',
      'Too many input tokens. The total exceeds the limit',
      'Please reduce the length of the messages',
      'input tokens exceed the maximum allowed',
      'prompt is too long: 200000 tokens > 131072 maximum',
      '上下文长度超出模型限制',
      '请求内容超出上下文窗口',
    ]
    for (const sample of samples) {
      const hit = matchContextLimitError(sample)
      assert.ok(hit !== null, `应命中: ${sample}`)
      assert.equal(hit, String(CONTEXT_LIMIT_PATTERNS.find((pattern) => pattern.test(sample))))
    }
  })

  it('无关错误返回 null', () => {
    assert.equal(matchContextLimitError('connection reset by peer'), null)
    assert.equal(matchContextLimitError('rate limit exceeded, retry after 30s'), null)
    assert.equal(matchContextLimitError('invalid api key'), null)
    assert.equal(matchContextLimitError(''), null)
  })
})

describe('OverflowWatch 触发与防循环', () => {
  it('turn/end 异常结束且文本含超限特征 → overflowRetry 被调一次（带 trigger: watch）', async () => {
    const ctx = fakeCtx()
    const guard = fakeGuard(true)
    const sessions = new Map([['s1', { id: 's1' }]])
    const watch = new OverflowWatch({
      guard,
      getSession: (id) => sessions.get(id),
      logger: () => {},
    })
    watch.attach(ctx as never)

    const session = { id: 's1' }
    const event = turnEndEvent(3, { kind: 'error', error: { message: 'maximum context length exceeded', code: 'CONTEXT' } })
    ctx.listeners[0]!(session, event)
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(guard.calls.length, 1)
    assert.deepEqual(guard.calls[0]!.session, sessions.get('s1'))
    assert.deepEqual(guard.calls[0]!.options, { trigger: 'watch' })
  })

  it('60ms 冷却内第二条超限错误不触发；冷却过后可再触发', async () => {
    const ctx = fakeCtx()
    const guard = fakeGuard(true)
    const watch = new OverflowWatch({
      guard,
      getSession: (id) => ({ id }),
      cooldownMs: 60,
      logger: () => {},
    })
    watch.attach(ctx as never)
    const handler = ctx.listeners[0]!
    const session = { id: 's2' }

    handler(session, turnEndEvent(0, { kind: 'error', error: { message: 'prompt is too long' } }))
    handler(session, turnEndEvent(1, { kind: 'error', error: { message: 'context window exhausted' } }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(guard.calls.length, 1)

    // 冷却过后（换新 turn）再触发
    await new Promise((resolve) => setTimeout(resolve, 80))
    handler(session, turnEndEvent(2, { kind: 'error', error: { message: 'prompt is too long' } }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(guard.calls.length, 2)
  })

  it('同一 turn 号只触发一次（即使跨过冷却窗口）', async () => {
    const ctx = fakeCtx()
    const guard = fakeGuard(true)
    const watch = new OverflowWatch({
      guard,
      getSession: (id) => ({ id }),
      cooldownMs: 10,
      logger: () => {},
    })
    watch.attach(ctx as never)
    const handler = ctx.listeners[0]!
    const session = { id: 's3' }

    handler(session, turnEndEvent(7, { kind: 'error', error: { message: 'reduce the length' } }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    // 同一 turn 重放（压缩失败重放场景）→ 去重
    handler(session, turnEndEvent(7, { kind: 'error', error: { message: 'reduce the length' } }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(guard.calls.length, 1)
  })

  it('turn/end 正常结束 / 非超限错误 / 非 turn-end 事件均不触发', async () => {
    const ctx = fakeCtx()
    const guard = fakeGuard(true)
    const logs: string[] = []
    const watch = new OverflowWatch({
      guard,
      getSession: (id) => ({ id }),
      logger: (msg) => logs.push(msg),
    })
    watch.attach(ctx as never)
    const handler = ctx.listeners[0]!
    const session = { id: 's4' }

    handler(session, turnEndEvent(0, { kind: 'completed' }))
    handler(session, turnEndEvent(1, { kind: 'aborted', reason: 'user cancel' }))
    handler(session, turnEndEvent(2, { kind: 'error', error: { message: 'connection reset by peer' } }))
    handler(session, { type: 'step/start', data: { turn: 3, step: 1 } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(guard.calls.length, 0)
    assert.equal(logs.length, 0)
  })

  it('compaction=false → 不触发且告警只打一次（多会话共享进程级标记）', async () => {
    const ctx = fakeCtx()
    const guard = fakeGuard(false)
    const logs: string[] = []
    const watch = new OverflowWatch({
      guard,
      getSession: (id) => ({ id }),
      logger: (msg) => logs.push(msg),
    })
    watch.attach(ctx as never)
    const handler = ctx.listeners[0]!

    handler({ id: 'sa' }, turnEndEvent(0, { kind: 'error', error: { message: 'maximum context length exceeded' } }))
    handler({ id: 'sb' }, turnEndEvent(0, { kind: 'error', error: { message: 'maximum context length exceeded' } }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(guard.calls.length, 0)
    const warnings = logs.filter((msg) => msg.includes('compaction 适配不可用'))
    assert.equal(warnings.length, 1)
  })

  it('getSession 未提供或解析不到会话 → 不触发', async () => {
    const ctx = fakeCtx()
    const guard = fakeGuard(true)
    const watch = new OverflowWatch({ guard, logger: () => {} }) // 无 getSession
    watch.attach(ctx as never)
    ctx.listeners[0]!({ id: 'sx' }, turnEndEvent(0, { kind: 'error', error: { message: 'prompt is too long' } }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(guard.calls.length, 0)

    const watch2 = new OverflowWatch({ guard, getSession: () => undefined, logger: () => {} })
    watch2.attach(ctx as never)
    ctx.listeners[1]!({ id: 'sy' }, turnEndEvent(0, { kind: 'error', error: { message: 'prompt is too long' } }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(guard.calls.length, 0)
  })

  it('overflowRetry reject → 只记日志不抛未处理异常', async () => {
    const ctx = fakeCtx()
    const logs: string[] = []
    const guard = {
      status: () => ({ compaction: true }),
      overflowRetry: () => Promise.reject(new Error('压缩失败')),
    }
    const watch = new OverflowWatch({
      guard,
      getSession: (id) => ({ id }),
      logger: (msg) => logs.push(msg),
    })
    watch.attach(ctx as never)
    ctx.listeners[0]!({ id: 'sz' }, turnEndEvent(0, { kind: 'error', error: { message: 'context length exceeded' } }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.ok(logs.some((msg) => msg.includes('超限压缩重试失败')))
  })

  it('attach 幂等：重复 attach 返回同一 disposer；detach 后不再触发', async () => {
    const ctx = fakeCtx()
    const guard = fakeGuard(true)
    const watch = new OverflowWatch({
      guard,
      getSession: (id) => ({ id }),
      logger: () => {},
    })
    const detach1 = watch.attach(ctx as never)
    const detach2 = watch.attach(ctx as never)
    assert.equal(detach1, detach2)
    assert.equal(ctx.listeners.length, 1)

    // 记录 handler 引用，detach 后监听已被移除（fake ctx 的 listeners 为证），
    // 且再次 attach 会注册新监听、可正常触发
    detach1()
    assert.equal(ctx.listeners.length, 0)

    const detach3 = watch.attach(ctx as never)
    assert.notEqual(detach3, detach1)
    assert.equal(ctx.listeners.length, 1)
    ctx.listeners[0]!({ id: 'sd' }, turnEndEvent(0, { kind: 'error', error: { message: 'prompt is too long' } }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(guard.calls.length, 1)
  })
})
