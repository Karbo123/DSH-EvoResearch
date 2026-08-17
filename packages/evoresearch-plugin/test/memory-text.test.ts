/**
 * MEM-10：完整对话原文闭环单元测试（session-text.ts + 归档逻辑）。
 *
 * 五种轮次场景：正常、多 step、工具调用（含长结果落盘）、用户停止、API 失败
 * （含 MEM-08 从 session log 补回）。直接测解析与归档逻辑，不需要 sidecar。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  type SessionEventLike,
  TurnTextAccumulator,
  turnsFromEvents,
  turnInterruptFromEndReason,
  assistantTextForTurn,
  userTextForTurn,
} from '../src/host/session-text.js'
import { ResearchMemoryStore, LONG_TEXT_THRESHOLD } from '../src/host/memory/store.js'
import { recoverMissingAssistantText, reconcileStore } from '../src/host/memory/recovery.js'

/** 事件构造器（seq 自动递增，模拟 session log 顺序）。 */
let seqCounter = 0
function ev(type: string, data: unknown): SessionEventLike {
  return { type, seq: seqCounter++, time: Date.now(), data }
}
function turnStart(turn: number): SessionEventLike {
  return ev('turn/start', { turn })
}
function userMessage(text: string): SessionEventLike {
  return ev('user/message', { content: [{ type: 'text', text }], source: { kind: 'user' } })
}
function textChunk(turn: number, step: number, text: string): SessionEventLike {
  return ev('assistant/chunk', { turn, step, chunk: { type: 'text-delta', index: 0, text } })
}
function reasoningChunk(turn: number, step: number, text: string): SessionEventLike {
  return ev('assistant/chunk', { turn, step, chunk: { type: 'reasoning-delta', index: 0, text } })
}
function assistantMessage(turn: number, step: number, text: string): SessionEventLike {
  return ev('assistant/message', {
    turn,
    step,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'test', model: 'test-model' },
    },
  })
}
function toolCall(turn: number, step: number, callId: string, name: string, args: string): SessionEventLike {
  return ev('tool/call', { turn, step, callId, name, arguments: args })
}
function toolResult(turn: number, step: number, callId: string, text: string): SessionEventLike {
  return ev('tool/result', {
    turn,
    step,
    message: {
      role: 'user',
      content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text }] }],
      source: { kind: 'tool', callId },
    },
  })
}
function turnEnd(turn: number, reason: unknown): SessionEventLike {
  return ev('turn/end', { turn, reason })
}

describe('session-text.ts：正文解析（MEM-01）', () => {
  it('兼容多种事件形状：data.text / data.content[].text / data.blocks[].text', () => {
    const events: SessionEventLike[] = [
      turnStart(1),
      ev('user/message', { text: '直接 text 的用户消息', source: { kind: 'user' } }),
      ev('assistant/message', {
        turn: 1,
        step: 0,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'content 数组消息' }],
          source: { kind: 'model', provider: 'p', model: 'm' },
        },
      }),
      turnEnd(1, { kind: 'completed' }),
      turnStart(2),
      userMessage('blocks 形状'),
      ev('assistant/chunk', { turn: 2, step: 0, blocks: [{ type: 'text', text: 'blocks 增量' }] }),
      turnEnd(2, { kind: 'completed' }),
    ]
    const turns = turnsFromEvents(events)
    assert.equal(turns.length, 2)
    assert.equal(turns[0]?.userText, '直接 text 的用户消息')
    assert.equal(turns[0]?.assistantText, 'content 数组消息')
    assert.equal(turns[1]?.userText, 'blocks 形状')
    assert.equal(turns[1]?.assistantText, 'blocks 增量')
  })

  it('assistant/message 只收 text 块：reasoning 不进入正文', () => {
    const events = [
      turnStart(1),
      userMessage('忽略思考过程'),
      ev('assistant/message', {
        turn: 1,
        step: 0,
        message: {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: '思考过程不该进正文' },
            { type: 'text', text: '这是最终答案' },
          ],
          source: { kind: 'model', provider: 'p', model: 'm' },
        },
      }),
      turnEnd(1, { kind: 'completed' }),
    ]
    const [tr] = turnsFromEvents(events)
    assert.equal(tr?.assistantText, '这是最终答案')
  })

  it('assistant/chunk 只收 text-delta：reasoning-delta 被排除', () => {
    const events = [
      turnStart(1),
      userMessage('问'),
      textChunk(1, 0, '正'),
      reasoningChunk(1, 0, '推理中'),
      textChunk(1, 0, '文'),
      turnEnd(1, { kind: 'completed' }),
    ]
    const [tr] = turnsFromEvents(events)
    assert.equal(tr?.assistantText, '正文')
  })
})

