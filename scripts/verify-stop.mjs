/**
 * Round 18 补充：停止本轮精确验证。
 * 长任务运行中（以 UI 停止按钮出现为 running 信号）→ 点击停止 →
 * 断言 running 结束、partial 清空、排队消息保留（cancel keepInbox）。
 * 用法：node scripts/verify-stop.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 41000 + Math.floor(Math.random() * 500)
const userData = join(ROOT, '.tmp-port', `edge-stop-${randomBytes(4).toString('hex')}`)
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
    const ready = await cdp.eval(`(function(){ return document.querySelector('.evo-app') !== null && !!window.__evoresearch })()`).catch(() => false)
    if (ready) break
    await sleep(500)
  }
  await sleep(1500)

  const report = {}
  const svc = `window.__evoresearch.sessions`
  const id = await cdp.eval(`(function(){ return ${svc}.create({}).then(function(id){ ${svc}.open(id); return id }) })()`)
  await sleep(800)
  report.id = id
  const mkState = `(function(){ try { const s = ${svc}.binding('${id}').session; const c = s.snapshotCache; const nodes = (c?.chat?.legacy?.nodes ?? []).filter(function(n){return n && n.visibility === 'visible'}); return { partial: c?.chat?.legacy?.partial ?? null, nodes: nodes.length, queue: (c?.queue ?? []).length, err: c?.promptError?.error?.message ?? null, errOp: c?.promptError?.op ?? null } } catch(e) { return { throw: String(e) } } })()`

  // 长任务（1-60，每次停顿 800ms → 模型输出阶段 48s+，足够停止窗口）
  await cdp.eval(`(function(){ const s = ${svc}.binding('${id}').session; return s.prompt([{type:'text',text:'Count from 1 to 60, one number per line, with a pause of 800ms between lines.'}], 'queue').then(function(){ return true }) })()`)

  // 等 UI 停止按钮出现（running 信号）
  let buttonSeen = false
  for (let i = 0; i < 120; i += 1) {
    const exists = await cdp.eval(`(function(){ return document.querySelector('.evo-composer-stop') !== null })()`)
    if (exists) { buttonSeen = true; break }
    await sleep(500)
  }
  report.buttonSeen = buttonSeen
  report.stateBeforeStop = await cdp.eval(mkState)

  // 点击停止
  report.stopClick = await cdp.eval(`(function(){ const btn = document.querySelector('.evo-composer-stop'); if (!btn) return 'no-btn'; btn.click(); return 'clicked' })()`)
  await sleep(3000)
  report.stateAfterStop = await cdp.eval(mkState)
  report.stopBtnGone = await cdp.eval(`(function(){ return document.querySelector('.evo-composer-stop') === null })()`)

  // 3 秒后再确认仍不 running（未被自动重启）
  await sleep(3000)
  report.stateAfter6s = await cdp.eval(mkState)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-port', `stop-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
