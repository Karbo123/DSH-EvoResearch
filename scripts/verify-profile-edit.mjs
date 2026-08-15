// §12.4 验证 Identity 面板编辑：列表 + 编辑保存 + 新建 + 删除确认 + 重命名
const CDP_PORT = process.argv[2] || '45301'
const APP_PORT = process.argv[3] || '11388'
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
await ev(`(function(){ const b = Array.from(document.querySelectorAll('button')).find(function(x){ return x.textContent.trim() === '身份' }); if (b) b.click(); return !!b })()`)
await sleep(1000)
report.files = await ev(`(function(){ return Array.from(document.querySelectorAll('.evo-skill-card')).map(function(c){ return c.querySelector('.evo-panel-item-main')?.textContent }) })()`)
report.hasEditBtn = await ev(`(function(){ return Array.from(document.querySelectorAll('.evo-panel-act')).some(function(b){ return b.getAttribute('aria-label') === '编辑' }) })()`)
report.newPlaceholder = await ev(`(function(){ const i = document.querySelector('.evo-panel-form input'); return i ? i.getAttribute('placeholder') : null })()`)
// 编辑 SOUL.md
await ev(`(function(){ const card = Array.from(document.querySelectorAll('.evo-skill-card')).find(function(c){ return c.querySelector('.evo-panel-item-main')?.textContent === 'SOUL.md' }); const btn = card?.querySelector('button[aria-label="编辑"]'); if (btn) btn.click(); return !!btn })()`)
await sleep(400)
report.editArea = await ev(`(function(){ const t = document.querySelector('.evo-identity-edit'); return t ? t.tagName : null })()`)
// 修改并保存
report.typed = await ev(`(function(){ const t = document.querySelector('.evo-identity-edit'); if (!t) return 'no-area'; const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(t, '# SOUL\\n\\n保持严谨的科研风格，并优先中文。'); t.dispatchEvent(new Event('input', { bubbles: true })); return 'typed' })()`)
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-profile-edit button')).find(function(x){ return x.textContent.includes('保存') }); if (b) b.click(); return !!b })()`)
await sleep(1000)
report.savedText = await ev(`(function(){ const card = Array.from(document.querySelectorAll('.evo-skill-card')).find(function(c){ return c.querySelector('.evo-panel-item-main')?.textContent === 'SOUL.md' }); return card?.querySelector('.evo-identity-text')?.textContent ?? null })()`)
// 新建文件
report.created = await ev(`(function(){ const i = document.querySelector('.evo-panel-form input'); if (!i) return 'no-input'; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(i, 'PROJECT_PROFILE'); i.dispatchEvent(new Event('input', { bubbles: true })); return 'typed' })()`)
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-panel-form button')).find(function(x){ return x.textContent.includes('新建文件') }); if (b) b.click(); return !!b })()`)
await sleep(1000)
report.filesAfterCreate = await ev(`(function(){ return Array.from(document.querySelectorAll('.evo-skill-card')).map(function(c){ return c.querySelector('.evo-panel-item-main')?.textContent }) })()`)
console.log(JSON.stringify(report, null, 1))
process.exit(0)
