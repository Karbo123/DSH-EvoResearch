/**
 * 验证 Round 46 本地化：默认中文界面文案。
 * 用 CDP headless Edge 打开 sidecar 页面，检查关键中文文案与按钮 title。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = process.env.EVORESearch_PORT || '12892'
const URL = `http://127.0.0.1:${PORT}/?sidebar=1`
const CDP_PORT = 44000 + Math.floor(Math.random() * 2500)

const profile = mkdtempSync(join(tmpdir(), 'evo-l10n-'))
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1500,950', '--no-first-run', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(url) {
  const res = await fetch(url)
  return res.json()
}

let ws = null
let seq = 0
const pending = new Map()

function send(method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)) } }, 15000)
  })
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(`eval failed: ${JSON.stringify(r.exceptionDetails).slice(0, 300)}`)
  return r.result?.value
}

async function waitFor(expr, timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await evaluate(expr)
      if (v) return v
    } catch { /* retry */ }
    await sleep(400)
  }
  throw new Error(`waitFor timeout: ${expr}`)
}

const failures = []
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.log(`  ✗ ${name} ${detail}`); failures.push(name) }
}

try {
  // 等待 CDP 就绪
  let target = null
  for (let i = 0; i < 30; i++) {
    try {
      const list = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`)
      target = list.find((t) => t.type === 'page')
      if (target) break
    } catch { /* not ready */ }
    await sleep(500)
  }
  if (!target) throw new Error('no page target')

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    }
  }
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: URL })

  // 等 React 挂载 + 侧栏渲染
  await waitFor(`document.querySelector('.evo-app') !== null`)
  await sleep(1500)

  // 1. 侧栏导航中文
  const sidebarText = await evaluate(`document.querySelector('.evo-left').innerText`)
  console.log('— 侧栏文案 —')
  check('新建对话', sidebarText.includes('新建对话'))
  check('科研技能', sidebarText.includes('科研技能'))
  check('科研记忆', sidebarText.includes('科研记忆'))
  check('定时任务', sidebarText.includes('定时任务'))
  check('消息通道', sidebarText.includes('消息通道'))
  check('科研团队', sidebarText.includes('科研团队'))
  check('导入项目', sidebarText.includes('导入项目'))

  // 2. 顶栏按钮 title 中文
  console.log('— 顶栏 title —')
  const topTitles = await evaluate(`Array.from(document.querySelectorAll('.evo-topbar button, .evo-topbar [title]')).map(b => b.getAttribute('title')).filter(Boolean)`)
  check('返回首页', topTitles.includes('返回首页'))
  check('展开导航', topTitles.includes('显示导航') || topTitles.includes('收起导航') || topTitles.includes('展开导航') || topTitles.includes('隐藏导航'))
  check('侧边对话', topTitles.includes('侧边对话'))
  check('语言切换', topTitles.some((x) => x.includes('语言')))
  check('主题切换', topTitles.some((x) => x.includes('浅色') || x.includes('深色')))
  check('设置', topTitles.includes('设置'))

  // 3. 会话列表行按钮 title（若有会话；无会话则跳过行级检查）
  console.log('— 会话行 —')
  const rows = await evaluate(`document.querySelectorAll('.evo-tl-row').length`)
  console.log(`  （会话行数: ${rows}）`)
  if (rows > 0) {
    const rowTitles = await evaluate(`Array.from(document.querySelectorAll('.evo-tl-row-act')).map(b => b.getAttribute('title')).filter(Boolean)`)
    check('重命名', rowTitles.includes('重命名'))
    check('标签颜色', rowTitles.includes('标签颜色'))
    check('置顶', rowTitles.includes('置顶'))
    check('侧边对话 title', rowTitles.includes('由此会话创建侧边对话'))
    check('导出 JSON', rowTitles.includes('导出 JSON'))
    check('导出 Markdown', rowTitles.includes('导出 Markdown'))
    check('删除会话', rowTitles.includes('删除会话'))
  }

  // 4. 欢迎页 / 输入区
  console.log('— 欢迎页 / 输入 —')
  const welcome = await evaluate(`document.querySelector('.evo-welcome h1')?.textContent ?? ''`)
  check('科研在此进化', welcome.includes('科研在此进化'))
  const placeholder = await evaluate(`document.querySelector('.evo-composer-textarea')?.getAttribute('placeholder') ?? ''`)
  check('向 EvoResearch 提问…', placeholder.includes('向 EvoResearch 提问'))

  // 5. 面板（记忆面板）——通过侧栏导航进入
  console.log('— EvoMemory 面板 —')
  await evaluate(`(function(){ const b = Array.from(document.querySelectorAll('.evo-tl-item')).find(function(x){ return x.textContent.includes('科研记忆') }); if (b) b.click(); return true })()`)
  await sleep(1200)
  const memText = await evaluate(`document.querySelector('.evo-right, .evo-insp-body, .evo-panel')?.innerText ?? ''`)
  check('项目', memText.includes('项目'))
  check('轮次目录', memText.includes('轮次目录'))
  check('目标', memText.includes('目标'))
  check('概览/历史/身份/知识 tab', memText.includes('概览') && memText.includes('历史') && memText.includes('身份') && memText.includes('知识'))

  // 6. 定时任务面板
  console.log('— Scheduled 面板 —')
  await evaluate(`(function(){ const b = Array.from(document.querySelectorAll('.evo-tl-item')).find(function(x){ return x.textContent.includes('定时任务') }); if (b) b.click(); return true })()`)
  await sleep(1200)
  const schedText = await evaluate(`document.querySelector('.evo-right, .evo-insp-body, .evo-panel')?.innerText ?? ''`)
  const schedPlaceholder = await evaluate(`Array.from(document.querySelectorAll('.evo-panel input')).map(function(i){ return i.getAttribute('placeholder') || '' }).join('|')`)
  const schedAria = await evaluate(`Array.from(document.querySelectorAll('.evo-panel button')).map(function(b){ return (b.getAttribute('aria-label') || '') + (b.title || '') }).join('|')`)
  check('任务名称', schedPlaceholder.includes('任务名称'))
  check('每日/每周/每月/自定义', schedText.includes('每日') && schedText.includes('每周') && schedText.includes('每月') && schedText.includes('自定义'))
  check('添加按钮', schedText.includes('添加'))

  // 7. 语言切换按钮 title（顶栏）
  const langBtn = await evaluate(`Array.from(document.querySelectorAll('.evo-topbar button')).find(b => (b.getAttribute('title') || '').includes('语言'))?.getAttribute('title') ?? ''`)
  check('语言按钮 title', langBtn.includes('语言'))

  console.log(failures.length === 0 ? '\nALL PASS' : `\nFAILURES: ${failures.join(', ')}`)
} catch (e) {
  console.error('VERIFY ERROR:', e.message)
  process.exitCode = 1
} finally {
  try { ws?.close() } catch { /* noop */ }
  try { edge.kill() } catch { /* noop */ }
  await sleep(500)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* noop */ }
}
