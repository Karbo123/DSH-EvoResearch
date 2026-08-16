// E2E：Chat Graph —— 标签入口/面板渲染/右键新建节点/连线/落盘/双击打开会话
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'
const debugPort = 47424
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-hd14-${Date.now()}`
mkdirSync(profile, { recursive: true })
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets = null
for (let i = 0; i < 30; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); if (l.some((t) => t.type === 'page')) { targets = l; break } } catch { /* retry */ }
  await sleep(1000)
}
if (!targets) { console.log('NOT UP'); process.exit(1) }
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.on('open', r))
let id = 0
const pending = new Map()
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
}
ws.on('message', (m) => {
  const d = JSON.parse(m.toString())
  if (d.id && pending.has(d.id)) {
    const p = pending.get(d.id)
    pending.delete(d.id)
    d.error ? p.reject(new Error(JSON.stringify(d.error))) : p.resolve(d.result)
  }
})
async function evalJs(expr, timeoutMs = 8000) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('EVAL_TIMEOUT')), timeoutMs)),
  ])
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result?.value
}
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra })
const rmouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'right', buttons: type === 'mouseReleased' ? 0 : 2 })

await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Page.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:1384/?sidebar=1' })
await sleep(8000)
for (let i = 0; i < 20; i++) {
  const n = await evalJs(`document.querySelectorAll('.evo-tl-item').length`).catch(() => 0)
  if (n >= 7) break
  await sleep(1000)
}
await sleep(1000)
// 打开项目会话（dev 根有 project 会话）
await evalJs(`document.querySelector('.evo-tl-row-main')?.click()`)
await sleep(2500)
console.log('STEP1 session opened:', await evalJs(`!!document.querySelector('.evo-composer-textarea')`))

// 图谱标签
await evalJs(`(() => { const t = [...document.querySelectorAll('.evo-tab')].find(x => (x.textContent || '').includes('图谱')); if (t) t.click(); return !!t })()`)
await sleep(1200)
console.log('STEP2 graph tab:', JSON.stringify(await evalJs(`(() => ({
  hasGraph: !!document.querySelector('.evo-graph'),
  hasCanvas: !!document.querySelector('.evo-graph-canvas'),
  hasToolbar: !!document.querySelector('.evo-graph-toolbar'),
  hint: document.querySelector('.evo-graph-hint')?.textContent?.slice(0, 30) ?? null,
}))()`)))

// 右键画布 → 菜单 → 新建聊天节点
const canvas = await evalJs(`(() => {
  const c = document.querySelector('.evo-graph-canvas').getBoundingClientRect()
  return { x: Math.round(c.left + 200), y: Math.round(c.top + 200) }
})()`)
await rmouse('mousePressed', canvas.x, canvas.y)
await rmouse('mouseReleased', canvas.x, canvas.y)
await sleep(600)
console.log('STEP3 menu:', JSON.stringify(await evalJs(`(() => ({
  hasMenu: !!document.querySelector('.evo-graph-menu'),
  items: [...document.querySelectorAll('.evo-graph-menu-item')].map(i => i.textContent.trim()),
}))()`)))
await evalJs(`(() => { const b = [...document.querySelectorAll('.evo-graph-menu-item')].find(x => x.textContent.includes('聊天节点')); if (b) b.click(); return !!b })()`)
await sleep(2000)
console.log('STEP4 chat node created:', JSON.stringify(await evalJs(`(() => ({
  nodes: document.querySelectorAll('.evo-graph-node').length,
  chatNodes: document.querySelectorAll('.evo-graph-node-chat').length,
}))()`)))

// 新建记忆节点（工具栏按钮）
await evalJs(`(() => { const b = [...document.querySelectorAll('.evo-graph-btn')].find(x => x.textContent.includes('记忆节点')); if (b) b.click(); return !!b })()`)
await sleep(800)
// 新建全局记忆
await evalJs(`(() => { const b = [...document.querySelectorAll('.evo-graph-btn')].find(x => x.textContent.includes('全局记忆')); if (b) b.click(); return !!b })()`)
await sleep(800)
console.log('STEP5 memory nodes:', JSON.stringify(await evalJs(`(() => ({
  nodes: document.querySelectorAll('.evo-graph-node').length,
  memNodes: document.querySelectorAll('.evo-graph-node-memory').length,
}))()`)))

// 连线：chat output → memory 节点？不对——memory → chat memory input。
// 取 chat 节点 output 端口位置 与 memory 节点左侧（memory 无输入端口——应连到 chat 的 memory 输入）
// 设计：memory node 的 output → chat node 的 memory input。
const ports = await evalJs(`(() => {
  const chat = document.querySelector('.evo-graph-node-chat')
  const mems = [...document.querySelectorAll('.evo-graph-node-memory')]
  if (!chat || mems.length === 0) return null
  const cc = document.querySelector('.evo-graph-canvas').getBoundingClientRect()
  const cr = chat.getBoundingClientRect()
  const mr = mems[0].getBoundingClientRect()
  return {
    chatOut: { x: Math.round(cr.right + 1), y: Math.round(cr.top + 33) },
    memIn: null,
    // memory 节点 output（右侧）→ 拖到 chat 节点左侧 memory 端口
    memOut: { x: Math.round(mr.right + 1), y: Math.round(mr.top + 23) },
    chatMemIn: { x: Math.round(cr.left - 1), y: Math.round(cr.top + 44) },
  }
})()`)
console.log('PORTS:', JSON.stringify(ports))
if (ports) {
  // 从 memory output 拖到 chat 的 memory input
  await mouse('mousePressed', ports.memOut.x, ports.memOut.y, { buttons: 1, clickCount: 1 })
  await sleep(200)
  for (let s = 1; s <= 8; s++) {
    const t = s / 8
    await mouse('mouseMoved', Math.round(ports.memOut.x + (ports.chatMemIn.x - ports.memOut.x) * t), Math.round(ports.memOut.y + (ports.chatMemIn.y - ports.memOut.y) * t), { buttons: 1 })
    await sleep(50)
  }
  await mouse('mouseReleased', ports.chatMemIn.x, ports.chatMemIn.y, { buttons: 0, clickCount: 1 })
  await sleep(800)
}
console.log('STEP6 edges:', JSON.stringify(await evalJs(`(() => ({
  svgPaths: document.querySelectorAll('.evo-graph-edge').length,
  ctxEdges: document.querySelectorAll('.evo-graph-edge-ctx').length,
}))()`)))

// 落盘检查
const persisted = await evalJs(`fetch('/evoresearch/fs/graph-get', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceDir: 'D:\\DSH-Research\\.tmp-e2e\\dev\\projects\\project' }) }).then(r => r.json()).then(j => ({ ok: j.ok, nodes: j.value?.nodes?.length ?? -1, edges: j.value?.edges?.length ?? -1 }))`)
console.log('STEP7 persisted:', JSON.stringify(persisted))

// 双击 chat 节点 → 打开会话
await evalJs(`(() => { const c = document.querySelector('.evo-graph-node-chat'); if (!c) return false; const r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + 40, clientY: r.top + 20 })); return true })()`)
await sleep(1500)
console.log('STEP8 open session:', JSON.stringify(await evalJs(`(() => ({ url: location.search.slice(0, 60), hasChat: !!document.querySelector('.evo-composer-textarea') }))()`)))

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('D:\\DSH-Research\\.tmp-port\\visual-graph.png', Buffer.from(shot.data, 'base64'))
console.log('screenshot saved')
ws.close()
edge.kill()
process.exit(0)

