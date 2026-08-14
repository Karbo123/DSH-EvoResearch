/**
 * 科研记忆 Goal Control：长程目标的自动合同、切片推进与保守判定。
 *
 * 对齐 EvoResearch memory/research/goal_control.py：
 * - _looks_long_horizon 触发条件：长度 ≥80 且命中 ≥2 个长期任务提示词；
 * - ensure_goal_contract：模型提取合同 + 确定性回退；
 * - 追加式事件账本（goal_events）、Active Goal State 投影、evidence-linked checkpoint；
 * - 漂移检测按 目标/范围/证据/完成 四轴保守判定：
 *   无证据不能把成功标准标为满足；连续失败触发 replan；全部标准有证据且无 gap 才 complete。
 */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import type { GoalContract } from '../../shared/types.js'
import type { ResearchMemoryStore } from './store.js'
import { callJson, estimateTokens } from '../core/llm.js'

/** 长期任务提示词（中英）。 */
const LONG_HORIZON_KEYWORDS = [
  '长期', '持续', '项目', '阶段', '目标', '计划', '里程碑', 'multi-step', 'long-term',
  'project', 'milestone', 'objective', 'roadmap', '最终', '完成整个', '系列',
]

/** 触发长程检测的最短文本长度。 */
const LONG_HORIZON_MIN_LENGTH = 80

/** 触发所需的最小关键词命中数。 */
const LONG_HORIZON_MIN_KEYWORDS = 2

/** 判定为 replan 的连续失败阈值。 */
const REPLAN_FAILURE_THRESHOLD = 2

/** 判断一段文本是否像长期任务。 */
export function looksLongHorizon(text: string): boolean {
  if (text.length < LONG_HORIZON_MIN_LENGTH) return false
  const lower = text.toLowerCase()
  const hits = LONG_HORIZON_KEYWORDS.filter((keyword) => lower.includes(keyword.toLowerCase()))
  return hits.length >= LONG_HORIZON_MIN_KEYWORDS
}

/** GoalRuntime 接口：ensureGoalContract 需要的宿主能力（MemoryRuntime 实现）。 */
export interface GoalRuntime {
  storeFor(workspaceDir: string): ResearchMemoryStore
}

/** Goal 提取提示词。 */
const GOAL_EXTRACT_SYSTEM = `你是科研目标分析师。请从用户消息中提取长期目标合同。

输出 JSON：
{
  "title": "简短目标标题（≤20 字）",
  "objective": "目标描述（≤200 字）",
  "criteria": [{"id": "c1", "text": "可验证的成功标准"}],
  "constraints": ["范围约束，如 只使用某目录 等"]
}

要求：
1. criteria 是 2-6 条可验证的成功标准（每条约 10-40 字）；
2. 无法提取出长期目标时输出 {"none": true}。`

/** 校验模型提取的 Goal 合同。 */
function validateGoalContract(value: unknown): Omit<GoalContract, 'goalId' | 'version' | 'createdAt' | 'updatedAt'> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  if (raw['none'] === true) return { title: '', objective: '', criteria: [], constraints: [] }
  if (typeof raw['title'] !== 'string' || typeof raw['objective'] !== 'string') return undefined
  if (!Array.isArray(raw['criteria'])) return undefined
  const criteria: Array<{ id: string; text: string; satisfied: boolean; evidence: string[] }> = []
  for (const item of raw['criteria']) {
    if (typeof item !== 'object' || item === null) continue
    const entry = item as Record<string, unknown>
    const text = entry['text']
    if (typeof text === 'string' && text.length > 0) {
      criteria.push({ id: typeof entry['id'] === 'string' ? entry['id'] : `c${criteria.length + 1}`, text, satisfied: false, evidence: [] })
    }
  }
  if (criteria.length === 0) return undefined
  const constraints = Array.isArray(raw['constraints']) ? raw['constraints'].filter((c): c is string => typeof c === 'string') : []
  return { title: raw['title'].slice(0, 40), objective: raw['objective'].slice(0, 300), criteria, constraints }
}

/** 确定性回退：从文本机械提取（标题=首句，标准=含"完成/实现/达到"的句子）。 */
function extractGoalDeterministic(text: string): Omit<GoalContract, 'goalId' | 'version' | 'createdAt' | 'updatedAt'> | undefined {
  const sentences = text.split(/[。！？\n.!?]/).map((s) => s.trim()).filter((s) => s.length > 4)
  if (sentences.length === 0) return undefined
  const objective = sentences.slice(0, 3).join('。').slice(0, 300)
  const criteria = sentences
    .filter((s) => /完成|实现|达到|交付|搞定|finish|complete|achieve|deliver/i.test(s))
    .slice(0, 4)
    .map((s, index) => ({ id: `c${index + 1}`, text: s.slice(0, 80), satisfied: false, evidence: [] }))
  if (criteria.length === 0) return undefined
  return {
    title: sentences[0]!.slice(0, 40),
    objective,
    criteria,
    constraints: [],
  }
}

