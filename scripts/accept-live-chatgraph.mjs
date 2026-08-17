// Live browser acceptance for Chat Graph: seed one realistic research project,
// exercise the graph UI, and save desktop/mobile screenshots.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'

const APP_PORT = process.argv[2] ?? process.env.EVORESEARCH_APP_PORT ?? '3081'
const APP = `http://127.0.0.1:${APP_PORT}`
const ROOT = 'D:\\DSH-Research\\.tmp-port'
const debugPort = 47501
const profile = `${ROOT}\\edge-live-${Date.now()}`
mkdirSync('/mnt/d/DSH-Research/.tmp-port', { recursive: true })
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let page
for (let i = 0; i < 40; i += 1) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
    page = targets.find((target) => target.type === 'page')
    if (page) break
  } catch { /* Edge is still starting. */ }
  await sleep(250)
}
if (!page) throw new Error('Edge CDP target did not start')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })
let id = 0
const pending = new Map()
ws.on('message', (raw) => {
  const message = JSON.parse(raw.toString())
  const item = pending.get(message.id)
  if (!item) return
  pending.delete(message.id)
  if (message.error) item.reject(new Error(message.error.message))
  else item.resolve(message.result)
})
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id
    pending.set(requestId, { resolve, reject })
    ws.send(JSON.stringify({ id: requestId, method, params }))
  })
}
async function ev(expression, timeout = 15000) {
  const result = await Promise.race([
    send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`evaluate timeout: ${expression.slice(0, 80)}`)), timeout)),
  ])
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result?.value
}
async function waitFor(expression, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    if (await ev(expression).catch(() => false)) return true
    await sleep(500)
  }
  return false
}
async function clickText(selector, text) {
  return ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => (x.textContent || '').includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true })()`)
}
async function screenshot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(`${ROOT}\\${name}.png`, Buffer.from(shot.data, 'base64'))
}

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: `${APP}/?sidebar=1` })
if (!await waitFor('!!document.querySelector(".evo-app")')) throw new Error('app did not render')
await sleep(1200)

const question = '我想研究 RAG 是否能降低科研文献问答中的无依据陈述；算力只有单张 RTX 4090，请给出一个可复现的 BM25 与向量检索基线。'
const textarea = '.evo-composer-textarea'
await ev(`(() => { const el = document.querySelector(${JSON.stringify(textarea)}); if (!el) return false; const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(question)}); el.dispatchEvent(new Event('input', {bubbles: true})); return true })()`)
if (!await clickText('button', '发送')) throw new Error('send button unavailable')
if (!await waitFor('!!document.querySelector(".evo-msg-bubble-user")')) throw new Error('real research question was not sent')
await sleep(1800)
const sessionId = await ev(`window.__evoresearch?.sessions?.current ?? new URL(location.href).searchParams.get('threadId') ?? ''`)
// The visible cwd is the same session-bound workspace used by the panels.
// SessionManager intentionally keeps its current id private in this build,
// so reading the rendered title is more reliable than guessing from projects.
const projectPath = await ev(`document.querySelector('.evo-cwd')?.getAttribute('title') ?? document.querySelector('.evo-cwd')?.textContent ?? ''`)
if (typeof projectPath !== 'string' || projectPath === '') throw new Error('current session has no visible project workspace')
await sleep(700)

if (!await clickText('.evo-tab', '图谱')) throw new Error('graph tab unavailable')
if (!await waitFor('!!document.querySelector(".evo-graph-canvas")')) throw new Error('graph canvas unavailable')
await sleep(700)
console.log('LIVE DEBUG', await ev(`({ url: location.href, buttons: [...document.querySelectorAll('.evo-graph-btn')].map((x) => ({text: x.textContent, disabled: x.disabled})), body: document.body.innerText.slice(0, 120) })`))
await ev(`(() => { window.__liveFetchLog = []; const original = window.fetch; window.fetch = (...args) => { const result = original(...args); result.then((response) => { if (String(args[0]).includes('/graph-')) response.clone().text().then((body) => window.__liveFetchLog.push({ url: String(args[0]), status: response.status, body })); }); return result }; return true })()`)

// Use the visible controls to create real sessions and graph nodes.
const beforeUi = await ev(`({ chats: document.querySelectorAll('.evo-graph-node-chat').length, memories: document.querySelectorAll('.evo-graph-node-memory').length })`)
await clickText('.evo-graph-btn', '聊天')
if (!await waitFor(`document.querySelectorAll('.evo-graph-node-chat').length === ${beforeUi.chats + 1}`)) throw new Error('chat node was not created')
if (!await waitFor('![...document.querySelectorAll(".evo-graph-btn")].find((x) => (x.textContent || "").includes("记忆节点"))?.disabled')) throw new Error('graph toolbar did not become ready')
await clickText('.evo-graph-btn', '记忆节点')
await sleep(1200)
console.log('MEMORY DEBUG', await ev(`({ nodes: document.querySelectorAll('.evo-graph-node').length, memories: document.querySelectorAll('.evo-graph-node-memory').length, error: document.querySelector('.evo-panel-error')?.textContent ?? null, requests: window.__liveFetchLog })`))
if (!await waitFor(`document.querySelectorAll('.evo-graph-node-memory').length === ${beforeUi.memories + 1}`)) throw new Error('project memory node was not created')
if (!await waitFor('![...document.querySelectorAll(".evo-graph-btn")].find((x) => (x.textContent || "").includes("全局记忆"))?.disabled')) throw new Error('memory toolbar did not become ready')
await clickText('.evo-graph-btn', '全局记忆')
if (!await waitFor(`document.querySelectorAll('.evo-graph-node-memory').length === ${beforeUi.memories + 2}`)) throw new Error('global memory node was not created')
await sleep(500)

// Enrich the UI-created graph with domain-specific labels/content and explicit
// reference edges through the same public HTTP route used by the component.
const graphResponse = await ev(`fetch('/evoresearch/fs/graph-get', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ workspaceDir: ${JSON.stringify(projectPath)} }) }).then((r) => r.json())`)
if (!graphResponse?.ok || !graphResponse.value?.graph) throw new Error(`graph get failed: ${JSON.stringify(graphResponse)}`)
const graph = graphResponse.value.graph
const chat = graph.nodes.filter((node) => node.type === 'chat').at(-1)
const memoryNodes = graph.nodes.filter((node) => node.type === 'memory' || node.displayKind === 'memory' || node.displayKind === 'memory-collection')
const projectMemory = memoryNodes.find((node) => node.scope === 'project')
const globalMemory = memoryNodes.find((node) => node.scope === 'global')
if (!chat || !projectMemory || !globalMemory) throw new Error('created graph shape is missing explicit project/global memory nodes')
const notePath = `${projectPath}\\research-notes\\rag-baseline.md`
const noteText = '# RAG 文献问答幻觉评估\n\n研究问题：在单张 RTX 4090 约束下，BM25 与向量检索是否能降低科研文献问答的无依据陈述？\n\n评价：citation accuracy、answerable accuracy、检索延迟；先用 200 个带证据段落的问题做小规模基线。\n'
const writeNote = await ev(`fetch('/evoresearch/fs/write', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ root: ${JSON.stringify(projectPath)}, path: ${JSON.stringify(notePath)}, text: ${JSON.stringify(noteText)} }) }).then((r) => r.json())`)
if (!writeNote?.ok) throw new Error(`note write failed: ${JSON.stringify(writeNote)}`)
chat.title = 'Idea: RAG 文献问答幻觉评估'
chat.x = 520; chat.y = 220
projectMemory.title = 'Evidence: BM25/向量检索基线'
projectMemory.content = '200 个带证据段落的问题；比较 BM25、bge-small 向量检索；记录 citation accuracy 与延迟。'
projectMemory.x = 140; projectMemory.y = 200
globalMemory.title = 'Constraint: 单张 RTX 4090'
globalMemory.content = '只允许单张 RTX 4090；优先小模型、可复现实验和低成本 ablation。'
globalMemory.x = 140; globalMemory.y = 370
const resource = {
  id: `resource-${Date.now().toString(36)}`,
  type: 'resource', displayKind: 'file', title: 'Note: RAG baseline protocol',
  x: 520, y: 390, workspaceDir: projectPath, scope: 'project', ref: { kind: 'file', path: 'research-notes\\rag-baseline.md' },
  status: 'available', origin: 'imported', createdAt: Date.now(), updatedAt: Date.now(),
}
graph.nodes = [chat, projectMemory, globalMemory, resource]
graph.edges = [
  { id: `edge-${Date.now().toString(36)}-a`, from: projectMemory.id, to: chat.id, toPort: 'memory', behavior: 'reference', enabled: true, label: '检索基线' },
  { id: `edge-${Date.now().toString(36)}-b`, from: globalMemory.id, to: chat.id, toPort: 'memory', behavior: 'reference', enabled: true, label: '算力约束' },
  { id: `edge-${Date.now().toString(36)}-c`, from: resource.id, to: chat.id, toPort: 'memory', behavior: 'reference', enabled: true, label: '研究协议' },
]
const saved = await ev(`fetch('/evoresearch/fs/graph-save', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ workspaceDir: ${JSON.stringify(projectPath)}, graph: ${JSON.stringify(graph)}, rev: ${JSON.stringify(graphResponse.value.rev)} }) }).then((r) => r.json())`)
if (!saved?.ok || !saved.value?.ok) throw new Error(`graph save failed: ${JSON.stringify(saved)}`)
const afterSave = await ev(`fetch('/evoresearch/fs/graph-get', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ workspaceDir: ${JSON.stringify(projectPath)} }) }).then((r) => r.json()).then((r) => ({ nodes: r.value?.graph?.nodes?.map((n) => n.id) ?? [], edges: r.value?.graph?.edges ?? [], rev: r.value?.rev ?? null }))`)
console.log('PERSISTED BEFORE RELOAD', JSON.stringify(afterSave))
// Reload so the component reads the persisted graph instead of showing the
// pre-save React snapshot, then activate the fixed Chat Graph workspace tab.
await send('Page.reload')
await sleep(1200)
console.log('REENTER DEBUG', await ev(`(() => {
  const tabs = [...document.querySelectorAll('.evo-tab')].map((x) => ({text: x.textContent, active: x.getAttribute('data-active')}))
  const tab = [...document.querySelectorAll('.evo-tab')].find((x) => (x.textContent || '').includes('图谱'))
  if (tab) tab.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return { tabs, clicked: !!tab }
})()`))
await sleep(800)
if (!await waitFor('!!document.querySelector(".evo-graph-canvas")')) throw new Error('graph reload failed')
if (!await waitFor('document.querySelectorAll(".evo-graph-node").length >= 4 && document.querySelectorAll(".evo-graph-edge-label").length >= 3')) {
  console.log('RENDER DEBUG', await ev(`({ canvas: !!document.querySelector('.evo-graph-canvas'), nodes: document.querySelectorAll('.evo-graph-node').length, edgeLabels: document.querySelectorAll('.evo-graph-edge-label').length, paths: document.querySelectorAll('.react-flow__edge-path').length, graphEdges: document.querySelectorAll('.evo-graph-edge').length, svgs: document.querySelectorAll('.evo-graph-canvas svg').length, error: document.querySelector('.evo-panel-error')?.textContent ?? null, body: document.body.innerText.slice(-800) })`))
  throw new Error('persisted graph did not render')
}
await sleep(500)

const desktopState = await ev(`(() => ({
  nodes: document.querySelectorAll('.evo-graph-node').length,
  chats: document.querySelectorAll('.evo-graph-node-chat').length,
  memories: document.querySelectorAll('.evo-graph-node-memory').length,
  resources: document.querySelectorAll('.evo-graph-node-resource').length,
  scopes: [...document.querySelectorAll('.evo-graph-node-memory')].map((x) => x.getAttribute('data-global') === 'true' ? 'global' : 'project').sort(),
  edges: document.querySelectorAll('.evo-graph-edge-label').length,
  labels: [...document.querySelectorAll('.evo-graph-edge-label')].map((x) => x.textContent),
  titles: [...document.querySelectorAll('.evo-graph-node-title')].map((x) => x.textContent),
  error: document.querySelector('.evo-panel-error')?.textContent ?? null,
}))()`)
await screenshot('live-chatgraph-desktop')

// Verify the same persisted graph against the light theme before exercising
// filtering and the narrow layout.
await ev(`(() => { localStorage.setItem('evoresearch-theme', 'light'); document.documentElement.classList.remove('dark'); document.documentElement.style.colorScheme = 'light'; return true })()`)
await sleep(250)
await screenshot('live-chatgraph-light')
await ev(`(() => { localStorage.setItem('evoresearch-theme', 'dark'); document.documentElement.classList.add('dark'); document.documentElement.style.colorScheme = 'dark'; return true })()`)
await sleep(250)

// Selection opens the inspector; search filters to the protocol note.
await ev(`(() => { const node = document.querySelector('[data-node-id="${resource.id}"]'); if (!node) return false; node.click(); return true })()`)
await sleep(350)
const inspector = await ev(`document.querySelector('.evo-graph-inspector')?.innerText ?? ''`)
const search = await ev(`(() => { const input = document.querySelector('.evo-graph-search input'); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'protocol'); input.dispatchEvent(new Event('input', {bubbles: true})); return true })()`)
await sleep(500)
const searchState = await ev(`({ visible: document.querySelectorAll('.evo-graph-node:not(.evo-graph-narrow-item)').length, titles: [...document.querySelectorAll('.evo-graph-node-title')].map((x) => x.textContent) })`)
await screenshot('live-chatgraph-search')

// Clear search before checking keyboard activation on the visible XYFlow canvas.
await ev(`(() => { const input = document.querySelector('.evo-graph-search input'); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ''); input.dispatchEvent(new Event('input', {bubbles: true})); return true })()`)
let graphA11y = await ev(`(() => {
  const flow = document.querySelector('.react-flow[aria-label="Chat Graph 研究上下文图"]')
  const nodes = [...document.querySelectorAll('[data-node-id][role="group"]')]
  const first = nodes.find((node) => node.classList.contains('evo-graph-node-memory')) ?? nodes[0]
  let keyboardFocused = false
  if (first) { first.focus(); keyboardFocused = document.activeElement === first; first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) }
  return {
    canvas: !!flow,
    nodesFocusable: nodes.length > 0 && nodes.every((node) => node.tabIndex === 0 && !!node.getAttribute('aria-label')),
    nodeLabels: nodes.map((node) => node.getAttribute('aria-label')),
    controls: !!document.querySelector('[aria-label="图谱缩放与适配控制"]'),
    minimap: !!document.querySelector('[aria-label="图谱小地图"]'),
    keyboardFocused,
  }
})()`)
await sleep(350)
graphA11y = { ...graphA11y, keyboardActivation: !!(await ev(`!!document.querySelector('.evo-graph-editor, .evo-graph-inspector')`)) }
await ev(`(() => { document.querySelector('.evo-graph-editor-mask')?.click(); return true })()`)

// Exercise narrow layout rendering (responsive list mode).
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await ev(`(() => { const button = document.querySelector('.evo-topbar .evo-icon-btn'); if (!button) return false; button.click(); return true })()`)
if (!await waitFor('!document.querySelector(".evo-left")')) throw new Error('narrow sidebar did not close')
await sleep(800)
const narrowState = await ev(`({ list: document.querySelectorAll('.evo-graph-narrow-item').length, canvas: !!document.querySelector('.evo-graph-canvas'), overflow: document.documentElement.scrollWidth > 390, text: document.querySelector('.evo-graph')?.innerText?.slice(0, 500) ?? '' })`)
await screenshot('live-chatgraph-mobile')
graphA11y = { ...graphA11y, narrowButtons: await ev(`([...document.querySelectorAll('.evo-graph-narrow-item')]).length > 0 && [...document.querySelectorAll('.evo-graph-narrow-item')].every((node) => node.tagName === 'BUTTON' && !!node.getAttribute('aria-label'))`) }

const persisted = await ev(`fetch('/evoresearch/fs/graph-get', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ workspaceDir: ${JSON.stringify(projectPath)} }) }).then((r) => r.json()).then((r) => ({ ok: r.ok, nodes: r.value?.graph?.nodes?.length ?? -1, edges: r.value?.graph?.edges?.length ?? -1, rev: r.value?.rev ?? -1 }))`)
const checks = {
  savedGraph: persisted.ok === true && persisted.nodes === 4 && persisted.edges === 3,
  renderedGraph: desktopState.nodes === 4 && desktopState.chats === 1 && desktopState.memories === 2 && desktopState.resources === 1 && desktopState.edges === 3,
  explicitScopes: JSON.stringify(desktopState.scopes) === JSON.stringify(['global', 'project']),
  inspectorOpens: inspector.includes('RAG baseline protocol'),
  searchFindsProtocol: search === true && searchState.titles.some((title) => title.includes('RAG baseline protocol')),
  narrowListNoOverflow: narrowState.list === 4 && narrowState.overflow === false,
  graphA11y: graphA11y.canvas && graphA11y.nodesFocusable && graphA11y.controls && graphA11y.minimap && graphA11y.narrowButtons && graphA11y.keyboardFocused && graphA11y.keyboardActivation,
}
console.log(JSON.stringify({ projectPath, sessionId, desktopState, inspector: inspector.slice(0, 240), search, searchState, narrowState, persisted, graphA11y, checks }, null, 2))
if (Object.values(checks).some((value) => value !== true)) throw new Error(`Chat Graph 网页验收失败: ${Object.entries(checks).filter(([, value]) => value !== true).map(([name]) => name).join(', ')}`)
ws.close()
edge.kill()
