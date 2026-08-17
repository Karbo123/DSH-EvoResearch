/**
 * 科研记忆 启动对账（recovery）：项目记忆库的一致性维护。
 *
 * 对齐 EvoResearch memory/research/recovery.py：
 * - PRAGMA quick_check：损坏的库跳过不写（只记录日志，不阻塞启动）；
 * - 双份轮换备份：backups/research_memory.v3.1.db / .v3.2.db（每次对账轮换，
 *   崩溃恢复以持久化边界为准，配合 PRAGMA synchronous=FULL）；
 * - Turn/Attempt 对账：悬挂 pending 轮次（模型调用超时/进程崩溃遗留）标记为
 *   interrupted（api_failure），保证状态机不悬挂；
 * - MEM-08 assistant 文本补回：completed/interrupted 但 assistant_text 为空的
 *   轮次，按 (sessionId, userText) 从 DSH session log（readSessionEvents）匹配
 *   轮次并补回完整正文（session-text.ts 还原）；
 * - 未归档消息补写：已 completed/interrupted 但缺少归档分段的轮次补 archiveTurn
 *   （进程在 turn/end 与归档之间崩溃的兜底；archiveTurn 本身幂等）。
 *
 * MEM-09 兜底约定：DSH session log 是对话原文的最终兜底（永不清除）；本库
 * research_memory.db（含 FTS 索引，见 store.ts rebuildFtsIndexes()）只是可重建的
 * 检索镜像——轮次原文缺失时可由本模块从 session log 补回，索引损坏可重建，
 * 数据库整体可删除后由归档流程重建。
 *
 * 幂等：每项目每进程只执行一次（MemoryRuntime 持有 reconcile 标记）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { ResearchMemoryStore } from './store.js'
import { readSessionEvents } from '../rewind.js'
import { turnsFromEvents, type SessionEventLike } from '../session-text.js'
import { cleanForIndex } from '../core/db.js'
import type { TurnRecord } from '../../shared/types.js'

/** 对账选项。 */
export interface ReconcileOptions {
  /** 备份目录（缺省 <memoryDir>/backups）。 */
  readonly backupDir?: string
  /** 悬置判定：pending 轮次超过该时长（毫秒）视为悬挂（默认 1 小时）。 */
  readonly stalePendingMs?: number
  /** MEM-08：会话事件提供器（测试注入；缺省 readSessionEvents）。 */
  readonly eventsOf?: (sessionId: string) => readonly SessionEventLike[]
  /** MEM-08：最多扫描多少轮（默认 200）。 */
  readonly recoverAssistantLimit?: number
}

