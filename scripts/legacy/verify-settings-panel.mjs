// 设置面板验证：左 tab + 右内容 + 返回（图标+文字）+ 模型表单保存/应用
const CDP_PORT = process.argv[2] || '46101'
const APP_PORT = process.argv[3] || '8255'
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
// 打开设置
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-topbar button')).find(function(x){ return (x.title || '').includes('设置') }); if (b) b.click(); return !!b })()`)
await sleep(800)
report.backBtn = await ev(`(function(){ const b = document.querySelector('.evo-btn-back'); return b ? { text: b.textContent.trim(), hasIcon: !!b.querySelector('svg') } : null })()`)
report.tabs = await ev(`(function(){ return Array.from(document.querySelectorAll('.evo-settings-tab')).map(function(b){ return b.textContent.trim() }) })()`)
// 切代码模型 tab
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-settings-tab')).find(function(x){ return x.textContent.includes('写代码模型') }); if (b) b.click(); return !!b })()`)
await sleep(800)
report.tierCards = await ev(`(function(){ return Array.from(document.querySelectorAll('.evo-tier-card')).map(function(c){ return c.querySelector('.evo-tier-name')?.textContent }) })()`)
report.tierFields = await ev(`(function(){ const c = document.querySelector('.evo-tier-card'); return c ? Array.from(c.querySelectorAll('input')).map(function(i){ return i.getAttribute('placeholder') || i.type }) : null })()`)
report.applyBtn = await ev(`(function(){ const b = document.querySelector('.evo-tier-card .evo-btn-run'); return b ? b.textContent.trim() : null })()`)
// 改 simple 档 model 并保存
await ev(`(function(){ const card = document.querySelector('.evo-tier-card'); const inputs = card.querySelectorAll('input'); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(inputs[0], 'deepseek-v4-flash'); inputs[0].dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-settings-content button')).find(function(x){ return x.textContent.includes('保存') }); if (b) b.click(); return !!b })()`)
await sleep(800)
report.savedHint = await ev(`(function(){ return Array.from(document.querySelectorAll('.evo-setting-hint')).some(function(h){ return h.textContent.includes('已保存') }) })()`)
// 应用默认
await ev(`(function(){ const b = document.querySelector('.evo-tier-card .evo-btn-run'); if (b) b.click(); return !!b })()`)
await sleep(800)
// 切语音 tab
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-settings-tab')).find(function(x){ return x.textContent.includes('语音识别') }); if (b) b.click(); return !!b })()`)
await sleep(600)
report.voiceSelect = await ev(`(function(){ const s = document.querySelector('.evo-settings-content select'); return s ? Array.from(s.options).map(function(o){ return o.textContent }) : null })()`)
report.voiceFields = await ev(`(function(){ return Array.from(document.querySelectorAll('.evo-settings-content .evo-setting-field')).map(function(f){ return f.querySelector('.evo-setting-field-label')?.textContent }) })()`)
// 返回
report.backClicked = await ev(`(function(){ const b = document.querySelector('.evo-btn-back'); if (b) b.click(); return !!b })()`)
await sleep(500)
report.modalGone = await ev(`(function(){ return document.querySelector('.evo-modal') === null })()`)
console.log(JSON.stringify(report, null, 1))
process.exit(0)
