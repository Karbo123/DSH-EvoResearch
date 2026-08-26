/**
 * P1-3 ask_researcher 工具测试（fake ctx + fake userQuestions，无真实 UI）。
 *
 * 覆盖：服务缺失返回 undefined、正常回答透传 selected/custom、用户拒绝
 * （reject）降级、超时降级 timed_out、multiSelect 传递到 ask 入参。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { registerAskResearcherTool } from '../src/host/tools/ask.js'
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'

/** ask 请求的最小结构（与 dsh-user-questions AskUserQuestionRequest 同形）。 */
interface AskUserQuestionRequest {
  questions: AskUserQuestionItem[]
  agent?: unknown
  signal?: AbortSignal
}

/** fake userQuestions：ask 行为可配置，并记录入参。 */
interface FakeUq {
  ask: (request: AskUserQuestionRequest) => Promise<AskUserQuestionAnswer>
  calls: AskUserQuestionRequest[]
}

function fakeUq(behavior: () => Promise<AskUserQuestionAnswer>): FakeUq {
  const calls: AskUserQuestionRequest[] = []
  return {
    calls,
    ask: (request) => {
      calls.push(request)
      return behavior()
    },
  }
}

/** fake ctx：只提供给定服务名；tools 服务带记录型 register（返回 disposer）。 */
function fakeCtx(services: Record<string, unknown>): { get(name: string): unknown; registered: unknown[] } {
  const registered: unknown[] = []
  // 把记录型 register 注入 tools 服务本身（ctx.get('tools').register）
  const resolvedServices = services.tools !== undefined
    ? { ...services, tools: { ...services.tools, register: (definition: unknown) => { registered.push(definition); return () => {} } } }
    : services
  return {
    get: (name) => resolvedServices[name],
    registered,
  }
}

/** 标准回答（q1 → selected/custom）。 */
function answerOf(selected: string[], custom?: string): AskUserQuestionAnswer {
  return { answers: [{ id: 'q1', selected, ...(custom !== undefined ? { custom } : {}) }] }
}

interface DefinitionLike {
  name: string
  execute(args: unknown, exec: unknown): Promise<unknown>
}

/** 注册并取出工具 definition（fake ctx 已带 tools 服务）。 */
function registeredDefinition(ctx: ReturnType<typeof fakeCtx>): DefinitionLike {
  assert.equal(ctx.registered.length, 1)
  const definition = ctx.registered[0] as DefinitionLike
  assert.equal(definition.name, 'ask_researcher')
  return definition
}