describe('TurnTextAccumulator（MEM-02/MEM-03）', () => {
  it('chunk 到达即按 step 累积；最终 assistant/message 替换 chunk 合并稿', () => {
    const acc = new TurnTextAccumulator()
    acc.feedEvent(textChunk(1, 0, '草稿前'))
    acc.feedEvent(textChunk(1, 0, '草稿后'))
    assert.equal(acc.text(), '草稿前草稿后')
    acc.feedEvent(assistantMessage(1, 0, '完整回答'))
    // MEM-03：以最终消息为准，避免重复正文
    assert.equal(acc.text(), '完整回答')
    assert.equal(acc.steps()[0]?.source, 'message')
  })

  it('无最终消息时保留 chunk 合并稿（中断场景的部分正文）', () => {
    const acc = new TurnTextAccumulator()
    acc.feedEvent(textChunk(1, 0, '部分'))
    acc.feedEvent(textChunk(1, 0, '回答'))
    assert.equal(acc.text(), '部分回答')
    assert.equal(acc.steps()[0]?.source, 'chunks')
  })

  it('多 step 按 step 顺序拼接；工具事件按原序收集', () => {
    const acc = new TurnTextAccumulator()
    acc.feedEvent(textChunk(1, 0, '第一步'))
    acc.feedEvent(assistantMessage(1, 0, '第一步完整'))
    acc.feedEvent(toolCall(1, 0, 'call_1', 'read_file', '{"path":"a"}'))
    acc.feedEvent(toolResult(1, 0, 'call_1', '内容 A'))
    acc.feedEvent(textChunk(1, 1, '第二'))
    acc.feedEvent(textChunk(1, 1, '步'))
    assert.equal(acc.text(), '第一步完整第二步')
    assert.deepEqual(
      acc.steps().map((s) => ({ step: s.step, source: s.source })),
      [{ step: 0, source: 'message' }, { step: 1, source: 'chunks' }],
    )
    assert.deepEqual(
      acc.tools.map((t) => [t.kind, t.callId, t.name ?? t.result]),
      [['call', 'call_1', 'read_file'], ['result', 'call_1', '内容 A']],
    )
  })
})

describe('完整轮次还原（turnsFromEvents）', () => {
  it('正常轮次：userText/assistantText/steps/tools/endReason', () => {
    const events = [
      turnStart(1),
      userMessage('研究注意力机制改进'),
      textChunk(1, 0, '注意力机制'),
      reasoningChunk(1, 0, '思考'),
      textChunk(1, 0, '的改进思路'),
      assistantMessage(1, 0, '注意力机制的改进思路如下…'),
      turnEnd(1, { kind: 'completed' }),
    ]
    const [tr] = turnsFromEvents(events)
    assert.equal(tr?.turn, 1)
    assert.equal(tr?.userText, '研究注意力机制改进')
    // 最终 message 为准，reasoning 不进入
    assert.equal(tr?.assistantText, '注意力机制的改进思路如下…')
    assert.equal(tr?.steps[0]?.source, 'message')
    assert.equal(tr?.endReason?.kind, 'completed')
    assert.equal(assistantTextForTurn(events, 1), '注意力机制的改进思路如下…')
    assert.equal(userTextForTurn(events, 1), '研究注意力机制改进')
  })

  it('多 step 轮次：message 优先 + chunk 合并回退', () => {
    const events = [
      turnStart(2),
      userMessage('对比两种方法'),
      textChunk(2, 0, '方法A草稿'),
      assistantMessage(2, 0, '方法 A 的说明。'),
      toolCall(2, 0, 'call_1', 'read_file', '{"path":"a.md"}'),
      toolResult(2, 0, 'call_1', '文件内容 A'),
      textChunk(2, 1, '方法 B 的'),
      textChunk(2, 1, '说明。'),
      turnEnd(2, { kind: 'completed' }),
    ]
    const [tr] = turnsFromEvents(events)
    assert.equal(tr?.assistantText, '方法 A 的说明。方法 B 的说明。')
    assert.deepEqual(
      tr?.steps.map((s) => [s.step, s.source]),
      [[0, 'message'], [1, 'chunks']],
    )
    assert.deepEqual(
      tr?.tools.map((t) => [t.kind, t.callId, t.name ?? t.result]),
      [['call', 'call_1', 'read_file'], ['result', 'call_1', '文件内容 A']],
    )
  })

  it('系统注入的伪用户消息不进入 userText', () => {
    const events = [
      turnStart(1),
      ev('user/message', { content: [{ type: 'text', text: 'Current runtime context 系统注入内容' }], source: { kind: 'plugin', plugin: 'x' } }),
      userMessage('真实问题'),
      assistantMessage(1, 0, '回答'),
      turnEnd(1, { kind: 'completed' }),
    ]
    const [tr] = turnsFromEvents(events)
    assert.equal(tr?.userText, '真实问题')
  })
})

