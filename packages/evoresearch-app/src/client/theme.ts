/**
 * 主题管理（跟随系统 + 手动切换）：
 * 默认跟随系统，顶栏切换按钮在 light/dark 之间翻转，偏好存 localStorage
 * （键 evoresearch-theme），`html.dark` 类驱动 token 切换。
 */

const KEY = 'evoresearch-theme'

export type ThemePreference = 'system' | 'light' | 'dark'

export function readPreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'system'
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
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
  localStorage.setItem(KEY, next)
  applyTheme()
}
