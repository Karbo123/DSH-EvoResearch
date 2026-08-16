// 验证：①热区点击不改变高度 ②真实拖拽仍工作 ③+ 菜单不被 tabbar 裁剪
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'
const debugPort = 47415
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-hd5-${Date.now()}`
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
console.log('step1 edge:', targets ? 'up' : 'NOT UP')
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
console.log('step2 page ready')

// ① 热区点击（不移动）→ 高度不应变化
const before = await evalJs(`(() => {
  const ta = document.querySelector('.evo-composer-textarea')
  const g = document.querySelector('.evo-composer-resize').getBoundingClientRect()
  return { h: ta.offsetHeight, styleH: ta.style.height, x: Math.round(g.left + g.width / 2), y: Math.round(g.top + g.height / 2) }
})()`)
await mouse('mousePressed', before.x, before.y, { buttons: 1, clickCount: 1 })
await sleep(300)
await mouse('mouseReleased', before.x, before.y, { buttons: 0, clickCount: 1 })
await sleep(500)
const after = await evalJs(`(() => { const ta = document.querySelector('.evo-composer-textarea'); return { h: ta.offsetHeight, styleH: ta.style.height } })()`)
console.log('step3 CLICK-ONLY:', JSON.stringify({ before, after, unchanged: before.h === after.h }))

// ② 真实拖拽 60px → 仍工作
const grip2 = await evalJs(`(() => {
  const g = document.querySelector('.evo-composer-resize').getBoundingClientRect()
  return { x: Math.round(g.left + g.width / 2), y: Math.round(g.top + g.height / 2) }
})()`)
const h0 = await evalJs(`document.querySelector('.evo-composer-textarea').offsetHeight`)
await mouse('mousePressed', grip2.x, grip2.y, { buttons: 1, clickCount: 1 })
await sleep(250)
for (let s = 1; s <= 6; s++) { await mouse('mouseMoved', grip2.x, grip2.y - s * 10, { buttons: 1 }); await sleep(80) }
await mouse('mouseReleased', grip2.x, grip2.y - 60, { buttons: 0, clickCount: 1 })
await sleep(500)
const h1 = await evalJs(`document.querySelector('.evo-composer-textarea').offsetHeight`)
console.log('step4 DRAG 60px:', { before: h0, after: h1, delta: h1 - h0 })

// ③ + 菜单位置（fixed，不被裁剪）
await evalJs(`document.querySelector('.evo-tab-new')?.click()`)
await sleep(600)
const menu = await evalJs(`(() => {
  const menu = document.querySelector('.evo-tab-menu')
  const tabbar = document.querySelector('.evo-tabbar')
  if (!menu || !tabbar) return { missing: true }
  const mr = menu.getBoundingClientRect()
  const tr = tabbar.getBoundingClientRect()
  const cs = getComputedStyle(menu)
  return {
    pos: cs.position,
    menuRect: { top: Math.round(mr.top), left: Math.round(mr.left), bottom: Math.round(mr.bottom), w: Math.round(mr.width) },
    tabbarBottom: Math.round(tr.bottom),
    belowTabbar: mr.top >= tr.bottom,
    fullyVisible: mr.bottom <= window.innerHeight && mr.left >= 0,
    items: [...menu.querySelectorAll('.evo-tab-menu-item')].map(i => i.textContent.trim()),
  }
})()`)
console.log('step5 TAB-MENU:', JSON.stringify(menu))
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('D:\\DSH-Research\\.tmp-port\\visual-tabmenu.png', Buffer.from(shot.data, 'base64'))
console.log('step6 screenshot saved')
ws.close()
edge.kill()
process.exit(0)
