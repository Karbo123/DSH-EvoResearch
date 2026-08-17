/**
 * Git worktree 服务（§7.4；§15.8 ENV-01/02）。
 *
 * worktree = 并行实验的代码隔离工具，不是流程要求：
 * - 创建时记录明确的起始 commit（worktree 分支就建立在起始 commit 上）；
 * - worktree 统一放在 <dataRoot>/.evoresearch-data/worktrees/<name>/；
 * - 删除 worktree 不删除 Git 分支（分支保留，随时可从 Chat Graph 打开）；
 * - 不使用 git reset --hard；本文件没有任何对主工作区文件的写操作，
 *   git worktree add/remove 只作用于新建/移除的 worktree 路径本身。
 *
 * 安全护栏（ENV-02）：
 * - createWorktree 只在托管根内新建目录，branch 名 = 目录名（slug，碰撞加后缀）；
 * - removeWorktree 只接受托管根内的名字（单段目录名，防路径穿越），
 *   git worktree remove 之后兜底清理该目录；绝不触碰主工作区；
 * - 主工作区状态可经 listWorktrees/测试断言（HEAD 与 status 不变）验证。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { normPath, slugifyProjectName } from './core/paths.js'

/** worktree 托管根（<dataRoot>/.evoresearch-data/worktrees）。 */
const WORKTREES_REL = path.join('.evoresearch-data', 'worktrees')

/** worktree 信息（wire JSON）。 */
export interface WorktreeInfo {
  /** 目录名（= 分支名）。 */
  readonly name: string
  readonly path: string
  /** 分支名（detached 为 null）。 */
  readonly branch: string | null
  /** HEAD commit。 */
  readonly commit: string
  /** 是否位于本服务托管根内（外部 worktree 仅列出不管理）。 */
  readonly managed: boolean
  readonly createdAt: number
}

/** 解析 git worktree list --porcelain 的输出（纯函数，测试覆盖）。 */
export interface ParsedWorktree {
  readonly path: string
  readonly commit: string
  readonly branch: string | null
  readonly detached: boolean
}

interface MutableParsedWorktree {
  path: string
  commit: string
  branch: string | null
  detached: boolean
}

export function parseWorktreeList(porcelain: string): ParsedWorktree[] {
  const out: MutableParsedWorktree[] = []
  let current: MutableParsedWorktree | null = null
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), commit: '', branch: null, detached: false }
      out.push(current)
    } else if (current !== null && line.startsWith('HEAD ')) {
      current.commit = line.slice('HEAD '.length)
    } else if (current !== null && line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length)
    } else if (current !== null && line === 'detached') {
      current.detached = true
    }
  }
  return out.filter((w) => w.commit !== '').map((w) => ({ ...w }))
}

/** 名称 → worktree 目录名 slug（ASCII ≤40；纯中文等回退时间戳）。 */
function slugWorktreeName(name: string): string {
  const slug = slugifyProjectName(name, 40)
  if (slug === 'project' && !/[a-z0-9]/.test(name)) return `wt-${Date.now().toString(36)}`
  return slug
}

