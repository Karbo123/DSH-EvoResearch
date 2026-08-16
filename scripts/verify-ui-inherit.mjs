// 前端闭环：拖线 A→B(context) → graph-inherit 自动触发 → B 绑定更新
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import WebSocket from 'ws'
const PORT = '12096'
const debugPort = 47439
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-ui-${Date.now()}`
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
// 图谱 tab
const tab = await evalJs(`(() => { const t = [...document.querySelectorAll('.evo-tab')].find(x => (x.textContent || '').includes('图谱')); if (!t) return null; const r = t.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
if (tab) { await mouse('mousePressed', tab.x, tab.y, { buttons: 1, clickCount: 1 }); await mouse('mouseReleased', tab.x, tab.y, { buttons: 0, clickCount: 1 }) }
await sleep(2500)
// 找"研究起点"（A=21deb9ce）与另一个 chat 节点（不是 21deb9ce、也不是 5d95be06——已被继承过）
const nodes = await evalJs(`(() => [...document.querySelectorAll('.evo-graph-node-chat')].map(n => ({
  id: n.getAttribute('data-node-id'),
  title: n.querySelector('.evo-graph-node-title')?.textContent ?? '',
  out: (() => { const r = n.getBoundingClientRect(); return { x: Math.round(r.right + 1), y: Math.round(r.top + 33) } })(),
  inCtx: (() => { const r = n.getBoundingClientRect(); return { x: Math.round(r.left - 1), y: Math.round(r.top + 22) } })(),
})))()`)
console.log('CHAT NODES:', JSON.stringify(nodes.map((n) => ({ id: n.id, title: n.title }))))
const src = nodes.find((n) => n.title.includes('研究起点')) ?? nodes[0]
const dst = nodes.find((n) => n.id !== src.id)
if (src && dst) {
  // 拖线 src.out → dst.inCtx
  await mouse('mousePressed', src.out.x, src.out.y, { buttons: 1, clickCount: 1 })
  await sleep(250)
  for (let s = 1; s <= 10; s++) {
    const t = s / 10
    await mouse('mouseMoved', Math.round(src.out.x + (dst.inCtx.x - src.out.x) * t), Math.round(src.out.y + (dst.inCtx.y - src.out.y) * t), { buttons: 1 })
    await sleep(50)
  }
  await mouse('mouseReleased', dst.inCtx.x, dst.inCtx.y, { buttons: 0, clickCount: 1 })
}
await sleep(2500)
const after = await evalJs(`(() => ({
  crashed: !!document.querySelector('.evo-fatal'),
  error: document.querySelector('.evo-panel-error')?.textContent ?? null,
  edges: document.querySelectorAll('.evo-graph-edge').length,
  ctxEdges: document.querySelectorAll('.evo-graph-edge-ctx').length,
}))()`)
console.log('AFTER DRAG:', JSON.stringify(after))
// 通过 API 确认 dst 节点绑定已更新为新的 fork 会话
const wsDir = 'D:\\DSH-Research\\.tmp-e2e\\dev\\projects\\project'
const g = (await (await fetch(`http://127.0.0.1:${PORT}/evoresearch/fs/graph-get`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceDir: wsDir }) })).json()).value
const dstNode = g.nodes.find((n) => n.id === dst.id)
console.log('DST node sessionId now:', dstNode?.sessionId, '| was:', dst?.sessionId)
ws.close()
edge.kill()
process.exit(0)

