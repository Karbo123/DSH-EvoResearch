// 单测：graphMemoryText / graphContextText / sessionHistoryText（用临时 DSH_HOME）
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { graphMemoryText, graphContextText, sessionHistoryText } from '../packages/evoresearch-plugin/lib/host/chat-graph.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-test-'))
// 会话目录：<DSH_HOME>/sessions/<编码cwd>/<sessionId>/
const enc = encodeURIComponent('D:\\tmp\\project')
const sessA = 'session-AAAA-0000'
const sessB = 'session-BBBB-0000'
const dirA = path.join(tmp, 'sessions', enc, sessA)
const dirB = path.join(tmp, 'sessions', enc, sessB)
fs.mkdirSync(dirA, { recursive: true })
fs.mkdirSync(dirB, { recursive: true })
// A 的会话日志（含用户消息 + 系统伪消息 + 助手消息）
const eventsA = [
  { type: 'turn/start', seq: 0, data: { turn: 1 } },
  { type: 'user/message', seq: 1, data: { text: '你好，我们在研究橙色天空。' } },
  { type: 'assistant/message', seq: 2, data: { text: '好的，橙色天空假说值得深入。' } },
  { type: 'user/message', seq: 3, data: { text: '<code_mode>\n这是一个系统注入，应被跳过。' } },
  { type: 'user/message', seq: 4, data: { text: '下一步做实验验证。' } },
  { type: 'assistant/message', seq: 5, data: { text: '我建议用仿真数据先验证。' } },
]
fs.writeFileSync(path.join(dirA, 'session.jsonl'), eventsA.map((e) => JSON.stringify(e)).join('\n'), 'utf8')
fs.writeFileSync(path.join(dirB, 'session.jsonl'), '', 'utf8')

// 图：memory → B(memory 边)；A → B(context 边)
const graph = {
  nodes: [
    { id: 'nA', type: 'chat', title: '研究起点', x: 0, y: 0, sessionId: sessA, workspaceDir: 'D:\\tmp\\project' },
    { id: 'nB', type: 'chat', title: '实验聊天', x: 200, y: 0, sessionId: sessB, workspaceDir: 'D:\\tmp\\project' },
    { id: 'm1', type: 'memory', title: '项目记忆', x: 0, y: 200, scope: 'project', content: '【记忆】橙天假说：天空呈现橙色，需解释散射模型。' },
    { id: 'm2', type: 'memory', title: '全局记忆', x: 0, y: 260, scope: 'global', content: '【全局】科研规范：先复现再创新。' },
  ],
  edges: [
    { id: 'e1', from: 'm1', to: 'nB', toPort: 'memory' },
    { id: 'e2', from: 'm2', to: 'nB', toPort: 'memory' },
    { id: 'e3', from: 'nA', to: 'nB', toPort: 'context' },
  ],
}

process.env.DSH_HOME = tmp
let pass = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
  if (cond) pass += 1
}

// 1) memory 提取
const mem = graphMemoryText(graph, sessB)
check('memory: 含两个节点内容', mem.includes('橙天假说') && mem.includes('先复现再创新'), `(${mem.length} chars)`)
check('memory: 分隔符', mem.includes('---'))
check('memory: 无边的会话为空', graphMemoryText(graph, sessA) === '')

// 2) context 提取
const ctx = graphContextText(graph, sessB)
check('context: 有来源', ctx !== null && ctx.fromTitle === '研究起点')
check('context: 含 A 的历史（跳过系统伪消息）', ctx !== null && ctx.text.includes('橙色天空') && !ctx.text.includes('code_mode'))
check('context: 含最近消息', ctx !== null && ctx.text.includes('仿真数据先验证'))
check('context: A 无边为 null', graphContextText(graph, sessA) === null)

// 3) sessionHistoryText 直接提取
const hist = sessionHistoryText(sessA)
check('history: 提取 4 条消息', hist.includes('你好') && hist.includes('仿真数据先验证') && !hist.includes('code_mode'))

// 4) 截断
const short = sessionHistoryText(sessA, 20)
check('history: 截断生效', short.length <= 60 && short.includes('仿真数据'))

console.log(`\n${pass}/7 passed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(pass === 7 ? 0 : 1)
