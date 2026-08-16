import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const appPort = process.argv[2] || '2066'
const debugPort = 47300
const profile = `D:\\evoresearch-e2e-multiturn\\edge-${Date.now()}`
mkdirSync(profile, { recursive: true })
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=1512,950', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = await (async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
      const page = l.find((t) => t.type === 'page')
      if (page) return page
    } catch {}
    await sleep(500)
  }
  throw new Error('edge not up')
})()
const ws = new WebSocket(list.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0; const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); res(null) } }, 60000) })
const ev2 = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); return r?.result?.value ?? r?.exceptionDetails?.exception?.description ?? null }
const LEAK = ['Current runtime context', 'Current DSH file policy', '<code_mode>', '<research_memory_packet>', '<identity_profile>']

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: `http://127.0.0.1:${appPort}/?sidebar=1` })
await sleep(6000)
const report = {}
report.recents = await ev2('Array.from(document.querySelectorAll(".evo-tl-row")).length')
// 打开第一条 Recents（有历史的旧会话）
await ev2(`(function(){ const b = document.querySelector('.evo-tl-row .evo-tl-row-main'); if (b) b.click(); return !!b })()`)
await sleep(2500)
report.openedTitle = await ev2('document.querySelector(".evo-composer-status")?.textContent?.trim()?.slice(0, 60) ?? ""')
// 多轮续聊：搜索文献
await ev2(`(function(){ const el = document.querySelector('.evo-composer-textarea'); if (!el) return false; const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(el, '帮我搜索 RAG 幻觉相关的最新论文和基准数据集'); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
await sleep(400)
await ev2(`(function(){ const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '发送' || (x.textContent || '').trim() === 'Send'); if (b) b.click(); return !!b })()`)
report.sent = true
// 等回复（可能含工具调用，最长 6 分钟）
let replied = false
for (let i = 0; i < 180; i++) {
  await sleep(2000)
  const text = await ev2(`Array.from(document.querySelectorAll('.evo-msg-bubble-assistant')).map((b) => b.textContent.trim()).join(' ')`)
  const newText = text.length
  if (i % 3 === 0) report.pollLen = newText
  if (newText > 60) { replied = true; break }
}
await sleep(1500)
report.replied = replied
report.replyText = replied ? await ev2(`Array.from(document.querySelectorAll('.evo-msg-bubble-assistant')).map((b) => b.textContent.trim()).join('\\n').slice(-600)`) : ''
report.leak = await ev2(`(function(){ const t = document.body.innerText; return ${JSON.stringify(LEAK)}.filter((p) => t.includes(p)) })()`)
report.toolCards = await ev2('document.querySelectorAll(".evo-tool-card, [class*=tool-call]").length')
report.mdTables = await ev2('document.querySelectorAll(".evo-md table").length')
report.mdCode = await ev2('document.querySelectorAll(".evo-md pre, .evo-md code").length')
// 记忆检索证据：回复中是否引用之前讨论
report.memoryMention = replied ? await ev2(`(function(){ const t = document.querySelector('.evo-msg-bubble-assistant:last-of-type')?.textContent ?? ''; return (t.includes('之前') || t.includes('上一轮') || t.includes('此前') || t.includes('记忆') || t.includes('回顾')) })()`) : false
console.log(JSON.stringify(report, null, 1))
edge.kill()
process.exit(0)
