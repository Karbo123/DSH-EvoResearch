/**
 * CTX-03/04/05/07 检索编排（ContextAssembler 的"找什么"侧）。
 *
 * 与 memory/retrieval.ts 解耦：本模块只依赖结构接口（store / notes / graph /
 * llm / embeddings），不 import memory 内部实现，便于测试与后续替换。
 *
 * - 快速路径（CTX-03，同步）：当前聊天最近消息 + Graph 直接连接 + FTS5 原文
 *   + 研究近况页相关段落；不等待 LLM，保证第一轮调用前可用；
 * - 深入路径（CTX-04，异步）：查询改写（CTX-05，自然语言"本轮需要找什么"，
 *   失败降级原文）→ embedding（可选，缺失静默降级）→ Graph 邻域扩展 →
 *   原文前后文扩展（segment 回读）；
 * - CTX-07：Graph 明确连接加权（×1.5），不屏蔽未连线的高相关资料；
 * - CTX-11：预算内选择（低相关内容不注入、不填满预算）。
 */
import type { ChatGraph, GraphNode } from '../chat-graph.js'

/** 每 token 字符数（与 window.ts 默认一致）。 */
const CHARS_PER_TOKEN = 3

/** Graph 连接加权系数（CTX-07）。 */
export const GRAPH_BOOST_FACTOR = 1.5

/** 候选来源种类。 */
export type CandidateKind =
  | 'turn' // 历史聊天轮次（FTS 原文命中）
  | 'segment' // 轮次内原文片段（前后文扩展）
  | 'observation' // 长期 Observation
  | 'note' // 自由文本笔记段落
  | 'graph' // Graph memory 节点（明确连接）
  | 'chat' // Graph 连接的持续参考聊天
  | 'background' // 研究近况页 / 背景资料
  | 'paper' // 文献（LIB；预留）
  | 'resource' // 普通项目资料（代码、文件、结果、日志、LaTeX）

/** 候选内部定位（供继续深入读取；模型可见，普通用户界面不展示）。 */
export type CandidateLocation =
  | { readonly kind: 'turn'; readonly turnId: string }
  | { readonly kind: 'segment'; readonly turnId: string; readonly segmentId: string }
  | { readonly kind: 'note'; readonly noteId: string; readonly offset: number }
  | { readonly kind: 'observation'; readonly observationId: string }
  | { readonly kind: 'graph'; readonly nodeId: string }
  | { readonly kind: 'chat'; readonly sessionId: string }
  | { readonly kind: 'background'; readonly docKind: string }
  | { readonly kind: 'resource'; readonly path: string; readonly offset?: number; readonly page?: number }

/** 统一检索候选。 */
export interface SearchCandidate {
  readonly kind: CandidateKind
  /** 稳定 id（turnId / noteId / nodeId …）。 */
  readonly id: string
  readonly title: string
  readonly snippet: string
  readonly score: number
  /** 是否来自 Graph 明确连接（CTX-07 加权标记）。 */
  readonly connected: boolean
  /** 是否来自 Graph 邻域扩展（深入路径）。 */
  readonly neighborhood?: boolean
  readonly location: CandidateLocation
  readonly estimatedTokens: number
  /** 人类可读来源标签。 */
  readonly sourceLabel: string
}

// ── 结构接口（真实服务天然满足；测试用 fake）──────────────────────────────

