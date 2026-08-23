// headless Edge：显式导航 1093 → 拖拽方向 + hover 样式
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'

const debugPort = 47412
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-hd2-${Date.now()}`
mkdirSync(profile, { recursive: true })
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets = null
for (let i = 0; i < 30; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
    if (list.some((t) => t.type === 'page')) { targets = list; break }
  } catch { /* retry */ }
  await sleep(1000)
}
console.log('step1: edge up, targets:', targets?.length)
if (!targets) { edge.kill(); process.exit(1) }

let page = targets.find((t) => t.type === 'page' && t.url.includes('1093'))
const pageUrl = page?.webSocketDebuggerUrl ?? targets.find((t) => t.type === 'page').webSocketDebuggerUrl
const ws = new WebSocket(pageUrl)
await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
console.log('step2: ws connected')
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
async function evalJs(expr, timeoutMs = 6000) {
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
console.log('step3: navigated?', await evalJs(`location.href`))
if (!page) {
  await send('Page.navigate', { url: 'http://127.0.0.1:1093/?sidebar=1' })
  await sleep(6000)
}
console.log('step4: url=', await evalJs(`location.href`))
for (let i = 0; i < 20; i++) {
  const n = await evalJs(`document.querySelectorAll('.evo-tl-item').length`).catch(() => 0)
  if (n >= 7) break
  await sleep(1000)
}
console.log('step5: menu ready, state=', JSON.stringify(await evalJs(`(() => ({ vis: document.visibilityState, w: window.innerWidth }))()`)))
await sleep(1500)

const grip = await evalJs(`(() => {
  const g = document.querySelector('.evo-composer-resize')
  const r = g.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
console.log('step6: grip=', JSON.stringify(grip))

await mouse('mouseMoved', grip.x, grip.y, {})
await sleep(600)
console.log('step7: hover=', JSON.stringify(await evalJs(`(() => {
  const g = document.querySelector('.evo-composer-resize')
  const b = getComputedStyle(g, '::before')
  return { hovered: g.matches(':hover'), bg: b.backgroundColor, w: b.width }
})()`)))

// 三轮拖拽：先拉高到超过最小高度，再验证精确增量（每轮重新定位热区——拖拽后热区随输入框上移）
const gripPos = async () => evalJs(`(() => {
  const g = document.querySelector('.evo-composer-resize')
  const r = g.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
const h0 = await evalJs(`document.querySelector('.evo-composer-textarea').offsetHeight`)
let gp = await gripPos()
await mouse('mousePressed', gp.x, gp.y, { buttons: 1, clickCount: 1 })
await sleep(250)
for (let s = 1; s <= 12; s++) { await mouse('mouseMoved', gp.x, gp.y - s * 10, { buttons: 1 }); await sleep(60) }
await mouse('mouseReleased', gp.x, gp.y - 120, { buttons: 0, clickCount: 1 })
await sleep(600)
const hA = await evalJs(`document.querySelector('.evo-composer-textarea').offsetHeight`)
console.log('step8: UP 120px =', { before: h0, after: hA, delta: hA - h0 })

gp = await gripPos()
await mouse('mousePressed', gp.x, gp.y, { buttons: 1, clickCount: 1 })
await sleep(250)
for (let s = 1; s <= 6; s++) { await mouse('mouseMoved', gp.x, gp.y - s * 10, { buttons: 1 }); await sleep(60) }
await mouse('mouseReleased', gp.x, gp.y - 60, { buttons: 0, clickCount: 1 })
await sleep(600)
const hB = await evalJs(`document.querySelector('.evo-composer-textarea').offsetHeight`)
console.log('step9: UP 60px again =', { after: hB, delta: hB - hA })

gp = await gripPos()
await mouse('mousePressed', gp.x, gp.y, { buttons: 1, clickCount: 1 })
await sleep(250)
for (let s = 1; s <= 3; s++) { await mouse('mouseMoved', gp.x, gp.y + s * 10, { buttons: 1 }); await sleep(60) }
await mouse('mouseReleased', gp.x, gp.y + 30, { buttons: 0, clickCount: 1 })
await sleep(600)
const hC = await evalJs(`document.querySelector('.evo-composer-textarea').offsetHeight`)
console.log('step10: DOWN 30px =', { after: hC, delta: hC - hB })

// 截图（hover 态）
await mouse('mouseMoved', grip.x, grip.y, {})
await sleep(500)
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('D:\\DSH-Research\\.tmp-dev\\images\\visual-grip.png', Buffer.from(shot.data, 'base64'))
console.log('step10: screenshot saved')
ws.close()
edge.kill()
rmSync(profile, { recursive: true, force: true })
process.exit(0)
