/**
 * 实验账本单元测试（A.6）：覆盖 init/trial/log/restore/export/rejectAndRestore + disciplina 2/4
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawnSync } from 'node:child_process'
import { ExperimentLedgerService } from '../src/host/experiment-ledger.js'
import { slugifyProjectName } from '../src/host/core/paths.js'

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'evoresearch-ledger-'))
after(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true })
})

function makeProject(name: string): { dataRoot: string; projectDir: string } {
  const base = fs.mkdtempSync(path.join(TMP_ROOT, `${name}-`))
  const dataRoot = path.join(base, 'data')
  const projectDir = path.join(base, 'proj')
  fs.mkdirSync(dataRoot, { recursive: true })
  fs.mkdirSync(path.join(projectDir, 'experiments'), { recursive: true })
  return { dataRoot, projectDir }
}

function gitConfig(repo: string, key: string): string {
  const r = spawnSync('git.exe', ['--git-dir=' + repo, 'config', '--get', key], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) {
    const r2 = spawnSync('git', ['--git-dir=' + repo, 'config', '--get', key], { encoding: 'utf8', windowsHide: true })
    return (r2.stdout ?? '').trim()
  }
  return (r.stdout ?? '').trim()
}

describe('ExperimentLedgerService (A.6)', () => {
  it('init 首次 commit 存在', () => {
    const { dataRoot, projectDir } = makeProject('init')
    const svc = new ExperimentLedgerService(dataRoot)
    const result = svc.init(projectDir, 'demo')
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.match(result.sha, /^[0-9a-f]{40}$/)
    const log = svc.log(projectDir, 'demo')
    assert.equal(log.length, 1)
    assert.match(log[0]!.message, /ledger init/)
    // provenance.json 已创建
    assert.ok(fs.existsSync(path.join(projectDir, 'experiments', 'demo', 'provenance.json')))
  })

  it('trial 无改动也能产生 commit（--allow-empty 生效，纪律 2）', () => {
    const { dataRoot, projectDir } = makeProject('allow-empty')
    const svc = new ExperimentLedgerService(dataRoot)
    svc.init(projectDir, 'demo')
    const r1 = svc.trial(projectDir, 'demo', { kind: 'manual', note: 'first', createdAt: Date.now() })
    assert.equal(r1.ok, true)
    const r2 = svc.trial(projectDir, 'demo', { kind: 'manual', note: 'second no change', createdAt: Date.now() })
    assert.equal(r2.ok, true)
    assert.notEqual(r1.ok && r1.sha, r2.ok && r2.sha)
    const log = svc.log(projectDir, 'demo')
    assert.equal(log.length, 3) // init + 2 manual
  })

  it('log 倒序正确', () => {
    const { dataRoot, projectDir } = makeProject('log-order')
    const svc = new ExperimentLedgerService(dataRoot)
    svc.init(projectDir, 'demo')
    svc.trial(projectDir, 'demo', { kind: 'manual', note: 'a', createdAt: Date.now() })
    svc.trial(projectDir, 'demo', { kind: 'checkpoint', note: 'b', createdAt: Date.now() })
    svc.trial(projectDir, 'demo', { kind: 'run', note: 'c', createdAt: Date.now() })
    const log = svc.log(projectDir, 'demo')
    assert.equal(log[0]!.kind, 'run')
    assert.equal(log[1]!.kind, 'checkpoint')
    assert.equal(log[2]!.kind, 'manual')
    assert.equal(log[log.length - 1]!.message.includes('ledger init'), true)
    // limit
    assert.equal(svc.log(projectDir, 'demo', 2).length, 2)
  })

  it('restore 回退文件且不破坏后续 commit（非破坏式）', () => {
    const { dataRoot, projectDir } = makeProject('restore')
    const svc = new ExperimentLedgerService(dataRoot)
    svc.init(projectDir, 'demo')
    const expDir = path.join(projectDir, 'experiments', 'demo')
    // trial 1: create file A
    fs.writeFileSync(path.join(expDir, 'a.txt'), 'v1', 'utf8')
    const r1 = svc.trial(projectDir, 'demo', { kind: 'checkpoint', note: 'add a v1', createdAt: Date.now() })
    assert.equal(r1.ok, true)
    const shaV1 = r1.ok ? r1.sha : ''
    // trial 2: modify file
    fs.writeFileSync(path.join(expDir, 'a.txt'), 'v2', 'utf8')
    const r2 = svc.trial(projectDir, 'demo', { kind: 'checkpoint', note: 'a v2', createdAt: Date.now() })
    assert.equal(r2.ok, true)
    // restore to v1
    const restored = svc.restore(projectDir, 'demo', shaV1)
    assert.equal(restored.ok, true)
    assert.equal(fs.readFileSync(path.join(expDir, 'a.txt'), 'utf8'), 'v1')
    // log 仍保留 v2 的提交（非破坏式）
    const log = svc.log(projectDir, 'demo')
    assert.ok(log.some((c) => c.sha === (r2.ok ? r2.sha : '')))
  })

  it('export 出的仓库 git log 完整', () => {
    const { dataRoot, projectDir } = makeProject('export')
    const svc = new ExperimentLedgerService(dataRoot)
    svc.init(projectDir, 'demo')
    svc.trial(projectDir, 'demo', { kind: 'manual', note: 'm1', createdAt: Date.now() })
    svc.trial(projectDir, 'demo', { kind: 'run', note: 'run1', createdAt: Date.now() })
    const ledgerLog = svc.log(projectDir, 'demo')
    const dest = path.join(projectDir, 'cloned-export')
    const exp = svc.export(projectDir, 'demo', dest)
    assert.equal(exp.ok, true)
    // cloned repo log
    const out = spawnSync('git.exe', ['log', '--format=%H', '-n', '10'], { cwd: dest, encoding: 'utf8', windowsHide: true })
    const stdout = out.status === 0 ? out.stdout : spawnSync('git', ['log', '--format=%H', '-n', '10'], { cwd: dest, encoding: 'utf8', windowsHide: true }).stdout
    const shas = (stdout ?? '').trim().split('\n').filter(Boolean)
    assert.equal(shas.length, ledgerLog.length)
    // 每个 sha 都能在原账本找到
    for (const sha of shas) {
      assert.ok(ledgerLog.some((c) => c.sha === sha))
    }
  })

  it('rejectAndRestore 先留痕再回滚', () => {
    const { dataRoot, projectDir } = makeProject('reject')
    const svc = new ExperimentLedgerService(dataRoot)
    svc.init(projectDir, 'demo')
    const expDir = path.join(projectDir, 'experiments', 'demo')
    fs.writeFileSync(path.join(expDir, 'keep.txt'), 'keep', 'utf8')
    svc.trial(projectDir, 'demo', { kind: 'manual', note: 'baseline', createdAt: Date.now() })
    const baselineSha = svc.log(projectDir, 'demo')[0]!.sha
    // 创建一个会被否决的改动
    fs.writeFileSync(path.join(expDir, 'bad.txt'), 'bad', 'utf8')
    const result = svc.rejectAndRestore(projectDir, 'demo', { note: 'bad try rejected', state: { phase: 'rejected' } })
    assert.equal(result.ok, true)
    if (!result.ok) return
    // bad.txt 已被 clean 掉
    assert.equal(fs.existsSync(path.join(expDir, 'bad.txt')), false)
    // 历史里有 rejected 提交
    const log = svc.log(projectDir, 'demo')
    assert.ok(log.some((c) => c.message.includes('rejected') && c.sha === result.rejectedSha))
    // 当前工作区恢复到 baseline 之前的逻辑？至少不在 rejected 之后，且 keep.txt 仍在
    assert.ok(fs.existsSync(path.join(expDir, 'keep.txt')))
    // restore 后的 log 仍能看到 rejected 前的提交
    assert.ok(log.some((c) => c.sha === baselineSha))
  })

  it('excludesFile 已设为 /dev/null（纪律 4）', () => {
    const { dataRoot, projectDir } = makeProject('excludes')
    const svc = new ExperimentLedgerService(dataRoot)
    svc.init(projectDir, 'demo')
    const sanitized = slugifyProjectName(path.basename(path.resolve(projectDir)))
    const repo = path.join(dataRoot, '.evoresearch-data', 'ledgers', sanitized, 'demo.git')
    assert.equal(gitConfig(repo, 'core.excludesFile'), '/dev/null')
    // 额外验证：即使 .gitignore 忽略某文件，-f 仍能提交（通过 trial 不抛错验证）
    const expDir = path.join(projectDir, 'experiments', 'demo')
    fs.writeFileSync(path.join(expDir, '.gitignore'), '*.ignored\n', 'utf8')
    fs.writeFileSync(path.join(expDir, 'should.ignored'), 'data', 'utf8')
    const r = svc.trial(projectDir, 'demo', { kind: 'manual', note: 'ignore test', createdAt: Date.now() })
    assert.equal(r.ok, true)
    // 检查该文件确实在账本历史中（show 能取出）
    const check = spawnSync('git.exe', ['--git-dir=' + repo, '--work-tree=' + expDir, 'show', r.ok ? `${r.sha}:should.ignored` : 'HEAD:should.ignored'], { encoding: 'utf8', windowsHide: true })
    const content = check.status === 0 ? check.stdout : spawnSync('git', ['--git-dir=' + repo, '--work-tree=' + expDir, 'show', r.ok ? `${r.sha}:should.ignored` : 'HEAD:should.ignored'], { encoding: 'utf8', windowsHide: true }).stdout
    assert.match((content ?? ''), /data/)
  })

  it('recentState 读取最近 N 个提交里保存的状态（纪律 5）', () => {
    const { dataRoot, projectDir } = makeProject('recent')
    const svc = new ExperimentLedgerService(dataRoot)
    svc.init(projectDir, 'demo')
    const state1 = { phase: 'observe', data: 1 }
    svc.trial(projectDir, 'demo', { kind: 'run', note: 's1', state: state1, createdAt: Date.now() })
    const state2 = { phase: 'act', data: 2 }
    svc.trial(projectDir, 'demo', { kind: 'run', note: 's2', state: state2, createdAt: Date.now() })
    const recent = svc.recentState(projectDir, 'demo')
    assert.deepEqual(recent, state2)
    // n=2 也能取到
    assert.deepEqual(svc.recentState(projectDir, 'demo', 5), state2)
  })

  it('overwrite 重建账本', () => {
    const { dataRoot, projectDir } = makeProject('overwrite')
    const svc = new ExperimentLedgerService(dataRoot)
    const r1 = svc.init(projectDir, 'demo')
    assert.equal(r1.ok, true)
    const dup = svc.init(projectDir, 'demo')
    assert.equal(dup.ok, false)
    const r2 = svc.init(projectDir, 'demo', { overwrite: true })
    assert.equal(r2.ok, true)
    assert.notEqual(r1.ok && r1.sha, r2.ok && r2.sha)
    assert.equal(svc.log(projectDir, 'demo').length, 1)
  })
})
