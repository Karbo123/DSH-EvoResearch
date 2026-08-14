/**
 * 科研记忆 记忆包（<research_memory_packet>）：每轮注入的科研记忆摘要。
 *
 * 对齐 EvoResearch memory/research/packet.py 与 middleware/memory.py：
 * - 默认 6000 token 预算（DEFAULT_PACKET_TOKEN_BUDGET）；
 * - 每个活跃类别保留 1 个最佳 state（+同类别高分补充候选入口）；
 * - 七类一行目录（category_catalog）；
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

/** 每个类别最多保留的 state 数（1 最佳 + 2 补充候选）。 */
const STATES_PER_CATEGORY = 3

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

  // 2) 每个活跃类别的最佳 state（+同类别补充候选）
  const allStates = store.listTopicStates()
  const byCategory = new Map<ResearchCategory, TopicState[]>()
  for (const state of allStates) {
    const list = byCategory.get(state.category) ?? []
    list.push(state)
    byCategory.set(state.category, list)
  }
  const states: TopicState[] = []
  for (const category of RESEARCH_CATEGORIES) {
    const list = (byCategory.get(category) ?? []).sort((a, b) => b.updatedAt - a.updatedAt)
    const selected = list.slice(0, STATES_PER_CATEGORY)
    states.push(...selected)
  }

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

  // 七类一行目录
  lines.push('类别目录:')
  const active = packet.catalog.filter((entry) => entry.count > 0)
  if (active.length === 0) {
    lines.push('  （暂无历史科研记录）')
  } else {
    for (const entry of packet.catalog) {
      lines.push(`  - ${entry.category}: ${entry.count} 轮`)
    }
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
