/**
 * 屏幕截图工具（Windows）：捕获全屏或指定窗口，保存 PNG。
 * 用法：node scripts/capture.mjs [输出路径] [窗口标题子串]
 */
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const out = process.argv[2] ?? join(ROOT, '.tmp-capture.png')
const windowTitle = process.argv[3]

// PowerShell 脚本：全屏截图（或按窗口标题查找窗口截图）
const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
${windowTitle ? `
$h = [Win32]::FindWindow($null, '${windowTitle}')
if ($h -eq [IntPtr]::Zero) { Write-Error "窗口未找到: ${windowTitle}"; exit 1 }
[Win32]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 400
$rect = New-Object Win32+RECT
[Win32]::GetWindowRect($h, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left; $hgt = $rect.Bottom - $rect.Top
$x = $rect.Left; $y = $rect.Top
` : `
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$w = $bounds.Width; $hgt = $bounds.Height; $x = 0; $y = 0
`}
$bmp = New-Object System.Drawing.Bitmap($w, $hgt)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)
$bmp.Save('${out.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host "saved: ${out}"
`

const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
  encoding: 'utf8',
  timeout: 20000,
})
if (result.status !== 0) {
  console.error(result.stderr || result.stdout)
  process.exit(1)
}
console.log(`[capture] ${out}`)
