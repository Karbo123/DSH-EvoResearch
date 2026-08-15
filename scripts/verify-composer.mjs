/**
 * 输入辅助验证（移植规范 §23.2–23.5）：
 * 1) 斜杠命令候选：/mem → 弹层；方向键 + Tab 应用；
 * 2) @文件 补全：@RE → 弹层含 README.md；Tab 应用路径；
 * 3) 发送时 @引用解析：@.gitignore → 用户气泡出现内容注入块；
 * 4) 输入历史：发送后空输入 ArrowUp 恢复。
 * 用法：node scripts/verify-composer.mjs <url>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const url = process.argv[2]
const debugPort = 39000 + Math.floor(Math.random() * 1000)
const userData = join(ROOT, '.tmp-port', `edge-cmp-${randomBytes(4).toString('hex')}`)
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

  // 1) 斜杠命令候选
  let res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      ;[...document.querySelectorAll('button')].find(b => (b.title || b.textContent || '').includes('New chat'))?.click()
      await sleep(2500)
      const ta = document.querySelector('.evo-composer-textarea')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, '/mem')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(800)
      const items = [...document.querySelectorAll('.evo-cand-item')].map(i => i.textContent.trim())
      const titles = [...document.querySelectorAll('.evo-cand-title')].map(i => i.textContent)
      // Tab 应用第一个候选
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      await sleep(400)
      return { titles: titles.slice(0, 6), applied: ta.value, itemsCount: items.length }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) console.error('[step1]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  out.commands = res.result?.value

  // 截图（命令弹层）
  res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const ta = document.querySelector('.evo-composer-textarea')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, '/sch')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(800)
      return true
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  await new Promise((r) => setTimeout(r, 300))
  let shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(ROOT, '.tmp-port', 'composer-cmd.png'), Buffer.from(shot.data, 'base64'))

  // 2) @文件 补全
  res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const ta = document.querySelector('.evo-composer-textarea')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, '')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(200)
      setter.call(ta, '@RE')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(1200)
      const titles = [...document.querySelectorAll('.evo-cand-title')].map(i => i.textContent)
      const hasReadme = titles.some(x => x.includes('README.md'))
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      await sleep(400)
      return { hasReadme, titles: titles.slice(0, 5), applied: ta.value.slice(0, 80) }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) console.error('[step2]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  out.mention = res.result?.value

  // 截图（@弹层）
  res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const ta = document.querySelector('.evo-composer-textarea')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, '')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(200)
      setter.call(ta, '@')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(1200)
      return true
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  await new Promise((r) => setTimeout(r, 300))
  shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(ROOT, '.tmp-port', 'composer-at.png'), Buffer.from(shot.data, 'base64'))

  // 3) 发送 @引用解析 + 4) 输入历史
  res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const ta = document.querySelector('.evo-composer-textarea')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, '')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(200)
      setter.call(ta, '@.gitignore please review this file')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(400)
      ;[...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Send'))?.click()
      const t0 = Date.now()
      let resolved = false
      let userTextHead = ''
      while (Date.now() - t0 < 20000) {
        const texts = [...document.querySelectorAll('.evo-msg-bubble-user')].map(b => b.textContent || '')
        const hit = texts.find(x => x.includes('[@.gitignore]'))
        if (hit !== undefined) { resolved = true; userTextHead = hit.slice(0, 60); break }
        await sleep(500)
      }
      // 4) 历史：清空输入，ArrowUp 恢复
      setter.call(ta, '')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(300)
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
      await sleep(400)
      return { resolved, userTextHead, historyRestored: ta.value.includes('@.gitignore') }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) console.error('[step3]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  out.send = res.result?.value

  await new Promise((r) => setTimeout(r, 400))
  shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(ROOT, '.tmp-port', 'composer-sent.png'), Buffer.from(shot.data, 'base64'))

  console.log(JSON.stringify(out, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
