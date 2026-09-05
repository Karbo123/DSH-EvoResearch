/**
 * /evoresearch/fs/* 传输层统一封装。
 *
 * 之前 9 个面板各自复制了同样的 fetch + JSON 解包样板（panels / research-notes /
 * experiments / experiment-workspace / ledger-panel / rounds-panel /
 * daily-report-card / library-panel / context-trace），行为有细微不一致
 * （是否检查 res.ok、JSON 解析失败的表现、value 内嵌 error 的容错）。
 * 这里收敛为两个入口：
 *  - api()：标准信封 { ok:true, value } / { ok:false, error:{message} }；
 *  - apiTolerant()：在 api() 之上额外兼容部分远端把 { error: string } 塞进
 *    value（且无 ok 字段）的服务不可用形态（ledger / 实验工作区历史行为）。
 */
import { t } from './i18n'

interface Envelope {
  ok?: boolean
  value?: unknown
  error?: { message?: string }
}

/** POST /evoresearch/fs/<route>，返回解包后的 value；失败抛 Error。 */
export async function api<T>(route: string, body: Record<string, unknown> = {}, fallbackMessage?: string): Promise<T> {
  const res = await fetch(`/evoresearch/fs/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const fallback = fallbackMessage ?? t('requestFailed')
  let json: Envelope
  try {
    json = await res.json() as Envelope
  } catch {
    // 非 JSON 响应（网关 502 / 空 body 等）：统一走失败语义，不抛解析裸错
    throw new Error(fallback)
  }
  if (!res.ok || json.ok !== true) throw new Error(json.error?.message ?? fallback)
  return json.value as T
}

/** api() 的容错变体：value 内嵌字符串 error（且无 ok 字段）时同样抛错。 */
export async function apiTolerant<T>(route: string, body: Record<string, unknown> = {}, fallbackMessage?: string): Promise<T> {
  const value = await api<T>(route, body, fallbackMessage)
  if (value !== null && typeof value === 'object') {
    const v = value as unknown as { error?: unknown; ok?: unknown }
    // some remotes return { error: string } inside value on service unavailable；
    // 区分 ok:false 形态——带 ok 字段的交由调用方自行处理
    if (typeof v.error === 'string' && !('ok' in v)) throw new Error(v.error)
  }
  return value
}
