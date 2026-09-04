// 验证 Knowledge 面板显示关联关系标签
const CDP_PORT = process.argv[2] || '44901'
const APP_PORT = process.argv[3] || '13049'
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
await sleep(800)
// 切 Knowledge tab
await ev(`(function(){ const b = Array.from(document.querySelectorAll('button')).find(function(x){ return x.textContent.trim() === '知识' }); if (b) b.click(); return !!b })()`)
await sleep(1000)
report.cards = await ev(`(function(){ return Array.from(document.querySelectorAll('.evo-skill-card')).map(function(c){ return { title: c.querySelector('.evo-panel-item-main')?.textContent, links: Array.from(c.querySelectorAll('.evo-panel-tag-link')).map(function(t){ return t.textContent }) } }) })()`)
const linked = (report.cards ?? []).filter((c) => (c.links ?? []).length > 0)
report.linkVisible = linked.length >= 2
console.log(JSON.stringify(report, null, 1))
process.exit(0)
