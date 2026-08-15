// 验证 Goals 面板提案 UI：展开显示提案 → 接受 → 合同版本更新
const CDP_PORT = process.argv[2] || '44801'
const APP_PORT = process.argv[3] || '1031'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
const target = list.find((t) => t.type === 'page')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, 15000) })
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r?.result?.value }

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}/?sidebar=1` })
for (let i = 0; i < 40; i++) { if (await ev(`!!document.querySelector('.evo-app')`).catch(() => false)) break; await sleep(500) }
await sleep(1500)

const report = {}
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-tl-item')).find(function(x){ return x.textContent.includes('科研记忆') }); if (b) b.click(); return !!b })()`)
await sleep(1000)
// 展开目标
await ev(`(function(){ const h = Array.from(document.querySelectorAll('.evo-goal-head')).find(function(b){ return b.textContent.includes('提案验证目标') }); if (h) h.click(); return !!h })()`)
await sleep(800)
report.proposalTitle = await ev(`(function(){ const el = document.querySelector('.evo-goal-proposal-title'); return el ? el.textContent : null })()`)
report.proposalSummary = await ev(`(function(){ const el = document.querySelector('.evo-goal-proposal-summary'); return el ? el.textContent : null })()`)
report.versionBefore = await ev(`(function(){ const m = document.querySelector('.evo-goal-detail-meta'); return m ? m.innerText : null })()`)
// 点击接受
report.acceptClicked = await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-goal-proposal-acts button')).find(function(x){ return x.textContent.includes('接受') }); if (!b) return 'no-btn'; b.click(); return 'clicked' })()`)
await sleep(1200)
report.versionAfter = await ev(`(function(){ const m = document.querySelector('.evo-goal-detail-meta'); return m ? m.innerText : null })()`)
report.pendingGone = await ev(`(function(){ return document.querySelectorAll('.evo-goal-proposal').length })()`)
report.noProposalsHint = await ev(`(function(){ return Array.from(document.querySelectorAll('.evo-panel-hint')).some(function(h){ return h.textContent.includes('暂无提案') }) })()`)
report.criteriaAfter = await ev(`(function(){ return Array.from(document.querySelectorAll('.evo-goal-criterion-text')).map(function(n){ return n.textContent }) })()`)
console.log(JSON.stringify(report, null, 1))
process.exit(0)
