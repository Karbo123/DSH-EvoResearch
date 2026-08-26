/**
 * 定时任务服务（cron 调度，项目隔离）。
 *
 * 对齐 EvoResearch cron/schedule.py 与 memory/autoskills/schedule.py：
 * - 5 字段 cron 表达式（自研解析器，见 core/cron.ts）；
 * - 任务带 workspaceDir：触发时在该项目工作区执行；
 * - 结果线程记录 lastResultThreadId，WebUI 可直达并「Report to main chat」；
 * - 任务表持久化到 <dataRoot>/plugins/scheduler.json（原子写）。
 */
import type { Context } from '@deepseek-ai/cordis'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { parseCron, nextRun } from './core/cron.js'
import { markUnattendedSession } from './platform/unattended-registry.js'
import type { ScheduledTask } from '../shared/types.js'

/** 调度服务配置。 */
export interface SchedulerConfig {
  readonly dataRoot: string
  /** 触发时用于执行任务的模型（缺省用当前默认模型）。 */
  readonly model?: { provider: string; model: string }
}

/* ------------------------------------------------------------------ */
/* PLAT-17：自然语言 cron 解析（纯函数）                                 */
/* ------------------------------------------------------------------ */

/**
 * 自然语言 → 5 字段 cron（PLAT-17 纯函数）。支持：
 * - "每天早上9点" / "每天早上九点" / "每早九点" / "每早9点" → 0 9 * * *
 * - "每天中午12点" / "每天12点" → 0 12 * * *
 * - "每天晚上8点" / "每晚八点" → 0 20 * * *
 * - "每小时" / "每小时执行" → 0 * * * *
 * - "每周一上午10点" / "每周一10点" → 0 10 * * 1
 * - "每周日晚上9点" → 0 21 * * 0
 * - "每月1号零点" / "每月1日0点" → 0 0 1 * *
 * 解析失败返回 null（由调用方报错，不猜）。
 */
export function parseNaturalCron(text: string): string | null {
  const input = String(text ?? '').trim()
  if (input === '') return null
  // 小时中文数字映射
  const cnDigits: Record<string, string> = {
    零: '0', 一: '1', 二: '2', 两: '2', 三: '3', 四: '4', 五: '5',
    六: '6', 七: '7', 八: '8', 九: '9', 十: '10',
  }
  const hourOf = (part: string): string | null => {
    const trimmed = part.trim()
    if (/^\d{1,2}$/.test(trimmed)) return trimmed
    if (cnDigits[trimmed] !== undefined) return cnDigits[trimmed]
    return null
  }
  // 时刻：<hour>点 / <hour>：<minute>分
  const timeMatch = /(\d{1,2}|[零一二两三四五六七八九十]+)\s*点(?:\s*(\d{1,2}|[零一二两三四五六七八九十]+)\s*分?)?/.exec(input)
  const hour = timeMatch ? hourOf(timeMatch[1]!) : null
  const minute = timeMatch && timeMatch[2] ? hourOf(timeMatch[2]!) : '0'
  if (timeMatch && hour === null) return null
  const hasTime = timeMatch !== null

  if (/每小时/.test(input)) return '0 * * * *'

  // 星期
  const weekNames: Record<string, string> = {
    一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 日: '0', 天: '0',
  }
  let week = ''
  const weekMatch = /周([一二三四五六日天])/.exec(input)
  if (weekMatch) week = weekNames[weekMatch[1]!]!

  // 每月 N 号
  let dayOfMonth = ''
  const dayMatch = /月(\d{1,2})[号日]/.exec(input)
  if (dayMatch) dayOfMonth = dayMatch[1]!

  // 时段 → 小时（未写具体小时时）
  const periodHour: Record<string, string> = { 早: '9', 上午: '10', 中午: '12', 下午: '15', 晚: '20', 晚上: '20', 深夜: '23' }
  let resolvedHour = hour
  if (resolvedHour === null && hasTime === false) {
    for (const [key, value] of Object.entries(periodHour)) {
      if (input.includes(key)) {
        resolvedHour = value
        break
      }
    }
  }
  // 时段偏移：晚上/深夜/下午 与显式小时组合（"晚上8点" → 20 点）
  if (resolvedHour !== null && /(晚上|晚|深夜|下午)/.test(input)) {
    const numeric = Number(resolvedHour)
    if (/下午/.test(input)) {
      if (numeric >= 1 && numeric <= 11) resolvedHour = String(numeric + 12)
    } else {
      // 晚/晚上/深夜：12 小时制偏移（≤11 的加 12；12 保持）
      if (numeric >= 1 && numeric <= 11) resolvedHour = String(numeric + 12)
    }
  }
  if (resolvedHour === null) return null
  const h = Math.min(23, Number(resolvedHour))
  const m = Math.min(59, Number(minute ?? '0'))

  if (dayOfMonth !== '') return `${m} ${h} ${dayOfMonth} * *`
  if (week !== '') return `${m} ${h} * * ${week}`
  return `${m} ${h} * * *`
}

