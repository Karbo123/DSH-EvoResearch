#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 安全读取：源文件/构建产物允许缺失（未构建或仓库刚检出时），此时对应检查项
 * 报告 FAIL 而非让整个脚本以未捕获的 ENOENT 崩溃——否则在 CI/初次运行时脚本
 * 会直接抛错，无法给出可读的清单式结果。
 */
function readText(rel) {
  const abs = join(root, rel)
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null
}

const pkgText = readText(join('packages', 'evoresearch-app', 'package.json'))
const pkg = pkgText === null ? {} : JSON.parse(pkgText)
const source = readText(join('packages', 'evoresearch-app', 'src', 'client', 'chatgraph-canvas.ts'))
const worker = readText(join('packages', 'evoresearch-app', 'src', 'client', 'chatgraph-layout-worker.ts'))
const domain = readText(join('packages', 'evoresearch-app', 'src', 'client', 'chatgraph.ts'))
const bundle = readText(join('packages', 'evoresearch-app', 'lib', 'client', 'index.js'))

const checks = [
  ['@xyflow/react dependency', typeof (pkg.dependencies && pkg.dependencies['@xyflow/react']) === 'string'],
  ['elkjs dependency', typeof (pkg.dependencies && pkg.dependencies.elkjs) === 'string'],
  ['XYFlow renderer', source !== null && source.includes('ReactFlow') && source.includes('Handle')],
  ['ELK worker', worker !== null && worker.includes("elkjs/lib/elk.bundled.js") && worker.includes('self.onmessage')],
  ['domain no handwritten SVG renderer', domain !== null && !domain.includes('evo-graph-svg') && !domain.includes('edgePath(')],
  ['built bundle contains XYFlow', bundle !== null && bundle.includes('ReactFlow') && bundle.includes('elk-worker')],
]
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
const layoutTest = existsSync(join(root, 'packages', 'evoresearch-app', 'test', 'chatgraph-layout.test.ts'))
if (!checks.every(([, ok]) => ok) || !layoutTest) {
  if (!layoutTest) console.log('FAIL chatgraph layout regression test')
  process.exit(1)
}
