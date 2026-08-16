// 单测：ChatGraphService global 节点跨项目共享 + 保存拆分
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { ChatGraphService } from '../packages/evoresearch-plugin/lib/host/chat-graph.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-svc-'))
const svc = new ChatGraphService(tmp)
let pass = 0
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (cond) pass += 1 }

// 1) P1 创建 global + project 节点
const g1 = svc.addNode('p1', { type: 'memory', title: '全局规范', x: 10, y: 10, scope: 'global', content: '科研规范：先复现再创新。' })
const n1 = svc.addNode('p1', { type: 'memory', title: 'P1 项目记忆', x: 30, y: 30, scope: 'project', content: 'P1 专属。' })
check('P1 添加 global + project 节点', g1.scope === 'global' && n1.scope === 'project')
// 2) P2 的 get 应看到 global 节点（跨项目共享）但看不到 P1 的 project 节点
const g2 = svc.get('p2')
check('P2 可见 global 节点', g2.nodes.some((n) => n.id === g1.id))
check('P2 不可见 P1 project 节点', !g2.nodes.some((n) => n.id === n1.id))
// 3) P1 get 两者都可见
const g1r = svc.get('p1')
check('P1 可见自己的 project 节点', g1r.nodes.some((n) => n.id === n1.id))
// 4) 落盘：全局文件只有 global 节点；P1 文件只有 project 节点
const globalFile = JSON.parse(fs.readFileSync(path.join(tmp, '.evoresearch-data', 'chat-graphs', '_global_.json'), 'utf8'))
const p1File = JSON.parse(fs.readFileSync(path.join(tmp, '.evoresearch-data', 'chat-graphs', 'p1.json'), 'utf8'))
check('全局文件仅 global 节点', globalFile.nodes.length === 1 && globalFile.nodes[0].id === g1.id)
check('项目文件仅 project 节点', p1File.nodes.length === 1 && p1File.nodes[0].id === n1.id)
// 5) global 节点内容更新（P2 侧保存）→ P1 也应看到更新
svc.save('p2', { nodes: [{ ...g1, content: '更新后的全局规范。' }], edges: [] })
const g1r2 = svc.get('p1')
check('P2 更新 global 内容后 P1 可见', g1r2.nodes.find((n) => n.id === g1.id)?.content === '更新后的全局规范。')
// 6) 边引用 global 节点（P1 里 global → chat）
const chat1 = svc.addNode('p1', { type: 'chat', title: '聊天', x: 0, y: 0, sessionId: 'sess-1' })
const edge = svc.addEdge('p1', { from: g1.id, to: chat1.id, toPort: 'memory' })
check('边引用 global 节点成功', edge.toPort === 'memory')
const g1r3 = svc.get('p1')
check('P1 图含 global 边', g1r3.edges.some((e) => e.from === g1.id && e.to === chat1.id))

console.log(`\n${pass}/8 passed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(pass === 8 ? 0 : 1)
