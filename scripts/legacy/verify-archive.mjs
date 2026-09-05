// 验证会话归档（§26.3 Archive）：行归档按钮 → 从 Recents 消失 → 已归档分区 → 恢复
const CDP_PORT = process.argv[2] || '45001'
const APP_PORT = process.argv[3] || '10332'
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

// 造 2 个会话（页面内 sessions.create + prompt）
for (const label of ['ARCHIVE-TEST-A', 'ARCHIVE-TEST-B']) {
  await ev(`(function(){ const s = window.__evoresearch?.sessions; if (!s) return 'no-svc'; return s.create({}).then(function(id){ s.open(id); const b = s.binding(id).session; return b.prompt([{type:'text',text:${JSON.stringify(label)}}], 'queue').then(function(){ return id }) }) })()`)
  await sleep(600)
}
for (let i = 0; i < 20; i++) { const n = await ev(`document.querySelectorAll('.evo-tl-row').length`).catch(() => 0); if (n >= 2) break; await sleep(500) }
await sleep(1000)

const report = {}
report.rowsBefore = await ev(`document.querySelectorAll('.evo-tl-row').length`)
report.hasArchiveBtn = await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-tl-row-act')).find(function(x){ return x.getAttribute('aria-label') === '归档' }); return !!b })()`)
report.archivedSectionBefore = await ev(`(function(){ return Array.from(document.querySelectorAll('.evo-tl-archived-toggle')).length })()`)
// 归档第一行
report.archived = await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-tl-row-act')).find(function(x){ return x.getAttribute('aria-label') === '归档' }); if (!b) return 'no-btn'; b.click(); return 'clicked' })()`)
await sleep(800)
report.rowsAfter = await ev(`document.querySelectorAll('.evo-tl-row').length`)
report.archivedCount = await ev(`(function(){ const t = document.querySelector('.evo-tl-archived-toggle'); return t ? t.textContent.trim() : null })()`)
// 展开已归档
await ev(`(function(){ const t = document.querySelector('.evo-tl-archived-toggle'); if (t) t.click(); return true })()`)
await sleep(500)
report.archivedRows = await ev(`document.querySelectorAll('.evo-tl-archived-row').length`)
report.hasUnarchive = await ev(`(function(){ const b = document.querySelector('.evo-tl-archived-row button[aria-label="恢复"]'); return !!b })()`)
report.lsArchived = await ev(`localStorage.getItem('evoresearch-archived')`)
// 恢复
report.restored = await ev(`(function(){ const b = document.querySelector('.evo-tl-archived-row button[aria-label="恢复"]'); if (!b) return 'no-btn'; b.click(); return 'clicked' })()`)
await sleep(800)
report.rowsAfterRestore = await ev(`document.querySelectorAll('.evo-tl-row').length`)
report.archivedSectionAfter = await ev(`(function(){ return document.querySelectorAll('.evo-tl-archived-toggle').length })()`)
console.log(JSON.stringify(report, null, 1))
process.exit(0)