/** Git 服务（同步；参数数组传路径，规避 shell 引号/空格问题）。 */
function git(projectPath: string, args: string[], timeoutMs = 60000): { ok: boolean; stdout: string; stderr: string } {
  try {
    const r = spawnSync('git', args, { cwd: projectPath, encoding: 'utf8', windowsHide: true, timeout: timeoutMs })
    return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  } catch (error) {
    return { ok: false, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
  }
}

/** Git worktree 服务（ENV-01/02）。 */
export class WorktreeService {
  constructor(readonly dataRoot: string) {}

  /** worktree 托管根目录。 */
  worktreesRoot(): string {
    return path.join(this.dataRoot, WORKTREES_REL)
  }

  /** 校验 worktree 名（单段目录名，防路径穿越）并解析为托管根内路径。 */
  worktreePathOf(name: string): string {
    const n = String(name ?? '')
    if (n === '' || n === '.' || n === '..' || n.includes('/') || n.includes('\\') || n.includes('\0')) {
      throw new Error(`非法的 worktree 名: ${name}`)
    }
    return path.join(this.worktreesRoot(), n)
  }

  private assertRepo(projectPath: string): string {
    const project = path.resolve(projectPath)
    if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) {
      throw new Error(`项目目录不存在: ${projectPath}`)
    }
    const r = git(project, ['rev-parse', '--is-inside-work-tree'])
    if (!r.ok || r.stdout.trim() !== 'true') throw new Error(`项目不是 git 仓库: ${projectPath}`)
    return project
  }

  private branchExists(project: string, name: string): boolean {
    return git(project, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]).ok
  }

  private uniqueName(project: string, base: string): string {
    const root = this.worktreesRoot()
    if (!fs.existsSync(path.join(root, base)) && !this.branchExists(project, base)) return base
    let n = 2
    while (fs.existsSync(path.join(root, `${base}-${n}`)) || this.branchExists(project, `${base}-${n}`)) n += 1
    return `${base}-${n}`
  }

  /**
   * 创建 worktree（ENV-01）：
   * - 记录起始 commit：fromCommit（默认 HEAD）校验存在后作为新分支起点；
   * - 位置：<dataRoot>/.evoresearch-data/worktrees/<name>/（项目数据根独立目录）；
   * - git worktree add -b <branch> <path> <commit>——只新建 worktree 与分支，
   *   主工作区文件与 HEAD 完全不动（ENV-02）。
   * @param projectPath 项目目录（须为 git 仓库）。
   * @param opts.name worktree/分支名（slug 化；碰撞自动加数字后缀）。
   * @param opts.fromCommit 起始 commit（sha 或 ref；默认 HEAD）。
   */
  createWorktree(projectPath: string, opts: { name?: string; fromCommit?: string } = {}): WorktreeInfo {
    const project = this.assertRepo(projectPath)
    const commit = String(opts.fromCommit ?? '').trim() || 'HEAD'
    const verify = git(project, ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`])
    if (!verify.ok) throw new Error(`起始 commit 不存在: ${commit}`)
    const root = this.worktreesRoot()
    fs.mkdirSync(root, { recursive: true })
    const base = slugWorktreeName(String(opts.name ?? '').trim() || 'worktree')
    const name = this.uniqueName(project, base)
    const wtPath = path.join(root, name)
    const add = git(project, ['worktree', 'add', '-b', name, wtPath, commit], 120000)
    if (!add.ok) {
      // 清理可能的半成品目录（仅托管根内，安全）
      fs.rmSync(wtPath, { recursive: true, force: true })
      const detail = (add.stderr.trim() || add.stdout.trim()).slice(0, 500)
      throw new Error(`worktree 创建失败: ${detail}`)
    }
    const head = git(wtPath, ['rev-parse', 'HEAD'])
    let createdAt = Date.now()
    try {
      createdAt = fs.statSync(wtPath).birthtimeMs || createdAt
    } catch {
      // 目录刚建好，stat 失败用当前时间
    }
    return { name, path: wtPath, branch: name, commit: head.stdout.trim() || commit, managed: true, createdAt }
  }

  /** 列出项目全部 worktree（porcelain 解析；托管根内的标 managed）。 */
  listWorktrees(projectPath: string): WorktreeInfo[] {
    const project = this.assertRepo(projectPath)
    const r = git(project, ['worktree', 'list', '--porcelain'])
    if (!r.ok) throw new Error(`git worktree list 失败: ${r.stderr.trim().slice(0, 300)}`)
    const managedRoot = normPath(this.worktreesRoot())
    return parseWorktreeList(r.stdout).map((w) => {
      const managed = normPath(w.path) === managedRoot || normPath(w.path).startsWith(`${managedRoot}${path.sep}`)
      let createdAt = 0
      try {
        createdAt = fs.statSync(w.path).birthtimeMs || fs.statSync(w.path).ctimeMs
      } catch {
        // 目录不存在时保持 0
      }
      return { name: path.basename(w.path), path: w.path, branch: w.branch, commit: w.commit, managed, createdAt }
    })
  }

  /**
   * 安全移除 worktree（ENV-01/02）：
   * - 只接受托管根内的名字（单段目录名，防路径穿越）；
   * - git worktree remove（工作区有未提交改动时需 force: true）后兜底清理目录；
   * - 不删除 Git 分支（分支保留，随时可从 Chat Graph 打开）；
   * - 主工作区不受任何影响。
   */
  removeWorktree(projectPath: string, name: string, opts: { force?: boolean } = {}): { ok: true; removed: boolean } {
    const project = this.assertRepo(projectPath)
    const wtPath = this.worktreePathOf(name)
    const args = ['worktree', 'remove', ...(opts.force === true ? ['--force'] : []), wtPath]
    const r = git(project, args, 120000)
    if (!r.ok) {
      const msg = (r.stderr.trim() || r.stdout.trim())
      if (/not a valid worktree|not a working tree|could not find worktree/i.test(msg)) {
        // 登记不存在：兜底清理托管根内遗留目录
        fs.rmSync(wtPath, { recursive: true, force: true })
        return { ok: true, removed: false }
      }
      throw new Error(`worktree 移除失败（工作区有未提交改动时可传 force: true）: ${msg.slice(0, 400)}`)
    }
    // git worktree remove 已删除工作目录；兜底清理
    if (fs.existsSync(wtPath)) fs.rmSync(wtPath, { recursive: true, force: true })
    return { ok: true, removed: true }
  }
}
