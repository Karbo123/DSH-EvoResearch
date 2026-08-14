/**
 * 会话状态条与统计条（借鉴官方 WebUI 的 composer dock 与 StatsLine）。
 *
 * - SessionStatusLine：排队消息数 / 进行中目标 / 模式徽章（read-only /
 *   workspace-write / full access）/ 当前模型 / 上下文用量百分比
 * - SessionStatsLine：底部统计条（轮数·步数 | LLM 耗时 · 工具耗时 |
 *   首 token 平均 · tok/s | 缓存命中 | 输入·输出 tokens）
 *
 * 数据全部来自 DSH 会话投影（session.projections.get：sessionStats /
 * tokenUsage / contextPressure / permissions / goal）与会话快照（queue）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { useEffect, useState } from 'react'
import { ListTodo, Target, ShieldCheck, ShieldOff, Cpu, Gauge } from 'lucide-react'

/** 时长格式化（官方 formatDuration 语义）。 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const rest = Math.round(s % 60)
  return rest > 0 ? `${m}m ${rest}s` : `${m}m`
}

/** token 格式化（官方 formatTokens 语义：k/M 缩写）。 */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

/** 模式徽章文案。 */
function modeLabel(preset: string | undefined): string | null {
  if (preset === 'read-only') return 'Read-only'
  if (preset === 'workspace-write') return 'Write'
  if (preset === 'danger-full-access') return 'Full effect'
  if (preset === 'custom') return 'Custom'
  return preset ?? null
}

export interface SessionDockData {
  session: any
}

/** 状态条内容：排队 / 目标 / 模式 / 模型 / 上下文。 */
export function SessionStatusLine({ session }: SessionDockData) {
  const [model, setModel] = useState<{ provider: string | null; model: string | null } | null>(null)
  const [mode, setMode] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchModel = () => fetch('/evoresearch/fs/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).then((res) => res.json()).then((json) => {
      if (!cancelled && json.ok) setModel(json.value)
    }).catch(() => {})
    const fetchMode = () => fetch('/evoresearch/fs/mode').then((res) => res.json()).then((json) => {
      if (!cancelled && json.ok) setMode(json.value.preset)
    }).catch(() => {})
    void fetchModel()
    void fetchMode()
    const onChange = () => { void fetchMode() }
    window.addEventListener('evo-mode-changed', onChange)
    return () => { cancelled = true; window.removeEventListener('evo-mode-changed', onChange) }
  }, [session])

  if (session === null) return null

  const projections = session.projections
  const queue = session.snapshotCache?.queue ?? []
  const goal = projections?.get('goal')
  const pressure = projections?.get('contextPressure')
  // 模式：投影值优先（会话内切换），回退 host 默认预设
  const effectivePreset = projections?.get('permissions')?.preset ?? mode
  const occupancy = (() => {
    const used = pressure?.projectedTokens ?? pressure?.pressureTokens
    const total = pressure?.contextWindow
    if (used === undefined || total === undefined || total === 0) return null
    return { percent: Math.min(100, Math.round((used / total) * 100)), used, total }
  })()
  const modeLabelValue = modeLabel(effectivePreset)

  return jsxs(Fragment, {
    children: [
      queue.length > 0 && jsxs('span', {
        className: 'evo-status-chip',
        title: 'Queued messages',
        children: [jsx(ListTodo, {}), jsx('span', { children: String(queue.length) })],
      }),
      goal != null && jsxs('span', {
        className: 'evo-status-chip evo-status-goal',
        title: goal.title ?? 'Active goal',
        children: [jsx(Target, {}), jsx('span', { children: goal.title ?? 'Goal' })],
      }),
      modeLabelValue !== null && jsxs('span', {
        className: `evo-status-chip${effectivePreset === 'read-only' ? ' evo-status-ro' : effectivePreset === 'danger-full-access' ? ' evo-status-full' : ''}`,
        title: `Permission: ${effectivePreset ?? ''}`,
        children: [effectivePreset === 'read-only' ? jsx(ShieldOff, {}) : jsx(ShieldCheck, {}), jsx('span', { children: modeLabelValue })],
      }),
      model?.model != null && jsxs('span', {
        className: 'evo-status-chip',
        title: `Model: ${model.provider ?? ''} / ${model.model}`,
        children: [jsx(Cpu, {}), jsx('span', { children: model.model })],
      }),
      occupancy !== null && jsxs('span', {
        className: 'evo-status-chip',
        title: `Context: ${formatTokens(occupancy.used)} / ${formatTokens(occupancy.total)}`,
        children: [jsx(Gauge, {}), jsx('span', { children: `${occupancy.percent}%` })],
      }),
    ],
  })
}

/** 底部统计条（官方 StatsLine 格式）。 */
export function SessionStatsLine({ session }: SessionDockData) {
  if (session === null) return null
  const projections = session.projections
  const stats = projections?.get('sessionStats')
  const usage = projections?.get('tokenUsage')
  if (stats === undefined || stats.steps <= 0) return null

  const groups: string[] = []
  groups.push(`${stats.turns} 轮 · ${stats.steps} 步`)
  const durations: string[] = []
  if (stats.llmMs > 0) durations.push(`LLM ${formatDuration(stats.llmMs)}`)
  if (stats.toolMs > 0) durations.push(`工具调用 ${formatDuration(stats.toolMs)}`)
  if (durations.length > 0) groups.push(durations.join(' · '))
  const speeds: string[] = []
  if (stats.ttftSteps > 0) speeds.push(`首 token 平均 ${formatDuration(stats.ttftMs / stats.ttftSteps)}`)
  if (stats.decodeMs > 0) speeds.push(`${(stats.decodeTokens / (stats.decodeMs / 1000)).toFixed(0)} tok/s`)
  if (speeds.length > 0) groups.push(speeds.join(' · '))
  if (usage !== undefined) {
    const billedInput = usage.billedInputTokens ?? usage.inputTokens ?? 0
    const output = usage.outputTokens ?? 0
    const cacheHit = usage.cacheHitPercent ?? usage.cacheReadTokensPercent
    if (cacheHit !== null && cacheHit !== undefined) groups.push(`缓存命中 ${Math.round(cacheHit)}%`)
    if (billedInput > 0 || output > 0) groups.push(`输入 ${formatTokens(billedInput)} · 输出 ${formatTokens(output)}`)
  }

  if (groups.length === 0) return null
  return jsx('div', {
    className: 'evo-stats-line',
    children: groups.map((group, i) => jsxs(Fragment, {
      children: [i > 0 && jsx('span', { className: 'evo-stats-sep', children: '|' }), jsx('span', { children: group })],
    }, group)),
  })
}
