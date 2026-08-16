/**
 * 实验管理服务（§5.1 Git 式分支/回退/checkpoint）。
 *
 * 数据模型：每个工作区 <workspace>/.evoresearch-data/experiments/<id>.json
 * 一个 manifest（阶段/检查点/分支），快照存 <workspace>/.evoresearch-data/
 * experiments/snapshots/<expId>/<checkpointId>/。
 *
 * 语义对齐 Git：
 * - checkpoint = 提交（快照工作区文件 + 备注 + 关联会话）；
 * - rollback = checkout 到某检查点（恢复快照文件，标记 rolledBack）；
 * - branch = 从某检查点分叉（新分支携带截至该检查点的阶段/检查点副本），
 *   后续阶段与检查点在新分支上推进，互不干扰。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ExperimentBranch, ExperimentCheckpoint, ExperimentManifest, ExperimentPhase, ExperimentSummary } from '../shared/types.js'

/** 快照跳过的目录（可重建/体积大/工具目录；含自身数据目录避免递归）。 */
const SNAPSHOT_SKIP_DIRS = new Set(['.git', '.evoresearch-data', 'node_modules', '.venv', '__pycache__', '.pytest_cache', '.ruff_cache', '.next', 'dist', 'build', '.cache', '.idea', '.vscode'])
const SNAPSHOT_MAX_DEPTH = 12
const SNAPSHOT_MAX_BYTES = 256 * 1024 * 1024

