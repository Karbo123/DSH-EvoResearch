/**
 * 本轮验证（§22.3-22.4 / §23.6 / §26.3 子集）：
 * 1) 忙时消息队列：编辑 / 删除 / 清空（session.updateQueue）；
 * 2) Recents 重命名（session.rename）+ fork 子会话不进 Recents；
 * 3) Side Chat：Inherit（fork）/ Blank 创建，Inspector Side chats 页列出并可打开。
 * 用法：node scripts/verify-round5.mjs <url>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const url = process.argv[2]
const debugPort = 41000 + Math.floor(Math.random() * 1000)
const userData = join(ROOT, '.tmp-dev', `edge-r5-${randomBytes(4).toString('hex')}`)
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

  // 1) 新建会话 + 连发 3 条 → 忙时队列
  let res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      ;[...document.querySelectorAll('button')].find(b => (b.title || b.textContent || '').includes('New chat'))?.click()
      await sleep(2500)
      const ta = document.querySelector('.evo-composer-textarea')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      const send = () => { ;[...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Send'))?.click() }
      for (const text of ['queue item alpha', 'queue item beta', 'queue item gamma']) {
        setter.call(ta, text)
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        await sleep(250)
        send()
        await sleep(700)
      }
      // 等队列按钮出现（至少 1 条排队）
      const t0 = Date.now()
      while (Date.now() - t0 < 15000) {
        const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Queued messages')
        if (btn && (btn.textContent || '').includes('3')) break
        if (btn && [...document.querySelectorAll('.evo-queue-count')].length > 0) break
        await sleep(500)
      }
      const queueCount = document.querySelector('.evo-queue-count')?.textContent ?? null
      // 打开队列弹层
      ;[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Queued messages')?.click()
      await sleep(600)
      const rows = [...document.querySelectorAll('.evo-queue-row')].map(r => r.querySelector('.evo-queue-text')?.textContent ?? '')
      return { queueCount, rows }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) console.error('[step1]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  out.queue = res.result?.value

  // 截图（队列弹层）
  await new Promise((r) => setTimeout(r, 300))
  let shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(ROOT, '.tmp-dev', 'round5-queue.png'), Buffer.from(shot.data, 'base64'))

  // 2) 队列编辑/删除/清空
  res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const rows = () => [...document.querySelectorAll('.evo-queue-row')]
      // 编辑第一条
      const first = rows()[0]
      first?.querySelector('button[aria-label="编辑"]')?.click()
      await sleep(400)
      const input = document.querySelector('.evo-queue-input')
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, 'queue item alpha EDITED')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      }
      await sleep(800)
      const afterEdit = rows().map(r => r.querySelector('.evo-queue-text')?.textContent ?? '')
      // 删除第二条
      const second = rows().find(r => (r.querySelector('.evo-queue-text')?.textContent || '').includes('beta'))
      second?.querySelector('button[aria-label="移除"]')?.click()
      await sleep(800)
      const afterRemove = rows().map(r => r.querySelector('.evo-queue-text')?.textContent ?? '')
      // 清空
      ;[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Clear queue')?.click()
      await sleep(900)
      const afterClear = rows().length
      const popoverGone = !document.querySelector('.evo-queue')
      return { afterEdit, afterRemove, afterClear, popoverGone }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) console.error('[step2]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  out.queueOps = res.result?.value

  // 3) Recents 重命名 + fork 不进 Recents
  res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const rows = [...document.querySelectorAll('.evo-tl-row')]
      const firstRow = rows.find(r => r.querySelector('.evo-tl-row-title'))
      if (!firstRow) return { error: 'no rows' }
      const beforeTitle = firstRow.querySelector('.evo-tl-row-title')?.textContent
      // 重命名
      firstRow.querySelector('button[aria-label="重命名"]')?.click()
      await sleep(400)
      const input = document.querySelector('.evo-tl-rename-input')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'My Research Project')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await sleep(1200)
      const afterTitle = [...document.querySelectorAll('.evo-tl-row-title')].map(x => x.textContent).find(x => x === 'My Research Project') ?? null
      // 等待源会话本轮完成（fork 官方要求存在已完成轮次）
      const t0 = Date.now()
      while (Date.now() - t0 < 150000) {
        const settled = [...document.querySelectorAll('.evo-msg-bubble-assistant')].some(b => b.querySelector('.evo-msg-copy') !== null)
        if (settled) break
        await sleep(3000)
      }
      // fork 侧聊（重命名后重新查询行，避免操作已卸载的旧节点）
      const renamedRow = [...document.querySelectorAll('.evo-tl-row')].find(r => r.querySelector('.evo-tl-row-title')?.textContent === 'My Research Project')
      renamedRow?.querySelector('button[aria-label="由此会话创建侧边对话"]')?.click()
      await sleep(2500)
      const forkError = document.querySelector('.evo-tl-fork-error')?.textContent ?? null
      const recentTitles = [...document.querySelectorAll('.evo-tl-row-title')].map(x => x.textContent)
      // 打开 inspector Side chats 页
      ;[...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Show workspace') || (b.title || '').includes('Show workspace'))?.click()
      await sleep(600)
      ;[...document.querySelectorAll('.evo-insp-tab')].find(b => (b.textContent || '').includes('侧边对话'))?.click()
      await sleep(800)
      const sideTabs = [...document.querySelectorAll('.evo-sidechat-tab-main')].map(b => b.textContent)
      const sideCount = sideTabs.length
      return { beforeTitle, afterTitle, recentCount: recentTitles.length, recentTitles, sideTabs, sideCount, forkError }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) console.error('[step3]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  out.recents = res.result?.value

  // 截图（Side chats 页）
  await new Promise((r) => setTimeout(r, 300))
  shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(ROOT, '.tmp-dev', 'round5-sidechats.png'), Buffer.from(shot.data, 'base64'))

  // 4) Blank side chat 创建
  res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const blankBtn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('空白'))
      blankBtn?.click()
      await sleep(2500)
      const sideTabs = [...document.querySelectorAll('.evo-sidechat-tab-main')].map(b => b.textContent)
      return { sideTabs }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) console.error('[step4]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  out.blankSide = res.result?.value

  console.log(JSON.stringify(out, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
