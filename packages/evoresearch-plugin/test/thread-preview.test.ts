/**
 * 会话尾部预览（P0-1 数据层）测试：extractPreview 纯函数 + resolveThreadPreview 编排。
 *
 * 覆盖：
 * - extractPreview：title/cwd 提取、尾部消息收集顺序（老→新）、单条 300 截断、
 *   总量 1600 截停、最多条数、updatedAt 取最大 time、空事件默认值；
 * - resolveThreadPreview：live 命中不查 query（spy 计数）、live miss + query 命中、
 *   全 miss → null、query 抛错降级 fileEvents。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractPreview, resolveThreadPreview, type PreviewEventLike, type PreviewSources } from '../src/host/thread-preview.js'

/** 合成一条 user/message 事件。 */
function userEvent(seq: number, text: string, time: number): PreviewEventLike {
  return { seq, type: 'user/message', time, data: { id: `m${seq}`, role: 'user', content: [{ type: 'text', text }] } }
}

/** 合成一条 assistant/message 事件（文本在 data.message.content）。 */
function assistantEvent(seq: number, text: string, time: number): PreviewEventLike {
  return {
    seq,
    type: 'assistant/message',
    time,
    data: { id: `a${seq}`, message: { role: 'assistant', content: [{ type: 'text', text }] } },
  }
}

// ── extractPreview ──────────────────────────────────────────────────────────

describe('extractPreview', () => {
  it('提取 title/cwd，摘录按时间正序拼接，updatedAt 取最大 time', () => {
    const events: PreviewEventLike[] = [
      { seq: 0, type: 'session', time: 100, data: { cwd: 'D:/research/projects/demo' } },
      { seq: 1, type: 'session/title', time: 150, data: { title: '注意力机制调研' } },
      userEvent(2, '第一问', 200),
      assistantEvent(3, '第一答', 300),
      userEvent(4, '第二问', 400),
    ]
    const preview = extractPreview('s-1', events)
    assert.equal(preview.sessionId, 's-1')
    assert.equal(preview.title, '注意力机制调研')
    assert.equal(preview.cwd, 'D:/research/projects/demo')
    assert.equal(preview.updatedAt, 400)
    assert.equal(preview.messageCount, 3)
    // 老→新顺序
    assert.equal(preview.excerpt, ['第一问', '第一答', '第二问'].join('\n'))
  })

  it('cwd 兼容 data.meta.cwd（session/header 形态）', () => {
    const events: PreviewEventLike[] = [
      { seq: 0, type: 'session/header', time: 10, data: { meta: { cwd: '/w/demo' } } },
    ]
    assert.equal(extractPreview('s-2', events).cwd, '/w/demo')
  })

  it('单条超长文本按 300 字符截断', () => {
    const long = 'x'.repeat(500)
    const preview = extractPreview('s-3', [userEvent(1, long, 5)])
    assert.equal(preview.excerpt.length, 300)
    assert.equal(preview.messageCount, 1)
  })

  it('累计超过 1600 字符截停（更早的消息被丢弃）', () => {
    const events = [
      userEvent(1, 'y'.repeat(400), 10), // 参与后累计 300
      assistantEvent(2, 'z'.repeat(400), 20), // 累计 600
      userEvent(3, 'w'.repeat(400), 30), // 累计 900
      assistantEvent(4, 'v'.repeat(400), 40), // 累计 1200
      userEvent(5, 'u'.repeat(400), 50), // 1200+300=1500 ≤1600 参与
      assistantEvent(6, 't'.repeat(400), 60), // 1500+300>1600 → 停（此条不参与）
      userEvent(7, 'newest', 70),
    ]
    const preview = extractPreview('s-4', events)
    // 从尾向头收集：newest(7,6字) → t/u/v/w/z 各 300（累计 1506）→ y 再加会超 1600 → 停。
    // 共参与 6 条；摘录老→新以第 2 条开头、最新一条结尾。
    assert.equal(preview.messageCount, 6)
    assert.ok(preview.excerpt.startsWith('z'))
    assert.ok(preview.excerpt.endsWith('newest'))
    assert.ok(preview.excerpt.length <= 1600)
    assert.ok(!preview.excerpt.includes('y'.repeat(100)))
  })

  it('超过 tailCount 条时只保留最近的若干条', () => {
    const events = [
      userEvent(1, 'old-1', 10),
      userEvent(2, 'old-2', 20),
      userEvent(3, 'old-3', 30),
      userEvent(4, 'old-4', 40),
      userEvent(5, 'old-5', 50),
      userEvent(6, 'old-6', 60),
      userEvent(7, 'old-7', 70),
      userEvent(8, 'newest', 80),
    ]
    const preview = extractPreview('s-5', events)
    assert.equal(preview.messageCount, 6)
    assert.ok(!preview.excerpt.includes('old-1'))
    assert.ok(!preview.excerpt.includes('old-2'))
    assert.ok(preview.excerpt.startsWith('old-3'))
    assert.ok(preview.excerpt.endsWith('newest'))
  })

  it('非文本块与系统注入（无文本）不参与摘录', () => {
    const events: PreviewEventLike[] = [
      { seq: 1, type: 'tool/call', time: 10, data: { name: 'read' } },
      { seq: 2, type: 'user/message', time: 20, data: { content: [{ type: 'image', url: 'x' }] } },
      userEvent(3, '真实提问', 30),
    ]
    const preview = extractPreview('s-6', events)
    assert.equal(preview.messageCount, 1)
    assert.equal(preview.excerpt, '真实提问')
  })

  it('空事件数组返回各默认值', () => {
    const preview = extractPreview('s-7', [])
    assert.deepEqual(preview, {
      sessionId: 's-7',
      title: null,
      cwd: null,
      updatedAt: 0,
      excerpt: '',
      messageCount: 0,
    })
  })
})

