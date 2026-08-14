/**
 * EvoMemory v2 回填（backfill）：把既有会话历史批量索引进 Turn Catalog。
 *
 * 对齐 EvoScientist memory/research/backfill.py：
 * - 项目 Agent 构建时或首次访问 Research API 时后台 newest-first 回填；
 * - 幂等：已存在的轮次（同会话同文本）不重复创建；
 * - 断点续做：research_index_progress 表记录 (memory_dir, project_id, source_version)，
 *   source_version 指纹变化（会话新增消息）时重新回填；
 * - 回填不修改或替代 sessions 原始历史，仅建立科研记忆索引。
 */
import type { ResearchMemoryStore } from './store.js'

/** 回填配置。 */
export interface BackfillOptions {
  /** 会话 id 列表。 */
  readonly sessionIds: readonly string[]
  /** 事件提供器：返回某会话的全部事件（测试注入；生产走 sessionQuery.listEvents）。 */
  readonly eventsOf: (sessionId: string) => Promise<readonly unknown[]>
  /** 所属项目工作区目录。 */
  readonly workspaceDir: string
  /** 项目 id（进度记录键，缺省取 workspace 目录名）。 */
  readonly projectId?: string
}

/** 从事件对象提取 user/message 文本。 */
function extractUserText(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const event = data as { type?: string; data?: { content?: unknown; source?: { kind?: string } } }
  if (event.type !== 'user/message') return undefined
  const source = event.data?.source
  if (source?.kind !== 'user') return undefined
  const content = event.data?.content
  if (!Array.isArray(content)) return undefined
  const text = content
    .map((block) => {
      const b = block as { type?: string; text?: string }
      return typeof b?.text === 'string' ? b.text : ''
    })
    .join('')
    .trim()
  return text.length > 0 ? text : undefined
}

/** 从事件流中提取消息文本（用于 assistant 关联，简化版取该用户消息后最近的 assistant 文本）。 */
function extractAssistantText(events: readonly unknown[], userIndex: number): string {
  for (let i = userIndex + 1; i < events.length; i++) {
    const event = events[i] as { type?: string; data?: { content?: unknown } }
    if (event?.type === 'user/message') break // 下一轮用户消息为止
    if (event?.type !== 'assistant/message') continue
    const content = event.data?.content
    if (!Array.isArray(content)) continue
    const text = content
      .map((block) => {
        const b = block as { type?: string; text?: string }
        return typeof b?.text === 'string' ? b.text : ''
      })
      .join('')
      .trim()
    if (text.length > 0) return text
  }
  return ''
}

/** 事件流的轻量指纹（source_version）：事件数 + 类型序列的短哈希。 */
export function fingerprintEvents(events: readonly unknown[]): string {
  let hash = 0
  let count = 0
  for (const event of events) {
    const e = event as { type?: string }
    if (typeof e?.type === 'string') {
      hash = (hash * 31 + e.type.length) | 0
      count += 1
    }
  }
  return `${count}:${(hash >>> 0).toString(36)}`
}

/**
 * 回填一个项目的会话历史。
 * @param store 项目记忆库。
 * @param options 回填配置。
 * @returns 新建的轮次数。
 */
export async function backfillSessions(store: ResearchMemoryStore, options: BackfillOptions): Promise<number> {
  let created = 0
  const now = Date.now()
  for (const sessionId of options.sessionIds) {
    const events = await options.eventsOf(sessionId)
    for (let i = 0; i < events.length; i++) {
      const userText = extractUserText(events[i])
      if (!userText) continue
      // 幂等：同会话同文本已存在则不重复创建
      if (store.findTurnBySessionText(sessionId, userText)) continue
      const turnId = `bt-${sessionId.slice(0, 8)}-${now.toString(36)}-${created}`
      store.createPendingTurn({
        turnId,
        sessionId,
        workspaceDir: options.workspaceDir,
        userText,
        categories: [],
        topicKeys: [],
      })
      const assistantText = extractAssistantText(events, i)
      store.updateTurn(turnId, {
        status: 'completed',
        ...(assistantText ? { assistantText } : {}),
      })
      // 归档（与正常轮次一致，便于 read_research_turn 阅读完整历史）
      const turn = store.getTurn(turnId)
      if (turn) store.archiveTurn(turn)
      created += 1
    }
  }
  return created
}

/**
 * 回填入口（MemoryRuntime 首次 storeFor 后调用）：
 * 从 DSH sessionQuery 拉取事件并回填，更新断点进度。
 */
export async function backfillFromSessionQuery(
  store: ResearchMemoryStore,
  sessionQuery: {
    listSessions?: (signal?: AbortSignal) => Promise<unknown[]>
    listEvents?: (sessionId: string) => Promise<readonly unknown[]>
  },
  workspaceDir: string,
): Promise<number> {
  const all = (await sessionQuery.listSessions?.()) ?? []
  // 过滤：仅回填属于该项目的会话（header.cwd === workspaceDir）
  const sessionIds = all
    .map((entry) => entry as { id?: string; meta?: { cwd?: string } })
    .filter((entry) => entry.id && entry.meta?.cwd === workspaceDir)
    .map((entry) => entry.id!)
  if (sessionIds.length === 0) return 0
  const created = await backfillSessions(store, {
    sessionIds,
    eventsOf: async (sessionId) => (await sessionQuery.listEvents?.(sessionId)) ?? [],
    workspaceDir,
  })
  // 断点续做：记录进度（source_version = 会话数指纹；MemoryRuntime 负责项目级去重）
  store.setIndexProgress(workspaceDir, workspaceDir.split(/[\\/]/).pop() ?? 'project', `sessions:${sessionIds.length}`, 'complete')
  return created
}
