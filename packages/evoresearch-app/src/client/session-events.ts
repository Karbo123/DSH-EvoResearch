/**
 * 会话事件源适配（0.1.3 升级）。
 *
 * rc.2：binding.session 直接暴露 `.events` 数组与 `.notifier`。
 * 0.1.3：SessionFace 不再有 events —— 原始事件窗口移到
 * `sessions.binding(id).eventSource`（ObservableSnapshot<SessionEventWindow>，
 * entries 为 { type: 'event' | 'transient', event } 条目，event 含客户端
 * assistant/live-chunk 演示事件）。
 *
 * index.ts 在 apply 时注入 resolver（session face → eventSource 快照源）；
 * 本模块对外提供 useSyncExternalStore 友好的订阅式事件列表。
 */
import { useMemo, useSyncExternalStore } from 'react'

type SnapshotSource = { getSnapshot(): unknown; subscribe(fn: () => void): () => void } | null | undefined

let resolveEventSource: (session: any) => SnapshotSource = () => null

/** index.ts apply 时注入：session face → 该会话绑定的 eventSource。 */
export function setEventSourceResolver(fn: (session: any) => SnapshotSource): void {
  resolveEventSource = fn
}

/** 同步读取当前事件列表（0.1.3 eventSource 优先；rc.2 session.events 回退）。 */
export function sessionEventsSync(session: any): any[] {
  const source = resolveEventSource(session)
  const snap = source?.getSnapshot?.() as { entries?: readonly { event: any }[] } | undefined
  if (snap?.entries) return snap.entries.map((e) => e.event)
  return Array.isArray(session?.events) ? session.events : []
}

/** 订阅式事件列表：eventSource revision 变化（含 live-chunk 追加）触发重算。 */
export function useSessionEvents(session: any): any[] {
  const source = resolveEventSource(session)
  const subscribe = (onChange: () => void) => {
    if (source?.subscribe) return source.subscribe(onChange)
    if (typeof session?.notifier?.subscribe === 'function') return session.notifier.subscribe(onChange)
    return () => {}
  }
  const revision = useSyncExternalStore(
    subscribe,
    () => {
      const snap = source?.getSnapshot?.() as { revision?: number } | undefined
      if (snap?.entries !== undefined) return String(snap.revision ?? snap.entries.length)
      return String(Array.isArray(session?.events) ? session.events.length : 0)
    },
  )
  return useMemo(() => sessionEventsSync(session), [session, revision])
}

/** 投影值同步读取（0.1.3 faceOf(key).getSnapshot()；rc.2 projections.get 回退）。 */
export function projectionGet(session: any, key: string): any {
  const face = session?.projections?.faceOf?.(key)
  const value = face?.getSnapshot?.()
  if (value !== undefined) return value
  return typeof session?.projections?.get === 'function' ? session.projections.get(key) : undefined
}

/** 投影值订阅读取（0.1.3 faceOf(key)：整值替换语义；以内容签名作快照令牌）。 */
export function useProjectionValue(session: any, key: string): any {
  const face = session?.projections?.faceOf?.(key)
  const signature = useSyncExternalStore(
    (onChange) => face?.subscribe?.(onChange) ?? (() => {}),
    () => {
      const value = face?.getSnapshot?.()
      if (value === undefined) return ''
      try { return JSON.stringify(value) } catch { return String(value) }
    },
  )
  return useMemo(() => {
    const value = face?.getSnapshot?.()
    return value === undefined ? null : value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [face, signature])
}
