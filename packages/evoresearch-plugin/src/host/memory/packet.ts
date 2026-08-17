/**
 * 科研记忆 记忆包（<research_memory_packet>）：每轮注入的科研记忆摘要。
 *
 * 对齐 EvoResearch memory/research/packet.py 与 middleware/memory.py：
 * - 默认 6000 token 预算（DEFAULT_PACKET_TOKEN_BUDGET）；
 * - 旧分类仍保留为可搜索的弱提示，不再为七类固定预留上下文空间；
 * - RRF 混合召回候选（类别/主题/近因加权）；
 * - read_more 提示（read_research_turn / read_memory 可读原始轮次）。
 */
import {
  type MemoryPacket,
  type ResearchCategory,
  type TopicState,
  RESEARCH_CATEGORIES,
} from '../../shared/types.js'
import { estimateTokens } from '../core/llm.js'
import type { ResearchMemoryStore } from './store.js'
import { retrieve, type RetrieveOptions } from './retrieval.js'

/** 默认记忆包 token 预算（与 EvoResearch DEFAULT_PACKET_TOKEN_BUDGET=6000 一致）。 */
export const DEFAULT_PACKET_TOKEN_BUDGET = 6000

/** 相关状态最多保留的条数；旧分类不应吞掉正文预算。 */
const MAX_RELEVANT_STATES = 8

/** 记忆包构建选项。 */
export interface PacketOptions {
  readonly tokenBudget?: number
  readonly query?: string
  readonly categories?: readonly ResearchCategory[]
  readonly retrieve?: RetrieveOptions
}

/**
 * 构建一轮的记忆包。
 * @param store 项目记忆库。
 * @param options 构建选项（query 为当前轮用户消息，用于召回）。
 * @returns 记忆包（含渲染文本与 token 估算）。
 */
export async function buildMemoryPacket(
  store: ResearchMemoryStore,
  options: PacketOptions = {},
): Promise<MemoryPacket> {
  const tokenBudget = options.tokenBudget ?? DEFAULT_PACKET_TOKEN_BUDGET
  const query = options.query ?? ''
  const categories = options.categories

  // 1) 七类一行目录
  const counts = store.countByCategory()
  const catalog = RESEARCH_CATEGORIES.map((category) => ({ category, count: counts[category] ?? 0 }))

  // 2) 旧 topic state 只作为弱提示：有 query 时按词面相关性排序，
  //    没有 query 时仅给最近少量状态；不按七类固定展开。
  const allStates = store.listTopicStates()
  const terms = query.toLocaleLowerCase().split(/[\s,，。！？!?;；:：/]+/).filter((term) => term.length >= 2)
  const stateScore = (state: TopicState): number => {
    const haystack = `${state.label} ${state.topicKey} ${state.decision} ${state.openQuestions.join(' ')}`.toLocaleLowerCase()
    return terms.reduce((score, term) => score + (haystack.includes(term) ? 3 : 0), 0)
  }
  const states = allStates
    .map((state) => ({ state, relevance: stateScore(state) }))
    .sort((a, b) => b.relevance - a.relevance || b.state.updatedAt - a.state.updatedAt)
    .filter((entry) => terms.length === 0 || entry.relevance > 0)
    .slice(0, MAX_RELEVANT_STATES)
    .map((entry) => entry.state)

  // 3) RRF 混合召回（类别加权不硬过滤）
  const hits = query.length > 0
    ? await retrieve(store, query, { categories: categories ?? [], limit: 8, ...(options.retrieve ?? {}) })
    : []

  // 4) read_more 提示：最近未读轮次（每类别取 1 条）
  const readMoreTurnIds = store
    .listTurns(undefined, 30)
    .filter((turn) => !hits.some((hit) => hit.kind === 'turn' && hit.id === turn.turnId))
    .slice(0, 3)
    .map((turn) => turn.turnId)

  const packet: Omit<MemoryPacket, 'text' | 'estimatedTokens'> = {
    catalog,
    states,
    hits,
    readMoreTurnIds,
  }
  const text = renderPacketText(packet)
  return { ...packet, text, estimatedTokens: estimateTokens(text) }
}

/** 渲染记忆包文本（<research_memory_packet> 包裹）。 */
export function renderPacketText(packet: Omit<MemoryPacket, 'text' | 'estimatedTokens'>): string {
  const lines: string[] = []
  lines.push('<research_memory_packet>')
  lines.push('【科研记忆摘要（来自本项目历史轮次与长期观察）】')

  // 旧分类只留一条很短的弱提示；没有活动记录时完全省略。
  lines.push('类别目录:')
  const active = packet.catalog.filter((entry) => entry.count > 0)
  if (active.length === 0) {
    lines.push('  （暂无历史科研记录）')
  } else {
    const hint = active.map((entry) => `${entry.category} ${entry.count}`).join(' · ')
    lines.push(`  （旧分类提示：${hint.slice(0, 220)}；实际内容以相关原文为准）`)
  }

  // 各主题状态
  if (packet.states.length > 0) {
    lines.push('主题状态:')
    for (const state of packet.states.slice(0, 12)) {
      lines.push(`  [${state.category}] ${state.label}(${state.topicKey})`)
      if (state.decision) lines.push(`    决定: ${state.decision.slice(0, 200)}`)
      if (state.openQuestions.length > 0) {
        lines.push(`    开放问题: ${state.openQuestions.slice(0, 3).join('; ').slice(0, 200)}`)
      }
    }
  }

  // 召回候选
  if (packet.hits.length > 0) {
    lines.push('相关历史:')
    for (const hit of packet.hits.slice(0, 6)) {
      lines.push(`  - [${hit.kind}${hit.category ? `/${hit.category}` : ''}] ${hit.snippet.slice(0, 120)}`)
    }
  }

  // read_more 提示
  if (packet.readMoreTurnIds.length > 0) {
    lines.push(`可继续阅读原始轮次（read_research_turn）: ${packet.readMoreTurnIds.join(', ')}`)
  }
  lines.push('</research_memory_packet>')
  return lines.join('\n')
}
