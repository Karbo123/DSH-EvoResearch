/**
 * 实验账本服务（Part A：Git 8 条纪律落地）。
 *
 * 每个实验一个 bare git repo，记录"每次尝试"的提交链：
 * - 可回溯：git log 就是实验史
 * - 无副作用：回退用 restore + clean，不用硬重置
 * - 可审计：每次尝试恰好一个 commit（--allow-empty）
 * - 可导出：git clone bare → 普通仓库
 *
 * 裸仓库路径：<dataRoot>/.evoresearch-data/ledgers/<sanitized-project>/<slug>.git
 * 工作区：<projectDir>/experiments/<slug>  (--work-tree)
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { projectNameFromWorkspace, slugifyProjectName } from './core/paths.js'
import { captureProvenance } from './experiment-provenance.js'

const GIT_NAME = 'EvoResearch'
const GIT_EMAIL = 'evoresearch@localhost'

/** 账本状态快照文件名（纪律 5）。 */
export const LEDGER_STATE_NAME = '.evoresearch-ledger-state.json'

export interface LedgerTrialPayload {
  kind: 'checkpoint' | 'manual' | 'rejected' | 'run'
  note: string
  state?: Record<string, unknown>
  createdAt: number
}

export interface LedgerCommitInfo {
  sha: string
  message: string
  when: number
  kind: string
}

