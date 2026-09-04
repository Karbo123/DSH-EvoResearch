/**
 * 会话删除验证（阶段一，sidecar 运行中）：
 * 1. 创建会话 A/B/C 并各发一条消息等完成（真实模型调用）；
 * 2. C 运行中删除 → 期望 session-busy 拒绝；
 * 3. C 完成后删除 → 成功；
 * 4. 删除 A（live idle）→ 列表消失 + 持久化文件删除；
 * 5. 删除当前会话 B → 自动跳到新会话；
 * 6. 截图。
 * 用法：node scripts/verify-delete-part1.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}`
const debugPort = 37000 + Math.floor(Math.random() * 500)
const userData = join(ROOT, '.tmp-dev', `edge-del-${randomBytes(4).toString('hex')}`)
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
  await cdp.send('Page.navigate', { url })
  // 等 UI 就绪
  for (let i = 0; i < 40; i += 1) {
    const ready = await cdp.eval(`(function(){ return document.querySelector('.evo-app') !== null && !!window.__evoresearch })()`).catch(() => false)
    if (ready) break
    await sleep(500)
  }
  await sleep(1500)

  const report = {}
  const svc = `window.__evoresearch.sessions`
  const state = (id) => `(function(){ try { const s = ${svc}.binding('${id}').session; const c = s.snapshotCache; const nodes = (c?.chat?.legacy?.nodes ?? []).filter(function(n){return n && n.visibility === 'visible'}); return { partial: c?.chat?.legacy?.partial ?? null, nodes: nodes.length, err: c?.promptError?.error?.message ?? null } } catch(e) { return { throw: String(e) } } })()`

  /** 创建会话 → open → 发消息 → 等完成（partial 消失且节点数增长）。 */
  async function createSessionAndTalk(tag, text) {
    const id = await cdp.eval(`(function(){ return ${svc}.create({}).then(function(id){ ${svc}.open(id); return id }) })()`)
    await sleep(800)
    await cdp.eval(`(function(){ const s = ${svc}.binding('${id}').session; return s.prompt([{type:'text',text:${JSON.stringify(text)}}], 'queue').then(function(){ return true }) })()`)
    // 等待完成：partial 出现又消失（或直接完成），且出现 assistant 节点
    let last = null
    for (let i = 0; i < 180; i += 1) {
      last = await cdp.eval(state(id))
      if (last.partial === null && last.nodes >= 1) break
      if (last.err) break
      await sleep(500)
    }
    report[tag] = { id, last }
    return id
  }

  // 1) 会话 A：短回复
  const idA = await createSessionAndTalk('A', 'Reply with exactly: ALPHA-OK')
  // 2) 会话 B：短回复
  const idB = await createSessionAndTalk('B', 'Reply with exactly: BETA-OK')

  // 3) 会话 C：长回复（保持 running 窗口），运行中删除 → 期望 session-busy
  const idC = await cdp.eval(`(function(){ return ${svc}.create({}).then(function(id){ ${svc}.open(id); return id }) })()`)
  await sleep(800)
  await cdp.eval(`(function(){ const s = ${svc}.binding('${idC}').session; return s.prompt([{type:'text',text:'Count from 1 to 30, one number per line, with a short pause between lines.'}], 'queue').then(function(){ return true }) })()`)
  let busySeen = null
  for (let i = 0; i < 40; i += 1) {
    const res = await cdp.eval(`(function(){ return fetch('/evoresearch/fs/session-delete', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ sessionId: '${idC}' }) }).then(function(r){ return r.json() }) })()`)
    if (res.ok !== true) { busySeen = res.error?.code ?? res.error?.message; break }
    await sleep(200)
  }
  report.C = { id: idC, busySeen }
  // 等 C 完成
  for (let i = 0; i < 180; i += 1) {
    const st = await cdp.eval(state(idC))
    if (st.partial === null && st.nodes >= 1) break
    if (st.err) break
    await sleep(500)
  }

  // 4) 删除 A（live idle）→ ok
  report.deleteA = await cdp.eval(`(function(){ return fetch('/evoresearch/fs/session-delete', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ sessionId: '${idA}' }) }).then(function(r){ return r.json() }) })()`)
  await sleep(1200)
  report.listAfterDeleteA = await cdp.eval(`(function(){ return (document.querySelectorAll('.evo-tl-row').length) })()`)
  report.sessionInfoA = await cdp.eval(`(function(){ return fetch('/evoresearch/fs/session-info', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ sessionId: '${idA}' }) }).then(function(r){ return r.json() }) })()`)

  // 5) 删除当前会话 B → 应跳新会话
  const currentBefore = await cdp.eval(`(function(){ return ${svc}.binding !== undefined ? (${svc}.binding('${idB}') !== undefined ? 'bound' : 'no') : 'none' })()`)
  report.deleteB = await cdp.eval(`(function(){ return fetch('/evoresearch/fs/session-delete', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ sessionId: '${idB}' }) }).then(function(r){ return r.json() }) })()`)
  await sleep(1500)
  report.currentAfterDeleteB = await cdp.eval(`(function(){ try { const b = ${svc}.binding('${idB}'); return { stillBound: b !== undefined } } catch(e) { return { throw: String(e) } } })()`)
  report.deletedLocal = await cdp.eval(`(function(){ return JSON.parse(localStorage.getItem('evoresearch-deleted') ?? '[]') })()`)

  // 6) 删除 C（已完成，live idle）→ ok
  report.deleteC = await cdp.eval(`(function(){ return fetch('/evoresearch/fs/session-delete', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ sessionId: '${idC}' }) }).then(function(r){ return r.json() }) })()`)

  await sleep(800)
  // 截图
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-dev', `delete-part1-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})
