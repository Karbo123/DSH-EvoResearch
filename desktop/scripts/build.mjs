/**
 * 一键构建桌面版：插件构建 → sidecar 组装 → cargo tauri build（NSIS）。
 *
 * 用法：node desktop/scripts/build.mjs [--skip-download]
 */
import { spawnSync } from 'node:child_process'
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
run('Tauri 构建（NSIS）', 'cargo', ['tauri', 'build', '--bundles', 'nsis'], join(ROOT, 'desktop', 'src-tauri'))

console.log('[build] 完成 → desktop/src-tauri/target/release/bundle/nsis/*-setup.exe')
