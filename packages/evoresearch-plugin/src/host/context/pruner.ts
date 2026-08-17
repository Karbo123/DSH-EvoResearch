/**
 * CTX-15 工具结果裁剪器（纯函数核心）。
 *
 * 策略（与 DSH dsh-compaction-tool-result-pruner 的 head/tail 语义对齐，
 * 增加"关键中部"保留段）：超过阈值时按预算保留 头部 / 中部 / 尾部，
 * 其余内容从本轮投影移除；完整结果由运行时（guard.ts）写入原始档案，
 * 并返回继续读取位置（文件路径 + 字符偏移）。
 *
 * 字符计数与切片均按 Unicode code point，避免切断代理对。
 */
import type { PruneBudget, PrunePlan } from './types.js'

/** 默认裁剪预算：超过 8000 字符才裁剪，保留 头 4000 / 中 2000 / 尾 2000。 */
export const DEFAULT_PRUNE_BUDGET: PruneBudget = {
  thresholdChars: 8000,
  headChars: 4000,
  middleChars: 2000,
  tailChars: 2000,
}

/** 裁剪标记（注入投影，说明去向与继续读取入口）。 */
export const PRUNE_MARKER = '…[已裁剪，完整结果见原始归档，可用 continue_read 继续读取]…'

/** 按 code point 统计长度。 */
export function codePointLength(text: string): number {
  let length = 0
  for (const _ of text) length += 1
  return length
}

/** 按 code point 切片 [start, end)。 */
export function sliceCodePoints(text: string, start: number, end: number): string {
  const points = [...text]
  const from = Math.max(0, start)
  const to = Math.min(points.length, end)
  return from >= to ? '' : points.slice(from, to).join('')
}

/**
 * 生成裁剪计划（纯函数）：超预算时返回 head/middle/tail 分段与继续读取偏移。
 * @param text 完整工具结果文本。
 * @param budget 裁剪预算。
 * @returns 裁剪计划；未超预算时 action='keep'。
 */
export function planPrune(text: string, budget: PruneBudget = DEFAULT_PRUNE_BUDGET): PrunePlan {
  const total = codePointLength(text)
  if (total <= budget.thresholdChars) {
    return { action: 'keep', head: text, middle: '', tail: '', removedChars: 0, continueOffset: total }
  }
  const head = sliceCodePoints(text, 0, budget.headChars)
  const tailStart = Math.max(budget.headChars, total - budget.tailChars)
  const tail = sliceCodePoints(text, tailStart, total)
  const middle = sliceCodePoints(text, budget.headChars, budget.headChars + budget.middleChars)
  const removedChars = total - codePointLength(head) - codePointLength(middle) - codePointLength(tail)
  return {
    action: 'prune',
    head,
    middle,
    tail,
    removedChars,
    // 继续读取位置：完整原文中"中部"的起点（head 之后第一个被裁掉的字符）
    continueOffset: budget.headChars,
  }
}

/** 把裁剪计划渲染为投影文本（keep 原样返回）。 */
export function renderPrunedText(plan: PrunePlan, continueRead: { readonly path: string; readonly offset: number }): string {
  if (plan.action === 'keep') return plan.head
  const marker = `${PRUNE_MARKER}（继续读取: ${continueRead.path}#${continueRead.offset}）`
  const parts: string[] = [plan.head, marker]
  if (plan.middle.length > 0) parts.push(plan.middle)
  if (plan.tail.length > 0) parts.push(plan.tail)
  return parts.join('\n')
}

/**
 * 把一段工具结果裁剪为投影文本（纯函数便捷入口）。
 * @returns { prunedText, plan }；未超预算时 prunedText === text。
 */
export function pruneToolResultText(text: string, budget: PruneBudget = DEFAULT_PRUNE_BUDGET): { prunedText: string; plan: PrunePlan } {
  const plan = planPrune(text, budget)
  if (plan.action === 'keep') return { prunedText: text, plan }
  const continueRead = { path: '<archive-pending>', offset: plan.continueOffset }
  return { prunedText: renderPrunedText(plan, continueRead), plan }
}
