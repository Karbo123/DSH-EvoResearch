#!/usr/bin/env node
/**
 * verify.mjs — 分层统一验证入口（MIG-08 前置）。
 *
 * 按层执行仓库全部可运行验证，任一层失败不影响其他层执行，末尾汇总并决定退出码。
 *
 * 分层定义：
 *   层 1  unit    插件全量单元测试        packages/evoresearch-plugin: npm test
 *   层 2  graph   图语义脚本              scripts/test-graph-{extract,global,ctx,audit}.mjs（依赖插件 lib/ 构建产物）
 *   层 3  paths   路径与中文编码验证      node --import tsx scripts/verify-paths.mjs
 *   层 4  build   前端表面构建            node scripts/build-app.mjs（构建 packages/evoresearch-app）
 *   层 5  docs    docs 完整性校验         node scripts/check-docs.mjs（存在时执行）
 *   层 6  library LIB 服务级集成验证      node --import tsx scripts/smoke-library.mjs（src 直连，无构建依赖）
 *
 * 用法：
 *   node scripts/verify.mjs                 # 全层执行
 *   node scripts/verify.mjs --skip-build    # 跳过构建相关层（层 4 build 与层 6 library）
 *   node scripts/verify.mjs --only 2        # 只跑层 2（数字或名称：unit/graph/paths/build/docs/library）
 *   node scripts/verify.mjs --list          # 只打印分层清单，不执行
 *
 * 退出码：全层通过 0；任一层失败 1（被 --skip-build/--only 过滤的层不参与判定）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_DIR = join(REPO_ROOT, 'packages', 'evoresearch-plugin')

/** 执行一个命令；stdio 透传（inherit），返回 { ok, code, ms }。 */
function run(cmd, args, opts = {}) {
  const started = Date.now()
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    stdio: 'inherit',
    shell: opts.shell === true,
  })
  const ms = Date.now() - started
  const code = result.status ?? (result.error ? 1 : 0)
  return { ok: code === 0, code, ms }
}

const LAYERS = [
  {
    id: 1,
    name: 'unit',
    title: '插件全量单元测试（npm test）',
    skip: false,
    run: () => run('npm', ['test'], { cwd: PLUGIN_DIR, shell: process.platform === 'win32' }),
  },
  {
    id: 2,
    name: 'graph',
    title: '图语义脚本（test-graph-*.mjs × 4）',
    skip: false,
    run: () => {
      let ok = true
      for (const script of ['test-graph-extract.mjs', 'test-graph-global.mjs', 'test-graph-ctx.mjs', 'test-graph-audit.mjs']) {
        const r = run('node', [join('scripts', script)])
        if (!r.ok) ok = false
      }
      return { ok, code: ok ? 0 : 1, ms: 0 } // ms 由外层合计
    },
  },
  {
    id: 3,
    name: 'paths',
    title: '路径与中文编码验证（verify-paths.mjs）',
    skip: false,
    run: () => run('node', ['--import', 'tsx', join('scripts', 'verify-paths.mjs')]),
  },
  {
    id: 4,
    name: 'build',
    title: '前端表面构建（build-app.mjs）',
    skip: false,
    run: () => run('node', [join('scripts', 'build-app.mjs')]),
  },
  {
    id: 5,
    name: 'docs',
    title: 'docs 完整性校验（check-docs.mjs）',
    skip: !existsSync(join(REPO_ROOT, 'scripts', 'check-docs.mjs')),
    run: () => run('node', [join('scripts', 'check-docs.mjs')]),
  },
  {
    id: 6,
    name: 'library',
    title: 'LIB 服务级集成验证（smoke-library.mjs）',
    skip: !existsSync(join(REPO_ROOT, 'scripts', 'smoke-library.mjs')),
    run: () => run('node', ['--import', 'tsx', join('scripts', 'smoke-library.mjs')]),
  },
]

const args = process.argv.slice(2)
const SKIP_BUILD = args.includes('--skip-build')
const onlyIdx = args.indexOf('--only')
const ONLY = onlyIdx >= 0 && args[onlyIdx + 1] !== undefined ? String(args[onlyIdx + 1]).toLowerCase() : undefined
const LIST = args.includes('--list')

function layerMatch(layer, key) {
  return key === String(layer.id) || key === layer.name
}

if (LIST) {
  console.log('verify.mjs 分层清单（MIG-08 前置）\n')
  for (const layer of LAYERS) {
    console.log(`  层 ${layer.id}  ${layer.name.padEnd(6)} ${layer.title}${layer.skip ? '（脚本缺失，自动跳过）' : ''}`)
  }
  console.log('\n用法：node scripts/verify.mjs [--skip-build] [--only <层号|名称>] [--list]')
  process.exit(0)
}

console.log(`== EvoResearch 统一验证（${new Date().toISOString()}）==\n`)

const results = []
for (const layer of LAYERS) {
  // --skip-build 跳过构建相关层：层 4（前端表面构建）与层 6（LIB 服务级集成验证）
  if (SKIP_BUILD && (layer.id === 4 || layer.id === 6)) {
    results.push({ layer, ok: null, ms: 0, skipped: '--skip-build' })
    console.log(`[层 ${layer.id} ${layer.name}] 跳过（--skip-build）\n`)
    continue
  }
  if (ONLY !== undefined && !layerMatch(layer, ONLY)) {
    results.push({ layer, ok: null, ms: 0, skipped: '--only 过滤' })
    continue
  }
  if (layer.skip) {
    results.push({ layer, ok: null, ms: 0, skipped: '脚本缺失' })
    console.log(`[层 ${layer.id} ${layer.name}] 跳过（对应脚本不存在）\n`)
    continue
  }
  const started = Date.now()
  console.log(`[层 ${layer.id} ${layer.name}] ${layer.title}`)
  const r = layer.run()
  const ms = r.ms > 0 ? r.ms : Date.now() - started
  results.push({ layer, ok: r.ok, ms, skipped: '' })
  console.log(`→ ${r.ok ? 'PASS' : 'FAIL'}（${(ms / 1000).toFixed(1)}s）\n`)
}

// 汇总
console.log('== 汇总 ==')
console.log('  层  名称     结果      耗时')
let failed = 0
let ran = 0
for (const { layer, ok, ms, skipped } of results) {
  const label = skipped !== '' ? `跳过(${skipped})` : ok ? 'PASS' : 'FAIL'
  if (ok === false) failed += 1
  if (ok === true) ran += 1
  console.log(`  ${String(layer.id).padEnd(4)}${layer.name.padEnd(10)}${label.padEnd(9)}${ok === null ? '—' : `${(ms / 1000).toFixed(1)}s`}`)
}
const totalMs = results.reduce((sum, r) => sum + r.ms, 0)
const ranLayers = results.filter((r) => r.ok !== null)
if (ranLayers.length === 0) {
  console.log('\n没有任何层实际执行（--skip-build 与 --only 组合过滤掉了全部层），退出码 0。')
  console.log('提示：--skip-build 会跳过层 4 build 与层 6 library；如需只跑层 6 请去掉 --skip-build（--only library）。')
  process.exit(0)
}
console.log(`\n通过 ${ran}/${ranLayers.length} 层，总耗时 ${(totalMs / 1000).toFixed(1)}s`)
if (failed > 0) {
  console.log('\n存在失败层，退出码 1（失败详情见对应层输出）。')
  process.exit(1)
}
console.log('全部通过。')
process.exit(0)
