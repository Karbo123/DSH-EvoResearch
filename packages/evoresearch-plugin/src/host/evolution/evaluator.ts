/**
 * 候选评估器（EVO-05）。
 *
 * 候选在"已知失败历史样本"上比较：`evaluateCandidate` 用注入的评估函数
 * （缺省为内容包含式启发）逐一判断候选能否通过样本，得到通过/失败与可读
 * 结果；评估结果写回候选记录（隔离存储），不通过时当前启用版本不受影响。
 *
 * 语义：samples 是已知失败历史（如过去检索失败的查询、工具失败的参数），
 * 候选版本（content/diff 描述的新行为）在这些样本上的通过率是"是否值得启用"
 * 的依据；评估只记账，启用/回滚由 CandidateRegistry 的 activate/rollback 决定。
 */
import type { CandidateRegistry, EvolutionCandidate } from './registry.js'

/** 评估样本（来自已知失败历史；component 选择所属组件）。 */
export interface EvaluationSample {
  readonly sampleId: string
  readonly component: string
  /** 样本输入（如失败查询、工具参数摘要）。 */
  readonly input: string
  /** 期望结果（失败历史中的正确出口；启发式评估检查候选文本是否覆盖它）。 */
  readonly expected: string
  readonly note?: string
}

/** 评估函数：候选在某样本上是否通过（返回 ok 与可读说明）。 */
export type CandidateEvaluator = (
  candidate: EvolutionCandidate,
  sample: EvaluationSample,
) => Promise<{ ok: boolean; detail?: string }>

/** 评估结果（写回 candidate.evaluation）。 */
export interface EvaluationResult {
  readonly evaluatedAt: number
  readonly total: number
  readonly passed: number
  readonly failed: number
  readonly ok: boolean
  readonly detail: string
}

export interface EvaluateOptions {
  /** 评估函数（缺省 content/diff 包含式启发）。 */
  readonly evaluator?: CandidateEvaluator
  /** 通过率阈值（passed/total ≥ threshold 视为 ok），默认 1.0。 */
  readonly threshold?: number
}

/** 缺省评估函数：候选的 content 或 diff 文本包含样本期望即通过（启发式）。 */
export async function defaultEvaluator(candidate: EvolutionCandidate, sample: EvaluationSample): Promise<{ ok: boolean; detail?: string }> {
  const haystack = `${candidate.content ?? ''}\n${candidate.diff}`
  const ok = sample.expected.trim() !== '' && haystack.includes(sample.expected)
  return { ok, detail: ok ? '候选文本覆盖期望行为' : `候选文本未覆盖期望「${sample.expected.slice(0, 60)}」` }
}

/**
 * 评估候选（EVO-05）：
 * - 只评估与候选同组件的样本（已知失败历史子集）；
 * - 每个样本跑 evaluator，统计 passed/failed；
 * - 通过率 ≥ threshold（默认 1.0）→ ok；
 * - 结果写入 registry.recordEvaluation（隔离存储），不自动激活/拒绝——
 *   当前启用版本与其它候选不受影响。
 */
export async function evaluateCandidate(
  registry: CandidateRegistry,
  candidateId: string,
  samples: readonly EvaluationSample[],
  options: EvaluateOptions = {},
): Promise<EvaluationResult> {
  const candidate = registry.getCandidate(candidateId)
  if (!candidate) throw new Error(`候选不存在: ${candidateId}`)
  const evaluator = options.evaluator ?? defaultEvaluator
  const threshold = options.threshold ?? 1.0

  const relevant = samples.filter((sample) => sample.component === candidate.component)
  const details: string[] = []
  let passed = 0
  let failed = 0
  for (const sample of relevant) {
    const result = await evaluator(candidate, sample)
    if (result.ok) passed += 1
    else failed += 1
    details.push(`- ${sample.sampleId}（${sample.input.slice(0, 40)}）: ${result.ok ? '通过' : '失败'}${result.detail ? ` — ${result.detail}` : ''}`)
  }
  const total = relevant.length
  const ok = total > 0 && passed / total >= threshold
  const detail = [
    `候选 ${candidate.candidateId}（${candidate.component} v${candidate.version}）在 ${total} 个已知失败样本上：${passed} 通过 / ${failed} 失败。`,
    ...details,
  ].join('\n')
  const result: EvaluationResult = {
    evaluatedAt: Date.now(),
    total,
    passed,
    failed,
    ok,
    detail,
  }
  registry.recordEvaluation(candidateId, result)
  return result
}
