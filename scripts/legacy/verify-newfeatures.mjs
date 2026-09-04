/**
 * 本轮 E2E 验证（§5.1 实验管理 / §5.2 标签栏 / §5.3 复制历史 / Bug #3 泄漏过滤）：
 * 1) 欢迎页发科研消息 → 回复渲染（无系统 XML 泄漏）；
 * 2) Recents 行「复制历史到新对话」→ 新主聊天出现（含历史）；
 * 3) 标签栏：+ 菜单 → 新建文件编辑器 → 编辑保存 → PDF 标签（事件派发）→ 关闭；
 * 4) 实验管理：新建 → 新增阶段 → 创建检查点（快照落盘）→ 回退 → 分支 → 删除；
 * 5) 最终页面文本无 <code_mode>/<research_memory_packet>/Current runtime context 泄漏。
 * 用法：node scripts/verify-newfeatures.mjs <CDP端口> <APP端口>
 */
const CDP_PORT = process.argv[2] || '46299'
const APP_PORT = process.argv[3] || '7007'
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
const setInput = (selector, value) => `(function(){ const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`
const clickByText = (selector, text) => `(function(){ const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((x) => (x.textContent || '').includes(${JSON.stringify(text)})); if (el) el.click(); return !!el })()`
const waitFor = async (expr, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { if (await ev(expr).catch(() => false)) return true; await sleep(gap) } return false }
const LEAK_PREFIXES = ['Current runtime context', 'Current DSH file policy', '<code_mode>', '<research_memory_packet>', '<identity_profile>', 'Approval prompts are disabled']

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}/?sidebar=1` })
await waitFor(`!!document.querySelector('.evo-app')`, 60)
await sleep(2000)

const report = {}
const bodyLeak = async () => {
  const text = await ev(`document.body.innerText`)
  return LEAK_PREFIXES.filter((p) => text.includes(p))
}

// ── 1) 欢迎页发消息 → 回复 ──
report.leakBefore = await bodyLeak()
report.composer = await ev(`!!document.querySelector('.evo-composer-textarea')`)
await ev(setInput('.evo-composer-textarea', '我想研究 RAG 在科研文献问答中的幻觉问题，算力有限（单张 4090），帮我分析值得做的具体研究问题'))
await sleep(300)
await ev(`(function(){ const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '发送' || (x.textContent || '').trim() === 'Send'); if (b) b.click(); return !!b })()`)
report.sent = true
// 等待 assistant 回复（模型经本地代理，最长 180s）
const replied = await waitFor(`Array.from(document.querySelectorAll('.evo-msg-bubble-assistant')).some((b) => (b.textContent || '').trim().length > 40)`, 90, 2000)
report.replied = replied
await sleep(1500)
report.assistantText = replied ? await ev(`Array.from(document.querySelectorAll('.evo-msg-bubble-assistant')).map((b) => b.textContent.trim()).join('\\n').slice(0, 300)`) : ''
report.leakAfter = await bodyLeak()
report.userBubble = await ev(`!!document.querySelector('.evo-msg-bubble-user')`)
// 等回合完全结束（composer 停止按钮消失 = 官方 running 状态清除）——
// 官方 fork 要求源会话已完成轮次（文本流结束后模型可能仍在跑工具）
await waitFor(`!document.querySelector('.evo-composer-stop')`, 120, 2000)
await sleep(1000)

// ── 2) 复制历史到新对话 ──
report.rowsBefore = await ev(`document.querySelectorAll('.evo-tl-row').length`)
const copyClicked = await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-tl-row-act')).find((x) => (x.title || '').includes('复制历史') || (x.getAttribute('aria-label') || '').includes('复制历史')); if (b) b.click(); return !!b })()`)
report.copyClicked = copyClicked
await sleep(2500)
report.rowsAfter = await ev(`document.querySelectorAll('.evo-tl-row').length`)
// 打开侧聊面板确认提升后的会话不在侧聊列表
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-topbar button')).find((x) => (x.title || '').includes('侧边对话')); if (b) b.click(); return !!b })()`)
await sleep(800)
report.sideChatRows = await ev(`Array.from(document.querySelectorAll('.evo-right [class*="side"]')).length`)
report.sideChatText = await ev(`document.querySelector('.evo-right')?.innerText?.slice(0, 200) ?? ''`)

