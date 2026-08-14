/**
 * 科研记忆 混合检索：FTS5 + （可选）向量，RRF 融合，类别加权不硬过滤。
 *
 * 对齐 EvoResearch memory/research/retrieval.py：
 * - 候选来源：research_turns（FTS5）、observations（FTS5，默认 ACTIVE）、topic states；
 * - RRF（Reciprocal Rank Fusion）：score = Σ 1/(k + rank)，k=60；
 * - 类别加权：查询命中类别时对同类别结果加权（×1.5），但**不**做硬过滤；
 * - 向量召回（multilingual-e5）在 EmbeddingProvider 可用时叠加；
 *   模型未就绪/不可用时自动退化 FTS，不阻塞主回答。
 */
import type { ResearchCategory } from '../../shared/types.js'
import type { MemoryHit } from '../../shared/types.js'
import type { ResearchMemoryStore } from './store.js'
import { ResearchMemoryStore as Store } from './store.js'

/** RRF 常数 k。 */
const RRF_K = 60

/** 类别加权系数（查询命中类别 ×1.5，其他 ×1.0）。 */
const CATEGORY_WEIGHT = 1.5

/** 向量检索提供者接口（第一版可空；接入远端 embedding API 或本地模型后实现）。 */
export interface EmbeddingProvider {
  /** 模型是否可用。 */
  readonly ready: boolean
  /** 计算一段文本的向量。 */
  embed(text: string): Promise<number[]>
  /** 向量相似度（余弦）。 */
  similarity(a: number[], b: number[]): number
}

/** 检索选项。 */
export interface RetrieveOptions {
  /** 类别加权：命中这些类别时加权（不硬过滤）。 */
  readonly categories?: readonly ResearchCategory[]
  /** 每来源最多候选数。 */
  readonly perSourceLimit?: number
  /** 最终返回条数。 */
  readonly limit?: number
  /** 可选的向量提供者。 */
  readonly embeddings?: EmbeddingProvider
  /** 是否包含 topic states 结果。 */
  readonly includeStates?: boolean
}

interface RankedCandidate {
  readonly hit: MemoryHit
  rank: number
}

/**
 * 对多个来源的排序列表做 RRF 融合。
 * @param ranked 各来源按分数从高到低排列的候选（分数绝对值仅用于排序）。
 * @returns 融合后的 MemoryHit 列表（按 RRF 分数降序）。
 */
export function fuseRrf(...sources: Array<Array<{ hit: MemoryHit; score: number }>>): MemoryHit[] {
  const seen = new Map<string, RankedCandidate>()
  for (const source of sources) {
    source.forEach((entry, index) => {
      const key = `${entry.hit.kind}:${entry.hit.id}`
      const existing = seen.get(key)
      if (!existing) {
        seen.set(key, { hit: entry.hit, rank: index + 1 })
      } else {
        existing.rank += index + 1
      }
    })
  }
  return [...seen.values()]
    .map((candidate) => ({ ...candidate.hit, score: 1 / (RRF_K + candidate.rank) }))
    .sort((a, b) => b.score - a.score)
}

/**
 * 执行混合检索。
 * @param store 项目记忆库。
 * @param query 用户查询文本。
 * @param options 检索选项。
 * @returns 融合排序后的命中列表。
 */
export async function retrieve(
  store: ResearchMemoryStore,
  query: string,
  options: RetrieveOptions = {},
): Promise<MemoryHit[]> {
  const perSource = options.perSourceLimit ?? 20
  const limit = options.limit ?? 12
  const ftsQuery = Store.toFtsQuery(query)
  const sources: Array<Array<{ hit: MemoryHit; score: number }>> = []

  if (ftsQuery.length > 0) {
    // 轮次检索
    const turns = store.searchTurnsFts(ftsQuery, perSource)
    sources.push(
      turns.map(({ turn, score }) => ({
        hit: {
          kind: 'turn',
          id: turn.turnId,
          score: Math.abs(score),
          category: turn.categories[0],
          topicKey: turn.topicKeys[0],
          snippet: turn.userText.slice(0, 200),
          createdAt: turn.createdAt,
        } satisfies MemoryHit,
        score: Math.abs(score),
      })),
    )
    // Observation 检索（默认只出 ACTIVE）
    const observations = store.searchObservationsFts(ftsQuery, perSource)
    sources.push(
      observations.map(({ observation, score }) => ({
        hit: {
          kind: 'observation',
          id: observation.observationId,
          score: Math.abs(score),
          category: observation.primaryCategory ?? observation.categories[0],
          topicKey: observation.topicKeys[0],
          snippet: observation.title,
          createdAt: observation.createdAt,
        } satisfies MemoryHit,
        score: Math.abs(score),
      })),
    )
    // Topic states 检索
    if (options.includeStates !== false) {
      const states = store.searchTopicStatesFts(ftsQuery, perSource)
      sources.push(
        states.map((state, index) => ({
          hit: {
            kind: 'observation',
            id: `state:${state.category}:${state.topicKey}`,
            score: 1 / (index + 1),
            category: state.category,
            topicKey: state.topicKey,
            snippet: `${state.label}: ${state.decision.slice(0, 100)}`,
            createdAt: state.updatedAt,
          } satisfies MemoryHit,
          score: 1 / (index + 1),
        })),
      )
    }
  }

  // 向量召回（可选）：query 与候选文本的相似度作为额外来源
  if (options.embeddings?.ready) {
    const embeddings = options.embeddings
    const queryVector = await embeddings.embed(query)
    const turnCandidates = store.listTurns(undefined, 50)
    const vectorCandidates: Array<{ hit: MemoryHit; score: number }> = []
    for (const turn of turnCandidates) {
      const vector = turnVectorCache.get(turn.turnId)
      if (!vector) continue
      vectorCandidates.push({
        hit: {
          kind: 'turn',
          id: turn.turnId,
          score: embeddings.similarity(queryVector, vector),
          category: turn.categories[0],
          topicKey: turn.topicKeys[0],
          snippet: turn.userText.slice(0, 200),
          createdAt: turn.createdAt,
        },
        score: 0,
      })
    }
    vectorCandidates.sort((a, b) => b.hit.score - a.hit.score)
    sources.push(vectorCandidates.slice(0, perSource))
  }

  // 类别加权（不硬过滤）：命中类别 ×1.5
  const weighted = fuseRrf(...sources).map((hit) => {
    if (hit.category && options.categories?.includes(hit.category)) {
      return { ...hit, score: hit.score * CATEGORY_WEIGHT }
    }
    return hit
  })
  return weighted.slice(0, limit)
}

/** 轮次向量缓存（EmbeddingProvider 后台预热；内存级，重启丢失可重建）。 */
const turnVectorCache = new Map<string, number[]>()

/** 供 embedding 后台线程写入的缓存钩子。 */
export function cacheTurnVector(turnId: string, vector: number[]): void {
  turnVectorCache.set(turnId, vector)
}
