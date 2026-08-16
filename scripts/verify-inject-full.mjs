// E2E 完整验证：A 会话产生对话 → B（context 继承 A + memory 注入）复述验证
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import WebSocket from 'ws'
const PORT = '12395'
const APP = `http://127.0.0.1:${PORT}/?sidebar=1`
const SESS_A = 'session-383d108f-063a-49eb-b781-d98a9c0dd48e'
const SESS_B = 'session-384c58e2-b601-4cc2-b745-ca94bfa89b2d'
const debugPort = 47431
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-hd21-${Date.now()}`
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
async function openSessionAndPrompt(sessionId, text, waitMin = 90) {
  await send('Page.navigate', { url: `${APP}&threadId=${sessionId}` })
  await sleep(9000)
  for (let i = 0; i < 20; i++) {
    const ok = await evalJs(`!!document.querySelector('.evo-composer-textarea')`).catch(() => false)
    if (ok) break
    await sleep(1000)
  }
  await evalJs(`(() => {
    const ta = document.querySelector('.evo-composer-textarea')
    if (!ta) return 'no-ta'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(text)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('.evo-send')?.click()
    return 'sent'
  })()`)
  let reply = ''
  for (let i = 0; i < waitMin; i++) {
    await sleep(2000)
    const st = await evalJs(`(() => {
      const dots = [...document.querySelectorAll('.evo-composer-dot')]
      const bubbles = [...document.querySelectorAll('.evo-msg-bubble-assistant')]
      return { busy: dots.some(d => d.getAttribute('data-busy') === 'true'), asst: bubbles.length, last: bubbles[bubbles.length - 1]?.textContent ?? '' }
    })()`).catch(() => null)
    if (st) reply = st.last
    if (st && !st.busy && st.asst >= 1 && reply.length > 10) break
  }
  return reply
}
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Page.enable')

// 1) A 会话：产生一段对话（含独特代号）
const replyA = await openSessionAndPrompt(SESS_A, '请记住我们的项目代号是 ORANGE-42，并简要回应。')
console.log('A REPLY:', replyA.slice(0, 120))
await sleep(1500)
// 2) B 会话：应继承 A 的上下文 + 注入记忆
const replyB = await openSessionAndPrompt(SESS_B, '请复述两件事：①图谱记忆节点内容；②你继承的上游对话中提到的项目代号。')
console.log('B REPLY:', replyB.slice(0, 600))
console.log('MEMORY DETECTED:', replyB.includes('橙天') || replyB.includes('橙色天空'))
console.log('CONTEXT DETECTED:', replyB.includes('ORANGE-42'))
ws.close()
edge.kill()
process.exit(0)
