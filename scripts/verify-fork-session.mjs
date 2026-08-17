// 验证：打开 fork 会话（B 的新绑定）→ 应显示 A 的历史消息
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'
const PORT = '12096'
const FORK = 'session-0920e72d-f65b-472f-9a8c-62e031865b47'
const debugPort = 47438
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-fork-${Date.now()}`
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
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Page.enable')
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?sidebar=1&threadId=${FORK}` })
await sleep(10000)
for (let i = 0; i < 20; i++) {
  const ok = await evalJs(`!!document.querySelector('.evo-composer-textarea')`).catch(() => false)
  if (ok) break
  await sleep(1000)
}
const state = await evalJs(`(() => {
  const users = [...document.querySelectorAll('.evo-msg-bubble-user')].map(b => b.textContent.slice(0, 30))
  const asst = [...document.querySelectorAll('.evo-msg-bubble-assistant')].map(b => b.textContent.slice(0, 30))
  return { userCount: users.length, users, asstCount: asst.length, asst }
})()`)
console.log('FORK SESSION VIEW:', JSON.stringify(state, null, 1))
console.log('HAS A HISTORY:', state.users.some((t) => t.includes('GRAPH-77') || t.includes('版本一') || t.includes('工作正常')))
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('D:\\DSH-Research\\.tmp-port\\full-fork-session.png', Buffer.from(shot.data, 'base64'))
console.log('screenshot saved')
ws.close()
edge.kill()
process.exit(0)

