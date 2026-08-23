/**
 * Round 29 验证：§42.4 Scheduled 完成浏览器通知（10s 轮询 + 去重 + baseline）。
 * 1. 打开页面 → stub Notification（记录 + permission granted）→ 开启通知（localStorage）；
 * 2. 预置去重键 '[]'（baseline=false → 新完成立即通知）；
 * 3. 添加每分钟任务 → 等 tick（≤90s）+ 轮询（≤10s）→ 断言 notified 出现 'Scheduled 任务完成'；
 * 4. 等下一个 tick → 断言不重复通知（去重）；
 * 5. 截图。
 * 用法：node scripts/verify-notify.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 44000 + Math.floor(Math.random() * 700)
const userData = join(ROOT, '.tmp-dev', `edge-ntf-${randomBytes(4).toString('hex')}`)
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
  // stub Notification + 开启通知 + 预置去重键
  await cdp.eval(`(function(){
    window.__notified = [];
    window.Notification = class { constructor(title) { window.__notified.push(title) } static permission = 'granted'; static requestPermission() { return Promise.resolve('granted') } };
    localStorage.setItem('evoresearch-notifications', '1');
    localStorage.setItem('evoresearch-sched-notified', '[]');
    return true;
  })()`)

  // 添加每分钟任务
  const taskName = `NotifyTest-${Date.now().toString(36)}`
  await cdp.eval(`(function(){ return fetch('/evoresearch/fs/scheduler-add', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name: ${JSON.stringify(taskName)}, cron: '* * * * *', prompt: 'Reply with exactly: NOTIFY-OK' }) }).then(function(r){ return r.json() }) })()`)
  report.taskAdded = true

  // 等通知出现（tick ≤60s + 轮询 ≤10s，给 90s）
  let notified = []
  for (let i = 0; i < 90; i += 1) {
    notified = await cdp.eval(`(function(){ return window.__notified ?? [] })()`)
    if (notified.some((n) => n.includes('Scheduled 任务完成'))) break
    await sleep(1000)
  }
  report.notifiedFirst = notified

  // 去重键持久化断言
  report.dedupKey = await cdp.eval(`(function(){ const raw = localStorage.getItem('evoresearch-sched-notified'); return raw === null ? null : JSON.parse(raw).length })()`)

  // 等第二个 tick（≤70s）→ 通知数不增加（去重）
  const countAfterFirst = notified.length
  for (let i = 0; i < 75; i += 1) {
    const now = await cdp.eval(`(function(){ return (window.__notified ?? []).length })()`)
    if (now > countAfterFirst) break
    await sleep(1000)
  }
  report.notifiedAfterSecondTick = await cdp.eval(`(function(){ return window.__notified ?? [] })()`)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-dev', `notify-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
