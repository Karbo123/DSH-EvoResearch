/**
 * 多模型 provider / Fallback / 有限重试 / 模型切换（PLAT-13）。
 *
 * 纯函数 selector：给定 primary + fallback 路由列表与失败计数状态，
 * 选出当前应使用的路由；recordFailure/recordSuccess 更新状态。
 *
 * 现有模型使用点核对（只读，接入点说明见 api-integration-plat3.md §4）：
 * - host/core/llm.ts：textMessage/extractJson/estimateTokens 纯工具（无路由）；
 * - host/scheduler.ts runTask：agentDefaultModel.currentSelection() 取默认模型；
 * - host/memory（分类器/Goal 提取）：AutoSkillsConfig.auxiliaryModel 或默认模型；
 * - t8 adapters.models：listProviders/current/route（llm.resolveCallConfig）。
 * 本模块的 selector 供上层在这些使用点统一接入 Fallback（不直接改它们）。
 */
export interface ModelRoute {
  readonly provider: string
  readonly model: string
}

/** Fallback 状态（失败计数；切换历史）。 */
export interface FallbackState {
  /** 路由 key（`provider/model`）→ 连续失败次数。 */
  readonly failures: Readonly<Record<string, number>>
  /** 当前生效路由 key（切换后记录；undefined = primary）。 */
  readonly current?: string
  /** 最近一次切换时间（毫秒）。 */
  readonly switchedAt?: number
}

export interface SelectModelOptions {
  /** 单路由最大连续失败次数（超过则切换），默认 2。 */
  readonly maxRetriesPerRoute?: number
}

/** 路由 key（`provider/model`）。 */
export function routeKey(route: ModelRoute): string {
  return `${route.provider}/${route.model}`
}

/** 空 Fallback 状态。 */
export function emptyFallbackState(): FallbackState {
  return { failures: {} }
}

/**
 * 选择当前路由（PLAT-13 纯函数）：
 * - primary 失败次数 < maxRetriesPerRoute → primary；
 * - 否则按 fallbacks 顺序取第一个失败次数 < maxRetriesPerRoute 的；
 * - 全部超限 → 返回 fallbacks 最后一个（最后手段，失败计数继续累计）；
 * - fallbacks 为空且 primary 超限 → null（明确无可用路由，不静默假成功）。
 */
export function selectModel(
  routes: { readonly primary: ModelRoute; readonly fallbacks?: readonly ModelRoute[] },
  state: FallbackState,
  options: SelectModelOptions = {},
): ModelRoute | null {
  const maxRetries = options.maxRetriesPerRoute ?? 2
  const candidates: ModelRoute[] = [routes.primary, ...(routes.fallbacks ?? [])]
  for (const route of candidates) {
    const failures = state.failures[routeKey(route)] ?? 0
    if (failures < maxRetries) return route
  }
  // 全部超限：最后手段（fallbacks 末尾）或 null
  const last = routes.fallbacks?.[routes.fallbacks.length - 1]
  return last ?? null
}

/** 记录一次失败（连续失败计数 +1；返回新状态，纯函数）。 */
export function recordFailure(state: FallbackState, route: ModelRoute): FallbackState {
  const key = routeKey(route)
  return {
    ...state,
    failures: { ...state.failures, [key]: (state.failures[key] ?? 0) + 1 },
  }
}

/** 记录一次成功（清零该路由失败计数；记录当前路由）。 */
export function recordSuccess(state: FallbackState, route: ModelRoute, now = Date.now()): FallbackState {
  const key = routeKey(route)
  const failures = { ...state.failures }
  delete failures[key]
  return { ...state, failures, current: key, switchedAt: state.current !== key ? now : state.switchedAt }
}

/** 当前生效路由 key（primary 未切换时为 undefined）。 */
export function currentRouteKey(state: FallbackState): string | undefined {
  return state.current
}
