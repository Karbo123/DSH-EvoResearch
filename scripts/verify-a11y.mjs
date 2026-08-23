/**
 * Round 26 验证：§30.2 无障碍（Dialog 焦点管理、aria 语义、reduced-motion）。
 * 1. 打开设置弹窗 → 焦点落在弹窗内首个可操作元素（dialog role + aria-modal）；
 * 2. 关闭弹窗 → 焦点恢复到触发按钮；
 * 3. 输入 / 触发候选 → textarea aria-expanded/activedescendant 指向候选；
 * 4. 模拟 prefers-reduced-motion → 动画时长 ≈ 0；
 * 5. 截图。
 * 用法：node scripts/verify-a11y.mjs <port>
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2]
const debugPort = 40000 + Math.floor(Math.random() * 700)
const userData = join(ROOT, '.tmp-dev', `edge-a11y-${randomBytes(4).toString('hex')}`)
mkdirSync(dirname(userData), { recursive: true })

const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`, '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map() }
  static async connect(port) {
    for (let i = 0; i < 60; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        const page = list.find((t) => t.type === 'page')
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
        const c = new Cdp(ws)
        ws.onmessage = (ev) => c._onMessage(JSON.parse(ev.data))
        return c
      } catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    throw new Error('CDP 连接失败')
  }
  _onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    }
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (res.exceptionDetails) throw new Error(`eval 异常: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`)
    return res.result?.value
  }
  close() { this.ws.close() }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const cdp = await Cdp.connect(debugPort)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/?sidebar=1` })
  for (let i = 0; i < 40; i += 1) {
    const ready = await cdp.eval(`(function(){ return document.querySelector('.evo-app') !== null && !!window.__evoresearch?.sessions })()`).catch(() => false)
    if (ready) break
    await sleep(500)
  }
  await sleep(1500)

  const report = {}
  // 1) 打开设置弹窗 → 焦点进入弹窗
  report.open = await cdp.eval(`(function(){ const btn = Array.from(document.querySelectorAll('button')).find(function(b){ return b.title === '设置' }); if (!btn) return 'no-btn'; btn.focus(); btn.click(); return 'opened' })()`)
  await sleep(600)
  report.dialog = await cdp.eval(`(function(){ const d = document.querySelector('.evo-modal'); return d ? { role: d.getAttribute('role'), ariaModal: d.getAttribute('aria-modal'), label: d.getAttribute('aria-label') } : null })()`)
  report.focusInDialog = await cdp.eval(`(function(){ const d = document.querySelector('.evo-modal'); return d !== null && d.contains(document.activeElement) })()`)
  report.activeEl = await cdp.eval(`(function(){ const el = document.activeElement; return el ? el.tagName + (el.title ? '#' + el.title : '') : null })()`)
  // 2) 关闭 → 焦点恢复触发按钮
  await cdp.eval(`(function(){ const btn = document.querySelector('.evo-btn-back, [aria-label="返回"]'); if (!btn) return false; btn.click(); return true })()`)
  await sleep(600)
  report.focusRestored = await cdp.eval(`(function(){ const el = document.activeElement; return el ? el.title ?? el.tagName : null })()`)
  // 3) 候选 activedescendant
  await cdp.eval(`(function(){ const ta = document.querySelector('.evo-composer-textarea'); ta.focus(); const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(ta, '/sch'); ta.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(600)
  report.combobox = await cdp.eval(`(function(){ const ta = document.querySelector('.evo-composer-textarea'); return { expanded: ta.getAttribute('aria-expanded'), auto: ta.getAttribute('aria-autocomplete'), active: ta.getAttribute('aria-activedescendant'), options: document.querySelectorAll('.evo-cand [role=option]').length } })()`)
  // 4) reduced-motion
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await sleep(400)
  report.reducedMotion = await cdp.eval(`(function(){ const el = document.querySelector('.evo-toast-host') || document.querySelector('.evo-app'); const cs = getComputedStyle(el); const t = document.createElement('div'); t.style.transition = 'all 0.3s'; document.body.appendChild(t); const cst = getComputedStyle(t); const dur = cst.transitionDuration; t.remove(); return { bodyTransition: dur, appTransition: cs.transitionDuration } })()`)

  report.chatGraph = await cdp.eval(`(function(){
    const tab = Array.from(document.querySelectorAll('.evo-tab')).find(function(el){ return /图谱|Chat Graph/i.test(el.textContent || '') })
    if (tab) tab.click()
    return { clicked: !!tab }
  })()`)
  await sleep(600)
  report.chatGraph = { ...report.chatGraph, ...(await cdp.eval(`(function(){
    const flow = document.querySelector('.react-flow[aria-label="Chat Graph 研究上下文图"]')
    const controls = document.querySelector('[aria-label="图谱缩放与适配控制"]')
    const minimap = document.querySelector('[aria-label="图谱小地图"]')
    return { canvas: !!flow, controls: !!controls, minimap: !!minimap, nodes: document.querySelectorAll('[data-node-id][role="group"]').length }
  })()`)) }

  report.checks = {
    dialog: report.dialog?.role === 'dialog' && report.dialog?.ariaModal === 'true',
    focusInDialog: report.focusInDialog === true,
    focusRestored: report.focusRestored === '设置',
    comboboxAttributes: report.combobox?.expanded === 'true' && report.combobox?.auto === 'list' && typeof report.combobox?.active === 'string' && report.combobox.active.length > 0 && report.combobox.options > 0,
    reducedMotion: ['0s', '1e-05s'].includes(report.reducedMotion?.bodyTransition) || ['0s', '1e-05s'].includes(report.reducedMotion?.appTransition),
    chatGraphSurface: report.chatGraph?.canvas === true && report.chatGraph?.controls === true && report.chatGraph?.minimap === true,
  }

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = join(ROOT, '.tmp-dev', `a11y-${port}.png`)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  report.screenshot = out

  console.log(JSON.stringify(report, null, 2))
  if (Object.values(report.checks).some((value) => value !== true)) throw new Error(`无障碍验收失败: ${Object.entries(report.checks).filter(([, value]) => value !== true).map(([name]) => name).join(', ')}`)
  cdp.close()
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 }).finally(() => {
  try { edge.kill() } catch { /* 已退出 */ }
  setTimeout(() => { try { rmSync(userData, { recursive: true, force: true }) } catch { /* 忽略 */ } }, 500)
})

