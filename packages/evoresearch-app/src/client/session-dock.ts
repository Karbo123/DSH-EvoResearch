/**
 * 会话状态条与统计条（借鉴官方 WebUI 的 composer dock 与 StatsLine）。
 *
 * - SessionStatusLine：排队消息数 / 进行中目标 / 上下文用量百分比
 * （SessionStatsLine 已删除：功能由 statusbar.ts 的 StatusBar 承担，此前无引用）
 *
 * 数据全部来自 DSH 会话投影（session.projections.get：sessionStats /
 * tokenUsage / contextPressure / permissions / goal）与会话快照（queue）。
 */
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { ListTodo, Target, Gauge } from 'lucide-react'
import { t } from './i18n'
import { projectionGet } from './session-events'

/** token 格式化（官方 formatTokens 语义：k/M 缩写）。 */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

export interface SessionDockData {
  session: any
}

/** 状态条内容：排队 / 目标 / 模式 / 上下文（P0-4：三档配色占用条 + 手动压缩入口）。 */
export function SessionStatusLine({ session }: SessionDockData) {
  if (session === null) return null

  // 0.1.3：投影经 faceOf(key) 读取；排队列表在 session face 快照的 queue 字段。
  const queue = session?.getSnapshot?.()?.queue ?? session?.snapshotCache?.queue ?? []
  const goal = projectionGet(session, 'goal')
  const pressure = projectionGet(session, 'contextPressure')
  const occupancy = (() => {
    const used = pressure?.projectedTokens ?? pressure?.pressureTokens
    const total = pressure?.contextWindow
    if (used === undefined || total === undefined || total === 0) return null
    return { percent: Math.min(100, Math.round((used / total) * 100)), used, total }
  })()
  // P0-4 三档：ok(<60%) / watch(60-79%) / high(≥80%，与 window.ts autoCompactThreshold 对齐)
  const occupancyLevel = occupancy === null ? null : occupancy.percent >= 80 ? 'high' : occupancy.percent >= 60 ? 'watch' : 'ok'

  return jsxs(Fragment, {
    children: [
      queue.length > 0 && jsxs('span', {
        className: 'evo-status-chip',
        title: t('queuedMessages'),
        children: [jsx(ListTodo, {}), jsx('span', { children: String(queue.length) })],
      }),
      goal != null && jsxs('span', {
        className: 'evo-status-chip evo-status-goal',
        title: goal.title ?? t('activeGoal'),
        children: [jsx(Target, {}), jsx('span', { children: goal.title ?? t('goal') })],
      }),
      occupancy !== null && jsxs('span', {
        className: `evo-status-chip evo-ctx-meter${occupancyLevel !== null ? ` evo-ctx-${occupancyLevel}` : ''}`,
        title: `${t('ctxUsageDetail').replace('{used}', formatTokens(occupancy.used)).replace('{total}', formatTokens(occupancy.total)).replace('{percent}', String(occupancy.percent))}（${t('statTokenUnit')}）`,
        children: [
          jsx(Gauge, {}),
          jsx('span', { className: 'evo-ctx-meter-bar' }),
          jsx('span', { children: `${occupancy.percent}%` }),
        ],
      }),
    ],
  })
}


