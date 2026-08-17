/**
 * CTX-13 / CTX-14 压力检测与窗口规格（纯函数模块，不依赖 DSH 运行时）。
 *
 * - 模型窗口 catalog：已知模型默认窗口；未知模型回退默认值；配置可覆盖。
 * - 投影估算：字符数 / 每 token 字符数（默认 3，与 host/core/llm.ts estimateTokens 对齐）。
 * - 压力判定：ratio = 估算 token / 窗口 token → ok / watch / high / critical，
 *   并给出自动压缩与溢出恢复触发建议。
 *
 * 运行时（guard.ts）负责从 ctx.tokenMeter 取真实测量；本模块只做纯计算，
 * 便于 CTX-19 用不同模型窗口做参数化回归。
 */
import type { PressureLevel, PressureReport, PressureSource, WindowSpec } from './types.js'

/** 已知模型上下文窗口（token）。未知模型回退 DEFAULT_WINDOW_TOKENS。 */
export const MODEL_WINDOW_CATALOG: Readonly<Record<string, number>> = {
  'deepseek-v4': 128_000,
  'deepseek-v4-flash': 128_000,
  'deepseek-reasoner': 64_000,
  'deepseek-chat': 64_000,
  'gpt-4o': 128_000,
  'claude-sonnet-4': 200_000,
  'claude-opus-4': 200_000,
}

/** 未知模型默认窗口（token）。 */
export const DEFAULT_WINDOW_TOKENS = 128_000

/** 默认每 token 字符数（中文约 1.5 字符/token，保守取 3）。 */
export const DEFAULT_CHARS_PER_TOKEN = 3

/** 默认窗口规格（对齐 DSH compaction-basic 默认策略）。 */
export const DEFAULT_WINDOW_SPEC: WindowSpec = {
  windowTokens: DEFAULT_WINDOW_TOKENS,
  autoCompactThresholdRatio: 0.8,
  watchRatio: 0.6,
  criticalRatio: 0.95,
  retainRatio: 0.16,
  maxOverflowRetries: 1,
}

/** 窗口 catalog 配置。 */
export interface WindowCatalogConfig {
  /** 显式全局窗口上限（token）；设置后优先于模型 catalog。 */
  readonly windowTokens?: number
  /** 按模型覆盖 catalog。 */
  readonly windowTokensByModel?: Readonly<Record<string, number>>
  /** 未知模型的默认窗口。 */
  readonly defaultWindowTokens?: number
}

/**
 * 解析某模型（或未指明模型）的窗口上限。
 * 优先级：显式 windowTokens > windowTokensByModel[model] > MODEL_WINDOW_CATALOG[model] > default。
 * @param model 模型 id（可空）。
 * @param config 窗口 catalog 配置。
 * @returns 窗口 token 数（恒为正）。
 */
export function resolveWindowTokens(model: string | undefined, config: WindowCatalogConfig = {}): number {
  if (config.windowTokens !== undefined && config.windowTokens > 0) return config.windowTokens
  if (model) {
    const byModel = config.windowTokensByModel?.[model]
    if (byModel !== undefined && byModel > 0) return byModel
    const catalog = MODEL_WINDOW_CATALOG[model]
    if (catalog !== undefined) return catalog
  }
  return config.defaultWindowTokens ?? DEFAULT_WINDOW_TOKENS
}

/**
 * 字符 → token 近似估算。
 * @param text 投影文本。
 * @param charsPerToken 每 token 字符数（默认 3）。
 */
export function estimateProjectionTokens(text: string, charsPerToken: number = DEFAULT_CHARS_PER_TOKEN): number {
  if (text.length === 0) return 0
  return Math.ceil(text.length / charsPerToken)
}

/** 由比例计算压力等级。 */
export function pressureLevel(ratio: number, spec: Pick<WindowSpec, 'watchRatio' | 'autoCompactThresholdRatio' | 'criticalRatio'>): PressureLevel {
  if (ratio >= spec.criticalRatio) return 'critical'
  if (ratio >= spec.autoCompactThresholdRatio) return 'high'
  if (ratio >= spec.watchRatio) return 'watch'
  return 'ok'
}

/** 压力计算输入。 */
export interface ComputePressureInput {
  readonly sessionId: string
  /** 投影估算 token 数（来自 tokenMeter 或启发式）。 */
  readonly estimatedTokens: number
  /** 窗口 token 数（已解析）。 */
  readonly windowTokens: number
  readonly spec?: Readonly<Partial<WindowSpec>>
  /** 数据来源（默认 heuristic）。 */
  readonly source?: PressureSource
  /** 当前适配可用性（供报告展示，不参与阈值判定）。 */
  readonly adapters?: { readonly compaction: boolean; readonly tokenMeter: boolean; readonly toolResultPruner: boolean }
}

/**
 * 计算压力报告：比例、等级、自动压缩/溢出恢复触发建议。
 * 纯函数：不访问会话、不调用服务。
 */
export function computePressure(input: ComputePressureInput): PressureReport {
  const spec: WindowSpec = { ...DEFAULT_WINDOW_SPEC, ...input.spec }
  const windowTokens = input.windowTokens > 0 ? input.windowTokens : DEFAULT_WINDOW_TOKENS
  const estimatedTokens = Math.max(0, input.estimatedTokens)
  const ratio = windowTokens > 0 ? estimatedTokens / windowTokens : 1
  const level = pressureLevel(ratio, spec)
  return {
    sessionId: input.sessionId,
    windowTokens,
    estimatedTokens,
    ratio: Number(ratio.toFixed(4)),
    level,
    source: input.source ?? 'heuristic',
    triggerAutoCompact: level === 'high' || level === 'critical',
    triggerOverflowRecovery: level === 'critical',
    adapter: input.adapters ?? { compaction: false, tokenMeter: false, toolResultPruner: false },
  }
}

/**
 * 组装窗口规格：显式配置覆盖默认。
 * @param config 可选的规格片段。
 * @param model 模型 id（解析 catalog 用）。
 * @param catalog 窗口 catalog 配置。
 */
export function resolveWindowSpec(
  config: Readonly<Partial<WindowSpec>> = {},
  model?: string,
  catalog: WindowCatalogConfig = {},
): WindowSpec {
  return {
    ...DEFAULT_WINDOW_SPEC,
    windowTokens: resolveWindowTokens(model, catalog),
    ...config,
  }
}

/** 压缩后应保留的近程 token 预算（retainRatio × 窗口）。 */
export function retainedTokensAfterCompaction(spec: WindowSpec): number {
  return Math.round(spec.windowTokens * spec.retainRatio)
}
