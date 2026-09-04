// 运行时完整验证：A 会话产生完整回复 → B（context 继承 A + memory 注入）引用验证
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import WebSocket from 'ws'
const PORT = '11230'
const SESS_A = 'session-383d108f-063a-49eb-b781-d98a9c0dd48e'
const SESS_B = 'session-384c58e2-b601-4cc2-b745-ca94bfa89b2d'
const debugPort = 47437
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-runtime-${Date.now()}`
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
async function openAndPrompt(sessionId, text) {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?sidebar=1&threadId=${sessionId}` })
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
  for (let i = 0; i < 90; i++) {
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

// 1) A 会话产生带独特代号的完整回复
const replyA = await openAndPrompt(SESS_A, '请用一句完整的话确认：我们的测试代号是 GRAPH-77。')
console.log('A REPLY:', replyA.slice(0, 150))
await sleep(1500)
// 2) 检查 A 的提取（含完整回复正文、无思考碎片）
const hist = await evalJs(`fetch('/evoresearch/fs/rewind-info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: '${SESS_A}' }) }).then(r => r.json())`).catch(() => null)
// 用 node 侧检查（直接读）
// 3) B 会话：复述继承 + 记忆
const replyB = await openAndPrompt(SESS_B, '请复述两件事：①图谱记忆节点内容；②你继承的上游对话中提到的测试代号。')
console.log('B REPLY:', replyB.slice(0, 600))
console.log('MEMORY DETECTED:', replyB.includes('橙天') || replyB.includes('橙色天空'))
console.log('CONTEXT DETECTED:', replyB.includes('GRAPH-77'))
ws.close()
edge.kill()
process.exit(0)