/**
 * 确保项目存在 active Goal Contract：已存在则复用；否则尝试提取并保存。
 * @param ctx Cordis 上下文。
 * @param runtime Goal 宿主。
 * @param model 辅助模型。
 * @param store 项目记忆库。
 * @param text 用户消息。
 * @param sessionId 会话 id（写入事件账本）。
 * @returns 保存后的合同；提取失败/非长期目标时返回 undefined。
 */
export async function ensureGoalContract(
  ctx: Context,
  runtime: GoalRuntime,
  model: { provider: string; model: string },
  store: ResearchMemoryStore,
  text: string,
  sessionId: string,
): Promise<GoalContract | undefined> {
  // 已存在 active 合同则复用（普通追问自动继承；第一版按项目仅维护最新一个合同）
  const recentGoals = store.listRecentGoals()
  if (recentGoals.length > 0) return recentGoals[0]
  const drafts: Array<Omit<GoalContract, 'goalId' | 'version' | 'createdAt' | 'updatedAt'>> = []
  try {
    const value = await callJson(ctx, {
      provider: model.provider,
      model: model.model,
      messages: [text.slice(0, 4000)],
      maxTokens: 500,
      jsonInstruction: '输出 JSON：{"title": "...", "objective": "...", "criteria": [...], "constraints": [...]}',
    })
    const validated = validateGoalContract(value)
    if (validated && (validated.title || validated.criteria.length > 0)) drafts.push(validated)
  } catch {
    // LLM 失败：走确定性回退
  }
  if (drafts.length === 0) {
    const fallback = extractGoalDeterministic(text)
    if (fallback) drafts.push(fallback)
  }
  if (drafts.length === 0) return undefined
  const draft = drafts[0]!
  // 幂等：同 session 的最近 goal 不重复创建
  const now = Date.now()
  const goal: GoalContract = {
    goalId: randomUUID(),
    title: draft.title,
    objective: draft.objective,
    criteria: draft.criteria,
    constraints: draft.constraints,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
  store.saveGoal(goal)
  store.appendGoalEvent(goal.goalId, JSON.stringify({ kind: 'created', sessionId, at: now }), now)
  return goal
}

/** 判定结果。 */
export type GoalJudgement = 'wait_user' | 'replan' | 'complete' | 'continue'

/** 四轴保守判定输入。 */
export interface GoalJudgementInput {
  readonly goal: GoalContract
  /** 本轮新证据（文本片段，将链接到 criteria）。 */
  readonly evidence: readonly string[]
  /** 连续失败次数（最近 N 轮无进展）。 */
  readonly consecutiveFailures: number
  /** 本轮是否产出了新的交付物/结论。 */
  readonly hasProgress: boolean
}

/**
 * 按 目标/范围/证据/完成 四轴保守判定当前进展。
 * - 无证据不把成功标准标为满足（wait_user）；
 * - 连续失败 ≥2 → replan；
 * - 全部标准有证据且无 gap → complete；
 * - 否则 continue。
 */
export function judgeProgress(input: GoalJudgementInput): GoalJudgement {
  const { goal, evidence, consecutiveFailures, hasProgress } = input
  // 目标漂移：合同必须存在且 objective 非空
  if (!goal.objective || goal.objective.length === 0) return 'wait_user'
  // 证据：本轮有进展但无证据片段 → 要求用户确认
  if (hasProgress && evidence.length === 0) return 'wait_user'
  // 完成判定：全部标准都有证据才 complete（无证据不能标满足）
  if (goal.criteria.length > 0 && goal.criteria.every((c) => c.satisfied && c.evidence.length > 0)) {
    return 'complete'
  }
  // 连续失败 → replan
  if (consecutiveFailures >= REPLAN_FAILURE_THRESHOLD) return 'replan'
  return 'continue'
}

/** 渲染紧凑 Active Goal Projection（注入每轮）。 */
export function renderGoalProjection(goal: GoalContract | undefined): string {
  if (!goal) return ''
  const lines = ['<active_goal>']
  lines.push(`目标: ${goal.title}`)
  lines.push(`描述: ${goal.objective.slice(0, 200)}`)
  for (const criterion of goal.criteria) {
    const mark = criterion.satisfied ? '[x]' : '[ ]'
    lines.push(`  ${mark} ${criterion.text}${criterion.evidence.length > 0 ? `（证据 ${criterion.evidence.length} 条）` : ''}`)
  }
  if (goal.constraints.length > 0) {
    lines.push(`约束: ${goal.constraints.join('; ').slice(0, 200)}`)
  }
  lines.push('</active_goal>')
  return lines.join('\n')
}

/** 估算 Goal 投影 token。 */
export function goalProjectionTokens(goal: GoalContract | undefined): number {
  return estimateTokens(renderGoalProjection(goal))
}
