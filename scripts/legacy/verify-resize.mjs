/**
 * Round 22 验证：§23.1 输入框 resize 拖动把手。
 * 1. 打开页面（有会话则输入框可交互）；
 * 2. 获取 .evo-composer-resize 位置与 textarea 初始高度；
 * 3. CDP 鼠标拖动（按下 → 下移 200px → 释放）→ textarea 高度增加；
 * 4. 再拖动恢复 → 高度减小；断言范围限制（视口 1/4 ~ 2/3）。
 * 用法：node scripts/verify-resize.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 51000 + Math.floor(Math.random() * 400)
const userData = join(ROOT, '.tmp-dev', `edge-rs-${randomBytes(4).toString('hex')}`)
mkdirSync(dirname(userData), { recursive: true })

const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`, '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map() }
  static async connect(port) {
    for (let i = 0; i < 60; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        const page = list.find((t) => t.type === 'page')
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
        const c = new Cdp(ws)
        ws.onmessage = (ev) => c._onMessage(JSON.parse(ev.data))
        return c
      } catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    throw new Error('CDP 连接失败')
  }
  _onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    }
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (res.exceptionDetails) throw new Error(`eval 异常: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`)
    return res.result?.value
  }
  close() { this.ws.close() }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const cdp = await Cdp.connect(debugPort)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url })
  for (let i = 0; i < 40; i += 1) {
    const ready = await cdp.eval(`(function(){ return document.querySelector('.evo-composer-resize') !== null })()`).catch(() => false)
    if (ready) break
    await sleep(500)
  }
  await sleep(1200)

  const report = {}
  const geo = async () => cdp.eval(`(function(){ const h = document.querySelector('.evo-composer-resize'); const ta = document.querySelector('.evo-composer-textarea'); if (!h || !ta) return null; const hr = h.getBoundingClientRect(); return { handleY: Math.round(hr.top + hr.height / 2), handleX: Math.round(hr.left + hr.width / 2), taHeight: ta.offsetHeight, vh: window.innerHeight } })()`)

  report.before = await geo()
  // 向下拖动 200px
  const p = report.before
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.handleX, y: p.handleY, button: 'left', buttons: 1, clickCount: 1 })
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.handleX, y: p.handleY + step * 20, button: 'left', buttons: 1 })
    await sleep(30)
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.handleX, y: p.handleY + 200, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(400)
  report.afterDragDown = await geo()

  // 向上拖动恢复
  const q = report.afterDragDown
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: q.handleX, y: q.handleY, button: 'left', buttons: 1, clickCount: 1 })
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q.handleX, y: q.handleY - step * 20, button: 'left', buttons: 1 })
    await sleep(30)
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q.handleX, y: q.handleY - 200, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(400)
  report.afterDragUp = await geo()

  // 极限拖动（+5000px → 应被上限 2/3 视口钳制）
  const r = report.afterDragUp
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.handleX, y: r.handleY, button: 'left', buttons: 1, clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.handleX, y: r.handleY + 5000, button: 'left', buttons: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.handleX, y: r.handleY + 5000, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(400)
  report.afterExtreme = await geo()
  report.maxLimit = Math.round(report.before.vh * 2 / 3)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-dev', `resize-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
