/**
 * Markdown 功能验证：预览渲染 + 消息渲染端到端。
 * 用法：node scripts/verify-md.mjs <url>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const url = process.argv[2]
const debugPort = 36000 + Math.floor(Math.random() * 1000)
const userData = join(ROOT, '.tmp-port', `edge-md-${randomBytes(4).toString('hex')}`)
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

const MARKDOWN_SAMPLE = [
  '# Markdown Test',
  '',
  'A paragraph with **bold**, *italic*, `inline code` and a [link](https://example.com).',
  '',
  '| Metric | Value |',
  '| --- | --- |',
  '| Accuracy | 0.92 |',
  '| F1 | 0.88 |',
  '',
  '```python',
  'def hello(name):',
  '    return f"hi {name}"',
  '```',
  '',
  'Inline math $E = mc^2$ and display:',
  '',
  '$$',
  '\\int_0^1 x^2 \\, dx = \\frac{1}{3}',
  '$$',
  '',
  '- [x] done item',
  '- [ ] pending item',
  '',
  '> a blockquote',
].join('\n')

async function main() {
  const cdp = await Cdp.connect(debugPort)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url })
  await new Promise((r) => setTimeout(r, 6000))

  const out = {}

  // 1) 新建会话 + 预览渲染
  let res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const newBtn = [...document.querySelectorAll('button')].find(b => (b.title || b.textContent || '').includes('New chat'))
      newBtn?.click()
      await sleep(2500)
      const ta = document.querySelector('.evo-composer-textarea')
      if (!ta) return { error: 'no textarea' }
      const md = ${JSON.stringify(MARKDOWN_SAMPLE)}
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, md)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(400)
      const btn = [...document.querySelectorAll('.evo-md-toggle-btn')].find(b => b.title === 'Preview')
      btn?.click()
      await sleep(800)
      const pv = document.querySelector('.evo-composer-preview')
      if (!pv) return { error: 'no preview' }
      const html = pv.innerHTML
      return {
        table: html.includes('<table>'),
        hljs: html.includes('hljs'),
        katexInline: html.includes('katex') && html.includes('katex-display') === false,
        katexDisplay: html.includes('katex-display'),
        task: html.includes('task-list-item'),
        h1: html.includes('<h1>'),
        blockquote: html.includes('blockquote'),
        strong: html.includes('<strong>'),
        link: html.includes('<a href'),
      }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) console.error('[step1 exception]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  out.preview = res.result?.value

  // 预览截图
  await new Promise((r) => setTimeout(r, 400))
  const shot1 = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(ROOT, '.tmp-port', 'md-preview.png'), Buffer.from(shot1.data, 'base64'))

  // 2) 切回 Write 并发送
  res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const writeBtn = [...document.querySelectorAll('.evo-md-toggle-btn')].find(b => b.title === 'Write')
      writeBtn?.click()
      await sleep(300)
      const sendBtn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('Send'))
      sendBtn?.click()
      return { sent: !!sendBtn }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  out.sent = res.result?.value

  // 3) 轮询助手回复中的 markdown 渲染
  res = await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      const t0 = Date.now()
      while (Date.now() - t0 < 150000) {
        const bubbles = [...document.querySelectorAll('.evo-msg-bubble-assistant')]
        const last = bubbles[bubbles.length - 1]
        if (last) {
          const html = last.innerHTML
          if (html.includes('<table>') || html.includes('<pre') || html.includes('<strong>')) {
            const mdEl = last.querySelector('.evo-md')
            return {
              tables: last.querySelectorAll('table').length,
              pre: last.querySelectorAll('pre').length,
              code: last.querySelectorAll('code').length,
              strong: last.querySelectorAll('strong').length,
              katex: last.querySelectorAll('.katex').length,
              copyBtn: last.querySelectorAll('.evo-msg-copy').length,
              settled: !last.closest('.evo-msg-bubble-assistant')?.querySelector('.evo-msg-cursor'),
            }
          }
        }
        await sleep(3000)
      }
      return { timeout: true }
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.exceptionDetails) console.error('[step3 exception]', res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  out.reply = res.result?.value

  await new Promise((r) => setTimeout(r, 500))
  const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(ROOT, '.tmp-port', 'md-message.png'), Buffer.from(shot2.data, 'base64'))

  console.log(JSON.stringify(out, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
