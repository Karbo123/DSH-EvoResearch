/**
 * Round 20 验证：Ask User 卡片（§21.3）—— 经临时端点 session-ask-test 注入真实问题帧。
 * 1. 建会话 → fetch session-ask-test（双问题：单选 + 多选）→ ask 挂起等待；
 * 2. 断言 .evo-question-card 出现：问题文本、选项、自定义输入、取消；
 * 3. 单选问题点击选项（即答）→ 第二个问题多选两个选项 + Submit；
 * 4. 断言卡片消失（全部回答）→ ask 返回 answers → 会话继续；
 * 5. 截图。
 * 用法：node scripts/verify-ask-user.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const url = `http://127.0.0.1:${port}/?sidebar=1`
const debugPort = 47000 + Math.floor(Math.random() * 500)
const userData = join(ROOT, '.tmp-port', `edge-ask-${randomBytes(4).toString('hex')}`)
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
  for (let i = 0; i < 40; i += 1) {
    const ready = await cdp.eval(`(function(){ return document.querySelector('.evo-app') !== null && !!window.__evoresearch })()`).catch(() => false)
    if (ready) break
    await sleep(500)
  }
  await sleep(1500)

  const report = {}
  const svc = `window.__evoresearch.sessions`
  const id = await cdp.eval(`(function(){ return ${svc}.create({}).then(function(id){ ${svc}.open(id); return id }) })()`)
  await sleep(1000)
  report.id = id

  // 触发真实问题帧（ask 挂起等待答案，60s 超时）
  const askPromise = cdp.eval(`(function(){ return fetch('/evoresearch/fs/session-ask-test', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ sessionId: '${id}' }) }).then(function(r){ return r.json() }) })()`)

  // 等问题卡片出现
  let cardSeen = false
  for (let i = 0; i < 40; i += 1) {
    const n = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-question-card').length })()`)
    if (n > 0) { cardSeen = true; break }
    await sleep(500)
  }
  report.cardSeen = cardSeen
  report.questionTexts = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-question-text')).map(function(n){ return n.textContent.slice(0, 80) }) })()`)
  report.optionGroups = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-question')).map(function(q){ return Array.from(q.querySelectorAll('.evo-question-opt')).map(function(b){ return b.textContent.trim() }) }) })()`)
  report.hasCustom = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-question-custom').length })()`)
  report.hasCancel = await cdp.eval(`(function(){ return Array.from(document.querySelectorAll('.evo-question-acts button')).some(function(b){ return b.textContent.includes('取消') }) })()`)

  if (cardSeen) {
    const shot1 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(ROOT, '.tmp-port', `ask-card-${port}.png`), Buffer.from(shot1.data, 'base64'))
    // 单选问题：点击第一个选项（RNA structure）→ 即答
    report.singleClick = await cdp.eval(`(function(){ const q = document.querySelector('.evo-question'); const btn = q?.querySelector('.evo-question-opt'); if (!btn) return 'no-opt'; btn.click(); return 'clicked' })()`)
    await sleep(800)
    // 多选问题：选两个选项 + Submit
    report.multiSelect = await cdp.eval(`(function(){ const cards = Array.from(document.querySelectorAll('.evo-question-card')); const card = cards[0]; const questions = Array.from(card.querySelectorAll('.evo-question')); const multi = questions.find(function(q){ return q.querySelector('.evo-question-check') !== null }); if (!multi) return 'no-multi'; const opts = Array.from(multi.querySelectorAll('.evo-question-opt')); opts[0].click(); opts[2].click(); return 'selected-2' })()`)
    await sleep(500)
    report.submit = await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('.evo-question-acts button')).find(function(b){ return b.textContent.includes('Submit') }); if (!btn) return 'no-submit'; btn.click(); return 'clicked' })()`)
    // 等卡片消失 + ask 返回
    for (let i = 0; i < 30; i += 1) {
      const n = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-question-card').length })()`)
      if (n === 0) break
      await sleep(500)
    }
    report.cardGone = await cdp.eval(`(function(){ return document.querySelectorAll('.evo-question-card').length === 0 })()`)
  }

  // ask 的最终结果（answers）
  const askResult = await Promise.race([
    askPromise,
    sleep(65000).then(() => ({ timeout: true })),
  ])
  report.askResult = askResult

  const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-port', `ask-done-${port}.png`)
  writeFileSync(out, Buffer.from(shot2.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})

