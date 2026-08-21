/**
 * 实验日报单测（C.4）：覆盖 generate / scheduler / cron 解析。
 * 参照 ledger.test.ts 风格（node --import tsx --test），临时目录不碰真实数据。
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { DailyReportService } from '../src/host/daily-report.js'
import { ExperimentWorkspaceService } from '../src/host/experiment-workspace.js'
import { parseCron, nextRun } from '../src/host/core/cron.js'

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-daily-'))
after(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true })
})

function makeDataRoot(tag: string): string {
  const base = fs.mkdtempSync(path.join(TMP_ROOT, `${tag}-`))
  const dataRoot = path.join(base, 'dataRoot')
  fs.mkdirSync(path.join(dataRoot, 'projects'), { recursive: true })
  return dataRoot
}

function makeProject(dataRoot: string, name: string): string {
  const dir = path.join(dataRoot, 'projects', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(path.join(dir, 'experiments'), { recursive: true })
  return dir
}

function createExp(dataRoot: string, projectDir: string, slug: string, opts?: { noteLines?: number; labNote?: string }) {
  const ws = new ExperimentWorkspaceService({ dataRoot })
  // createWorkspace 需要 project 目录已存在，name 用 slug 的可展示名
  const info = ws.createWorkspace(projectDir, slug)
  // 覆盖 LAB_NOTE 行数需求
  if (opts?.labNote !== undefined) {
    ws.writeNote(projectDir, info.slug, opts.labNote)
  } else if (opts?.noteLines !== undefined) {
    const lines = Array.from({ length: opts.noteLines }, (_, i) => `line ${i}`).join('\n')
    ws.writeNote(projectDir, info.slug, lines)
  }
  return info
}

// ── generate ────────────────────────────────────────────────────────────────

describe('DailyReportService generate', () => {
  it('单实验模板渲染：标题、概览、实验小节与建议', async () => {
    const dataRoot = makeDataRoot('gen-single')
    const projectDir = makeProject(dataRoot, 'proj-a')
    createExp(dataRoot, projectDir, 'exp-one', { noteLines: 3 })
    const svc = new DailyReportService(dataRoot)
    const result = await svc.generate({ projectDir }, 'manual')
    assert.match(result.reportId, /^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{4}$/)
    assert.ok(fs.existsSync(result.path))
    assert.ok(result.markdown.includes('# 实验日报'))
    assert.ok(result.markdown.includes('触发方式：手动'))
    assert.ok(result.markdown.includes('共 1 个实验'))
    assert.ok(result.markdown.includes('### exp-one'))
    assert.ok(result.markdown.includes('笔记：'))
    assert.ok(result.markdown.includes('## 建议'))
    assert.equal(result.trigger, 'manual')
  })

  it('空项目生成“暂无实验”', async () => {
    const dataRoot = makeDataRoot('gen-empty')
    const projectDir = makeProject(dataRoot, 'empty-proj')
    const svc = new DailyReportService(dataRoot)
    const result = await svc.generate({ projectDir }, 'manual')
    assert.ok(result.markdown.includes('暂无实验'))
    assert.ok(result.markdown.includes('共 0 个实验'))
  })

  it('slugs 过滤：只包含指定实验', async () => {
    const dataRoot = makeDataRoot('gen-filter')
    const projectDir = makeProject(dataRoot, 'filter-proj')
    createExp(dataRoot, projectDir, 'alpha')
    createExp(dataRoot, projectDir, 'beta')
    const svc = new DailyReportService(dataRoot)
    const result = await svc.generate({ projectDir, slugs: ['alpha'] }, 'manual')
    assert.ok(result.markdown.includes('### alpha'))
    assert.ok(!result.markdown.includes('### beta'))
    assert.ok(result.markdown.includes('共 1 个实验'))
  })

  it('auto 触发标签与文件落盘', async () => {
    const dataRoot = makeDataRoot('gen-auto')
    const projectDir = makeProject(dataRoot, 'auto-proj')
    createExp(dataRoot, projectDir, 'e1')
    const svc = new DailyReportService(dataRoot)
    const result = await svc.generate({ projectDir }, 'auto')
    assert.equal(result.trigger, 'auto')
    assert.ok(result.markdown.includes('触发方式：自动'))
    assert.ok(fs.existsSync(result.path))
  })

  it('拒绝 dataRoot 外的 projectDir', async () => {
    const dataRoot = makeDataRoot('gen-outside')
    const svc = new DailyReportService(dataRoot)
    const outside = path.join(os.tmpdir(), 'outside-proj')
    await assert.rejects(() => svc.generate({ projectDir: outside }, 'manual'), /不在 dataRoot 内/)
  })

  it('list/read 往返：生成后可通过 list 与 read 取回', async () => {
    const dataRoot = makeDataRoot('gen-listread')
    const projectDir = makeProject(dataRoot, 'lr-proj')
    createExp(dataRoot, projectDir, 'lr-exp')
    const svc = new DailyReportService(dataRoot)
    const r1 = await svc.generate({ projectDir }, 'manual')
    const r2 = await svc.generate({ projectDir }, 'manual')
    const listed = svc.list()
    assert.ok(listed.length >= 2)
    assert.ok(listed.some((e) => e.reportId === r1.reportId))
    assert.ok(listed.some((e) => e.reportId === r2.reportId))
    // 按 generatedAt 倒序
    for (let i = 1; i < listed.length; i++) assert.ok(listed[i - 1]!.generatedAt >= listed[i]!.generatedAt)
    const read = svc.read(r1.reportId)
    assert.ok(read !== null)
    assert.equal(read!.markdown, r1.markdown)
    assert.equal(svc.read('not-exist-xxxx'), null)
    // trigger 推断
    const manualEntry = listed.find((e) => e.reportId === r1.reportId)!
    assert.equal(manualEntry.trigger, 'manual')
  })

  it('llm=true 时失败回退到模板（不抛错）', async () => {
    const dataRoot = makeDataRoot('gen-llm')
    const projectDir = makeProject(dataRoot, 'llm-proj')
    createExp(dataRoot, projectDir, 'llm-exp')
    const svc = new DailyReportService(dataRoot)
    const result = await svc.generate({ projectDir, llm: true }, 'manual')
    assert.ok(result.markdown.includes('# 实验日报'))
  })

  it('今日更新计数：当天创建的实验计入 todayUpdated', async () => {
    const dataRoot = makeDataRoot('gen-today')
    const projectDir = makeProject(dataRoot, 'today-proj')
    createExp(dataRoot, projectDir, 'today-exp')
    const svc = new DailyReportService(dataRoot)
    const result = await svc.generate({ projectDir }, 'manual')
    // 刚创建的实验 updatedAt 接近 now，todayUpdated 应为 1
    assert.ok(result.markdown.includes('1 个今天有更新') || result.markdown.includes('1 个今天有更新。') || result.markdown.includes('共 1 个实验，1 个今天有更新'))
  })
})

// ── scheduler ─────────────────────────────────────────────────────────────

describe('DailyReportService scheduler', () => {
  it('初始 getSchedule 为 null，toggle 无配置时返回 disabled', () => {
    const dataRoot = makeDataRoot('sched-init')
    const svc = new DailyReportService(dataRoot)
    assert.equal(svc.getSchedule(), null)
    const toggled = svc.toggle()
    assert.equal(toggled.enabled, false)
  })

  it('setSchedule interval：校验并计算 nextRunAt，持久化', () => {
    const dataRoot = makeDataRoot('sched-interval')
    const projectDir = makeProject(dataRoot, 'sched-proj')
    const svc = new DailyReportService(dataRoot)
    const ret = svc.setSchedule({ enabled: true, mode: 'interval', intervalMinutes: 5, projectDir })
    assert.equal(ret.ok, true)
    assert.ok(typeof ret.nextRunAt === 'number' && ret.nextRunAt !== null)
    const stored = svc.getSchedule()!
    assert.equal(stored.mode, 'interval')
    assert.equal(stored.intervalMinutes, 5)
    assert.equal(stored.projectDir, path.resolve(projectDir))
    assert.equal(stored.cron, undefined)
    // 持久化：新实例能读回（JSON 省略 undefined，需按字段比对）
    const svc2 = new DailyReportService(dataRoot)
    const loaded = svc2.getSchedule()!
    assert.equal(loaded.mode, stored.mode)
    assert.equal(loaded.intervalMinutes, stored.intervalMinutes)
    assert.equal(loaded.projectDir, stored.projectDir)
    assert.equal(loaded.nextRunAt, stored.nextRunAt)
  })

  it('setSchedule interval 使用 lastRunAt 计算 next', () => {
    const dataRoot = makeDataRoot('sched-interval-last')
    const projectDir = makeProject(dataRoot, 'interval-last')
    const svc = new DailyReportService(dataRoot)
    const base = Date.now()
    svc.setSchedule({ enabled: true, mode: 'interval', intervalMinutes: 10, projectDir, lastRunAt: base })
    const s = svc.getSchedule()!
    // next = lastRunAt + 10*60000
    assert.equal(s.nextRunAt, base + 10 * 60_000)
  })

  it('setSchedule cron：daily/weekly 解析并计算 nextRunAt', () => {
    const dataRoot = makeDataRoot('sched-cron')
    const projectDir = makeProject(dataRoot, 'cron-proj')
    const svc = new DailyReportService(dataRoot)
    const daily = svc.setSchedule({ enabled: true, mode: 'daily', cron: '0 9 * * *', projectDir })
    assert.equal(daily.ok, true)
    assert.ok(daily.nextRunAt !== null)
    const weekly = svc.setSchedule({ enabled: true, mode: 'weekly', cron: '30 8 * * 1', projectDir })
    assert.equal(weekly.ok, true)
    assert.ok(weekly.nextRunAt !== null)
  })

  it('setSchedule 校验：非法 interval / cron / mode 抛错', () => {
    const dataRoot = makeDataRoot('sched-invalid')
    const projectDir = makeProject(dataRoot, 'invalid-proj')
    const svc = new DailyReportService(dataRoot)
    assert.throws(() => svc.setSchedule({ enabled: true, mode: 'interval', intervalMinutes: 0, projectDir }), /intervalMinutes/)
    assert.throws(() => svc.setSchedule({ enabled: true, mode: 'interval', intervalMinutes: -1, projectDir }), /intervalMinutes/)
    assert.throws(() => svc.setSchedule({ enabled: true, mode: 'daily', cron: '', projectDir }), /cron 不能为空/)
    assert.throws(() => svc.setSchedule({ enabled: true, mode: 'daily', cron: 'bad cron', projectDir }), /cron 表达式/)
    assert.throws(() => svc.setSchedule({ enabled: true, mode: 'weekly', cron: '60 * * * *', projectDir }), /越界/)
    assert.throws(() => svc.setSchedule({ enabled: true, mode: 'interval', intervalMinutes: 5, projectDir: '' }), /projectDir 不能为空/)
  })

  it('toggle 切换开关并更新 nextRunAt', () => {
    const dataRoot = makeDataRoot('sched-toggle')
    const projectDir = makeProject(dataRoot, 'toggle-proj')
    const svc = new DailyReportService(dataRoot)
    svc.setSchedule({ enabled: true, mode: 'interval', intervalMinutes: 15, projectDir })
    assert.equal(svc.getSchedule()!.enabled, true)
    const off = svc.toggle()
    assert.equal(off.enabled, false)
    assert.equal(svc.getSchedule()!.enabled, false)
    const on = svc.toggle()
    assert.equal(on.enabled, true)
    assert.equal(svc.getSchedule()!.enabled, true)
    // force 参数
    svc.toggle(false)
    assert.equal(svc.getSchedule()!.enabled, false)
    svc.toggle(true)
    assert.equal(svc.getSchedule()!.enabled, true)
  })

  it('slugs 随调度持久化', () => {
    const dataRoot = makeDataRoot('sched-slugs')
    const projectDir = makeProject(dataRoot, 'slugs-proj')
    const svc = new DailyReportService(dataRoot)
    svc.setSchedule({ enabled: true, mode: 'interval', intervalMinutes: 7, projectDir, slugs: ['a', 'b'] })
    assert.deepEqual(svc.getSchedule()!.slugs, ['a', 'b'])
    const svc2 = new DailyReportService(dataRoot)
    assert.deepEqual(svc2.getSchedule()!.slugs, ['a', 'b'])
  })
})

// ── cron 解析（通过 DailyReportService 与直接 parseCron/nextRun） ───────────

describe('DailyReportService cron 解析', () => {
  it('parseCron 标准与步长', () => {
    const s = parseCron('*/15 * * * *')
    assert.ok(s.minutes.has(0) && s.minutes.has(15) && s.minutes.has(30))
    assert.ok(!s.minutes.has(10))
  })

  it('parseCron 非法抛错', () => {
    assert.throws(() => parseCron('0 9 * *'))
    assert.throws(() => parseCron('60 * * * *'))
  })

  it('nextRun 每分钟', () => {
    const from = new Date('2026-08-10T10:00:30')
    const next = nextRun(parseCron('* * * * *'), from)
    assert.equal(next!.getMinutes(), 1)
    assert.ok(next!.getTime() > from.getTime())
  })

  it('nextRun 每日 9:00 工作日语义', () => {
    const from = new Date('2026-08-10T08:30:00') // 周一
    const next = nextRun(parseCron('0 9 * * 1-5'), from)
    assert.equal(next!.getHours(), 9)
    assert.equal(next!.getMinutes(), 0)
    // 周六跳到周一
    const sat = new Date('2026-08-15T08:30:00')
    const monday = nextRun(parseCron('0 9 * * 1-5'), sat)
    assert.equal(monday!.getDay(), 1)
  })

  it('setSchedule cron 无效时 nextRunAt 为 null 不崩', () => {
    // 通过 daily-report 的 computeNextRun 间接：cron 为 2月30日 永远不命中 → nextRun 返回 null → nextRunAt 为 undefined → 返回 null
    const dataRoot = makeDataRoot('cron-never')
    const projectDir = makeProject(dataRoot, 'never-proj')
    const svc = new DailyReportService(dataRoot)
    const ret = svc.setSchedule({ enabled: true, mode: 'daily', cron: '0 0 30 2 *', projectDir })
    assert.equal(ret.ok, true)
    assert.equal(ret.nextRunAt, null)
  })

  it('interval 0 被上层校验拦截，不会落入 computeNextRun', () => {
    const dataRoot = makeDataRoot('cron-zero')
    const projectDir = makeProject(dataRoot, 'zero-proj')
    const svc = new DailyReportService(dataRoot)
    assert.throws(() => svc.setSchedule({ enabled: true, mode: 'interval', intervalMinutes: 0, projectDir }))
  })
})

