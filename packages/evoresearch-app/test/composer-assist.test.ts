import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCandidates,
  buildReferenceCandidates,
  detectTrigger,
  replaceTriggerText,
  trimPromptEdges,
} from '../src/client/composer-assist'

test('发送和展示前会移除输入两端的空白', () => {
  assert.equal(trimPromptEdges('  \n  你好  \t'), '你好')
  assert.equal(trimPromptEdges('科研\n问题'), '科研\n问题')
})

test('普通文本输入会按内容匹配历史候选', () => {
  const trigger = detectTrigger('你好', 2)
  assert.deepEqual(trigger, { kind: 'history', query: '你好', start: 0 })
  assert.deepEqual(buildCandidates(trigger, [], ['你好', '你好，继续分析', '再见']), [
    { key: 'hist:你好', title: '你好', kind: 'history', insert: '你好' },
    { key: 'hist:你好，继续分析', title: '你好，继续分析', kind: 'history', insert: '你好，继续分析' },
  ])
})

test('命令与官方 @ grammar 在真实光标处触发', () => {
  assert.deepEqual(detectTrigger('/help', 5), { kind: 'command', query: 'help', start: 0, prefix: '/help' })
  assert.deepEqual(detectTrigger('请看 @results 后面的文字', 11), {
    kind: 'mention',
    query: 'results',
    start: 3,
    quoted: false,
    prefix: '@results',
  })
  assert.deepEqual(detectTrigger('查看 @"paper notes', 16), {
    kind: 'mention',
    query: 'paper notes',
    start: 3,
    quoted: true,
    prefix: '@"paper notes',
  })
  assert.equal(detectTrigger('mail@example.com', 16)?.kind, 'history')
})

test('官方文件与会话候选使用相对路径和 canonical mention', () => {
  const trigger = detectTrigger('参考 @pa', 6)!
  const items = buildReferenceCandidates(trigger, {
    files: [
      { path: 'papers/my paper.pdf', kind: 'file' },
      { path: 'papers', kind: 'directory' },
    ],
    sessions: [{
           sessionId: 'session-source',
      label: '文献整理',
      cwd: 'D:/other',
      sameWorkspace: false,
      createdAt: 1,
      mention: '@[文献整理](dsh-session:InNlc3Npb24tc291cmNlIg)',
    }],
  })
  assert.deepEqual(items, [
    {
      key: 'file:file:papers/my paper.pdf',
      title: 'my paper.pdf',
      subtitle: 'papers',
      kind: 'file',
      insert: '@"papers/my paper.pdf"',
    },
    {
      key: 'file:directory:papers',
      title: 'papers',
      subtitle: '文件夹',
      kind: 'folder',
      insert: '@papers/',
    },
    {
      key: 'session:session-source',
      title: '文献整理',
      subtitle: '其他工作区 · D:/other',
      kind: 'session',
      insert: '@[文献整理](dsh-session:InNlc3Npb24tc291cmNlIg)',
    },
  ])
})

test('引号形式只显示文件，目录保留打开引号以继续下钻', () => {
  const trigger = detectTrigger('查看 @"paper n', 12)!
  const items = buildReferenceCandidates(trigger, {
    files: [{ path: 'paper notes', kind: 'directory' }],
    sessions: [{ sessionId: 's', label: 'session', sameWorkspace: true, createdAt: 1, mention: '@[session](dsh-session:InMi)' }],
  })
  assert.deepEqual(items, [{
    key: 'file:directory:paper notes',
    title: 'paper notes',
    subtitle: '文件夹',
    kind: 'folder',
    insert: '@"paper notes/',
  }])
})

test('候选替换只改真实光标前的触发 token', () => {
  const input = '前文 @read 后文 @keep'
  const cursor = 8
  const trigger = detectTrigger(input, cursor)
  assert.deepEqual(replaceTriggerText(input, cursor, trigger, '@README.md'), {
    value: '前文 @README.md 后文 @keep',
    cursor: 13,
  })
})

test('文件与会话候选分别截断到弹层展示上限', () => {
  const trigger = detectTrigger('@', 1)!
  const manyFiles = Array.from({ length: 30 }, (_unused, i) => ({ path: `f${i}.md`, kind: 'file' as const }))
  const manySessions = Array.from({ length: 30 }, (_unused, i) => ({
    sessionId: `s${i}`,
    label: `会话${i}`,
    sameWorkspace: true,
    createdAt: i,
    mention: `@[会话${i}](dsh-session:x${i})`,
  }))
  const items = buildReferenceCandidates(trigger, { files: manyFiles, sessions: manySessions })
  assert.equal(items.length, 14)
  assert.equal(items.filter((item) => item.kind === 'file').length, 8)
  assert.equal(items.filter((item) => item.kind === 'session').length, 6)
})
