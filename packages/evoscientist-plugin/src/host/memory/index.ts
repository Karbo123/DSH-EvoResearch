/**
 * EvoMemory v2/v3 编排层（MemoryRuntime）：
 * - 订阅 DSH 会话事件（session/event）：新用户消息 → Turn Catalog + 分类 + 记忆包缓存；
 *   turn 结束 → 完成/中断归档；
 * - 通过 systemPrompt.context 在每步模型调用前注入 <research_memory_packet>；
 * - 按项目（workspace_dir）懒打开各自的 research_memory.db；
 * - 注册记忆工具（search_research_history / read_research_turn / observations 等）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ResearchMemoryStore } from './store.js'
import { ResearchMemoryStore as Store } from './store.js'
import { classifyRequest, canonicalizeTopicKeys } from './classifier.js'
import { buildMemoryPacket, DEFAULT_PACKET_TOKEN_BUDGET } from './packet.js'
import type { MemoryPacket } from '../../shared/types.js'
import { registerMemoryTools } from './tools.js'
import { reconcileStore } from './recovery.js'
import { ensureGoalContract, looksLongHorizon, type GoalRuntime } from './goals.js'
import type { ResearchCategory } from '../../shared/types.js'

/** 记忆插件配置。 */
export interface MemoryConfig {
  /** 部署根目录（projects/ 所在目录）。 */
  readonly dataRoot: string
  /** 记忆包 token 预算。 */
  readonly tokenBudget?: number
  /** 分类/Goal 提取使用的模型；缺省时取 agentDefaultModel 当前选择。 */
  readonly auxiliaryModel?: { provider: string; model: string }
  /** 是否启用科研记忆（默认 true）。 */
  readonly enabled?: boolean
}

/** 当前轮状态（每会话一条）。 */
interface ActiveTurn {
  readonly turnId: string
  readonly workspaceDir: string
  readonly userText: string
  startedAt: number
}

/** 解析后的记忆配置（必填项已解析）。 */
interface ResolvedMemoryConfig {
  readonly dataRoot: string
  readonly tokenBudget: number
  readonly auxiliaryModel?: { provider: string; model: string }
  readonly enabled: boolean
}

/** EvoMemory 运行时门面。 */
export class MemoryRuntime implements GoalRuntime {
  readonly config: ResolvedMemoryConfig
  private readonly stores = new Map<string, ResearchMemoryStore>()
  private readonly packets = new Map<string, MemoryPacket>()
  private readonly activeTurns = new Map<string, ActiveTurn>()
  private readonly reconciled = new Set<string>()
  private lastActiveSessionId: string | undefined
  /** 最近一次分类模型选择（缓存，避免每轮查询）。 */
  private cachedModel: { provider: string; model: string } | undefined

  constructor(config: MemoryConfig) {
    this.config = {
      dataRoot: config.dataRoot,
      tokenBudget: config.tokenBudget ?? DEFAULT_PACKET_TOKEN_BUDGET,
      auxiliaryModel: config.auxiliaryModel,
      enabled: config.enabled ?? true,
    }
  }

  /** 获取某工作区的记忆库（按项目懒打开并缓存；首次打开执行 v3 启动对账）。 */
  storeFor(workspaceDir: string): ResearchMemoryStore {
    const key = workspaceDir || this.config.dataRoot
    let store = this.stores.get(key)
    if (!store) {
      store = Store.open(this.memoryDirFor(workspaceDir))
      this.stores.set(key, store)
      // v3 启动对账：每项目每进程一次（quick_check/轮换备份/悬挂对账/补归档）
      if (!this.reconciled.has(key)) {
        this.reconciled.add(key)
        try {
          const result = reconcileStore(store, { backupDir: path.join(this.memoryDirFor(workspaceDir), 'backups') })
          if (!result.skipped && (result.markedInterrupted > 0 || result.archivedMissing > 0 || result.backedUp)) {
            console.log(`[evosci:memory] 启动对账（${path.basename(key)}）: 悬挂标记 ${result.markedInterrupted}，补归档 ${result.archivedMissing}，备份 ${result.backedUp}`)
          }
        } catch (error) {
          console.error('[evosci:memory] 启动对账失败（不阻塞）:', error)
        }
      }
    }
    return store
  }

  /** 项目记忆目录（.evosci-data/memories）。 */
  private memoryDirFor(workspaceDir: string): string {
    const base = workspaceDir && workspaceDir !== this.config.dataRoot
      ? workspaceDir
      : this.config.dataRoot
    return path.join(base, '.evosci-data', 'memories')
  }

  /** 观测目录。 */
  observationsDirFor(workspaceDir: string): string {
    return path.join(this.memoryDirFor(workspaceDir), 'observations')
  }

  /** 当前记忆包（供 systemPrompt.context 注入）。 */
  latestPacketText(): string {
    if (!this.lastActiveSessionId) return ''
    const packet = this.packets.get(this.lastActiveSessionId)
    return packet ? packet.text : ''
  }

  /** 查询某会话最近记忆包（WebUI 展示用）。 */
  packetFor(sessionId: string): MemoryPacket | undefined {
    return this.packets.get(sessionId)
  }

  /** 组装 model 选择：优先显式配置，其次 agentDefaultModel。 */
  private async resolveModel(ctx: Context): Promise<{ provider: string; model: string }> {
    if (this.cachedModel) return this.cachedModel
    if (this.config.auxiliaryModel) {
      this.cachedModel = this.config.auxiliaryModel
      return this.cachedModel
    }
    const agentDefaultModel = ctx.get('agentDefaultModel')
    if (agentDefaultModel) {
      const selection = agentDefaultModel.currentSelection() as { provider?: string; model?: string }
      if (selection?.provider && selection?.model) {
        this.cachedModel = { provider: selection.provider, model: selection.model }
        return this.cachedModel
      }
    }
    this.cachedModel = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    return this.cachedModel
  }

