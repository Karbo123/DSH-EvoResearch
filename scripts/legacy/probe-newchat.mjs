// 复查：项目内新建聊天
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import WebSocket from 'ws'
const debugPort = 47426
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-hd16-${Date.now()}`
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
async function evalJs(expr, timeoutMs = 10000) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('EVAL_TIMEOUT')), timeoutMs)),
  ])
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result?.value
}
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
// 进入项目
await evalJs(`document.querySelector('.evo-tl-project-row')?.click()`)
await sleep(800)
// 直接调 manager.create 检查返回
const r1 = await evalJs(`(async () => {
  const m = window.__evoresearch?.sessions?.manager
  if (!m) return { noManager: true }
  const before = (m.list?.() ?? m.snapshot?.() ?? []).length ?? -1
  let created = null
  try { created = await m.create({ cwd: 'D:\\\\DSH-Research\\\\.tmp-e2e\\\\dev\\\\projects\\\\project' }) } catch (e) { return { createErr: String(e?.message ?? e) } }
  return { before, created, after: (m.list?.() ?? m.snapshot?.() ?? []).length ?? -1 }
})()`)
console.log('MANAGER CREATE:', JSON.stringify(r1))
// UI 新建按钮
await evalJs(`document.querySelector('.evo-tl-newchat')?.click()`)
await sleep(2500)
console.log('UI:', JSON.stringify(await evalJs(`(() => ({
  url: location.search.slice(0, 70),
  rows: document.querySelectorAll('.evo-tl-row-main').length,
  activeRow: document.querySelector('.evo-tl-row[data-active] .evo-tl-title-text')?.textContent ?? null,
}))()`)))
ws.close()
edge.kill()
process.exit(0)
