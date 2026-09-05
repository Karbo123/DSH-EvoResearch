import { spawn } from 'node:child_process'
import { rmSync, mkdirSync } from 'node:fs'

const appPort = process.argv[2] || '10465'
const debugPort = 47200
const profile = `D:\\DSH-Research\\.tmp-e2e\\edge-mobile-${Date.now()}`
mkdirSync(profile, { recursive: true })
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=1512,950', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = await (async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
      const page = l.find((t) => t.type === 'page')
      if (page) return page
    } catch {}
    await sleep(500)
  }
  throw new Error('edge not up')
})()
const ws = new WebSocket(list.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0; const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
const ev2 = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); return r?.result?.value ?? r?.exceptionDetails?.exception?.description ?? null }

await send('Page.enable')
await send('Runtime.enable')
// ── 移动端 viewport ──
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: `http://127.0.0.1:${appPort}/` })
await sleep(5000)
const report = {}
report.mobileApp = await ev2('!!document.querySelector(".evo-app")')
report.mobileOverflow = await ev2('document.documentElement.scrollWidth > document.documentElement.clientWidth')
report.mobileComposer = await ev2('!!document.querySelector(".evo-composer-textarea")')
report.mobileSidebar = await ev2('(function(){ const l = document.querySelector(".evo-left"); if (!l) return "no-left"; const cs = getComputedStyle(l); return { position: cs.position, width: l.offsetWidth } })()')
report.mobileTopbar = await ev2('Array.from(document.querySelectorAll(".evo-topbar button")).length')
report.mobileWelcome = await ev2('document.body.innerText.includes("科研在此进化")')
// 打开侧栏（窄屏抽屉）
await ev2('(function(){ const b = Array.from(document.querySelectorAll(".evo-topbar button")).find((x) => (x.title || "").includes("显示导航")); if (b) b.click(); return !!b })()')
await sleep(600)
report.mobileDrawer = await ev2('(function(){ const l = document.querySelector(".evo-left"); if (!l) return null; const cs = getComputedStyle(l); return { position: cs.position, mask: !!document.querySelector(".evo-drawer-mask") } })()')
// 关闭侧栏
await ev2('(function(){ const m = document.querySelector(".evo-drawer-mask"); if (m) m.click(); return !!m })()')
await sleep(400)
report.mobileDrawerClosed = await ev2('!document.querySelector(".evo-drawer-mask")')
// ── 暗色模式 ──
await send('Emulation.clearDeviceMetricsOverride')
await send('Page.navigate', { url: `http://127.0.0.1:${appPort}/` })
await sleep(4000)
await ev2('(function(){ const b = Array.from(document.querySelectorAll(".evo-topbar button")).find((x) => (x.title || "").includes("暗色") || (x.title || "").includes("dark")); if (b) b.click(); return !!b })()')
await sleep(800)
report.darkMode = await ev2('document.documentElement.classList.contains("dark")')
report.darkBg = await ev2('getComputedStyle(document.documentElement).getPropertyValue("--color-background").trim()')
report.darkText = await ev2('getComputedStyle(document.documentElement).getPropertyValue("--color-text-primary").trim()')
report.darkComposer = await ev2('(function(){ const cs = getComputedStyle(document.querySelector(".evo-composer") ?? document.body); return cs.color })()')
// 暗色下关键元素可见性（文字对比存在即通过）
report.darkReadable = await ev2('(function(){ const brand = document.querySelector(".evo-brand-name"); if (!brand) return "no-brand"; const cs = getComputedStyle(brand); return { color: cs.color, display: cs.display } })()')
console.log(JSON.stringify(report, null, 1))
edge.kill()
process.exit(0)
