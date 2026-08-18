import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCandidates, detectTrigger, trimPromptEdges } from '../src/client/composer-assist'

test('发送和展示前会移除输入两端的空白', () => {
  assert.equal(trimPromptEdges('  \n  你好  \t'), '你好')
  assert.equal(trimPromptEdges('科研\n问题'), '科研\n问题')
})

test('普通文本输入会按内容匹配历史候选', () => {
  const trigger = detectTrigger('你好', 2)
  assert.deepEqual(trigger, { kind: 'history', query: '你好', start: 0 })
  assert.deepEqual(buildCandidates(trigger, [], [], ['你好', '你好，继续分析', '再见']), [
    { key: 'hist:你好', title: '你好', kind: 'history', insert: '你好' },
    { key: 'hist:你好，继续分析', title: '你好，继续分析', kind: 'history', insert: '你好，继续分析' },
  ])
})

test('显式命令和文件引用仍然触发补全', () => {
  assert.deepEqual(detectTrigger('/help', 5), { kind: 'command', query: 'help', start: 0 })
  assert.deepEqual(detectTrigger('@results', 8), { kind: 'mention', query: 'results', start: 0 })
})
