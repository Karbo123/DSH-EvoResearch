/**
 * 会话动作验证（移植规范 §25.6 / §26.8）：
 * Current 弹窗字段、Clear view、Search（DOM + 跳转高亮）、Shortcuts、Compact 确认。
 * 用法：node scripts/verify-actions.mjs <url>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const url = process.argv[2]
const debugPort = 40000 + Math.floor(Math.random() * 1000)
const userData = join(ROOT, '.tmp-port', `edge-act-${randomBytes(4).toString('hex')}`)
mkdirSync(dirname(userData), { recursive: true })

const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`, '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = new Map() }
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
    } else if (msg.method) {
      const list = this.events.get(msg.method) ?? []
      for (const fn of list) fn(msg.params)
    }
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  close() { this.ws.close() }
}

async function main() {
  const cdp = await Cdp.connect(debugPort)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url })
  await new Promise((r) => setTimeout(r, 6000))

  const out = {}

  // 0) 新建会话并发送一条消息
  let res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      ;[...document.querySelectorAll('button')].find(b => (b.title || b.textContent || '').includes('New chat'))?.click()
      await sleep(2500)
      const ta = document.querySelector('.evo-composer-textarea')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, 'Hello EvoResearch, summarize the research workflow in one sentence.')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(300)
      ;[...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Send'))?.click()
      const t0 = Date.now()
      while (Date.now() - t0 < 120000) {
        const done = [...document.querySelectorAll('.evo-msg-bubble-assistant')].some(b => b.querySelector('.evo-msg-copy') !== null)
        if (done) break
        await sleep(3000)
      }
      return { assistants: document.querySelectorAll('.evo-msg-bubble-assistant').length }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) console.error('[step0]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  out.prepare = res.result?.value

  // 1) Current 弹窗
  res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      ;[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Current session')?.click()
      await sleep(1500)
      const rows = [...document.querySelectorAll('.evo-info-row')].map(r => ({
        label: r.querySelector('.evo-info-label')?.textContent,
        value: (r.querySelector('.evo-info-value')?.textContent || '').slice(0, 90),
      }))
      return { rows }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) console.error('[step1]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  out.current = res.result?.value

  // 截图（Current 弹窗）
  await new Promise((r) => setTimeout(r, 300))
  let shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(ROOT, '.tmp-port', 'actions-current.png'), Buffer.from(shot.data, 'base64'))

  // 2) Clear view + Restore
  res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      ;[...document.querySelectorAll('.evo-info-actions button')].find(b => (b.textContent || '').includes('Clear view'))?.click()
      await sleep(600)
      const notice = !!document.querySelector('.evo-clear-notice')
      const msgGone = document.querySelectorAll('.evo-msg-bubble').length === 0
      ;[...document.querySelectorAll('.evo-clear-notice button')].find(b => (b.textContent || '').includes('Restore'))?.click()
      await sleep(600)
      const restored = document.querySelectorAll('.evo-msg-bubble').length > 0
      return { notice, msgGone, restored }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) console.error('[step2]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  out.clearView = res.result?.value

  // 3) Search：DOM 命中 + 跳转高亮
  res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      ;[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Search')?.click()
      await sleep(500)
      const input = document.querySelector('.evo-search-input')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'research')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(600)
      const hits = [...document.querySelectorAll('.evo-search-hit')].map(h => h.textContent.slice(0, 60))
      const hitCount = hits.length
      document.querySelector('.evo-search-hit')?.click()
      await sleep(800)
      const highlighted = !!document.querySelector('.evo-msg-jump')
      const dialogClosed = !document.querySelector('.evo-modal')
      return { hitCount, hits: hits.slice(0, 3), highlighted, dialogClosed }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) console.error('[step3]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  out.search = res.result?.value

  // 截图（搜索后高亮）
  await new Promise((r) => setTimeout(r, 300))
  shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(ROOT, '.tmp-port', 'actions-search.png'), Buffer.from(shot.data, 'base64'))

  // 4) Shortcuts + Compact 确认弹窗
  res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      ;[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Keyboard shortcuts')?.click()
      await sleep(600)
      const kbdRows = [...document.querySelectorAll('.evo-shortcut-row')].map(r => r.querySelector('.evo-kbd')?.textContent)
      ;[...document.querySelectorAll('.evo-modal-head button')].find(b => b.title === '关闭')?.click()
      await sleep(300)
      ;[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Compact')?.click()
      await sleep(600)
      const compactDialog = !!document.querySelector('.evo-confirm')
      ;[...document.querySelectorAll('.evo-confirm-actions button')].find(b => b.textContent === '取消')?.click()
      await sleep(300)
      return { kbdRows, compactDialog, closed: !document.querySelector('.evo-modal') }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) console.error('[step4]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  out.shortcuts = res.result?.value

  console.log(JSON.stringify(out, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})

