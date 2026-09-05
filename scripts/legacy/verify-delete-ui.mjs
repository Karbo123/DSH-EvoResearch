/**
 * 会话删除端到端验证（UI 级）：
 * 1. 打开页面（sidebar=1）；
 * 2. 创建会话 A/B 并发消息等完成；
 * 3. UI 点击 A 行（非当前）的删除（两段式确认）→ 断言列表消失 + localStorage 记录 + 文件删除；
 * 4. UI 删除当前会话 B → 断言自动跳到新会话；
 * 5. 截图。
 * 用法：node scripts/verify-delete-ui.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 39000 + Math.floor(Math.random() * 500)
const userData = join(ROOT, '.tmp-dev', `edge-delui-${randomBytes(4).toString('hex')}`)
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
  const state = (id) => `(function(){ try { const s = ${svc}.binding('${id}').session; const c = s.snapshotCache; const nodes = (c?.chat?.legacy?.nodes ?? []).filter(function(n){return n && n.visibility === 'visible'}); return { partial: c?.chat?.legacy?.partial ?? null, nodes: nodes.length } } catch(e) { return { throw: String(e) } } })()`
  const rows = `(function(){ return Array.from(document.querySelectorAll('.evo-tl-row')).map(function(r){ return { title: r.querySelector('.evo-tl-title-text')?.textContent ?? '', active: r.hasAttribute('data-active') } }) })()`

  async function createAndTalk(text) {
    const id = await cdp.eval(`(function(){ return ${svc}.create({}).then(function(id){ ${svc}.open(id); return id }) })()`)
    await sleep(800)
    await cdp.eval(`(function(){ const s = ${svc}.binding('${id}').session; return s.prompt([{type:'text',text:${JSON.stringify(text)}}], 'queue').then(function(){ return true }) })()`)
    for (let i = 0; i < 180; i += 1) {
      const st = await cdp.eval(state(id))
      if (st.partial === null && st.nodes >= 1) break
      await sleep(500)
    }
    return id
  }

  const idA = await createAndTalk('Reply with exactly: ALPHA-OK')
  const idB = await createAndTalk('Reply with exactly: BETA-OK')
  report.ids = { A: idA, B: idB }

  // 等待列表渲染（Recents 应含两行）
  for (let i = 0; i < 20; i += 1) {
    const r = await cdp.eval(rows)
    if (r.length >= 2) break
    await sleep(500)
  }
  report.rowsBefore = await cdp.eval(rows)

  // ── UI 删除 A（非当前会话：无 data-active 的第一行）──
  const armNonActive = `(function(){ const row = Array.from(document.querySelectorAll('.evo-tl-row')).find(function(r){ return !r.hasAttribute('data-active') }); if (!row) return 'no-row'; const btn = row.querySelector('button[aria-label="删除会话"]'); if (!btn) return 'no-trash'; btn.click(); return 'armed' })()`
  report.stepArmA = await cdp.eval(armNonActive)
  await sleep(300)
  report.stepConfirmA = await cdp.eval(`(function(){ const btn = document.querySelector('.evo-tl-row .evo-tl-del-confirm'); if (!btn) return 'no-confirm'; btn.click(); return 'confirmed' })()`)
  await sleep(1200)
  report.rowsAfterDeleteA = await cdp.eval(rows)
  report.deletedLocalAfterA = await cdp.eval(`(function(){ return JSON.parse(localStorage.getItem('evoresearch-deleted') ?? '[]') })()`)
  report.infoA = await cdp.eval(`(function(){ return fetch('/evoresearch/fs/session-info', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ sessionId: '${idA}' }) }).then(function(r){ return r.json() }) })()`)

  // ── UI 删除当前会话 B（data-active 行）→ 应跳到新会话 ──
  const armActive = `(function(){ const row = document.querySelector('.evo-tl-row[data-active]'); if (!row) return 'no-row'; const btn = row.querySelector('button[aria-label="删除会话"]'); if (!btn) return 'no-trash'; btn.click(); return 'armed' })()`
  report.stepArmB = await cdp.eval(armActive)
  await sleep(300)
  report.stepConfirmB = await cdp.eval(`(function(){ const btn = document.querySelector('.evo-tl-row .evo-tl-del-confirm'); if (!btn) return 'no-confirm'; btn.click(); return 'confirmed' })()`)
  await sleep(1500)
  report.rowsAfterDeleteB = await cdp.eval(rows)
  report.deletedLocalAfterB = await cdp.eval(`(function(){ return JSON.parse(localStorage.getItem('evoresearch-deleted') ?? '[]') })()`)
  report.infoB = await cdp.eval(`(function(){ return fetch('/evoresearch/fs/session-info', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ sessionId: '${idB}' }) }).then(function(r){ return r.json() }) })()`)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-dev', `delete-ui-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
