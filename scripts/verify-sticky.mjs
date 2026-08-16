// 验证：拖动输入框 → 消息区高度不变（内容自适应）、无内嵌滚动条、输入框 sticky 底部
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'
const debugPort = 47419
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-hd9-${Date.now()}`
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

const snap = () => evalJs(`(() => {
  const chat = document.querySelector('.evo-chat')
  const center = document.querySelector('.evo-center')
  const wrap = document.querySelector('.evo-composer-wrap')
  const ta = document.querySelector('.evo-composer-textarea')
  const list = document.querySelector('.evo-msg-list')
  const wr = wrap.getBoundingClientRect()
  return {
    chatH: chat.offsetHeight,
    msgListExists: !!list,
    msgListScrollable: list ? list.scrollHeight > list.clientHeight + 1 : false,
    centerScrollable: center.scrollHeight > center.clientHeight + 1,
    wrapPos: getComputedStyle(wrap).position,
    wrapBottom: Math.round(wr.bottom),
    vh: window.innerHeight,
    taH: ta.offsetHeight,
  }
})()`)

const before = await snap()
console.log('BEFORE:', JSON.stringify(before))

// 拖大输入框（上拖 200px）
const grip = await evalJs(`(() => {
  const g = document.querySelector('.evo-composer-resize').getBoundingClientRect()
  return { x: Math.round(g.left + g.width / 2), y: Math.round(g.top + g.height / 2) }
})()`)
await mouse('mousePressed', grip.x, grip.y, { buttons: 1, clickCount: 1 })
await sleep(250)
for (let s = 1; s <= 20; s++) { await mouse('mouseMoved', grip.x, grip.y - s * 10, { buttons: 1 }); await sleep(40) }
await mouse('mouseReleased', grip.x, grip.y - 200, { buttons: 0, clickCount: 1 })
await sleep(600)
const after = await snap()
console.log('AFTER DRAG 200px:', JSON.stringify(after))
console.log('chat unchanged:', before.chatH === after.chatH)

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('D:\\DSH-Research\\.tmp-port\\visual-sticky.png', Buffer.from(shot.data, 'base64'))
console.log('screenshot saved')
ws.close()
edge.kill()
process.exit(0)