// ── resolveThreadPreview ────────────────────────────────────────────────────

describe('resolveThreadPreview', () => {
  it('live 命中时不调用 query/file（spy 计数为 0）', async () => {
    let queryCalls = 0
    let fileCalls = 0
    const sources: PreviewSources = {
      liveGet: (id) => ({ events: [{ seq: 1, type: 'user/message', time: 5, data: { content: [{ type: 'text', text: 'live 消息' }] } }] }),
      queryListEvents: (id) => {
        queryCalls += 1
        return []
      },
      fileEvents: (id) => {
        fileCalls += 1
        return []
      },
    }
    const preview = await resolveThreadPreview(sources, 's-live')
    assert.equal(queryCalls, 0)
    assert.equal(fileCalls, 0)
    assert.equal(preview?.excerpt, 'live 消息')
  })

  it('live miss 后 query 命中', async () => {
    const sources: PreviewSources = {
      liveGet: () => undefined,
      queryListEvents: () => [{ seq: 1, type: 'user/message', time: 5, data: { content: [{ type: 'text', text: 'query 消息' }] } }],
    }
    const preview = await resolveThreadPreview(sources, 's-query')
    assert.equal(preview?.excerpt, 'query 消息')
  })

  it('全部数据源为空/缺失 → null', async () => {
    assert.equal(await resolveThreadPreview({}, 's-none'), null)
    assert.equal(
      await resolveThreadPreview(
        { liveGet: () => undefined, queryListEvents: () => [], fileEvents: () => [] },
        's-empty',
      ),
      null,
    )
  })

  it('query 抛错时降级到 fileEvents', async () => {
    const sources: PreviewSources = {
      liveGet: () => undefined,
      queryListEvents: () => {
        throw new Error('sessionQuery unavailable')
      },
      fileEvents: () => [{ seq: 9, type: 'assistant/message', time: 9, data: { message: { content: [{ type: 'text', text: 'file 消息' }] } } }],
    }
    const preview = await resolveThreadPreview(sources, 's-file')
    assert.equal(preview?.excerpt, 'file 消息')
    assert.equal(preview?.updatedAt, 9)
  })

  it('query 返回 Promise 且 reject 时同样降级', async () => {
    const sources: PreviewSources = {
      queryListEvents: async () => {
        throw new Error('async boom')
      },
      fileEvents: () => [userEvent(1, '落盘消息', 1)],
    }
    const preview = await resolveThreadPreview(sources, 's-async')
    assert.equal(preview?.excerpt, '落盘消息')
  })
})
