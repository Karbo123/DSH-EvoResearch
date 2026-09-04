/**
 * 简单 E2E（可见窗口监督版）：
 * 一条消息：纯 Python 标准库写 BM25 召回率小实验（内置样例数据，不装包不下载）→ 运行 → 报告结果。
 * 检查：回复质量 / 代码块渲染 / 命令执行结果条 / 无 XML 泄漏。
 * 用法：node scripts/verify-simple.mjs <CDP端口> <APP端口>
 */
const CDP_PORT = process.argv[2] || '47510'
const APP_PORT = process.argv[3] || '4121'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
const target = list.find((t) => t.type === 'page')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, 30000) })
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r?.result?.value }
const LEAK = ['Current runtime context', 'Current DSH file policy', '<code_mode>', '<research_memory_packet>', '<identity_profile>']

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}/?sidebar=1` })
for (let i = 0; i < 60; i++) { if (await ev(`!!document.querySelector('.evo-app')`).catch(() => false)) break; await sleep(500) }
await sleep(2000)

const report = {}
report.leakBefore = await ev(`(function(){ const t = document.body.innerText; return ${JSON.stringify(LEAK)}.filter((p) => t.includes(p)) })()`)

// 发送简单实验消息
await ev(`(function(){ const el = document.querySelector('.evo-composer-textarea'); if (!el) return false; const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(el, '写一个只用 Python 标准库的小脚本：用 5 条内置示例的论文句子测 BM25 检索的召回率，运行它并把结果告诉我。不要安装任何包，不要下载任何数据，脚本要简短。'); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
await sleep(400)
report.sent = await ev(`(function(){ const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '发送' || (x.textContent || '').trim() === 'Send'); if (b) b.click(); return !!b })()`)

// 等待回合完成（stop 按钮消失），最长 6 分钟；期间若出现提问则选第一个选项提交
for (let i = 0; i < 120; i++) {
  await sleep(3000)
  const pendingQ = await ev(`document.querySelectorAll('.evo-question').length`)
  if (pendingQ > 0) {
    await ev(`(function(){ const q = document.querySelector('.evo-question'); const opt = q ? q.querySelector('.evo-question-opt') : null; if (opt) opt.click(); return !!opt })()`)
    await sleep(600)
    await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-question-acts button')).find((x) => (x.textContent || '').includes('提交')); if (b) b.click(); return !!b })()`)
    await sleep(2000)
  }
  const running = await ev(`!!document.querySelector('.evo-composer-stop')`)
  const replied = await ev(`Array.from(document.querySelectorAll('.evo-msg-bubble-assistant')).some((b) => (b.textContent || '').trim().length > 30)`)
  if (!running && replied) break
}
await sleep(2000)

report.replied = await ev(`Array.from(document.querySelectorAll('.evo-msg-bubble-assistant')).some((b) => (b.textContent || '').trim().length > 30)`)
report.replyText = await ev(`Array.from(document.querySelectorAll('.evo-msg-bubble-assistant')).map((b) => b.textContent.trim()).join('\\n').slice(0, 600)`)
report.codeBlocks = await ev(`document.querySelectorAll('.evo-md pre').length`)
report.cmdCards = await ev(`document.querySelectorAll('.evo-cmd-card').length`)
report.cmdText = await ev(`Array.from(document.querySelectorAll('.evo-cmd-card')).map((x) => x.textContent.trim().slice(0, 200)).join(' | ') || ''`)
report.leakAfter = await ev(`(function(){ const t = document.body.innerText; return ${JSON.stringify(LEAK)}.filter((p) => t.includes(p)) })()`)
report.noWhiteScreen = await ev(`!!document.querySelector('.evo-app')`)

console.log(JSON.stringify(report, null, 1))
process.exit(0)
