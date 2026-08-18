/**
 * 科研记忆 编排层（MemoryRuntime）：
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
import { TurnTextAccumulator, turnInterruptFromEndReason, type SessionEventLike } from '../session-text.js'
import type { ResearchCategory } from '../../shared/types.js'
import type { NotesService } from '../notes.js'

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

/**
 * 当前轮状态（每会话一条）：
 * - accumulator：MEM-02/03 现场累积 assistant 正文（chunk 增量 / 最终消息）与
 *   按原序的工具事件，turn/end 时汇总写回（MEM-04）并随档案归档（MEM-06）。
 */
interface ActiveTurn {
  readonly turnId: string
  readonly workspaceDir: string
  readonly userText: string
  readonly accumulator: TurnTextAccumulator
  startedAt: number
}

/** 解析后的记忆配置（必填项已解析）。 */
interface ResolvedMemoryConfig {
  readonly dataRoot: string
  readonly tokenBudget: number
  readonly auxiliaryModel?: { provider: string; model: string }
  readonly enabled: boolean
}

/** 科研记忆 运行时门面。 */
export class MemoryRuntime implements GoalRuntime {
  readonly config: ResolvedMemoryConfig
  private readonly stores = new Map<string, ResearchMemoryStore>()
  /** 正在被「清除数据」删除的工作区：期间禁止懒重开记忆库，避免 Windows 文件占用。 */
  private readonly deleting = new Set<string>()
  private readonly packets = new Map<string, MemoryPacket>()
  private readonly activeTurns = new Map<string, ActiveTurn>()
  private readonly reconciled = new Set<string>()
  private readonly backfilled = new Set<string>()
  private readonly fragmentBackfilled = new Set<string>()
  private ctxRef: Context | undefined
  /** 自由文本研究笔记写入口；由 host/index.ts 在组装完 NotesService 后接入。 */
  private notesService: NotesService | undefined
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
    if (this.deleting.has(key)) {
      throw new Error(`[evoresearch:memory] 工作区正在被清除（${key}），记忆库已关闭且不允许重开`)
    }
    let store = this.stores.get(key)
    if (!store) {
      store = Store.open(this.memoryDirFor(workspaceDir))
      this.stores.set(key, store)
      // v3 启动对账：每项目每进程一次（quick_check/轮换备份/悬挂对账/补归档）
      if (!this.reconciled.has(key)) {
        this.reconciled.add(key)
        try {
          const result = reconcileStore(store, { backupDir: path.join(this.memoryDirFor(workspaceDir), 'backups') })
          if (!result.skipped && (result.markedInterrupted > 0 || result.archivedMissing > 0 || result.backedUp || result.assistantRecovered > 0)) {
            console.log(`[evoresearch:memory] 启动对账（${path.basename(key)}）: 悬挂标记 ${result.markedInterrupted}，补归档 ${result.archivedMissing}，assistant 补回 ${result.assistantRecovered}，备份 ${result.backedUp}`)
          }
        } catch (error) {
          console.error('[evoresearch:memory] 启动对账失败（不阻塞）:', error)
        }
      }
      // v2 回填：既有会话历史后台 newest-first 索引进 Turn Catalog（每项目每进程一次）
      if (!this.backfilled.has(key)) {
        this.backfilled.add(key)
        void this.runBackfill(workspaceDir).catch((error) => {
          console.error('[evoresearch:memory] 历史回填失败（不阻塞）:', error)
        })
      }
      // RET-02：片段索引回填（既有轮次消息/自然段级；每项目每进程一次）
      if (!this.fragmentBackfilled.has(key)) {
        this.fragmentBackfilled.add(key)
        void this.runFragmentBackfill(workspaceDir).catch((error) => {
          console.error('[evoresearch:memory] 片段索引回填失败（不阻塞）:', error)
        })
      }
    }
    return store
  }

  /** 关闭并释放某工作区的记忆库连接（清除项目数据前调用，避免 Windows 文件占用）。 */
  closeStore(workspaceDir: string): void {
    const key = workspaceDir || this.config.dataRoot
    const store = this.stores.get(key)
    if (store !== undefined) {
      try {
        store.close()
      } catch {
        // 关闭失败不阻塞清除流程
      }
      this.stores.delete(key)
    }
  }

  /** 清除数据：标记工作区为删除中并关闭其记忆库，期间 storeFor 不再重开（防 Windows 锁）。 */
  beginDeletion(workspaceDir: string): void {
    const key = workspaceDir || this.config.dataRoot
    this.deleting.add(key)
    this.closeStore(workspaceDir)
  }

  /** 清除数据收尾：移除删除中标记。 */
  endDeletion(workspaceDir: string): void {
    this.deleting.delete(workspaceDir || this.config.dataRoot)
  }

  /** 项目记忆目录（.evoresearch-data/memories）。 */
  private memoryDirFor(workspaceDir: string): string {
    const base = workspaceDir && workspaceDir !== this.config.dataRoot
      ? workspaceDir
      : this.config.dataRoot
    return path.join(base, '.evoresearch-data', 'memories')
  }

  /** 后台回填：从 DSH sessionQuery 拉取该项目的历史会话事件并索引进 Turn Catalog。 */
  private async runBackfill(workspaceDir: string): Promise<void> {
    // sessionQuery 由 DSH 平台提供（web profile 挂载）；缺失时静默跳过
    const sessionQuery = this.ctxRef?.get('sessionQuery') as
      | { listSessions?: () => Promise<unknown[]>; listEvents?: (sessionId: string) => Promise<readonly unknown[]> }
      | undefined
    if (!sessionQuery?.listSessions || !sessionQuery.listEvents) return
    const store = this.storeFor(workspaceDir)
    const { backfillFromSessionQuery } = await import('./backfill.js')
    const created = await backfillFromSessionQuery(store, sessionQuery, workspaceDir)
    if (created > 0) {
      console.log(`[evoresearch:memory] 历史回填完成（${path.basename(workspaceDir || this.config.dataRoot)}）: 新增 ${created} 轮`)
    }
  }

  /** RET-02：既有轮次的片段索引回填（消息/自然段级；无归档时从 DSH session log 还原）。 */
  private async runFragmentBackfill(workspaceDir: string): Promise<void> {
    const store = this.storeFor(workspaceDir)
    const { backfillFragmentIndex } = await import('./backfill.js')
    const { readSessionEvents } = await import('../rewind.js')
    const eventsOf = (sessionId: string): SessionEventLike[] => {
      try {
        return readSessionEvents(sessionId) as unknown as SessionEventLike[]
      } catch {
        return []
      }
    }
    const memoryDir = this.memoryDirFor(workspaceDir)
    const result = await backfillFragmentIndex(store, {
      memoryDir,
      eventsOf,
      sourceVersion: `fragments:${Date.now().toString(36)}`,
    })
    if (result.built > 0) {
      console.log(`[evoresearch:memory] 片段索引回填（${path.basename(workspaceDir || this.config.dataRoot)}）: 新建 ${result.built} 轮，跳过 ${result.skipped}`)
    }
  }

  /** 观测目录。 */
  observationsDirFor(workspaceDir: string): string {
    return path.join(this.memoryDirFor(workspaceDir), 'observations')
  }

  /** Profile 记忆目录（§12：memories/profile）。 */
  profileDirFor(workspaceDir: string): string {
    return path.join(this.memoryDirFor(workspaceDir), 'profile')
  }

  /** 按当前会话读取记忆包，避免并行会话共享 last-active 状态。 */
  packetTextFor(sessionId: string): string {
    const packet = this.packets.get(sessionId)
    return packet ? packet.text : ''
  }

  /** 接入零 frontmatter 研究笔记；旧 Observation API 仍保留作为兼容回退。 */
  setNotesService(notes: NotesService): void {
    this.notesService = notes
  }

  /** 模型工具使用的自由文本笔记创建入口（NOTE-02）。 */
  createResearchNote(workspaceDir: string, title: string | undefined, body: string): unknown {
    if (this.notesService === undefined) throw new Error('研究笔记服务不可用')
    return this.notesService.createNote({ workspaceDir, title, body })
  }

  /** §12.3 Profile 注入：总量 ≤24000 字符时全文注入，超限只给文件清单 + 读取指令。 */
  profileContextText(sessionId: string): string {
    const sessions = this.ctxRef?.get('sessions')
    const getSession = sessions?.get as ((id: string) => unknown) | undefined
    const session = getSession?.call(sessions, sessionId) as { header?: { cwd?: string } } | undefined
    const cwd = session?.header?.cwd
    const base = cwd && cwd !== this.config.dataRoot ? cwd : this.config.dataRoot
    const profileDir = path.join(base, '.evoresearch-data', 'memories', 'profile')
    const files: Array<{ name: string; text: string }> = []
    try {
      for (const entry of fs.readdirSync(profileDir)) {
        if (!entry.endsWith('.md')) continue
        const full = path.join(profileDir, entry)
        try {
          const stat = fs.statSync(full)
          if (!stat.isFile() || stat.size > 64 * 1024) continue
          files.push({ name: entry, text: fs.readFileSync(full, 'utf8') })
        } catch { /* 跳过不可读 */ }
      }
    } catch { /* 目录不存在 */ }
    if (files.length === 0) return ''
    files.sort((a, b) => a.name.localeCompare(b.name))
    const BUDGET = 24000
    const joined = files.map((f) => `## ${f.name}\n${f.text.trim()}`).join('\n\n')
    if (joined.length <= BUDGET) {
      return `<identity_profile>\n${joined}\n</identity_profile>`
    }
    const listing = files.map((f) => `- ${f.name}（${Math.max(1, Math.round(f.text.length / 1024))} KB）`).join('\n')
    return `<identity_profile>\nProfile 总量超过 ${BUDGET} 字符，以下文件按需读取（read_memory 工具）：\n${listing}\n</identity_profile>`
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
    this.ctxRef = ctx
    const disposers: Array<() => void> = []

    // 1) 会话事件订阅：新用户消息 → Turn Catalog；turn 结束 → 归档
    disposers.push(
      ctx.on('session/event', (session: Session, event: SessionEvent) => {
        void this.handleSessionEvent(ctx, session, event).catch((error) => {
          console.error('[evoresearch:memory] 会话事件处理失败:', error)
        })
      }),
    )

    // 2) 记忆包注入：每步模型调用前的动态 context
    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt) {
      disposers.push(
        systemPrompt.context({
          name: 'evoresearch:research-memory',
          order: 60,
          text: (context: { agent?: { session?: { id?: string } } }) => {
            const sessionId = context?.agent?.session?.id
            return typeof sessionId === 'string' ? this.packetTextFor(sessionId) : ''
          },
        }),
      )
      // 2b) Identity Profile 注入（§12.3）
      disposers.push(
        systemPrompt.context({
          name: 'evoresearch:identity-profile',
          order: 61,
          text: (context: { agent?: { session?: { id?: string } } }) => {
            const sessionId = context?.agent?.session?.id
            return typeof sessionId === 'string' ? this.profileContextText(sessionId) : ''
          },
        }),
      )
    }

    // 3) 记忆工具
    disposers.push(registerMemoryTools(ctx, this))

    return () => {
      for (const dispose of disposers) dispose()
      for (const store of this.stores.values()) store.close()
      this.stores.clear()
      this.ctxRef = undefined
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
      this.activeTurns.set(session.id, { turnId, workspaceDir, userText: text, startedAt: Date.now(), accumulator: new TurnTextAccumulator() })
      // MEM-06：把真实 user/message 也交给累积器，归档时才能和后续
      // assistant/tool 事件共享同一条原事件序列；注入类消息已在上方过滤。
      this.activeTurns.get(session.id)?.accumulator.feedEvent(event)
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
      // MEM-04：归档前用 session-text.ts 汇总完整 assistantText 写回 research_turns
      // （每 step 存在最终 assistant/message 时以它为准；否则保留 chunk 合并稿）
      const assistantText = active.accumulator.text()
      const interrupt = turnInterruptFromEndReason(reason)
      if (interrupt.interrupted) {
        // MEM-05：中断轮次保存已生成正文 + 自然语言中断说明，不把部分回答伪装成完整回答
        const label = interrupt.interruptReason === 'api_failure' ? 'API 失败' : '用户停止'
        const partialNote = assistantText.length > 0
          ? `回答被中断（${label}）：已保留已生成的部分正文（${assistantText.length} 字符）。`
          : `回答被中断（${label}）：尚未生成正文。`
        store.updateTurn(active.turnId, {
          status: 'interrupted',
          interruptReason: interrupt.interruptReason,
          assistantText,
          partialNote,
        })
      } else {
        store.updateTurn(active.turnId, { status: 'completed', assistantText })
      }
      // v3 Raw Turn Archive：轮次收尾后把原始内容分页归档（不可变档案，活跃投影保留；
      // MEM-06 工具事件按原序随档案落盘，长结果由 store 落盘 archives/ 目录）
      const settled = store.getTurn(active.turnId)
      if (settled) {
        store.archiveTurn(settled, {
          tools: active.accumulator.tools,
          events: active.accumulator.archiveEvents(active.userText),
        })
        // RET-01/02：归档后同步建消息/自然段级片段索引（可定位原文搜索）
        store.buildTurnFragments(active.turnId)
      }
      this.activeTurns.delete(session.id)
      return
    }
    // MEM-02/MEM-03：assistant 正文现场累积（chunk 到达即按 step 累积 text-delta；
    // 最终 assistant/message 到达时以它替换该 step 的 chunk 合并稿，避免重复正文）
    if (event.type === 'assistant/chunk' || event.type === 'assistant/message') {
      this.activeTurns.get(session.id)?.accumulator.feedEvent(event)
      return
    }
    // v3 工具收据：模型请求的工具调用生命周期（started → completed）+ 原序工具事件收集
    const workspaceDir = (session.header as { cwd?: string }).cwd ?? this.config.dataRoot
    if (event.type === 'tool/call') {
      const data = event.data as SessionEvent<'tool/call'>['data'] & { name?: unknown; arguments?: unknown }
      const active = this.activeTurns.get(session.id)
      active?.accumulator.feedEvent(event)
      this.storeFor(workspaceDir).recordToolStarted(String(data.callId), active?.turnId, typeof data.name === 'string' ? data.name : undefined, data.arguments)
      return
    }
    if (event.type === 'tool/result') {
      const data = event.data as SessionEvent<'tool/result'>['data']
      this.activeTurns.get(session.id)?.accumulator.feedEvent(event)
      const message = data.message as { source?: { callId?: unknown } }
      const callId = message?.source?.callId
      if (callId !== undefined) {
        const block = Array.isArray(data.message?.content) ? data.message.content.find((b: any) => b?.type === 'tool-result') : undefined
        this.storeFor(workspaceDir).recordToolCompleted(String(callId), block?.content)
      }
      return
    }
  }

  /** 后台：分类 + topic state 更新 + 记忆包构建（不 await，失败静默）。 */  private async processTurnBackground(
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
      // 长程目标检测（v3）：仅当文本看起来像长期任务；失败不影响记忆包构建
      if (looksLongHorizon(text)) {
        try {
          await ensureGoalContract(ctx, this, { provider, model }, store, text, sessionId)
        } catch (error) {
          console.error('[evoresearch:memory] Goal 提取失败（不影响记忆包）:', error)
        }
      }
      // 记忆包（以当前轮文本为查询）
      const packet = await buildMemoryPacket(store, {
        tokenBudget: this.config.tokenBudget,
        query: text,
        categories: result.categories,
      })
      this.packets.set(sessionId, packet)
    } catch (error) {
      console.error('[evoresearch:memory] 后台分类/记忆包失败（不影响主回答）:', error)
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
