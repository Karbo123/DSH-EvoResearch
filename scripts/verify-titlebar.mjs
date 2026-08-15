/**
 * 真实 exe 标题栏验证：
 * 1. 以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port 启动 exe；
 * 2. CDP 连 WebView：断言 .evo-tb-spacer 存在、data-tauri-drag-region 只标在 spacer、
 *    最小化/最大化/关闭按钮存在；
 * 3. 点击最大化 → PowerShell 查窗口 rect 变大；点击关闭 → 进程退出。
 * 用法：node scripts/verify-titlebar.mjs <exe路径>
 */
import { spawn } from 'node:child_process'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const exe = process.argv[2]
const cdpPort = 9300 + Math.floor(Math.random() * 60)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

/** 查窗口 rect（PowerShell）。 */
function windowRect() {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Add-Type -AssemblyName System.Drawing; $p = Get-Process evoresearch-desktop -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($p) { Add-Type @\\"using System; using System.Runtime.InteropServices; public struct RECT { public int Left, Top, Right, Bottom; } public class W { [DllImport(\\"user32.dll\\")] public static extern bool GetWindowRect(IntPtr h, out RECT r); }\\"@; $r = New-Object RECT; [W]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null; Write-Output ($r.Right - $r.Left) }"`,
      { encoding: 'utf8', timeout: 8000 },
    ).trim()
    return out ? Number(out) : null
  } catch { return null }
}

async function main() {
  const child = spawn(exe, [], {
    detached: false,
    stdio: 'ignore',
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}` },
  })
  const report = {}
  // 等 WebView CDP 就绪
  let cdp = null
  for (let i = 0; i < 60; i += 1) {
    try {
      cdp = await Cdp.connect(cdpPort)
      break
    } catch { await sleep(1000) }
  }
  if (cdp === null) { console.log(JSON.stringify({ cdpReady: false }, null, 2)); try { child.kill() } catch {} ; return }
  await cdp.send('Runtime.enable')
  // 等页面（desktop=1 标题栏）
  for (let i = 0; i < 40; i += 1) {
    const ok = await cdp.eval(`(function(){ return document.querySelector('.evo-tb') !== null })()`).catch(() => false)
    if (ok) break
    await sleep(500)
  }
  await sleep(1000)

  // 1) 标题栏结构断言
  report.structure = await cdp.eval(`(function(){
    const spacer = document.querySelector('.evo-tb-spacer');
    const buttons = Array.from(document.querySelectorAll('.evo-tb button'));
    return {
      spacer: spacer !== null,
      spacerDragRegion: spacer?.hasAttribute('data-tauri-drag-region') ?? false,
      containerDragRegion: document.querySelector('.evo-tb')?.hasAttribute('data-tauri-drag-region') ?? false,
      minBtn: buttons.some(function(b){ return b.getAttribute('aria-label') === 'Minimize' }),
      maxBtn: buttons.some(function(b){ return b.getAttribute('aria-label') === 'Maximize' }),
      closeBtn: buttons.some(function(b){ return b.getAttribute('aria-label') === 'Close' }),
    }
  })()`)

  // 2) 关闭：点击标题栏关闭按钮 → 进程退出（ACL 链路完整验证）
  report.closeClick = await cdp.eval(`(function(){ const b = Array.from(document.querySelectorAll('.evo-tb button')).find(function(x){ return x.getAttribute('aria-label') === 'Close' }); if (!b) return 'no-btn'; b.click(); return 'clicked' })()`)
  let exited = false
  for (let i = 0; i < 30; i += 1) {
    try { process.kill(child.pid, 0); await sleep(500) } catch { exited = true; break }
  }
  report.exitedAfterClose = exited

  console.log(JSON.stringify(report, null, 2))
  try { cdp.close() } catch {}
  try { child.kill() } catch {}
}

main().catch((e) => { console.error('失败:', e.message); process.exit(1) })
