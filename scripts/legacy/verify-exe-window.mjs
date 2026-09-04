// 真实 exe 窗口验证：启动 → 等待窗口/后端就绪 → 截图窗口 → 输出状态。
// 用法：node scripts/verify-exe-window.mjs <exe路径> <输出png>
import { spawn, execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const exe = process.argv[2]
const outPng = process.argv[3] ?? join(ROOT, '.tmp-dev', 'exe-window.png')
const portFile = join(process.env.LOCALAPPDATA ?? '', 'com.evoresearch.desktop', 'port.json')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  if (!existsSync(exe)) { console.error('exe 不存在:', exe); process.exit(1) }
  console.log('[exe-check] 启动', exe)
  const child = spawn(exe, [], { detached: false, stdio: 'ignore' })

  let port = null
  let handle = null
  let title = null
  let logTail = ''
  const started = Date.now()
  while (Date.now() - started < 90000) {
    // 端口文件
    if (port === null && existsSync(portFile)) {
      try {
        const json = JSON.parse(readFileSync(portFile, 'utf8'))
        port = json.port ?? null
      } catch { /* 写入中 */ }
    }
    // 窗口句柄（通过 powershell 查进程主窗口）
    if (handle === null) {
      try {
        const out = execSync(
          `powershell -NoProfile -Command "$p = Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }; if ($p) { Write-Output ($p.MainWindowHandle.ToString() + '|' + $p.MainWindowTitle) }"`,
          { encoding: 'utf8', timeout: 8000 },
        ).trim()
        if (out) {
          const [h, t] = out.split('|')
          handle = h
          title = t
        } else {
          handle = 'EMPTY'
        }
      } catch (error) {
        handle = `QUERY-ERR:${String(error).slice(0, 80)}`
        console.error('[exe-check] 窗口查询异常:', String(error).slice(0, 200))
      }
    }
    if (port !== null && handle !== null) break
    await sleep(2000)
  }
  try {
    logTail = execSync(
      `powershell -NoProfile -Command "Get-Content $env:TEMP\\evoresearch-shell.log -Tail 8 -ErrorAction SilentlyContinue"`,
      { encoding: 'utf8', timeout: 8000 },
    ).trim()
  } catch { /* 无日志 */ }

  console.log('[exe-check] port =', port)
  console.log('[exe-check] window handle =', handle, 'title =', title)
  console.log('[exe-check] shell log tail:\n' + logTail)

  if (handle !== null && handle !== 'EMPTY' && !handle.startsWith('QUERY-ERR:') && port !== null) {
    // 截取窗口区域
    const script = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
public class Win32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
"@
$h = [IntPtr]${handle}
$rect = New-Object RECT
[Win32]::GetWindowRect($h, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$ht = $rect.Bottom - $rect.Top
$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($w, $ht)))
$bmp.Save("${outPng.replace(/\\/g, '/')}")
$g.Dispose(); $bmp.Dispose()
Write-Output "saved $w x $ht"
`
    try {
      const encoded = Buffer.from(script, 'utf16le').toString('base64')
      const out = execSync(
        `powershell -NoProfile -EncodedCommand ${encoded}`,
        { encoding: 'utf8', timeout: 20000 },
      ).trim()
      console.log('[exe-check] screenshot:', out)
      if (!existsSync(outPng)) throw new Error(`截图文件未生成: ${outPng}`)
    } catch (e) {
      throw new Error(`[exe-check] screenshot 失败: ${String(e.message ?? e).slice(0, 300)}`)
    }
  } else {
    throw new Error(`[exe-check] 未同时获得可用窗口句柄和 sidecar 端口: handle=${handle}, port=${port}`)
  }

  child.kill()
  // 等进程退出
  await sleep(1500)
  console.log('[exe-check] 已终止测试实例')
}

main().catch((e) => { console.error('失败:', e); process.exitCode = 1 })
