/**
 * 会话尾部预览（P0-1 数据层）：从会话事件流提取「标题 / 工作区 / 尾部摘录」。
 *
 * 设计：
 * - extractPreview 是纯函数：输入 (sessionId, events)，输出 wire JSON（snake_case
 *   由调用方决定；本结构直接可序列化）。容忍 DSH 深冻结 JSON（只读，不修改事件）。
 * - resolveThreadPreview 是编排函数：数据源注入式（live 内存会话 → sessionQuery →
 *   持久化 jsonl 兜底），全部可选、全部 try/catch 降级；全空返回 null。
 * - 不触碰真实数据根：测试通过注入 sources 完成覆盖。
 */
import { readSessionEvents } from './rewind.js'

/** 会话事件最小视图（容忍 DSH 深冻结 JSON）。 */
export interface PreviewEventLike {
  seq?: unknown
  type?: unknown
  time?: unknown
  data?: any
}

/** 会话尾部预览（wire JSON）。 */
export interface ThreadPreview {
  sessionId: string
  title: string | null
  cwd: string | null
  updatedAt: number
  /** 尾部摘录（最后若干条 assistant/user 文本拼接，≤1600 字符）。 */
  excerpt: string
  /** 参与摘录的消息条数。 */
  messageCount: number
}

/** 摘录单条消息的最大字符数。 */
const PER_MESSAGE_MAX = 300

/** 摘录总字符上限。 */
const EXCERPT_MAX = 1600

/** 摘录最多参与的消息条数。 */
const DEFAULT_TAIL_COUNT = 6

/** 从消息 content（块数组或字符串）提取 text 拼接（容忍深冻结/异形数据）。 */
function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block && typeof block === 'object' && (block as any).type === 'text' && typeof (block as any).text === 'string') {
      parts.push((block as any).text as string)
    }
  }
  return parts.join('')
}

/** 单条消息事件的文本（assistant/message 走 data.message.content；user/message 走 data.content）。 */
function messageText(event: PreviewEventLike): string {
  const data = event?.data as Record<string, unknown> | undefined
  if (!data) return ''
  const type = typeof event.type === 'string' ? event.type : ''
  if (type === 'assistant/message') {
    const message = data.message as Record<string, unknown> | undefined
    return textOfContent(message?.content ?? data.content)
  }
  if (type === 'user/message') {
    return textOfContent(data.content)
  }
  return ''
}

/** 事件 time 的安全数值（非法值记 0）。 */
function eventTime(event: PreviewEventLike): number {
  const t = (event as { time?: unknown }).time
  return typeof t === 'number' && Number.isFinite(t) ? t : 0
}

/**
 * 从会话事件序列提取尾部预览（纯函数）。
 * - title：第一个 type==='session/title' 事件的 data.title（非空字符串）或 null；
 * - cwd：第一个 type==='session' 或 'session/header' 事件的 data.cwd /
 *   data.meta?.cwd 或 null；
 * - excerpt：从尾向头收集 user/assistant 文本（每条 ≤300 字符，累计 ≤1600 停，
 *   最多 tailCount 条），按时间正序（老→新）拼接；
 * - updatedAt：有 seq 的最大 time（无 seq 事件不参与）或 0。
 */
