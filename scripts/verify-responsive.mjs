/**
 * Round 23b 验证：§26.1 响应式抽屉（<768px 左右栏抽屉 + 黑色 40% 遮罩）。
 * 1. 宽屏（1440）：左栏 flex 布局（position static）；
 * 2. CDP 模拟窄屏（500px）：左栏变 fixed 抽屉（translateX(-100%) 收起）；
 * 3. 打开侧栏 → 遮罩出现（rgba(0,0,0,0.4)）+ 抽屉滑入（transform none）→ 点击遮罩关闭；
 * 4. 截图。
 * 用法：node scripts/verify-responsive.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 36000 + Math.floor(Math.random() * 800)
const userData = join(ROOT, '.tmp-port', `edge-rsp-${randomBytes(4).toString('hex')}`)
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
    const ready = await cdp.eval(`(function(){ return document.querySelector('.evo-app') !== null })()`).catch(() => false)
    if (ready) break
    await sleep(500)
  }
  await sleep(1500)

  const report = {}
  const leftStyle = `(function(){ const el = document.querySelector('.evo-left'); if (!el) return null; const cs = getComputedStyle(el); return { position: cs.position, transform: cs.transform, width: el.offsetWidth, mask: document.querySelectorAll('.evo-drawer-mask').length } })()`

  report.wide = await cdp.eval(leftStyle)

  // 模拟窄屏（500px 宽）
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 500, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  report.narrowOpenInitial = await cdp.eval(leftStyle)

  const clickNavigation = `(() => { const btn = [...document.querySelectorAll('.evo-icon-btn')].find((b) => /导航|navigation/i.test(b.title || '')); if (!btn) return 'no-btn'; btn.click(); return btn.title || 'clicked' })()`
  // URL sidebar=1 starts open; close it and assert the hidden drawer state.
  report.closeNavigation = await cdp.eval(clickNavigation)
  await sleep(500)
  report.narrowClosed = await cdp.eval(leftStyle)
  // Re-open it and assert the mask and fixed drawer state.
  report.openNavigation = await cdp.eval(clickNavigation)
  await sleep(800)
  report.narrowOpen = await cdp.eval(leftStyle)
  report.maskStyle = await cdp.eval(`(function(){ const m = document.querySelector('.evo-drawer-mask'); if (!m) return null; const cs = getComputedStyle(m); return { background: cs.backgroundColor, position: cs.position, zIndex: cs.zIndex } })()`)
  // 点击遮罩关闭
  report.maskClick = await cdp.eval(`(function(){ const m = document.querySelector('.evo-drawer-mask'); if (!m) return 'no-mask'; m.click(); return 'clicked' })()`)
  await sleep(600)
  report.afterMaskClick = await cdp.eval(leftStyle)

  const checks = {
    wideStatic: report.wide?.position === 'static',
    narrowInitialFixed: report.narrowOpenInitial?.position === 'fixed' && report.narrowOpenInitial?.width === 320,
    narrowClosedHidden: report.narrowClosed === null,
    narrowOpenFixed: report.narrowOpen?.position === 'fixed' && report.narrowOpen?.width === 320,
    maskVisible: report.maskStyle?.background === 'rgba(0, 0, 0, 0.4)' && report.maskStyle?.position === 'fixed' && report.maskStyle?.zIndex === '280',
    maskClosesDrawer: report.maskClick === 'clicked' && report.afterMaskClick === null,
  }
  report.checks = checks

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-port', `responsive-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  if (Object.values(checks).some((value) => value !== true)) throw new Error(`响应式验收失败: ${Object.entries(checks).filter(([, value]) => value !== true).map(([name]) => name).join(', ')}`)
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})

