// 验证：拖大输入框 → 消息区最小高度保障 + 细滚动条 + 输入框最大高度约束
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'
const debugPort = 47416
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-hd6-${Date.now()}`
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
console.log('step1:', targets ? 'edge up' : 'NOT UP')
if (!targets) process.exit(1)
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

// 基线：聊天区与输入框高度
const base = await evalJs(`(() => {
  const chat = document.querySelector('.evo-chat')
  const ta = document.querySelector('.evo-composer-textarea')
  const g = document.querySelector('.evo-composer-resize').getBoundingClientRect()
  const composer = document.querySelector('.evo-composer-wrap')
  return {
    chatH: chat.offsetHeight,
    composerH: composer.offsetHeight,
    taH: ta.offsetHeight,
    gripY: Math.round(g.top + g.height / 2), gripX: Math.round(g.left + g.width / 2),
    vh: window.innerHeight,
  }
})()`)
console.log('BASE:', JSON.stringify(base))

// 拖到最大（上拖 1000px，触发 max 约束）
await mouse('mousePressed', base.gripX, base.gripY, { buttons: 1, clickCount: 1 })
await sleep(250)
for (let s = 1; s <= 20; s++) { await mouse('mouseMoved', base.gripX, base.gripY - s * 50, { buttons: 1 }); await sleep(40) }
await mouse('mouseReleased', base.gripX, base.gripY - 1000, { buttons: 0, clickCount: 1 })
await sleep(600)

const after = await evalJs(`(() => {
  const chat = document.querySelector('.evo-chat')
  const ta = document.querySelector('.evo-composer-textarea')
  const composer = document.querySelector('.evo-composer-wrap')
  return { chatH: chat.offsetHeight, composerH: composer.offsetHeight, taH: ta.offsetHeight, taStyleH: ta.style.height, vh: window.innerHeight }
})()`)
console.log('AFTER MAX-DRAG:', JSON.stringify(after))
console.log('msg-area remaining:', after.chatH - after.composerH)

// 滚动条样式
const sb = await evalJs(`(() => {
  const ta = document.querySelector('.evo-composer-textarea')
  const cs = getComputedStyle(ta)
  const styleSheets = [...document.styleSheets].map(s => s.cssRules ? [...s.cssRules].map(r => r.cssText).join('') : '').join('')
  return {
    scrollbarWidth: cs.scrollbarWidth,
    scrollbarColor: cs.scrollbarColor,
    hasWebkitRule: styleSheets.includes('::-webkit-scrollbar'),
  }
})()`)
console.log('SCROLLBAR:', JSON.stringify(sb))

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('D:\\DSH-Research\\.tmp-port\\visual-scrollbar.png', Buffer.from(shot.data, 'base64'))
console.log('screenshot saved')
ws.close()
edge.kill()
process.exit(0)
