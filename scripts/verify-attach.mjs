/**
 * Round 20 验证：附件（§23.7）。
 * 1. 建会话；CDP 构造 File（1x1 PNG）→ input[type=file] change 事件 → 附件条出现（缩略图）；
 * 2. 再添加一个文件验证计数/超限提示；移除一个附件；
 * 3. 输入文本 + Enter 发送（带图片块）→ 模型回复（应提到/接受图片）；
 * 4. 截图。
 * 用法：node scripts/verify-attach.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 48000 + Math.floor(Math.random() * 500)
const userData = join(ROOT, '.tmp-port', `edge-att-${randomBytes(4).toString('hex')}`)
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
// 1x1 红色 PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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
  // 等会话服务就绪
  for (let i = 0; i < 40; i += 1) {
    const ready = await cdp.eval(`(function(){ return !!window.__evoresearch?.sessions })()`).catch(() => false)
    if (ready) break
    await sleep(500)
  }

  const report = {}
  const svc = `window.__evoresearch.sessions`
  const id = await cdp.eval(`(function(){ return ${svc}.create({}).then(function(id){ ${svc}.open(id); return id }) })()`)
  await sleep(1000)
  report.id = id

  // 1) 添加图片附件（模拟文件选择）
  const addFileExpr = `(function(){
    const input = document.querySelector('input[type=file]');
    if (!input) return 'no-input';
    const bytes = Uint8Array.from(atob('${PNG_B64}'), function(c){ return c.charCodeAt(0) });
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'red-dot.png', { type: 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'added';
  })()`
  report.add1 = await cdp.eval(addFileExpr)
  await sleep(1200)
  report.attachItems1 = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-attach-item')).map(function(n){ return { name: n.querySelector('.evo-attach-name')?.textContent, hasThumb: n.querySelector('img.evo-attach-thumb') !== null } }) })()`)
  report.paperclipOn = await cdp.eval(`(function(){ const b = Array.from(document.querySelectorAll('.evo-composer-tool')).find(function(x){ return x.querySelector('svg') !== null && x.title.includes('Attach') }); return b ? b.hasAttribute('data-on') : null })()`)

  // 2) 第二个附件 + 移除
  const addFile2Expr = `(function(){
    const input = document.querySelector('input[type=file]');
    const bytes = Uint8Array.from(atob('${PNG_B64}'), function(c){ return c.charCodeAt(0) });
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'blue-dot.png', { type: 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'added2';
  })()`
  report.add2 = await cdp.eval(addFile2Expr)
  await sleep(1200)
  report.attachCount2 = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-attach-item').length })()`)
  report.remove1 = await cdp.eval(`(function(){ const btn = document.querySelector('.evo-attach-remove'); if (!btn) return 'no-remove'; btn.click(); return 'removed' })()`)
  await sleep(600)
  report.attachCountAfterRemove = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-attach-item').length })()`)

  // 3) 发送（文本 + 图片块）
  await cdp.eval(`(function(){ const ta = document.querySelector('.evo-composer-textarea'); ta.focus(); const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(ta, 'What color is the image I attached? Reply briefly.'); ta.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(300)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  report.attachClearedAfterSend = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-attach-item').length === 0 })()`)

  // 等模型回复
  let reply = null
  for (let i = 0; i < 120; i += 1) {
    const st = await cdp.eval(`(function(){ try { const s = ${svc}.binding('${id}').session; const c = s.snapshotCache; const nodes = (c?.chat?.legacy?.nodes ?? []).filter(function(n){return n && n.visibility === 'visible'}); const last = nodes[nodes.length - 1]; const blocks = last?.data?.blocks ?? []; const text = blocks.filter(function(b){ return b.kind === 'text' }).map(function(b){ return b.text }).join(' '); const err = c?.promptError?.error?.message ?? null; return { last: last?.kind ?? null, text: text.slice(0, 200), partial: c?.chat?.legacy?.partial ?? null, err: err } } catch(e) { return { throw: String(e) } } })()`)
    if (st.last === 'assistant-step' && st.partial === null && st.text !== '') { reply = st; break }
    if (st.err !== null) { reply = st; break }
    await sleep(1000)
  }
  report.reply = reply

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-port', `attach-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
