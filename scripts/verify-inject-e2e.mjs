// E2E：记忆 + 上下文注入运行时验证（打开 B 会话 → 模型应复述注入内容）
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import WebSocket from 'ws'
const APP = 'http://127.0.0.1:13154/?sidebar=1'
const SESSION_B = 'session-384c58e2-b601-4cc2-b745-ca94bfa89b2d'
const debugPort = 47430
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-hd20-${Date.now()}`
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
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Page.enable')
await send('Page.navigate', { url: `${APP}&threadId=${SESSION_B}` })
await sleep(10000)
// 等待 composer 就绪
let ready = false
for (let i = 0; i < 20; i++) {
  const ok = await evalJs(`!!document.querySelector('.evo-composer-textarea')`).catch(() => false)
  if (ok) { ready = true; break }
  await sleep(1000)
}
console.log('composer ready:', ready, await evalJs(`location.search.slice(0, 80)`))
// 发消息：复述注入内容
await evalJs(`(() => {
  const ta = document.querySelector('.evo-composer-textarea')
  if (!ta) return 'no-ta'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, '请复述你收到的图谱记忆（graph_memory）和继承上下文（graph_context）中的关键内容，各用一句话概括。')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  document.querySelector('.evo-send')?.click()
  return 'sent'
})()`)
console.log('sent, waiting reply...')
let reply = ''
for (let i = 0; i < 90; i++) {
  await sleep(2000)
  const st = await evalJs(`(() => {
    const dots = [...document.querySelectorAll('.evo-composer-dot')]
    const bubbles = [...document.querySelectorAll('.evo-msg-bubble-assistant')]
    return { busy: dots.some(d => d.getAttribute('data-busy') === 'true'), asst: bubbles.length, last: bubbles[bubbles.length - 1]?.textContent ?? '' }
  })()`).catch(() => null)
  if (st) reply = st.last
  if (st && !st.busy && st.asst >= 1 && reply.length > 10) break
  if (i % 10 === 0) console.log('  waiting', i, st?.busy, st?.asst)
}
console.log('REPLY:', reply.slice(0, 500))
console.log('MEMORY DETECTED:', reply.includes('橙天') || reply.includes('橙色天空'))
console.log('CONTEXT DETECTED:', reply.includes('研究') || reply.includes('版本') || reply.includes('文件'))
ws.close()
edge.kill()
process.exit(0)

