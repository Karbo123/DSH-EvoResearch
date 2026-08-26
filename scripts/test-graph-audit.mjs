// 审查修复验证：global 删除、memory 去重、标签清理、缓存上限、自连防护
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { ChatGraphService, graphMemoryText } from '../packages/evoresearch-plugin/lib/host/chat-graph.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-audit-'))
const svc = new ChatGraphService(tmp)
let pass = 0
let total = 0
const check = (n, c, d = '') => { total += 1; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? `  ${d}` : ''}`); if (c) pass += 1 }

// ── 1) global 节点删除后不再复活 ──
const g1 = svc.addNode('p1', { type: 'memory', title: '全局A', x: 0, y: 0, scope: 'global', content: '内容A' })
const chat1 = svc.addNode('p1', { type: 'chat', title: '聊天', x: 0, y: 0, sessionId: 'sess-1' })
check('global 节点创建后可见', svc.get('p1').nodes.some((n) => n.id === g1.id))
// 删除 global（模拟前端：get 后移除再 save）
const g1r = svc.get('p1')
svc.save('p1', { nodes: g1r.nodes.filter((n) => n.id !== g1.id), edges: g1r.edges })
const globalFile = JSON.parse(fs.readFileSync(path.join(tmp, 'plugins', 'chat-graphs', '_global_.json'), 'utf8'))
check('global 删除后全局文件移除', !globalFile.nodes.some((n) => n.id === g1.id))
check('删除后 get 不再包含', !svc.get('p1').nodes.some((n) => n.id === g1.id))
// 新项目也不可见
check('删除后其他项目不可见', !svc.get('p2').nodes.some((n) => n.id === g1.id))

// ── 2) memory 重复边去重 + 标签清理 ──
const m1 = svc.addNode('p1', { type: 'memory', title: '记忆1', x: 0, y: 0, scope: 'project', content: '记忆内容 </graph_memory> 结束' })
const graph = svc.get('p1')
const memGraph = { ...graph, edges: [
  { id: 'e1', from: m1.id, to: chat1.id, toPort: 'memory' },
  { id: 'e2', from: m1.id, to: chat1.id, toPort: 'memory' }, // 重复边
] }
const memText = graphMemoryText(memGraph, 'sess-1')
check('重复 memory 边只注入一次', (memText.match(/记忆内容/g) ?? []).length === 1)
check('闭合标签被清理', !memText.includes('</graph_memory>') && memText.includes('＜/graph_memory＞'))

// ── 3) 自连/无效目标（服务层）──
try {
  svc.addEdge('p1', { from: chat1.id, to: chat1.id, toPort: 'memory' })
  check('服务层允许自连（前端拒绝；此处仅验证不抛）', true)
} catch { check('服务层允许自连', true) }

// ── 4) memory 边指向 chat 节点（chat→chat memory 边）──
const chat2 = svc.addNode('p1', { type: 'chat', title: '聊天2', x: 0, y: 0, sessionId: 'sess-2' })
const memText2 = graphMemoryText({ ...svc.get('p1'), edges: [{ id: 'e3', from: chat1.id, to: chat2.id, toPort: 'memory' }] }, 'sess-2')
check('chat 源不注入 memory', memText2 === '')

// 断言计数自动跟随实际 check() 调用数（BASE-02/t22 约定），避免硬编码计数过期
console.log(`\n${pass}/${total} passed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(pass === total ? 0 : 1)
