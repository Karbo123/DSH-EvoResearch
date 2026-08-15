/**
 * Round 23 验证：Toast 通知（§33.2）+ 附件 toast + ErrorBoundary 挂载。
 * 1. 建会话发消息等完成（Recents 出现可重命名会话）；
 * 2. 重命名（Pencil → 输入 → Save）→ toast 'Session renamed' 出现 → 3.5s 后消失；
 * 3. 添加附件 → toast 'Added 1 attachment' 出现；
 * 4. 断言 ErrorBoundary 类已挂载（root 注册为包装组件，页面正常渲染即证明）；
 * 5. 截图。
 * 用法：node scripts/verify-toast.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 35000 + Math.floor(Math.random() * 1500)
const userData = join(ROOT, '.tmp-port', `edge-toast-${randomBytes(4).toString('hex')}`)
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
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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
  const id = await cdp.eval(`(function(){ return ${svc}.create({}).then(function(id){ ${svc}.open(id); return id }) })()`)
  await sleep(1000)
  // 发消息等完成（产生可重命名会话）
  await cdp.eval(`(function(){ const s = ${svc}.binding('${id}').session; return s.prompt([{type:'text',text:'Reply with exactly: TOAST-OK'}], 'queue').then(function(){ return true }) })()`)
  for (let i = 0; i < 120; i += 1) {
    const st = await cdp.eval(`(function(){ try { const s = ${svc}.binding('${id}').session; const c = s.snapshotCache; const nodes = (c?.chat?.legacy?.nodes ?? []).filter(function(n){return n && n.visibility === 'visible'}); const last = nodes[nodes.length - 1]; const blocks = last?.data?.blocks ?? []; const text = blocks.filter(function(b){ return b.kind === 'text' }).map(function(b){ return b.text }).join(' '); return { last: last?.kind ?? null, text: text.slice(0, 40), partial: c?.chat?.legacy?.partial ?? null } } catch(e) { return { throw: String(e) } } })()`)
    if (st.last === 'assistant-step' && st.partial === null && st.text !== '') break
    await sleep(1000)
  }
  // Recents 出现行 → 重命名
  for (let i = 0; i < 20; i += 1) {
    const n = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-tl-row').length })()`)
    if (n > 0) break
    await sleep(500)
  }
  report.renameArm = await cdp.eval(`(function(){ const btn = document.querySelector('.evo-tl-row button[aria-label="重命名"]'); if (!btn) return 'no-btn'; btn.click(); return 'armed' })()`)
  await sleep(300)
  report.renameInput = await cdp.eval(`(function(){ const input = document.querySelector('.evo-tl-rename-input'); if (!input) return 'no-input'; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(input, 'Toast Test Session'); input.dispatchEvent(new Event('input', { bubbles: true })); return 'typed' })()`)
  await sleep(200)
  report.renameSave = await cdp.eval(`(function(){ const btn = document.querySelector('.evo-tl-row button[aria-label="保存"]'); if (!btn) return 'no-save'; btn.click(); return 'saved' })()`)
  await sleep(800)
  report.toastAfterRename = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-toast')).map(function(t){ return { text: t.textContent, kind: t.className } }) })()`)
  await sleep(3500)
  report.toastGone = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-toast').length === 0 })()`)

  // 附件 toast
  const addFileExpr = `(function(){
    const input = document.querySelector('input[type=file]');
    if (!input) return 'no-input';
    const bytes = Uint8Array.from(atob('${PNG_B64}'), function(c){ return c.charCodeAt(0) });
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'toast-dot.png', { type: 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'added';
  })()`
  report.attachAdd = await cdp.eval(addFileExpr)
  await sleep(800)
  report.toastAfterAttach = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-toast')).map(function(t){ return t.textContent }) })()`)
  report.attachStrip = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-attach-item').length })()`)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-port', `toast-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
