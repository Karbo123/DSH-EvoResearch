/**
 * EvoResearch 自定义表面（@evoresearch/dsh-app）构建脚本。
 *
 * 三段产物：
 * 1. node half：src/index.ts → lib/index.js（ESM，external @deepseek-ai/*，
 *    运行时由 profile node_modules 解析）；
 * 2. client 插件：src/client.ts → lib/client/index.js（CJS + ModuleLoader.load
 *    包装，与官方 dsh-client-ui-* 一致；react 与 @deepseek-ai/* 均 external，
 *    由 web 外壳的 staticModules 表提供）；
 * 3. 前端外壳：frontend/main.ts → dist/assets/index.js（全内联的浏览器 ESM，
 *    含 @deepseek-ai/dsh-client-web 内核及其依赖）+ dist/index.html + favicon。
 *
 * 用法：node scripts/build-app.mjs
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = join(ROOT, 'packages', 'evoresearch-app')

/** 读取包名作为 ModuleLoader id。 */
function packageName() {
  const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'))
  return pkg.name
}

async function buildNodeHalf() {
  // 包根：空 apply（官方 ui-* node half 同构）；真实运行时在 ./runtime 子路径
  await build({
    entryPoints: [join(PKG, 'src', 'index.ts')],
    outfile: join(PKG, 'lib', 'index.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external: ['@deepseek-ai/*'],
    sourcemap: false,
  })
  await build({
    entryPoints: [join(PKG, 'src', 'runtime.ts')],
    outfile: join(PKG, 'lib', 'runtime.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external: ['@deepseek-ai/*'],
    sourcemap: false,
  })
  await build({
    entryPoints: [join(PKG, 'src', 'directory-picker.ts')],
    outfile: join(PKG, 'lib', 'directory-picker.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external: ['@deepseek-ai/*'],
    sourcemap: false,
  })
  console.log('[build-app] node half → lib/index.js + lib/runtime.js + lib/directory-picker.js')
}

async function buildClient() {
  const tmp = join(PKG, 'lib', 'client', '.bundle.tmp.js')
  const out = join(PKG, 'lib', 'client', 'index.js')
  await build({
    entryPoints: [join(PKG, 'src', 'client', 'index.ts')],
    outfile: tmp,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    external: ['@deepseek-ai/*', 'react', 'react-dom', 'react/jsx-runtime'],
    sourcemap: false,
    minify: false,
  })
  const body = readFileSync(tmp, 'utf8')
  const id = packageName()
  const wrapped = `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(id)},\n\tfactory: (require) => {\nvar module = { exports: {} };\nvar exports = module.exports;\n${body}\nreturn module.exports;\n\t}\n});\n`
  writeFileSync(out, wrapped, 'utf8')
  rmSync(tmp, { force: true })
  console.log(`[build-app] client → lib/client/index.js（${Math.round(wrapped.length / 1024)} KB，id=${id}）`)
}

async function buildFrontend() {
  const dist = join(PKG, 'dist')
  const assets = join(dist, 'assets')
  mkdirSync(assets, { recursive: true })
  await build({
    entryPoints: [join(PKG, 'frontend', 'main.ts')],
    outfile: join(assets, 'index.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: false,
    minify: false,
    // 与官方 apps/web 相同的浏览器化处理：
    // 1) vendored cordis Loader 唯一的 node-only import → 抛错替身；
    // 2) loader internal.ts 的 process 探测 → 走"空内部槽"分支
    //    （"0.0.0" 不命中任何 Node major 分支，返回 undefined）；
    // 3) loader index.ts 的 envData → 默认分支。
    alias: {
      'node:module': join(PKG, 'frontend', 'node-module-stub.ts'),
      // 官方 dsh-client-modules/client 的发布形态是 ModuleLoader.load 包装
      // （供 /plugins/<id>/client.js 使用）；内核（dsh-client-web）静态
      // import 它时必须用"源码形态"（官方 vite 用 alias 到 src 的做法），
      // 否则内联进 index.js 的包装会在模块系统建立前访问
      // window.__ModuleLoader__ 而崩溃。此处 vendored 官方源码（MIT）。
      '@deepseek-ai/dsh-client-modules/client': join(PKG, 'vendor', 'dsh-client-modules', 'index.ts'),
    },
    define: {
      'process.versions.node': '"0.0.0"',
      'process.execArgv': '[]',
      'process.env.CORDIS_SHARED': 'undefined',
    },
    // 传递依赖（katex 等）的 CSS 引用了字体/图片资源：直接内联为 dataurl，
    // 避免 esbuild 需要文件 loader 且运行时额外请求。
    loader: {
      '.woff2': 'dataurl',
      '.woff': 'dataurl',
      '.ttf': 'dataurl',
      '.png': 'dataurl',
      '.svg': 'dataurl',
      '.gif': 'dataurl',
    },
  })
  copyFileSync(join(PKG, 'frontend', 'index.html'), join(dist, 'index.html'))
  copyFileSync(join(PKG, 'frontend', 'favicon.svg'), join(dist, 'favicon.svg'))
  console.log('[build-app] frontend → dist/（index.html + assets/index.js + favicon.svg）')
}

async function main() {
  await buildNodeHalf()
  await buildClient()
  await buildFrontend()
  console.log('[build-app] 完成')
}

main().catch((error) => {
  console.error('[build-app] 失败:', error)
  process.exit(1)
})
