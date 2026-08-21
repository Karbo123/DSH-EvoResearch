/**
 * P3-2 无人值守会话登记表（运行时接线的数据面）。
 *
 * 背景：scheduler/channel/science 触发的后台会话无人在看，其 shell 命令
 * 应经过 decideUnattendedShell 门控。DSH 的 SessionHeader 无自定义来源字段，
 * 因此由创建方（deliverToAgent / scheduler.runTask）在会话创建后把 sessionId
 * 登记进来，工具执行守卫（tools.guard）据此判定。
 *
 * 生命周期：进程内 Set（重启后自然失效——重启后这些会话也不会再执行新命令）；
 * 会话删除时 unmark 防泄漏。
 */

/** 已登记的无人值守会话 id 集合（进程内）。 */
const marked = new Set<string>()

/** 标记一个会话为无人值守（scheduler/channel/science 创建后调用）。 */
export function markUnattendedSession(sessionId: string): void {
  if (sessionId !== '') marked.add(sessionId)
}

/** 取消标记（会话删除级联时调用，防集合无限增长）。 */
export function unmarkUnattendedSession(sessionId: string): void {
  marked.delete(sessionId)
}

/** 查询某会话当前是否无人值守。 */
export function isMarkedUnattended(sessionId: string | undefined | null): boolean {
  if (typeof sessionId !== 'string' || sessionId === '') return false
  return marked.has(sessionId)
}