  /** 挂载全部副作用（事件订阅、prompt 注入、工具注册）。 */
  attach(ctx: Context): () => void {
    if (!this.config.enabled) return () => {}
    const disposers: Array<() => void> = []

    // 1) 会话事件订阅：新用户消息 → Turn Catalog；turn 结束 → 归档
    disposers.push(
      ctx.on('session/event', (session: Session, event: SessionEvent) => {
        void this.handleSessionEvent(ctx, session, event).catch((error) => {
          console.error('[evosci:memory] 会话事件处理失败:', error)
        })
      }),
    )

    // 2) 记忆包注入：每步模型调用前的动态 context
    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt) {
      disposers.push(
        systemPrompt.context({
          name: 'evosci:research-memory',
          order: 60,
          text: () => this.latestPacketText(),
        }),
      )
    }

    // 3) 记忆工具
    disposers.push(registerMemoryTools(ctx, this))

    return () => {
      for (const dispose of disposers) dispose()
      for (const store of this.stores.values()) store.close()
      this.stores.clear()
    }
  }

  private async handleSessionEvent(ctx: Context, session: Session, event: SessionEvent): Promise<void> {
    if (event.type === 'user/message') {
      const message = event.data as SessionEvent<'user/message'>['data']
      const source = (message as { source?: { kind?: string } }).source
      // 只处理真人用户消息（source.kind === 'user'）；注入类消息（plugin/cron）不建 Turn
      if (source?.kind !== 'user') return
      const text = extractUserText(message)
      if (!text) return
      const workspaceDir = (session.header as { cwd?: string }).cwd ?? this.config.dataRoot
      const turnId = randomUUID()
      this.lastActiveSessionId = session.id
      this.activeTurns.set(session.id, { turnId, workspaceDir, userText: text, startedAt: Date.now() })
      // 先落 pending Turn（不等待分类）
      this.storeFor(workspaceDir).createPendingTurn({
        turnId,
        sessionId: session.id,
        workspaceDir,
        userText: text,
        categories: [],
        topicKeys: [],
      })
      // 后台异步：分类 + topic 归一化 + 记忆包构建（主请求不承担延迟）
      void this.processTurnBackground(ctx, session.id, turnId, workspaceDir, text)
      return
    }
    if (event.type === 'turn/end') {
      const active = this.activeTurns.get(session.id)
      if (!active) return
      const data = event.data as SessionEvent<'turn/end'>['data']
      const reason = data?.reason as { kind?: string } | undefined
      const store = this.storeFor(active.workspaceDir)
      const interrupted = reason?.kind === 'rejected' || reason?.kind === 'cancelled' || reason?.kind === 'error'
      if (interrupted) {
        store.updateTurn(active.turnId, {
          status: 'interrupted',
          interruptReason: reason?.kind === 'error' ? 'api_failure' : 'user_stop',
        })
      } else {
        store.updateTurn(active.turnId, { status: 'completed' })
      }
      // v3 Raw Turn Archive：轮次收尾后把原始内容分页归档（不可变档案，活跃投影保留）
      const settled = store.getTurn(active.turnId)
      if (settled) store.archiveTurn(settled)
      this.activeTurns.delete(session.id)
    }
  }

  /** 后台：分类 + topic state 更新 + 记忆包构建（不 await，失败静默）。 */
  private async processTurnBackground(
    ctx: Context,
    sessionId: string,
    turnId: string,
    workspaceDir: string,
    text: string,
  ): Promise<void> {
    try {
      const { provider, model } = await this.resolveModel(ctx)
      const store = this.storeFor(workspaceDir)
      const result = await classifyRequest(ctx, provider, model, text)
      // topic 归一化（复用已有 topic key）
      const existing = new Map<ResearchCategory, Array<{ topicKey: string; label: string }>>()
      for (const state of store.listTopicStates()) {
        const list = existing.get(state.category) ?? []
        list.push({ topicKey: state.topicKey, label: state.label })
        existing.set(state.category, list)
      }
      const topicEntries = canonicalizeTopicKeys(existing, result, text)
      store.updateTurn(turnId, {
        categories: result.categories,
        topicKeys: topicEntries.map((entry) => entry.topicKey),
      })
      // 更新 topic state（追加来源）
      for (const entry of topicEntries) {
        const states = store.listTopicStates(entry.category)
        const current = states.find((state) => state.topicKey === entry.topicKey)
        const sourceTurnIds = [...(current?.sourceTurnIds ?? []), turnId].slice(-20)
        store.upsertTopicState({
          category: entry.category,
          topicKey: entry.topicKey,
          label: entry.label,
          decision: current?.decision ?? '',
          openQuestions: current?.openQuestions ?? [],
          sourceTurnIds,
          updatedAt: Date.now(),
        })
      }
      // 长程目标检测（v3）：仅当文本看起来像长期任务
      if (looksLongHorizon(text)) {
        await ensureGoalContract(ctx, this, { provider, model }, store, text, sessionId)
      }
      // 记忆包（以当前轮文本为查询）
      const packet = await buildMemoryPacket(store, {
        tokenBudget: this.config.tokenBudget,
        query: text,
        categories: result.categories,
      })
      this.packets.set(sessionId, packet)
    } catch (error) {
      console.error('[evosci:memory] 后台分类/记忆包失败（不影响主回答）:', error)
    }
  }
}

/** 从 UserMessage 提取文本（ContentBlock 的 text 拼接）。 */
function extractUserText(message: { content?: unknown }): string {
  const content = message.content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      const b = block as { type?: string; text?: string }
      return typeof b?.text === 'string' ? b.text : ''
    })
    .join('')
    .trim()
}
