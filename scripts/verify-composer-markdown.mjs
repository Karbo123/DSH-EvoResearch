// E2E：统计行移出输入框 + Markdown 实时装饰层 + 快捷键（Ctrl+B 等）
import WebSocket from 'ws'
import { writeFileSync, mkdirSync } from 'node:fs'
const CDP_PORT = '47510'
const APP_URL = 'http://127.0.0.1:7526/?sidebar=1'
const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
const page = targets.find((t) => t.type === 'page')
if (!page) { console.log('NO PAGE'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
}
ws.on('message', (m) => {
  const d = JSON.parse(m.toString())
  if (d.id && pending.has(d.id)) {
    const p = pending.get(d.id)
    pending.delete(d.id)
    d.error ? p.reject(new Error(JSON.stringify(d.error))) : p.resolve(d.result)
  }
})
await new Promise((r) => ws.on('open', r))
async function evalJs(expr, timeoutMs = 8000) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('EVAL_TIMEOUT')), timeoutMs)),
  ])
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const keyCombo = async (key, modifiers = 0, code = '') => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: code || key, modifiers, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: code || key, modifiers, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 })
}

await send('Page.enable')
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Page.reload', { ignoreCache: true })
await sleep(8000)
for (let i = 0; i < 15; i++) {
  const n = await evalJs(`document.querySelectorAll('.evo-tl-row-main').length`)
  if (n > 0) break
  await sleep(1000)
}
await evalJs(`document.querySelector('.evo-tl-row-main')?.click()`)
await sleep(2500)

// ── 1) 统计行位置 ──
const stats = await evalJs(`(() => {
  const composer = document.querySelector('.evo-composer')
  const statsWrap = document.querySelector('.evo-composer-stats')
  const statsLine = document.querySelector('.evo-composer-stats .evo-stats-line')
  if (!composer || !statsWrap) return { missing: true }
  const cr = composer.getBoundingClientRect()
  const sr = statsWrap.getBoundingClientRect()
  return {
    inComposer: composer.contains(statsWrap),
    gap: Math.round(sr.top - cr.bottom),
    centerDelta: Math.round(Math.abs((cr.left + cr.width / 2) - (sr.left + sr.width / 2))),
    statsWidthDelta: Math.round(Math.abs(cr.width - sr.width)),
    statsText: (statsLine?.textContent ?? '').slice(0, 80),
  }
})()`)
console.log('STATS POSITION:', JSON.stringify(stats))

// ── 2) 实时装饰层 ──
const deco = await evalJs(`(() => {
  const ta = document.querySelector('.evo-composer-textarea')
  const decoEl = document.querySelector('.evo-composer-deco')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, '# 标题\\n**加粗** 和 *斜体* 还有 [链接](https://a.b) 与 ~~删除~~ 和 \`代码\`\\n- 列表项\\n> 引用')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return {
    decoExists: !!decoEl,
    hasH: !!decoEl?.querySelector('.evod-h1'),
    hasB: !!decoEl?.querySelector('b'),
    hasI: !!decoEl?.querySelector('i'),
    hasS: !!decoEl?.querySelector('s'),
    hasCode: !!decoEl?.querySelector('.evod-code'),
    hasLink: !!decoEl?.querySelector('.evod-link'),
    hasLi: !!decoEl?.querySelector('.evod-li'),
    hasQuote: !!decoEl?.querySelector('.evod-quote'),
    markers: decoEl?.querySelectorAll('.evod-m').length ?? 0,
    innerTextLen: decoEl?.innerText.length ?? 0,
    valueLen: ta.value.length,
    taFill: getComputedStyle(ta).webkitTextFillColor,
    caret: getComputedStyle(ta).caretColor,
  }
})()`)
console.log('DECO:', JSON.stringify(deco))

// ── 3) 快捷键：框选 + Ctrl+B 加粗 ──
await evalJs(`(() => { const ta = document.querySelector('.evo-composer-textarea'); ta.focus(); ta.setSelectionRange(0, ta.value.length); return true })()`)
await keyCombo('b', 2)
await sleep(400)
const kbd2 = await evalJs(`(() => {
  const ta = document.querySelector('.evo-composer-textarea')
  const v = ta.value
  return { wrapped: v.startsWith('**') && v.endsWith('**'), selStart: ta.selectionStart, selEnd: ta.selectionEnd, head: v.slice(0, 30) }
})()`)
console.log('CTRL+B:', JSON.stringify(kbd2))

// ── 4) 再按一次 → 取消包裹 ──
await keyCombo('b', 2)
await sleep(400)
const kbd3 = await evalJs(`(() => {
  const ta = document.querySelector('.evo-composer-textarea')
  return { unwrapped: !ta.value.startsWith('**'), selStart: ta.selectionStart, selEnd: ta.selectionEnd }
})()`)
console.log('CTRL+B AGAIN (unwrap):', JSON.stringify(kbd3))

// ── 5) 无选区 Ctrl+I 斜体（插入标记对、光标居中）──
await evalJs(`(() => { const ta = document.querySelector('.evo-composer-textarea'); ta.focus(); ta.setSelectionRange(0, 0); return true })()`)
await keyCombo('i', 2)
await sleep(400)
const kbd4 = await evalJs(`(() => {
  const ta = document.querySelector('.evo-composer-textarea')
  return { head: ta.value.slice(0, 8), selStart: ta.selectionStart, selEnd: ta.selectionEnd }
})()`)
console.log('CTRL+I (no selection):', JSON.stringify(kbd4))

// ── 6) 截图 ──
const shot = await send('Page.captureScreenshot', { format: 'png' })
mkdirSync('.tmp-dev', { recursive: true })
writeFileSync('.tmp-dev/images/visual-composer.png', Buffer.from(shot.data, 'base64'))
console.log('saved .tmp-dev/images/visual-composer.png')
ws.close()
process.exit(0)
