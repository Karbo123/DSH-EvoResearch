/**
 * Round 21 验证：§22.4 删除全部 Side Chat + §23.2 键盘规则（Ctrl+Enter 发送、Esc 停止）。
 * 1. 建主会话；造 2 个 blank side chat（create({cwd}) + localStorage 记录）；
 * 2. Inspector Side chats 页 → Delete all（两段式）→ 列表清空 + 记录清理；
 * 3. Ctrl+Enter 发送验证（CDP 键盘带 ctrlKey）→ 消息发出；
 * 4. 长任务运行中 Esc → 停止（running 结束）；
 * 5. 截图。
 * 用法：node scripts/verify-round21.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 49000 + Math.floor(Math.random() * 500)
const userData = join(ROOT, '.tmp-port', `edge-r21-${randomBytes(4).toString('hex')}`)
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
  const id = await cdp.eval(`(function(){ return ${svc}.create({}).then(function(id){ ${svc}.open(id); return id }) })()`)
  await sleep(1000)
  report.id = id
  // ── 1) 经 UI 创建 2 个 blank side chat（真实路径：createBlankSideChat + recordSideChat 同 key）──
  await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('.evo-topbar-group button')).find(function(b){ return b.title === '侧边对话' }); if (btn) btn.click(); return btn !== undefined })()`)
  await sleep(500)
  await cdp.eval(`(function(){ const b = Array.from(document.querySelectorAll('.evo-insp-tab')).find(function(x){ return x.textContent.includes('Side chats') || x.textContent.includes('侧边') }); if (b) b.click(); return b !== undefined })()`)
  await sleep(500)
  const newBlank = `(function(){ const btn = Array.from(document.querySelectorAll('button')).find(function(b){ return (b.title ?? '').startsWith('新建空白侧边对话') }); if (!btn) return 'no-btn'; btn.click(); return 'created' })()`
  report.scCreate1 = await cdp.eval(newBlank)
  await sleep(1000)
  report.scCreate2 = await cdp.eval(newBlank)
  await sleep(1500)
  report.sidechatRowsBefore = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-sidechat-tab').length })()`)
  report.sidechatRowsBefore = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-sidechat-tab').length })()`)
  // Delete all（两段式）
  report.deleteAllArm = await cdp.eval(`(function(){ const btn = document.querySelector('button[aria-label="删除全部侧边对话"]'); if (!btn) return 'no-btn'; btn.click(); return 'armed' })()`)
  await sleep(300)
  report.deleteAllConfirm = await cdp.eval(`(function(){ const btn = document.querySelector('.evo-del-confirm'); if (!btn) return 'no-confirm'; btn.click(); return 'confirmed' })()`)
  await sleep(1500)
  report.sidechatRowsAfter = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-sidechat-tab').length })()`)
  report.sidechatRecords = await cdp.eval(`(function(){ const out = []; for (let i = 0; i < localStorage.length; i += 1) { const k = localStorage.key(i); if (k && k.startsWith('evoresearch-sidechats:')) out.push({ key: k, ids: JSON.parse(localStorage.getItem(k) ?? '[]') }) } return out })()`)
  report.sidechatDeletedLocal = await cdp.eval(`(function(){ return JSON.parse(localStorage.getItem('evoresearch-deleted') ?? '[]') })()`)

  // 关闭 inspector，回到聊天（Blank 创建切换过 current；重新打开主会话）
  await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('.evo-icon-btn')).find(function(b){ return b.title === '隐藏检查器' || b.title === 'Show workspace' }); if (btn) btn.click(); return true })()`)
  await cdp.eval(`(function(){ ${svc}.open('${id}'); return true })()`)
  await sleep(600)

  // ── 2) Ctrl+Enter 发送 ──
  await cdp.eval(`(function(){ const ta = document.querySelector('.evo-composer-textarea'); ta.focus(); const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(ta, 'Reply with exactly: CTRL-ENTER-OK'); ta.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(300)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 2 }) // 2 = Ctrl
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 2 })
  await sleep(800)
  report.ctrlEnterSent = await cdp.eval(`(function(){ return document.querySelector('.evo-composer-textarea').value === '' })()`)
  // 等回复
  let reply = null
  for (let i = 0; i < 120; i += 1) {
    const st = await cdp.eval(`(function(){ try { const s = ${svc}.binding('${id}').session; const c = s.snapshotCache; const nodes = (c?.chat?.legacy?.nodes ?? []).filter(function(n){return n && n.visibility === 'visible'}); const last = nodes[nodes.length - 1]; const blocks = last?.data?.blocks ?? []; const text = blocks.filter(function(b){ return b.kind === 'text' }).map(function(b){ return b.text }).join(' '); return { last: last?.kind ?? null, text: text.slice(0, 80), partial: c?.chat?.legacy?.partial ?? null } } catch(e) { return { throw: String(e) } } })()`)
    if (st.last === 'assistant-step' && st.partial === null && st.text !== '') { reply = st; break }
    await sleep(1000)
  }
  report.ctrlEnterReply = reply

  // ── 3) 长任务运行中 Esc 停止 ──
  await cdp.eval(`(function(){ const s = ${svc}.binding('${id}').session; return s.prompt([{type:'text',text:'Count from 1 to 60, one number per line, with a pause of 800ms between lines.'}], 'queue').then(function(){ return true }) })()`)
  let stopBtn = false
  for (let i = 0; i < 120; i += 1) {
    stopBtn = await cdp.eval(`(function(){ return document.querySelector('.evo-composer-stop') !== null })()`)
    if (stopBtn) break
    await sleep(500)
  }
  report.stopBtnSeen = stopBtn
  // 聚焦输入框按 Esc
  await cdp.eval(`(function(){ const ta = document.querySelector('.evo-composer-textarea'); if (ta) ta.focus(); return true })()`)
  await sleep(200)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await sleep(3000)
  report.stopBtnGoneAfterEsc = await cdp.eval(`(function(){ return document.querySelector('.evo-composer-stop') === null })()`)
  const st = await cdp.eval(`(function(){ try { const s = ${svc}.binding('${id}').session; const c = s.snapshotCache; const nodes = (c?.chat?.legacy?.nodes ?? []).filter(function(n){return n && n.visibility === 'visible'}); return { nodes: nodes.length, partial: c?.chat?.legacy?.partial ?? null, err: c?.promptError?.error?.message ?? null } } catch(e) { return { throw: String(e) } } })()`)
  report.afterEsc = st

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-port', `r21-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})


