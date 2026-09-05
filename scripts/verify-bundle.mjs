/**
 * Client bundle 加载校验：模拟浏览器 ModuleLoader 环境执行打包产物，
 * 确认 factory 可运行且导出 apply/inject（纳入 npm run verify）。
 * 用法：node scripts/verify-bundle.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** 参与加载校验的 client bundle（每个有 dsh.client 声明的包）。 */
const BUNDLES = [
  join(ROOT, 'packages', 'evoresearch-plugin', 'lib', 'client', 'index.js'),
  join(ROOT, 'packages', 'evoresearch-app', 'lib', 'client', 'index.js'),
]

// 模拟浏览器全局（ModuleLoader 的 load 语义：factory 自声明 module/exports 并返回）
// 轻量 DOM mock：app bundle 顶层会触及 document（图标/样式初始化），此处提供最小可用替身
const mockDocument = {
  compatMode: 'CSS1Compat',
  createElement: () => ({
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
    setAttribute() {},
    getAttribute() { return null },
    appendChild() { return this },
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null },
    querySelectorAll() { return [] },
    innerHTML: '',
    textContent: '',
  }),
  createElementNS: () => ({
    style: {},
    setAttribute() {},
    appendChild() {},
    classList: { add() {}, remove() {} },
  }),
  head: { appendChild() {}, querySelector() { return null } },
  body: { appendChild() {}, querySelector() { return null } },
  documentElement: { style: {} },
  querySelector() { return null },
  querySelectorAll() { return [] },
  getElementById() { return null },
  addEventListener() {},
}
globalThis.document = mockDocument
try { globalThis.navigator = { userAgent: 'node-verify' } } catch { try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-verify' }, configurable: true }) } catch {} }
// ELK（GWT 产物）随 chatgraph 布局引擎进入 app bundle，模块初始化期会执行
// `$wnd.Error.stackTraceLimit = ...`（$wnd 即浏览器 window）。mock window 必须像
// 浏览器一样暴露这些构造器，否则 bundle 加载校验在 ELK 环境探测处崩溃。
globalThis.window = {
  // 浏览器 window 上的常用构造器/全局（GWT 环境探测所需）
  Error,
  TypeError,
  RangeError,
  EvalError,
  Date,
  Math,
  JSON,
  Promise,
  Uint8Array,
  document: mockDocument,
  __ModuleLoader__: {
    load(entry) {
      const { id, factory } = entry
      const require = (spec) => {
        if (spec === 'react' || spec === 'react/jsx-runtime' || spec.startsWith('react')) {
          return new Proxy({}, {
            get(_t, prop) {
              if (prop === 'createElement') return () => ({ __mock: true })
              if (prop === 'Fragment') return 'Fragment'
              if (prop === 'Component') return class Component { constructor() {} }
              if (prop === 'default') return undefined
              return () => ({ __mock: true })
            },
          })
        }
        return {}
      }
      const mod = factory(require)
      console.log(`[verify-bundle] ${id}: apply=${typeof mod.apply} inject=${JSON.stringify(mod.inject)}`)
      if (typeof mod.apply !== 'function') throw new Error('缺少 apply 导出')
      if (!Array.isArray(mod.inject)) throw new Error('缺少 inject 导出')
    },
  },
}

for (const bundle of BUNDLES) {
  if (!existsSync(bundle)) {
    console.error(`[verify-bundle] FAIL 缺少构建产物 ${bundle} —— 请先执行 npm run build`)
    process.exit(1)
  }
  if (!process.env.CI) console.log(`[verify-bundle] 读取 ${bundle}`)
  new Function(readFileSync(bundle, 'utf8'))()
}
console.log('[verify-bundle] 通过：全部 client bundle 可被浏览器 ModuleLoader 加载')
