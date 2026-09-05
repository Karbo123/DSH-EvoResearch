// §12.2 端到端：模型调用 update_profile 写 USER_PROFILE.md → 文件出现
const CDP_PORT = process.argv[2] || '45401'
const APP_PORT = process.argv[3] || '1915'
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
const sid = await ev(`(function(){ const s = window.__evoresearch?.sessions; if (!s) return null; return s.create({}).then(function(id){ s.open(id); const b = s.binding(id).session; return b.prompt([{type:'text',text:'Call the update_profile tool to write USER_PROFILE.md with content: 用户喜欢黑咖啡和早起工作。'}], 'queue').then(function(){ return id }) }) })()`)
report.sessionId = sid
for (let i = 0; i < 90; i++) {
  const st = await ev(`(function(){ try { const s = window.__evoresearch.sessions.binding(${JSON.stringify(sid)}).session; const c = s.snapshotCache?.chat?.legacy; return { partial: c?.partial !== null && c?.partial !== undefined, nodes: (c?.nodes ?? []).length } } catch(e) { return null } })()`).catch(() => null)
  if (st && st.partial === false && st.nodes >= 2) break
  await sleep(1000)
}
await sleep(1000)
// 检查工具是否被调用（事件里 tool-call name）
report.toolCalled = await ev(`(async function(){ const res = await fetch('/evoresearch/fs/session-export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: ${JSON.stringify(sid)}, format: 'json', title: 'T' }) }); const json = await res.json(); if (!json.ok) return null; const parsed = JSON.parse(json.value.content); const tools = []; for (const m of parsed.messages) { if (Array.isArray(m.tools)) for (const t of m.tools) tools.push(t.name) } return tools })()`)
console.log(JSON.stringify(report, null, 1))
process.exit(0)
