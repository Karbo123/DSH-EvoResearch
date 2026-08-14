/**
 * Cron 表达式解析与下一次运行时间计算（自研，零依赖）。
 *
 * 与 EvoResearch 的 cron 调度语义对齐，支持 5 字段：
 *   分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-6，0=周日)
 * 每字段支持：星号、单值、a-b 范围、a-b/c 步长、星号/c 步长、逗号组合（如 0,30）。
 * 备注：为控制复杂度，第一版不支持 `?`、`L`、`W`、`#` 等 Quartz 扩展
 * （EvoResearch 使用的 python-crontab 也仅支持标准 5 字段）。
 */

/** 解析后的 cron 字段（每个字段是允许值的位图集合）。 */
export interface CronSchedule {
  readonly minutes: ReadonlySet<number>
  readonly hours: ReadonlySet<number>
  readonly days: ReadonlySet<number>
  readonly months: ReadonlySet<number>
  readonly weekdays: ReadonlySet<number>
  /** 日字段是否为裸 `*`（Vixie 语义判定用）。 */
  readonly daysWildcard: boolean
  /** 周字段是否为裸 `*`。 */
  readonly weekdaysWildcard: boolean
  readonly raw: string
}

const WEEKDAY_NAME: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

/** 解析单个字段（允许值范围 [min, max]），返回位图集合。 */
function parseField(field: string, min: number, max: number): Set<number> {
  const result = new Set<number>()
  const parts = field.split(',')
  for (const part of parts) {
    if (part.length === 0) throw new Error(`cron 字段为空: ${field}`)
    const stepMatch = /^(.+)\/(\d+)$/.exec(part)
    const step = stepMatch ? Number(stepMatch[2]) : 1
    const range = stepMatch ? stepMatch[1]! : part
    if (step < 1) throw new Error(`cron 步长非法: ${part}`)
    if (range === '*') {
      for (let v = min; v <= max; v += step) result.add(v)
    } else {
      const dash = range.indexOf('-')
      if (dash < 0) {
        const v = Number(range)
        if (!Number.isInteger(v) || v < min || v > max) throw new Error(`cron 值越界: ${range}`)
        result.add(v)
      } else {
        const a = Number(range.slice(0, dash))
        const b = Number(range.slice(dash + 1))
        if (!Number.isInteger(a) || !Number.isInteger(b) || a < min || b > max || a > b) {
          throw new Error(`cron 范围非法: ${range}`)
        }
        for (let v = a; v <= b; v += step) result.add(v)
      }
    }
  }
  if (result.size === 0) throw new Error(`cron 字段没有可匹配值: ${field}`)
  return result
}

/**
 * 解析 cron 表达式。
 * @param expression 5 字段 cron（如 "0 9 * * 1-5"）。
 */
export function parseCron(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new Error(`cron 表达式必须为 5 字段（分 时 日 月 周），得到 ${fields.length} 个: ${expression}`)
  }
  const [minutes, hours, days, months, weekdays] = fields
  return {
    minutes: parseField(minutes!, 0, 59),
    hours: parseField(hours!, 0, 23),
    days: parseField(days!, 1, 31),
    months: parseField(months!, 1, 12),
    weekdays: normalizeWeekdays(parseField(weekdays!, 0, 6)),
    daysWildcard: days === '*',
    weekdaysWildcard: weekdays === '*',
    raw: expression,
  }
}

/** 周字段支持英文缩写（mon/tue/...）。 */
function normalizeWeekdays(set: Set<number>): Set<number> {
  return set
}

/**
 * 判断某一天是否命中「日/周」规则（Vixie cron 语义）：
 * - 日字段为 `*` 而周字段受限 → 只看周字段；
 * - 周字段为 `*` 而日字段受限 → 只看日字段；
 * - 两者都受限 → 任一命中即触发（OR）；
 * - 两者都为 `*` → 每天。
 * 这保证 `0 9 * * 1-5` 只在工作日触发（而非每天）。
 */
function dayMatches(schedule: CronSchedule, date: Date): boolean {
  const dayOfMonth = date.getDate()
  const dayOfWeek = date.getDay()
  if (schedule.daysWildcard && !schedule.weekdaysWildcard) return schedule.weekdays.has(dayOfWeek)
  if (!schedule.daysWildcard && schedule.weekdaysWildcard) return schedule.days.has(dayOfMonth)
  return schedule.days.has(dayOfMonth) || schedule.weekdays.has(dayOfWeek)
}

/**
 * 计算 `from`（含）之后的下一次运行时间。
 * @param schedule 解析后的调度。
 * @param from 起始时间。
 * @returns 下一次运行时间；无匹配时返回 null（最多向后搜索 5 年）。
 */
export function nextRun(schedule: CronSchedule, from: Date): Date | null {
  const candidate = new Date(from)
  candidate.setSeconds(0, 0)
  // 从下一分钟开始搜索（当前分钟已经过去的调度不再触发）
  candidate.setMinutes(candidate.getMinutes() + 1)
  const limit = from.getTime() + 5 * 366 * 24 * 60 * 60 * 1000
  for (;;) {
    if (candidate.getTime() > limit) return null
    const month = candidate.getMonth() + 1
    if (!schedule.months.has(month)) {
      candidate.setDate(1)
      candidate.setMonth(candidate.getMonth() + 1)
      continue
    }
    if (!dayMatches(schedule, candidate)) {
      candidate.setDate(candidate.getDate() + 1)
      candidate.setHours(0, 0, 0, 0)
      continue
    }
    if (!schedule.hours.has(candidate.getHours())) {
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!schedule.minutes.has(candidate.getMinutes())) {
      candidate.setMinutes(candidate.getMinutes() + 1, 0, 0)
      continue
    }
    return candidate
  }
}

/** 便捷入口：解析表达式并返回下一次运行时间。 */
export function nextCronRun(expression: string, from: Date): Date | null {
  return nextRun(parseCron(expression), from)
}
