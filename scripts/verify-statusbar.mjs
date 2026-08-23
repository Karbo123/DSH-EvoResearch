/**
 * Round 25 验证：§25.4 工作路径显示 + §25.5 动作栏窄窗口图标化/hover 展开。
 * 1. 建会话 → 状态条出现 .evo-cwd（路径文本 + title）；
 * 2. 宽屏：动作项文字可见（span opacity 1）；
 * 3. CDP 模拟窄容器（页面 500px）→ 文字隐藏（opacity 0 / max-width 0）；
 * 4. hover 图标 → 该项文字展开（opacity 1）；
 * 5. 截图。
 * 用法：node scripts/verify-statusbar.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const debugPort = 38000 + Math.floor(Math.random() * 700)
const userData = join(ROOT, '.tmp-dev', `edge-sb-${randomBytes(4).toString('hex')}`)
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
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/?sidebar=1` })
  for (let i = 0; i < 40; i += 1) {
    const ready = await cdp.eval(`(function(){ return document.querySelector('.evo-app') !== null && !!window.__evoresearch?.sessions })()`).catch(() => false)
    if (ready) break
    await sleep(500)
  }
  await sleep(1500)

  const report = {}
  const svc = `window.__evoresearch.sessions`
  const id = await cdp.eval(`(function(){ return ${svc}.create({}).then(function(id){ ${svc}.open(id); return id }) })()`)
  await sleep(1000)

  // §25.4 cwd 显示
  report.cwdEl = await cdp.eval(`(function(){ const el = document.querySelector('.evo-cwd'); return el ? { text: el.textContent, title: el.title, maxWidth: getComputedStyle(el).maxWidth } : null })()`)

  // §25.5 动作项文字（宽屏可见）
  const spanState = `(function(){ const span = document.querySelector('.evo-composer-tool span'); return span ? { text: span.textContent, opacity: getComputedStyle(span).opacity, maxWidth: getComputedStyle(span).maxWidth } : null })()`
  report.wideSpan = await cdp.eval(spanState)

  // 窄容器（页面 500px → composer 宽度 < 640 容器查询触发）
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 500, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  report.narrowSpan = await cdp.eval(spanState)
  // 关闭侧栏抽屉（其遮罩会拦截 hover；真实使用中抽屉关闭时按钮才可见）
  await cdp.eval(`(function(){ const m = document.querySelector('.evo-drawer-mask'); if (m) m.click(); return true })()`)
  await sleep(600)

  // hover 图标 → 文字展开（真实鼠标移动触发 :hover；目标 = 含文字的 Auto-approve 按钮）
  const btnPos = await cdp.eval(`(function(){ const span = document.querySelector('.evo-composer-tool span'); const btn = span?.closest('.evo-composer-tool'); if (!btn) return null; const r = btn.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  report.btnPos = btnPos
  if (btnPos !== null) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: btnPos.x, y: btnPos.y })
    await sleep(500)
  }
  report.hoverSpan = await cdp.eval(spanState)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-dev', `statusbar-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