// ── 3) 标签栏 ──
await ev(`(function(){ const b = document.querySelector('.evo-icon-btn'); })()`)
await ev(`(function(){ const b = document.querySelector('.evo-tab-new'); if (b) b.click(); return !!b })()`)
await sleep(500)
report.tabMenu = await ev(`Array.from(document.querySelectorAll('.evo-tab-menu-item')).map((x) => x.textContent.trim())`)
// 新建文件编辑器
await ev(setInput('.evo-tab-newfile-input', 'notes/draft.md'))
await sleep(400)
await ev(`(function(){ const b = document.querySelector('.evo-tab-newfile-go'); if (b) b.click(); return !!b })()`)
await waitFor(`!!document.querySelector('.evo-tab-editor')`, 20)
report.editorTab = await ev(`(function(){ return { count: document.querySelectorAll('.evo-tab').length, titles: Array.from(document.querySelectorAll('.evo-tab-title')).map((x) => x.textContent.trim()), path: document.querySelector('.evo-tab-editor-path')?.textContent ?? '' } })()`)
await ev(setInput('.evo-tab-editor', '# 草稿\n\nRAG 幻觉研究笔记'))
await sleep(200)
await ev(`(function(){ const b = document.querySelector('.evo-tab-editor-head .evo-btn-run'); if (b) b.click(); return !!b })()`)
await sleep(800)
report.editorSaved = await ev(`(async function(){ try { const path = document.querySelector('.evo-tab-editor-path')?.textContent ?? ''; const res = await fetch('/evoresearch/fs/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) }); const json = await res.json(); return json.ok ? { text: json.value.text } : { error: json.error?.message } } catch (e) { return { error: String(e) } } })()`)
// 切回聊天标签
await ev(`(function(){ const b = document.querySelector('.evo-tab'); if (b) b.click(); return !!b })()`)
await sleep(500)
report.backToChat = await ev(`!!document.querySelector('.evo-composer-textarea')`)
// 取当前会话 cwd：切 Inspector → Workspace tab 的根路径（.evo-fs-crumb）
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-insp-tab')).find((x) => (x.textContent || '').includes('工作区')); if (b) b.click(); return !!b })()`)
await waitFor(`!!document.querySelector('.evo-fs-crumb')`, 30)
report.cwd = await ev(`document.querySelector('.evo-fs-crumb')?.textContent ?? ''`)
// PDF 标签：写一个最小 PDF 到工作区 → 派发 evo-open-tab(kind=pdf) → 检查 iframe
report.pdfTab = await ev(`(async function(){
  try {
    const root = document.querySelector('.evo-fs-crumb')?.textContent ?? ''
    if (root === '') return { error: 'no root' }
    const makePdf = () => {
      const objs = []
      objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
      objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
      objs[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'
      objs[4] = '<< /Length 62 >>\\nstream\\nBT /F1 14 Tf 30 80 Td (Hello EvoResearch PDF) Tj ET\\nendstream'
      objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
      let pdf = '%PDF-1.4\\n'
      const offsets = [0]
      for (let i = 1; i <= 5; i++) { offsets[i] = pdf.length; pdf += i + ' 0 obj\\n' + objs[i] + '\\nendobj\\n' }
      const xref = pdf.length
      pdf += 'xref\\n0 6\\n0000000000 65535 f \\n'
      for (let i = 1; i <= 5; i++) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \\n'
      pdf += 'trailer\\n<< /Size 6 /Root 1 0 R >>\\nstartxref\\n' + xref + '\\n%%EOF\\n'
      return pdf
    }
    const pdfPath = root.replace(/[\\\\/]$/, '') + '\\\\papers\\\\test-pdf.pdf'
    const wres = await fetch('/evoresearch/fs/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root, path: pdfPath, text: makePdf() }) })
    const wjson = await wres.json()
    if (wjson.ok !== true) return { error: wjson.error?.message ?? 'write failed' }
    window.dispatchEvent(new CustomEvent('evo-open-tab', { detail: { path: pdfPath, root, kind: 'pdf' } }))
    return { written: true }
  } catch (e) { return { error: String(e) } }
})()`)
await sleep(1500)
report.pdfFrame = await ev(`(function(){ const f = document.querySelector('.evo-tab-frame'); return f ? { src: f.src.slice(0, 120), tabTitles: Array.from(document.querySelectorAll('.evo-tab-title')).map((x) => x.textContent.trim()) } : null })()`)
// 关闭 PDF 标签
await ev(`(function(){ const b = document.querySelector('.evo-tab:not([data-active]) .evo-tab-close') ?? document.querySelector('.evo-tab[data-active] .evo-tab-close'); if (b) b.click(); return !!b })()`)
await sleep(500)
report.tabsAfterClose = await ev(`Array.from(document.querySelectorAll('.evo-tab-title')).map((x) => x.textContent.trim())`)

