/**
 * 应用图标分发工具。
 *
 * 源图（唯一权威）：favicon.svg（Research OS 风格
 * 几何 R 标记），已入库为 packages/evoresearch-app/frontend/favicon.svg：
 * - 前端：构建时随 dist 提供（favicon、顶栏/侧栏 <img src="/favicon.svg">）；
 * - 桌面：本脚本归档到 desktop/icons/icon-source.svg 并调用
 *   `cargo tauri icon` 生成全套平台图标（src-tauri/icons/*，含 exe/窗口/安装包）。
 *
 * 用法：node scripts/gen-icon.mjs
 */
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'packages', 'evoresearch-app', 'frontend', 'favicon.svg')
const ARCHIVE_DIR = join(ROOT, 'desktop', 'icons')
const ARCHIVE = join(ARCHIVE_DIR, 'icon-source.svg')
const TAURI_DIR = join(ROOT, 'desktop', 'src-tauri')

// 1) 归档旧 PNG 源图（不再使用），写入 SVG 源图
rmSync(join(ARCHIVE_DIR, 'icon-source.png'), { force: true })
mkdirSync(ARCHIVE_DIR, { recursive: true })
copyFileSync(SRC, ARCHIVE)
console.log(`[gen-icon] 源图归档 → ${ARCHIVE}`)

// 2) 生成全套平台图标（icon.ico / png / icns / android）
const result = spawnSync('cargo', ['tauri', 'icon', SRC], {
  cwd: TAURI_DIR,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (result.status !== 0) {
  console.error('[gen-icon] tauri icon 失败（需要 Rust 工具链：rustup.rs）')
  process.exit(result.status ?? 1)
}
console.log('[gen-icon] 全套平台图标已生成（src-tauri/icons/）')
