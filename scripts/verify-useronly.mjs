// 验证"仅显示我的消息"按钮：过滤 AI 回复、localStorage 持久化、恢复
import WebSocket from 'ws'
import { writeFileSync, mkdirSync } from 'node:fs'

const CDP_PORT = '47510'
const APP_URL = 'http://127.0.0.1:8181/?sidebar=1'

const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
const page = targets.find((t) => t.type === 'page')
if (!page) { console.log('NO PAGE'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
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
await new Promise((r) => ws.on('open', r))
async function evalJs(expr, timeoutMs = 8000) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('EVAL_TIMEOUT')), timeoutMs)),
  ])
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 1) 导航到新 sidecar
await send('Page.enable')
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Page.navigate', { url: APP_URL })
await sleep(8000)

// 2) 等会话列表 + 打开 rewind14 会话（有 2 轮真实对话）
let opened = false
for (let i = 0; i < 15; i++) {
  opened = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('.evo-tl-row-main')]
    if (rows.length === 0) return false
    const row = rows.find(r => r.textContent.includes('创建版本一文件'))
    ;(row ?? rows[0]).click()
    return true
  })()`)
  if (opened) break
  await sleep(1000)
}
await sleep(3000)
console.log('OPENED:', opened)

// 3) 基线统计
const baseline = await evalJs(`(() => ({
  url: location.search,
  userBubbles: document.querySelectorAll('.evo-msg-bubble-user').length,
  assistantBubbles: document.querySelectorAll('.evo-msg-bubble-assistant').length,
  hint: !!document.querySelector('.evo-useronly-hint'),
  userOnlyBtn: !!document.querySelector('.evo-composer-tool[title="仅我的消息（隐藏 AI 回复）"]'),
}))()`)
console.log('BASELINE:', JSON.stringify(baseline))

// 4) 点击"仅我的消息"按钮
const clicked = await evalJs(`(() => {
  const btn = [...document.querySelectorAll('.evo-composer-tool')].find(b => (b.getAttribute('title') ?? '').includes('仅我的消息'))
  if (!btn) return false
  btn.click()
  return true
})()`)
await sleep(800)
const filtered = await evalJs(`(() => ({
  userBubbles: document.querySelectorAll('.evo-msg-bubble-user').length,
  assistantBubbles: document.querySelectorAll('.evo-msg-bubble-assistant').length,
  hint: !!document.querySelector('.evo-useronly-hint'),
  btnOn: [...document.querySelectorAll('.evo-composer-tool')].find(b => (b.getAttribute('title') ?? '').includes('仅我的消息'))?.hasAttribute('data-on'),
  ls: localStorage.getItem('evoresearch-useronly'),
}))()`)
console.log('CLICKED:', clicked)
console.log('FILTERED:', JSON.stringify(filtered))

// 5) 刷新 → 持久化验证
await send('Page.reload', { ignoreCache: true })
await sleep(8000)
await evalJs(`document.querySelector('.evo-tl-row-main')?.click()`)
await sleep(2500)
const persisted = await evalJs(`(() => ({
  userBubbles: document.querySelectorAll('.evo-msg-bubble-user').length,
  assistantBubbles: document.querySelectorAll('.evo-msg-bubble-assistant').length,
  hint: !!document.querySelector('.evo-useronly-hint'),
  btnOn: [...document.querySelectorAll('.evo-composer-tool')].find(b => (b.getAttribute('title') ?? '').includes('仅我的消息'))?.hasAttribute('data-on'),
}))()`)
console.log('PERSISTED (after reload):', JSON.stringify(persisted))

// 6) 关闭过滤 → 恢复（注意：开启时 title 变为"显示全部消息"，用 aria-label 匹配）
await evalJs(`[...document.querySelectorAll('.evo-composer-tool')].find(b => (b.getAttribute('aria-label') ?? '').includes('仅我的消息'))?.click()`)
await sleep(800)
const restored = await evalJs(`(() => ({
  userBubbles: document.querySelectorAll('.evo-msg-bubble-user').length,
  assistantBubbles: document.querySelectorAll('.evo-msg-bubble-assistant').length,
  hint: !!document.querySelector('.evo-useronly-hint'),
  ls: localStorage.getItem('evoresearch-useronly'),
}))()`)
console.log('RESTORED:', JSON.stringify(restored))

// 7) 截图（过滤模式开启，供视觉模型）
await evalJs(`[...document.querySelectorAll('.evo-composer-tool')].find(b => (b.getAttribute('aria-label') ?? '').includes('仅我的消息'))?.click()`)
await sleep(800)
const shot = await send('Page.captureScreenshot', { format: 'png' })
mkdirSync('.tmp-port', { recursive: true })
writeFileSync('.tmp-port/visual-useronly.png', Buffer.from(shot.data, 'base64'))
console.log('screenshot saved: .tmp-port/visual-useronly.png')

// 8) 恢复为全量视图
await evalJs(`[...document.querySelectorAll('.evo-composer-tool')].find(b => (b.getAttribute('aria-label') ?? '').includes('仅我的消息'))?.click()`)
await sleep(500)
const finalState = await evalJs(`(() => ({
  userBubbles: document.querySelectorAll('.evo-msg-bubble-user').length,
  assistantBubbles: document.querySelectorAll('.evo-msg-bubble-assistant').length,
  hint: !!document.querySelector('.evo-useronly-hint'),
  ls: localStorage.getItem('evoresearch-useronly'),
}))()`)
console.log('FINAL:', JSON.stringify(finalState))
ws.close()
process.exit(0)
