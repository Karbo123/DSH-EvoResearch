/**
 * 分类器与 Goal Control 单元测试（确定性路径）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyDeterministic, canonicalizeTopicKeys, normalizeLabel, labelForCategory } from '../src/host/memory/classifier.js'
import { looksLongHorizon, judgeProgress, renderGoalProjection } from '../src/host/memory/goals.js'
import type { GoalContract } from '../src/shared/types.js'

describe('classifyDeterministic', () => {
  it('实验类', () => {
    const result = classifyDeterministic('我们在 CIFAR-10 上做了实验，精度提升 2 个点')
    assert.ok(result.categories.includes('experiment'))
    assert.equal(result.fallback, true)
  })

  it('复现/代码类', () => {
    const result = classifyDeterministic('这个仓库跑不起来，报错 ModuleNotFoundError')
    assert.ok(result.categories.includes('reproduction'))
  })

  it('无关键词时回退 general', () => {
    const result = classifyDeterministic('随便聊聊今天的天气')
    assert.deepEqual(result.categories, ['general'])
  })

  it('标签', () => {
    assert.ok(labelForCategory('idea').length > 0)
  })
})

describe('canonicalizeTopicKeys', () => {
  it('词面匹配复用已有 topic key', () => {
    const existing = new Map([['idea', [{ topicKey: 'idea-abc', label: '新想法' }]]])
    const result = canonicalizeTopicKeys(existing, { categories: ['idea'], labels: [{ category: 'idea', label: '新想法' }], fallback: false }, 'text')
    assert.equal(result[0]?.topicKey, 'idea-abc')
  })

  it('无匹配时生成新 key', () => {
    const existing = new Map<string, Array<{ topicKey: string; label: string }>>()
    const result = canonicalizeTopicKeys(existing, { categories: ['method'], labels: [{ category: 'method', label: '新方法' }], fallback: false }, 'text')
    assert.ok(result[0]?.topicKey.startsWith('method-'))
  })
})

describe('normalizeLabel', () => {
  it('去标点与小写', () => {
    assert.equal(normalizeLabel(' 新想法，实验 '), '新想法实验')
  })
})

describe('looksLongHorizon', () => {
  it('长文本 + 关键词命中', () => {
    const text = '这是一个长期研究项目，我们计划分三个阶段完成整个实验流程，第一阶段完成数据收集与文献综述，第二阶段实现核心算法原型，第三阶段进行大规模实验评估，目标是实现完全可复现的科研流程。'
    assert.equal(looksLongHorizon(text), true)
  })

  it('短文本不触发', () => {
    assert.equal(looksLongHorizon('帮我看看这个报错'), false)
  })
})

describe('judgeProgress（四轴保守判定）', () => {
  const goal: GoalContract = {
    goalId: 'g1',
    title: 't',
    objective: 'o',
    criteria: [
      { id: 'c1', text: '标准一', satisfied: false, evidence: [] },
      { id: 'c2', text: '标准二', satisfied: false, evidence: [] },
    ],
    constraints: [],
    version: 1,
    createdAt: 0,
    updatedAt: 0,
  }

  it('无证据不标满足 → wait_user', () => {
    assert.equal(judgeProgress({ goal, evidence: [], consecutiveFailures: 0, hasProgress: true }), 'wait_user')
  })

  it('连续失败 → replan', () => {
    assert.equal(judgeProgress({ goal, evidence: ['e'], consecutiveFailures: 2, hasProgress: false }), 'replan')
  })

  it('全部标准有证据 → complete', () => {
    const done: GoalContract = {
      ...goal,
      criteria: [
        { id: 'c1', text: '标准一', satisfied: true, evidence: ['e1'] },
        { id: 'c2', text: '标准二', satisfied: true, evidence: ['e2'] },
      ],
    }
    assert.equal(judgeProgress({ goal: done, evidence: ['e3'], consecutiveFailures: 0, hasProgress: true }), 'complete')
  })

  it('进行中 → continue', () => {
    const partial: GoalContract = {
      ...goal,
      criteria: [{ id: 'c1', text: '标准一', satisfied: true, evidence: ['e1'] }, ...goal.criteria.slice(1)],
    }
    assert.equal(judgeProgress({ goal: partial, evidence: ['e2'], consecutiveFailures: 0, hasProgress: true }), 'continue')
  })
})

describe('renderGoalProjection', () => {
  it('渲染紧凑投影', () => {
    const text = renderGoalProjection({
      goalId: 'g1', title: '综述', objective: '完成综述', criteria: [{ id: 'c1', text: '覆盖 100 篇', satisfied: false, evidence: [] }], constraints: [], version: 1, createdAt: 0, updatedAt: 0,
    })
    assert.ok(text.includes('<active_goal>'))
    assert.ok(text.includes('综述'))
  })

  it('空合同渲染空串', () => {
    assert.equal(renderGoalProjection(undefined), '')
  })
})
