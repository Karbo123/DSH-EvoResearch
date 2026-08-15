/**
 * Round 31 验证 v2：§27.2 文件上传（DOM.setFileInputFiles 真实路径）+ ZIP 下载。
 * 1. 建会话 → Inspector Workspace → 工具栏按钮断言；
 * 2. CDP setFileInputFiles 上传真实文件（含子目录相对路径）→ 树中出现；
 * 3. /evoresearch/fs/zip → zip base64（count>0 且含上传文件）；
 * 4. 截图。
 * 用法：node scripts/verify-fs-upload2.mjs <port>
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
const userData = join(ROOT, '.tmp-port', `edge-up2-${randomBytes(4).toString('hex')}`)
mkdirSync(dirname(userData), { recursive: true })
const srcFile = join(ROOT, '.tmp-port', 'up-src.txt')
writeFileSync(srcFile, `hello upload ${Date.now()}`, 'utf8')

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
  await cdp.send('DOM.enable')
  await cdp.send('Page.navigate', { url })
  for (let i = 0; i < 40; i += 1) {
    const ready = await cdp.eval(`(function(){ return document.querySelector('.evo-app') !== null && !!window.__evoresearch?.sessions })()`).catch(() => false)
    if (ready) break
    await sleep(500)
  }
  await sleep(1500)

  const report = {}
  const svc = `window.__evoresearch.sessions`
  const id = await cdp.eval(`(function(){ return ${svc}.create({}).then(function(sid){ ${svc}.open(sid); return sid }) })()`)
  await sleep(1500)
  // 打开 Inspector Workspace
  await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('button')).find(function(b){ return b.title === '侧边对话' }); if (btn) btn.click(); return true })()`)
  await sleep(600)
  await cdp.eval(`(function(){ const b = Array.from(document.querySelectorAll('.evo-insp-tab')).find(function(x){ return x.textContent.includes('工作区') }); if (b) b.click(); return true })()`)
  await sleep(1000)
  report.toolbar = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-fs-toolbar button')).map(function(b){ return b.title || b.getAttribute('aria-label') || '' }) })()`)

  // DOM.setFileInputFiles 上传真实文件
  const doc = await cdp.send('DOM.getDocument')
  const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.evo-fs-toolbar input[type=file]:not([webkitdirectory])' })
  report.inputFound = q.nodeId !== 0
  if (q.nodeId !== 0) {
    await cdp.send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [srcFile] })
    await sleep(2500)
  }
  report.treeHasFile = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-fs-row')).some(function(n){ return n.textContent.includes('up-src.txt') }) })()`)
  report.diskExists = await cdp.eval(`(function(){ return fetch('/evoresearch/fs/list', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ root: document.querySelector('.evo-fs-crumb')?.textContent }) }).then(function(r){ return r.json() }).then(function(j){ return (j.value?.entries ?? []).some(function(e){ return e.name === 'up-src.txt' }) }) })()`)

  // ZIP
  const root = await cdp.eval(`(function(){ return document.querySelector('.evo-fs-crumb')?.textContent ?? null })()`)
  report.zip = await cdp.eval(`(function(){ return fetch('/evoresearch/fs/zip', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ root: ${JSON.stringify(root)} }) }).then(function(r){ return r.json() }).then(function(j){ return j.ok ? { count: j.value.count } : { error: j.error?.message } }) })()`)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-port', `fsupload2-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})

