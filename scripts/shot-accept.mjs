// 截图：项目列表 + 子聊天列表（供视觉评审）
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'
const debugPort = 47434
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-shot2-${Date.now()}`
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
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`D:\\DSH-Research\\.tmp-port\\accept-${name}.png`, Buffer.from(s.data, 'base64'))
  console.log(`shot: accept-${name}.png`)
}
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Page.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:11279/?sidebar=1' })
await sleep(9000)
for (let i = 0; i < 20; i++) {
  const n = await evalJs(`document.querySelectorAll('.evo-tl-item').length`).catch(() => 0)
  if (n >= 7) break
  await sleep(1000)
}
await sleep(1500)
// 项目列表截图
await shot('projects')
// 真实鼠标点击项目行 → 子聊天列表
const row = await evalJs(`(() => { const r = document.querySelector('.evo-tl-project-row'); if (!r) return null; const b = r.getBoundingClientRect(); return { x: Math.round(b.left + 30), y: Math.round(b.top + b.height / 2) } })()`)
if (row) {
  await mouse('mousePressed', row.x, row.y, { buttons: 1, clickCount: 1 })
  await mouse('mouseReleased', row.x, row.y, { buttons: 0, clickCount: 1 })
}
await sleep(1000)
await shot('subchats')
console.log('subchats:', await evalJs(`document.querySelectorAll('.evo-tl-row-main').length`))
ws.close()
edge.kill()
process.exit(0)
