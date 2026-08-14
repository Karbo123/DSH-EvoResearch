/**
 * 历史分页与滚动锚定验证（移植规范 §9）：
 * 1) 发送 4 条消息（?pageSize=3 调试钩子）→ 只渲染最近一页 + Load earlier；
 * 2) 点击 Load earlier → 窗口扩展、滚动位置锚定、按钮上移；
 * 3) 上滚 → 出现"回到最新"按钮；点击 → 滚到底并释放旧页。
 * 用法：node scripts/verify-paging.mjs <url>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const url = process.argv[2]
const debugPort = 38000 + Math.floor(Math.random() * 1000)
const userData = join(ROOT, '.tmp-port', `edge-page-${randomBytes(4).toString('hex')}`)
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
  on(method, fn) { const list = this.events.get(method) ?? []; list.push(fn); this.events.set(method, list) }
  close() { this.ws.close() }
}

async function main() {
  const cdp = await Cdp.connect(debugPort)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url })
  await new Promise((r) => setTimeout(r, 6000))

  const out = {}

  // 1) 新建会话 + 连发 4 条消息
  let res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      ;[...document.querySelectorAll('button')].find(b => (b.title || b.textContent || '').includes('New chat'))?.click()
      await sleep(2500)
      const ta = document.querySelector('.evo-composer-textarea')
      if (!ta) return { error: 'no textarea' }
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      const send = () => { ;[...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Send'))?.click() }
      for (const text of ['message one', 'message two', 'message three', 'message four']) {
        setter.call(ta, text)
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        await sleep(300)
        send()
        await sleep(900)
      }
      // 等待 4 条用户气泡全部出现
      const t0 = Date.now()
      while (Date.now() - t0 < 30000) {
        const users = document.querySelectorAll('.evo-msg-bubble-user').length
        if (users >= 4) break
        await sleep(500)
      }
      const list = document.querySelector('.evo-msg-list')
      const bubbles = list ? list.querySelectorAll('.evo-msg-bubble').length : 0
      return {
        users: document.querySelectorAll('.evo-msg-bubble-user').length,
        bubbles,
        loadEarlier: !!list?.querySelector('.evo-load-earlier'),
        jumpHidden: !list?.querySelector('.evo-jump-latest'),
        scrollTop: list?.scrollTop,
        scrollHeight: list?.scrollHeight,
        clientHeight: list?.clientHeight,
      }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) console.error('[step1]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  out.step1 = res.result?.value

  // 2) 点击 Load earlier → 窗口扩展 + 锚定
  res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const list = document.querySelector('.evo-msg-list')
      const before = { scrollTop: list.scrollTop, scrollHeight: list.scrollHeight, first: list.querySelector('.evo-msg-bubble')?.textContent?.slice(0, 30) }
      list.querySelector('.evo-load-earlier')?.click()
      await sleep(600)
      const after = { scrollTop: list.scrollTop, scrollHeight: list.scrollHeight, first: list.querySelector('.evo-msg-bubble')?.textContent?.slice(0, 30) }
      return {
        bubblesAfter: list.querySelectorAll('.evo-msg-bubble').length,
        loadStillThere: !!list.querySelector('.evo-load-earlier'),
        anchorKept: Math.abs((before.scrollTop + (after.scrollHeight - before.scrollHeight)) - after.scrollTop) < 2,
        firstChanged: before.first !== after.first,
        firstNow: after.first,
      }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) console.error('[step2]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  out.step2 = res.result?.value

  // 3) 上滚 → 回到最新按钮；点击 → 回底并释放旧页
  res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const list = document.querySelector('.evo-msg-list')
      list.scrollTop = Math.max(0, list.scrollHeight / 2)
      list.dispatchEvent(new Event('scroll', { bubbles: true }))
      await sleep(400)
      const jumpShown = !!list.querySelector('.evo-jump-latest')
      list.querySelector('.evo-jump-latest')?.click()
      await sleep(600)
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= 1
      return {
        jumpShown,
        jumpGone: !list.querySelector('.evo-jump-latest'),
        nearBottom,
        bubblesAfterJump: list.querySelectorAll('.evo-msg-bubble').length,
        loadEarlierBack: !!list.querySelector('.evo-load-earlier'),
      }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) console.error('[step3]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  out.step3 = res.result?.value

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(ROOT, '.tmp-port', 'paging.png'), Buffer.from(shot.data, 'base64'))

  console.log(JSON.stringify(out, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
