/**
 * 定时任务服务（cron 调度，项目隔离）。
 *
 * 对齐 EvoResearch cron/schedule.py 与 memory/autoskills/schedule.py：
 * - 5 字段 cron 表达式（自研解析器，见 core/cron.ts）；
 * - 任务带 workspaceDir：触发时在该项目工作区执行；
 * - 结果线程记录 lastResultThreadId，WebUI 可直达并「Report to main chat」；
 * - 任务表持久化到 <dataRoot>/.evoresearch-data/scheduler.json（原子写）。
 */
import type { Context } from '@deepseek-ai/cordis'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseCron, nextRun } from './core/cron.js'
import type { ScheduledTask } from '../shared/types.js'

/** 调度服务配置。 */
export interface SchedulerConfig {
  readonly dataRoot: string
  /** 触发时用于执行任务的模型（缺省用当前默认模型）。 */
  readonly model?: { provider: string; model: string }
}

/** 定时任务服务。 */
export class SchedulerService {
  private readonly file: string
  private tasks: ScheduledTask[] = []
  private tickDisposer: (() => void) | undefined

  constructor(readonly config: SchedulerConfig) {
    this.file = path.join(config.dataRoot, '.evoresearch-data', 'scheduler.json')
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
   * 执行一次任务：创建/复用项目会话并发送 prompt。
   * @returns 结果线程 id（供 WebUI 直达与回报主对话）。
   */
  private async runTask(ctx: Context, task: ScheduledTask): Promise<string> {
    const agents = ctx.get('agents')
    if (!agents) throw new Error('agents 服务不可用')
    // 创建后台 agent 会话（owner 为宿主进程，不走交互 UI）
    const handle = await agents.create({
      cwd: task.workspaceDir || this.config.dataRoot,
      source: 'evoresearch:scheduler',
      initialMessage: `【定时任务 ${task.name}】\n${task.prompt}\n\n完成后请汇报关键结果。`,
    } as never)
    const sessionId = (handle as unknown as { session?: { id?: string } }).session?.id
      ?? (handle as unknown as { id?: string }).id
      ?? randomUUID()
    // 注：真实执行由 agent loop 异步完成；此处返回会话 id 供追踪。
    return sessionId
  }
}
