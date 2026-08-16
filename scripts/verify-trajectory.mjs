/**
 * 轨迹面板 + 全屏设置 E2E（可见窗口监督版）：
 * 1) 打开有历史的会话 → 轨迹 tab → 回合/步骤/调用行、时长、tokens、搜索、展开收起；
 * 2) 设置面板占满窗口（modal 尺寸 == viewport）。
 * 用法：node scripts/verify-trajectory.mjs <CDP端口> <APP端口>
 */
const CDP_PORT = process.argv[2] || '47510'
const APP_PORT = process.argv[3] || '10522'
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
const LEAK = ['Current runtime context', 'Current DSH file policy', '<code_mode>', '<research_memory_packet>', '<identity_profile>', '<project_env>']

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}/?sidebar=1` })
for (let i = 0; i < 60; i++) { if (await ev(`!!document.querySelector('.evo-app')`).catch(() => false)) break; await sleep(500) }
await sleep(2000)

const report = {}
// 打开最近会话（有历史的）
report.recents = await ev(`document.querySelectorAll('.evo-tl-row').length`)
await ev(`(function(){ const b = document.querySelector('.evo-tl-row .evo-tl-row-main'); if (b) b.click(); return !!b })()`)
await sleep(3000)
report.sessionOpened = await ev(`!!document.querySelector('.evo-composer-textarea')`)
// 切轨迹 tab
report.trajTab = await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-tab-title')).find((x) => (x.textContent || '').trim() === '轨迹' || (x.textContent || '').trim() === 'Trajectory'); if (b) b.closest('.evo-tab').click(); return !!b })()`)
await sleep(1500)
report.trajPanel = await ev(`!!document.querySelector('.evo-traj')`)
report.turnRows = await ev(`document.querySelectorAll('.evo-traj-turn-row').length`)
report.stepRows = await ev(`document.querySelectorAll('.evo-traj-step-row').length`)
report.callRows = await ev(`document.querySelectorAll('.evo-traj-call-row').length`)
report.toolbar = await ev(`Array.from(document.querySelectorAll('.evo-traj-chip')).map((x) => x.textContent.trim())`)
report.firstTurn = await ev(`document.querySelector('.evo-traj-turn-row')?.textContent?.trim()?.slice(0, 100) ?? ''`)
report.durations = await ev(`Array.from(document.querySelectorAll('.evo-traj-dur')).slice(0, 6).map((x) => x.textContent.trim())`)
report.tokens = await ev(`document.querySelector('.evo-traj-totals')?.textContent ?? ''`)
// 展开调用
await ev(`(function(){ const b = document.querySelector('.evo-traj-call-row'); if (b) b.click(); return !!b })()`)
await sleep(500)
report.callDetail = await ev(`(function(){ const d = document.querySelector('.evo-traj-call-detail'); return d ? { heads: Array.from(d.querySelectorAll('.evo-traj-detail-head')).map((x) => x.textContent), hasPre: !!d.querySelector('pre') } : null })()`)
// 搜索（用本会话确实出现过的工具名）
await ev(`(function(){ const el = document.querySelector('.evo-traj-search-input'); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(el, 'write'); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
await sleep(600)
report.searchResult = await ev(`(function(){ const rows = Array.from(document.querySelectorAll('.evo-traj-call-row')); return { callRows: rows.length, names: rows.map((r) => r.querySelector('.evo-traj-label')?.textContent ?? ''), anyMatch: rows.length > 0 && rows.every((r) => (r.textContent ?? '').toLowerCase().includes('write')) } })()`)
// 清空搜索
await ev(`(function(){ const el = document.querySelector('.evo-traj-search-input'); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
await sleep(400)
// 等宽切换
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-traj-chip')).find((x) => (x.textContent || '').includes('等宽')); if (b) b.click(); return !!b })()`)
await sleep(400)
report.equalWidthBar = await ev(`(function(){ const f = document.querySelector('.evo-traj-bar-fill'); return f ? getComputedStyle(f).width : null })()`)
// 设置全屏
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-topbar button')).find((x) => (x.title || '').includes('设置')); if (b) b.click(); return !!b })()`)
await sleep(1000)
report.settingsFullscreen = await ev(`(function(){ const m = document.querySelector('.evo-modal'); if (!m) return null; const r = m.getBoundingClientRect(); return { modal: { w: r.width, h: r.height }, viewport: { w: window.innerWidth, h: window.innerHeight }, full: Math.abs(r.width - window.innerWidth) < 2 && Math.abs(r.height - window.innerHeight) < 2 } })()`)
// 返回
await ev(`(function(){ const b = document.querySelector('.evo-btn-back'); if (b) b.click(); return !!b })()`)
await sleep(500)
report.backClosed = await ev(`document.querySelector('.evo-modal') === null`)
report.leak = await ev(`(function(){ const t = document.body.innerText; return ${JSON.stringify(LEAK)}.filter((p) => t.includes(p)) })()`)
console.log(JSON.stringify(report, null, 1))
process.exit(0)
