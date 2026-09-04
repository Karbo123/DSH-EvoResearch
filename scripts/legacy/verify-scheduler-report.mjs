/**
 * Round 27 验证：§26.6 Scheduled "打开结果 / Report to main chat"。
 * 1. 打开 Scheduled 面板，添加每分钟任务；
 * 2. 等 tick 执行（≤120s）→ 任务行出现"打开结果"按钮（lastResultThreadId）；
 * 3. 等结果会话产出 assistant 回复（≤90s）；
 * 4. 点击 Report → 当前主会话收到用户消息（nodes 增加）；
 * 5. 截图。
 * 用法：node scripts/verify-scheduler-report.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 41000 + Math.floor(Math.random() * 700)
const userData = join(ROOT, '.tmp-dev', `edge-sch-${randomBytes(4).toString('hex')}`)
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
  const svc = `window.__evoresearch.sessions`
  // 主会话（Report 目标）
  const mainId = await cdp.eval(`(function(){ return ${svc}.create({}).then(function(id){ ${svc}.open(id); return id }) })()`)
  await sleep(1000)
  report.mainId = mainId

  // 打开 Scheduled 面板
  await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('.evo-tl-item')).find(function(b){ return b.textContent.includes('定时任务') }); if (btn) btn.click(); return true })()`)
  await sleep(600)
  report.panelOpen = await cdp.eval(`(function(){ return document.querySelector('.evo-panel-form') !== null })()`)

  // 添加任务（每分钟）
  const name = `ReportTest-${Date.now().toString(36)}`
  // 先切 Custom 模式：保证 .evo-panel-input 前三项均为 input（避开模式 select）
  await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('.evo-sched-modes button')).find(function(b){ return b.textContent.trim() === '自定义' }); if (btn) btn.click(); return !!btn })()`)
  await sleep(300)
  await cdp.eval(`(function(){ const inputs = document.querySelectorAll('.evo-panel-input'); if (inputs.length < 3) return 'no-inputs'; const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(inputs[0], ${JSON.stringify(name)}); inputs[0].dispatchEvent(new Event('input', { bubbles: true })); set.call(inputs[1], '* * * * *'); inputs[1].dispatchEvent(new Event('input', { bubbles: true })); set.call(inputs[2], 'Reply with exactly: SCHED-REPORT-OK'); inputs[2].dispatchEvent(new Event('input', { bubbles: true })); return 'filled' })()`)
  await sleep(300)
  report.addClick = await cdp.eval(`(function(){ const btn = document.querySelector('.evo-panel-add'); if (!btn) return 'no-btn'; btn.click(); return 'clicked' })()`)
  await sleep(1000)

  // 等 tick 执行（≤120s）→ 打开结果按钮出现
  let openBtn = false
  for (let i = 0; i < 120; i += 1) {
    const n = await cdp.eval(`(function(){ return document.querySelectorAll('button[aria-label="打开结果对话"]').length })()`)
    if (n > 0) { openBtn = true; break }
    await sleep(1000)
  }
  report.openBtnSeen = openBtn

  // 等本任务 tick 执行并产生 lastResultThreadId（≤150s）
  let taskId = undefined
  for (let i = 0; i < 150; i += 1) {
    const tasks = await cdp.eval(`(function(){ return fetch('/evoresearch/fs/scheduler-list', { method:'POST', headers:{'content-type':'application/json'}, body: '{}' }).then(function(r){ return r.json() }) })()`)
    report.tasks = tasks
    const mine = (tasks?.value ?? []).find((t) => t.name === name)
    if (mine?.lastResultThreadId !== undefined) { taskId = mine.taskId; break }
    await sleep(1000)
  }
  report.taskId = taskId
  const reportEndpoint = { text: null, error: null }
  if (taskId !== undefined) {
    for (let i = 0; i < 180; i += 1) {
      const res = await cdp.eval(`(function(){ return fetch('/evoresearch/fs/scheduler-report', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ taskId: ${JSON.stringify(taskId)} }) }).then(function(r){ return r.json() }) })()`)
      if (res.ok === true && res.value?.text !== undefined) { reportEndpoint.text = res.value.text; break }
      if (res.ok !== true && res.error?.message !== undefined && res.error.message.includes('暂无回复')) { reportEndpoint.error = res.error.message }
      await sleep(1000)
    }
  }
  report.reportEndpoint = reportEndpoint

  // UI Report 按钮 → 主会话收到消息
  const nodesBefore = await cdp.eval(`(function(){ try { const s = ${svc}.binding('${mainId}').session; const c = s.snapshotCache; return (c?.chat?.legacy?.nodes ?? []).filter(function(n){return n && n.visibility === 'visible'}).length } catch(e) { return -1 } })()`)
  report.nodesBefore = nodesBefore
  if (reportEndpoint.text !== null) {
    report.reportClick = await cdp.eval(`(function(){ const btn = document.querySelector('button[aria-label="汇报到主对话"]'); if (!btn) return 'no-btn'; btn.click(); return 'clicked' })()`)
    await sleep(2500)
  }
  const nodesAfter = await cdp.eval(`(function(){ try { const s = ${svc}.binding('${mainId}').session; const c = s.snapshotCache; return (c?.chat?.legacy?.nodes ?? []).filter(function(n){return n && n.visibility === 'visible'}).length } catch(e) { return -1 } })()`)
  report.nodesAfter = nodesAfter

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-dev', `sched-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
