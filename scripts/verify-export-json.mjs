// §41.8 验证：JSON 完整导出（诊断格式）——创建会话发消息（含工具触发）→ 导出 → 断言结构
// 用法：node scripts/verify-export-json.mjs <cdpPort> <appPort>
const CDP_PORT = process.argv[2] || '45101'
const APP_PORT = process.argv[3] || '8135'
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
const sid = await ev(`(function(){ const s = window.__evoresearch?.sessions; if (!s) return null; return s.create({}).then(function(id){ s.open(id); const b = s.binding(id).session; return b.prompt([{type:'text',text:'Use a tool to list files in the workspace, then reply with exactly: EXPORT-OK'}], 'queue').then(function(){ return id }) }) })()`)
report.sessionId = sid
for (let i = 0; i < 90; i++) {
  const st = await ev(`(function(){ try { const s = window.__evoresearch.sessions.binding(${JSON.stringify(sid)}).session; const c = s.snapshotCache?.chat?.legacy; return { partial: c?.partial !== null && c?.partial !== undefined, nodes: (c?.nodes ?? []).length } } catch(e) { return null } })()`).catch(() => null)
  if (st && st.partial === false && st.nodes >= 2) break
  await sleep(1000)
}
await sleep(1500)
report.export = await ev(`(async function(){ const res = await fetch('/evoresearch/fs/session-export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: ${JSON.stringify(sid)}, format: 'json', title: 'EXPORT-DIAG' }) }); const json = await res.json(); if (!json.ok) return { err: JSON.stringify(json) }; const parsed = JSON.parse(json.value.content); const toolMsgs = parsed.messages.filter(function(m){ return Array.isArray(m.tools) && m.tools.length > 0 }); return { filename: json.value.filename, messageCount: parsed.messageCount, roles: parsed.messages.map(function(m){ return m.role }), toolMsgCount: toolMsgs.length, toolsWithResult: toolMsgs.every(function(m){ return m.tools.every(function(t){ return typeof t.result === 'string' && t.name !== '' && typeof t.args === 'string' }) }) } })()`)
console.log(JSON.stringify(report, null, 1))
process.exit(0)