export function extractPreview(sessionId: string, events: readonly PreviewEventLike[], tailCount: number = DEFAULT_TAIL_COUNT): ThreadPreview {
  let title: string | null = null
  let cwd: string | null = null
  for (const event of events) {
    const type = typeof event?.type === 'string' ? event.type : ''
    if (title === null && type === 'session/title') {
      const value = (event?.data as { title?: unknown } | undefined)?.title
      if (typeof value === 'string' && value.trim() !== '') title = value
    }
    if (cwd === null && (type === 'session' || type === 'session/header')) {
      const data = event?.data as Record<string, unknown> | undefined
      const direct = data?.cwd
      const nested = (data?.meta as Record<string, unknown> | undefined)?.cwd
      if (typeof direct === 'string' && direct !== '') cwd = direct
      else if (typeof nested === 'string' && nested !== '') cwd = nested
    }
  }

  // 从尾向头收集消息文本（新→老），随后反转为老→新拼接。
  const maxTail = Math.max(Math.floor(tailCount), 1)
  const collected: string[] = []
  let total = 0
  for (let i = events.length - 1; i >= 0 && collected.length < maxTail; i -= 1) {
    const event = events[i]!
    const type = typeof event?.type === 'string' ? event.type : ''
    if (type !== 'user/message' && type !== 'assistant/message') continue
    const text = messageText(event).trim()
    if (text === '') continue
    const clipped = text.slice(0, PER_MESSAGE_MAX)
    if (total + clipped.length > EXCERPT_MAX) break
    total += clipped.length
    collected.push(clipped)
  }
  collected.reverse()

  // updatedAt：有 seq 的最大 time（缺省 0）。
  let updatedAt = 0
  for (const event of events) {
    if (typeof (event as { seq?: unknown }).seq !== 'number') continue
    const time = eventTime(event)
    if (time > updatedAt) updatedAt = time
  }

  return {
    sessionId,
    title,
    cwd,
    updatedAt,
    excerpt: collected.join('\n'),
    messageCount: collected.length,
  }
}

/** 预览数据源集合（全部可选；按 live → query → file 顺序尝试）。 */
export interface PreviewSources {
  /** live 内存会话（ctx.sessions.get）→ 有 .events 数组即用。 */
  liveGet?(sessionId: string): { events?: readonly PreviewEventLike[] } | undefined
  /** sessionQuery.listEvents 兜底。 */
  queryListEvents?(sessionId: string): Promise<readonly PreviewEventLike[]> | readonly PreviewEventLike[]
  /** 持久化 jsonl 读取兜底（rewind.readSessionEvents 包装）。 */
  fileEvents?(sessionId: string): readonly PreviewEventLike[]
}

/** 判断是否为「非空数组」的可用事件源结果。 */
function isUsableEvents(events: unknown): events is readonly PreviewEventLike[] {
  return Array.isArray(events) && events.length > 0
}

/**
 * 解析一个会话的尾部预览：live 内存会话优先，其次 sessionQuery，
 * 最后持久化 jsonl；每一级失败/为空都静默降级。全空返回 null。
 */
export async function resolveThreadPreview(
  sources: PreviewSources,
  sessionId: string,
  tailCount: number = DEFAULT_TAIL_COUNT,
): Promise<ThreadPreview | null> {
  // 1) live 内存会话
  try {
    const live = sources.liveGet?.(sessionId)
    if (isUsableEvents(live?.events)) return extractPreview(sessionId, live.events, tailCount)
  } catch {
    // live 探测失败 → 下一级
  }
  // 2) sessionQuery.listEvents
  try {
    const fromQuery = await sources.queryListEvents?.(sessionId)
    if (isUsableEvents(fromQuery)) return extractPreview(sessionId, fromQuery, tailCount)
  } catch {
    // query 失败 → 下一级
  }
  // 3) 持久化 jsonl
  try {
    const fromFile = sources.fileEvents?.(sessionId)
    if (isUsableEvents(fromFile)) return extractPreview(sessionId, fromFile, tailCount)
  } catch {
    // 文件读取失败 → 放弃
  }
  return null
}

/** 默认数据源组装（生产入口）：live=ctx.sessions.get，query=sessionQuery.listEvents，file=readSessionEvents 包装。 */
export function defaultPreviewSources(ctx: {
  get(name: string): unknown
}): PreviewSources {
  return {
    liveGet(sessionId) {
      try {
        const store = ctx.get('sessions') as { get?(id: string): unknown } | undefined
        const session = store?.get?.(sessionId) as { events?: readonly PreviewEventLike[] } | undefined
        return session
      } catch {
        return undefined
      }
    },
    async queryListEvents(sessionId) {
      const query = ctx.get('sessionQuery') as
        | { listEvents?: (id: string) => Promise<readonly PreviewEventLike[]> | readonly PreviewEventLike[] }
        | undefined
      if (!query || typeof query.listEvents !== 'function') throw new Error('sessionQuery.listEvents 不可用')
      return await query.listEvents(sessionId)
    },
    fileEvents(sessionId) {
      return readSessionEvents(sessionId) as readonly PreviewEventLike[]
    },
  }
}
