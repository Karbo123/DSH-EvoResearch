// 验证 Workspace 面板"新建项目"UI：输入 → 创建 → 列表出现
const CDP_PORT = process.argv[2] || '44601'
const APP_PORT = process.argv[3] || '3299'
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

// 打开 Workspace 面板（侧栏"导入项目"导航项）
const opened = await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-tl-item')).find(function(x){ return x.textContent.includes('导入项目') || x.textContent.includes('项目') }); if (b) b.click(); return !!b })()`)
await sleep(1000)
const report = { opened }
// 新建项目表单（第一个 .evo-panel-form 的输入）
report.inputPlaceholder = await ev(`(function(){ const i = document.querySelector('.evo-panel-form input'); return i ? i.getAttribute('placeholder') : null })()`)
report.createBtnText = await ev(`(function(){ const btn = Array.from(document.querySelectorAll('.evo-panel-form button')).find(function(b){ return b.textContent.includes('新建项目') || b.textContent.includes('创建') }); return btn ? btn.textContent.trim() : null })()`)
// 输入项目名并创建
report.typed = await ev(`(function(){ const input = document.querySelector('.evo-panel-form input'); if (!input) return 'no-input'; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(input, 'ui-created-project'); input.dispatchEvent(new Event('input', { bubbles: true })); return 'typed' })()`)
await sleep(300)
report.created = await ev(`(function(){ const btn = Array.from(document.querySelectorAll('.evo-panel-form button')).find(function(b){ return (b.textContent || '').includes('新建项目') }); if (!btn) return 'no-btn'; btn.click(); return 'clicked' })()`)
await sleep(1500)
// 列表应出现两个项目（API 创建的 + UI 创建的）
report.items = await ev(`(function(){ return Array.from(document.querySelectorAll('.evo-panel-item-main')).map(function(n){ return n.textContent }) })()`)
report.createdInputCleared = await ev(`(function(){ const i = document.querySelector('.evo-panel-form input'); return i ? i.value : null })()`)
console.log(JSON.stringify(report, null, 1))
process.exit(0)
