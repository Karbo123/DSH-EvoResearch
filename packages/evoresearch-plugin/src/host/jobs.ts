/**
 * P0-3 JobHub 后台活动注册表（纯进程内存版）。
 *
 * 职责：
 * - 汇聚四类后台活动（subagent / scheduled / experiment / channel + custom 扩展位）
 *   的运行快照，供工作台「后台任务」面板展示与会话跳转；
 * - 完结流转（complete / fail / markCancelled）：从 active 挪入终端环形历史
 *   （cap 100，超出丢最旧）；
 * - cancelBySession：会话删除级联（P3-1）——对该会话的 active 任务逐个
 *   best-effort 取消后统一标记 cancelled；
 * - unregister：服务卸载路径，直接移除不入历史；
 * - 不持久化：进程内存活即可，重启天然清零（与提案「重启天然清零 +
 *   进程句柄校验」一致）。
 *
 * 风格对齐 platform/subagents.ts 的注册表类：无外部服务依赖、可独立单测。
 */
import { randomUUID } from 'node:crypto'

/** 后台活动类别（P0-3 四类 + 扩展位）。 */
export type HubJobKind = 'subagent' | 'scheduled' | 'experiment' | 'channel' | 'custom'

/** 一条后台任务快照（wire JSON）。 */
export interface HubJob {
  jobId: string
  kind: HubJobKind
  label: string
  /** 所属会话（可点击跳转；通道/全局活动可能没有）。 */
  sessionId?: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  finishedAt?: number
  detail?: string
}

/** 注册入参。 */
export interface HubJobRegisterInput {
  kind: HubJobKind
  label: string
  sessionId?: string
  detail?: string
  /** 取消实现（幂等；best-effort 调用）。 */
  cancel?: () => Promise<void> | void
}

/** 终端历史环形上限（超出丢最旧）。 */
const HISTORY_CAP = 100

/** active 条目：wire 快照 + 取消实现（cancel 不进 wire 快照）。 */
interface ActiveEntry {
  job: HubJob
  cancel?: () => Promise<void> | void
}

/** 快照副本（调用方改动不影响内部状态）。 */
function snapshot(job: HubJob): HubJob {
  return { ...job }
}

/** running 排前、其余同级（排序权重）。 */
function statusRank(status: HubJob['status']): number {
  return status === 'running' ? 0 : 1
}

/**
 * JobHub 后台活动注册表。
 * 用法：const hub = new JobHubService(); const job = hub.register({...});
 * 完结时 hub.complete(job.jobId)；插件卸载时 hub.dispose()。
 */
export class JobHubService {
  private readonly active = new Map<string, ActiveEntry>()
  /** 终端环形历史（最旧在前；cap HISTORY_CAP）。 */
  private readonly history: HubJob[] = []

  /** 注册一条后台任务（加入 active；返回快照副本）。 */
  register(input: HubJobRegisterInput): HubJob {
    const job: HubJob = {
      jobId: `${input.kind}-${randomUUID().slice(0, 8)}`,
      kind: input.kind,
      label: input.label,
      sessionId: input.sessionId,
      status: 'running',
      startedAt: Date.now(),
      detail: input.detail,
    }
    this.active.set(job.jobId, { job, cancel: input.cancel })
    return snapshot(job)
  }

  /** 完结（status → completed）。未知 jobId 静默返回 false。 */
  complete(jobId: string, detail?: string): boolean {
    return this.finish(jobId, 'completed', detail)
  }

  /** 失败完结（status → failed）。未知 jobId 静默返回 false。 */
  fail(jobId: string, detail?: string): boolean {
    return this.finish(jobId, 'failed', detail)
  }

  /** 取消完结（status → cancelled）。未知 jobId 静默返回 false。 */
  markCancelled(jobId: string, detail?: string): boolean {
    return this.finish(jobId, 'cancelled', detail)
  }

  /** 直接移除不入历史（服务卸载用）；返回是否存在。 */
  unregister(jobId: string): boolean {
    return this.active.delete(jobId)
  }

  /** 按 id 查询（active 优先，其次终端历史）；返回快照副本。 */
  get(jobId: string): HubJob | undefined {
    const entry = this.active.get(jobId)
    if (entry) return snapshot(entry.job)
    const found = this.history.find((job) => job.jobId === jobId)
    return found ? snapshot(found) : undefined
  }

  /**
   * 列出任务（running 在前、各组内按 startedAt 降序）。
   * 过滤：sessionId / kind / activeOnly（仅 running）。
   */
  list(filter?: { sessionId?: string; kind?: HubJobKind; activeOnly?: boolean }): HubJob[] {
    const pool: HubJob[] = [...this.active.values()].map((entry) => entry.job)
    if (!filter?.activeOnly) pool.push(...this.history)
    return pool
      .filter((job) =>
        (filter?.sessionId === undefined || job.sessionId === filter.sessionId) &&
        (filter?.kind === undefined || job.kind === filter.kind))
      .sort((a, b) => statusRank(a.status) - statusRank(b.status) || b.startedAt - a.startedAt)
      .map(snapshot)
  }

  /** active 任务数（可选按会话过滤）。 */
  countActive(sessionId?: string): number {
    let count = 0
    for (const entry of this.active.values()) {
      if (sessionId === undefined || entry.job.sessionId === sessionId) count++
    }
    return count
  }

  /**
   * 级联取消某会话的全部 active 任务（P3-1 会话删除用）：
   * 逐个调用其 cancel()（各自 try/catch，Promise reject 吞掉计为失败但不中断
   * 其余），然后统一 markCancelled；返回尝试取消的条数。
   */
  async cancelBySession(sessionId: string): Promise<number> {
    const targets = [...this.active.values()].filter((entry) => entry.job.sessionId === sessionId)
    for (const entry of targets) {
      if (!entry.cancel) continue
      try {
        await entry.cancel()
      } catch {
        // 单个取消失败（同步抛错或 Promise reject）不阻断其余
      }
    }
    for (const entry of targets) this.markCancelled(entry.job.jobId)
    return targets.length
  }

  /** 插件卸载：对所有 active 尝试 cancel 并清空（不等待异步取消完成）。 */
  dispose(): void {
    const entries = [...this.active.values()]
    this.active.clear()
    for (const entry of entries) {
      if (!entry.cancel) continue
      try {
        const result = entry.cancel()
        if (result instanceof Promise) result.catch(() => { /* dispose 不等待 */ })
      } catch {
        // best-effort
      }
    }
  }

  /** 完结流转内部实现：active → 终端环形历史。 */
  private finish(jobId: string, status: HubJob['status'], detail?: string): boolean {
    const entry = this.active.get(jobId)
    if (!entry) return false
    this.active.delete(jobId)
    entry.job.status = status
    entry.job.finishedAt = Date.now()
    if (detail !== undefined) entry.job.detail = detail
    this.history.push(entry.job)
    if (this.history.length > HISTORY_CAP) {
      this.history.splice(0, this.history.length - HISTORY_CAP)
    }
    return true
  }
}
