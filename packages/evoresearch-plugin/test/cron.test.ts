/**
 * core/cron 单元测试：5 字段 cron 解析与下一次运行时间。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseCron, nextRun } from '../src/host/core/cron.js'

describe('parseCron', () => {
  it('标准表达式', () => {
    const schedule = parseCron('0 9 * * 1-5')
    assert.ok(schedule.minutes.has(0))
    assert.ok(schedule.hours.has(9))
    assert.ok(schedule.weekdays.has(1))
    assert.ok(schedule.weekdays.has(5))
    assert.ok(!schedule.weekdays.has(6))
  })

  it('步长与通配', () => {
    const schedule = parseCron('*/15 * * * *')
    assert.ok(schedule.minutes.has(0))
    assert.ok(schedule.minutes.has(15))
    assert.ok(schedule.minutes.has(45))
    assert.ok(!schedule.minutes.has(10))
  })

  it('非法表达式抛错', () => {
    assert.throws(() => parseCron('0 9 * *'))
    assert.throws(() => parseCron('60 * * * *'))
    assert.throws(() => parseCron('* 24 * * *'))
    assert.throws(() => parseCron('* * 32 * *'))
  })
})

describe('nextRun', () => {
  it('每日 9:00（工作日）', () => {
    // 2026-08-10 是周一（假设）；选一个确定日期：2026-08-10T08:30 应是周一
    const from = new Date('2026-08-10T08:30:00')
    const next = nextRun(parseCron('0 9 * * 1-5'), from)
    assert.ok(next)
    assert.equal(next.getDay() >= 1 && next.getDay() <= 5, true)
    assert.equal(next.getHours(), 9)
    assert.equal(next.getMinutes(), 0)
    // 结果应在 08:30 之后
    assert.ok(next.getTime() > from.getTime())
  })

  it('跳过周末', () => {
    // 2026-08-14 是周五 08:30 → 下次是当天 9:00；2026-08-15 是周六 08:30 → 下次是周一
    const friday = new Date('2026-08-14T08:30:00')
    const nextFriday = nextRun(parseCron('0 9 * * 1-5'), friday)
    assert.equal(nextFriday.getDay(), 5)
    assert.equal(nextFriday.getDate(), 14)

    const saturday = new Date('2026-08-15T08:30:00')
    const nextMonday = nextRun(parseCron('0 9 * * 1-5'), saturday)
    assert.equal(nextMonday.getDay(), 1)
    assert.equal(nextMonday.getDate(), 17)
  })

  it('每分钟任务', () => {
    const from = new Date('2026-08-10T10:00:30')
    const next = nextRun(parseCron('* * * * *'), from)
    assert.equal(next.getMinutes(), 1)
  })

  it('日/周字段 Vixie 语义：一方为 * 时取另一方', () => {
    // '0 0 30 2 *'：日字段受限（30），周字段为 * → 只按日字段 → 2 月无 30 日 → null
    const next = nextRun(parseCron('0 0 30 2 *'), new Date('2026-01-01T00:00:00'))
    assert.equal(next, null)
    // '0 0 13 1 *'：只按日字段 → 2026-01-13
    const jan13 = nextRun(parseCron('0 0 13 1 *'), new Date('2026-01-01T00:00:00'))
    assert.equal(jan13.getMonth(), 0)
    assert.equal(jan13.getDate(), 13)
  })

  it('日/周字段都受限时 OR（Vixie 语义）', () => {
    // '0 0 13 1 5'：1 月 13 日 或 1 月的周五 → 2026-01-02 是周五
    const next = nextRun(parseCron('0 0 13 1 5'), new Date('2026-01-01T00:00:00'))
    assert.equal(next.getDate(), 2) // 2026-01-02（周五）
    assert.equal(next.getDay(), 5)
  })
})
