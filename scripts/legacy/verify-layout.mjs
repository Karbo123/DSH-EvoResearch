// 验证：拖到最大后 composer 不溢出视口、消息区高度充足
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import WebSocket from 'ws'
const debugPort = 47417
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-hd7-${Date.now()}`
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
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Page.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:8057/?sidebar=1' })
await sleep(8000)
for (let i = 0; i < 20; i++) {
  const n = await evalJs(`document.querySelectorAll('.evo-tl-item').length`).catch(() => 0)
  if (n >= 7) break
  await sleep(1000)
}
await sleep(1000)
const grip = await evalJs(`(() => {
  const g = document.querySelector('.evo-composer-resize').getBoundingClientRect()
  return { x: Math.round(g.left + g.width / 2), y: Math.round(g.top + g.height / 2) }
})()`)
await mouse('mousePressed', grip.x, grip.y, { buttons: 1, clickCount: 1 })
await sleep(250)
for (let s = 1; s <= 20; s++) { await mouse('mouseMoved', grip.x, grip.y - s * 50, { buttons: 1 }); await sleep(40) }
await mouse('mouseReleased', grip.x, grip.y - 1000, { buttons: 0, clickCount: 1 })
await sleep(600)
const r = await evalJs(`(() => {
  const wrap = document.querySelector('.evo-composer-wrap').getBoundingClientRect()
  const chat = document.querySelector('.evo-chat').getBoundingClientRect()
  const body = document.body.getBoundingClientRect()
  const main = document.querySelector('main')?.getBoundingClientRect()
  return {
    vh: window.innerHeight,
    composerBottom: Math.round(wrap.bottom),
    composerTop: Math.round(wrap.top),
    chatH: Math.round(chat.height),
    chatTop: Math.round(chat.top),
    bodyScrollH: document.body.scrollHeight,
    bodyClientH: document.body.clientHeight,
    mainBottom: main ? Math.round(main.bottom) : null,
    overflow: wrap.bottom > window.innerHeight - 20,
  }
})()`)
console.log('LAYOUT:', JSON.stringify(r))
ws.close()
edge.kill()
process.exit(0)
