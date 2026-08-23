/**
 * 临时：对 .evo-composer-preview 元素做 clip 截图（验证完整 markdown 预览）。
 * 用法：node scripts/cdp-clip.mjs <url> <selector> <out>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const url = process.argv[2]
const selector = process.argv[3]
const out = process.argv[4]
const debugPort = 37000 + Math.floor(Math.random() * 1000)
const userData = join(ROOT, '.tmp-dev', `edge-clip-${randomBytes(4).toString('hex')}`)
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

const SAMPLE = [
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

  await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))
      ;[...document.querySelectorAll('button')].find(b => (b.title || b.textContent || '').includes('New chat'))?.click()
      await sleep(2500)
      const ta = document.querySelector('.evo-composer-textarea')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, ${JSON.stringify(SAMPLE)})
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(400)
      ;[...document.querySelectorAll('.evo-md-toggle-btn')].find(b => b.title === 'Preview')?.click()
      await sleep(800)
      return true
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })

  // 让预览显示全部内容（临时放大最大高度并截取元素）
  await cdp.send('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'no-el'; el.style.maxHeight = '900px'; el.scrollTop = 0; return el.getBoundingClientRect().toJSON() })()`,
    returnByValue: true,
  })
  await new Promise((r) => setTimeout(r, 400))
  const rect = await cdp.send('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`,
    returnByValue: true,
  })
  const r = rect.result?.value
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 } })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log('saved', out, r.width, 'x', r.height)
  cdp.close()
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
