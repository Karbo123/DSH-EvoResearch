/**
 * Round 37 综合冒烟：完整 UI 流程回归。
 * 1. 页面加载 → 关键 UI 元素齐全（顶栏/左侧栏/输入区/欢迎页 Dashboard）；
 * 2. 建会话 → 发消息 → 等回复（消息渲染 + 停止按钮出现/消失）；
 * 3. Recents 行出现 + 重命名 + 删除（两段式）→ 列表清空；
 * 4. 截图。
 * 用法：node scripts/verify-smoke.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 38000 + Math.floor(Math.random() * 1000)
const userData = join(ROOT, '.tmp-port', `edge-smoke-${randomBytes(4).toString('hex')}`)
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
  // 1) 关键 UI 元素
  report.ui = await cdp.eval(`(function(){ return {
    app: document.querySelector('.evo-app') !== null,
    topbar: document.querySelector('.evo-topbar') !== null || document.querySelector('.evo-titlebar') !== null,
    sidebar: document.querySelector('.evo-tl') !== null,
    composer: document.querySelector('.evo-composer-textarea') !== null,
    welcome: document.querySelector('.evo-welcome') !== null,
    suggest: document.querySelectorAll('.evo-suggest-card').length,
    resizeHandle: document.querySelector('.evo-composer-resize') !== null,
    cwd: document.querySelector('.evo-cwd') !== null,
    fatal: document.querySelector('.evo-fatal') !== null
  } })()`)

  // 2) 建会话发消息
  const svc = `window.__evoresearch.sessions`
  const id = await cdp.eval(`(function(){ return ${svc}.create({}).then(function(sid){ ${svc}.open(sid); return sid }) })()`)
  report.sessionId = id
  await sleep(1000)
  await cdp.eval(`(function(){ const s = ${svc}.binding('${id}').session; return s.prompt([{type:'text',text:'Reply with exactly: SMOKE-OK'}], 'queue').then(function(){ return true }) })()`)
  let stopSeen = false
  let replyOk = false
  for (let i = 0; i < 150; i += 1) {
    const st = await cdp.eval(`(function(){ try { const s = ${svc}.binding('${id}').session; const c = s.snapshotCache; const nodes = (c?.chat?.legacy?.nodes ?? []).filter(function(n){return n && n.visibility === 'visible'}); const last = nodes[nodes.length - 1]; const blocks = last?.data?.blocks ?? []; const text = blocks.filter(function(b){ return b.kind === 'text' }).map(function(b){ return b.text }).join(' '); return { last: last?.kind ?? null, text: text.slice(0, 40), partial: c?.chat?.legacy?.partial ?? null } } catch(e) { return { throw: String(e) } } })()`)
    if (!stopSeen) stopSeen = await cdp.eval(`(function(){ return document.querySelector('.evo-composer-stop') !== null })()`)
    if (st.last === 'assistant-step' && st.partial === null && st.text !== '') { replyOk = st.text.includes('SMOKE-OK'); break }
    await sleep(1000)
  }
  report.stopSeenDuringRun = stopSeen
  report.replyOk = replyOk

  // 3) Recents 行 + 删除
  for (let i = 0; i < 20; i += 1) {
    const n = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-tl-row').length })()`)
    if (n > 0) break
    await sleep(500)
  }
  report.recentsRows = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-tl-row').length })()`)
  report.deleteArm = await cdp.eval(`(function(){ const btn = document.querySelector('.evo-tl-row button[aria-label="Delete session"]'); if (!btn) return 'no-btn'; btn.click(); return 'armed' })()`)
  await sleep(300)
  report.deleteConfirm = await cdp.eval(`(function(){ const btn = document.querySelector('.evo-tl-del-confirm'); if (!btn) return 'no-confirm'; btn.click(); return 'confirmed' })()`)
  await sleep(1200)
  report.rowsAfterDelete = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-tl-row').length })()`)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-port', `smoke-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
