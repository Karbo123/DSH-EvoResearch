/**
 * Client bundle 加载校验：模拟浏览器 ModuleLoader 环境执行打包产物，
 * 确认 factory 可运行且导出 apply/inject（纳入 npm run verify）。
 * 用法：node scripts/verify-bundle.mjs
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = join(ROOT, 'packages', 'evoscientist-plugin', 'lib', 'client', 'index.js')

// 模拟浏览器全局（ModuleLoader 的 load 语义：factory 自声明 module/exports 并返回）
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      const { id, factory } = entry
      const require = (spec) => {
        if (spec === 'react' || spec === 'react/jsx-runtime' || spec.startsWith('react')) {
          return new Proxy({}, {
            get(_t, prop) {
              if (prop === 'createElement') return () => ({ __mock: true })
              if (prop === 'Fragment') return 'Fragment'
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

if (!process.env.CI) console.log(`[verify-bundle] 读取 ${BUNDLE}`)
new Function(readFileSync(BUNDLE, 'utf8'))()
console.log('[verify-bundle] 通过：client bundle 可被浏览器 ModuleLoader 加载')
