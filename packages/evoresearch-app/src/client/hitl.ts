/**
 * HITL 卡片状态（§21.2 审批 / §21.3 Ask User，0.1.3 自有通道消费端）。
 *
 * host 侧 workspace-api.ts 把 user-questions / approval 的 waterfall 请求落到
 * /evoresearch/fs/hitl-pending（清单）与 /evoresearch/fs/hitl-answer（应答）。
 * 本模块轮询 pending 清单（仅在有卡片或最近有活动时活跃），向卡片提供与
 * 官方 PendingApproval / PendingQuestion 同形的 answer/cancel 语义。
 *
 * 多会话边界：请求经根作用域接单时客户端不可见目标会话，卡片渲染在当前
 * 打开的会话中（与 rc.2 snapshotCache.pending 的实际可见性一致）。
 */
import { useSyncExternalStore } from 'react'

export type HitlWait = {
  kind: 'approval' | 'question'
  key: string
  /** approval 字段。 */
  toolName?: string
  callId?: unknown
  reason?: string
  /** question 字段（AskUserQuestionItem[]）。 */
  questions?: any[]
  /** 用户应答（approval → outcome 字符串；question → { answers }）。 */
  answer: (value: unknown) => void
  /** 用户关闭问题卡片。 */
  cancel: () => void
}

let waits: HitlWait[] = []
const listeners = new Set<() => void>()
let pollTimer: ReturnType<typeof setInterval> | undefined
let lastSignature = ''

function emit(): void {
  for (const listener of listeners) listener()
}

function setWaits(next: HitlWait[]): void {
  waits = next
  emit()
}

async function postAnswer(key: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch('/evoresearch/fs/hitl-answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, ...payload }),
    })
  } catch { /* 网络失败：下一次轮询会以 host 状态为准（请求仍在清单则仍在） */ }
}

async function pollOnce(): Promise<void> {
  const res = await fetch('/evoresearch/fs/hitl-pending')
  if (!res.ok) return
  const json = (await res.json()) as { ok?: boolean; value?: Array<Record<string, unknown>> }
  const rows = Array.isArray(json?.value) ? json.value : []
  const signature = JSON.stringify(rows)
  if (signature === lastSignature) return
  lastSignature = signature
  setWaits(rows.map((row) => ({
    kind: row.kind === 'approval' ? 'approval' : 'question',
    key: String(row.key ?? ''),
    toolName: typeof row.toolName === 'string' ? row.toolName : undefined,
    callId: row.callId,
    reason: typeof row.reason === 'string' ? row.reason : undefined,
    questions: Array.isArray(row.questions) ? row.questions : undefined,
    answer: (value: unknown) => { void postAnswer(String(row.key ?? ''), { value }) },
    cancel: () => { void postAnswer(String(row.key ?? ''), { error: 'the user closed this request' }) },
  })))
}

/** 启动轮询（index.ts apply 调用一次；轻量 GET，签名未变时零渲染）。 */
export function startHitlPolling(intervalMs = 1600): void {
  if (pollTimer !== undefined) return
  void pollOnce().catch(() => {})
  pollTimer = setInterval(() => { void pollOnce().catch(() => {}) }, intervalMs)
}

/** 订阅式卡片状态（waits 数组不可变替换，identity 稳定；无变化零渲染）。 */
export function useHitlWaits(): HitlWait[] {
  return useSyncExternalStore(
    (onChange) => { listeners.add(onChange); return () => listeners.delete(onChange) },
    () => waits,
  )
}
