/**
 * Round 42 验证：§26.3 Recents 运行状态点。
 * 1. 建会话 → 发长任务（运行中）→ Recents 行出现 .evo-tl-running 状态点；
 * 2. 任务完成后状态点消失；
 * 3. 截图。
 * 用法：node scripts/verify-running-dot.mjs <port>
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
const userData = join(ROOT, '.tmp-dev', `edge-rd-${randomBytes(4).toString('hex')}`)
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
  const id = await cdp.eval(`(function(){ return ${svc}.create({}).then(function(sid){ ${svc}.open(sid); return sid }) })()`)
  await sleep(1000)
  // 长任务（运行窗口）
  await cdp.eval(`(function(){ const s = ${svc}.binding('${id}').session; return s.prompt([{type:'text',text:'Count from 1 to 30, one number per line, with a pause between lines.'}], 'queue').then(function(){ return true }) })()`)
  // 等运行状态点出现（Recents 行）
  let dotSeen = false
  for (let i = 0; i < 60; i += 1) {
    dotSeen = await cdp.eval(`(function(){ return document.querySelector('.evo-tl-running') !== null })()`)
    if (dotSeen) break
    await sleep(500)
  }
  report.dotSeen = dotSeen
  if (dotSeen) {
    const shot1 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(ROOT, '.tmp-dev', `rundot-${port}.png`), Buffer.from(shot1.data, 'base64'))
  }
  // 等完成 → 状态点消失
  for (let i = 0; i < 180; i += 1) {
    const st = await cdp.eval(`(function(){ try { const s = ${svc}.binding('${id}').session; const c = s.snapshotCache; const nodes = (c?.chat?.legacy?.nodes ?? []).filter(function(n){return n && n.visibility === 'visible'}); return { last: nodes[nodes.length - 1]?.kind ?? null, partial: c?.chat?.legacy?.partial ?? null } } catch(e) { return { throw: String(e) } } })()`)
    if (st.last === 'assistant-step' && st.partial === null) break
    await sleep(1000)
  }
  await sleep(2000)
  report.dotGone = await cdp.eval(`(function(){ return document.querySelector('.evo-tl-running') === null })()`)

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
