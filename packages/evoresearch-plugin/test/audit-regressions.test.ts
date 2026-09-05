/**
 * 审计修复回归测试（2026-09 清单核验战役）：
 * 锁定四轮修复中曾被判 P0/P1 的关键行为，防止回归：
 * - RewindService.restoreWorkspace：clean -fd 保留忽略文件（.evoresearch-data/.venv）；
 *   安全提交真实失败时中止回溯（而非当"无变更"继续清场）；
 * - JobHubService.cancel：先调注册的 cancel() 真正终止，再走完结流转（修复"假取消"）；
 * - SchedulerService.tick：新任务从 createdAt 起算（修复从 epoch 起算恒立即触发）；
 * - ExperimentRounds.cancel：只清未完成阶段产物，done 产物保留（修复整目录连带删除）。
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawnSync } from 'node:child_process'
import { RewindService } from '../src/host/rewind.js'
import { JobHubService } from '../src/host/jobs.js'
import { SchedulerService } from '../src/host/scheduler.js'
import { ExperimentRoundsService } from '../src/host/experiment-rounds.js'
import { ExperimentWorkspaceService } from '../src/host/experiment-workspace.js'

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-audit-regress-'))
after(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true })
})

function git(cwd: string, args: string[]): void {
  const bin = process.platform === 'win32' ? 'git.exe' : 'git'
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败: ${(r.stderr ?? '').trim()}`)
}

function makeGitProject(tag: string): { dataRoot: string; projectDir: string; rewind: RewindService } {
  const dataRoot = fs.mkdtempSync(path.join(TMP_ROOT, `${tag}-`))
  const projectDir = path.join(dataRoot, 'project')
  fs.mkdirSync(projectDir, { recursive: true })
  git(projectDir, ['init'])
  git(projectDir, ['config', 'user.name', 'test'])
  git(projectDir, ['config', 'user.email', 'test@localhost'])
  return { dataRoot, projectDir, rewind: new RewindService(dataRoot) }
}

describe('审计回归：RewindService（P0-2 clean -fdx 误删项目数据）', () => {
  it('restoreWorkspace 保留忽略文件（.evoresearch-data/.venv）：clean 不带 -x', () => {
    const { projectDir, rewind } = makeGitProject('rw-keep')
    fs.writeFileSync(path.join(projectDir, 'tracked.txt'), 'v1')
    const dataDir = path.join(projectDir, '.evoresearch-data')
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'research_memory.db'), 'db-bytes')
    fs.mkdirSync(path.join(projectDir, '.venv'), { recursive: true })
    fs.writeFileSync(path.join(projectDir, '.venv', 'pyvenv.cfg'), 'venv')
    fs.writeFileSync(path.join(projectDir, '.gitignore'), '.venv/\n')
    rewind.commitWorkspace(projectDir, 'auto-turn 0')

    fs.writeFileSync(path.join(projectDir, 'tracked.txt'), 'v2')
    const base = rewind.workspaceLog(projectDir, 10).find((c) => c.message === 'auto-turn 0')
    assert.ok(base, '应有 auto-turn 0 提交')
    rewind.restoreWorkspace(projectDir, base!.sha)
    assert.equal(fs.readFileSync(path.join(projectDir, 'tracked.txt'), 'utf8'), 'v1', '已跟踪文件回退到基线')
    assert.equal(fs.readFileSync(path.join(dataDir, 'research_memory.db'), 'utf8'), 'db-bytes', '项目私有数据必须保留')
    assert.equal(fs.readFileSync(path.join(projectDir, '.venv', 'pyvenv.cfg'), 'utf8'), 'venv', 'venv 必须保留')
  })

  it('safety 提交真实失败时中止回溯（不再当"无变更"继续清场）', () => {
    const { projectDir, rewind } = makeGitProject('rw-abort')
    fs.writeFileSync(path.join(projectDir, 'a.txt'), 'init')
    rewind.commitWorkspace(projectDir, 'auto-turn 0')
    fs.writeFileSync(path.join(projectDir, 'b.txt'), 'uncommitted-change')
    // 制造真实失败：index.lock 被占用 → git add/commit 均无法进行
    fs.writeFileSync(path.join(projectDir, '.git', 'index.lock'), 'locked')
    assert.throws(
      () => rewind.restoreWorkspace(projectDir, rewind.workspaceLog(projectDir, 10)[0]!.sha),
      /安全提交失败|git add 失败/,
      'safety 提交失败必须抛错中止，而不是继续 restore+clean',
    )
    assert.equal(fs.readFileSync(path.join(projectDir, 'b.txt'), 'utf8'), 'uncommitted-change', '工作区未被清场')
  })
})

describe('审计回归：JobHubService.cancel（P1 假取消）', () => {
  it('先调注册的 cancel() 真正终止，再走完结流转', async () => {
    const hub = new JobHubService()
    let terminated = 0
    const job = hub.register({
      kind: 'experiment',
      label: '长跑实验',
      cancel: () => { terminated += 1 },
    })
    assert.equal(await hub.cancel(job.jobId), true)
    assert.equal(terminated, 1, '注册的 cancel() 必须被调用（真终止）')
    assert.equal(hub.get(job.jobId)?.status, 'cancelled')
  })

  it('无 cancel 实现退化为完结流转；未知 id 返回 false', async () => {
    const hub = new JobHubService()
    const job = hub.register({ kind: 'scheduled', label: '无 cancel 实现' })
    assert.equal(await hub.cancel(job.jobId), true)
    assert.equal(hub.get(job.jobId)?.status, 'cancelled')
    assert.equal(await hub.cancel('nope-12345678'), false)
  })
})

describe('审计回归：SchedulerService 新任务从 createdAt 起算（P1 立即触发）', () => {
  it('「每天9点」任务在任意时刻添加后首个 tick 不立即触发', async () => {
    const dataRoot = fs.mkdtempSync(path.join(TMP_ROOT, 'sched-'))
    const svc = new SchedulerService({ dataRoot })
    svc.add({ name: 'daily', cron: '0 9 * * *', prompt: 'p', workspaceDir: dataRoot })
    assert.equal(svc.list()[0]!.lastRunAt, undefined, '新任务未运行')
    const tick = (): Promise<void> => (svc as unknown as { tick(ctx: unknown): Promise<void> }).tick({ get: () => undefined })
    await tick()
    // 若回归为 epoch 起算：任务被误判到期 → runTask 拒绝（无 agents）→ catch 推进 lastRunAt → 本断言失败
    assert.equal(svc.list()[0]!.lastRunAt, undefined, 'createdAt 起算：未到 cron 命中点不得触发')
    await Promise.all([tick(), tick()])
    assert.equal(svc.list()[0]!.lastRunAt, undefined, '在飞守卫：并发 tick 不重复触发')
  })
})

describe('审计回归：ExperimentRounds.cancel 保留 done 产物', () => {
  it('cancel 只清未完成阶段产物，done 产物与 filesDeleted 标记正确', () => {
    const dataRoot = fs.mkdtempSync(path.join(TMP_ROOT, 'rounds-'))
    const svc = new ExperimentRoundsService(dataRoot)
    const projectDir = path.join(dataRoot, 'projects', 'demo')
    fs.mkdirSync(projectDir, { recursive: true })
    // rounds.start 依赖实验工作区已存在（listDetail 校验）
    new ExperimentWorkspaceService({ dataRoot: dataRoot }).createWorkspace(projectDir, 'demo')
    svc.start(projectDir, 'demo')
    const roundDir = path.join(projectDir, 'experiments', 'demo', 'rounds', 'round-1')
    const observeFile = path.join(roundDir, 'observe.md')
    assert.ok(fs.existsSync(observeFile), 'observe 模板应已写入')
    svc.completePhase(projectDir, 'demo', 'observe', '观察结论：基线正常')
    assert.ok(fs.existsSync(observeFile), 'done 产物在取消前存在')
    svc.cancel(projectDir, 'demo')
    assert.ok(fs.existsSync(observeFile), 'done 阶段产物必须保留（留痕证据）')
    // 未启动（pending）阶段产物已清（当前 running 阶段的半成品按实现保留，无害）
    assert.ok(!fs.existsSync(path.join(roundDir, 'act.md')), 'act 未启动产物已清')
    assert.ok(!fs.existsSync(path.join(roundDir, 'reflect.md')), 'reflect 未启动产物已清')
    const cancelled = svc.log(projectDir, 'demo').find((r) => r.status === 'cancelled')
    assert.ok(cancelled, '取消回合入历史')
    assert.equal(cancelled!.filesDeleted, true)
  })
})