// ── 4) 实验管理 ──
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-tl-item')).find((x) => (x.textContent || '').includes('实验')); if (b) b.click(); return !!b })()`)
await waitFor(`!!document.querySelector('.evo-exp-item, .evo-panel-hint')`, 20)
report.expPanel = await ev(`document.querySelector('.evo-panel-head')?.textContent ?? ''`)
// 新建实验
await ev(setInput('.evo-panel-form input', 'RAG 幻觉研究'))
await sleep(400)
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-panel-form button')).find((x) => (x.textContent || '').includes('新建实验')); if (b) b.click(); return !!b })()`)
await waitFor(`!!document.querySelector('.evo-exp-item')`, 20)
report.expCreated = await ev(`Array.from(document.querySelectorAll('.evo-exp-item-name')).map((x) => x.textContent.trim())`)
// 新增阶段
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-exp-detail .evo-panel-add')).find((x) => (x.textContent || '').includes('新增阶段')); if (b) b.click(); return !!b })()`)
await sleep(400)
await ev(setInput('.evo-exp-inline input', '文献调研'))
await sleep(400)
await ev(`(function(){ const b = document.querySelector('.evo-exp-inline .evo-exp-inline-ok'); if (b) b.click(); return !!b })()`)
await waitFor(`Array.from(document.querySelectorAll('.evo-exp-phase-name')).length >= 2`, 20)
report.expPhases = await ev(`Array.from(document.querySelectorAll('.evo-exp-phase-name')).map((x) => x.textContent.trim())`)
// 创建检查点
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-exp-phase .evo-panel-add')).find((x) => (x.textContent || '').includes('创建检查点')); if (b) b.click(); return !!b })()`)
await sleep(400)
await ev(setInput('.evo-exp-cp-form input:nth-of-type(1)', '调研基线'))
await ev(setInput('.evo-exp-cp-form input:nth-of-type(2)', '文献收集完成'))
await sleep(400)
await ev(`(function(){ const b = document.querySelector('.evo-exp-cp-form .evo-exp-inline-ok'); if (b) b.click(); return !!b })()`)
await waitFor(`!!document.querySelector('.evo-exp-cp')`, 30)
report.checkpoint = await ev(`(function(){ const c = document.querySelector('.evo-exp-cp'); return c ? { title: c.querySelector('.evo-exp-cp-title span')?.textContent, sub: c.querySelector('.evo-exp-cp-sub')?.textContent } : null })()`)
// 回退（两段确认）
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-exp-cp-acts .evo-tl-row-act')).find((x) => (x.title || '').includes('回退')); if (b) b.click(); return !!b })()`)
await sleep(300)
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-exp-cp-acts .evo-tl-del-confirm')).find((x) => (x.textContent || '').includes('确认')); if (b) b.click(); return !!b })()`)
await waitFor(`!!document.querySelector('.evo-exp-notice')`, 20)
report.rollbackNotice = await ev(`document.querySelector('.evo-exp-notice')?.textContent ?? ''`)
report.rolledBadge = await ev(`!!document.querySelector('.evo-exp-cp[data-rolled]')`)
// 分支
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-exp-cp-acts .evo-tl-row-act')).find((x) => (x.title || '').includes('创建分支')); if (b) b.click(); return !!b })()`)
await sleep(300)
await ev(setInput('.evo-exp-branch-from .evo-exp-inline input', '对比实验分支'))
await sleep(400)
await ev(`(function(){ const b = document.querySelector('.evo-exp-branch-from .evo-exp-inline-ok'); if (b) b.click(); return !!b })()`)
await waitFor(`Array.from(document.querySelectorAll('.evo-exp-branch-chip')).length >= 2`, 20)
report.branchChips = await ev(`Array.from(document.querySelectorAll('.evo-exp-branch-chip span')).map((x) => x.textContent.trim())`)
// 切回 main 分支
await ev(`(function(){ const b = Array.from(document.querySelectorAll('.evo-exp-branch-chip')).find((x) => (x.textContent || '').includes('main')); if (b) b.click(); return !!b })()`)
await sleep(800)
report.currentBranch = await ev(`document.querySelector('.evo-exp-branch-chip[data-active] span')?.textContent ?? ''`)
// 快照目录落盘检查（dataRoot → projects → <slug> → .evoresearch-data → experiments → snapshots）
report.snapshotOnDisk = await ev(`(async function(){
  try {
    const ls = async (root) => { const res = await fetch('/evoresearch/fs/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root }) }); const json = await res.json(); return json.ok ? json.value.entries : null }
    const base = 'D:\\\\DSH-Research\\\\.tmp-e2e\\\\dev'
    const entries = await ls(base)
    if (!entries) return { error: 'no dataRoot' }
    for (const e1 of entries) {
      if (e1.name !== 'projects' || !e1.isDir) continue
      const projects = await ls(e1.path)
      if (!projects) continue
      for (const p of projects) {
        if (!p.isDir) continue
        const evo = await ls(p.path + '\\\\.evoresearch-data')
        if (!evo) continue
        for (const e of evo) {
          if (e.name !== 'experiments' || !e.isDir) continue
          const snaps = await ls(e.path)
          if (!snaps) continue
          for (const s of snaps) {
            if (s.name !== 'snapshots' || !s.isDir) continue
            const cps = await ls(s.path)
            return { project: p.name, snapshotDir: s.path, checkpoints: cps ? cps.map((c) => c.name) : [] }
          }
        }
      }
    }
    return { error: 'snapshots not found' }
  } catch (e) { return String(e) }
})()`)
// 删除实验（两段确认；未确认时按钮类是 .evo-tl-del，确认后变 .evo-tl-del-confirm）
await ev(`(function(){ const b = document.querySelector('.evo-exp-head .evo-tl-del'); if (b) b.click(); return !!b })()`)
await sleep(300)
await ev(`(function(){ const b = document.querySelector('.evo-exp-head .evo-tl-del-confirm'); if (b) b.click(); return !!b })()`)
await waitFor(`document.querySelectorAll('.evo-exp-item').length === 0`, 20)
report.expDeleted = await ev(`document.querySelectorAll('.evo-exp-item').length === 0`)

// ── 5) 最终泄漏检查 ──
report.leakFinal = await bodyLeak()

console.log(JSON.stringify(report, null, 1))
process.exit(0)
