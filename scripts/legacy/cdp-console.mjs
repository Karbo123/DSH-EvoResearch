/**
 * 临时诊断：加载页面并收集 console / exception 事件（用于定位客户端崩溃）。
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const url = process.argv[2]
const debugPort = 34000 + Math.floor(Math.random() * 1000)
const userData = join(ROOT, '.tmp-dev', `edge-dbg-${randomBytes(4).toString('hex')}`)
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
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails
    console.log('[exception]', d.text, '|', d.exception?.description?.slice(0, 600) ?? '')
  })
  cdp.on('Runtime.consoleAPICalled', (p) => {
    const args = (p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')
    console.log(`[console.${p.type}]`, args.slice(0, 500))
  })
  cdp.on('Log.entryAdded', (p) => {
    console.log('[log]', p.entry.level, p.entry.text.slice(0, 500))
  })
  await cdp.send('Log.enable')
  await cdp.send('Page.navigate', { url })
  await new Promise((r) => setTimeout(r, 12000))
  const res = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({ app: !!document.querySelector('.evo-app'), bodyText: document.body ? document.body.innerText.slice(0, 200) : null })`,
    returnByValue: true,
  })
  console.log('[state]', JSON.stringify(res.result?.value))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
