/**
 * 简单 E2E 第 4/5 步（同一可见窗口继续会话）：
 * 4) 基于刚才的 BM25 实验写一小段英文 Related Work（Markdown）→ 检查渲染；
 * 5) 要求更精炼 + 补 Self-RAG 对比 → 检查多轮上下文一致性 + 泄漏复检。
 * 用法：node scripts/verify-simple2.mjs <CDP端口>
 */
const CDP_PORT = process.argv[2] || '47510'
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

const report = {}
const bubbleCount = () => ev(`document.querySelectorAll('.evo-msg-bubble-assistant').length`)
const lastReply = () => ev(`(function(){ const bs = document.querySelectorAll('.evo-msg-bubble-assistant'); const last = bs[bs.length-1]; return last ? last.textContent.trim() : '' })()`)
const sendMsg = async (text) => {
  await ev(`(function(){ const el = document.querySelector('.evo-composer-textarea'); if (!el) return false; const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(400)
  await ev(`(function(){ const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '发送' || (x.textContent || '').trim() === 'Send'); if (b) b.click(); return !!b })()`)
}
const waitNewReply = async (before) => {
  for (let i = 0; i < 100; i++) {
    await sleep(3000)
    const pendingQ = await ev(`document.querySelectorAll('.evo-question').length`)
    if (pendingQ > 0) {
      await ev(`(function(){ const q = document.querySelector('.evo-question'); const opt = q ? q.querySelector('.evo-question-opt') : null; if (opt) opt.click(); return !!opt })()`)
      await sleep(600)
      await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-question-acts button')).find((x) => (x.textContent || '').includes('提交')); if (b) b.click(); return !!b })()`)
      await sleep(2000)
    }
    const now = await bubbleCount()
    const running = await ev(`!!document.querySelector('.evo-composer-stop')`)
    if (now > before && !running) return true
  }
  return false
}

// ── 第 4 步：撰写论文（Related Work）──
const before4 = await bubbleCount()
await sendMsg('基于刚才的 BM25 召回率实验，用英文写一小段 Related Work（5-8 句，Markdown 格式，含标题），讨论 RAG 幻觉与检索质量的关系。不要搜索、不要运行任何工具，直接写。')
report.step4 = await waitNewReply(before4)
await sleep(1500)
report.step4Reply = await lastReply()
report.step4Md = await ev(`(function(){ const bs = document.querySelectorAll('.evo-msg-bubble-assistant'); const last = bs[bs.length-1]; return last ? { headings: last.querySelectorAll('h1,h2,h3').length, lists: last.querySelectorAll('ul,ol').length, bold: last.querySelectorAll('strong').length } : null })()`)

// ── 第 5 步：优化迭代 ──
const before5 = await bubbleCount()
await sendMsg('把刚才那段 Related Work 改得更精炼，并加一句 Self-RAG 与 CRAG 的对比。不要搜索、直接改写。')
report.step5 = await waitNewReply(before5)
await sleep(1500)
report.step5Reply = await lastReply()
report.step5Coherence = await ev(`(function(){ const bs = document.querySelectorAll('.evo-msg-bubble-assistant'); const last = bs[bs.length-1]; const t = last ? last.textContent : ''; return { selfrag: t.includes('Self-RAG'), crag: t.includes('CRAG'), shorter: t.length < 900 } })()`)

report.leakFinal = await ev(`(function(){ const t = document.body.innerText; return ${JSON.stringify(LEAK)}.filter((p) => t.includes(p)) })()`)
report.noWhiteScreen = await ev(`!!document.querySelector('.evo-app')`)
report.assistantBubbles = await bubbleCount()
console.log(JSON.stringify(report, null, 1))
process.exit(0)