function runGit(args: string[], opts: { cwd?: string; gitDir?: string; workTree?: string }): string {
  const gitArgs: string[] = []
  if (opts.gitDir) gitArgs.push(`--git-dir=${opts.gitDir}`)
  if (opts.workTree) gitArgs.push(`--work-tree=${opts.workTree}`)
  gitArgs.push(...args)
  const cwd = opts.cwd ?? opts.workTree ?? opts.gitDir ?? process.cwd()
  // Prefer git.exe on Windows, fallback to git
  let result = spawnSync('git.exe', gitArgs, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
    result = spawnSync('git', gitArgs, { cwd, encoding: 'utf8', windowsHide: true })
  }
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${(result.stderr ?? '').trim().slice(0, 500) || `exit ${String(result.status)}`}`)
  }
  return (result.stdout ?? '').trim()
}

function countFilesRecursive(dir: string): number {
  let count = 0
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      if (e.isDirectory()) {
        // skip .git if ever present (should not be in workTree)
        if (e.name === '.git') continue
        count += countFilesRecursive(path.join(dir, e.name))
      } else if (e.isFile()) {
        count += 1
      }
    }
  } catch { /* ignore */ }
  return count
}

export class ExperimentLedgerService {
  constructor(readonly dataRoot: string) {}

  private repoDir(projectDir: string, slug: string): string {
    // projectDir 必须是 dataRoot/projects/<name> 项目目录：账本按项目名归档，
    // 不校验则任意路径的 basename 都会写入共享命名空间（跨项目串账本）。
    const name = projectNameFromWorkspace(this.dataRoot, projectDir)
    if (name === undefined) {
      throw new Error(`实验账本需要项目目录（dataRoot/projects/<name>）: ${projectDir}`)
    }
    return path.join(this.dataRoot, '.evoresearch-data', 'ledgers', slugifyProjectName(name), `${slug}.git`)
  }

  private expDir(projectDir: string, slug: string): string {
    return path.join(path.resolve(projectDir), 'experiments', slug)
  }

  private assertSlug(slug: string): string {
    const s = String(slug ?? '').trim()
    if (s === '' || s === '.' || s === '..' || s.includes('/') || s.includes('\\') || s.includes('\0')) {
      throw new Error(`非法的实验目录名: ${slug}`)
    }
    return s
  }

  exists(projectDir: string, slug: string): boolean {
    const s = this.assertSlug(slug)
    return fs.existsSync(this.repoDir(projectDir, s))
  }

  init(projectDir: string, slug: string, opts?: { overwrite?: boolean }): { ok: true; sha: string } | { ok: false; error: string } {
    try {
      const s = this.assertSlug(slug)
      const repo = this.repoDir(projectDir, s)
      const exp = this.expDir(projectDir, s)
      const already = fs.existsSync(repo)
      if (already && opts?.overwrite !== true) {
        return { ok: false, error: `账本已存在: ${slug}（如需重建请使用 overwrite）` }
      }
      if (already && opts?.overwrite === true) {
        fs.rmSync(repo, { recursive: true, force: true })
      }
      fs.mkdirSync(path.dirname(repo), { recursive: true })
      fs.mkdirSync(exp, { recursive: true })

      // bare init
      runGit(['init', '--bare', repo], {})

      // 纪律 4：禁用 ignore
      runGit(['config', 'core.excludesFile', '/dev/null'], { gitDir: repo })
      runGit(['config', 'user.name', GIT_NAME], { gitDir: repo })
      runGit(['config', 'user.email', GIT_EMAIL], { gitDir: repo })

      // 写初始 state（纪律 5）
      const stateFile = path.join(exp, LEDGER_STATE_NAME)
      if (!fs.existsSync(stateFile)) {
        const initState: Record<string, unknown> = { createdAt: Date.now(), slug: s, projectDir: path.resolve(projectDir), phase: 'init' }
        fs.writeFileSync(stateFile, JSON.stringify(initState, null, 2), 'utf8')
      }

      // 写 provenance（A.7：调用 captureProvenance，失败不阻塞首个 commit）
      try {
        captureProvenance({ dataRoot: this.dataRoot, projectDir: path.resolve(projectDir), slug: s, overwrite: opts?.overwrite === true })
      } catch { /* provenance 失败不阻塞 */ }

      // 首个 commit --allow-empty（纪律 2）
      runGit(['add', '-A', '-f', '--', '.'], { gitDir: repo, workTree: exp })
      runGit(['commit', '--allow-empty', '-m', `checkpoint: ledger init ${s}`], { gitDir: repo, workTree: exp })

      const sha = runGit(['rev-parse', 'HEAD'], { gitDir: repo })
      return { ok: true, sha }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private buildProvenanceStub(slug: string): Record<string, unknown> {
    let appVersion = '0.1.0'
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(this.dataRoot, 'package.json'), 'utf8')) as { version?: string }
      if (typeof pkg.version === 'string') appVersion = pkg.version
    } catch {
      try {
        const pkg2 = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version?: string }
        if (typeof pkg2.version === 'string') appVersion = pkg2.version
      } catch { /* ignore */ }
    }
    let dshVersion = 'unknown'
    for (const cand of [
      path.join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
      path.join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh-agent', 'package.json'),
      path.join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh-session', 'package.json'),
    ]) {
      try {
        const dshPkg = JSON.parse(fs.readFileSync(cand, 'utf8')) as { version?: string }
        if (typeof dshPkg.version === 'string' && dshPkg.version !== '') { dshVersion = dshPkg.version; break }
      } catch { /* try next */ }
    }
    return {
      app: { name: 'EvoResearch', version: appVersion },
      dsh: { version: dshVersion },
      node: process.version,
      os: `${process.platform} ${process.arch}`,
      dataRoot: this.dataRoot,
      createdAt: Date.now(),
      slug,
      config: {},
    }
  }

  trial(projectDir: string, slug: string, payload: LedgerTrialPayload): { ok: true; sha: string } | { ok: false; error: string } {
    try {
      const s = this.assertSlug(slug)
      const repo = this.repoDir(projectDir, s)
      const exp = this.expDir(projectDir, s)
      if (!fs.existsSync(repo)) return { ok: false, error: `账本不存在: ${slug}（请先初始化）` }
      if (!fs.existsSync(exp) || !fs.statSync(exp).isDirectory()) return { ok: false, error: `实验不存在: ${slug}` }

      if (payload.state !== undefined) {
        const stateFile = path.join(exp, LEDGER_STATE_NAME)
        // 原子写
        const tmp = `${stateFile}.tmp-${process.pid}`
        fs.writeFileSync(tmp, JSON.stringify(payload.state, null, 2), 'utf8')
        fs.renameSync(tmp, stateFile)
      }

      // 纪律 4 + 纪律 2：-f 保证 ignore 不生效，--allow-empty 保证空改动也有 commit
      runGit(['add', '-A', '-f', '--', '.'], { gitDir: repo, workTree: exp })
      const message = `${payload.kind}: ${String(payload.note ?? '').trim() || payload.kind}`
      runGit(['commit', '--allow-empty', '-m', message], { gitDir: repo, workTree: exp })
      const sha = runGit(['rev-parse', 'HEAD'], { gitDir: repo })
      return { ok: true, sha }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  log(projectDir: string, slug: string, limit?: number): LedgerCommitInfo[] {
    const s = this.assertSlug(slug)
    const repo = this.repoDir(projectDir, s)
    if (!fs.existsSync(repo)) return []
    const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 100
    let out: string
    try {
      out = runGit(['log', '--format=%H%x1f%ct%x1f%s', '-n', String(n)], { gitDir: repo })
    } catch {
      return []
    }
    if (out.trim() === '') return []
    return out.split('\n').filter((l) => l.trim() !== '').map((line) => {
      const [sha, ct, message] = line.split('\x1f')
      const msg = message ?? ''
      // kind 提取：消息前缀 "kind:"
      const colon = msg.indexOf(':')
      let kind = 'manual'
      if (colon > 0) {
        const prefix = msg.slice(0, colon).trim()
        if (['checkpoint', 'manual', 'rejected', 'run'].includes(prefix)) kind = prefix
      }
      return { sha: sha ?? '', message: msg, when: Number(ct ?? 0) * 1000, kind }
    })
  }

  recentState(projectDir: string, slug: string, n?: number): Record<string, unknown> | null {
    const s = this.assertSlug(slug)
    const repo = this.repoDir(projectDir, s)
    if (!fs.existsSync(repo)) return null
    const limit = typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 10
    const commits = this.log(projectDir, s, limit)
    for (const c of commits) {
      try {
        const content = runGit(['show', `${c.sha}:${LEDGER_STATE_NAME}`], { gitDir: repo })
        if (content.trim() === '') continue
        return JSON.parse(content) as Record<string, unknown>
      } catch {
        // 该提交没有 state 文件，继续找更早的
        continue
      }
    }
    return null
  }

  restore(projectDir: string, slug: string, sha: string): { ok: true; restoredFiles: number } | { ok: false; error: string } {
    try {
      const s = this.assertSlug(slug)
      const repo = this.repoDir(projectDir, s)
      const exp = this.expDir(projectDir, s)
      if (!fs.existsSync(repo)) return { ok: false, error: `账本不存在: ${slug}` }
      if (!fs.existsSync(exp) || !fs.statSync(exp).isDirectory()) return { ok: false, error: `实验不存在: ${slug}` }
      const target = String(sha ?? '').trim()
      if (!/^[0-9a-f]{7,40}$/i.test(target)) return { ok: false, error: `非法的 commit SHA: ${sha}` }
      // 校验 sha 存在
      try {
        runGit(['cat-file', '-e', `${target}^{commit}`], { gitDir: repo })
      } catch {
        return { ok: false, error: `commit 不存在: ${sha}` }
      }
      // 纪律 3：非破坏性回退（禁用硬重置）
      runGit(['restore', '--source', target, '--staged', '--worktree', '--', '.'], { gitDir: repo, workTree: exp })
      runGit(['clean', '-fdx'], { gitDir: repo, workTree: exp })
      const restoredFiles = countFilesRecursive(exp)
      return { ok: true, restoredFiles }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  export(projectDir: string, slug: string, dest: string): { ok: true; path: string } | { ok: false; error: string } {
    try {
      const s = this.assertSlug(slug)
      const repo = this.repoDir(projectDir, s)
      if (!fs.existsSync(repo)) return { ok: false, error: `账本不存在: ${slug}` }
      const destAbs = path.resolve(String(dest ?? '').trim())
      if (destAbs === '') return { ok: false, error: '导出目标为空' }
      if (fs.existsSync(destAbs)) return { ok: false, error: `目标已存在: ${destAbs}` }
      fs.mkdirSync(path.dirname(destAbs), { recursive: true })
      // git clone bare → 普通仓库
      runGit(['clone', repo, destAbs], {})
      return { ok: true, path: destAbs }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  rejectAndRestore(projectDir: string, slug: string, payload: { note: string; state?: Record<string, unknown> }): { ok: true; rejectedSha: string; restoredFiles: number } | { ok: false; error: string } {
    try {
      const s = this.assertSlug(slug)
      const repo = this.repoDir(projectDir, s)
      if (!fs.existsSync(repo)) return { ok: false, error: `账本不存在: ${slug}` }
      // 先留痕（纪律 1）：被否决的尝试也要进历史
      const trialResult = this.trial(projectDir, s, {
        kind: 'rejected',
        note: String(payload.note ?? '').trim() || 'rejected',
        ...(payload.state !== undefined ? { state: payload.state } : {}),
        createdAt: Date.now(),
      })
      if (!trialResult.ok) return trialResult
      const rejectedSha = trialResult.sha
      // 找到父提交（rejected 之前）
      let parentSha: string
      try {
        parentSha = runGit(['rev-parse', `${rejectedSha}~1`], { gitDir: repo })
      } catch {
        // 只剩一个提交时，尝试取 HEAD~1 失败 → 无法回退
        return { ok: false, error: '无法找到回退目标（账本历史过短）' }
      }
      const restored = this.restore(projectDir, s, parentSha)
      if (!restored.ok) return restored
      return { ok: true, rejectedSha, restoredFiles: restored.restoredFiles }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
