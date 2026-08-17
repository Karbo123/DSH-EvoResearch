/**
 * Git worktree 与共享 Python 环境测试（ENV-01..08）。
 *
 * 覆盖：
 * - ENV-01/02：createWorktree/listWorktrees/removeWorktree（起始 commit 记录、
 *   Windows 路径含空格、碰撞后缀、托管根外拒绝、移除不删分支、主工作区不动、
 *   无 git reset --hard——代码内根本没有该命令，测试断言主仓库 HEAD/status 不变）；
 * - ENV-03/04/05：环境指纹（OS+Python 版本+依赖文件哈希）、池目录、同指纹复用
 *   同一环境、依赖变化 → 新指纹 → 新环境（隔离）；
 * - ENV-06：legacy .venv 逻辑不动（pythonOf/envDirOf 原样返回）；
 * - ENV-07：createDerivedEnv 私有派生环境（不污染共享池）；
 * - ENV-08：双 worktree 复用 + 依赖变化隔离 + 不触碰主工作区。
 *
 * 全部 git 操作用临时仓库（mkdtemp + git init），遵守 BASE-02/t25 清理约定：
 * 测试结束清理临时目录（含异常路径的 afterEach 重试）。
 * 环境创建用注入的假 uv（不真下载 Python、不碰用户环境）。
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { WorktreeService, parseWorktreeList } from '../src/host/worktrees.js'
import { ProjectEnvService, parsePipList, type UvRunner } from '../src/host/project-env.js'

// ── 夹具 ────────────────────────────────────────────────────────────────────

let tmpRoot: string
let dataRoot: string
let projectDir: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-env-'))
  dataRoot = path.join(tmpRoot, 'data')
  projectDir = path.join(dataRoot, 'projects', 'demo')
  fs.mkdirSync(projectDir, { recursive: true })
})

afterEach(async () => {
  // Windows 下句柄释放异步：rm 失败重试几次
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

function git(project: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd: project, encoding: 'utf8', windowsHide: true, timeout: 60000 })
  return { ok: r.status === 0, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() }
}

/** 初始化带两个提交的临时 git 仓库；返回 [首个 commit, 最新 commit]。 */
function initRepo(dir: string, depContent = 'numpy\n'): [string, string] {
  fs.mkdirSync(dir, { recursive: true })
  assert.equal(git(dir, ['init', '-q']).ok, true)
  assert.equal(git(dir, ['config', 'user.email', 'test@evoresearch.local']).ok, true)
  assert.equal(git(dir, ['config', 'user.name', 'EvoResearch Test']).ok, true)
  fs.writeFileSync(path.join(dir, 'requirements.txt'), depContent, 'utf8')
  assert.equal(git(dir, ['add', '-A']).ok, true)
  assert.equal(git(dir, ['commit', '-m', 'init']).ok, true)
  const first = git(dir, ['rev-parse', 'HEAD']).stdout
  fs.writeFileSync(path.join(dir, 'notes.md'), '# 实验记录\n', 'utf8')
  assert.equal(git(dir, ['add', '-A']).ok, true)
  assert.equal(git(dir, ['commit', '-m', 'second']).ok, true)
  const latest = git(dir, ['rev-parse', 'HEAD']).stdout
  return [first, latest]
}

