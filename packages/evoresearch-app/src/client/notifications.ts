/**
 * §42.4 浏览器通知（自 index.ts 抽出，2026-09 审计的有界拆分第一阶段）：
 * 1) Scheduled 任务完成：10s 轮询 + 首次 baseline（不补发）+ taskId:lastRunAt
 *    去重（跨刷新持久化）；
 * 2) Ask User / 工具审批 pending 出现时通知（仅新出现的 pending）。
 * 权限 + 用户开关判断（notifyEnabled）随本模块走，调用方只传当前会话与快照。
 */
import { useEffect, useRef } from 'react'
import { clientStateGet, clientStateSet } from './client-state'
import { t } from './i18n'

function notifyEnabled(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted' && (() => {
    try { return clientStateGet('evoresearch-notifications') === '1' } catch { return false }
  })()
}

export function useBackgroundNotifications(
  current: string | undefined,
  sessionSnapshot: { pending?: Array<{ kind?: string; key?: string }> } | null | undefined,
): void {
  // 1) Scheduled 任务完成
  useEffect(() => {
    if (typeof Notification === 'undefined') return
    const KEY = 'evoresearch-sched-notified'
    let known = new Set<string>()
    let baseline = true
    try {
      const raw = clientStateGet(KEY)
      if (raw !== null) {
        known = new Set(JSON.parse(raw))
        baseline = false // 已有去重键：后续新完成事件立即通知
      }
    } catch { /* 损坏则视为首次运行 */ }
    const timer = setInterval(() => {
      if (!notifyEnabled()) return
      void fetch('/evoresearch/fs/scheduler-list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then((r) => r.json())
        .then((json) => {
          const tasks: Array<{ taskId?: string; name?: string; lastRunAt?: number }> = json?.value ?? []
          let changed = false
          for (const task of tasks) {
            if (task.taskId === undefined || task.lastRunAt === undefined) continue
            const key = `${task.taskId}:${task.lastRunAt}`
            if (known.has(key)) continue
            known.add(key)
            changed = true
            if (!baseline) {
              try { new Notification(`${t('schedDone')}${task.name ?? task.taskId}`) } catch { /* 静默退化 */ }
            }
          }
          if (changed) {
            clientStateSet(KEY, JSON.stringify([...known]))
          }
          baseline = false
        })
        .catch(() => { /* 网络失败静默 */ })
    }, 10000)
    return () => clearInterval(timer)
  }, [])

  // 2) Ask User / 工具审批出现时通知（仅新出现的 pending）
  const prevPendingRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const pending: Array<{ kind?: string; key?: string }> = sessionSnapshot?.pending ?? []
    const keys = new Set(pending.map((p) => `${p.kind ?? ''}:${p.key ?? ''}`))
    const fresh = [...keys].filter((k) => !prevPendingRef.current.has(k))
    prevPendingRef.current = keys
    if (fresh.length > 0 && notifyEnabled() && current !== undefined) {
      const labels = fresh.map((k) => (k.startsWith('question') ? t('askUserQuestion') : t('toolApproval')))
      try { new Notification(`${labels.join('、')}${t('pendingApprovalSuffix')}`) } catch { /* 静默退化 */ }
    }
  }, [sessionSnapshot, current])
}
