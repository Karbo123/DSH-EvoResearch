/**
 * EvoResearch 前端外壳入口：与官方 @deepseek-ai/dsh-web-frontend 同构，
 * 由 AppWebEntry（@deepseek-ai/dsh-client-web 内核）接管 #root 并执行
 * 两阶段启动（模块侧 → 插件侧）。组合完全由 host 图（window.__DSH_BOOT__）
 * 决定；本入口不做任何组合决策。
 */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'

// 开发/验收辅助：?fresh=1 清空本地缓存（ModuleLoader 按模块 id 缓存客户端 bundle，
// 插件更新后旧缓存不会自动失效），带一次该参数即可加载最新代码。
if (new URLSearchParams(location.search).has('fresh')) {
  try { localStorage.clear() } catch { /* 隐私模式等场景忽略 */ }
}

const el = document.getElementById('root')
if (el === null) throw new Error('EvoResearch: 找不到 #root 挂载点')

new AppWebEntry(el).run()