/** 假 uv 执行器（注入 run，不真实 spawn/下载）：venv 建占位环境，pip list 返回固定包。 */
function fakeUvRunner(): UvRunner {
  return async (_exe: string, args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> => {
    if (args[0] === 'venv') {
      const envDir = args[1]!
      fs.mkdirSync(path.join(envDir, 'Scripts'), { recursive: true })
      fs.mkdirSync(path.join(envDir, 'bin'), { recursive: true })
      fs.writeFileSync(path.join(envDir, 'Scripts', 'python.exe'), 'fake-python', 'utf8')
      fs.writeFileSync(path.join(envDir, 'bin', 'python'), 'fake-python', 'utf8')
      fs.writeFileSync(path.join(envDir, 'pyvenv.cfg'), 'home = fake\n', 'utf8')
      return { status: 0, stdout: '', stderr: '' }
    }
    if (args[0] === 'pip' && args[1] === 'list') {
      return { status: 0, stdout: 'Package   Version\n--------- -------\nnumpy     2.0.0\npandas    2.2.0\n', stderr: '' }
    }
    return { status: 0, stdout: '', stderr: '' }
  }
}

// ── ENV-01/02：worktree 服务 ────────────────────────────────────────────────

describe('parseWorktreeList', () => {
  it('porcelain 解析：路径/HEAD/分支/detached', () => {
    const out = parseWorktreeList(
      'worktree C:/repo\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/main\n\n' +
      'worktree C:/repo/.evoresearch-data/worktrees/exp-a\nHEAD 2222222222222222222222222222222222222222\nbranch refs/heads/exp-a\n\n' +
      'worktree C:/repo/.evoresearch-data/worktrees/exp-det\nHEAD 3333333333333333333333333333333333333333\ndetached\n',
    )
    assert.equal(out.length, 3)
    assert.equal(out[0]!.path, 'C:/repo')
    assert.equal(out[0]!.branch, 'main')
    assert.equal(out[1]!.branch, 'exp-a')
    assert.equal(out[2]!.detached, true)
    assert.equal(out[2]!.branch, null)
  })
})

describe('WorktreeService', () => {
  it('createWorktree：记录起始 commit、托管根内建目录、分支存在、主工作区不动', () => {
    const [first, latest] = initRepo(projectDir)
    const svc = new WorktreeService(dataRoot)
    const wt = svc.createWorktree(projectDir, { name: 'exp-a' })
    assert.ok(wt.path.startsWith(path.join(dataRoot, '.evoresearch-data', 'worktrees')), `路径 ${wt.path}`)
    assert.equal(wt.name, 'exp-a')
    assert.equal(wt.branch, 'exp-a')
    assert.equal(wt.commit, latest, '起始 commit = 最新 HEAD')
    assert.equal(fs.existsSync(wt.path), true)
    // 分支建立在仓库里
    assert.equal(git(projectDir, ['rev-parse', '--verify', 'refs/heads/exp-a']).ok, true)
    // 主工作区完全不动（ENV-02）
    assert.equal(git(projectDir, ['rev-parse', 'HEAD']).stdout, latest)
    assert.equal(git(projectDir, ['status', '--porcelain']).stdout, '')
  })

  it('createWorktree：fromCommit 指定历史 commit', () => {
    const [first] = initRepo(projectDir)
    const svc = new WorktreeService(dataRoot)
    const wt = svc.createWorktree(projectDir, { name: 'exp-old', fromCommit: first })
    assert.equal(wt.commit, first)
    assert.equal(git(wt.path, ['rev-parse', 'HEAD']).stdout, first)
  })

  it('createWorktree：Windows 路径含空格 + 名称碰撞加后缀', () => {
    // 项目路径含空格（Windows 常见坑）
    const spaced = path.join(tmpRoot, 'proj with space')
    initRepo(spaced)
    const svc = new WorktreeService(dataRoot)
    const a = svc.createWorktree(spaced, { name: 'my exp' })
    assert.equal(a.name, 'my-exp')
    assert.equal(fs.existsSync(a.path), true)
    assert.equal(svc.createWorktree(spaced, { name: 'my exp' }).name, 'my-exp-2')
  })

  it('createWorktree：纯中文名回退时间戳；非 git 项目抛错；不存在 commit 抛错', () => {
    const [, latest] = initRepo(projectDir)
    const svc = new WorktreeService(dataRoot)
    const wt = svc.createWorktree(projectDir, { name: '实验' })
    assert.match(wt.name, /^wt-[0-9a-z]+$/)
    const plain = path.join(tmpRoot, 'not-git')
    fs.mkdirSync(plain, { recursive: true })
    assert.throws(() => svc.createWorktree(plain, { name: 'x' }), /不是 git 仓库/)
    assert.throws(() => svc.createWorktree(projectDir, { name: 'x', fromCommit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }), /起始 commit 不存在/)
    assert.ok(fs.existsSync(path.join(projectDir, '.git')))
    assert.equal(git(projectDir, ['rev-parse', 'HEAD']).stdout, latest)
  })

  it('listWorktrees：托管条目含分支与 commit；外部 worktree 仅列出不标 managed', () => {
    initRepo(projectDir)
    const svc = new WorktreeService(dataRoot)
    svc.createWorktree(projectDir, { name: 'exp-a' })
    // 手工建一个仓库外的普通 worktree（模拟用户自建）
    const external = path.join(tmpRoot, 'external-wt')
    assert.equal(git(projectDir, ['worktree', 'add', '-b', 'external-br', external]).ok, true)
    const list = svc.listWorktrees(projectDir)
    const managed = list.filter((w) => w.managed)
    assert.equal(managed.length, 1)
    assert.equal(managed[0]!.name, 'exp-a')
    assert.equal(managed[0]!.branch, 'exp-a')
    assert.ok(/^[0-9a-f]{40}$/.test(managed[0]!.commit))
    const ext = list.find((w) => path.normalize(w.path) === path.normalize(external))
    assert.ok(ext !== undefined && ext.managed === false, `外部 worktree 应列出且 managed=false（git 输出为前斜杠路径，比较时需 normalize）`)
  })

  it('removeWorktree：目录清除、分支保留、主工作区不动；未知名字 ok+removed=false', () => {
    const [, latest] = initRepo(projectDir)
    const svc = new WorktreeService(dataRoot)
    const wt = svc.createWorktree(projectDir, { name: 'exp-a' })
    const result = svc.removeWorktree(projectDir, 'exp-a')
    assert.equal(result.removed, true)
    assert.equal(fs.existsSync(wt.path), false, '工作目录已删除')
    assert.equal(git(projectDir, ['rev-parse', '--verify', 'refs/heads/exp-a']).ok, true, '分支保留（可从 Chat Graph 打开）')
    assert.equal(git(projectDir, ['rev-parse', 'HEAD']).stdout, latest)
    assert.equal(git(projectDir, ['status', '--porcelain']).stdout, '')
    const again = svc.removeWorktree(projectDir, 'exp-a')
    assert.equal(again.removed, false)
  })

  it('removeWorktree：脏工作区默认拒绝，force 后移除；不删分支', () => {
    initRepo(projectDir)
    const svc = new WorktreeService(dataRoot)
    const wt = svc.createWorktree(projectDir, { name: 'exp-dirty' })
    fs.writeFileSync(path.join(wt.path, 'uncommitted.txt'), 'dirty', 'utf8')
    assert.throws(() => svc.removeWorktree(projectDir, 'exp-dirty'), /force|失败/)
    assert.equal(fs.existsSync(wt.path), true, '默认不移除脏 worktree')
    const forced = svc.removeWorktree(projectDir, 'exp-dirty', { force: true })
    assert.equal(forced.removed, true)
    assert.equal(fs.existsSync(wt.path), false)
    assert.equal(git(projectDir, ['rev-parse', '--verify', 'refs/heads/exp-dirty']).ok, true)
  })

  it('removeWorktree：托管根外路径穿越拒绝；非 git 项目抛错', () => {
    const [, latest] = initRepo(projectDir)
    const svc = new WorktreeService(dataRoot)
    assert.throws(() => svc.removeWorktree(projectDir, '../evil'), /非法的 worktree 名/)
    assert.throws(() => svc.removeWorktree(projectDir, 'a\\b'), /非法的 worktree 名/)
    const plain = path.join(tmpRoot, 'not-git-2')
    fs.mkdirSync(plain, { recursive: true })
    assert.throws(() => svc.removeWorktree(plain, 'exp-a'), /不是 git 仓库/)
    assert.equal(git(projectDir, ['rev-parse', 'HEAD']).stdout, latest)
  })

  it('ENV-08 双 worktree：两个 worktree 各自独立、主工作区全程不动', () => {
    const [, latest] = initRepo(projectDir)
    const svc = new WorktreeService(dataRoot)
    const a = svc.createWorktree(projectDir, { name: 'exp-1' })
    const b = svc.createWorktree(projectDir, { name: 'exp-2' })
    assert.notEqual(a.path, b.path)
    // 各 worktree 独立文件系统
    fs.writeFileSync(path.join(a.path, 'only-in-a.txt'), 'a', 'utf8')
    assert.equal(fs.existsSync(path.join(b.path, 'only-in-a.txt')), false)
    // 主工作区 HEAD/状态不变
    assert.equal(git(projectDir, ['rev-parse', 'HEAD']).stdout, latest)
    assert.equal(git(projectDir, ['status', '--porcelain']).stdout, '')
  })
})

// ── ENV-03..07：环境指纹与共享池 ───────────────────────────────────────────

describe('ProjectEnvService 环境指纹（ENV-03）', () => {
  it('dependencyDigests：缺失文件空串、存在文件为 sha256', () => {
    const svc = new ProjectEnvService(dataRoot)
    const d1 = svc.dependencyDigests(projectDir)
    assert.equal(d1['requirements.txt'], '')
    fs.writeFileSync(path.join(projectDir, 'requirements.txt'), 'numpy\n', 'utf8')
    const d2 = svc.dependencyDigests(projectDir)
    assert.match(d2['requirements.txt']!, /^[0-9a-f]{64}$/)
    assert.equal(d2['uv.lock'], '')
    assert.equal(d2['pyproject.toml'], '')
  })

  it('computeEnvFingerprint：同输入同指纹；平台/版本/依赖任一变化则不同', () => {
    const svc = new ProjectEnvService(dataRoot)
    const base = { platform: 'win32', arch: 'x64', pythonVersion: '3.12', digests: { 'requirements.txt': 'aa', 'uv.lock': '', 'pyproject.toml': '' } }
    const fp1 = svc.computeEnvFingerprint(base)
    assert.equal(svc.computeEnvFingerprint(base), fp1, '确定性')
    assert.notEqual(svc.computeEnvFingerprint({ ...base, platform: 'linux' }), fp1)
    assert.notEqual(svc.computeEnvFingerprint({ ...base, arch: 'arm64' }), fp1)
    assert.notEqual(svc.computeEnvFingerprint({ ...base, pythonVersion: '3.11' }), fp1)
    assert.notEqual(svc.computeEnvFingerprint({ ...base, digests: { ...base.digests, 'requirements.txt': 'bb' } }), fp1)
  })

  it('fingerprint：依赖文件内容变化 → 指纹变化；env.json 的 pythonVersion 参与', () => {
    const svc = new ProjectEnvService(dataRoot)
    fs.writeFileSync(path.join(projectDir, 'requirements.txt'), 'numpy\n', 'utf8')
    const fp1 = svc.fingerprint(projectDir)
    const fp2 = svc.fingerprint(projectDir)
    assert.equal(fp1, fp2)
    assert.match(fp1, /^[0-9a-f]{16}$/)
    fs.writeFileSync(path.join(projectDir, 'requirements.txt'), 'numpy>=2\n', 'utf8')
    assert.notEqual(svc.fingerprint(projectDir), fp1, '依赖变化 → 新指纹（ENV-05 隔离基础）')
    // pythonVersion 参与（模拟 .evoresearch-data/env.json）
    fs.mkdirSync(path.join(projectDir, '.evoresearch-data'), { recursive: true })
    fs.writeFileSync(path.join(projectDir, '.evoresearch-data', 'env.json'), JSON.stringify({ pythonVersion: '3.11' }), 'utf8')
    assert.notEqual(svc.fingerprint(projectDir), fp1)
  })

  it('poolDirOf：路径正确；非法指纹拒绝（防路径注入）', () => {
    const svc = new ProjectEnvService(dataRoot)
    const fp = '0123456789abcdef'
    assert.equal(svc.poolDirOf(fp), path.join(dataRoot, '.evoresearch-data', 'envs', fp))
    assert.throws(() => svc.poolDirOf('../../evil'), /非法的环境指纹/)
    assert.throws(() => svc.poolDirOf(''), /非法的环境指纹/)
  })
})

describe('ProjectEnvService 环境池（ENV-04/05/07）', () => {
  let svc: ProjectEnvService

  beforeEach(() => {
    svc = new ProjectEnvService(dataRoot, { uvPath: '<fake>', run: fakeUvRunner() })
  })

  it('envFor：同指纹双 worktree 复用同一环境（ENV-04/08）', async () => {
    fs.writeFileSync(path.join(projectDir, 'requirements.txt'), 'numpy\n', 'utf8')
    const fp = svc.fingerprint(projectDir)
    const poolEnv = svc.poolDirOf(fp)
    assert.equal(fs.existsSync(svc.pythonOf(poolEnv)), false, '创建前无环境')
    const first = await svc.envFor(projectDir)
    assert.equal(first.fingerprint, fp)
    assert.equal(first.created, true)
    assert.equal(fs.existsSync(svc.pythonOf(poolEnv)), true, '假 uv 已建环境')
    // 同指纹第二次 → 复用（created=false，同一目录）
    const second = await svc.envFor(projectDir)
    assert.equal(second.created, false)
    assert.equal(second.envDir, first.envDir)
    // 模拟第二个 worktree：复制依赖文件到另一目录（同指纹）
    const wt2 = path.join(dataRoot, 'projects', 'demo', 'experiments', 'wt2')
    fs.mkdirSync(wt2, { recursive: true })
    fs.writeFileSync(path.join(wt2, 'requirements.txt'), 'numpy\n', 'utf8')
    const wt2Env = await svc.envFor(wt2)
    assert.equal(wt2Env.envDir, first.envDir, '同依赖 worktree 复用同一共享环境')
    // 池列表可见
    const list = svc.poolList()
    assert.ok(list.some((e) => e.fingerprint === fp && e.exists))
  })

  it('envFor：依赖变化 → 新指纹 → 新环境；旧环境保留（ENV-05）', async () => {
    fs.writeFileSync(path.join(projectDir, 'requirements.txt'), 'numpy\n', 'utf8')
    const envA = await svc.envFor(projectDir)
    fs.writeFileSync(path.join(projectDir, 'requirements.txt'), 'numpy>=2\npandas\n', 'utf8')
    const fpB = svc.fingerprint(projectDir)
    assert.notEqual(fpB, envA.fingerprint)
    const envB = await svc.envFor(projectDir)
    assert.equal(envB.created, true)
    assert.notEqual(envB.envDir, envA.envDir)
    // 旧环境仍存在（旧实验/旧 worktree 仍可用）
    assert.equal(fs.existsSync(svc.pythonOf(envA.envDir)), true)
    assert.equal(svc.poolList().length, 2)
  })

  it('createDerivedEnv：私有派生环境不污染共享池（ENV-07）', async () => {
    fs.writeFileSync(path.join(projectDir, 'requirements.txt'), 'numpy\n', 'utf8')
    const pool = await svc.envFor(projectDir)
    // 快照共享池目录（派生前后应完全一致）
    const snapshot = (dir: string): string => JSON.stringify(
      fs.readdirSync(dir, { recursive: true }).sort().map((f) => {
        const full = path.join(dir, f)
        return `${f}:${fs.statSync(full).isFile() ? fs.readFileSync(full, 'utf8') : ''}`
      }),
    )
    const before = snapshot(pool.envDir)
    // 派生环境（模拟 worktree 私有 .venv）
    const derived = await svc.createDerivedEnv(projectDir, {
      targetDir: path.join(projectDir, 'experiments', 'wt-private', '.venv'),
      fromFingerprint: pool.fingerprint,
    })
    assert.equal(fs.existsSync(derived.pythonPath), true)
    assert.notEqual(derived.envDir, pool.envDir)
    assert.equal(snapshot(pool.envDir), before, '共享池未被派生装包污染')
    // 目标已有环境 → 拒绝
    await assert.rejects(() => svc.createDerivedEnv(projectDir, { targetDir: derived.envDir }), /已有环境/)
  })

  it('parsePipList：解析 uv pip list 输出', () => {
    assert.deepEqual(parsePipList('Package   Version\n--------- -------\nnumpy     2.0.0\npandas    2.2.0\n'), ['numpy', 'pandas'])
    assert.deepEqual(parsePipList('Package   Version\n--------- -------\n'), [])
    assert.deepEqual(parsePipList(''), [])
  })

  it('ENV-06：legacy .venv 路径逻辑不动（pythonOf/envDirOf 原样）', () => {
    const s = new ProjectEnvService(dataRoot)
    assert.equal(s.envDirOf(projectDir), path.join(projectDir, '.venv'))
    assert.equal(s.pythonOf(path.join(projectDir, '.venv')), path.join(projectDir, '.venv', 'Scripts', 'python.exe'))
    // 未调用 remove 时 .venv 不会被删除（ENV-06：未经确认不删）
    const envDir = s.envDirOf(projectDir)
    fs.mkdirSync(path.join(envDir, 'Scripts'), { recursive: true })
    fs.writeFileSync(s.pythonOf(envDir), 'legacy', 'utf8')
    void s.fingerprint(projectDir)
    void s.envFor(projectDir)
    assert.equal(fs.existsSync(s.pythonOf(envDir)), true, 'legacy .venv 保留')
  })
})
