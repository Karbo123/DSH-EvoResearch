/** §43.5/§44 URL 状态与会话短别名（自 index.ts 抽出，2026-09 有界拆分第二阶段；纯函数搬移，行为不变）。 */
/** URL 查询键（§44 短化）：t=会话短别名 slug，v=视图，i/it=检查器，sb=窄屏抽屉，r=编辑重发。 */
export const URL_KEY_THREAD = 't'
export const URL_KEY_VIEW = 'v'
export const URL_KEY_INSPECTOR = 'i'
export const URL_KEY_INSPECTOR_TAB = 'it'
export const URL_KEY_SIDEBAR = 'sb'
export const URL_KEY_RESEND = 'r'

/**
 * §44 值短化：固定枚举写成 2–3 字符缩写（如 workspace→ws、agents→ag），
 * 保证 v=ws&it=ag 这类参数同样极短；完整单词仍兼容读取（旧分享链接自动识别）。
 */
export const ENC_VALUE_VIEW: Record<string, string> = {
  workspace: 'ws',
  skills: 'sk',
  memory: 'mem',
  schedule: 'sch',
  channels: 'ch',
  team: 'tm',
  experiments: 'exp',
  notes: 'note',
  library: 'lib',
}
export const ENC_VALUE_TAB: Record<string, string> = { workspace: 'ws', agents: 'ag', chats: 'ch' }

/** 写入用：编码枚举值；未知值原样透传（避免意外丢参）。 */
export function encValue(table: Record<string, string>, v: string | null): string | null {
  return v === null || table[v] === undefined ? v : table[v]
}

/** URL 查询状态（§43.5）：可分享/可恢复的导航状态（t/v/i/it…）。 */
export function patchUrl(patch: Record<string, string | null>): void {
  try {
    const params = new URLSearchParams(location.search)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key)
      else params.set(key, value)
    }
    const qs = params.toString()
    history.replaceState(null, '', qs === '' ? location.pathname : `${location.pathname}?${qs}`)
  } catch { /* URL 更新失败不影响功能 */ }
}

// ── §44 会话 URL 短别名：?t=<slug> 替代长 UUID；slug ↔ sessionId 映射后端持久化 ──

/** slug 别名内存缓存（session-meta 启动加载后填充）；key: sessionId, value: slug。 */
export const threadSlugBySession = new Map<string, string>()
export const threadSessionBySlug = new Map<string, string>()

/** 从 session-meta 条目表重建双射映射（幂等）。 */
export function ingestThreadSlugs(meta: Record<string, { slug?: string } | undefined>): void {
  for (const [sessionId, entry] of Object.entries(meta)) {
    if (typeof entry?.slug !== 'string' || entry.slug === '') continue
    if (!threadSlugBySession.has(sessionId)) {
      threadSlugBySession.set(sessionId, entry.slug)
      if (!threadSessionBySlug.has(entry.slug)) threadSessionBySlug.set(entry.slug, sessionId)
    }
  }
}

/** 取会话的 slug 别名（未登记返回 null，调用方需自行 ensure）。 */
export function threadSlugOf(sessionId: string): string | null {
  return threadSlugBySession.get(sessionId) ?? null
}

/**
 * 异步为会话分配短别名并更新当前 URL（openSession 已写入 ?t= 占位）。
 * preferred 传会话标题（AI slug 优先），失败时由 host 回退 s-<短哈希>；
 * 竞态保护：仅当 URL 当前仍指向同一会话时才替换参数值。
 */
export async function ensureThreadAlias(sessionId: string, preferred: string | undefined): Promise<void> {
  try {
    const res = await fetch('/evoresearch/fs/session-slug-ensure', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, ...(preferred !== undefined && preferred.trim() !== '' ? { preferred: preferred.slice(0, 200) } : {}) }),
    })
    const json = await res.json()
    const slug = json?.value?.slug
    if (typeof slug !== 'string' || slug === '') return
    if (!threadSlugBySession.has(sessionId)) {
      threadSlugBySession.set(sessionId, slug)
      if (!threadSessionBySlug.has(slug)) threadSessionBySlug.set(slug, sessionId)
    }
    // 仅当分享链接仍停在该会话的占位短哈希上时才替换为正式 slug（用户已切走则不动）
    const params = new URLSearchParams(location.search)
    if (params.get(URL_KEY_THREAD) === sessionId.replace(/^session-/, '').slice(0, 8)) patchUrl({ [URL_KEY_THREAD]: slug })
  } catch { /* 别名分配失败不影响功能，占位仍在 */ }
}

/** 解析 URL ?t= 的会话 id：已登记 slug 直接反查；未知的先试 host 反查，再兜底按占位短哈希还原。 */
export async function resolveThreadIdParam(value: string | null): Promise<string | null> {
  if (value === null || value === '') return null
  const direct = value.startsWith('session-')
    ? value
    : (/^[0-9a-f]{1,8}$/i.test(value) ? `session-${value}` : threadSessionBySlug.get(value) ?? null)
  if (direct !== null) return direct
  try {
    const res = await fetch('/evoresearch/fs/session-slug-lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: value }),
    })
    const json = await res.json()
    const sessionId = json?.value?.sessionId
    if (typeof sessionId === 'string' && sessionId !== '') {
      if (!threadSlugBySession.has(sessionId)) {
        threadSlugBySession.set(sessionId, value)
        threadSessionBySlug.set(value, sessionId)
      }
      return sessionId
    }
  } catch { /* 反查失败按不存在处理 */ }
  return null
}
