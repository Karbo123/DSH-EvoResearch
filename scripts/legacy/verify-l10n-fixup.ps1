# 更新 verify 脚本：本地化后的中文选择器（字面替换 + 计数断言）
$ErrorActionPreference = 'Stop'
$root = 'D:\DSH-Research\scripts'

function Apply([string]$name, [object[]]$pairs) {
  if ($pairs.Count -gt 0 -and $pairs[0] -is [string]) { $pairs = ,$pairs }
  $path = Join-Path $root $name
  $content = [System.IO.File]::ReadAllText($path)
  foreach ($p in $pairs) {
    $old = $p[0]; $new = $p[1]; $expected = [int]$p[2]
    $count = ([regex]::Matches($content, [regex]::Escape($old))).Count
    if ($count -ne $expected) { throw "MISMATCH in $name : [$old] expected $expected got $count" }
    $content = $content.Replace($old, $new)
  }
  [System.IO.File]::WriteAllText($path, $content)
  Write-Host "done: $name"
}

Apply 'verify-runnow.mjs' @(
  @("includes('Scheduled')", "includes('定时任务')", 1),
  @('button[aria-label="Run now"]', 'button[aria-label="立即运行"]', 2)
)

Apply 'verify-schedule-builder.mjs' @(
  @("includes('Scheduled')", "includes('定时任务')", 1),
  @("textContent === 'Weekly'", "textContent === '每周'", 1)
)

Apply 'verify-scheduler-report.mjs' @(
  @("includes('Scheduled')", "includes('定时任务')", 1),
  @('button[aria-label="Open result thread"]', 'button[aria-label="打开结果对话"]', 1),
  @('button[aria-label="Report to main chat"]', 'button[aria-label="汇报到主对话"]', 1)
)

Apply 'verify-round5.mjs' @(
  @('button[aria-label="Edit"]', 'button[aria-label="编辑"]', 1),
  @('button[aria-label="Remove"]', 'button[aria-label="移除"]', 1),
  @('button[aria-label="Rename"]', 'button[aria-label="重命名"]', 1),
  @('button[aria-label="Side chat"]', 'button[aria-label="由此会话创建侧边对话"]', 1),
  @("includes('Side chats')", "includes('侧边对话')", 1),
  @("includes('Blank')", "includes('空白')", 1)
)

Apply 'verify-smoke.mjs' @(
  @('button[aria-label="Delete session"]', 'button[aria-label="删除会话"]', 1)
)

Apply 'verify-toast.mjs' @(
  @('button[aria-label="Rename"]', 'button[aria-label="重命名"]', 1),
  @('button[aria-label="Save"]', 'button[aria-label="保存"]', 1)
)

Write-Host 'ALL OK'





