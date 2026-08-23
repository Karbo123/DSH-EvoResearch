/**
 * Round 36 验证：§26.5 Memory History 时间线。
 * 1. 打开 EvoMemory 面板 → Overview/History 切换；
 * 2. 切 History → research_turns 时间线（文本/时间/类别标签）出现；
 * 3. Load earlier 分页；
 * 4. 点击 Open thread → 会话打开（当前会话变化）。
 * 用法：node scripts/verify-memory-history.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 37000 + Math.floor(Math.random() * 1000)
const userData = join(ROOT, '.tmp-dev', `edge-mh-${randomBytes(4).toString('hex')}`)
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
  // 打开 EvoMemory 面板
  await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('.evo-tl-item')).find(function(b){ return b.textContent.includes('科研记忆') }); if (btn) btn.click(); return true })()`)
  await sleep(800)
  report.tabs = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-skill-tabs button')).map(function(b){ return b.textContent.trim() }) })()`)
  // 切 History
  await cdp.eval(`(function(){ const b = Array.from(document.querySelectorAll('button')).find(function(x){ return x.textContent.trim() === '历史' }); if (b) b.click(); return true })()`)
  await sleep(1200)
  report.historyRows = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-history-row')).map(function(r){ return { text: r.querySelector('.evo-history-text')?.textContent?.slice(0, 50) ?? '', tags: Array.from(r.querySelectorAll('.evo-panel-tag')).map(function(t){ return t.textContent }) } }) })()`)
  report.hasLoadEarlier = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('button')).some(function(b){ return b.textContent.includes('Load earlier') }) })()`)

  // 打开第一个 turn 的 Thread
  report.openThread = await cdp.eval(`(function(){ const btn = document.querySelector('button[aria-label="打开对话"]'); if (!btn) return 'no-btn'; btn.click(); return 'clicked' })()`)
  await sleep(1500)
  report.sessionChanged = await cdp.eval(`(function(){ try { return window.__evoresearch.sessions.binding !== undefined && document.querySelector('.evo-composer-status')?.textContent.includes('科研记忆') === false } catch(e) { return String(e) } })()`)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-dev', `memhistory-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})

