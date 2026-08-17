// 单测：会话历史提取（chunk 合并/reasoning 过滤/多结构消息/缓存）
// 注：graphContextText 递归注入旧函数已随 GRAPH-02（context 一次性 fork 语义）删除，
// 相应断言一并移除；context 语义测试见 packages/evoresearch-plugin/test/graph-semantics.test.ts。
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { sessionHistoryText } from '../packages/evoresearch-plugin/lib/host/chat-graph.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-ctx-'))
const enc = encodeURIComponent('D:\\tmp\\p')
const dirs = {}
for (const sid of ['sess-a', 'sess-b', 'sess-c']) {
  dirs[sid] = path.join(tmp, 'sessions', enc, sid)
  fs.mkdirSync(dirs[sid], { recursive: true })
}
// A：用户消息（两种结构）+ reasoning/text chunk + 多 step
fs.writeFileSync(path.join(dirs['sess-a'], 'session.jsonl'), [
  { type: 'user/message', seq: 1, data: { text: 'A 的用户问题一' } },
  { type: 'assistant/chunk', seq: 2, data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: '思考碎片' } } },
  { type: 'assistant/chunk', seq: 3, data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: '你好' } } },
  { type: 'assistant/chunk', seq: 4, data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: '，我是完整回复' } } },
  { type: 'user/message', seq: 5, data: { content: [{ type: 'text', text: 'A 的用户问题二' }] } },
  { type: 'assistant/chunk', seq: 6, data: { turn: 2, step: 1, chunk: { type: 'text-delta', text: '第二条回复' } } },
].map(JSON.stringify).join('\n'), 'utf8')
fs.writeFileSync(path.join(dirs['sess-b'], 'session.jsonl'), [
  { type: 'user/message', seq: 1, data: { text: 'B 的问题' } },
].map(JSON.stringify).join('\n'), 'utf8')
fs.writeFileSync(path.join(dirs['sess-c'], 'session.jsonl'), '', 'utf8')
process.env.DSH_HOME = tmp

let pass = 0
let total = 0
const check = (n, c, d = '') => { total += 1; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? `  ${d}` : ''}`); if (c) pass += 1 }

// 1) chunk 合并 + reasoning 过滤
const h = sessionHistoryText('sess-a')
check('text-delta 合并为完整回复', h.includes('你好，我是完整回复'))
check('reasoning 碎片被过滤', !h.includes('思考碎片'))
check('多回合正文独立', h.includes('第二条回复'))
check('用户消息两种结构都提取', h.includes('A 的用户问题一') && h.includes('A 的用户问题二'))
// 2) 缓存命中（第二次调用结果一致且来自缓存路径）
const h2 = sessionHistoryText('sess-a')
check('缓存结果一致', h === h2)
// 3) 空会话 / 未知会话
check('空会话为空', sessionHistoryText('sess-c') === '')

console.log(`\n${pass}/${total} passed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(pass === total ? 0 : 1)
