/**
 * per-turn adaptive tool selector（PLAT-14）。
 *
 * 工具过多时只展示与当前任务相关的工具，但**始终保留**记忆、任务控制与
 * 思考所需的基础工具（BASE_TOOL_WHITELIST），避免把记忆/任务控制工具剪掉。
 *
 * 纯函数：selectToolsForTurn(available, query, options)。
 * 注册点说明（api-integration-plat3.md §4）：在模型调用管线（工具 schema 组装
 * 处）用本函数过滤 tools.schemas() 结果；基础白名单可经 options 扩展。
 */

/** 工具最小形态（tools.schemas() 的 name/description 子集）。 */
export interface ToolDef {
  readonly name: string
  readonly description?: string
}

/** 基础工具白名单（PLAT-14：记忆/任务控制/思考恒保留）。 */
export const BASE_TOOL_WHITELIST: readonly string[] = [
  // 记忆（MEM/RET）
  'search_research_history',
  'find_in_conversation',
  'read_conversation_range',
  'read_research_turn',
  'search_observations',
  'read_memory',
  // 记忆写入（任务控制的一部分，允许模型整理）
  'create_observation',
  'update_observation',
  'supersede_observation',
  'link_observations',
  'propose_goal_contract_update',
  'update_profile',
  // 通用任务控制/思考
  'ask_user',
]

export interface ToolSelectionOptions {
  /** 额外必须保留的工具（白名单扩展，如 vision_check）。 */
  readonly required?: readonly string[]
  /** 过滤后最多工具数（基础白名单之外的相关工具上限），默认 20。 */
  readonly maxTools?: number
  /** 相关性打分（缺省：名称/描述包含查询词）。 */
  readonly scoring?: (tool: ToolDef, query: string) => number
}

/** 缺省相关性打分：名称命中 +3/描述命中 +1（查询词切分后任一命中）。 */
export function defaultToolScoring(tool: ToolDef, query: string): number {
  const terms = query
    .toLowerCase()
    .split(/[\s,，。;；:：]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
  if (terms.length === 0) {
    // 空查询：不产生相关工具（只保留白名单）。
    return query.trim() !== '' && tool.name.toLowerCase().includes(query.toLowerCase()) ? 1 : 0
  }
  const name = tool.name.toLowerCase()
  const description = (tool.description ?? '').toLowerCase()
  let score = 0
  for (const term of terms) {
    if (name.includes(term)) score += 3
    else if (description.includes(term)) score += 1
  }
  return score
}

/**
 * 每轮工具选择（PLAT-14 纯函数）：
 * 1. 基础白名单（+ required）恒保留；
 * 2. 其余工具按相关性打分排序，取 top（maxTools 上限）；
 * 3. 返回顺序：白名单在前，相关工具按分数降序。
 */
export function selectToolsForTurn(
  available: readonly ToolDef[],
  query: string,
  options: ToolSelectionOptions = {},
): ToolDef[] {
  const scoring = options.scoring ?? defaultToolScoring
  const maxTools = options.maxTools ?? 20
  const whitelist = new Set([...BASE_TOOL_WHITELIST, ...(options.required ?? [])])
  const base: ToolDef[] = []
  const candidates: Array<{ tool: ToolDef; score: number }> = []
  for (const tool of available) {
    if (whitelist.has(tool.name)) {
      base.push(tool)
    } else {
      candidates.push({ tool, score: scoring(tool, query) })
    }
  }
  const related = candidates
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, maxTools - base.length))
    .map((entry) => entry.tool)
  return [...base, ...related]
}
