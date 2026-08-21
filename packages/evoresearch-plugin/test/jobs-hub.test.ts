/**
 * P0-3 JobHub 后台活动注册表测试（纯内存，无文件/无真实数据根）。
 *
 * 覆盖：注册与完结流转、list 过滤与排序、环形历史上限（cap 100）、
 * cancelBySession（cancel 调用 + 计数 + 单个抛错不阻断）、dispose 清空。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { JobHubService } from '../src/host/jobs.js'

describe('JobHubService 注册与完结流转', () => {
  it('register 返回 running 快照副本，jobId 带 kind 前缀', () => {
    const hub = new JobHubService()
    const job = hub.register({ kind: 'subagent', label: '文献调研子代理', sessionId: 's1' })
    assert.ok(job.jobId.startsWith('subagent-'))
    assert.equal(job.kind, 'subagent')
    assert.equal(job.label, '文献调研子代理')
    assert.equal(job.sessionId, 's1')
    assert.equal(job.status, 'running')
    assert.ok(Number.isFinite(job.startedAt))
    // 快照副本：改动返回值不影响内部
    job.status = 'failed'
    assert.equal(hub.get(job.jobId)?.status, 'running')
  })

  it('complete / fail / markCancelled 挪入历史并设置 finishedAt；未知 id 返回 false', () => {
    const hub = new JobHubService()
    const a = hub.register({ kind: 'scheduled', label: '日报任务' })
    const b = hub.register({ kind: 'experiment', label: '消融实验' })
    const c = hub.register({ kind: 'channel', label: 'IM 通道' })

    assert.equal(hub.complete(a.jobId, '产出日报'), true)
    assert.equal(hub.fail(b.jobId, '超时失败'), true)
    assert.equal(hub.markCancelled(c.jobId), true)
    assert.equal(hub.complete('nope-12345678'), false)

    assert.equal(hub.get(a.jobId)?.status, 'completed')
    assert.equal(hub.get(a.jobId)?.detail, '产出日报')
    assert.ok(hub.get(a.jobId)?.finishedAt !== undefined)
    assert.equal(hub.get(b.jobId)?.status, 'failed')
    assert.equal(hub.get(c.jobId)?.status, 'cancelled')
    // 完结后不在 active
    assert.equal(hub.countActive(), 0)
  })

  it('unregister 直接移除不入历史', () => {
    const hub = new JobHubService()
    const job = hub.register({ kind: 'custom', label: '临时活动' })
    assert.equal(hub.unregister(job.jobId), true)
    assert.equal(hub.unregister(job.jobId), false)
    assert.equal(hub.get(job.jobId), undefined)
    assert.equal(hub.list().length, 0)
  })
})

describe('JobHubService list 过滤与排序', () => {
  it('running 在前、组内 startedAt 降序；sessionId/kind/activeOnly 过滤生效', async () => {
    const hub = new JobHubService()
    const done = hub.register({ kind: 'subagent', label: '旧子代理', sessionId: 's1' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const run1 = hub.register({ kind: 'subagent', label: '新子代理', sessionId: 's1' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const run2 = hub.register({ kind: 'scheduled', label: '定时任务', sessionId: 's2' })
    hub.complete(done.jobId)

    // 全量：running 在前，同状态按 startedAt 降序（run2 > run1 > done）
    const all = hub.list()
    assert.deepEqual(all.map((job) => job.jobId), [run2.jobId, run1.jobId, done.jobId])

    // sessionId 过滤
    assert.deepEqual(hub.list({ sessionId: 's1' }).map((job) => job.jobId), [run1.jobId, done.jobId])
    // kind 过滤
    assert.deepEqual(hub.list({ kind: 'scheduled' }).map((job) => job.jobId), [run2.jobId])
    // activeOnly 过滤（排除完结）
    assert.deepEqual(hub.list({ activeOnly: true }).map((job) => job.jobId), [run2.jobId, run1.jobId])
    // 组合过滤
    assert.deepEqual(hub.list({ sessionId: 's1', activeOnly: true }).map((job) => job.jobId), [run1.jobId])
  })

  it('countActive 支持按会话过滤', () => {
    const hub = new JobHubService()
    const a = hub.register({ kind: 'subagent', label: 'a', sessionId: 's1' })
    hub.register({ kind: 'channel', label: 'b', sessionId: 's2' })
    hub.register({ kind: 'experiment', label: 'c', sessionId: 's1' })
    assert.equal(hub.countActive(), 3)
    assert.equal(hub.countActive('s1'), 2)
    assert.equal(hub.countActive('s9'), 0)
    hub.complete(a.jobId)
    assert.equal(hub.countActive('s1'), 1)
  })
})

describe('JobHubService 环形历史上限', () => {
  it('灌 105 条完结后只保留最近 100 条，最旧的被丢弃', () => {
    const hub = new JobHubService()
    const ids: string[] = []
    for (let i = 0; i < 105; i++) ids.push(hub.register({ kind: 'custom', label: `job-${i}` }).jobId)
    for (const id of ids) hub.complete(id)
    const history = hub.list()
    assert.equal(history.length, 100)
    // 最旧 5 条被丢（job-0..4），保留 job-5..104
    assert.equal(hub.get(ids[0]!), undefined)
    assert.equal(hub.get(ids[4]!), undefined)
    assert.equal(hub.get(ids[5]!)?.label, 'job-5')
    assert.equal(hub.get(ids[104]!)?.label, 'job-104')
  })
})

describe('JobHubService cancelBySession 与 dispose', () => {
  it('对该会话的 active 任务逐个调用 cancel 并统一标记 cancelled；计数正确且单个抛错不阻断', async () => {
    const hub = new JobHubService()
    const cancelled: string[] = []
    const okJob = hub.register({
      kind: 'subagent',
      label: '可取消',
      sessionId: 's1',
      cancel: () => { cancelled.push('ok') },
    })
    const throwingJob = hub.register({
      kind: 'scheduled',
      label: '同步抛错',
      sessionId: 's1',
      cancel: () => { throw new Error('cancel 炸了') },
    })
    const rejectingJob = hub.register({
      kind: 'experiment',
      label: 'Promise reject',
      sessionId: 's1',
      cancel: () => Promise.reject(new Error('异步取消失败')),
    })
    const otherSession = hub.register({ kind: 'channel', label: '别的会话', sessionId: 's2' })

    const attempted = await hub.cancelBySession('s1')
    assert.equal(attempted, 3) // 只算 s1 的三条
    // 抛错/reject 不阻断其余 cancel
    assert.deepEqual(cancelled, ['ok'])
    // 三条全部标记 cancelled 并入历史
    for (const job of [okJob, throwingJob, rejectingJob]) {
      assert.equal(hub.get(job.jobId)?.status, 'cancelled')
    }
    // 其他会话不受影响
    assert.equal(hub.get(otherSession.jobId)?.status, 'running')
    assert.equal(hub.countActive('s1'), 0)
    assert.equal(hub.countActive('s2'), 1)
  })

  it('dispose 尝试 cancel 全部并清空 active（不等待）', async () => {
    const hub = new JobHubService()
    let syncCancelled = false
    let asyncCancelled = false
    hub.register({ kind: 'subagent', label: '同步取消', cancel: () => { syncCancelled = true } })
    hub.register({
      kind: 'experiment',
      label: '异步取消',
      cancel: () => new Promise<void>((resolve) => setTimeout(() => { asyncCancelled = true; resolve() }, 10)),
    })
    hub.dispose()
    assert.equal(hub.countActive(), 0)
    assert.equal(syncCancelled, true)
    // 异步 cancel 已发起但不等待其完成
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(asyncCancelled, true)
  })

  it('无 cancel 实现的任务在 cancelBySession 中只计数不调用', async () => {
    const hub = new JobHubService()
    const plain = hub.register({ kind: 'channel', label: '无可取消实现', sessionId: 's3' })
    const attempted = await hub.cancelBySession('s3')
    assert.equal(attempted, 1)
    assert.equal(hub.get(plain.jobId)?.status, 'cancelled')
  })
})
