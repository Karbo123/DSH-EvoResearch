/**
 * Round 30 验证：§42.6 Skills Marketplace（目录浏览 + 搜索 + 详情）。
 * 1. 打开 Skills 面板 → 断言 Proposals/Marketplace 视图切换；
 * 2. 切 Marketplace → 技能列表出现（名称/来源 badge）；
 * 3. 搜索过滤；
 * 4. 点击技能名 → 详情展开（When to use / invocation）；
 * 5. 截图。
 * 用法：node scripts/verify-marketplace.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 45000 + Math.floor(Math.random() * 700)
const userData = join(ROOT, '.tmp-port', `edge-mkt-${randomBytes(4).toString('hex')}`)
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
    const ready = await cdp.eval(`(function(){ return document.querySelector('.evo-app') !== null && !!window.__evoresearch?.sessions })()`).catch(() => false)
    if (ready) break
    await sleep(500)
  }
  await sleep(1500)

  const report = {}
  // 打开 Skills 面板
  await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('.evo-tl-item')).find(function(b){ return b.textContent.includes('科研技能') }); if (btn) btn.click(); return true })()`)
  await sleep(600)
  report.viewTabs = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-skill-tabs:first-child button, .evo-insp-subtab')).map(function(b){ return b.textContent.trim() }).filter(function(t){ return t === '提案' || t === '市场' }) })()`)

  // 切 Marketplace
  await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent.trim() === '市场' }); if (btn) btn.click(); return true })()`)
  await sleep(1000)
  report.skillCards = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-skill-card')).map(function(c){ return { name: c.querySelector('.evo-panel-item-main')?.textContent ?? '', source: c.querySelector('.evo-skill-source')?.textContent ?? null } }) })()`)
  report.count = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-skill-card').length })()`)

  // 搜索
  await cdp.eval(`(function(){ const input = document.querySelector('input[aria-label^="搜索技能"]'); if (!input) return 'no-input'; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(input, 'zzz-nonexistent'); input.dispatchEvent(new Event('input', { bubbles: true })); return 'typed' })()`)
  await sleep(500)
  report.afterSearchNone = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-skill-card').length })()`)
  await cdp.eval(`(function(){ const input = document.querySelector('input[aria-label^="搜索技能"]'); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(400)

  // 详情展开
  report.detailClick = await cdp.eval(`(function(){ const btn = document.querySelector('.evo-skill-name-btn'); if (!btn) return 'no-btn'; btn.click(); return 'clicked' })()`)
  await sleep(500)
  report.detailShown = await cdp.eval(`(function(){ return document.querySelector('.evo-skill-detail') !== null })()`)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-port', `marketplace-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})


