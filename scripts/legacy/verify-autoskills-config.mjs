/**
 * Round 35 验证：§42.9 AutoSkills 调度配置（enabled/mode/cadence/time + reconcile）。
 * 1. 端点：GET 读默认配置（{} → 默认值）、POST 写 nightly 05:30 → cron "30 5 * * *"；
 * 2. POST 写 weekly + 03:00 → cron "0 3 * * 0"（规范示例）→ scheduler-list 出现 AutoSkills 任务；
 * 3. 再次写 weekly 03:00 → AutoSkills 任务唯一（reconcile 不重复）；
 * 4. 禁用 → AutoSkills 任务删除；
 * 5. UI：Skills 面板出现调度设置区。
 * 用法：node scripts/verify-autoskills-config.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 36000 + Math.floor(Math.random() * 1200)
const userData = join(ROOT, '.tmp-dev', `edge-as-${randomBytes(4).toString('hex')}`)
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
  const api = (method, body) => `(function(){ return fetch('/evoresearch/fs/${method}', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(${body}) }).then(function(r){ return r.json() }) })()`

  // 1) 读默认
  report.read = await cdp.eval(api('autoskills-config', '{}'))
  // 2) 写 nightly 05:30 → cron 30 5 * * *
  report.writeNightly = await cdp.eval(api('autoskills-config', '{ enabled: true, mode: "review", cadence: "nightly", time: "05:30" }'))
  // 3) 写 weekly 03:00 → cron 0 3 * * 0（规范示例）
  report.writeWeekly = await cdp.eval(api('autoskills-config', '{ enabled: true, mode: "review", cadence: "weekly", time: "03:00" }'))
  await sleep(500)
  report.schedTasks = await cdp.eval(api('scheduler-list', '{}'))
  const autoTasks = (report.schedTasks?.value ?? []).filter((t) => t.name === 'AutoSkills')
  report.autoTaskCount = autoTasks.length
  report.autoTaskCron = autoTasks[0]?.cron ?? null
  // 4) 再次写相同配置 → 仍唯一
  await cdp.eval(api('autoskills-config', '{ enabled: true, mode: "review", cadence: "weekly", time: "03:00" }'))
  await sleep(500)
  const sched2 = await cdp.eval(api('scheduler-list', '{}'))
  report.autoTaskCountAfterReapply = (sched2?.value ?? []).filter((t) => t.name === 'AutoSkills').length
  // 5) 禁用 → 删除
  report.disable = await cdp.eval(api('autoskills-config', '{ enabled: false }'))
  await sleep(500)
  const sched3 = await cdp.eval(api('scheduler-list', '{}'))
  report.autoTaskCountAfterDisable = (sched3?.value ?? []).filter((t) => t.name === 'AutoSkills').length

  // 6) UI 设置区
  await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('.evo-tl-item')).find(function(b){ return b.textContent.includes('Research Skills') }); if (btn) btn.click(); return true })()`)
  await sleep(800)
  report.uiSchedule = await cdp.eval(`(function(){ const label = Array.from(document.querySelectorAll('.evo-panel-label')).find(function(n){ return n.textContent.includes('AutoSkills schedule') }); return label !== undefined })()`)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-dev', `asconfig-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
