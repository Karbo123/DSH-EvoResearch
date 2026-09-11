/**
 * 上下文容量明细（§23.9）。
 *
 * 数据全部来自会话投影与持久事件，无新增记录：
 * - `contextPressure`：已用 / 窗口容量（胶囊与进度条）；
 * - `contextBreakdown`（官方 token-meter 投影）：系统提示 / 工具 / 消息 三分类；
 * - `tokenUsage`：缓存读取量 → 平均缓存命中率；
 * - 最新 `request/header` 事件：系统提示文本与工具声明全文，用于把「工具」再拆成
 *   MCP 工具 / 系统工具（官方投影只给三分类）。
 *
 * 定价口径与官方 dsh-token-meter/estimate 完全一致（固定密度 ceil(chars/4)+4），
 * 因此细分值可与官方三分类对齐：组内按本地定价占比分摊，保证两组合计 = 官方值。
 */
import { projectionGet } from './session-events'

/** 官方 estimate.js 同款固定密度口径。 */
const CHARS_PER_TOKEN = 4
const BLOCK_OVERHEAD = 4

export interface ContextBreakdownRow {
  key: 'messages' | 'mcp' | 'tools' | 'skills' | 'system' | 'other'
  tokens: number
  /** 占已用上下文的比例（0-100，一位小数）。 */
  percent: number
}

export interface ContextBreakdownView {
  used: number
  total: number
  /** 已用 / 容量（0-100 整数，与胶囊一致）。 */
  percent: number
  rows: ContextBreakdownRow[]
  /** 平均缓存命中率（缓存读取 / (未缓存输入 + 缓存读取)），无数据为 null。 */
  cacheHitPercent: number | null
}

/** 单个工具 schema 的定价（JSON 密度口径，与官方整组定价同密度）。 */
function priceTool(tool: unknown): number {
  try {
    return Math.ceil(JSON.stringify(tool ?? null).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
  } catch {
    return 0
  }
}

/** 工具名是否 MCP 来源（DSH 约定 `mcp__<server>__<tool>`）。 */
function isMcpTool(tool: any): boolean {
  const name = String(tool?.name ?? tool?.function?.name ?? '')
  return /^mcp__/i.test(name)
}

/** 系统提示里的「技能」区块定价：命中标记才算，未命中返回 0（本工作台技能走 skill 工具，通常为 0）。 */
function estimateSkillsTokens(system: string): number {
  if (system === '') return 0
  const match = system.match(/<(?:available_)?skills>[\s\S]*?<\/(?:available_)?skills>/i) ?? system.match(/^#{1,3}\s*Skills\b[\s\S]*?(?=^#{1,3}\s|\Z)/im)
  return match === null ? 0 : Math.ceil(match[0].length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
}

export function computeContextBreakdown(session: any, events: any[]): ContextBreakdownView | null {
  const pressure = projectionGet(session, 'contextPressure')
  const breakdown = projectionGet(session, 'contextBreakdown')
  const tokenUsage = projectionGet(session, 'tokenUsage')
  const used = pressure?.pressureTokens ?? pressure?.projectedTokens
  const total = pressure?.contextWindow
  if (typeof used !== 'number' || typeof total !== 'number' || total === 0 || breakdown === undefined || breakdown === null) return null

  const systemTokens = Math.max(0, breakdown.systemTokens ?? 0)
  const toolsTokens = Math.max(0, breakdown.toolsTokens ?? 0)
  const messageTokens = Math.max(0, breakdown.messageTokens ?? 0)

  // 最新请求信封（持久事件）：仅用于工具/技能的组内细分
  let header: any = null
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev?.type === 'request/header') { header = ev.data?.header ?? null; break }
  }
  const tools: any[] = Array.isArray(header?.tools) ? header.tools : []
  const mcpRaw = tools.filter(isMcpTool).reduce((sum, t) => sum + priceTool(t), 0)
  const sysRaw = tools.filter((t) => !isMcpTool(t)).reduce((sum, t) => sum + priceTool(t), 0)
  const raw = mcpRaw + sysRaw
  const mcpTokens = raw === 0 ? 0 : Math.round((toolsTokens * mcpRaw) / raw)
  const systemToolTokens = toolsTokens - mcpTokens

  const skillsTokens = Math.min(systemTokens, estimateSkillsTokens(String(header?.system ?? '')))
  const promptTokens = systemTokens - skillsTokens

  const rows: ContextBreakdownRow[] = []
  const push = (key: ContextBreakdownRow['key'], tokens: number): void => {
    if (tokens <= 0) return
    rows.push({ key, tokens, percent: Math.round((tokens / used) * 1000) / 10 })
  }
  push('messages', messageTokens)
  push('mcp', mcpTokens)
  push('tools', systemToolTokens)
  push('skills', skillsTokens)
  push('system', promptTokens)
  // 其他：官方三分类之外的部分（请求期注入的运行时上下文等）
  push('other', Math.max(0, used - systemTokens - toolsTokens - messageTokens))

  const cacheRead = tokenUsage?.cacheReadTokens ?? 0
  const uncached = tokenUsage?.uncachedInputTokens ?? 0
  const cacheHitPercent = cacheRead + uncached > 0 ? Math.round((cacheRead / (cacheRead + uncached)) * 1000) / 10 : null

  return {
    used,
    total,
    percent: Math.min(100, Math.round((used / total) * 100)),
    rows,
    cacheHitPercent,
  }
}
