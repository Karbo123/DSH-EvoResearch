// 验证 Goals 面板行展开显示合同详情
const CDP_PORT = process.argv[2] || '44701'
const APP_PORT = process.argv[3] || '7171'
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
// 打开 EvoMemory 面板
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-tl-item')).find(function(x){ return x.textContent.includes('科研记忆') }); if (b) b.click(); return !!b })()`)
await sleep(1000)
report.goalRowVisible = await ev(`(function(){ return Array.from(document.querySelectorAll('.evo-panel-item-main')).some(function(n){ return n.textContent.includes('验证目标合同展开') }) })()`)
report.criteriaCountBefore = await ev(`(function(){ const el = document.querySelector('.evo-goal-criteria-count'); return el ? el.textContent : null })()`)
// 点击展开
report.clicked = await ev(`(function(){ const h = Array.from(document.querySelectorAll('.evo-goal-head')).find(function(b){ return b.textContent.includes('验证目标合同展开') }); if (!h) return 'no-head'; h.click(); return 'clicked' })()`)
await sleep(600)
report.expanded = await ev(`(function(){ const d = document.querySelector('.evo-goal-detail'); return d ? d.innerText.slice(0, 400) : null })()`)
report.ariaExpanded = await ev(`(function(){ const h = document.querySelector('.evo-goal-head'); return h ? h.getAttribute('aria-expanded') : null })()`)
report.dataOpen = await ev(`(function(){ const i = document.querySelector('.evo-goal-item'); return i ? i.getAttribute('data-open') : null })()`)
// 再点收起
await ev(`(function(){ const h = document.querySelector('.evo-goal-head'); if (h) h.click(); return true })()`)
await sleep(400)
report.collapsed = await ev(`(function(){ return document.querySelector('.evo-goal-detail') === null })()`)
console.log(JSON.stringify(report, null, 1))
process.exit(0)
