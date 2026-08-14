/**
 * Client 插件打包脚本：把 src/client/index.ts 打包为浏览器可加载的
 * `window.__ModuleLoader__.load({ id, factory })` 格式（与 dsh-client-ui-* 一致）。
 *
 * 为什么需要：DSH 的 client-modules 把 client 包的 `./client` 导出作为
 * /plugins/<id>/client.js 提供给浏览器；浏览器端 ModuleLoader 只认
 * factory(require) 的 CommonJS 形态（依赖经 require 注入，@deepseek-ai/* 与
 * react 均为 external）。tsc 裸 ESM 输出无法被该机制加载。
 *
 * 构建顺序：tsc（host + client types）→ 本脚本（覆盖 lib/client/index.js）。
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = join(ROOT, 'packages', 'EvoResearch-plugin')
const ENTRY = join(PKG, 'src', 'client', 'index.ts')
const OUT = join(PKG, 'lib', 'client', 'index.js')
const TMP = join(PKG, 'lib', 'client', '.bundle.tmp.js')

/** 读取包名作为 ModuleLoader id。 */
function packageName() {
  const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'))
  return pkg.name
}

async function main() {
  // 1) esbuild 打包为 CJS（external：平台包与 react）
  await build({
    entryPoints: [ENTRY],
    outfile: TMP,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    external: ['@deepseek-ai/*', 'react', 'react-dom', 'react/jsx-runtime'],
    sourcemap: false,
    minify: false,
  })

  // 2) 包装为 ModuleLoader.load 格式（与官方 client 包一致：factory 内声明 module/exports）
  const body = readFileSync(TMP, 'utf8')
  const id = packageName()
  const wrapped = `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(id)},\n\tfactory: (require) => {\nvar module = { exports: {} };\nvar exports = module.exports;\n${body}\nreturn module.exports;\n\t}\n});\n`
  writeFileSync(OUT, wrapped, 'utf8')
  rmSync(TMP, { force: true })

  console.log(`[build-client] 已生成 ${OUT}（${Math.round(wrapped.length / 1024)} KB，id=${id}）`)
}

main().catch((error) => {
  console.error('[build-client] 失败:', error)
  process.exit(1)
})
