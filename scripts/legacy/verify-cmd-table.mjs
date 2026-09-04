/**
 * Round 19 验证：命令执行结果表格化（§23.3"文本或表格"）。
 * 1. UI 输入 /schedule add 造任务 → 文本结果；
 * 2. UI 输入 /schedule list → 结果条渲染 GFM 表格（.evo-cmd-output-md table）；
 * 3. UI 输入 /expert list（空）→ 无表格 → 等宽文本（pre）；
 * 4. 截图。
 * 用法：node scripts/verify-cmd-table.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 43000 + Math.floor(Math.random() * 500)
const userData = join(ROOT, '.tmp-dev', `edge-cmd-${randomBytes(4).toString('hex')}`)
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
  // 创建会话（命令需要 sessionId）
  await cdp.eval(`(function(){ return ${svc}.create({}).then(function(id){ ${svc}.open(id); return id }) })()`)
  await sleep(1000)

  /** UI 输入命令并回车（CDP 原生键盘事件）。 */
  async function runCommand(line) {
    await cdp.eval(`(function(){ const ta = document.querySelector('.evo-composer-textarea'); if (ta) ta.focus(); return ta !== null })()`)
    await sleep(200)
    await cdp.send('Input.insertText', { text: line })
    await sleep(200)
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
    // 等结果条出现
    for (let i = 0; i < 40; i += 1) {
      const exists = await cdp.eval(`(function(){ return document.querySelector('.evo-cmd-output') !== null })()`)
      if (exists) break
      await sleep(300)
    }
    await sleep(600)
  }

  // 1) /schedule add 造任务
  await runCommand('/schedule add "0 9 * * 1-5" 文献综述')
  report.addResult = await cdp.eval(`(function(){ const el = document.querySelector('.evo-cmd-output'); return el ? el.textContent : null })()`)

  // 2) /schedule list → 表格
  await runCommand('/schedule list')
  report.listTable = await cdp.eval(`(function(){ const table = document.querySelector('.evo-cmd-output-md table'); const pre = document.querySelector('.evo-cmd-output:not(.evo-cmd-output-md)'); return { hasTable: table !== null, rows: table ? table.querySelectorAll('tr').length : 0, headers: table ? Array.from(table.querySelectorAll('th')).map(function(th){ return th.textContent }) : [], isPre: pre !== null } })()`)
  report.listText = await cdp.eval(`(function(){ const el = document.querySelector('.evo-cmd-output-md, .evo-cmd-output'); return el ? el.textContent.slice(0, 160) : null })()`)

  // 3) /expert list（空）→ 无表格
  await runCommand('/expert list')
  report.expertResult = await cdp.eval(`(function(){ const table = document.querySelector('.evo-cmd-output-md table'); const pre = document.querySelector('.evo-cmd-output:not(.evo-cmd-output-md)'); return { hasTable: table !== null, isPre: pre !== null, text: (pre ?? document.querySelector('.evo-cmd-output-md'))?.textContent?.slice(0, 80) ?? null } })()`)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-dev', `cmd-table-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
