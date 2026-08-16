// 鼠标操作功能验收：真实鼠标事件走完整验收路径 + 逐步截图
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'
const PORT = '12789'
const debugPort = 47433
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-accept-${Date.now()}`
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
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
}
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) {
    const p = pending.get(d.id)
    pending.delete(d.id)
    d.error ? p.reject(new Error(JSON.stringify(d.error))) : p.resolve(d.result)
  }
}
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
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`D:\\DSH-Research\\.tmp-port\\accept-${name}.png`, Buffer.from(s.data, 'base64'))
  console.log(`shot: accept-${name}.png`)
}

await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Page.enable')
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?sidebar=1&threadId=session-c9fed8a5-0b73-440d-b6a1-9c2300e7f106` })
await sleep(9000)
for (let i = 0; i < 20; i++) {
  const n = await evalJs(`document.querySelectorAll('.evo-tl-item').length`).catch(() => 0)
  if (n >= 7) break
  await sleep(1000)
}
await sleep(1500)

// 1) 真实鼠标点击图谱 tab
const tab = await evalJs(`(() => { const t = [...document.querySelectorAll('.evo-tab')].find(x => (x.textContent || '').includes('图谱')); if (!t) return null; const r = t.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
if (tab) {
  await mouse('mousePressed', tab.x, tab.y, { buttons: 1, clickCount: 1 })
  await mouse('mouseReleased', tab.x, tab.y, { buttons: 0, clickCount: 1 })
}
await sleep(2500)
console.log('STEP1 graph tab:', JSON.stringify(await evalJs(`(() => ({
  crashed: !!document.querySelector('.evo-fatal'),
  nodes: document.querySelectorAll('.evo-graph-node').length,
  edges: document.querySelectorAll('.evo-graph-edge').length,
}))()`)))
await shot('graph-initial')

// 2) 真实右键画布 → 菜单 → 新建记忆节点
const canvas = await evalJs(`(() => { const c = document.querySelector('.evo-graph-canvas').getBoundingClientRect(); return { x: Math.round(c.left + c.width * 0.7), y: Math.round(c.top + c.height * 0.6) } })()`)
await rmouse('mousePressed', canvas.x, canvas.y)
await rmouse('mouseReleased', canvas.x, canvas.y)
await sleep(700)
const menuInfo = await evalJs(`(() => { const m = document.querySelector('.evo-graph-menu'); if (!m) return null; const items = [...m.querySelectorAll('.evo-graph-menu-item')]; const target = items[1]; if (!target) return null; const r = target.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), items: items.map(i => i.textContent.trim()) } })()`)
console.log('STEP2 context menu:', JSON.stringify(menuInfo))
await shot('graph-menu')
if (menuInfo) {
  // 点第二个菜单项（新建记忆节点）——按 DOM 实测圆心点击
  await mouse('mousePressed', menuInfo.x, menuInfo.y, { buttons: 1, clickCount: 1 })
  await mouse('mouseReleased', menuInfo.x, menuInfo.y, { buttons: 0, clickCount: 1 })
}
await sleep(1200)
console.log('STEP3 new memory node:', JSON.stringify(await evalJs(`(() => ({
  nodes: document.querySelectorAll('.evo-graph-node').length,
  mems: document.querySelectorAll('.evo-graph-node-memory').length,
  edges: document.querySelectorAll('.evo-graph-edge').length,
}))()`)))

// 3) 拖线：新记忆节点 output → chat 节点 memory input（按真实 socket 圆心）
const ports = await evalJs(`(() => {
  const mems = [...document.querySelectorAll('.evo-graph-node-memory')]
  const chat = document.querySelector('.evo-graph-node-chat')
  if (mems.length === 0 || !chat) return null
  const out = mems[mems.length - 1].querySelector('.evo-graph-socket-out').getBoundingClientRect()
  const inn = chat.querySelector('.evo-graph-socket-in.evo-graph-socket-mem').getBoundingClientRect()
  return {
    out: { x: Math.round(out.left + out.width / 2), y: Math.round(out.top + out.height / 2) },
    in: { x: Math.round(inn.left + inn.width / 2), y: Math.round(inn.top + inn.height / 2) },
  }
})()`)
if (ports) {
  await mouse('mousePressed', ports.out.x, ports.out.y, { buttons: 1, clickCount: 1 })
  await sleep(250)
  for (let s = 1; s <= 12; s++) {
    const t = s / 12
    await mouse('mouseMoved', Math.round(ports.out.x + (ports.in.x - ports.out.x) * t), Math.round(ports.out.y + (ports.in.y - ports.out.y) * t), { buttons: 1 })
    await sleep(50)
  }
  await mouse('mouseReleased', ports.in.x, ports.in.y, { buttons: 0, clickCount: 1 })
}
await sleep(900)
console.log('STEP4 edge created:', JSON.stringify(await evalJs(`(() => ({ edges: document.querySelectorAll('.evo-graph-edge').length, memEdges: document.querySelectorAll('.evo-graph-edge:not(.evo-graph-edge-ctx)').length }))()`)))

// 4) 拖节点移动
const dragInfo = await evalJs(`(() => {
  const n = document.querySelector('.evo-graph-node-memory')
  if (!n) return null
  const r = n.getBoundingClientRect()
  return { x: Math.round(r.left + 40), y: Math.round(r.top + 14) }
})()`)
if (dragInfo) {
  await mouse('mousePressed', dragInfo.x, dragInfo.y, { buttons: 1, clickCount: 1 })
  await sleep(200)
  for (let s = 1; s <= 5; s++) { await mouse('mouseMoved', dragInfo.x + s * 12, dragInfo.y + s * 8, { buttons: 1 }); await sleep(60) }
  await mouse('mouseReleased', dragInfo.x + 60, dragInfo.y + 40, { buttons: 0, clickCount: 1 })
}
await sleep(700)
console.log('STEP5 node dragged:', await evalJs(`!!document.querySelector('.evo-graph-node-memory')`))
await shot('graph-after')

// 5) 双击 chat 节点（真实双击）
const chatNode = await evalJs(`(() => { const c = document.querySelector('.evo-graph-node-chat'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: Math.round(r.left + 60), y: Math.round(r.top + 20) } })()`)
if (chatNode) {
  for (let i = 0; i < 2; i++) {
    await mouse('mousePressed', chatNode.x, chatNode.y, { buttons: 1, clickCount: i + 1 })
    await mouse('mouseReleased', chatNode.x, chatNode.y, { buttons: 0, clickCount: i + 1 })
    await sleep(120)
  }
}
await sleep(2500)
console.log('STEP6 double click:', JSON.stringify(await evalJs(`(() => ({ crashed: !!document.querySelector('.evo-fatal'), url: location.search.slice(0, 50), composer: !!document.querySelector('.evo-composer-textarea') }))()`)))
await shot('chat-opened')

ws.close()
edge.kill()
process.exit(0)

