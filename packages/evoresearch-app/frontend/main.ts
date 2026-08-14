/**
 * EvoResearch 前端外壳入口：与官方 @deepseek-ai/dsh-web-frontend 同构，
 * 由 AppWebEntry（@deepseek-ai/dsh-client-web 内核）接管 #root 并执行
 * 两阶段启动（模块侧 → 插件侧）。组合完全由 host 图（window.__DSH_BOOT__）
 * 决定；本入口不做任何组合决策。
 */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'

const el = document.getElementById('root')
if (el === null) throw new Error('EvoResearch: 找不到 #root 挂载点')

new AppWebEntry(el).run()