export interface TurnRecordLike {
  readonly turnId: string
  readonly sessionId: string
  readonly workspaceDir?: string
  readonly userText: string
  readonly assistantText: string
  readonly status: string
  readonly categories?: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ObservationLike {
  readonly observationId: string
  readonly title: string
  readonly content: string
  readonly categories?: readonly string[]
  readonly status: string
  readonly fileName?: string
}

export interface MemoryStoreLike {
  searchTurnsFts(query: string, limit: number): Array<{ turn: TurnRecordLike; score: number }>
  searchObservationsFts(query: string, limit: number): Array<{ observation: ObservationLike; score: number }>
  listTurns(sessionId?: string, limit?: number, offset?: number): TurnRecordLike[]
  getTurn(turnId: string): TurnRecordLike | undefined
  listSegments(turnId: string): Array<{ segmentId: string; seq: number; kind: string; payload: string; createdAt: number }>
}

export interface NoteSearchHitLike {
  readonly noteId: string
  readonly title: string
  readonly snippet: string
  readonly offset: number
  readonly score: number
}

export interface BackgroundDocLike {
  readonly kind: string
  readonly exists: boolean
  readonly content: string
}

export interface NotesServiceLike {
  searchIndex(input: { workspaceDir?: string; query: string; limit?: number }): NoteSearchHitLike[]
  readAllBackgroundDocs(input?: { workspaceDir?: string }): Record<string, BackgroundDocLike>
}

/** 嵌入提供者（可选；缺失/未就绪时深入路径静默降级）。 */
export interface EmbeddingProviderLike {
  readonly ready: boolean
  embed(text: string): Promise<number[]>
  similarity(a: number[], b: number[]): number
}

/** 查询改写器（CTX-05；缺失/失败 → 使用原文）。 */
export interface QueryRewriterLike {
  rewrite(question: string): Promise<string | undefined>
}

/** 快速路径输入。 */
export interface FastSearchInput {
  readonly sessionId: string
  /** 当前用户问题（改写前的原文，用于 FTS）。 */
  readonly query: string
  readonly projectName?: string
  readonly workspaceDir?: string
  /** 当前聊天最近消息文本（由集成方/运行时提取；空串跳过该来源）。 */
  readonly recentChatText?: string
  /** Graph 直接连接内容候选（由运行时从 ChatGraph 提取；空数组跳过）。 */
  readonly graphCandidates?: readonly SearchCandidate[]
  /** 项目文件/论文/实验日志等自动发现候选；不要求先固定到 Graph。 */
  readonly resourceCandidates?: readonly SearchCandidate[]
  /** 改写后的查询（快速路径可选；缺省用原文）。 */
  readonly rewrittenQuery?: string
}

/** 深入路径额外输入。 */
export interface DeepSearchInput extends FastSearchInput {
  readonly embeddings?: EmbeddingProviderLike
  readonly rewrite?: QueryRewriterLike
  /** Graph 邻域扩展候选（运行时从 ChatGraph 提取）。 */
  readonly neighborhoodCandidates?: readonly SearchCandidate[]
}

/** 预算选择结果。 */
export interface BudgetSelection {
  readonly included: readonly SearchCandidate[]
  readonly excluded: readonly SearchCandidate[]
  /** 因预算被裁掉的高分候选 id（CTX-10 效果信号）。 */
  readonly prunedIds: readonly string[]
}

/** 估算候选 token（snippet 字符 / CHARS_PER_TOKEN）。 */
export function candidateTokens(snippet: string): number {
  return snippet.length === 0 ? 0 : Math.ceil(snippet.length / CHARS_PER_TOKEN)
}

/** 构造统一候选（自动估算 token）。 */
export function makeCandidate(
  input: Omit<SearchCandidate, 'estimatedTokens'> & { readonly estimatedTokens?: number },
): SearchCandidate {
  return {
    ...input,
    estimatedTokens: input.estimatedTokens ?? candidateTokens(input.snippet),
  }
}

/**
 * 合并候选：按 (kind:id) 去重（保留分数最高者），按分数降序。
 */
export function mergeCandidates(...groups: readonly (readonly SearchCandidate[])[]): SearchCandidate[] {
  const best = new Map<string, SearchCandidate>()
  for (const group of groups) {
    for (const candidate of group) {
      const key = `${candidate.kind}:${candidate.id}`
      const existing = best.get(key)
      if (existing === undefined || candidate.score > existing.score) best.set(key, candidate)
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score)
}

/**
 * CTX-07：Graph 明确连接加权（×GRAPH_BOOST_FACTOR），不屏蔽未连线资料。
 * @param candidates 全部候选。
 * @param connectedIds 明确连接的候选 id（kind:id 键或裸 id 均可匹配）。
 * @param factor 加权系数（默认 1.5）。
 */
export function boostGraphConnections(
  candidates: readonly SearchCandidate[],
  connectedIds: readonly string[],
  factor: number = GRAPH_BOOST_FACTOR,
): SearchCandidate[] {
  const keySet = new Set(connectedIds)
  const bareSet = new Set(connectedIds.map((id) => id.split(':').pop() ?? id))
  return candidates.map((candidate) => {
    const connected = candidate.connected
      || keySet.has(`${candidate.kind}:${candidate.id}`)
      || bareSet.has(candidate.id)
    if (!connected) return candidate
    return { ...candidate, connected: true, score: candidate.score * factor }
  })
}

/**
 * CTX-11：预算内选择——按分数降序注入，超过预算即停；
 * 未达预算也不为填满而注入低分内容。
 * @param candidates 按分数降序的候选。
 * @param budgetTokens token 预算。
 * @returns 注入 / 未注入 + 被裁掉的高分候选 id。
 */
export function selectWithinBudget(candidates: readonly SearchCandidate[], budgetTokens: number): BudgetSelection {
  const included: SearchCandidate[] = []
  const excluded: SearchCandidate[] = []
  const prunedIds: string[] = []
  let used = 0
  for (const candidate of candidates) {
    const tokens = candidate.estimatedTokens
    if (tokens > 0 && used + tokens > budgetTokens) {
      excluded.push(candidate)
      prunedIds.push(candidate.id)
      continue
    }
    included.push(candidate)
    used += tokens
  }
  return { included, excluded, prunedIds }
}

// ── 快速路径（CTX-03）──────────────────────────────────────────────────────

/**
 * 快速路径检索：当前聊天最近消息 + Graph 直接连接 + FTS5 原文 + 研究近况页
 * 相关段落。同步完成（FTS/索引均为同步读），不等待 LLM。
 * @param store 项目记忆库（结构接口）。
 * @param notes 笔记服务（结构接口）。
 * @param input 检索输入。
 * @param perSourceLimit 每来源候选上限。
 */
export function searchFast(
  store: MemoryStoreLike,
  notes: NotesServiceLike,
  input: FastSearchInput,
  perSourceLimit = 8,
): SearchCandidate[] {
  const groups: SearchCandidate[][] = []
  const query = input.rewrittenQuery ?? input.query

  // 1) 当前聊天最近消息（分支背景；只读当前会话，不跨会话——CTX-02）
  if (input.recentChatText !== undefined && input.recentChatText.trim() !== '') {
    groups.push([makeCandidate({
      kind: 'chat',
      id: `recent:${input.sessionId}`,
      title: '当前分支最近消息',
      snippet: input.recentChatText.trim().slice(0, 2000),
      score: 10,
      connected: true,
      location: { kind: 'chat', sessionId: input.sessionId },
      sourceLabel: '当前聊天',
    })])
  }

  // 2) Graph 直接连接内容（CTX-07：connected 候选）
  if (input.graphCandidates !== undefined && input.graphCandidates.length > 0) {
    groups.push([...input.graphCandidates])
  }

  // 2b) 项目混合资料自动发现（CTX-07/CG-LINK-07：未连线资料仍可命中）
  if (input.resourceCandidates !== undefined && input.resourceCandidates.length > 0) {
    groups.push([...input.resourceCandidates])
  }

  // 3) FTS5 原文搜索（turn + observation）
  try {
    const turnHits = store.searchTurnsFts(query, perSourceLimit)
    groups.push(turnHits.map(({ turn, score }) => makeCandidate({
      kind: 'turn',
      id: turn.turnId,
      title: turnTextTitle(turn),
      snippet: turnSnippet(turn),
      score: Math.abs(score),
      connected: false,
      location: { kind: 'turn', turnId: turn.turnId },
      sourceLabel: `聊天轮次（${turn.sessionId.slice(0, 8)}）`,
    })))
  } catch {
    // 检索失败降级：不中断组装
  }
  try {
    const observationHits = store.searchObservationsFts(query, perSourceLimit)
    groups.push(observationHits.map(({ observation, score }) => makeCandidate({
      kind: 'observation',
      id: observation.observationId,
      title: observation.title,
      snippet: observation.content.slice(0, 400),
      score: Math.abs(score) * 1.1,
      connected: false,
      location: { kind: 'observation', observationId: observation.observationId },
      sourceLabel: '长期观察',
    })))
  } catch {
    // 同上
  }

  // 4) 研究近况页相关段落（notes 段落索引 + 背景资料段落）
  try {
    const noteHits = notes.searchIndex({ workspaceDir: input.workspaceDir, query, limit: perSourceLimit })
    groups.push(noteHits.map((hit, index) => makeCandidate({
      kind: 'note',
      id: hit.noteId,
      title: hit.title,
      snippet: hit.snippet.slice(0, 400),
      score: (hit.score > 0 ? hit.score : 1) + (perSourceLimit - index) * 0.05,
      connected: false,
      location: { kind: 'note', noteId: hit.noteId, offset: hit.offset },
      sourceLabel: '研究笔记',
    })))
  } catch {
    // 同上
  }
  try {
    const docs = notes.readAllBackgroundDocs({ workspaceDir: input.workspaceDir })
    for (const [kind, doc] of Object.entries(docs)) {
      if (!doc.exists || doc.content === '') continue
      const paragraphs = matchParagraphs(doc.content, query, 3)
      for (const paragraph of paragraphs) {
        groups.push([makeCandidate({
          kind: 'background',
          id: `${kind}:${hashOf(paragraph)}`,
          title: `研究近况（${kind}）`,
          snippet: paragraph,
          score: 1.2,
          connected: false,
          location: { kind: 'background', docKind: kind },
          sourceLabel: '研究近况页',
        })])
      }
    }
  } catch {
    // 同上
  }

  // 5) CTX-07 加权 + 排序
  const connectedIds = (input.graphCandidates ?? []).map((candidate) => `${candidate.kind}:${candidate.id}`)
  return boostGraphConnections(mergeCandidates(...groups), connectedIds)
}

/** 从正文提取包含查询词的相关段落（确定性简单匹配；每段截断 300 字符）。 */
export function matchParagraphs(content: string, query: string, limit = 3, maxChars = 300): string[] {
  const queryLower = query.trim().toLowerCase()
  if (queryLower === '') return []
  const paragraphs = content.split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
  const hits: string[] = []
  for (const paragraph of paragraphs) {
    const lower = paragraph.toLowerCase()
    const terms = queryLower.split(/\s+/).filter((term) => term.length >= 2)
    const matched = terms.length === 0
      ? lower.includes(queryLower)
      : terms.some((term) => lower.includes(term))
    if (matched) {
      hits.push(paragraph.length > maxChars ? `${paragraph.slice(0, maxChars)}…` : paragraph)
      if (hits.length >= limit) break
    }
  }
  return hits
}

// ── 深入路径（CTX-04/05）───────────────────────────────────────────────────

/**
 * CTX-05：查询改写——辅助模型把问题写成自然语言"本轮需要找什么"。
 * 任何失败（模型不可用/解析失败/超时）都返回 undefined，由调用方降级为原文。
 */
export async function rewriteQuery(rewrite: QueryRewriterLike, question: string): Promise<string | undefined> {
  try {
    const rewritten = await rewrite.rewrite(question)
    if (rewritten === undefined) return undefined
    const trimmed = rewritten.trim()
    return trimmed === '' ? undefined : trimmed
  } catch {
    return undefined
  }
}

/**
 * 深入路径检索（CTX-04）：在快速路径基础上叠加
 * - 查询改写（失败降级原文，CTX-05）；
 * - embedding 语义召回（可选，缺失/失败静默降级）；
 * - Graph 邻域扩展候选；
 * - 原文前后文扩展（top turn 的 segment 片段）。
 * @param onDegraded 降级回调（embedding/改写失败等；可选，供 CTX-10/12 观测）。
 * @returns 合并排序后的候选（调用方再按预算选择）。
 */
export async function searchDeep(
  store: MemoryStoreLike,
  notes: NotesServiceLike,
  input: DeepSearchInput,
  perSourceLimit = 8,
  onDegraded?: (message: string) => void,
): Promise<SearchCandidate[]> {
  let rewrittenQuery = input.rewrittenQuery
  if (rewrittenQuery === undefined && input.rewrite !== undefined) {
    rewrittenQuery = await rewriteQuery(input.rewrite, input.query)
    if (rewrittenQuery === undefined) onDegraded?.('查询改写失败，使用原文')
  }
  const base = searchFast(store, notes, { ...input, rewrittenQuery }, perSourceLimit)
  const groups: SearchCandidate[][] = [base]

  // embedding 语义召回（可选）
  if (input.embeddings?.ready) {
    try {
      const vector = await input.embeddings.embed(input.query)
      const turns = store.listTurns(undefined, 50)
      const scored: Array<{ turn: TurnRecordLike; score: number }> = []
      for (const turn of turns) {
        const cache = embeddingCache.get(turn.turnId)
        if (cache === undefined) continue
        scored.push({ turn, score: input.embeddings.similarity(vector, cache) })
      }
      scored.sort((a, b) => b.score - a.score)
      groups.push(scored.slice(0, perSourceLimit).map(({ turn, score }) => makeCandidate({
        kind: 'turn',
        id: turn.turnId,
        title: turnTextTitle(turn),
        snippet: turnSnippet(turn),
        score: score * 1.2,
        connected: false,
        location: { kind: 'turn', turnId: turn.turnId },
        sourceLabel: '语义召回',
      })))
    } catch {
      // embedding 失败静默降级（CTX-12 覆盖）
      onDegraded?.('embedding 召回失败，跳过语义检索')
    }
  }

  // Graph 邻域扩展
  if (input.neighborhoodCandidates !== undefined && input.neighborhoodCandidates.length > 0) {
    groups.push([...input.neighborhoodCandidates])
  }

  // 原文前后文扩展：top turn 的 segment 片段
  const topTurns = base
    .filter((candidate) => candidate.kind === 'turn')
    .slice(0, 2)
  for (const candidate of topTurns) {
    if (candidate.location.kind !== 'turn') continue
    try {
      const segments = store.listSegments(candidate.location.turnId)
      const relevant = segments
        .filter((segment) => segment.kind === 'assistant' || segment.kind === 'tool')
        .slice(-3)
      for (const segment of relevant) {
        groups.push([makeCandidate({
          kind: 'segment',
          id: segment.segmentId,
          title: `前后文片段（${candidate.title}）`,
          snippet: segment.payload.slice(0, 600),
          score: candidate.score * 0.9,
          connected: false,
          neighborhood: true,
          location: { kind: 'segment', turnId: candidate.location.turnId, segmentId: segment.segmentId },
          sourceLabel: '原文前后文',
        })])
      }
    } catch {
      // 片段读取失败跳过
    }
  }

  const connectedIds = (input.graphCandidates ?? []).map((candidate) => `${candidate.kind}:${candidate.id}`)
  return boostGraphConnections(mergeCandidates(...groups), connectedIds)
}

/** embedding 向量缓存（与 retrieval.ts 语义一致的进程内缓存；可后台预热）。 */
const embeddingCache = new Map<string, number[]>()

/** 供后台预热写入。 */
export function cacheTurnVector(turnId: string, vector: number[]): void {
  embeddingCache.set(turnId, vector)
}

// ── 小工具 ─────────────────────────────────────────────────────────────────

/** 轮次候选标题（取首条用户消息前 60 字符）。 */
export function turnTextTitle(turn: TurnRecordLike): string {
  const text = turn.userText.trim().replace(/\s+/g, ' ')
  return text.length > 60 ? `${text.slice(0, 60)}…` : (text || '聊天轮次')
}

/** 轮次候选摘要（用户消息 + 助手回答前 300 字符）。 */
export function turnSnippet(turn: TurnRecordLike): string {
  const user = turn.userText.trim()
  const assistant = turn.assistantText.trim()
  const parts: string[] = []
  if (user !== '') parts.push(user.length > 200 ? `${user.slice(0, 200)}…` : user)
  if (assistant !== '') parts.push(assistant.length > 300 ? `${assistant.slice(0, 300)}…` : assistant)
  return parts.join(' / ')
}

function hashOf(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

/** 从 ChatGraph 提取当前会话的 chat 节点。 */
export function chatNodeOf(graph: ChatGraph, sessionId: string): GraphNode | undefined {
  return graph.nodes.find((node) => node.type === 'chat' && node.sessionId === sessionId)
}
