/**
 * Round 24 验证：§43.5 URL 状态（threadId 恢复/写入）+ §44.2 构建指纹。
 * 1. 建会话发消息 → 打开会话 → URL 出现 threadId；
 * 2. 新页面加载 ?threadId=<id> → 会话自动恢复（当前会话为该 id）；
 * 3. /build-stamp.json 可访问（revision 字段）；
 * 4. 设置弹窗 About 显示 build stamp；
 * 5. 截图。
 * 用法：node scripts/verify-urlstate.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const debugPort = 36500 + Math.floor(Math.random() * 700)
const userData = join(ROOT, '.tmp-port', `edge-url-${randomBytes(4).toString('hex')}`)
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
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/?sidebar=1` })
  for (let i = 0; i < 40; i += 1) {
    const ready = await cdp.eval(`(function(){ return document.querySelector('.evo-app') !== null && !!window.__evoresearch?.sessions })()`).catch(() => false)
    if (ready) break
    await sleep(500)
  }
  await sleep(1500)

  const report = {}
  const svc = `window.__evoresearch.sessions`
  // 建会话发消息（产生可打开的会话）
  const id = await cdp.eval(`(function(){ return ${svc}.create({}).then(function(id){ ${svc}.open(id); return id }) })()`)
  await sleep(1000)
  await cdp.eval(`(function(){ const s = ${svc}.binding('${id}').session; return s.prompt([{type:'text',text:'Reply with exactly: URL-OK'}], 'queue').then(function(){ return true }) })()`)
  for (let i = 0; i < 120; i += 1) {
    const st = await cdp.eval(`(function(){ try { const s = ${svc}.binding('${id}').session; const c = s.snapshotCache; const nodes = (c?.chat?.legacy?.nodes ?? []).filter(function(n){return n && n.visibility === 'visible'}); const last = nodes[nodes.length - 1]; const blocks = last?.data?.blocks ?? []; const text = blocks.filter(function(b){ return b.kind === 'text' }).map(function(b){ return b.text }).join(' '); return { last: last?.kind ?? null, text: text.slice(0, 30), partial: c?.chat?.legacy?.partial ?? null } } catch(e) { return { throw: String(e) } } })()`)
    if (st.last === 'assistant-step' && st.partial === null && st.text !== '') break
    await sleep(1000)
  }
  report.sessionId = id
  // 打开会话（Recents 行点击）→ URL 写入 threadId
  for (let i = 0; i < 20; i += 1) {
    const n = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-tl-row').length })()`)
    if (n > 0) break
    await sleep(500)
  }
  await cdp.eval(`(function(){ const row = document.querySelector('.evo-tl-row .evo-tl-row-main'); if (row) row.click(); return true })()`)
  await sleep(600)
  report.urlAfterOpen = await cdp.eval(`(function(){ return location.search })()`)

  // 重新加载页面（URL 保留 threadId）→ 会话自动恢复
  await cdp.send('Page.reload')
  for (let i = 0; i < 40; i += 1) {
    const ready = await cdp.eval(`(function(){ return document.querySelector('.evo-app') !== null && !!window.__evoresearch?.sessions })()`).catch(() => false)
    if (ready) break
    await sleep(500)
  }
  await sleep(2500)
  report.restored = await cdp.eval(`(function(){ try { const s = window.__evoresearch.sessions.binding('${id}'); return { bound: s !== undefined, active: document.querySelector('.evo-tl-row[data-active] .evo-tl-title-text')?.textContent ?? null } } catch(e) { return { throw: String(e) } } })()`)

  // 构建指纹
  report.stampFetch = await cdp.eval(`(function(){ return fetch('/build-stamp.json').then(function(r){ return r.ok ? r.json() : { notFound: true } }).catch(function(e){ return { err: String(e) } }) })()`)
  // 设置弹窗 About
  await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('button')).find(function(b){ return b.title === '设置' }); if (btn) btn.click(); return true })()`)
  await sleep(600)
  report.aboutStamp = await cdp.eval(`(function(){ const el = Array.from(document.querySelectorAll('.evo-setting-hint div')).find(function(d){ return d.textContent.startsWith('build ') }); return el ? el.textContent : null })()`)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-port', `urlstate-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})

