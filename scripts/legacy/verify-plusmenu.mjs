const CDP_PORT = process.argv[2] || '47510'
const APP_PORT = process.argv[3] || '9500'
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
const mousedown = (sel) => ev(`(function(){ const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return true })()`)

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}/?sidebar=1` })
for (let i = 0; i < 60; i++) { if (await ev(`!!document.querySelector('.evo-app')`).catch(() => false)) break; await sleep(500) }
await sleep(2000)
const report = {}
// 打开会话
await ev(`(function(){ const b = document.querySelector('.evo-tl-row .evo-tl-row-main'); if (b) b.click(); return !!b })()`)
await sleep(3000)
// 开 + 菜单 → 从工作区打开
await ev(`(function(){ const b = document.querySelector('.evo-tab-new'); if (b) b.click(); return !!b })()`)
await sleep(600)
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-tab-menu-item')).find((x) => (x.textContent || '').includes('从工作区打开')); if (b) b.click(); return !!b })()`)
await sleep(1200)
report.treeShown = await ev(`!!document.querySelector('.evo-tab-tree')`)
report.treeRows = await ev(`Array.from(document.querySelectorAll('.evo-tab-tree-row')).map((x) => x.textContent.trim().slice(0, 40))`)
// 点 README.md
report.picked = await ev(`(function(){ const row = Array.from(document.querySelectorAll('.evo-tab-tree-row')).find((x) => (x.textContent || '').includes('README.md')); if (row) row.click(); return !!row })()`)
await sleep(1500)
report.editorOpened = await ev(`!!document.querySelector('.evo-tab-editor')`)
report.editorPath = await ev(`document.querySelector('.evo-tab-editor-path')?.textContent ?? ''`)
report.tabs = await ev(`Array.from(document.querySelectorAll('.evo-tab-title')).map((x) => x.textContent.trim())`)
report.menuClosed = await ev(`!document.querySelector('.evo-tab-menu')`)
// 再次打开菜单 → 真实 mousedown 在菜单外 → 应关闭
await ev(`(function(){ const b = document.querySelector('.evo-tab-new'); if (b) b.click(); return !!b })()`)
await sleep(500)
report.menuReopened = await ev(`!!document.querySelector('.evo-tab-menu')`)
await mousedown('.evo-topbar')
await sleep(500)
report.outsideClosed = await ev(`!document.querySelector('.evo-tab-menu')`)
console.log(JSON.stringify(report, null, 1))
process.exit(0)
