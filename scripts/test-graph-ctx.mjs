// 单测：会话历史提取（chunk 合并/reasoning 过滤）+ 递归上下文继承 + 循环保护 + 缓存
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { sessionHistoryText, graphContextText } from '../packages/evoresearch-plugin/lib/host/chat-graph.js'

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
const check = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? `  ${d}` : ''}`); if (c) pass += 1 }

// 1) chunk 合并 + reasoning 过滤
const h = sessionHistoryText('sess-a')
check('text-delta 合并为完整回复', h.includes('你好，我是完整回复'))
check('reasoning 碎片被过滤', !h.includes('思考碎片'))
check('多回合正文独立', h.includes('第二条回复'))
check('用户消息两种结构都提取', h.includes('A 的用户问题一') && h.includes('A 的用户问题二'))
// 2) 缓存命中（第二次调用结果一致且来自缓存路径）
const h2 = sessionHistoryText('sess-a')
check('缓存结果一致', h === h2)
// 3) 递归继承 A→B→C
const graph = {
  nodes: [
    { id: 'nA', type: 'chat', title: 'A', sessionId: 'sess-a' },
    { id: 'nB', type: 'chat', title: 'B', sessionId: 'sess-b' },
    { id: 'nC', type: 'chat', title: 'C', sessionId: 'sess-c' },
  ],
  edges: [
    { id: 'e1', from: 'nA', to: 'nB', toPort: 'context' },
    { id: 'e2', from: 'nB', to: 'nC', toPort: 'context' },
  ],
}
const ctxC = graphContextText(graph, 'sess-c')
check('C 继承 B 历史', ctxC !== null && ctxC.text.includes('B 的问题'))
check('C 递归继承 A 历史（含完整回复）', ctxC !== null && ctxC.text.includes('你好，我是完整回复'))
check('来源标注', ctxC !== null && ctxC.text.includes('【A】') && ctxC.text.includes('【B】'))
// 4) 循环保护
const loop = { nodes: graph.nodes, edges: [
  { id: 'e1', from: 'nA', to: 'nB', toPort: 'context' },
  { id: 'e2', from: 'nB', to: 'nA', toPort: 'context' },
] }
const ctxLoop = graphContextText(loop, 'sess-a')
check('循环边不崩溃且无重复爆量', ctxLoop !== null && ctxLoop.text.length < 500)
// 5) 无边 / 无节点
check('无边返回 null', graphContextText({ nodes: graph.nodes, edges: [] }, 'sess-c') === null)
check('未知会话返回 null', graphContextText(graph, 'sess-unknown') === null)

console.log(`\n${pass}/11 passed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(pass === 11 ? 0 : 1)
