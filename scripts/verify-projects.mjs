// E2E：左侧项目分组（项目列表 → 子聊天列表 → 返回）+ 图谱回归
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'
const debugPort = 47425
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-hd15-${Date.now()}`
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
await send('Page.navigate', { url: 'http://127.0.0.1:1384/?sidebar=1' })
await sleep(8000)
for (let i = 0; i < 20; i++) {
  const n = await evalJs(`document.querySelectorAll('.evo-tl-item').length`).catch(() => 0)
  if (n >= 7) break
  await sleep(1000)
}
await sleep(1200)

// STEP1 项目列表视图
console.log('STEP1 projects view:', JSON.stringify(await evalJs(`(() => ({
  headTitle: document.querySelector('.evo-tl-head-title')?.textContent,
  projectRows: document.querySelectorAll('.evo-tl-project-row').length,
  projectNames: [...document.querySelectorAll('.evo-tl-project-row .evo-tl-title-text')].map(e => e.textContent),
  hasBack: !!document.querySelector('.evo-tl-back'),
}))()`)))

// STEP2 点击项目 → 子聊天列表
await evalJs(`document.querySelector('.evo-tl-project-row')?.click()`)
await sleep(800)
console.log('STEP2 subchats view:', JSON.stringify(await evalJs(`(() => ({
  headTitle: document.querySelector('.evo-tl-head-title')?.textContent,
  hasBack: !!document.querySelector('.evo-tl-back'),
  rows: document.querySelectorAll('.evo-tl-row-main').length,
  section: document.querySelector('.evo-tl-section-title')?.textContent,
  searchVisible: !!document.querySelector('.evo-tl-search'),
}))()`)))

// STEP3 项目内新建聊天
await evalJs(`document.querySelector('.evo-tl-newchat')?.click()`)
await sleep(2000)
console.log('STEP3 new chat in project:', JSON.stringify(await evalJs(`(() => ({
  url: location.search.slice(0, 70),
  rows: document.querySelectorAll('.evo-tl-row-main').length,
}))()`)))

// STEP4 返回项目列表
await evalJs(`document.querySelector('.evo-tl-back')?.click()`)
await sleep(600)
console.log('STEP4 back:', JSON.stringify(await evalJs(`(() => ({
  headTitle: document.querySelector('.evo-tl-head-title')?.textContent,
  projectRows: document.querySelectorAll('.evo-tl-project-row').length,
  hasBack: !!document.querySelector('.evo-tl-back'),
}))()`)))

// STEP5 图谱回归（节点还在）
await evalJs(`(() => { const t = [...document.querySelectorAll('.evo-tab')].find(x => (x.textContent || '').includes('图谱')); if (t) t.click(); return !!t })()`)
await sleep(1000)
console.log('STEP5 graph regression:', JSON.stringify(await evalJs(`(() => ({
  nodes: document.querySelectorAll('.evo-graph-node').length,
  edges: document.querySelectorAll('.evo-graph-edge').length,
}))()`)))
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('D:\\DSH-Research\\.tmp-port\\visual-projects.png', Buffer.from(shot.data, 'base64'))
console.log('screenshot saved')
ws.close()
edge.kill()
process.exit(0)
