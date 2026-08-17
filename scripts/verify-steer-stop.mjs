/**
 * Round 18 验证：队列 steer（B-4）+ 停止本轮（B-10）。
 * 1. 建会话发消息（长回复保持 running 窗口）；
 * 2. 运行中再发排队消息 → 队列弹层出现 steer 按钮（placement 'queued' + running）→ 点击 → 行消失；
 * 3. 再次运行中 → 点击停止按钮（session.cancel）→ running 结束、partial 清空；
 * 4. 截图。
 * 用法：node scripts/verify-steer-stop.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 40000 + Math.floor(Math.random() * 500)
const userData = join(ROOT, '.tmp-port', `edge-ss-${randomBytes(4).toString('hex')}`)
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
  const state = `(function(){ try { const s = ${svc}.binding('${'%ID%'}').session; const c = s.snapshotCache; const nodes = (c?.chat?.legacy?.nodes ?? []).filter(function(n){return n && n.visibility === 'visible'}); return { partial: c?.chat?.legacy?.partial ?? null, nodes: nodes.length, queue: (c?.queue ?? []).map(function(q){ return { id: q.id, placement: q.placement, text: String(q.preview ?? '').slice(0, 40) } }) } } catch(e) { return { throw: String(e) } } })()`

  const mkState = (id) => state.replace('%ID%', id)

  // 创建会话
  const id = await cdp.eval(`(function(){ return ${svc}.create({}).then(function(id){ ${svc}.open(id); return id }) })()`)
  await sleep(800)
  report.id = id
  const prompt = (text) => `(function(){ const s = ${svc}.binding('${id}').session; return s.prompt([{type:'text',text:${JSON.stringify(text)}}], 'queue').then(function(){ return true }) })()`

  // ── steer 测试 ──
  await cdp.eval(prompt('Count from 1 to 30, one number per line, with a short pause between lines.'))
  // 等 running（partial 出现或 queue 非空）
  for (let i = 0; i < 40; i += 1) {
    const st = await cdp.eval(mkState(id))
    if (st.partial !== null || st.queue.length > 0) break
    await sleep(300)
  }
  // 运行中发排队消息
  await cdp.eval(prompt('Ignore everything before. Reply with exactly: STEERED-OK'))
  await sleep(1500)
  report.queueBeforeSteer = await cdp.eval(mkState(id))
  // 打开队列弹层（点队列按钮）
  await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('.evo-composer-tool')).find(function(b){ return b.title.startsWith('队列消息') }); if (btn) btn.click(); return btn !== undefined })()`)
  await sleep(500)
  report.steerButtons = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-queue-steer')).length })()`)
  report.queueRowsShown = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-queue-row').length })()`)
  // 点击 steer
  report.steerClick = await cdp.eval(`(function(){ const btn = document.querySelector('.evo-queue-steer'); if (!btn) return 'no-steer-btn'; btn.click(); return 'clicked' })()`)
  await sleep(2500)
  report.queueAfterSteer = await cdp.eval(mkState(id))
  // 等 M1 完成
  for (let i = 0; i < 180; i += 1) {
    const st = await cdp.eval(mkState(id))
    if (st.partial === null && st.queue.length === 0) break
    await sleep(500)
  }
  report.afterLongTurn = await cdp.eval(mkState(id))

  // ── stop 测试 ──
  await cdp.eval(prompt('Count from 1 to 40, one number per line, with a short pause between lines.'))
  let runningSeen = false
  for (let i = 0; i < 60; i += 1) {
    const st = await cdp.eval(mkState(id))
    if (st.partial !== null) { runningSeen = true; break }
    await sleep(300)
  }
  report.runningSeen = runningSeen
  report.stopBtnExists = await cdp.eval(`(function(){ return document.querySelector('.evo-composer-stop') !== null })()`)
  report.stopClick = await cdp.eval(`(function(){ const btn = document.querySelector('.evo-composer-stop'); if (!btn) return 'no-stop-btn'; btn.click(); return 'clicked' })()`)
  await sleep(3000)
  report.afterStop = await cdp.eval(mkState(id))
  report.stopBtnGone = await cdp.eval(`(function(){ return document.querySelector('.evo-composer-stop') === null })()`)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-port', `steer-stop-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})

