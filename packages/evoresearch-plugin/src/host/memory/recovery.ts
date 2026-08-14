/**
 * EvoMemory v3 启动对账（recovery）：项目记忆库的一致性维护。
 *
 * 对齐 EvoResearch memory/research/recovery.py：
 * - PRAGMA quick_check：损坏的库跳过不写（只记录日志，不阻塞启动）；
 * - 双份轮换备份：backups/research_memory.v3.1.db / .v3.2.db（每次对账轮换，
 *   崩溃恢复以持久化边界为准，配合 PRAGMA synchronous=FULL）；
 * - Turn/Attempt 对账：悬挂 pending 轮次（模型调用超时/进程崩溃遗留）标记为
 *   interrupted（api_failure），保证状态机不悬挂；
 * - 未归档消息补写：已 completed/interrupted 但缺少归档分段的轮次补 archiveTurn
 *   （进程在 turn/end 与归档之间崩溃的兜底）。
 *
 * 幂等：每项目每进程只执行一次（MemoryRuntime 持有 reconcile 标记）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { ResearchMemoryStore } from './store.js'

/** 对账选项。 */
export interface ReconcileOptions {
  /** 备份目录（缺省 <memoryDir>/backups）。 */
  readonly backupDir?: string
  /** 悬置判定：pending 轮次超过该时长（毫秒）视为悬挂（默认 1 小时）。 */
  readonly stalePendingMs?: number
}

/** 对账结果（供日志/WebUI 展示）。字段可变（对账过程累加）。 */
export interface ReconcileResult {
  dbHealthy: boolean
  backedUp: boolean
  markedInterrupted: number
  archivedMissing: number
  skipped: boolean
}

/** 轮换备份：保留两份（v3.1 / v3.2），每次对账交替覆盖最旧的一份。 */
export function rotateBackup(memoryDir: string, backupDir?: string): boolean {
  const dir = backupDir ?? path.join(memoryDir, 'backups')
  fs.mkdirSync(dir, { recursive: true })
  const source = path.join(memoryDir, 'research_memory.db')
  if (!fs.existsSync(source)) return false
  // 双份轮换：存在两份时覆盖较旧的那份（按 mtime），否则依次创建。
  const b1 = path.join(dir, 'research_memory.v3.1.db')
  const b2 = path.join(dir, 'research_memory.v3.2.db')
  const exists1 = fs.existsSync(b1)
  const exists2 = fs.existsSync(b2)
  let target: string
  if (!exists1) {
    target = b1
  } else if (!exists2) {
    target = b2
  } else {
    // 覆盖 mtime 更旧的一份
    target = fs.statSync(b1).mtimeMs <= fs.statSync(b2).mtimeMs ? b1 : b2
  }
  // 原子写：先复制到临时文件再改名
  const tmp = `${target}.tmp`
  fs.copyFileSync(source, tmp)
  fs.renameSync(tmp, target)
  return true
}

/**
 * 对账一个项目记忆库。
 * @param store 项目记忆库。
 * @param options 对账选项。
 * @returns 对账结果。
 */
export function reconcileStore(store: ResearchMemoryStore, options: ReconcileOptions = {}): ReconcileResult {
  const result: ReconcileResult = {
    dbHealthy: true,
    backedUp: false,
    markedInterrupted: 0,
    archivedMissing: 0,
    skipped: false,
  }

  // 1) quick_check：损坏即跳过全部写操作（不备份不修改）
  try {
    const check = store.db.db.prepare('PRAGMA quick_check').get() as { quick_check?: string }
    if (check?.quick_check !== 'ok') {
      result.dbHealthy = false
      result.skipped = true
      return result
    }
  } catch {
    result.dbHealthy = false
    result.skipped = true
    return result
  }

  // 2) 双份轮换备份（backupDir 未提供时跳过——reconcileMemoryDir 总会提供）
  if (options.backupDir) {
    result.backedUp = rotateBackup(options.backupDir, options.backupDir)
  }

  // 3) Turn/Attempt 对账：悬挂 pending → interrupted（api_failure）
  const stalePendingMs = options.stalePendingMs ?? 60 * 60 * 1000
  const now = Date.now()
  const openTurns = store.listOpenTurns()
  for (const turn of openTurns) {
    if (turn.status !== 'pending') continue
    if (now - turn.updatedAt < stalePendingMs) continue
    store.updateTurn(turn.turnId, { status: 'interrupted', interruptReason: 'api_failure' })
    result.markedInterrupted += 1
  }

  // 4) 未归档消息补写：completed/interrupted 但缺归档分段的轮次补归档
  const recent = store.listTurns(undefined, 200)
  for (const turn of recent) {
    if (turn.status === 'pending') continue
    const segments = store.listSegments(turn.turnId)
    // 归档判定：user 段存在即视为已归档（v2 库的旧轮次无 segments 属正常，跳过）
    const hasUserSegment = segments.some((s) => s.kind === 'user')
    if (hasUserSegment) continue
    // 只补写确实有内容的轮次（避免为空白轮次产生无意义档案）
    if (turn.userText.length === 0 && turn.assistantText.length === 0) continue
    store.archiveTurn(turn)
    result.archivedMissing += 1
  }

  return result
}

/** 便捷入口：打开记忆库并对账（供 MemoryRuntime 首次 storeFor 调用）。 */
export function reconcileMemoryDir(memoryDir: string, options: ReconcileOptions = {}): ReconcileResult | undefined {
  const dbFile = path.join(memoryDir, 'research_memory.db')
  if (!fs.existsSync(dbFile)) return undefined
  let store: ResearchMemoryStore
  try {
    store = ResearchMemoryStore.open(memoryDir)
  } catch {
    // 库文件无法打开（损坏/格式错误）：返回损坏结果，跳过一切写操作
    return { dbHealthy: false, backedUp: false, markedInterrupted: 0, archivedMissing: 0, skipped: true }
  }
  try {
    return reconcileStore(store, {
      backupDir: options.backupDir ?? path.join(memoryDir, 'backups'),
      stalePendingMs: options.stalePendingMs,
    })
  } finally {
    store.close()
  }
}
