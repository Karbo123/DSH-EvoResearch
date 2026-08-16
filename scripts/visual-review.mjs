/**
 * UI 视觉验证脚本：截图（聊天/轨迹/设置）→ 送视觉模型（mimo-v2.5）评审 → 输出结论。
 * 用法：node scripts/visual-review.mjs <CDP端口> <APP端口> [--shots=all|chat|trajectory|settings]
 */
import fs from 'node:fs'

const CDP_PORT = process.argv[2] || '47510'
const APP_PORT = process.argv[3] || '9500'
const modeArg = process.argv.find((a) => a.startsWith('--shots='))
const MODE = modeArg ? modeArg.split('=')[1] : 'all'
const OUT = 'D:\\DSH-Research\\.tmp-port'

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
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.mkdirSync(OUT, { recursive: true })
  await fs.promises.writeFile(`${OUT}\\${name}.png`, Buffer.from(s.data, 'base64'))
  return `${OUT}\\${name}.png`
}

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}/?sidebar=1` })
for (let i = 0; i < 60; i++) { if (await ev(`!!document.querySelector('.evo-app')`).catch(() => false)) break; await sleep(500) }
await sleep(2000)

const captured = []
if (MODE === 'all' || MODE === 'chat') {
  await ev(`(function(){ const b = document.querySelector('.evo-tl-row .evo-tl-row-main'); if (b) b.click(); return !!b })()`)
  await sleep(3000)
  captured.push(await shot('visual-chat'))
}
if (MODE === 'all' || MODE === 'trajectory') {
  await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-tab-title')).find((x) => (x.textContent || '').trim() === '轨迹' || (x.textContent || '').trim() === 'Trajectory'); if (b) b.closest('.evo-tab').click(); return !!b })()`)
  await sleep(1200)
  await ev(`(function(){ const row = document.querySelector('.evo-traj-turn-row'); if (row) row.click(); return !!row })()`)
  await sleep(500)
  await ev(`(function(){ const rows = document.querySelectorAll('.evo-traj-step-row'); const last = rows[rows.length - 1]; if (last) last.click(); return !!last })()`)
  await sleep(500)
  await ev(`(function(){ const rows = document.querySelectorAll('.evo-traj-call-row'); const last = rows[rows.length - 1]; if (last) last.click(); return !!last })()`)
  await sleep(800)
  await ev(`(function(){ const rows = document.querySelectorAll('.evo-traj-turn'); const last = rows[rows.length - 1]; if (last) last.scrollIntoView({ block: 'start' }); return !!last })()`)
  await sleep(500)
  captured.push(await shot('visual-trajectory'))
}
if (MODE === 'all' || MODE === 'settings') {
  await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-topbar button')).find((x) => (x.title || '').includes('设置')); if (b) b.click(); return !!b })()`)
  await sleep(1000)
  captured.push(await shot('visual-settings'))
  await ev(`(function(){ const b = document.querySelector('.evo-btn-back'); if (b) b.click(); return !!b })()`)
}

// 送视觉模型评审
const apiKey = process.env.NEW_API_API_KEY ?? 'sk-ehuqNkIOuBzeR9GsWDHRqchtHYqFB7hBrsTK5joJJ3X3kQcx'
const messages = [{
  role: 'user',
  content: [
    { type: 'text', text: `这是科研 AI 工作台 EvoResearch 的 UI 截图（共 ${captured.length} 张）。请用中文做专业 UI/排版评审，逐条给出「问题 → 具体修改建议」（如无明显问题则回答 OK）。重点检查：界面协调性、间距、层级、对齐、颜色对比、可读性。` },
    ...captured.map((p) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${fs.readFileSync(p).toString('base64')}` } })),
  ],
}]
const res = await fetch('http://127.0.0.1:3000/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model: 'mimo-v2.5', messages, max_tokens: 4000 }),
})
if (!res.ok) {
  console.log('视觉模型调用失败:', res.status, (await res.text()).slice(0, 300))
  process.exit(1)
}
const json = await res.json()
console.log(json.choices?.[0]?.message?.content ?? JSON.stringify(json).slice(0, 500))