// ── attach / tick ─────────────────────────────────────────────────────────

describe('DailyReportService attach/tick', () => {
  it('attach 注册 timer.interval，tick 到点自动生成', async () => {
    const dataRoot = makeDataRoot('attach-tick')
    const projectDir = makeProject(dataRoot, 'attach-proj')
    createExp(dataRoot, projectDir, 'attach-exp')
    const svc = new DailyReportService(dataRoot)
    // 调度设为 1 分钟前已到期
    const past = Date.now() - 2 * 60_000
    svc.setSchedule({ enabled: true, mode: 'interval', intervalMinutes: 1, projectDir, lastRunAt: past })
    // 调整 nextRunAt 为过去，保证 tick 立即触发
    const sched = svc.getSchedule()!
    sched.nextRunAt = Date.now() - 1000
    // 持久化调整后的 nextRunAt（直接写文件最简单：重设）
    ;(svc as unknown as { save: () => void }).save()

    let tickFn: (() => void) | null = null
    let disposeCalled = false
    const fakeTimer = {
      interval: (fn: () => void, ms: number) => {
        assert.equal(ms, 60_000)
        tickFn = fn
        return () => { disposeCalled = true }
      },
    }
    const fakeCtx = { get: (name: string) => (name === 'timer' ? fakeTimer : undefined) } as unknown as import('@deepseek-ai/cordis').Context

    const dispose = svc.attach(fakeCtx)
    assert.ok(typeof tickFn === 'function')
    // 触发 tick（异步 generate）
    tickFn!()
    // 等待自动生成落盘（tick 内 await generate + save）
    await new Promise((r) => setTimeout(r, 800))
    const listed = svc.list()
    assert.ok(listed.length >= 1)
    assert.ok(listed.some((e) => e.trigger === 'auto'))
    // 重复 attach 未 dispose 时应返回同一 disposer，不重复注册
    let secondCalls = 0
    const fakeTimer2 = {
      interval: () => { secondCalls += 1; return () => {} },
    }
    const ctx2 = { get: (n: string) => (n === 'timer' ? fakeTimer2 : undefined) } as unknown as import('@deepseek-ai/cordis').Context
    svc.attach(ctx2)
    assert.equal(secondCalls, 0)
    // dispose 语义
    dispose()
    assert.equal(disposeCalled, true)
  })

  it('disabled 调度 tick 不生成', async () => {
    const dataRoot = makeDataRoot('attach-disabled')
    const projectDir = makeProject(dataRoot, 'disabled-proj')
    createExp(dataRoot, projectDir, 'dis-exp')
    const svc = new DailyReportService(dataRoot)
    svc.setSchedule({ enabled: false, mode: 'interval', intervalMinutes: 1, projectDir, lastRunAt: Date.now() - 10_000 })
    const sched = svc.getSchedule()!
    sched.nextRunAt = Date.now() - 1000
    ;(svc as unknown as { save: () => void }).save()

    let tickFn: (() => void) | null = null
    const fakeTimer = { interval: (fn: () => void) => { tickFn = fn; return () => {} } }
    const fakeCtx = { get: (n: string) => (n === 'timer' ? fakeTimer : undefined) } as unknown as import('@deepseek-ai/cordis').Context
    svc.attach(fakeCtx)
    tickFn!()
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(svc.list().length, 0)
  })

  it('无 timer 服务时 attach 返回空函数不崩', () => {
    const dataRoot = makeDataRoot('attach-notimer')
    const svc = new DailyReportService(dataRoot)
    const ctx = { get: () => undefined } as unknown as import('@deepseek-ai/cordis').Context
    const dispose = svc.attach(ctx)
    assert.equal(typeof dispose, 'function')
    dispose()
  })
})
