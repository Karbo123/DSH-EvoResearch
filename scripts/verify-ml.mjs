/**
 * ML 示例 + 项目环境全流程 E2E（可见窗口监督版）：
 * 1) Markdown 行距（计算样式 1.58）；
 * 2) ML 例 1：纯标准库迷你神经网络训 XOR → 准确率；
 * 3) 项目环境：自动创建检测 → 若无则 UI 创建（Python 3.12）→ 安装 scikit-learn；
 * 4) ML 例 2：项目虚拟环境跑 sklearn 随机森林 → 验证 DSH_VENV_PYTHON 被使用；
 * 5) 泄漏复检。
 * 用法：node scripts/verify-ml.mjs <CDP端口> <APP端口>
 */
const CDP_PORT = process.argv[2] || '47510'
const APP_PORT = process.argv[3] || '3062'
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
await send('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}/?sidebar=1` })
for (let i = 0; i < 60; i++) { if (await ev(`!!document.querySelector('.evo-app')`).catch(() => false)) break; await sleep(500) }
await sleep(2000)

const report = {}
report.lineHeight = await ev(`(function(){ const el = document.querySelector('.evo-md') ?? document.body; return getComputedStyle(el).lineHeight })()`)

const sendMsg = async (text) => {
  await ev(`(function(){ const el = document.querySelector('.evo-composer-textarea'); if (!el) return false; const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(400)
  await ev(`(function(){ const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '发送' || (x.textContent || '').trim() === 'Send'); if (b) b.click(); return !!b })()`)
}
const bubbleCount = () => ev(`document.querySelectorAll('.evo-msg-bubble-assistant').length`)
const waitNewReply = async (before, maxTurns = 100) => {
  for (let i = 0; i < maxTurns; i++) {
    await sleep(3000)
    const pendingQ = await ev(`document.querySelectorAll('.evo-question').length`)
    if (pendingQ > 0) {
      await ev(`(function(){ const q = document.querySelector('.evo-question'); const opt = q ? q.querySelector('.evo-question-opt') : null; if (opt) opt.click(); return !!opt })()`)
      await sleep(600)
      await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-question-acts button')).find((x) => (x.textContent || '').includes('提交')); if (b) b.click(); return !!b })()`)
      await sleep(2000)
    }
    const now = await bubbleCount()
    const running = await ev(`!!document.querySelector('.evo-composer-stop')`)
    if (now > before && !running) return true
  }
  return false
}

// ── ML 例 1：纯标准库迷你神经网络 XOR ──
const before1 = await bubbleCount()
await sendMsg('写一个只用 Python 标准库（不用 numpy/torch）的迷你神经网络：单隐层（4 个神经元）+ sigmoid + 反向传播，在 XOR 问题上训练 2000 轮，最后报告训练后的准确率。脚本要简短，运行后把准确率告诉我。')
report.ml1 = await waitNewReply(before1)
await sleep(1500)
report.ml1Text = await ev(`(function(){ const bs = document.querySelectorAll('.evo-msg-bubble-assistant'); const last = bs[bs.length-1]; return last ? last.textContent.trim().slice(0, 400) : '' })()`)
report.ml1Accuracy = await ev(`(function(){ const t = Array.from(document.querySelectorAll('.evo-msg-bubble-assistant')).map((b) => b.textContent).join(' '); return /(accuracy|准确率)[^0-9]*[0-9.]+/.test(t) })()`)

