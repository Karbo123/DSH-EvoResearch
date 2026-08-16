// 前端验证：右键有 context 边的节点 → 断开上下文继承
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'
const PORT = '12789'
const debugPort = 47440
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-disc-${Date.now()}`
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
const tab = await evalJs(`(() => { const t = [...document.querySelectorAll('.evo-tab')].find(x => (x.textContent || '').includes('图谱')); if (!t) return null; const r = t.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
if (tab) { await mouse('mousePressed', tab.x, tab.y, { buttons: 1, clickCount: 1 }); await mouse('mouseReleased', tab.x, tab.y, { buttons: 0, clickCount: 1 }) }
await sleep(2500)
// 找有 context 边的目标节点（5d95be06——标题 新建聊天节点 第一个）
const nodeRect = await evalJs(`(() => {
  // 5d95be06 是第一个 chat 节点（有 context 边）
  const n = document.querySelector('.evo-graph-node-chat')
  if (!n) return null
  const r = n.getBoundingClientRect()
  return { x: Math.round(r.left + 20), y: Math.round(r.top + 10) }
})()`)
let menuHasDisconnect = false
if (nodeRect) {
  await rmouse('mousePressed', nodeRect.x, nodeRect.y)
  await rmouse('mouseReleased', nodeRect.x, nodeRect.y)
  await sleep(600)
  menuHasDisconnect = await evalJs(`[...document.querySelectorAll('.evo-graph-menu-item')].some(i => i.textContent.includes('断开上下文继承'))`)
  console.log('MENU has disconnect:', menuHasDisconnect)
  await shot()
  // 点击断开
  await evalJs(`(() => { const b = [...document.querySelectorAll('.evo-graph-menu-item')].find(x => x.textContent.includes('断开上下文继承')); if (b) b.click(); return !!b })()`)
  await sleep(900)
}
const after = await evalJs(`(() => ({
  crashed: !!document.querySelector('.evo-fatal'),
  ctxEdges: document.querySelectorAll('.evo-graph-edge-ctx').length,
  edges: document.querySelectorAll('.evo-graph-edge').length,
}))()`)
console.log('AFTER DISCONNECT:', JSON.stringify(after))
async function shot() {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('D:\\DSH-Research\\.tmp-port\\full-disconnect-menu.png', Buffer.from(s.data, 'base64'))
}
ws.close()
edge.kill()
process.exit(0)