/** 定时任务服务。 */
export class SchedulerService {
  private readonly file: string
  private tasks: ScheduledTask[] = []
  private tickDisposer: (() => void) | undefined

  constructor(readonly config: SchedulerConfig) {
    this.file = path.join(config.dataRoot, 'plugins', 'scheduler.json')
    this.load()
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { tasks?: unknown }
      if (Array.isArray(raw.tasks)) {
        this.tasks = raw.tasks.filter((task): task is ScheduledTask => {
          const t = task as ScheduledTask
          return typeof t?.taskId === 'string' && typeof t?.cron === 'string' && typeof t?.prompt === 'string'
        })
      }
    } catch {
      this.tasks = []
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ tasks: this.tasks }, null, 2), 'utf8')
    fs.renameSync(tmp, this.file)
  }

  list(): ScheduledTask[] {
    return [...this.tasks].sort((a, b) => a.createdAt - b.createdAt)
  }

  /** 添加任务（cron 表达式非法时抛错）。 */
  add(input: { name: string; cron: string; prompt: string; workspaceDir: string }): ScheduledTask {
    parseCron(input.cron) // 校验
    const task: ScheduledTask = {
      taskId: `s-${randomUUID().slice(0, 8)}`,
      name: input.name || input.prompt.slice(0, 30),
      cron: input.cron,
      prompt: input.prompt,
      workspaceDir: input.workspaceDir,
      enabled: true,
      createdAt: Date.now(),
    }
    this.tasks.push(task)
    this.save()
    return task
  }

  /** PLAT-17 自然语言创建任务（"每早九点"→ cron；解析失败抛错）。 */
  addNatural(input: { text: string; prompt: string; workspaceDir: string; name?: string }): ScheduledTask {
    const cron = parseNaturalCron(input.text)
    if (cron === null) {
      throw new Error(`无法从自然语言解析 cron: "${input.text}"（支持如：每天早上9点 / 每周一上午10点 / 每小时）`)
    }
    return this.add({ name: input.name ?? input.text, cron, prompt: input.prompt, workspaceDir: input.workspaceDir })
  }

  /** PLAT-17 暂停（禁用但不删除）。 */
  pause(taskId: string): boolean {
    return this.setEnabled(taskId, false)
  }

  /** PLAT-17 恢复。 */
  resume(taskId: string): boolean {
    return this.setEnabled(taskId, true)
  }

  /** PLAT-17 结果回报查询（结果线程直达 + 最近运行时间）。 */
  reportOf(taskId: string): { threadId?: string; lastRunAt?: number; nextRunAt?: number } {
    const task = this.tasks.find((t) => t.taskId === taskId)
    if (!task) return {}
    return {
      threadId: task.lastResultThreadId,
      lastRunAt: task.lastRunAt,
      nextRunAt: this.nextRunOf(task) ?? undefined,
    }
  }

  remove(taskId: string): boolean {
    const before = this.tasks.length
    this.tasks = this.tasks.filter((task) => task.taskId !== taskId)
    if (this.tasks.length !== before) {
      this.save()
      return true
    }
    return false
  }

  setEnabled(taskId: string, enabled: boolean): boolean {
    const task = this.tasks.find((t) => t.taskId === taskId)
    if (!task) return false
    task.enabled = enabled
    this.save()
    return true
  }

  /** Run now（§42.3）：立即执行一次任务，更新 lastRunAt 与结果线程。 */
  async runNow(ctx: Context, taskId: string): Promise<{ ok: boolean; error?: string; threadId?: string }> {
    const task = this.tasks.find((t) => t.taskId === taskId)
    if (!task) return { ok: false, error: '任务不存在' }
    try {
      const threadId = await this.runTask(ctx, task)
      task.lastRunAt = Date.now()
      task.lastResultThreadId = threadId
      this.save()
      return { ok: true, threadId }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 计算某任务的下一次运行时间（毫秒时间戳；cron 非法或禁用返回 null）。 */
  nextRunOf(task: ScheduledTask): number | null {
    try {
      if (!task.enabled) return null
      // 从未运行过：从现在起算下一个 cron 点（不能从 epoch 起算）
      const from = task.lastRunAt !== undefined ? new Date(task.lastRunAt) : new Date()
      return nextRun(parseCron(task.cron), from)?.getTime() ?? null
    } catch {
      return null
    }
  }

  /** 启动每分钟一次的 tick。 */
  attach(ctx: Context): () => void {
    if (this.tickDisposer) return this.tickDisposer
    const timer = ctx.get('timer')
    if (!timer) return () => {}
    this.tickDisposer = timer.interval(() => {
      void this.tick(ctx).catch((error) => {
        console.error('[evoresearch:scheduler] tick 失败:', error)
      })
    }, 60_000)
    return () => {
      this.tickDisposer?.()
      this.tickDisposer = undefined
    }
  }

  /** 检查并触发到期任务。 */
  private async tick(ctx: Context): Promise<void> {
    const now = new Date()
    for (const task of this.tasks) {
      if (!task.enabled) continue
      if (task.lastRunAt !== undefined) {
        const next = nextRun(parseCron(task.cron), new Date(task.lastRunAt))
        if (!next || next.getTime() > now.getTime()) continue
      } else {
        const first = nextRun(parseCron(task.cron), new Date(0))
        if (!first || first.getTime() > now.getTime()) continue
      }
      // 到期：执行一次
      try {
        const threadId = await this.runTask(ctx, task)
        task.lastRunAt = Date.now()
        task.lastResultThreadId = threadId
      } catch (error) {
        console.error(`[evoresearch:scheduler] 任务 ${task.taskId} 执行失败:`, error)
        task.lastRunAt = Date.now()
      }
      this.save()
    }
  }

  /**
   * 执行一次任务：创建后台 agent 会话并发送 prompt（agent.followup）。
   * @returns 结果线程 id（供 WebUI 直达与回报主对话）。
   */
  private async runTask(ctx: Context, task: ScheduledTask): Promise<string> {
    const agents = ctx.get('agents')
    if (!agents) return Promise.reject(new Error('agents 服务不可用'))
    const sessionId = `session-${randomUUID()}`
    // createAgent options 对齐官方（apiproxy ensureSession）：sessionId 必填；
    // agentOptions 带默认模型选择（provider/model），否则 agent 无模型配置、turn 空转；
    // setup 挂载 agent preset（系统提示/工具）。
    const agentDefaultModel = ctx.get('agentDefaultModel') as { currentSelection?(): { provider: string; model: string } } | undefined
    const selection = agentDefaultModel?.currentSelection?.()
    const agentPresets = ctx.get('agentPresets') as { resolve?(id?: string): Promise<{ id: string }>; mount?(ctx: unknown, id: string): Promise<unknown> } | undefined
    const setup = agentPresets?.resolve === undefined || agentPresets?.mount === undefined
      ? undefined
      : async (agentCtx: unknown) => {
          const resolved = await (agentPresets as { resolve(id?: string): Promise<{ id: string }> }).resolve(undefined)
          await (agentPresets as { mount(ctx: unknown, id: string): Promise<unknown> }).mount(agentCtx, resolved.id)
        }
    const handle = await (agents as {
      create(options: {
        sessionId: string
        meta?: { cwd?: string }
        agentOptions?: Record<string, unknown>
        setup?: (agentCtx: unknown) => Promise<unknown>
      }): Promise<unknown>
    }).create({
      sessionId,
      meta: { cwd: task.workspaceDir || this.config.dataRoot },
      agentOptions: selection !== undefined ? { provider: selection.provider, model: selection.model } : {},
      ...(setup === undefined ? {} : { setup }),
    })
    const agent = (handle as { agent?: { followup(message: unknown): void } }).agent
    if (!agent?.followup) return Promise.reject(new Error('创建 agent 失败'))
    // P3-2：定时任务会话无人值守 → 登记 shell 门控（tools.guard 据此判定）
    markUnattendedSession(sessionId)
    const message = createUserMessage({
      content: [{ type: 'text', text: `【定时任务 ${task.name}】\n${task.prompt}\n\n完成后请汇报关键结果。` }],
      source: { kind: 'user' },
    })
    agent.followup(message)
    return sessionId
  }
}