const newId = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8)}`

/** 实验服务（按工作区隔离存储）。 */
export class ExperimentService {
  constructor(readonly dataRoot: string) {}

  /** 校验工作区目录（部署根 或 其子目录），返回规范化绝对路径。 */
  private assertWorkspace(workspaceDir: string): string {
    const base = path.resolve(this.dataRoot)
    const ws = path.resolve(workspaceDir || base)
    const t = ws.toLowerCase().replace(/\//g, '\\')
    const b = base.toLowerCase().replace(/\//g, '\\')
    if (t !== b && !t.startsWith(b.endsWith('\\') ? b : `${b}\\`)) {
      throw new Error(`工作区超出部署根目录: ${workspaceDir}`)
    }
    return ws
  }

  private rootOf(workspaceDir: string): string {
    return path.join(this.assertWorkspace(workspaceDir), '.evoresearch-data', 'experiments')
  }

  private fileOf(workspaceDir: string, id: string): string {
    return path.join(this.rootOf(workspaceDir), `${id}.json`)
  }

  private snapshotsRootOf(workspaceDir: string): string {
    return path.join(this.rootOf(workspaceDir), 'snapshots')
  }

  private read(workspaceDir: string, id: string): ExperimentManifest {
    const file = this.fileOf(workspaceDir, id)
    if (!fs.existsSync(file)) throw new Error(`实验不存在: ${id}`)
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as ExperimentManifest
    if (typeof raw?.id !== 'string' || !Array.isArray(raw.branches)) throw new Error(`实验 manifest 损坏: ${id}`)
    return raw
  }

  private write(manifest: ExperimentManifest): ExperimentManifest {
    const file = this.fileOf(manifest.workspaceDir, manifest.id)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8')
    fs.renameSync(tmp, file)
    return manifest
  }

  /** 列出工作区全部实验（摘要）。 */
  list(workspaceDir: string): ExperimentSummary[] {
    const root = this.rootOf(workspaceDir)
    let names: string[] = []
    try {
      names = fs.readdirSync(root).filter((n) => n.endsWith('.json'))
    } catch {
      return []
    }
    return names.map((name) => {
      try {
        const manifest = this.read(workspaceDir, name.slice(0, -5))
        return this.summaryOf(manifest)
      } catch {
        return null
      }
    }).filter((s): s is ExperimentSummary => s !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private summaryOf(m: ExperimentManifest): ExperimentSummary {
    let phases = 0
    let checkpoints = 0
    for (const branch of m.branches) {
      phases += branch.phases.length
      for (const phase of branch.phases) checkpoints += phase.checkpoints.length
    }
    return {
      id: m.id,
      name: m.name,
      description: m.description,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      branchCount: m.branches.length,
      phaseCount: phases,
      checkpointCount: checkpoints,
      currentBranchId: m.currentBranchId,
    }
  }

  get(workspaceDir: string, id: string): ExperimentManifest {
    return this.read(workspaceDir, id)
  }

  /** 创建实验（首个分支 phase-0）。 */
  create(workspaceDir: string, name: string, description: string): ExperimentManifest {
    const ws = this.assertWorkspace(workspaceDir)
    const trimmed = name.trim()
    if (trimmed === '') throw new Error('实验名称不能为空')
    const now = Date.now()
    const branch: ExperimentBranch = {
      id: newId('b'),
      name: 'main',
      createdAt: now,
      phases: [{
        id: newId('p'),
        name: '探索',
        description: '',
        createdAt: now,
        checkpoints: [],
      }],
    }
    const manifest: ExperimentManifest = {
      id: newId('e'),
      name: trimmed.slice(0, 120),
      description: (description ?? '').trim().slice(0, 2000),
      workspaceDir: ws,
      createdAt: now,
      updatedAt: now,
      branches: [branch],
      currentBranchId: branch.id,
      sessionIds: [],
    }
    return this.write(manifest)
  }

  /** 更新实验名称/描述。 */
  update(workspaceDir: string, id: string, patch: { name?: string; description?: string }): ExperimentManifest {
    const manifest = this.read(workspaceDir, id)
    const next = { ...manifest }
    if (typeof patch.name === 'string' && patch.name.trim() !== '') next.name = patch.name.trim().slice(0, 120)
    if (typeof patch.description === 'string') next.description = patch.description.trim().slice(0, 2000)
    next.updatedAt = Date.now()
    return this.write(next)
  }

  /** 当前分支。 */
  private currentBranch(manifest: ExperimentManifest): ExperimentBranch {
    const branch = manifest.branches.find((b) => b.id === manifest.currentBranchId)
    if (branch === undefined) throw new Error(`当前分支不存在: ${manifest.currentBranchId}`)
    return branch
  }

  /** 当前分支新增阶段。 */
  addPhase(workspaceDir: string, id: string, name: string, description: string): ExperimentManifest {
    const manifest = this.read(workspaceDir, id)
    const next = { ...manifest }
    const branches = [...next.branches]
    const idx = branches.findIndex((b) => b.id === next.currentBranchId)
    if (idx < 0) throw new Error(`当前分支不存在: ${next.currentBranchId}`)
    const branch = branches[idx]!
    const now = Date.now()
    branches[idx] = {
      ...branch,
      phases: [...branch.phases, {
        id: newId('p'),
        name: name.trim().slice(0, 120) || `阶段 ${branch.phases.length + 1}`,
        description: (description ?? '').trim().slice(0, 2000),
        createdAt: now,
        checkpoints: [],
      }],
    }
    next.branches = branches
    next.updatedAt = now
    return this.write(next)
  }

  /**
   * 创建检查点：快照工作区文件到 snapshots/<expId>/<checkpointId>/ 并记录。
   * @param phaseId 指定阶段（默认当前分支最后一个阶段）。
   */
  checkpoint(
    workspaceDir: string,
    id: string,
    opts: { name?: string; note?: string; phaseId?: string; sessionId?: string },
  ): ExperimentManifest {
    const manifest = this.read(workspaceDir, id)
    const next = { ...manifest }
    const branches = [...next.branches]
    const idx = branches.findIndex((b) => b.id === next.currentBranchId)
    if (idx < 0) throw new Error(`当前分支不存在: ${next.currentBranchId}`)
    const branch = branches[idx]!
    let phases = [...branch.phases]
    let phaseIdx = phases.length - 1
    if (opts.phaseId !== undefined) {
      const found = phases.findIndex((p) => p.id === opts.phaseId)
      if (found < 0) throw new Error(`阶段不存在: ${opts.phaseId}`)
      phaseIdx = found
    }
    if (phaseIdx < 0) throw new Error('当前分支没有阶段')
    const phase = phases[phaseIdx]!
    const now = Date.now()
    const checkpointId = newId('c')
    const snapshotDir = path.join('snapshots', id, checkpointId)
    const snapshotAbs = path.join(this.snapshotsRootOf(workspaceDir), id, checkpointId)
    const { files, bytes } = snapshotTree(path.resolve(manifest.workspaceDir), snapshotAbs)
    const checkpoint: ExperimentCheckpoint = {
      id: checkpointId,
      name: (opts.name ?? '').trim().slice(0, 120) || `检查点 ${phase.checkpoints.length + 1}`,
      note: (opts.note ?? '').trim().slice(0, 2000),
      createdAt: now,
      phaseId: phase.id,
      snapshotDir,
      files,
      bytes,
      ...(typeof opts.sessionId === 'string' && opts.sessionId !== '' ? { sessionId: opts.sessionId } : {}),
    }
    phases[phaseIdx] = { ...phase, checkpoints: [...phase.checkpoints, checkpoint] }
    branches[idx] = { ...branch, phases }
    next.branches = branches
    next.updatedAt = now
    const sessionIds = [...next.sessionIds]
    if (typeof opts.sessionId === 'string' && opts.sessionId !== '' && !sessionIds.includes(opts.sessionId)) {
      sessionIds.push(opts.sessionId)
    }
    next.sessionIds = sessionIds
    return this.write(next)
  }

  /**
   * 回退到某检查点：把快照文件恢复到工作区（快照内文件覆盖；
   * 快照后新增的文件保留）。标记该检查点 rolledBack。
   */
  rollback(workspaceDir: string, id: string, checkpointId: string): { restored: number; checkpointId: string; name: string } {
    const manifest = this.read(workspaceDir, id)
    const ws = this.assertWorkspace(manifest.workspaceDir)
    let target: ExperimentCheckpoint | null = null
    let branchIdx = -1
    let phaseIdx = -1
    let cpIdx = -1
    for (let b = 0; b < manifest.branches.length && target === null; b++) {
      for (let p = 0; p < manifest.branches[b]!.phases.length && target === null; p++) {
        for (let c = 0; c < manifest.branches[b]!.phases[p]!.checkpoints.length; c++) {
          if (manifest.branches[b]!.phases[p]!.checkpoints[c]!.id === checkpointId) {
            target = manifest.branches[b]!.phases[p]!.checkpoints[c]!
            branchIdx = b; phaseIdx = p; cpIdx = c
            break
          }
        }
      }
    }
    if (target === null) throw new Error(`检查点不存在: ${checkpointId}`)
    const snapshotAbs = path.join(this.snapshotsRootOf(workspaceDir), id, checkpointId)
    if (!fs.existsSync(snapshotAbs)) throw new Error(`快照数据缺失: ${checkpointId}`)
    const restored = restoreTree(snapshotAbs, ws)
    // 标记 rolledBack（全 manifest 唯一）
    const next = { ...manifest }
    const branches = next.branches.map((b) => ({
      ...b,
      phases: b.phases.map((p) => ({
        ...p,
        checkpoints: p.checkpoints.map((c) => ({ ...c, ...(c.id === checkpointId ? { rolledBack: true } : {}) })),
      })),
    }))
    next.branches = branches
    next.updatedAt = Date.now()
    this.write(next)
    return { restored, checkpointId, name: target.name }
  }

  /** 从某检查点创建分支（携带截至该检查点的阶段/检查点副本；新分支成为当前）。 */
  branch(workspaceDir: string, id: string, fromCheckpointId: string, name: string): ExperimentManifest {
    const manifest = this.read(workspaceDir, id)
    const now = Date.now()
    let sourceBranch: ExperimentBranch | null = null
    let sourcePhase: ExperimentPhase | null = null
    let foundCheckpoint = false
    for (const branch of manifest.branches) {
      for (const phase of branch.phases) {
        if (phase.checkpoints.some((c) => c.id === fromCheckpointId)) {
          sourceBranch = branch
          sourcePhase = phase
          foundCheckpoint = true
          break
        }
      }
      if (foundCheckpoint) break
    }
    if (sourceBranch === null || sourcePhase === null) throw new Error(`检查点不存在: ${fromCheckpointId}`)
    // 新分支 = 源分支阶段副本，但截断到包含该检查点的阶段及其之前
    const keepPhases: ExperimentPhase[] = []
    for (const phase of sourceBranch.phases) {
      if (phase.id === sourcePhase.id) {
        const keepCheckpoints = phase.checkpoints.filter((c) => {
          const idx = phase.checkpoints.findIndex((x) => x.id === fromCheckpointId)
          return phase.checkpoints.indexOf(c) <= idx
        })
        keepPhases.push({ ...phase, checkpoints: keepCheckpoints })
        break
      }
      keepPhases.push({ ...phase, checkpoints: [...phase.checkpoints] })
    }
    const branch: ExperimentBranch = {
      id: newId('b'),
      name: name.trim().slice(0, 120) || `分支 ${manifest.branches.length}`,
      fromCheckpointId,
      createdAt: now,
      phases: keepPhases,
    }
    const next = { ...manifest }
    next.branches = [...next.branches, branch]
    next.currentBranchId = branch.id
    next.updatedAt = now
    return this.write(next)
  }

  /** 切换当前分支。 */
  switchBranch(workspaceDir: string, id: string, branchId: string): ExperimentManifest {
    const manifest = this.read(workspaceDir, id)
    if (!manifest.branches.some((b) => b.id === branchId)) throw new Error(`分支不存在: ${branchId}`)
    const next = { ...manifest }
    next.currentBranchId = branchId
    next.updatedAt = Date.now()
    return this.write(next)
  }

  /** 删除实验（含快照目录）。 */
  delete(workspaceDir: string, id: string): { ok: boolean } {
    const file = this.fileOf(workspaceDir, id)
    if (fs.existsSync(file)) fs.rmSync(file, { force: true })
    const snapshots = path.join(this.snapshotsRootOf(workspaceDir), id)
    if (fs.existsSync(snapshots)) fs.rmSync(snapshots, { recursive: true, force: true })
    return { ok: true }
  }
}

/** 递归复制工作区 → 快照目录（跳过 SNAPSHOT_SKIP_DIRS），返回文件数/字节。 */
function snapshotTree(source: string, target: string): { files: number; bytes: number } {
  fs.mkdirSync(target, { recursive: true })
  let files = 0
  let bytes = 0
  const walk = (dir: string, dst: string, depth: number): void => {
    if (depth > SNAPSHOT_MAX_DEPTH) return
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory() && SNAPSHOT_SKIP_DIRS.has(entry.name)) continue
      const src = path.join(dir, entry.name)
      const out = path.join(dst, entry.name)
      try {
        if (entry.isDirectory()) {
          fs.mkdirSync(out, { recursive: true })
          walk(src, out, depth + 1)
        } else if (entry.isFile()) {
          const size = fs.statSync(src).size
          if (bytes + size > SNAPSHOT_MAX_BYTES) continue
          fs.copyFileSync(src, out)
          files += 1
          bytes += size
        }
      } catch {
        // 单文件失败跳过（不中断快照）
      }
    }
  }
  walk(source, target, 0)
  return { files, bytes }
}

/** 递归恢复快照 → 工作区（覆盖同名文件；新增文件保留）。 */
function restoreTree(snapshot: string, workspace: string): number {
  let restored = 0
  const walk = (dir: string, dst: string, depth: number): void => {
    if (depth > SNAPSHOT_MAX_DEPTH) return
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const src = path.join(dir, entry.name)
      const out = path.join(dst, entry.name)
      try {
        if (entry.isDirectory()) {
          fs.mkdirSync(out, { recursive: true })
          walk(src, out, depth + 1)
        } else if (entry.isFile()) {
          fs.mkdirSync(path.dirname(out), { recursive: true })
          fs.copyFileSync(src, out)
          restored += 1
        }
      } catch {
        // 单文件失败跳过
      }
    }
  }
  walk(snapshot, workspace, 0)
  return restored
}