// ── 项目环境：Workspace 面板环境卡 ──
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-tl-item')).find((x) => (x.textContent || '').includes('导入项目')); if (b) b.click(); return !!b })()`)
await waitForPanel(`!!document.querySelector('.evo-env-card')`, 20)
report.envCards = await ev(`document.querySelectorAll('.evo-env-card').length`)
// 展开第一个环境卡
await ev(`(function(){ const b = document.querySelector('.evo-env-head'); if (b) b.click(); return !!b })()`)
await sleep(1200)
report.envStateBefore = await ev(`document.querySelector('.evo-env-state')?.textContent?.trim() ?? ''`)
// 若未创建（自动创建可能已完成），点击创建（默认 3.12）
// 已创建判定：状态文本是版本号（如 3.12.13），未创建时为「未创建」
const createdAlready = await ev(`(function(){ const s = document.querySelector('.evo-env-state'); return s ? !(s.textContent.includes('未创建') || s.textContent.includes('Not created') || s.textContent.trim() === '') : false })()`)
if (!createdAlready) {
  await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-env-body button')).find((x) => (x.textContent || '').includes('创建环境')); if (b) b.click(); return !!b })()`)
  report.envCreateClicked = true
  // 轮询环境状态（uv 下载 CPython 首次 1-3 分钟）
  for (let i = 0; i < 120; i++) {
    await sleep(3000)
    const state = await ev(`document.querySelector('.evo-env-state')?.textContent?.trim() ?? ''`)
    if (!(state.includes('未创建') || state.includes('Not created') || state === '')) break
    if (i % 10 === 0) console.log(`env poll ${i}: ${state}`)
  }
}
report.envStateAfter = await ev(`document.querySelector('.evo-env-state')?.textContent?.trim() ?? ''`)
// 安装 scikit-learn
await ev(`(function(){ const input = document.querySelector('.evo-env-body .evo-panel-input'); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(input, 'scikit-learn'); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
await sleep(400)
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-env-body button')).find((x) => (x.textContent || '').includes('安装')); if (b) b.click(); return !!b })()`)
// 轮询包列表出现 scikit-learn
for (let i = 0; i < 100; i++) {
  await sleep(3000)
  const pkgs = await ev(`document.querySelector('.evo-env-pkgs')?.textContent ?? ''`)
  if (pkgs.includes('scikit-learn')) break
  if (i % 10 === 0) console.log(`pkg poll ${i}: ${pkgs.slice(0, 60)}`)
}
report.envPackages = await ev(`document.querySelector('.evo-env-pkgs')?.textContent?.slice(0, 200) ?? ''`)

// ── ML 例 2：项目虚拟环境跑 sklearn 随机森林 ──
// 回聊天视图：点品牌按钮新建对话（继承当前项目 cwd → 同一虚拟环境）
await ev(`(function(){ const b = document.querySelector('.evo-brand-btn'); if (b) b.click(); return !!b })()`)
await sleep(1200)
const before2 = await bubbleCount()
await sendMsg('用本项目虚拟环境（$env:DSH_VENV_PYTHON）写一个 scikit-learn 随机森林：用 digits 数据集做 80/20 划分训练，报告测试集准确率。必须使用项目的 .venv 解释器，不要用全局 python。')
report.ml2 = await waitNewReply(before2, 130)
await sleep(1500)
report.ml2Text = await ev(`(function(){ const bs = document.querySelectorAll('.evo-msg-bubble-assistant'); const last = bs[bs.length-1]; return last ? last.textContent.trim().slice(0, 400) : '' })()`)
// 工具调用是否使用了 .venv python
report.venvUsed = await ev(`(function(){ const t = Array.from(document.querySelectorAll('.evo-tool-group')).map((x) => x.textContent).join(' '); return { hasVenv: t.includes('.venv'), sample: t.slice(0, 200) } })()`)
report.ml2Accuracy = await ev(`(function(){ const t = Array.from(document.querySelectorAll('.evo-msg-bubble-assistant')).map((b) => b.textContent).join(' '); return /(accuracy|准确率)[^0-9]*[0-9.]+/.test(t) })()`)
report.leak = await ev(`(function(){ const t = document.body.innerText; return ${JSON.stringify(LEAK)}.filter((p) => t.includes(p)) })()`)
report.noWhiteScreen = await ev(`!!document.querySelector('.evo-app')`)

async function waitForPanel(expr, tries) {
  for (let i = 0; i < tries; i++) { if (await ev(expr).catch(() => false)) return true; await sleep(500) }
  return false
}

console.log(JSON.stringify(report, null, 1))
process.exit(0)
