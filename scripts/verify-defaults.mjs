/**
 * Round 44 验证：默认中文/默认深色/弹窗 75% 宽高居中。
 * 1. 页面加载（新 profile）→ html.dark 存在（默认深色）+ 界面中文文案；
 * 2. 打开设置弹窗 → .evo-modal 尺寸 = 75vw × 75vh + mask 居中；
 * 3. 截图。
 * 用法：node scripts/verify-defaults.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 44000 + Math.floor(Math.random() * 600)
const userData = join(ROOT, '.tmp-port', `edge-df-${randomBytes(4).toString('hex')}`)
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
  await sleep(1800)

  const report = {}
  // 1) 默认深色 + 中文
  report.dark = await cdp.eval(`(function(){ return document.documentElement.classList.contains('dark') })()`)
  report.themePref = await cdp.eval(`(function(){ return localStorage.getItem('evoresearch-theme') })()`)
  report.zhWelcome = await cdp.eval(`(function(){ return document.querySelector('.evo-welcome h1')?.textContent ?? null })()`)
  report.zhAsk = await cdp.eval(`(function(){ return document.querySelector('.evo-composer-textarea')?.placeholder ?? null })()`)
  report.zhNewChat = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-tl-newchat span')).map(function(s){ return s.textContent })[0] ?? null })()`)
  // 2) 弹窗 75vw x 75vh 居中
  await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('button')).find(function(b){ const t = b.title || b.getAttribute('aria-label') || ''; return t === 'Settings' || t === '设置' }); if (btn) btn.click(); return true })()`)
  await sleep(800)
  report.modal = await cdp.eval(`(function(){ const m = document.querySelector('.evo-modal'); const mask = document.querySelector('.evo-modal-mask'); if (!m || !mask) return null; const mr = m.getBoundingClientRect(); const maskR = mask.getBoundingClientRect(); return { w: Math.round(mr.width), h: Math.round(mr.height), vw: Math.round(maskR.width), vh: Math.round(maskR.height), centeredX: Math.abs((mr.left + mr.width / 2) - maskR.width / 2) < 2, centeredY: Math.abs((mr.top + mr.height / 2) - maskR.height / 2) < 2, ratioW: (mr.width / maskR.width).toFixed(3), ratioH: (mr.height / maskR.height).toFixed(3) } })()`)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-port', `defaults-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
