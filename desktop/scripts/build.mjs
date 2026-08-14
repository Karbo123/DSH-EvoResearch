/**
 * 一键构建桌面版：插件构建 → sidecar 组装 → cargo tauri build（NSIS）。
 *
 * 用法：node desktop/scripts/build.mjs [--skip-download]
 */
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function run(label, command, args, cwd = ROOT) {
  console.log(`[build] ${label}`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) {
    console.error(`[build] 失败：${label}`)
    process.exit(result.status ?? 1)
  }
}

const skipDownload = process.argv.includes('--skip-download')

run('构建插件（tsup）', 'npm', ['run', 'build'])
run('组装 Node sidecar', 'node', ['desktop/scripts/bundle-sidecar.mjs', ...(skipDownload ? ['--skip-download'] : [])])
// 清理 target/release/_up_ 资源残留（tauri-build 复制资源不删除旧文件，旧布局残留会干扰运行）
const upDir = join(ROOT, 'desktop', 'src-tauri', 'target', 'release', '_up_')
rmSync(upDir, { recursive: true, force: true })
console.log('[build] 已清理资源残留目录 _up_')
run('Tauri 构建（NSIS）', 'cargo', ['tauri', 'build', '--bundles', 'nsis'], join(ROOT, 'desktop', 'src-tauri'))

console.log('[build] 完成 → desktop/src-tauri/target/release/bundle/nsis/*-setup.exe')