describe('registerAskResearcherTool', () => {
  it('userQuestions 服务缺失 → 告警并返回 undefined，不注册工具', () => {
    const ctx = fakeCtx({})
    const disposer = registerAskResearcherTool(ctx as never)
    assert.equal(disposer, undefined)
    assert.equal(ctx.registered.length, 0)
  })

  it('ask 方法不存在（非函数）→ 同样返回 undefined', () => {
    const ctx = fakeCtx({ userQuestions: {} })
    assert.equal(registerAskResearcherTool(ctx as never), undefined)
  })

  it('正常回答：selected / custom 透传为 ok:true 结果', async () => {
    const uq = fakeUq(() => Promise.resolve(answerOf(['官方实现'], '优先对齐论文')))
    const ctx = fakeCtx({ userQuestions: uq, tools: {} })
    const disposer = registerAskResearcherTool(ctx as never)
    assert.equal(typeof disposer, 'function')
    const definition = registeredDefinition(ctx)

    const result = await definition.execute(
      {
        question: '对比方法用官方实现还是社区复现？',
        options: [
          { label: '官方实现', description: '结果可信' },
          { label: '社区复现', description: '更灵活' },
        ],
        free_text_hint: '可补充理由',
      },
      {},
    )
    assert.deepEqual(result, { ok: true, selected: ['官方实现'], custom: '优先对齐论文' })

    // 入参映射：id=q1、options 透传、multiSelect 默认 false、free_text_hint 进 detail
    assert.equal(uq.calls.length, 1)
    const request = uq.calls[0]!
    assert.equal(request.questions.length, 1)
    const item = request.questions[0]!
    assert.equal(item.id, 'q1')
    assert.equal(item.question, '对比方法用官方实现还是社区复现？')
    assert.deepEqual(item.options?.map((option) => option.label), ['官方实现', '社区复现'])
    assert.equal(item.multiSelect, false)
    assert.equal(item.detail, '可补充理由')
  })

  it('仅自由文本（无 options）：questions[0] 不带 options 字段', async () => {
    const uq = fakeUq(() => Promise.resolve(answerOf([], '自定义方案 X')))
    const ctx = fakeCtx({ userQuestions: uq, tools: {} })
    registerAskResearcherTool(ctx as never)
    const definition = registeredDefinition(ctx)
    const result = await definition.execute({ question: '还有什么补充约束？' }, {})
    assert.equal((result as { ok: boolean }).ok, true)
    assert.equal((result as { custom?: string }).custom, '自定义方案 X')
    const item = uq.calls[0]!.questions[0]!
    assert.equal(item.options, undefined)
  })

  it('question 缺失/空白 → ok:false 带 note，不调用 ask', async () => {
    const uq = fakeUq(() => Promise.resolve(answerOf([])))
    const ctx = fakeCtx({ userQuestions: uq, tools: {} })
    registerAskResearcherTool(ctx as never)
    const definition = registeredDefinition(ctx)
    const result = (await definition.execute({ question: '   ' }, {})) as { ok: boolean; note?: string }
    assert.equal(result.ok, false)
    assert.ok(result.note !== undefined && result.note !== '')
    assert.equal(uq.calls.length, 0)
  })

  it('用户拒绝（uq.ask reject）→ ok:false 带 note，不抛异常', async () => {
    const uq = fakeUq(() => Promise.reject(new Error('用户关闭了问题卡片')))
    const ctx = fakeCtx({ userQuestions: uq, tools: {} })
    registerAskResearcherTool(ctx as never)
    const definition = registeredDefinition(ctx)
    const result = (await definition.execute({ question: '选哪个？' }, {})) as { ok: boolean; note?: string; timed_out?: boolean }
    assert.equal(result.ok, false)
    assert.equal(result.timed_out, undefined)
    assert.equal(result.note, '用户关闭了问题卡片')
  })

  it('超时无人回答 → ok:false 且 timed_out:true（timeoutMs 可配置缩短）', async () => {
    const uq = fakeUq(() => new Promise<AskUserQuestionAnswer>(() => { /* 永不 resolve */ }))
    const ctx = fakeCtx({ userQuestions: uq, tools: {} })
    registerAskResearcherTool(ctx as never, { timeoutMs: 30 })
    const definition = registeredDefinition(ctx)
    const result = (await definition.execute({ question: '消融先做哪组？' }, {})) as { ok: boolean; timed_out?: boolean; note?: string }
    assert.equal(result.ok, false)
    assert.equal(result.timed_out, true)
    assert.ok(result.note?.includes('降级'))
  })

  it('multi_select=true 传递到 ask 的 questions[0].multiSelect === true', async () => {
    const uq = fakeUq(() => Promise.resolve(answerOf(['A', 'B'])))
    const ctx = fakeCtx({ userQuestions: uq, tools: {} })
    registerAskResearcherTool(ctx as never)
    const definition = registeredDefinition(ctx)
    const result = (await definition.execute(
      { question: '保留哪些基线？', options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }], multi_select: true },
      {},
    )) as { ok: boolean; selected?: string[] }
    assert.equal(uq.calls[0]!.questions[0]!.multiSelect, true)
    assert.deepEqual(result.selected, ['A', 'B'])
  })

  it('exec.agent 与 exec.signal 透传到 ask 请求', async () => {
    const uq = fakeUq(() => Promise.resolve(answerOf(['ok'])))
    const ctx = fakeCtx({ userQuestions: uq, tools: {} })
    registerAskResearcherTool(ctx as never)
    const definition = registeredDefinition(ctx)
    const agent = { session: { id: 's1' } }
    const controller = new AbortController()
    await definition.execute({ question: '确认？' }, { agent, signal: controller.signal })
    const request = uq.calls[0]!
    assert.equal(request.agent, agent)
    assert.equal(request.signal, controller.signal)
  })

  it('options 归一化：空 label 剔除、最多保留 6 个', async () => {
    const uq = fakeUq(() => Promise.resolve(answerOf(['x'])))
    const ctx = fakeCtx({ userQuestions: uq, tools: {} })
    registerAskResearcherTool(ctx as never)
    const definition = registeredDefinition(ctx)
    await definition.execute(
      {
        question: '选法？',
        options: [
          { label: '' }, // 空标签剔除
          { label: 'a' },
          { label: 'b' },
          { label: 'c' },
          { label: 'd' },
          { label: 'e' },
          { label: 'f' },
          { label: 'g' }, // 第 7 个被截断
        ],
      },
      {},
    )
    const labels = uq.calls[0]!.questions[0]!.options?.map((option) => option.label) ?? []
    assert.deepEqual(labels, ['a', 'b', 'c', 'd', 'e', 'f'])
  })
})
