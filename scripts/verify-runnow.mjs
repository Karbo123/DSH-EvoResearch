/**
 * Round 41 验证：§42.3 Run now + next run 显示。
 * 1. 添加任务（每分钟）→ scheduler-list 返回 nextRunAt；
 * 2. Scheduled 面板任务行显示 next run + Run now 按钮；
 * 3. 点击 Run now → lastRunAt 更新 + 结果线程出现；
 * 4. 截图。
 * 用法：node scripts/verify-runnow.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 42000 + Math.floor(Math.random() * 700)
const userData = join(ROOT, '.tmp-port', `edge-rn-${randomBytes(4).toString('hex')}`)
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
  // 添加任务
  const taskName = `RunNowTest-${Date.now().toString(36)}`
  const add = await cdp.eval(`(function(){ return fetch('/evoresearch/fs/scheduler-add', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name: ${JSON.stringify(taskName)}, cron: '* * * * *', prompt: 'Reply with exactly: RUNNOW-OK' }) }).then(function(r){ return r.json() }) })()`)
  report.added = add.ok === true
  // list 带 nextRunAt
  const list = await cdp.eval(`(function(){ return fetch('/evoresearch/fs/scheduler-list', { method:'POST', headers:{'content-type':'application/json'}, body: '{}' }).then(function(r){ return r.json() }) })()`)
  const task = (list?.value ?? []).find((t) => t.name === taskName)
  report.nextRunAt = typeof task?.nextRunAt === 'number' ? new Date(task.nextRunAt).toISOString() : task?.nextRunAt
  const taskId = task?.taskId

  // 面板行显示（next run 文本 + Run now 按钮）
  await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('.evo-tl-item')).find(function(b){ return b.textContent.includes('定时任务') }); if (btn) btn.click(); return true })()`)
  await sleep(1000)
  report.nextRunShown = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-panel-item')).some(function(n){ return n.querySelector('.evo-panel-item-num[title="Next run"]') !== null }) })()`)
  report.runNowBtn = await cdp.eval(`(function(){ return document.querySelectorAll('button[aria-label="立即运行"]').length })()`)

  // Run now 点击（定位新任务行）→ lastRunAt 更新
  report.runNowClick = await cdp.eval(`(function(){ const row = Array.from(document.querySelectorAll('.evo-panel-item')).find(function(n){ return n.textContent.includes(${JSON.stringify(taskName)}) }); const btn = row?.querySelector('button[aria-label="立即运行"]'); if (!btn) return 'no-btn'; btn.click(); return 'clicked' })()`)
  await sleep(3000)
  const list2 = await cdp.eval(`(function(){ return fetch('/evoresearch/fs/scheduler-list', { method:'POST', headers:{'content-type':'application/json'}, body: '{}' }).then(function(r){ return r.json() }) })()`)
  const task2 = (list2?.value ?? []).find((t) => t.taskId === taskId)
  report.lastRunUpdated = typeof task2?.lastRunAt === 'number'
  report.resultThread = task2?.lastResultThreadId ?? null

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-port', `runnow-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
