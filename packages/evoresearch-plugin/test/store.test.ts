/**
 * 科研记忆 存储层单元测试（内存库）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ResearchMemoryStore, parseObservationFile, renderObservationFile } from '../src/host/memory/store.js'

describe('ResearchMemoryStore', () => {
  it('Turn Catalog 全生命周期', () => {
    const store = ResearchMemoryStore.openMemory()
    store.createPendingTurn({ turnId: 't1', sessionId: 's1', workspaceDir: '/w', userText: '我想研究新方法', categories: ['method'], topicKeys: ['method-abc'] })
    let turn = store.getTurn('t1')
    assert.equal(turn?.status, 'pending')
    store.updateTurn('t1', { status: 'completed', assistantText: '好的，我们研究 X 方法。' })
    turn = store.getTurn('t1')
    assert.equal(turn?.status, 'completed')
    assert.ok(turn?.assistantText.includes('X 方法'))
    store.close()
  })

  it('分类统计与 topic states', () => {
    const store = ResearchMemoryStore.openMemory()
    store.createPendingTurn({ turnId: 't1', sessionId: 's1', workspaceDir: '', userText: 'a', categories: ['idea', 'method'], topicKeys: [] })
    store.createPendingTurn({ turnId: 't2', sessionId: 's1', workspaceDir: '', userText: 'b', categories: ['idea'], topicKeys: [] })
    const counts = store.countByCategory()
    assert.equal(counts['idea'], 2)
    assert.equal(counts['method'], 1)
    store.upsertTopicState({ category: 'idea', topicKey: 'idea-x', label: '新想法', decision: '采用 A 方案', openQuestions: ['B 是否可行'], sourceTurnIds: ['t1'], updatedAt: Date.now() })
    const states = store.listTopicStates('idea')
    assert.equal(states.length, 1)
    assert.equal(states[0]?.decision, '采用 A 方案')
    store.close()
  })

  it('FTS5 轮次检索', () => {
    const store = ResearchMemoryStore.openMemory()
    store.createPendingTurn({ turnId: 't1', sessionId: 's1', workspaceDir: '', userText: '注意力机制的改进', categories: ['method'], topicKeys: [] })
    store.createPendingTurn({ turnId: 't2', sessionId: 's1', workspaceDir: '', userText: '周末的天气不错', categories: ['general'], topicKeys: [] })
    const hits = store.searchTurnsFts('注意力', 10)
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.turn.turnId, 't1')
    store.close()
  })

  it('Observation 写入（Markdown 文件 + 索引）', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-obs-'))
    // 测试卫生（BASE-02）：用例结束（含失败路径）清理临时目录
    t.after(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })
    const store = ResearchMemoryStore.openMemory()
    const meta = store.writeObservation(dir, {
      observationId: 'O-test1',
      title: '实验结论：A 优于 B',
      body: '在 CIFAR 上 A 比 B 高 2 个点。',
      categories: ['experiment'],
      primaryCategory: 'experiment',
      topicKeys: ['experiment-1'],
      entities: ['CIFAR'],
      sourceTurnIds: ['t1'],
    })
    assert.equal(meta.status, 'active')
    // 文件真实存在且 frontmatter 可解析
    const file = fs.readFileSync(path.join(dir, 'global', 'O-test1.md'), 'utf8')
    const parsed = parseObservationFile(file)
    assert.equal(parsed.frontmatter.status, 'active')
    assert.ok(parsed.body.includes('CIFAR'))
    // supersede 后检索默认过滤
    store.supersedeObservation(dir, 'O-test1', 'O-test2')
    const active = store.listObservations()
    assert.equal(active.length, 0)
    const superseded = store.listObservations({ status: 'superseded' })
    assert.equal(superseded.length, 1)
    store.close()
  })

  it('frontmatter 渲染与解析往返', () => {
    const content = renderObservationFile({
      title: '标题',
      body: '正文',
      categories: ['idea'],
      primaryCategory: 'idea',
      topicKeys: ['idea-1'],
      entities: [],
      sourceTurnIds: [],
      status: 'active',
      createdAt: 1,
      updatedAt: 2,
    })
    const parsed = parseObservationFile(content)
    assert.equal(parsed.frontmatter.title, '标题')
    assert.equal(parsed.frontmatter.categories?.[0], 'idea')
    assert.equal(parsed.body, '正文')
  })

  it('Goal 合同与事件账本', () => {
    const store = ResearchMemoryStore.openMemory()
    const goal = {
      goalId: 'g1',
      title: '完成综述',
      objective: '完成 SIGIR 综述',
      criteria: [{ id: 'c1', text: '覆盖 100 篇论文', satisfied: false, evidence: [] }],
      constraints: ['只使用 arxiv'],
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    store.saveGoal(goal)
    store.appendGoalEvent('g1', JSON.stringify({ kind: 'created' }))
    assert.equal(store.getGoal('g1')?.title, '完成综述')
    assert.equal(store.listRecentGoals().length, 1)
    store.close()
  })

  it('「继续」消息映射回原轮', () => {
    const store = ResearchMemoryStore.openMemory()
    store.createPendingTurn({ turnId: 't1', sessionId: 's1', workspaceDir: '', userText: '原始请求', categories: [], topicKeys: [] })
    store.linkContinuation('msg-continue-1', 't1')
    assert.equal(store.findTurnByContinuation('msg-continue-1')?.turnId, 't1')
    assert.equal(store.findTurnByContinuation('msg-other'), undefined)
    store.close()
  })

  it('v3 Raw Turn Archive：整轮归档与分段读取', () => {
    const store = ResearchMemoryStore.openMemory()
    store.createPendingTurn({ turnId: 't1', sessionId: 's1', workspaceDir: '', userText: '用户问题', categories: ['idea'], topicKeys: ['idea-1'] })
    store.updateTurn('t1', { status: 'completed', assistantText: '模型回答', workingSummary: '工作摘要' })
    const turn = store.getTurn('t1')!
    store.archiveTurn(turn)
    const segments = store.listSegments('t1')
    // user + assistant + summary 三段（无 partialNote 不写 note 段）
    assert.equal(segments.length, 3)
    assert.deepEqual(segments.map((s) => s.kind), ['user', 'assistant', 'summary'])
    assert.equal(segments[0]?.payload, '用户问题')
    assert.equal(segments[1]?.payload, '模型回答')
    assert.equal(segments[2]?.payload, '工作摘要')
    // 归档不删除活跃投影
    assert.equal(store.getTurn('t1')?.status, 'completed')
    store.close()
  })

  it('v3 Raw Turn Archive：分段 seq 递增与 note 段', () => {
    const store = ResearchMemoryStore.openMemory()
    store.createPendingTurn({ turnId: 't2', sessionId: 's1', workspaceDir: '', userText: 'q', categories: [], topicKeys: [] })
    store.updateTurn('t2', { status: 'interrupted', interruptReason: 'user_stop', partialNote: '部分输出', assistantText: '半截回答' })
    const turn = store.getTurn('t2')!
    store.archiveTurn(turn)
    const segments = store.listSegments('t2')
    assert.equal(segments.length, 3)
    assert.deepEqual(segments.map((s) => s.kind), ['user', 'assistant', 'note'])
    assert.equal(segments[0]?.seq, 0)
    assert.equal(segments[1]?.seq, 1)
    assert.equal(segments[2]?.seq, 2)
    store.close()
  })
})
