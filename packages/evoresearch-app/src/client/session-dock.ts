/**
 * 会话状态条与统计条（借鉴官方 WebUI 的 composer dock 与 StatsLine）。
 *
 * - SessionStatusLine：排队消息数 / 进行中目标 / 上下文用量百分比
 * （SessionStatsLine 已删除：功能由 statusbar.ts 的 StatusBar 承担，此前无引用）
 *
 * 数据全部来自 DSH 会话投影（session.projections.get：sessionStats /
 * tokenUsage / contextPressure / permissions / goal）与会话快照（queue）。
 */
import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { ListTodo, Target, Gauge } from 'lucide-react'
import { t } from './i18n'
import { projectionGet, useSessionEvents } from './session-events'
import { computeContextBreakdown, type ContextBreakdownRow } from './context-breakdown'

/** token 格式化（官方 formatTokens 语义：k/M 缩写）。 */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

/** 明细行标签 i18n 键。 */
const ROW_LABELS: Record<ContextBreakdownRow['key'], () => string> = {
  messages: () => t('ctxRowMessages'),
  mcp: () => t('ctxRowMcp'),
  tools: () => t('ctxRowTools'),
  skills: () => t('ctxRowSkills'),
  system: () => t('ctxRowSystem'),
  other: () => t('ctxRowOther'),
}

export interface SessionDockData {
  session: any
}

/** 上下文容量胶囊 + 点击展开的明细浮层（§23.9：分布明细 + 平均缓存命中率）。 */
function ContextMeter({ session, occupancy }: { session: any; occupancy: { percent: number; used: number; total: number } }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const events = useSessionEvents(session)
  const detail = open ? computeContextBreakdown(session, events) : null
  // 打开时点外 / Esc 关闭（与官方 ContextMeter 同款交互）
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target) === true) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
  const level = occupancy.percent >= 80 ? 'high' : occupancy.percent >= 60 ? 'watch' : 'ok'
  return jsxs('span', {
    className: 'evo-ctx-wrap',
    ref: rootRef,
    children: [
      jsxs('button', {
        type: 'button',
        className: `evo-status-chip evo-ctx-meter evo-ctx-${level}${open ? ' evo-ctx-meter-open' : ''}`,
        title: `${t('ctxUsageDetail').replace('{used}', formatTokens(occupancy.used)).replace('{total}', formatTokens(occupancy.total)).replace('{percent}', String(occupancy.percent))}（${t('statTokenUnit')}）`,
        'aria-expanded': open || undefined,
        'aria-label': t('ctxCapacity'),
        onClick: () => setOpen((v) => !v),
        children: [
          jsx(Gauge, {}),
          jsx('span', { className: 'evo-ctx-meter-bar' }),
          jsx('span', { children: `${occupancy.percent}%` }),
        ],
      }),
      open && jsxs('div', {
        className: 'evo-ctx-panel',
        role: 'dialog',
        'aria-label': t('ctxCapacity'),
        children: [
          jsxs('div', {
            className: 'evo-ctx-panel-head',
            children: [
              jsx('span', { className: 'evo-ctx-panel-title', children: t('ctxCapacity') }),
              jsx('span', { className: 'evo-ctx-panel-value', children: `${formatTokens(occupancy.used)}/${formatTokens(occupancy.total)}（${occupancy.percent}%）` }),
            ],
          }),
          jsx('div', { className: 'evo-ctx-panel-bar', children: jsx('i', { style: { width: `${Math.min(100, occupancy.percent)}%` } }) }),
          detail !== null && jsx('div', {
            className: 'evo-ctx-panel-rows',
            children: detail.rows.map((row) => jsxs('div', {
              className: 'evo-ctx-panel-row',
              children: [
                jsx('span', { className: 'evo-ctx-panel-dot', 'data-key': row.key }),
                jsx('span', { className: 'evo-ctx-panel-label', children: ROW_LABELS[row.key]() }),
                jsx('span', { className: 'evo-ctx-panel-pct', children: `${row.percent.toFixed(1)}%` }),
              ],
            }, row.key)),
          }),
          jsxs('div', {
            className: 'evo-ctx-panel-foot',
            children: [
              jsx('span', { children: t('ctxCacheHitAvg') }),
              jsx('span', { children: detail?.cacheHitPercent !== null && detail?.cacheHitPercent !== undefined ? `${detail.cacheHitPercent.toFixed(1)}%` : '—' }),
            ],
          }),
        ],
      }),
    ],
  })
}

/** 状态条内容：排队 / 目标 / 模式 / 上下文（P0-4：三档配色占用条 + 点击看明细）。 */
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
      occupancy !== null && jsx(ContextMeter, { session, occupancy }),
    ],
  })
}


