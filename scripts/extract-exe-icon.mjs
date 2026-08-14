/**
 * 提取 Windows exe 的关联图标为 PNG（验证可执行文件图标已更新）。
 * 用法：node scripts/extract-exe-icon.mjs <exe路径> [输出png]
 */
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const exe = process.argv[2]
const out = process.argv[3] ?? join(ROOT, '.tmp-port', 'exe-icon.png')
if (!exe) {
  console.error('用法: node scripts/extract-exe-icon.mjs <exe路径> [输出png]')
  process.exit(1)
}

const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon('${exe.replace(/'/g, "''")}')
if ($null -eq $icon) { Write-Error 'no icon'; exit 1 }
$bmp = $icon.ToBitmap()
$bmp.Save('${out.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "saved: ${out} ($($bmp.Width)x$($bmp.Height))"
`

const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
  encoding: 'utf8',
  timeout: 30000,
})
if (result.status !== 0) {
  console.error(result.stderr || result.stdout)
  process.exit(1)
}
console.log(result.stdout.trim())
