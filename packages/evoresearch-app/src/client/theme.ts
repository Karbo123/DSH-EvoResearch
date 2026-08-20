/**
 * 主题管理（默认深色 + 手动切换）：
 * 无偏好时默认深色主题（dark），顶栏切换按钮在 light/dark 之间翻转，
 * 偏好存 localStorage（键 evoresearch-theme）并写穿到后端 client-state.json，
 * `html.dark` 类驱动 token 切换。
 */
import { clientStateGet, clientStateSet } from './client-state'

const KEY = 'evoresearch-theme'

export type ThemePreference = 'system' | 'light' | 'dark'

export function readPreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'dark'
  const v = clientStateGet(KEY)
  return v === 'light' || v === 'dark' ? v : 'dark'
}

export function systemDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
}

/** 解析当前生效的主题（resolve 系统偏好）。 */
export function resolvedTheme(): 'light' | 'dark' {
  const pref = readPreference()
  return pref === 'system' ? (systemDark() ? 'dark' : 'light') : pref
}

/** 应用主题到 document（html.dark + color-scheme）。 */
export function applyTheme(): void {
  const dark = resolvedTheme() === 'dark'
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

/** 顶栏切换：按当前生效主题翻转并持久化。 */
export function toggleTheme(): void {
  const next = resolvedTheme() === 'dark' ? 'light' : 'dark'
  clientStateSet(KEY, next)
  applyTheme()
}