describe('MEM-07：archiveTurn 幂等与工具归档（MEM-06）', () => {
  it('正常轮次归档 + 重复执行不产生重复 segment', () => {
    const store = ResearchMemoryStore.openMemory()
    store.createPendingTurn({ turnId: 't1', sessionId: 's1', workspaceDir: '', userText: '研究注意力机制改进', categories: [], topicKeys: [] })
    store.updateTurn('t1', { status: 'completed', assistantText: '注意力机制的改进思路如下…' })
    const turn = store.getTurn('t1')!
    assert.equal(store.archiveTurn(turn), 2) // user + assistant
    assert.equal(store.archiveTurn(turn), 0) // 幂等：全部已存在
    const segments = store.listSegments('t1')
    assert.equal(segments.length, 2)
    assert.deepEqual(segments.map((s) => s.kind), ['user', 'assistant'])
    store.close()
  })

  it('工具调用与结果按原事件顺序进入原始轮次档案', () => {
    const store = ResearchMemoryStore.openMemory()
    store.createPendingTurn({ turnId: 't2', sessionId: 's2', workspaceDir: '', userText: '读文件', categories: [], topicKeys: [] })
    store.updateTurn('t2', { status: 'completed', assistantText: '文件内容总结' })
    const turn = store.getTurn('t2')!
    store.archiveTurn(turn, {
      tools: [
        { seq: 4, kind: 'call', callId: 'call_1', name: 'read_file', arguments: '{"path":"a.md"}' },
        { seq: 6, kind: 'result', callId: 'call_1', result: '文件内容 A' },
        { seq: 5, kind: 'call', callId: 'call_2', name: 'read_file', arguments: '{"path":"b.md"}' },
      ],
    })
    const toolSegments = store.listSegments('t2').filter((s) => s.kind === 'tool')
    assert.equal(toolSegments.length, 3)
    // 按 seq 升序（原事件顺序）
    const payloads = toolSegments.map((s) => JSON.parse(s.payload) as Record<string, unknown>)
    assert.deepEqual(payloads.map((p) => p.seq), [4, 5, 6])
    assert.deepEqual(payloads.map((p) => p.kind), ['call', 'call', 'result'])
    assert.equal(payloads[0]?.name, 'read_file')
    assert.equal(payloads[0]?.arguments, '{"path":"a.md"}')
    assert.equal(payloads[2]?.result, '文件内容 A')
    // 幂等：重跑不重复
    assert.equal(store.archiveTurn(turn, { tools: [{ seq: 4, kind: 'call', callId: 'call_1', name: 'read_file' }] }), 0)
    assert.equal(store.listSegments('t2').filter((s) => s.kind === 'tool').length, 3)
    store.close()
  })

  it('长结果（>64KB）完整内容落盘 archives/，数据库只存可检索文本 + 文件位置', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-text-'))
    // 测试卫生（BASE-02）：用例结束（含失败路径）清理临时目录
    t.after(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })
    const archivesDir = path.join(dir, 'archives')
    const store = ResearchMemoryStore.openMemory(archivesDir)
    store.createPendingTurn({ turnId: 't3', sessionId: 's3', workspaceDir: '', userText: '大文件', categories: [], topicKeys: [] })
    store.updateTurn('t3', { status: 'completed', assistantText: '总结' })
    const big = `头部可检索内容\n${'x'.repeat(LONG_TEXT_THRESHOLD + 500)}`
    store.archiveTurn(store.getTurn('t3')!, {
      tools: [{ seq: 2, kind: 'result', callId: 'call_big', result: big }],
    })
    const toolSegments = store.listSegments('t3').filter((s) => s.kind === 'tool')
    assert.equal(toolSegments.length, 1)
    const payload = JSON.parse(toolSegments[0]!.payload) as { result: string; resultFile: string; seq: number }
    assert.equal(payload.seq, 2)
    // 数据库只存可检索前缀（截断）+ 文件位置
    assert.ok(payload.result.length < LONG_TEXT_THRESHOLD)
    assert.ok(payload.result.startsWith('头部可检索内容'))
    assert.ok(payload.resultFile.includes('archives'))
    // 文件保存完整内容
    assert.ok(fs.existsSync(payload.resultFile))
    assert.equal(fs.readFileSync(payload.resultFile, 'utf8'), big)
    store.close()
  })
})

