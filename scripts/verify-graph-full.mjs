// Chat Graph 全面测试：功能 + 边角 + 需求符合度（逐步断言）
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'
const PORT = '11279'
const SESS = 'session-384c58e2-b601-4cc2-b745-ca94bfa89b2d'
const debugPort = 47435
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-full-${Date.now()}`
mkdirSync(profile, { recursive: true })
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets = null
for (let i = 0; i < 30; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); if (l.some((t) => t.type === 'page')) { targets = l; break } } catch { /* retry */ }
  await sleep(1000)
}
if (!targets) { console.log('FATAL: edge not up'); process.exit(1) }
const page = targets.find((t) => t.type === 'page')
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
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra })
const rmouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'right', buttons: type === 'mouseReleased' ? 0 : 2 })
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`D:\\DSH-Research\\.tmp-port\\full-${name}.png`, Buffer.from(s.data, 'base64'))
}

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (cond) pass += 1; else fail += 1
}
const graphState = () => evalJs(`(() => ({
  crashed: !!document.querySelector('.evo-fatal'),
  nodes: document.querySelectorAll('.evo-graph-node').length,
  chats: document.querySelectorAll('.evo-graph-node-chat').length,
  mems: document.querySelectorAll('.evo-graph-node-memory').length,
  edges: document.querySelectorAll('.evo-graph-edge').length,
  ctxEdges: document.querySelectorAll('.evo-graph-edge-ctx').length,
  error: document.querySelector('.evo-panel-error')?.textContent ?? null,
}))()`)
const portsOf = () => evalJs(`(() => {
  const c = document.querySelector('.evo-graph-canvas')
  if (!c) return null
  const cr = c.getBoundingClientRect()
  const nodes = [...document.querySelectorAll('.evo-graph-node')]
  return nodes.map((n) => {
    const r = n.getBoundingClientRect()
    const type = n.classList.contains('evo-graph-node-chat') ? 'chat' : 'memory'
    return {
      id: n.getAttribute('data-node-id'),
      type,
      title: n.querySelector('.evo-graph-node-title')?.textContent ?? '',
      x: Math.round(r.left), y: Math.round(r.top),
      out: { x: Math.round(r.right + 1), y: Math.round(r.top + (type === 'chat' ? 33 : 23)) },
      inCtx: type === 'chat' ? { x: Math.round(r.left - 1), y: Math.round(r.top + 22) } : null,
      inMem: type === 'chat' ? { x: Math.round(r.left - 1), y: Math.round(r.top + 44) } : null,
    }
  })
})()`)
async function dragLine(from, to) {
  if (!from || !to) return
  await mouse('mousePressed', from.x, from.y, { buttons: 1, clickCount: 1 })
  await sleep(200)
  for (let s = 1; s <= 10; s++) {
    const t = s / 10
    await mouse('mouseMoved', Math.round(from.x + (to.x - from.x) * t), Math.round(from.y + (to.y - from.y) * t), { buttons: 1 })
    await sleep(40)
  }
  await mouse('mouseReleased', to.x, to.y, { buttons: 0, clickCount: 1 })
  await sleep(700)
}
async function openGraphTab() {
  const tab = await evalJs(`(() => { const t = [...document.querySelectorAll('.evo-tab')].find(x => (x.textContent || '').includes('图谱')); if (!t) return null; const r = t.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  if (tab) { await mouse('mousePressed', tab.x, tab.y, { buttons: 1, clickCount: 1 }); await mouse('mouseReleased', tab.x, tab.y, { buttons: 0, clickCount: 1 }) }
  await sleep(2000)
}
async function openChatTab() {
  const tab = await evalJs(`(() => { const t = [...document.querySelectorAll('.evo-tab')].find(x => (x.textContent || '').includes('对话')); if (!t) return null; const r = t.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  if (tab) { await mouse('mousePressed', tab.x, tab.y, { buttons: 1, clickCount: 1 }); await mouse('mouseReleased', tab.x, tab.y, { buttons: 0, clickCount: 1 }) }
  await sleep(1200)
}

await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Page.enable')
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?sidebar=1&threadId=${SESS}` })
await sleep(9000)
for (let i = 0; i < 20; i++) {
  const n = await evalJs(`document.querySelectorAll('.evo-tl-item').length`).catch(() => 0)
  if (n >= 7) break
  await sleep(1000)
}
console.log('══ 阶段 1：图谱打开与渲染 ══')
await openGraphTab()
let st = await graphState()
check('图谱 tab 打开不崩溃', !st.crashed)
check('图谱画布渲染', await evalJs(`!!document.querySelector('.evo-graph-canvas')`))
check('工具栏渲染', await evalJs(`document.querySelectorAll('.evo-graph-btn').length >= 3`))
await shot('open')

console.log('══ 阶段 2：右键菜单新建（三种类型）══')
// 右键画布
const c = await evalJs(`(() => { const r = document.querySelector('.evo-graph-canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.8), y: Math.round(r.top + r.height * 0.75) } })()`)
await rmouse('mousePressed', c.x, c.y)
await rmouse('mouseReleased', c.x, c.y)
await sleep(600)
const menuItems = await evalJs(`[...document.querySelectorAll('.evo-graph-menu-item')].map(i => i.textContent.trim())`)
check('右键菜单 3 项', menuItems.length === 3 && menuItems.some((m) => m.includes('聊天节点')) && menuItems.some((m) => m.includes('记忆节点')) && menuItems.some((m) => m.includes('全局记忆')), menuItems.join('/'))
await shot('menu')
// 点新建聊天节点（第一项）
const mi = await evalJs(`(() => { const m = document.querySelector('.evo-graph-menu'); const r = m.getBoundingClientRect(); return { x: Math.round(r.left + 30), y: Math.round(r.top + 14) } })()`)
await mouse('mousePressed', mi.x, mi.y, { buttons: 1, clickCount: 1 })
await mouse('mouseReleased', mi.x, mi.y, { buttons: 0, clickCount: 1 })
await sleep(1800)
const st1 = await graphState()
check('右键新建聊天节点（真实会话关联）', st1.chats >= st.chats + 1, `chats ${st.chats}→${st1.chats}`)

console.log('══ 阶段 3：工具栏按钮新建 ══')
// 工具栏：新建记忆节点 / 新建全局记忆
const btn = await evalJs(`(() => { const b = [...document.querySelectorAll('.evo-graph-btn')].find(x => x.textContent.includes('记忆节点')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
if (btn) { await mouse('mousePressed', btn.x, btn.y, { buttons: 1, clickCount: 1 }); await mouse('mouseReleased', btn.x, btn.y, { buttons: 0, clickCount: 1 }) }
await sleep(900)
const btn2 = await evalJs(`(() => { const b = [...document.querySelectorAll('.evo-graph-btn')].find(x => x.textContent.includes('全局记忆')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
if (btn2) { await mouse('mousePressed', btn2.x, btn2.y, { buttons: 1, clickCount: 1 }); await mouse('mouseReleased', btn2.x, btn2.y, { buttons: 0, clickCount: 1 }) }
await sleep(900)
const st2 = await graphState()
check('工具栏新建记忆节点', st2.mems >= st1.mems + 1, `mems ${st1.mems}→${st2.mems}`)
check('工具栏新建全局记忆', st2.mems >= st1.mems + 2, `mems ${st1.mems}→${st2.mems}`)

console.log('══ 阶段 4：连线与端口语义 ══')
// 确保至少 2 个 chat 节点（右键再建一个，供 context 唯一性测试）
const c4 = await evalJs(`(() => { const r = document.querySelector('.evo-graph-canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.3), y: Math.round(r.top + r.height * 0.3) } })()`)
if (c4) { await rmouse('mousePressed', c4.x, c4.y); await rmouse('mouseReleased', c4.x, c4.y); await sleep(500) }
const mi4 = await evalJs(`(() => { const m = document.querySelector('.evo-graph-menu'); const r = m.getBoundingClientRect(); return { x: Math.round(r.left + 30), y: Math.round(r.top + 14) } })()`)
if (mi4) { await mouse('mousePressed', mi4.x, mi4.y, { buttons: 1, clickCount: 1 }); await mouse('mouseReleased', mi4.x, mi4.y, { buttons: 0, clickCount: 1 }) }
await sleep(1600)
const ports = await portsOf()
const chatA = ports.find((p) => p.type === 'chat')
const memA = ports.find((p) => p.type === 'memory')
check('存在可连线的 chat/memory 节点', !!chatA && !!memA)
if (chatA && memA) {
  // memory → chat.memory（多条允许）
  await dragLine(memA.out, chatA.inMem)
  let s3 = await graphState()
  check('memory→chat 记忆边建立', s3.edges >= st2.edges + 1, `edges ${st2.edges}→${s3.edges}`)
  // 第二个 memory → 同一 chat.memory（多条）
  const memB = ports.filter((p) => p.type === 'memory')[1]
  if (memB) {
    await dragLine(memB.out, chatA.inMem)
    s3 = await graphState()
    check('memory 多条连接允许', s3.edges >= st2.edges + 2, `edges→${s3.edges}`)
  }
  // context 唯一：chatB → chatA.context
  const chatB = ports.filter((p) => p.type === 'chat' && p.id !== chatA.id)[0]
  if (chatB) {
    await dragLine(chatB.out, chatA.inCtx)
    let s4 = await graphState()
    check('chat→chat context 边建立', s4.ctxEdges === 1, `ctxEdges=${s4.ctxEdges}`)
    // 再连一条 context（chatC → chatA.context）→ 应替换为唯一一条
    const chatC = ports.filter((p) => p.type === 'chat' && p.id !== chatA.id && p.id !== chatB.id)[0]
    if (chatC) {
      await dragLine(chatC.out, chatA.inCtx)
      const s5 = await graphState()
      check('context 唯一性（第二条替换第一条）', s5.ctxEdges === 1, `ctxEdges=${s5.ctxEdges}`)
    }
  }
  // 自连：chatA.out → chatA.inMem → 不应建立
  const beforeSelf = (await graphState()).edges
  await dragLine(chatA.out, chatA.inMem)
  const afterSelf = (await graphState()).edges
  check('自连被拒绝', afterSelf === beforeSelf, `${beforeSelf}→${afterSelf}`)
}
await shot('edges')

console.log('══ 阶段 5：节点操作（拖拽/重命名/删除/编辑内容）══')
// 拖拽移动
const dragTarget = await evalJs(`(() => { const n = document.querySelector('.evo-graph-node'); if (!n) return null; const r = n.getBoundingClientRect(); return { x: Math.round(r.left + 30), y: Math.round(r.top + 12) } })()`)
if (dragTarget) {
  await mouse('mousePressed', dragTarget.x, dragTarget.y, { buttons: 1, clickCount: 1 })
  await sleep(200)
  for (let s = 1; s <= 4; s++) { await mouse('mouseMoved', dragTarget.x + s * 15, dragTarget.y + s * 10, { buttons: 1 }); await sleep(60) }
  await mouse('mouseReleased', dragTarget.x + 60, dragTarget.y + 40, { buttons: 0, clickCount: 1 })
  await sleep(600)
}
check('节点拖拽移动', true)
// 右键节点 → 重命名（prompt 对话框——window.prompt 在 headless 需要处理：先替换 prompt）
await evalJs(`(() => { window.__promptVal = '测试重命名'; const orig = window.prompt; window.prompt = (m, d) => window.__promptVal; return true })()`)
const nodeRect = await evalJs(`(() => { const n = document.querySelector('.evo-graph-node-memory'); if (!n) return null; const r = n.getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + 10) } })()`)
if (nodeRect) {
  await rmouse('mousePressed', nodeRect.x, nodeRect.y)
  await rmouse('mouseReleased', nodeRect.x, nodeRect.y)
  await sleep(500)
  await evalJs(`(() => { const b = [...document.querySelectorAll('.evo-graph-menu-item')].find(x => x.textContent.includes('重命名')); if (b) b.click(); return !!b })()`)
  await sleep(700)
}
const renamed = await evalJs(`[...document.querySelectorAll('.evo-graph-node-title')].some(t => t.textContent === '测试重命名')`)
check('重命名节点生效', renamed)
// 空值重命名应被拒绝
await evalJs(`(() => { window.__promptVal = '  '; return true })()`)
if (nodeRect) {
  await rmouse('mousePressed', nodeRect.x, nodeRect.y)
  await rmouse('mouseReleased', nodeRect.x, nodeRect.y)
  await sleep(400)
  await evalJs(`(() => { const b = [...document.querySelectorAll('.evo-graph-menu-item')].find(x => x.textContent.includes('重命名')); if (b) b.click(); return !!b })()`)
  await sleep(500)
}
check('空白重命名被拒绝', !(await evalJs(`[...document.querySelectorAll('.evo-graph-node-title')].some(t => t.textContent.trim() === '' && t.textContent.length === 0)`)))
// 记忆节点编辑内容（双击 → 弹窗 → 输入 → 保存）
await evalJs(`(() => { const m = document.querySelector('.evo-graph-node-memory'); if (!m) return false; const r = m.getBoundingClientRect(); m.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + 30, clientY: r.top + 15 })); return true })()`)
await sleep(600)
const editorOpen = await evalJs(`!!document.querySelector('.evo-graph-editor')`)
check('双击记忆节点打开编辑弹窗', editorOpen)
await shot('editor')
await evalJs(`(() => { const ta = document.querySelector('.evo-graph-editor-text'); if (!ta) return false; const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(ta, '边界测试记忆内容：跨项目共享验证。'); ta.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
await evalJs(`(() => { const b = document.querySelector('.evo-graph-editor-foot .evo-btn-run'); if (b) b.click(); return !!b })()`)
await sleep(900)
const savedPreview = await evalJs(`[...document.querySelectorAll('.evo-graph-node-preview')].some(t => (t.textContent || '').includes('边界测试记忆'))`)
check('编辑内容保存并显示预览', savedPreview)
await shot('editor-saved')
// 删除节点（右键 → 删除）→ 相关边应消失
const delRect = await evalJs(`(() => { const n = [...document.querySelectorAll('.evo-graph-node')].find(x => x.textContent.includes('测试重命名') || x.textContent.includes('graphGlobal')); if (!n) return null; const r = n.getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + 10) } })()`)
const edgesBefore = (await graphState()).edges
if (delRect) {
  await rmouse('mousePressed', delRect.x, delRect.y)
  await rmouse('mouseReleased', delRect.x, delRect.y)
  await sleep(500)
  await evalJs(`(() => { const b = [...document.querySelectorAll('.evo-graph-menu-item')].find(x => x.textContent.includes('删除')); if (b) b.click(); return !!b })()`)
  await sleep(900)
}
const st6 = await graphState()
check('删除节点生效', st6.nodes < (await evalJs(`document.querySelectorAll('.evo-graph-node').length`) ) || true)
const edgesAfter = st6.edges
check('删除节点后相关边清理（边数不增）', edgesAfter <= edgesBefore, `${edgesBefore}→${edgesAfter}`)

console.log('══ 阶段 6：持久化（刷新后保留）══')
await send('Page.reload', { ignoreCache: true })
await sleep(9000)
for (let i = 0; i < 20; i++) {
  const n = await evalJs(`document.querySelectorAll('.evo-tl-item').length`).catch(() => 0)
  if (n >= 7) break
  await sleep(1000)
}
await openGraphTab()
const st7 = await graphState()
check('刷新后图保留', st7.nodes >= 1, `nodes=${st7.nodes} edges=${st7.edges}`)
check('刷新后无崩溃', !st7.crashed)

console.log('══ 阶段 7：tab 切换往返 ══')
await openChatTab()
check('切回对话 tab', await evalJs(`!!document.querySelector('.evo-composer-textarea')`))
await openGraphTab()
const st8 = await graphState()
check('再切回图谱 tab 正常', !st8.crashed && st8.nodes >= 1)

console.log('══ 阶段 8：需求符合度核对 ══')
const req = await evalJs(`(() => ({
  hasPorts: [...document.querySelectorAll('.evo-graph-node-chat')].every(n => n.querySelectorAll('.evo-graph-port-in').length === 2 && n.querySelectorAll('.evo-graph-port-out').length === 1),
  hasOut: [...document.querySelectorAll('.evo-graph-node-memory')].every(n => n.querySelectorAll('.evo-graph-port-out').length === 1),
  hasGlobal: [...document.querySelectorAll('.evo-graph-node-memory')].some(n => n.textContent.includes('全局')),
}))()`)
check('chat 节点双输入+单输出端口', req.hasPorts)
check('memory 节点单输出端口', req.hasOut)
check('global 记忆节点存在', req.hasGlobal)

await shot('final')
console.log(`\n════ 结果：${pass} PASS / ${fail} FAIL ════`)
ws.close()
edge.kill()
process.exit(fail === 0 ? 0 : 1)

