// 探针：真实鼠标从 memory output socket → chat memory input socket 拖线，
// 验证鼠标连边是否真的生效（此前 accept-mouse STEP4 疑似假阳性）。
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'
const PORT = '12789'
const debugPort = 47441
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-probe-${Date.now()}`
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
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`D:\\DSH-Research\\.tmp-port\\probe-${name}.png`, Buffer.from(s.data, 'base64'))
  console.log(`shot: probe-${name}.png`)
}

await send('Network.enable')
await send('Page.enable')
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?sidebar=1&threadId=session-7a1bbede-d888-4be0-8578-62cbfd36b0e9` })
await sleep(8000)
for (let i = 0; i < 20; i++) {
  const n = await evalJs(`document.querySelectorAll('.evo-graph-node').length`).catch(() => 0)
  if (n >= 5) break
  await sleep(1000)
}
// 切到图谱 tab
const tab = await evalJs(`(() => { const t = [...document.querySelectorAll('.evo-tab')].find(x => (x.textContent || '').includes('图谱')); if (!t) return null; const r = t.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
if (tab) {
  await mouse('mousePressed', tab.x, tab.y, { buttons: 1, clickCount: 1 })
  await mouse('mouseReleased', tab.x, tab.y, { buttons: 0, clickCount: 1 })
}
await sleep(2500)

const before = await evalJs(`(() => ({
  edges: document.querySelectorAll('.evo-graph-edge').length,
  memEdges: document.querySelectorAll('.evo-graph-edge:not(.evo-graph-edge-ctx)').length,
  nodes: document.querySelectorAll('.evo-graph-node').length,
}))()`)
console.log('BEFORE:', JSON.stringify(before))
await shot('before')

// 用真实 DOM socket 圆心：挑 memory c7c1b54c 的 output → chat 04b68ca9 的 memory input
const sockets = await evalJs(`(() => {
  const findNode = (id) => document.querySelector('.evo-graph-node[data-node-id="' + id + '"]')
  const out = findNode('c7c1b54c')?.querySelector('.evo-graph-socket-out')
  const inn = findNode('04b68ca9')?.querySelector('.evo-graph-socket-in.evo-graph-socket-mem')
  if (!out || !inn) return null
  const ro = out.getBoundingClientRect(), ri = inn.getBoundingClientRect()
  return {
    out: { x: Math.round(ro.left + ro.width / 2), y: Math.round(ro.top + ro.height / 2) },
    inn: { x: Math.round(ri.left + ri.width / 2), y: Math.round(ri.top + ri.height / 2) },
  }
})()`)
console.log('SOCKETS:', JSON.stringify(sockets))
if (!sockets) { console.log('NO SOCKETS FOUND'); process.exit(1) }

// 真实拖线：按下 → 多步移动 → 释放
await mouse('mousePressed', sockets.out.x, sockets.out.y, { buttons: 1, clickCount: 1 })
await sleep(300)
for (let s = 1; s <= 14; s++) {
  const t = s / 14
  await mouse('mouseMoved', Math.round(sockets.out.x + (sockets.inn.x - sockets.out.x) * t), Math.round(sockets.out.y + (sockets.inn.y - sockets.out.y) * t), { buttons: 1 })
  await sleep(60)
}
await mouse('mouseReleased', sockets.inn.x, sockets.inn.y, { buttons: 0, clickCount: 1 })
await sleep(1200)

const after = await evalJs(`(() => ({
  edges: document.querySelectorAll('.evo-graph-edge').length,
  memEdges: document.querySelectorAll('.evo-graph-edge:not(.evo-graph-edge-ctx)').length,
  linking: !!document.querySelector('.evo-graph-edge-linking'),
}))()`)
console.log('AFTER:', JSON.stringify(after))
await shot('after')

// 再从 API 侧确认落盘
const api = await fetch(`http://127.0.0.1:${PORT}/evoresearch/fs/graph-get`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ workspaceDir: 'D:\\DSH-Research\\.tmp-e2e\\dev\\projects\\project' }),
}).then((r) => r.json())
const g = (await api).value.graph
console.log('API edges:', JSON.stringify(g.edges))
console.log('API nodes:', g.nodes.length)

ws.close()
edge.kill()
process.exit(0)