describe('MEM-05：中断轮次', () => {
  it('用户停止：保留已生成正文 + 自然语言中断说明，归档含 note 段', () => {
    const events = [
      turnStart(3),
      userMessage('请写代码'),
      textChunk(3, 0, '部分'),
      textChunk(3, 0, '代码输出'),
      turnEnd(3, { kind: 'aborted', reason: { kind: 'user' } }),
    ]
    const [tr] = turnsFromEvents(events)
    assert.equal(tr?.assistantText, '部分代码输出') // 中断保留已生成正文
    const interrupt = turnInterruptFromEndReason(tr?.endReason)
    assert.deepEqual(interrupt, { interrupted: true, interruptReason: 'user_stop' })
    // 归档中断轮次：user + assistant + note（不把部分回答伪装成完整回答）
    const store = ResearchMemoryStore.openMemory()
    store.createPendingTurn({ turnId: 't-stop', sessionId: 's3', workspaceDir: '', userText: tr!.userText, categories: [], topicKeys: [] })
    store.updateTurn('t-stop', {
      status: 'interrupted',
      interruptReason: 'user_stop',
      assistantText: tr!.assistantText,
      partialNote: '回答被中断（用户停止）：已保留已生成的部分正文（6 字符）。',
    })
    store.archiveTurn(store.getTurn('t-stop')!)
    const segments = store.listSegments('t-stop')
    assert.deepEqual(segments.map((s) => s.kind), ['user', 'assistant', 'note'])
    assert.equal(segments[2]?.payload, '回答被中断（用户停止）：已保留已生成的部分正文（6 字符）。')
    assert.equal(store.getTurn('t-stop')?.status, 'interrupted')
    store.close()
  })

  it('API 失败：api_failure 判定', () => {
    const events = [
      turnStart(4),
      userMessage('翻译这段'),
      textChunk(4, 0, '译'),
      textChunk(4, 0, '文：'),
      turnEnd(4, { kind: 'error', error: { code: 'E_TIMEOUT', message: 'provider timeout' } }),
    ]
    const [tr] = turnsFromEvents(events)
    assert.equal(tr?.assistantText, '译文：')
    assert.deepEqual(turnInterruptFromEndReason(tr?.endReason), { interrupted: true, interruptReason: 'api_failure' })
  })
})

describe('MEM-08：assistant 文本从 DSH session log 补回', () => {
  it('库中缺失 assistantText 的轮次按 (sessionId, userText) 匹配补回并补齐归档段', () => {
    const events = [
      turnStart(4),
      userMessage('翻译这段'),
      textChunk(4, 0, '译'),
      textChunk(4, 0, '文：'),
      assistantMessage(4, 0, '译文：你好。'),
      turnEnd(4, { kind: 'completed' }),
    ]
    const store = ResearchMemoryStore.openMemory()
    // 模拟进程在 assistant 写回前崩溃：completed 但 assistant_text 为空
    store.createPendingTurn({ turnId: 't-api', sessionId: 's5', workspaceDir: '', userText: '翻译这段', categories: [], topicKeys: [] })
    store.updateTurn('t-api', { status: 'completed' })
    // 已归档但只有 user 段（对账补回前）
    store.archiveTurn(store.getTurn('t-api')!)
    assert.deepEqual(store.listSegments('t-api').map((s) => s.kind), ['user'])

    const { recovered } = recoverMissingAssistantText(store, { eventsOf: () => events })
    assert.equal(recovered, 1)
    assert.equal(store.getTurn('t-api')?.assistantText, '译文：你好。')
    // 重跑 archiveTurn（幂等）补齐 assistant 段
    const segments = store.listSegments('t-api')
    assert.deepEqual(segments.map((s) => s.kind), ['user', 'assistant'])
    assert.equal(segments[1]?.payload, '译文：你好。')
    store.close()
  })

  it('reconcileStore 对账集成：缺 assistantText 的轮次从注入事件补回', () => {
    const events = [
      turnStart(1),
      userMessage('整理实验记录'),
      textChunk(1, 0, '实验'),
      textChunk(1, 0, '记录整理'),
      turnEnd(1, { kind: 'completed' }),
    ]
    const store = ResearchMemoryStore.openMemory()
    store.createPendingTurn({ turnId: 't-rec', sessionId: 's9', workspaceDir: '', userText: '整理实验记录', categories: [], topicKeys: [] })
    store.updateTurn('t-rec', { status: 'completed' })
    const result = reconcileStore(store, { eventsOf: () => events })
    assert.equal(result.assistantRecovered, 1)
    assert.equal(store.getTurn('t-rec')?.assistantText, '实验记录整理')
    // 补回后自动完成归档（user + assistant）
    assert.deepEqual(store.listSegments('t-rec').map((s) => s.kind), ['user', 'assistant'])
    store.close()
  })

  it('无匹配轮次/日志缺失时不误改', () => {
    const store = ResearchMemoryStore.openMemory()
    store.createPendingTurn({ turnId: 't-none', sessionId: 's-missing', workspaceDir: '', userText: '不存在的会话', categories: [], topicKeys: [] })
    store.updateTurn('t-none', { status: 'completed' })
    const { recovered } = recoverMissingAssistantText(store, { eventsOf: () => [] })
    assert.equal(recovered, 0)
    assert.equal(store.getTurn('t-none')?.assistantText, '')
    store.close()
  })
})
