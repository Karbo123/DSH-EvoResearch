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
 *
 * ── EXP-01 旧数据兼容性核对结论（§7.7 兼容当前实验模块）────────────────────
 * 1. 读取路径无副作用：list/get 不删除、不移动、不改写任何文件或字段；
 *    get() 原样返回整个 manifest（含未知/旧字段），不筛选、不转换。
 * 2. 旧字段保留：所有写路径（update/addPhase/checkpoint/branch/switchBranch/
 *    rollback）均基于 {...manifest}/{...branch}/{...phase} 展开后只修改已知
 *    字段，旧字段随展开保留；checkpoint 只新增、不改写旧条目（rollback 仅
 *    追加 rolledBack: true）；sessionIds 只追加去重。
 * 3. 容错读取（本次补丁）：read() 只要求 id 为字符串；branches/phases/
 *    checkpoints 缺失或非数组时按空列表容错（旧 manifest 仍可 list/get 不
 *    崩溃）；updatedAt 缺失时排序按 0 处理；checkpoint 跨分支按 id 扫描，
 *    不依赖旧条目 phaseId。
 * 4. 快照：snapshots/<expId>/<checkpointId>/ 只被 checkpoint() 写入、
 *    rollback() 只读恢复；新增只读 snapshotFiles() 可查看旧快照内容。
 * 5. 删除仅限显式 delete()（删 manifest + snapshots/<expId>/），无隐式清理。
 * 6. 只读扩展（供旧时间线界面使用，不写回 manifest）：
 *    - getCheckpoint(): 跨分支按 id 定位检查点（含旧条目无 phaseId 的情况）；
 *    - snapshotFiles(): 列出某检查点快照目录文件（相对路径 + 字节）；
 *    - overview(): §7.7.3 自动生成只读自然语言概览（确定性文本，不调用 LLM）。
 *
 * 方法清单（本类）：
 *   写：create / update / addPhase / checkpoint / rollback（EXP-13：需显式
 *       confirm:true，覆盖工作区文件前必须经 UI 确认）/ branch /
 *       switchBranch / delete
 *   读：list / get / getCheckpoint / snapshotFiles / overview
 * 注：新实验体验（自由目录 + LAB_NOTE.md）见 host/experiment-workspace.ts；
 *    本类保留收缩，只负责旧数据兼容与旧时间线。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { workspaceDataDir } from './core/paths.js'
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
    return path.join(workspaceDataDir(this.dataRoot, this.assertWorkspace(workspaceDir)), 'experiments')
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
    // EXP-01 容错：只要求 id 存在；branches 缺失/非数组按空列表容错（旧 manifest 可读）
    if (typeof raw?.id !== 'string') throw new Error(`实验 manifest 损坏: ${id}`)
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
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }

  private summaryOf(m: ExperimentManifest): ExperimentSummary {
    let phases = 0
    let checkpoints = 0
    // EXP-01 容错：旧数据 branches/phases/checkpoints 缺失时按空列表处理
    const branches: readonly ExperimentBranch[] = Array.isArray(m.branches) ? m.branches : []
    for (const branch of branches) {
      const branchPhases: readonly ExperimentPhase[] = Array.isArray(branch.phases) ? branch.phases : []
      phases += branchPhases.length
      for (const phase of branchPhases) {
        checkpoints += Array.isArray(phase.checkpoints) ? phase.checkpoints.length : 0
      }
    }
    return {
      id: m.id,
      name: m.name,
      description: m.description,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      branchCount: branches.length,
      phaseCount: phases,
      checkpointCount: checkpoints,
      currentBranchId: m.currentBranchId,
    }
  }

  get(workspaceDir: string, id: string): ExperimentManifest {
    return this.read(workspaceDir, id)
  }

  /**
   * 跨分支定位检查点（只读，EXP-01）。按 id 扫描全部分支/阶段/检查点，
   * 不依赖旧条目是否携带 phaseId 字段。
   */
  getCheckpoint(workspaceDir: string, id: string, checkpointId: string): { checkpoint: ExperimentCheckpoint; branchId: string; phaseId: string } {
    const manifest = this.read(workspaceDir, id)
    const branches: readonly ExperimentBranch[] = Array.isArray(manifest.branches) ? manifest.branches : []
    for (const branch of branches) {
      const phases: readonly ExperimentPhase[] = Array.isArray(branch.phases) ? branch.phases : []
      for (const phase of phases) {
        const checkpoints: readonly ExperimentCheckpoint[] = Array.isArray(phase.checkpoints) ? phase.checkpoints : []
        const checkpoint = checkpoints.find((c) => c.id === checkpointId)
        if (checkpoint !== undefined) return { checkpoint, branchId: branch.id, phaseId: phase.id }
      }
    }
    throw new Error(`检查点不存在: ${checkpointId}`)
  }

  /** 列出某检查点快照目录的全部文件（只读，EXP-01；快照缺失时 missing=true）。 */
  snapshotFiles(workspaceDir: string, id: string, checkpointId: string): {
    missing: boolean
    files: Array<{ relPath: string; size: number }>
    fileCount: number
    totalBytes: number
  } {
    this.read(workspaceDir, id) // 校验实验存在
    const snapshotAbs = path.join(this.snapshotsRootOf(workspaceDir), id, checkpointId)
    if (!fs.existsSync(snapshotAbs)) return { missing: true, files: [], fileCount: 0, totalBytes: 0 }
    const files: Array<{ relPath: string; size: number }> = []
    let totalBytes = 0
    const walk = (dir: string, depth: number): void => {
      if (depth > SNAPSHOT_MAX_DEPTH) return
      let entries: fs.Dirent[] = []
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full, depth + 1)
        } else if (entry.isFile()) {
          try {
            const size = fs.statSync(full).size
            files.push({ relPath: path.relative(snapshotAbs, full).split(path.sep).join('/'), size })
            totalBytes += size
          } catch {
            // 单文件不可读跳过
          }
        }
      }
    }
    walk(snapshotAbs, 0)
    return { missing: false, files, fileCount: files.length, totalBytes }
  }

  /**
   * 只读自然语言概览（§7.7.3：为旧实验自动生成概览，不反向覆盖 manifest）。
   * 确定性文本、不调用 LLM；供旧时间线兼容视图的只读摘要展示。
   */
  overview(workspaceDir: string, id: string): string {
    const m = this.read(workspaceDir, id)
    const lines: string[] = []
    const fmt = (ts: number): string => new Date(ts).toISOString().slice(0, 10)
    lines.push(`实验「${m.name ?? id}」`)
    if (typeof m.description === 'string' && m.description !== '') lines.push(`  描述：${m.description}`)
    lines.push(`  创建于 ${fmt(typeof m.createdAt === 'number' ? m.createdAt : 0)}，更新于 ${fmt(typeof m.updatedAt === 'number' ? m.updatedAt : 0)}`)
    const branches: readonly ExperimentBranch[] = Array.isArray(m.branches) ? m.branches : []
    if (branches.length === 0) {
      lines.push('  时间线：无分支/阶段记录（旧数据或空实验）')
    } else {
      for (const branch of branches) {
        const mark = branch.id === m.currentBranchId ? '（当前）' : ''
        lines.push(`  分支「${branch.name ?? branch.id}」${mark}`)
        const phases: readonly ExperimentPhase[] = Array.isArray(branch.phases) ? branch.phases : []
        for (const phase of phases) {
          const checkpoints: readonly ExperimentCheckpoint[] = Array.isArray(phase.checkpoints) ? phase.checkpoints : []
          const cpText = checkpoints.length === 0
            ? ''
            : ` → 检查点: ${checkpoints.map((c) => `「${c.name ?? c.id}」${c.rolledBack === true ? '（已回退）' : ''}`).join('、')}`
          lines.push(`    阶段「${phase.name ?? phase.id}」${cpText}`)
        }
      }
    }
    const sessions = Array.isArray(m.sessionIds) ? m.sessionIds : []
    if (sessions.length > 0) lines.push(`  关联会话：${sessions.join('、')}`)
    return lines.join('\n')
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
   *
   * EXP-13（§7.7.5）：回退会覆盖工作区文件，必须显式确认——
   * opts.confirm !== true 时抛错；由 UI 弹确认框后再调用。
   * api.ts experimentsRollback 需更新为把 UI 确认结果透传（见
   * 实验服务统一接线）。
   */
  rollback(workspaceDir: string, id: string, checkpointId: string, opts?: { confirm?: boolean }): { restored: number; checkpointId: string; name: string } {
    if (opts?.confirm !== true) throw new Error('回退会覆盖工作区文件，需要明确确认（confirm: true）')
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
