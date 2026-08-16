/**
 * 回溯服务（§回溯：聊天记录 + 工作区文件 完全回溯，Git 支撑）。
 *
 * 机制（fork 分支式，官方 session.fork atSeq 截断点）：
 * - 每完成一个回合，host 自动提交项目工作区（git commit "auto-turn N"）；
 * - 回溯/编辑 = 以目标消息之前的事件为边界 fork 出截断历史的子会话（新的独立会话，
 *   旧会话保留——git 式"分支"语义）：
 *   ① git：先安全提交当前工作区（rewind-safety），再 reset --hard 到目标回合完成后的
 *      自动提交（工作区文件回到当时）；② fork 子会话（历史 = 目标点之前）；
 *   ③ 前端打开子会话；编辑场景下前端对子会话发送修正文本（官方 prompt 流程）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { zstdDecompressSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'

const GIT_NAME = 'EvoResearch'
const GIT_EMAIL = 'evoresearch@localhost'

/** 运行 git 命令（注入身份；成功返回 stdout，失败抛错）。 */
function git(dir: string, args: string[], timeoutMs = 120000): string {
  const result = spawnSync('git.exe', ['-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} 失败: ${(result.stderr ?? '').trim().slice(0, 300) || `exit ${String(result.status)}`}`)
  }
  return (result.stdout ?? '').trim()
}

/** 会话持久化根（<DSH_HOME>/sessions/；子目录按会话 cwd 编码组织）。 */
function sessionsRoot(): string {
  const home = process.env.DSH_HOME ?? path.join(homedir(), '.dsh')
  return path.join(home, 'sessions')
}

interface SessionEvent { [key: string]: unknown; type: string; seq?: number }

/** 定位会话日志目录（sessions/<编码cwd>/<sessionId>/，扫描所有子目录）。 */
function findSessionDir(sessionId: string): string | null {
  const root = sessionsRoot()
  let entries: string[] = []
  try {
    entries = fs.readdirSync(root)
  } catch {
    return null
  }
  for (const name of entries) {
    const candidate = path.join(root, name, sessionId)
    if (fs.statSync(candidate, { throwIfNoEntry: false })?.isDirectory()) return candidate
  }
  return null
}

/** 读取会话事件日志（支持多帧 zstd 与纯 jsonl）。 */
function readSessionEvents(sessionId: string): SessionEvent[] {
  const dir = findSessionDir(sessionId)
  if (dir === null) throw new Error(`会话日志不存在: ${sessionId}`)
  const zstd = path.join(dir, 'session.jsonl.zstd')
  const plain = path.join(dir, 'session.jsonl')
  let buffer: Buffer
  if (fs.existsSync(zstd)) {
    const raw = fs.readFileSync(zstd)
    const magic = Buffer.from([0x28, 0xB5, 0x2F, 0xFD])
    const offsets: number[] = []
    let idx = 0
    while ((idx = raw.indexOf(magic, idx)) !== -1) { offsets.push(idx); idx += 4 }
    let out = ''
    for (let i = 0; i < offsets.length; i++) {
      const end = i + 1 < offsets.length ? offsets[i + 1] : raw.length
      out += zstdDecompressSync(raw.subarray(offsets[i], end)).toString('utf8')
    }
    buffer = Buffer.from(out)
  } else if (fs.existsSync(plain)) {
    buffer = fs.readFileSync(plain)
  } else {
    throw new Error(`会话日志不存在: ${sessionId}`)
  }
  const events: SessionEvent[] = []
  for (const line of buffer.toString('utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      events.push(JSON.parse(trimmed) as SessionEvent)
    } catch { /* 跳过损坏行 */ }
  }
  return events
}

/** 系统级注入内容前缀（user/message 事件中需跳过的"伪用户消息"——前端同源过滤）。 */
const SYSTEM_LEAK_PREFIXES = [
  'Current runtime context',
  'Current DSH file policy',
  'Approval prompts are disabled',
  'Approval policy',
  '<code_mode>',
  '<research_memory_packet>',
  '<identity_profile>',
  '<project_env>',
]

function isSystemText(text: string): boolean {
  const trimmed = text.trimStart()
  return SYSTEM_LEAK_PREFIXES.some((p) => trimmed.startsWith(p))
}

/** 回溯服务。 */
export class RewindService {
  constructor(readonly dataRoot: string) {}

  private assertProjectDir(projectDir: string): string {
    const base = path.resolve(this.dataRoot)
    const dir = path.resolve(projectDir || base)
    const t = dir.toLowerCase().replace(/\//g, '\\')
    const b = base.toLowerCase().replace(/\//g, '\\')
    if (t !== b && !t.startsWith(b.endsWith('\\') ? b : `${b}\\`)) {
      throw new Error(`工作区超出部署根目录: ${projectDir}`)
    }
    return dir
  }

  /** 确保 .gitignore 忽略 .venv/（避免回溯时误删虚拟环境）。 */
  private ensureGitIgnore(projectDir: string): void {
    const ignore = path.join(projectDir, '.gitignore')
    const lines = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8').split(/\r?\n/) : []
    if (!lines.some((l) => l.trim() === '.venv/')) {
      lines.push('.venv/')
      fs.writeFileSync(ignore, lines.join('\n'), 'utf8')
    }
  }

  /** 提交当前工作区（无变更时返回 null）。 */
  commitWorkspace(projectDir: string, message: string): string | null {
    const dir = this.assertProjectDir(projectDir)
    if (!fs.existsSync(path.join(dir, '.git'))) return null
    this.ensureGitIgnore(dir)
    git(dir, ['add', '-A'])
    const result = spawnSync('git.exe', ['-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`, 'commit', '-m', message], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 120000,
      windowsHide: true,
    })
    if (result.status !== 0) return null // 无变更
    return git(dir, ['rev-parse', 'HEAD'])
  }

  /** 工作区提交历史（最近 limit 条）。 */
  workspaceLog(projectDir: string, limit = 30): Array<{ sha: string; message: string; when: number }> {
    const dir = this.assertProjectDir(projectDir)
    if (!fs.existsSync(path.join(dir, '.git'))) return []
    const out = git(dir, ['log', '--format=%H%x1f%ct%x1f%s', '-n', String(limit)])
    return out.split('\n').filter((l) => l.trim() !== '').map((l) => {
      const [sha, ct, message] = l.split('\x1f')
      return { sha: sha ?? '', message: message ?? '', when: Number(ct ?? 0) * 1000 }
    })
  }

  /** 恢复工作区到某提交：先安全提交当前状态（rewind-safety），再 git reset --hard。 */
  restoreWorkspace(projectDir: string, targetSha: string): { safety: string | null; target: string } {
    const dir = this.assertProjectDir(projectDir)
    const safety = this.commitWorkspace(dir, `rewind-safety ${new Date().toISOString()}`)
    git(dir, ['reset', '--hard', targetSha])
    return { safety, target: targetSha }
  }

  /** 找到"某回合完成后"的自动提交（auto-turn N）。 */
  autoCommitForTurn(projectDir: string, turn: number): string | null {
    const commits = this.workspaceLog(projectDir, 100)
    const match = commits.find((c) => c.message.startsWith(`auto-turn ${turn}`))
    return match?.sha ?? null
  }

  // ── 会话信息（文件读取，只读）──────────────────────────────────────────

  /** 最近一条真实用户消息（跳过系统上下文注入；供前端展示回溯/编辑目标）。 */
  lastUserMessage(sessionId: string): { seq: number; text: string; turn: number } | null {
    const events = readSessionEvents(sessionId)
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i]!
      if (ev.type !== 'user/message' || typeof ev.seq !== 'number') continue
      const content = (ev.data as { content?: unknown })?.content
      const text = Array.isArray(content)
        ? content.map((b: any) => (b?.type === 'text' ? b.text : '')).join('').trim()
        : String(content ?? '')
      if (text === '' || isSystemText(text)) continue
      const turn = (ev.data as { turn?: number } | undefined)?.turn
      return { seq: ev.seq, text, turn: typeof turn === 'number' ? turn : 0 }
    }
    return null
  }

  /** 会话所属工作区（header.cwd，限 dataRoot 内；否则 null）。 */
  workspaceOfSession(sessionId: string): string | null {
    const events = readSessionEvents(sessionId)
    const header = events.find((e) => e.type === 'session')
    const cwd = header?.cwd
    if (typeof cwd !== 'string' || cwd === '') return null
    try {
      return this.assertProjectDir(cwd)
    } catch {
      return null
    }
  }

  /**
   * 回溯/编辑重发（fork 分支式）：
   * - fork：以 boundary（目标消息前一事件）截断派生子会话（历史 = 目标点之前）；
   * - git：工作区恢复到最后一次"目标回合前"的自动提交（先安全提交当前状态）。
   * @param ctx Cordis 上下文（sessions 服务）
   * @param sessionId 源会话
   * @param beforeSeq 目标用户消息 seq（fork 边界 = beforeSeq - 1）
   */
  rewindFork(ctx: Context, sessionId: string, beforeSeq: number): {
    ok: boolean
    childSessionId: string
    workspaceDir: string | null
    restoredCommit: string | null
    safetyCommit: string | null
    note?: string
  } {
    const store = ctx.get('sessions') as { get(id: string): { id: string; events: SessionEvent[]; header?: { cwd?: string } } | undefined } | undefined
    if (!store) throw new Error('sessions 服务不可用')
    const source = store.get(sessionId)
    if (!source) throw new Error(`会话不存在: ${sessionId}`)
    // 目标用户消息的回合号（工作区恢复点 = 该回合完成前的状态；user/message 事件
    // 本身不带 turn 字段，从事件流中的 turn/start 推导）
    let targetTurn = 0
    let currentTurn = 0
    for (const ev of source.events) {
      if (ev.type === 'turn/start' && typeof (ev.data as { turn?: number } | undefined)?.turn === 'number') {
        currentTurn = (ev.data as { turn?: number }).turn as number
      }
      if (ev.type === 'user/message' && typeof ev.seq === 'number' && ev.seq === beforeSeq) {
        targetTurn = currentTurn
        break
      }
    }
    // 1) 以「目标回合之前一回合的 turn/end」为边界截断 seed（对齐官方 fork 的
    //    cut 语义：含 turn/end，推进到下一个 turn/start 之前）；编辑/回溯第 1 回合
    //    时没有更早回合 → 空 seed（全新空白子会话）。
    const events = source.events
    let boundaryIdx = -1
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!
      if (ev.type !== 'turn/end') continue
      const turn = (ev.data as { turn?: number } | undefined)?.turn
      if (typeof turn === 'number' && turn === targetTurn - 1) boundaryIdx = i
    }
    let cut = boundaryIdx >= 0 ? events[boundaryIdx]!.seq! + 1 : 0
    if (boundaryIdx >= 0) {
      while (cut < events.length && events[cut]?.type !== 'turn/start') cut++
    }
    const seed = boundaryIdx >= 0 ? events.slice(0, cut) : []
    // 2) 官方路径：agents.create 以 seed 派生子会话（agent 拥有 live 会话，
    //    之后可直接 prompt/followup——store.fork 的 live 会话无法被 prompt 续跑）
    const agents = ctx.get('agents') as { create(opts: Record<string, unknown>): Promise<unknown> } | undefined
    if (!agents) throw new Error('agents 服务不可用')
    const childId = `session-${randomUUID()}`
    void agents.create({
      sessionId: childId,
      seed,
      meta: {
        ...(source.header?.cwd !== undefined ? { cwd: source.header.cwd } : {}),
        parentSession: source.id,
        seedLength: seed.length,
      },
      agentOptions: {},
    })
    // 3) git 工作区恢复（工作区从 live 会话 header 取，不依赖落盘文件）
    const cwd = source.header?.cwd
    let workspaceDir: string | null = null
    try {
      workspaceDir = typeof cwd === 'string' && cwd !== '' ? this.assertProjectDir(cwd) : null
    } catch {
      workspaceDir = null
    }
    let restoredCommit: string | null = null
    let safetyCommit: string | null = null
    let note: string | undefined
    if (workspaceDir !== null && targetTurn > 0) {
      const target = this.autoCommitForTurn(workspaceDir, targetTurn - 1)
      if (target !== null) {
        const result = this.restoreWorkspace(workspaceDir, target)
        restoredCommit = result.target
        safetyCommit = result.safety
      } else {
        note = '未找到目标回合的自动提交（回溯功能启用前的对话无法恢复文件，仅回溯聊天记录）'
      }
    }
    return { ok: true, childSessionId: childId, workspaceDir, restoredCommit, safetyCommit, note }
  }
}
