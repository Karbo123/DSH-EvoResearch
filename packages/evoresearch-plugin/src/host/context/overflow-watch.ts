/**
 * P1-4 上下文超限自动映射重试（OverflowWatch）。
 *
 * 背景：guard.ts 的 ContextWindowRuntime 已有 overflowRetry(session)（压缩 →
 * 重试编排），但目前无人监听真实的 provider context-limit 错误。DSH 会话事件
 * turn/end 的 data.reason.kind === 'error' 表示回合异常结束，错误详情（LlmFailure）
 * 在 reason 内。本模块订阅 session/event、识别超限特征文本、触发一次
 * overflowRetry，带 per-session 冷却与同 turn 去重防循环。
 *
 * 解耦：不 import guard 的具体类，只依赖最小结构接口（status + overflowRetry）。
 */
import type { Context } from '@deepseek-ai/cordis'
// 引入类型即加载 'session/event' 事件签名增强（与 guard.ts 同法）
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/** 各 provider 的 context-limit 错误特征表（小写匹配源码文本）。 */
export const CONTEXT_LIMIT_PATTERNS: readonly RegExp[] = [
  /maximum context length/i,
  /context[_ ]length(_exceeded)?/i,
  /context window/i,
  /too many (input )?tokens/i,
  /reduce the length/i,
  /input tokens exceed/i,
  /prompt is too long/i,
  /上下文(长度|窗口)(超|超出|过)/,
  /超出上下文/,
]

/**
 * 匹配 context-limit 错误特征。
 * @returns 命中的 pattern 字符串形式（String(pattern)）；未命中返回 null。
 */
export function matchContextLimitError(text: string): string | null {
  for (const pattern of CONTEXT_LIMIT_PATTERNS) {
    if (pattern.test(text)) return String(pattern)
  }
  return null
}

/** guard 的最小结构契约（避免耦合 ContextWindowRuntime 具体类）。 */
export interface OverflowWatchGuard {
  /** 适配可用性：compaction 为 true 时 overflowRetry 才有实际压缩能力。 */
  status(): { compaction: boolean }
  /** 溢出恢复编排（裁剪 + context-overflow 压缩）。 */
  overflowRetry(session: unknown, options?: unknown): Promise<unknown>
}

/** OverflowWatch 配置。 */
export interface OverflowWatchOptions {
  guard: OverflowWatchGuard
  /** 会话 id → 会话对象解析（缺省或返回 undefined 时跳过触发）。 */
  getSession?: (sessionId: string) => unknown
  /** 同会话两次触发的最小间隔毫秒数（默认 60_000）。 */
  cooldownMs?: number
  /** 日志出口（默认 console.log 带 '[evoresearch:context]' 前缀）。 */
  logger?: (msg: string) => void
}

/** 默认冷却：60 秒。 */
const DEFAULT_COOLDOWN_MS = 60_000

/** 错误文本截断上限（JSON.stringify(reason) 可能很大）。 */
const REASON_TEXT_MAX = 2000

/** 默认日志前缀。 */
const LOG_PREFIX = '[evoresearch:context]'

/**
 * 超限监视器：监听 turn/end 异常结束事件，识别 context-limit 特征后触发一次
 * overflowRetry。用法：
 * ```ts
 * const watch = new OverflowWatch({ guard, getSession })
 * const detach = watch.attach(ctx)
 * ```
 */
export class OverflowWatch {
  private readonly guard: OverflowWatchGuard
  private readonly getSession: ((sessionId: string) => unknown) | undefined
  private readonly cooldownMs: number
  private readonly logger: (msg: string) => void
  /** per-session 上次触发时间戳（epoch ms）。 */
  private readonly lastFiredAt = new Map<string, number>()
  /** per-session 上次已处理的 turn 号（同一 turn 只触发一次）。 */
  private readonly lastTurnBySession = new Map<string, number>()
  /** compaction 不可用的进程级告警只打一次。 */
  private compactionWarned = false
  private attachedCtx: Context | undefined

  constructor(options: OverflowWatchOptions) {
    this.guard = options.guard
    this.getSession = options.getSession
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS
    this.logger = options.logger ?? ((msg) => console.log(msg))
  }

  /**
   * 挂载事件订阅。重复 attach 幂等（返回首次的 disposer）。
   * @returns detach disposer。
   */
  attach(ctx: Context): () => void {
    if (this.attachedCtx === ctx && this.currentDisposer !== undefined) {
      return this.currentDisposer
    }
    this.attachedCtx = ctx
    const dispose = ctx.on('session/event', (session: Session, event: SessionEvent) => {
      try {
        this.handleEvent(session as unknown as { id?: string }, event as unknown as { type?: string; data?: unknown })
      } catch (error) {
        // 监视器自身异常绝不影响会话事件流
        this.logger(`${LOG_PREFIX} 超限监视器处理事件失败（忽略）: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
    this.currentDisposer = () => {
      dispose()
      this.attachedCtx = undefined
      this.currentDisposer = undefined
    }
    return this.currentDisposer
  }

  private currentDisposer: (() => void) | undefined

  /** 事件处理主流程（步骤见模块注释与内联标注）。 */
  private handleEvent(session: { id?: string }, event: { type?: string; data?: unknown }): void {
    // 1) 只关心异常结束的回合
    if (event?.type !== 'turn/end') return
    const data = (event.data ?? {}) as { reason?: { kind?: string }; turn?: number }
    if (data.reason?.kind !== 'error') return

    const sessionId = typeof session?.id === 'string' ? session.id : ''
    if (sessionId === '') return

    // 2) 序列化错误详情并匹配特征
    let text = ''
    try {
      text = JSON.stringify(data.reason).slice(0, REASON_TEXT_MAX)
    } catch {
      return
    }
    const hit = matchContextLimitError(text)
    if (hit === null) return

    // 3) 冷却 + 同 turn 去重（防循环：压缩失败重放不会连环触发）
    const now = Date.now()
    const lastTurn = this.lastTurnBySession.get(sessionId)
    if (typeof data.turn === 'number' && lastTurn === data.turn) return
    const lastFiredAt = this.lastFiredAt.get(sessionId)
    if (lastFiredAt !== undefined && now - lastFiredAt < this.cooldownMs) return

    // 4) compaction 适配不可用 → 每进程只告警一次，降级为仅记录
    let compactionAvailable: boolean
    try {
      compactionAvailable = this.guard.status().compaction === true
    } catch {
      return
    }
    if (!compactionAvailable) {
      if (!this.compactionWarned) {
        this.compactionWarned = true
        this.logger(`${LOG_PREFIX} compaction 适配不可用，超限重试降级为仅记录`)
      }
      // 记录去重状态，避免同一错误反复走到这里
      this.markFired(sessionId, data.turn, now)
      return
    }

    // 5) 解析会话对象；拿不到就放弃本次触发
    const target = this.getSession?.(sessionId)
    if (target === undefined || target === null) return

    // 6) 触发一次压缩重试（异步，失败只记日志）
    this.markFired(sessionId, data.turn, now)
    this.logger(`会话 ${sessionId} 检测到上下文超限（${hit}），已触发一次压缩重试`)
    void (this.guard.overflowRetry(target, { trigger: 'watch' }) as Promise<unknown>).catch((err: unknown) => {
      this.logger(`${LOG_PREFIX} 会话 ${sessionId} 超限压缩重试失败: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  /** 记录触发状态（冷却起点 + turn 号）。 */
  private markFired(sessionId: string, turn: number | undefined, at: number): void {
    this.lastFiredAt.set(sessionId, at)
    if (typeof turn === 'number') this.lastTurnBySession.set(sessionId, turn)
  }
}
