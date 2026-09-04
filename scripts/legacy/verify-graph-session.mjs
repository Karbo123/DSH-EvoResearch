// 验证：打开会话后点图谱 → 节点应显示
const targets = await (await fetch('http://127.0.0.1:47510/json/list')).json()
const page = targets.find((t) => t.type === 'page')
if (!page) { console.log('NO PAGE'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
}
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) {
    const p = pending.get(d.id)
    pending.delete(d.id)
    d.error ? p.reject(new Error(JSON.stringify(d.error))) : p.resolve(d.result)
  }
}
async function evalJs(expr, timeoutMs = 8000) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('EVAL_TIMEOUT')), timeoutMs)),
  ])
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Page.enable')
// 带会话打开（B 会话）
await send('Page.navigate', { url: 'http://127.0.0.1:11279/?sidebar=1&threadId=session-384c58e2-b601-4cc2-b745-ca94bfa89b2d' })
await sleep(9000)
for (let i = 0; i < 20; i++) {
  const n = await evalJs(`document.querySelectorAll('.evo-tl-item').length`).catch(() => 0)
  if (n >= 7) break
  await sleep(1000)
}
// 图谱 tab
await evalJs(`(() => { const t = [...document.querySelectorAll('.evo-tab')].find(x => (x.textContent || '').includes('图谱')); if (t) t.click(); return !!t })()`)
await sleep(2500)
console.log('GRAPH:', JSON.stringify(await evalJs(`(() => ({
  crashed: !!document.querySelector('.evo-fatal'),
  nodes: document.querySelectorAll('.evo-graph-node').length,
  chats: document.querySelectorAll('.evo-graph-node-chat').length,
  mems: document.querySelectorAll('.evo-graph-node-memory').length,
  edges: document.querySelectorAll('.evo-graph-edge').length,
  error: document.querySelector('.evo-panel-error')?.textContent ?? null,
}))()`)))
// 双击 chat 节点
await evalJs(`(() => { const c = document.querySelector('.evo-graph-node-chat'); if (!c) return false; const r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + 40, clientY: r.top + 20 })); return true })()`)
await sleep(2000)
console.log('DBLCLICK:', JSON.stringify(await evalJs(`(() => ({ crashed: !!document.querySelector('.evo-fatal'), url: location.search.slice(0, 60), composer: !!document.querySelector('.evo-composer-textarea') }))()`)))
ws.close()
process.exit(0)
