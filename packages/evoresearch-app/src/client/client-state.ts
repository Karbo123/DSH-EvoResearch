/**
 * 客户端状态镜像（§29）：把原本只存在 localStorage 的 UI 偏好 / 历史等
 * 写穿到后端 client-state.json，localStorage 仅作启动缓存。
 * 换浏览器 / 设备后，启动时从文件拉回并回填 localStorage，体验不丢。
 *
 * 值一律以字符串保存（与 localStorage 一一对应），key 直接用 localStorage 键。
 */

const GET_URL = '/evoresearch/fs/client-state-get'
const SET_URL = '/evoresearch/fs/client-state-set'
const CLEAR_URL = '/evoresearch/fs/client-state-clear'

/** 高频写穿队列：同键多次覆盖时丢弃旧值，只发最后一次（如输入历史节流）。 */
const pending = new Map<string, { value: string | null; timer: ReturnType<typeof setTimeout> }>()

function postSet(key: string, value: string | null): void {
  const body = JSON.stringify({ key, value })
  // 关键偏好（语言等）用 keepalive/sendBeacon 保证卸载前送达
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && (key === 'evoresearch-lang' || key === 'evoresearch-theme')) {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon(SET_URL, blob)) return
    }
  } catch { /* 回退 fetch */ }
  void fetch(SET_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  } as RequestInit).catch(() => {})
}

function syncSet(key: string, value: string | null): void {
  const pendingItem = pending.get(key)
  if (pendingItem !== undefined) clearTimeout(pendingItem.timer)
  pending.set(key, {
    value,
    timer: setTimeout(() => {
      const item = pending.get(key)
      pending.delete(key)
      if (item === undefined) return
      postSet(key, item.value)
    }, 80),
  })
}

/** 立即写穿（用于语言切换等需在 reload 前持久化的关键操作）。 */
export function clientStateFlush(key?: string): void {
  if (key !== undefined) {
    const item = pending.get(key)
    if (item !== undefined) {
      clearTimeout(item.timer)
      pending.delete(key)
      postSet(key, item.value)
    }
    return
  }
  for (const [k, item] of [...pending.entries()]) {
    clearTimeout(item.timer)
    pending.delete(k)
    postSet(k, item.value)
  }
}

/** 写穿：localStorage + 后端文件（value 为要写入 localStorage 的原始字符串）。 */
export function clientStateSet(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* 本地缓存失败不影响功能 */ }
  locallyDirty.add(key)
  syncSet(key, value)
}

/** 删除一个键：localStorage + 后端文件。 */
export function clientStateDelete(key: string): void {
  try { localStorage.removeItem(key) } catch { /* 忽略 */ }
  locallyDirty.delete(key)
  syncSet(key, null)
}

/** 本会话内被本地写过的键：hydrate 时这些键保留本地值（本地比后端新），
 * 其余键一律以后端文件为准回填，保证换浏览器/设备后状态能真正恢复。
 * 之前对所有 evoresearch-* 键无条件保留本地，后端永不覆盖 → 跨设备同步失效。 */
const locallyDirty = new Set<string>()

/** 从 localStorage 同步返回键值（不触发后端写穿）。 */
export function clientStateGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

/** 启动时拉取文件状态并回填 localStorage；返回完整状态表。 */
export async function clientStateHydrate(): Promise<Record<string, string>> {
  try {
    const res = await fetch(GET_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const json = await res.json()
    const state = (json.ok === true && typeof json.value === 'object' && json.value !== null)
      ? (json.value as Record<string, string>)
      : {}
    for (const [key, value] of Object.entries(state)) {
      if (typeof value === 'string') {
        // 本会话刚写过的键（如用户切了语言但 reload 前写穿还在途）保留本地，
        // 避免被旧后端值覆盖导致切换失效；其余以后端文件为准。
        let local: string | null = null
        if (locallyDirty.has(key)) {
          try { local = localStorage.getItem(key) } catch { /* 忽略 */ }
        }
        if (local !== null && local !== value) continue
        try { localStorage.setItem(key, value) } catch { /* 忽略 */ }
      }
    }
    return state
  } catch {
    return {}
  }
}

/** 启动迁移：把旧 localStorage 里仍存在的客户端键补写一份到后端，换浏览器/设备后也能恢复。 */
export function clientStateMigrateLocalKeys(prefixes: string[]): void {
  const keys = new Set<string>()
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key !== null && prefixes.some((prefix) => key.startsWith(prefix))) keys.add(key)
    }
  } catch { /* localStorage 不可用时跳过迁移 */ }
  for (const key of keys) {
    const value = clientStateGet(key)
    if (value !== null) syncSet(key, value)
  }
}

/** 清除文件中的全部客户端状态（配合“清除所有数据”）。 */
export function clientStateClear(): void {
  void fetch(CLEAR_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {})
}
