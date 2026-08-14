/**
 * 文档完整性校验：检查 docs/ 目录引用与关键文件存在性（CI 用）。
 * 用法：node scripts/check-docs.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REQUIRED = [
  'README.md',
  'docs/00-decisions.md',
  'docs/01-architecture.md',
  'docs/02-feature-map.md',
  'docs/03-development.md',
  'docs/04-desktop.md',
  'packages/evoresearch-plugin/package.json',
  'packages/evoresearch-plugin/cordis.patch.yml',
  'profiles/evoresearch/package.json',
  'desktop/src-tauri/tauri.conf.json',
]

let failed = false
for (const file of REQUIRED) {
  if (!existsSync(join(ROOT, file))) {
    console.error(`[docs-check] 缺失: ${file}`)
    failed = true
  }
}

// 交叉引用校验：docs 中的相对链接目标必须存在
for (const dir of ['docs', 'README.md', 'packages/evoresearch-plugin/README.md']) {
  const file = join(ROOT, dir)
  if (!existsSync(file) || statSync(file).isDirectory()) continue
  const content = readFileSync(file, 'utf8')
  const refs = content.match(/\]\(([^)#]+)(?:#[^)]+)?\)/g) ?? []
  for (const ref of refs) {
    const target = ref.slice(2, -1).split('#')[0]
    if (!target || /^https?:/.test(target)) continue
    if (!existsSync(join(ROOT, target))) {
      console.error(`[docs-check] 悬空引用: ${dir} → ${target}`)
      failed = true
    }
  }
}

if (failed) {
  console.error('[docs-check] 未通过')
  process.exit(1)
}
console.log(`[docs-check] 通过（${REQUIRED.length} 个必需文件 + 交叉引用）`)
