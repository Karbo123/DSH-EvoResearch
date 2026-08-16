/**
 * 回溯/编辑重发 E2E（确定性 API 路径）：
 * 1) 复制按钮在气泡外（结构检查）；
 * 2) 两轮对话 → 自动 git 提交 auto-turn 1/2；
 * 3) 编辑第 1 条消息：API usermsg-edit → 派发 evo-rewind(resend) → 子会话收到修正消息并回复；
 * 4) 回溯第 2 条消息：API rewind-execute → 派发 evo-rewind → 子会话 = 1 轮、文件回退到回合 1。
 * 用法：node scripts/verify-rewind.mjs <CDP端口> <APP端口>
 */
const CDP_PORT = process.argv[2] || '47510'
const APP_PORT = process.argv[3] || '14420'
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
const api = (method, body) => ev(`(async function(){ const res = await fetch('/evoresearch/fs/${method}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }); return await res.json() })()`)

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}/?sidebar=1` })
for (let i = 0; i < 60; i++) { if (await ev(`!!document.querySelector('.evo-app')`).catch(() => false)) break; await sleep(500) }
await sleep(2000)
const report = {}

const sendMsg = async (text) => {
  await ev(`(function(){ const el = document.querySelector('.evo-composer-textarea'); if (!el) return false; const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(400)
  await ev(`(function(){ const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '发送' || (x.textContent || '').trim() === 'Send'); if (b) b.click(); return !!b })()`)
}
const waitTurnDone = async () => {
  for (let i = 0; i < 150; i++) {
    await sleep(3000)
    if (!(await ev(`!!document.querySelector('.evo-composer-stop')`))) return true
  }
  return false
}

// 第 1 轮：创建文件
await sendMsg('请创建一个文件 note_v1.txt，内容只写 "版本一" 三个字，然后确认完成。')
await waitTurnDone(); await sleep(1500)
// 第 2 轮：修改文件
await sendMsg('请修改 note_v1.txt，把内容改成 "版本二，被第二次修改"（不要创建新文件），完成后确认。')
await waitTurnDone(); await sleep(2500)

report.copyOutsideBubble = await ev(`(function(){
  const b = document.querySelector('.evo-msg-bubble-user')
  if (!b) return null
  return { metaInsideBubble: !!b.querySelector('.evo-msg-meta'), copyInsideBubble: !!b.querySelector('.evo-msg-copy'), rowHasMetaOutside: !!b.closest('.evo-msg-stack')?.querySelector(':scope > .evo-msg-meta') }
})()`)
report.editBtnPresent = await ev(`(function(){ const rows = document.querySelectorAll('.evo-msg-row.evo-msg-user'); return rows.length > 0 && !!rows[0].querySelector('.evo-msg-meta .evo-msg-copy[title="编辑消息"]') })()`)
report.rewindBtnPresent = await ev(`(function(){ const rows = document.querySelectorAll('.evo-msg-row.evo-msg-user'); return rows.length > 0 && !!rows[0].querySelector('.evo-msg-meta .evo-msg-copy[title="回溯到此（对话+文件）"]') })()`)

// 取当前会话 id 与首条消息 seq
const sessionInfo = await ev(`(async function(){
  const s = window.__evoresearch?.sessions
  if (!s) return null
  const cur = s.manager?.selected
  const res = await fetch('/evoresearch/fs/rewind-info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: cur }) })
  const json = await res.json()
  return { current: cur, info: json.value ?? json.error }
})()`)
report.sessionInfo = sessionInfo
const sessionId = sessionInfo?.current
// 从 live binding 取第一条真实用户消息 seq（rewind-info 只返回最后一条）
const firstSeq = await ev(`(function(){
  const s = window.__evoresearch?.sessions
  const b = s?.binding ? s.binding(${JSON.stringify(sessionId ?? '')}) : null
  const events = b?.session?.events ?? []
  for (const e of events) {
    if (e.type !== 'user/message') continue
    const c = e.data?.content
    const t = Array.isArray(c) ? c.map((x) => x?.text ?? '').join('') : ''
    if (t.trim() === '' || /^(Current runtime context|Current DSH file policy|Approval|\\?<\\?code_mode|\\?<\\?research_memory_packet|\\?<\\?identity_profile|\\?<\\?project_env)/.test(t.trimStart())) continue
    return e.seq
  }
  return null
})()`)
report.firstMsgSeq = firstSeq
const projectDir = await ev(`document.querySelector('.evo-cwd')?.textContent ?? ''`)
report.projectDir = projectDir

// ── 编辑第 1 条消息（API + 事件派发）──
const editResult = await api('usermsg-edit', { sessionId, seq: firstSeq })
report.editApi = editResult.value ?? editResult.error
const childId = editResult.value?.childSessionId
await ev(`(function(){ window.dispatchEvent(new CustomEvent('evo-rewind', { detail: { childId: ${JSON.stringify(childId)}, resend: '请创建一个文件 note_v1.txt，内容只写 "版本一修正" 四个字，然后确认完成。' } })); return true })()`)
// 等待重发回合：子会话出现新用户消息（最长 60s）→ 回合完成
for (let i = 0; i < 30; i++) {
  await sleep(2000)
  const n = await ev(`document.querySelectorAll('.evo-msg-bubble-user').length`)
  if (n > 0) break
}
await waitTurnDone()
await sleep(3000)
report.afterEditMsgs = await ev(`Array.from(document.querySelectorAll('.evo-msg-bubble-user .evo-msg-text')).map((x) => x.textContent.trim().slice(0, 40))`)
report.noteV1AfterEdit = await (await import('node:fs')).promises.readFile(`${projectDir}\\note_v1.txt`, 'utf8').catch(() => '(missing)')

// ── 回溯第 2 条消息（API + 事件派发）──
const info2 = await api('rewind-info', { sessionId: childId })
const lastSeq = info2.value?.lastUserMessage?.seq
report.lastMsgSeqAfterEdit = lastSeq
const rewindResult = await api('rewind-execute', { sessionId: childId, beforeSeq: lastSeq })
report.rewindApi = rewindResult.value ?? rewindResult.error
const child2 = rewindResult.value?.childSessionId
await ev(`(function(){ window.dispatchEvent(new CustomEvent('evo-rewind', { detail: { childId: ${JSON.stringify(child2)} } })); return true })()`)
await sleep(4000)
report.afterRewindMsgs = await ev(`Array.from(document.querySelectorAll('.evo-msg-bubble-user .evo-msg-text')).map((x) => x.textContent.trim().slice(0, 40))`)
report.noteV1AfterRewind = await (await import('node:fs')).promises.readFile(`${projectDir}\\note_v1.txt`, 'utf8').catch(() => '(missing)')
const gitLog2 = await (await import('node:child_process')).execSync('git log --oneline -10', { cwd: projectDir, encoding: 'utf8' })
report.gitLogAfter = gitLog2.trim().split('\n')
console.log(JSON.stringify(report, null, 1))
process.exit(0)
