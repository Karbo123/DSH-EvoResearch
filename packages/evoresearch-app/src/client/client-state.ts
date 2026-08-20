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

function syncSet(key: string, value: string | null): void {
  const pendingItem = pending.get(key)
  if (pendingItem !== undefined) clearTimeout(pendingItem.timer)
  pending.set(key, {
    value,
    timer: setTimeout(() => {
      const item = pending.get(key)
      pending.delete(key)
      if (item === undefined) return
      void fetch(SET_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, value: item.value }),
      }).catch(() => {})
    }, 80),
  })
}

/** 写穿：localStorage + 后端文件（value 为要写入 localStorage 的原始字符串）。 */
export function clientStateSet(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* 本地缓存失败不影响功能 */ }
  syncSet(key, value)
}

/** 删除一个键：localStorage + 后端文件。 */
export function clientStateDelete(key: string): void {
  try { localStorage.removeItem(key) } catch { /* 忽略 */ }
  syncSet(key, null)
}

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
