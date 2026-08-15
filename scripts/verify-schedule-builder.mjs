/**
 * Round 28 验证：§42.2 Schedule Builder（模式切换/模板/cron 预览）+ 添加任务。
 * 1. 打开 Scheduled 面板 → 断言模式 tabs（Daily/Weekly/Monthly/Custom）与模板按钮；
 * 2. Weekly 模式选 Mon 08:30 → cron 预览 "30 8 * * 1"；
 * 3. 应用模板 Daily Papers → name/prompt 填充 + cron "0 9 * * *"；
 * 4. 添加任务 → 列表出现（cron 正确）；
 * 5. 截图。
 * 用法：node scripts/verify-schedule-builder.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 43000 + Math.floor(Math.random() * 700)
const userData = join(ROOT, '.tmp-port', `edge-sb2-${randomBytes(4).toString('hex')}`)
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
  // 打开 Scheduled 面板
  await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('.evo-tl-item')).find(function(b){ return b.textContent.includes('定时任务') }); if (btn) btn.click(); return true })()`)
  await sleep(600)

  report.modes = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-sched-modes button')).map(function(b){ return b.textContent }) })()`)
  report.templates = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-sched-template')).map(function(b){ return b.textContent }) })()`)
  report.previewInitial = await cdp.eval(`(function(){ return document.querySelector('.evo-sched-preview')?.textContent ?? null })()`)

  // Weekly 模式 → Mon 08:30
  await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('.evo-sched-modes button')).find(function(b){ return b.textContent === '每周' }); if (btn) btn.click(); return true })()`)
  await sleep(300)
  const setSel = (aria, value) => `(function(){ const sel = document.querySelector('select[aria-label="${aria}"]'); if (!sel) return 'no-sel'; const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set; setter.call(sel, ${JSON.stringify(value)}); sel.dispatchEvent(new Event('change', { bubbles: true })); return 'set' })()`
  report.setHour = await cdp.eval(setSel('Hour', '8'))
  report.setMinute = await cdp.eval(setSel('Minute', '30'))
  report.setWeekday = await cdp.eval(setSel('Weekday', '1'))
  await sleep(400)
  report.previewWeekly = await cdp.eval(`(function(){ return document.querySelector('.evo-sched-preview')?.textContent ?? null })()`)

  // 模板 Daily Papers
  await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('.evo-sched-template')).find(function(b){ return b.textContent === 'Daily Papers' }); if (btn) btn.click(); return true })()`)
  await sleep(300)
  report.templateApplied = await cdp.eval(`(function(){ const inputs = document.querySelectorAll('.evo-panel-input'); return { name: inputs[0]?.value ?? null, cron: document.querySelector('.evo-panel-input-cron')?.value ?? null, preview: document.querySelector('.evo-sched-preview')?.textContent ?? null } })()`)

  // 添加任务
  const taskName = `BuilderTest-${Date.now().toString(36)}`
  await cdp.eval(`(function(){ const inputs = document.querySelectorAll('.evo-panel-input'); const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(inputs[0], ${JSON.stringify(taskName)}); inputs[0].dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(200)
  report.addClick = await cdp.eval(`(function(){ const btn = document.querySelector('.evo-panel-add'); if (!btn) return 'no-btn'; btn.click(); return 'clicked' })()`)
  await sleep(1000)
  report.taskAdded = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-panel-item')).some(function(n){ return n.textContent.includes(${JSON.stringify(taskName)}) }) })()`)
  report.taskCron = await cdp.eval(`(function(){ const item = Array.from(document.querySelectorAll('.evo-panel-item')).find(function(n){ return n.textContent.includes(${JSON.stringify(taskName)}) }); return item ? (item.querySelector('.evo-panel-item-code')?.textContent ?? null) : null })()`)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-port', `schedbuilder-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