/** 对账结果（供日志/WebUI 展示）。字段可变（对账过程累加）。 */
export interface ReconcileResult {
  dbHealthy: boolean
  backedUp: boolean
  markedInterrupted: number
  archivedMissing: number
  /** MEM-08：从 DSH session log 补回的 assistant 正文轮次数。 */
  assistantRecovered: number
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
    assistantRecovered: 0,
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
  if (options.backupDir && store.memoryDir !== undefined) {
    result.backedUp = rotateBackup(store.memoryDir, options.backupDir)
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

  // 3b) MEM-08：completed/interrupted 但 assistant_text 为空 → 从 DSH session log 补回
  const recovery = recoverMissingAssistantText(store, {
    eventsOf: options.eventsOf,
    limit: options.recoverAssistantLimit ?? 200,
  })
  result.assistantRecovered = recovery.recovered

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

/**
 * MEM-08：assistant 正文补回。
 * 找出 completed/interrupted 但 assistant_text 为空的轮次，按 (sessionId, userText)
 * 从 DSH session log 匹配轮次并补回完整正文；补回后重跑 archiveTurn（幂等，
 * MEM-07）补齐缺失的 assistant 归档段。DSH session log 是最终兜底原文（MEM-09）。
 *
 * @param store 项目记忆库。
 * @param options.eventsOf 会话事件提供器（测试注入；缺省 readSessionEvents，失败跳过）。
 * @param options.limit 最多扫描多少轮（最新优先，默认 200）。
 * @returns 补回的轮次数。
 */
export function recoverMissingAssistantText(
  store: ResearchMemoryStore,
  options: { eventsOf?: (sessionId: string) => readonly SessionEventLike[]; limit?: number } = {},
): { recovered: number } {
  const eventsOf = options.eventsOf ?? ((sessionId: string): readonly SessionEventLike[] => {
    try {
      return readSessionEvents(sessionId)
    } catch {
      return [] // 会话日志不存在/不可读：跳过该会话，不阻塞对账
    }
  })
  const turns = store.listTurns(undefined, options.limit ?? 200)
  const missing = turns.filter(
    (t) => (t.status === 'completed' || t.status === 'interrupted') && t.assistantText.length === 0,
  )
  // 按会话分组：每个会话只读一次日志
  const bySession = new Map<string, TurnRecord[]>()
  for (const turn of missing) {
    const list = bySession.get(turn.sessionId)
    if (list) list.push(turn)
    else bySession.set(turn.sessionId, [turn])
  }

  let recovered = 0
  for (const [sessionId, turnsInSession] of bySession) {
    const events = eventsOf(sessionId)
    if (events.length === 0) continue
    const transcripts = turnsFromEvents(events)
    // 同一 userText 取日志中最近的一轮（DB 侧 listTurns 也是最新优先）
    const latestByUser = new Map<string, { assistantText: string }>()
    for (const transcript of transcripts) {
      latestByUser.set(cleanForIndex(transcript.userText), { assistantText: transcript.assistantText })
    }
    for (const turn of turnsInSession) {
      const match = latestByUser.get(cleanForIndex(turn.userText))
      if (!match || match.assistantText === '') continue
      store.updateTurn(turn.turnId, { assistantText: match.assistantText })
      // 补回后重跑归档（幂等）：未归档 → 全量归档；已归档但缺 assistant 段 → 补齐
      const updated = store.getTurn(turn.turnId)
      if (updated) store.archiveTurn(updated)
      recovered += 1
    }
  }
  return { recovered }
}

/** SQLite 文件头魔数（16 字节）。 */
const SQLITE_MAGIC = Buffer.from('SQLite format 3\u0000', 'latin1')

/**
 * 快速校验文件是否为 SQLite 数据库（读前 16 字节比对魔数）。
 * 避免对损坏/格式错误文件调用 DatabaseSync 打开：node:sqlite 对非 SQLite 文件
 * 打开不报错、首个 PRAGMA 才抛错，句柄会泄漏（Windows 下目录无法删除，EPERM）。
 */
function looksLikeSqlite(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(16)
      const read = fs.readSync(fd, buf, 0, 16, 0)
      return read === 16 && buf.equals(SQLITE_MAGIC)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return false
  }
}

/** 便捷入口：打开记忆库并对账（供 MemoryRuntime 首次 storeFor 调用）。 */
export function reconcileMemoryDir(memoryDir: string, options: ReconcileOptions = {}): ReconcileResult | undefined {
  const dbFile = path.join(memoryDir, 'research_memory.db')
  if (!fs.existsSync(dbFile)) return undefined
  // 非 SQLite 文件（损坏/格式错误）：不打开（避免句柄泄漏），直接返回损坏结果
  if (!looksLikeSqlite(dbFile)) {
    return { dbHealthy: false, backedUp: false, markedInterrupted: 0, archivedMissing: 0, assistantRecovered: 0, skipped: true }
  }
  let store: ResearchMemoryStore
  try {
    store = ResearchMemoryStore.open(memoryDir)
  } catch {
    // 库文件无法打开（损坏/格式错误）：返回损坏结果，跳过一切写操作
    return { dbHealthy: false, backedUp: false, markedInterrupted: 0, archivedMissing: 0, assistantRecovered: 0, skipped: true }
  }
  try {
    return reconcileStore(store, {
      backupDir: options.backupDir ?? path.join(memoryDir, 'backups'),
      stalePendingMs: options.stalePendingMs,
      eventsOf: options.eventsOf,
      recoverAssistantLimit: options.recoverAssistantLimit,
    })
  } finally {
    store.close()
  }
}
