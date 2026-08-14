/**
 * CDP 截图工具：headless Edge + DevTools Protocol。
 *
 * 用途：
 * - 对任意 URL 截图（页面加载后 captureScreenshot）；
 * - 可在导航前注入脚本（Page.addScriptToEvaluateOnNewDocument），
 *   例如写入 localStorage 配置，让 WebUI 直接进入已配置界面；
 * - 配合 scripts/vision.mjs 做视觉一致性检查。
 *
 * 用法：node scripts/webui-shot.mjs --url <url> --out <png>
 *   --script <js>        导航前注入的脚本（可多次）
 *   --width 1440 --height 900
 *   --wait-ms 6000       加载事件后额外等待（渲染/流式动画）
 *   --debug-port 9333    Edge 调试端口（默认随机）
 *   --edge <path>        Edge 可执行文件
 *   --no-sandbox-user-data 默认使用独立 user-data-dir（每次干净会话）
 */
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
function flag(name) {
  return process.argv.includes(`--${name}`)
}

const url = arg('url', '')
const out = arg('out', join(ROOT, '.tmp-port', 'shot.png'))
const scripts = []
for (let i = 0; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--script') scripts.push(process.argv[i + 1])
}
const evals = []
for (let i = 0; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--eval') evals.push(process.argv[i + 1])
}
const width = Number(arg('width', '1440'))
const height = Number(arg('height', '900'))
const waitMs = Number(arg('wait-ms', '6000'))
const debugPort = Number(arg('debug-port', String(30000 + Math.floor(Math.random() * 20000))))
const edgePath = arg('edge', '') || (await findEdge())

if (!url) {
  console.error('[webui-shot] 缺少 --url')
  process.exit(1)
}

async function findEdge() {
  for (const p of [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ]) {
    const { existsSync } = await import('node:fs')
    if (existsSync(p)) return p
  }
  throw new Error('找不到 Edge')
}

const userData = join(ROOT, '.tmp-port', `edge-cdp-${randomBytes(4).toString('hex')}`)
mkdirSync(dirname(userData), { recursive: true })

const edge = spawn(edgePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userData}`,
  `--window-size=${width},${height}`,
  'about:blank',
], { stdio: 'ignore' })

/** 简单 CDP 客户端（Node 24 全局 WebSocket）。 */
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
      } catch {
        await new Promise((r) => setTimeout(r, 500))
      }
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
  on(method, fn) {
    const list = this.events.get(method) ?? []
    list.push(fn)
    this.events.set(method, list)
  }
  close() { this.ws.close() }
}

async function main() {
  const cdp = await Cdp.connect(debugPort)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  for (const js of scripts) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: js })
  }
  const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve))
  await cdp.send('Page.navigate', { url })
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 30000))])
  await new Promise((r) => setTimeout(r, waitMs))
  for (const js of evals) {
    const res = await cdp.send('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true })
    if (res.result?.value !== undefined) console.log(`[webui-shot] eval →`, JSON.stringify(res.result.value).slice(0, 200))
    if (res.exceptionDetails) console.error('[webui-shot] eval 异常:', res.exceptionDetails.text)
  }
  if (evals.length > 0) await new Promise((r) => setTimeout(r, 1500))
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  cdp.close()
  console.log(`[webui-shot] 已保存 ${out}`)
}

main()
  .catch((error) => { console.error('[webui-shot] 失败:', error.message); process.exitCode = 1 })
  .finally(() => {
    try { edge.kill() } catch { /* 已退出 */ }
    setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 占用忽略 */ } }, 500)
  })
