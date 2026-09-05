/**
 * Chat Graph 自动同步（§6.1 现实 → 图；TODO-chatgraph v3.1 Phase 1/2/3）。
 *
 * 订阅 DSH session/event，把系统真实变化即时落图（全部先过 §4.3 判重复用，
 * 墓碑项一律跳过、绝不复活用户显式删除的节点/连线）：
 * - 新会话入图（§5.4 强制约束 #5）：监听会话首条真人 user/message，为
 *   (sessionId, cwd) ensure chat 节点 + 常驻节点 + 默认连线并落盘；
 * - 会话改名（session/title 事件）→ 节点标题同步；
 * - 模型写记忆工具（create_research_note / create_observation / update_observation /
 *   supersede_observation / link_observations / update_profile）→ ensure 对应
 *   memory 节点并 upsert 事实写线（system: true，writeCount+1）；
 * - turn/end → 该会话 → 常驻台账节点的写线 bump + 会话节点 updatedAt 刷新；
 * - AutoSkills 审批通过 / 文献入库 → ensure skill / library 节点（由 host 入口
 *   在审批/入库挂点调用 skillApproved / papersAdded）。
 *
 * 另承载两个轻量内存状态（不落盘、重启即空）：
 * - graph-recent-hits 检索命中环形缓冲（≤100 条；由 ContextAssembler 注入）；
 * - 会话级待决工具调用表（tool/call 暂存参数，tool/result 时配对定位写目标）。
 *
 * 部署根会话（cwd === dataRoot，无项目图）不参与同步；任何失败只静默跳过，
 * 绝不阻塞会话事件流。
 */
import type { Context } from '@deepseek-ai/cordis'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  PERSISTENT_NODE_LOCATORS,
  chatNodeLocator,
  edgeBehavior,
  edgeKeyOf,
  graphNodeLocator,
} from './chat-graph.js'
import type { ChatGraphService, GraphEdge, GraphNode, GraphNodeRef } from './chat-graph.js'
import { projectNameFromWorkspace, workspaceDataDir } from './core/paths.js'

/** 自动同步依赖（host/index.ts 装配注入；测试可注入 fake）。 */
export interface ChatGraphSyncOptions {
  readonly dataRoot: string
  readonly chatGraph: ChatGraphService
  /** 项目 AGENTS.md 候选路径（复用 experts.agentsCandidatePaths 的 3 处候选）。 */
  readonly guidanceCandidates?: (workspaceDir?: string) => string[]
  /** Observation 反查（update/supersede/link 工具定位真实文件与标题；缺省裸建节点）。 */
  readonly observationLookup?: (workspaceDir: string, observationId: string) => { title: string; absolutePath: string } | undefined
}

/** 检索命中条目（graph-recent-hits / 体检卡共享）。 */
export interface GraphHitEntry {
  readonly nodeId: string
  readonly title: string
  readonly locator?: string
  readonly score?: number
  readonly sessionId?: string
  readonly at: number
}

/** 骨架补种结果（graph-sync 与新会话入图共用）。 */
export interface SkeletonEnsureResult {
  addedNodes: number
  addedEdges: number
  skippedTombstones: number
  emptyPatched: number
}

/** 触发事实写线的记忆写工具清单（§6.1；与 memory/tools.ts 注册名一一对应）。 */
const MEMORY_WRITE_TOOLS = new Set([
  'create_research_note',
  'create_observation',
  'update_observation',
  'supersede_observation',
  'link_observations',
  'update_profile',
])

/** 命中环形缓冲上限（contract ≤100）。 */
const RECENT_HITS_MAX = 100
/** seenSessions 进程内缓存上限（防长驻进程缓慢增长）。 */
const SEEN_SESSIONS_MAX = 1000

/** 从 user/message 事件提取真人文本（content 块拼接）。 */
function userTextOf(data: unknown): string {
  const d = data as { text?: unknown; content?: unknown } | undefined
  if (typeof d?.text === 'string' && d.text.trim() !== '') return d.text
  if (!Array.isArray(d?.content)) return ''
  return (d.content as Array<{ type?: unknown; text?: unknown }>)
    .map((block) => (typeof block?.text === 'string' ? block.text : ''))
    .join('')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .trim()
}

/** 从 tool/result 消息提取 tool-result 块的 JSON 文本（textRender 输出）。 */
function toolResultText(message: unknown): string {
  const data = message as { content?: Array<{ type?: unknown; content?: unknown }> } | undefined
  const block = Array.isArray(data?.content) ? data.content.find((b) => b?.type === 'tool-result') : undefined
  const inner = (block as { content?: Array<{ type?: unknown; text?: unknown }> } | undefined)?.content
  if (!Array.isArray(inner)) return ''
  return inner.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('')
}

/** 解析工具结果 JSON 对象（解析失败返回 undefined，调用方降级为仅按参数定位）。 */
function toolResultObject(message: unknown): Record<string, unknown> | undefined {
  const text = toolResultText(message).trim()
  if (text === '' || !text.startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(text) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

export class ChatGraphSyncService {
  private readonly options: ChatGraphSyncOptions
  /** 已 ensure 过首条消息的会话（进程内幂等；新进程重启后首次消息会再 ensure 一次，幂等无害）。 */
  private readonly seenSessions = new Set<string>()
  /** 会话级待决写工具调用：callId → { name, args }（tool/result 时配对消费）。 */
  private readonly pendingToolCalls = new Map<string, Map<string, { name: string; args: Record<string, unknown> }>>()
  /** 检索命中环形缓冲（≤100；graph-recent-hits 与体检卡数据源）。 */
  private readonly hits: GraphHitEntry[] = []
  /** 已计过徽标的压缩 id（guard 直接登记 + DSH 事件折叠双路径去重；进程内上限防增长）。 */
  private readonly bumpedCompactions = new Set<string>()

  constructor(options: ChatGraphSyncOptions) {
    this.options = options
  }

  /** 挂载会话事件订阅（host/index.ts 装配；返回 disposer）。 */
  attach(ctx: Context): () => void {
    return ctx.on('session/event', (session: any, event: any) => {
      try {
        this.handleEvent(session, event)
      } catch {
        // 自动同步失败绝不阻塞会话事件流（§2 降级总原则）。
      }
    })
  }

  // ── 检索命中环形缓冲（graph-recent-hits）──────────────────────────────────

  /** ContextAssembler 组装完成后注入本轮实际进入上下文的 Graph 命中。 */
  recordGraphHits(input: { sessionId: string; hits: ReadonlyArray<{ nodeId: string; title: string; locator?: string; score?: number }> }): void {
    const now = Date.now()
    for (const hit of input.hits) {
      if (typeof hit?.nodeId !== 'string' || hit.nodeId === '') continue
      const last = this.hits[this.hits.length - 1]
      // 轻量去重：同一会话同一节点的连续命中（快速+深入两路径）只记一次。
      if (last !== undefined && last.sessionId === input.sessionId && last.nodeId === hit.nodeId && now - last.at < 5000) continue
      this.hits.push({ ...hit, sessionId: input.sessionId, at: now })
    }
    if (this.hits.length > RECENT_HITS_MAX) this.hits.splice(0, this.hits.length - RECENT_HITS_MAX)
  }

  /**
   * 最近命中（新→旧）。limit 缺省返回缓冲内全部（环形上限已保证 ≤100）；
   * sessionId 过滤供命中脉冲与体检卡使用；graph-recent-hits 端点自带默认 20。
   */
  recentHits(sessionId?: string, limit?: number): GraphHitEntry[] {
    const filtered = sessionId === undefined ? this.hits : this.hits.filter((hit) => hit.sessionId === sessionId)
    const bounded = limit === undefined ? filtered : filtered.slice(-Math.max(1, limit))
    return [...bounded].reverse()
  }

  // ── 会话事件分发 ──────────────────────────────────────────────────────────

  private handleEvent(session: unknown, event: { type?: unknown; data?: unknown }): void {
    const sessionId = (session as { id?: unknown } | undefined)?.id
    if (typeof sessionId !== 'string' || sessionId === '') return
    const type = event?.type
    if (type === 'user/message') {
      const data = event.data as { source?: { kind?: string } } | undefined
      if (data?.source?.kind !== 'user') return
      this.handleFirstUserMessage(session, sessionId, event.data)
      return
    }
    if (type === 'session/title') {
      this.handleTitleEvent(session, sessionId, event.data)
      return
    }
    if (type === 'tool/call') {
      this.handleToolCall(sessionId, event.data)
      return
    }
    if (type === 'tool/result') {
      this.handleToolResult(session, sessionId, event.data)
      return
    }
    if (type === 'turn/end') {
      this.handleTurnEnd(session, sessionId)
      return
    }
  }

  /**
   * 新会话入图（兜底方案，强制需求 §6.1 第一行）：DSH 无显式 session/created
   * 事件，用「某会话首条真人 user/message」作为创建挂点——ensure chat 节点 +
   * 默认连线并落盘；老会话（重启后首次消息）同样被 ensure（幂等复用现有节点）。
   */
  private handleFirstUserMessage(session: unknown, sessionId: string, data: unknown): void {
    if (this.seenSessions.has(sessionId)) return
    if (this.seenSessions.size >= SEEN_SESSIONS_MAX) this.seenSessions.clear()
    this.seenSessions.add(sessionId)
    const workspaceDir = this.workspaceOf(session)
    const projectName = projectNameFromWorkspace(this.options.dataRoot, workspaceDir)
    if (projectName === undefined) return
    const text = userTextOf(data)
    // 先补常驻骨架（左列落位）、再放会话节点（最右侧一列）；
    // 末尾再跑一次骨架补默认连线——边生成只为"当时已在场"的会话节点，幂等且开销极小。
    this.ensureProjectSkeleton(projectName, workspaceDir)
    this.ensureChatNode(projectName, sessionId, workspaceDir, text !== '' ? text.slice(0, 32) : undefined)
    this.ensureProjectSkeleton(projectName, workspaceDir)
  }

  /** 会话改名（session/title 事件）→ 同步 chat 节点标题（双向改名）。 */
  private handleTitleEvent(session: unknown, sessionId: string, data: unknown): void {
    const title = (data as { title?: unknown } | undefined)?.title
    if (typeof title !== 'string' || title.trim() === '') return
    const workspaceDir = this.workspaceOf(session)
    const projectName = projectNameFromWorkspace(this.options.dataRoot, workspaceDir)
    if (projectName === undefined) return
    const graph = this.options.chatGraph.get(projectName)
    const node = graph.nodes.find((n) => n.type === 'chat' && n.sessionId === sessionId)
    if (node === undefined || node.title === title.trim()) return
    this.options.chatGraph.updateNode(projectName, node.id, { title: title.trim().slice(0, 80) })
  }

  /** 暂存写工具调用的参数（tool/result 时配对定位写目标）。 */
  private handleToolCall(sessionId: string, data: unknown): void {
    const d = data as { callId?: unknown; name?: unknown; arguments?: unknown } | undefined
    const name = typeof d?.name === 'string' ? d.name : ''
    if (!MEMORY_WRITE_TOOLS.has(name)) return
    let args: Record<string, unknown> = {}
    if (typeof d?.arguments === 'string') {
      try { args = JSON.parse(d.arguments) as Record<string, unknown> } catch { args = {} }
    } else if (typeof d?.arguments === 'object' && d.arguments !== null) {
      args = d.arguments as Record<string, unknown>
    }
    let bySession = this.pendingToolCalls.get(sessionId)
    if (bySession === undefined) {
      bySession = new Map()
      this.pendingToolCalls.set(sessionId, bySession)
    }
    bySession.set(String(d?.callId ?? ''), { name, args })
    if (bySession.size > 50) bySession.delete(bySession.keys().next().value as string)
  }

  /** 写工具结果 → 定位目标记忆文件 → ensure 节点 + 事实写线（§6.1）。 */
  private handleToolResult(session: unknown, sessionId: string, data: unknown): void {
    const d = data as { message?: { source?: { callId?: unknown } } } | undefined
    const callId = d?.message?.source?.callId
    const key = callId === undefined ? '' : String(callId)
    const pending = key !== '' ? this.pendingToolCalls.get(sessionId)?.get(key) : undefined
    if (key !== '') this.pendingToolCalls.get(sessionId)?.delete(key)
    if (pending === undefined) return
    const workspaceDir = this.workspaceOf(session)
    const projectName = projectNameFromWorkspace(this.options.dataRoot, workspaceDir)
    if (projectName === undefined) return
    const graph = this.options.chatGraph.get(projectName)
    const chatNode = graph.nodes.find((n) => n.type === 'chat' && n.sessionId === sessionId)
    if (chatNode === undefined) return
    const result = toolResultObject(d?.message)
    for (const target of this.resolveWriteTargets(workspaceDir, pending, result)) {
      if (this.options.chatGraph.tombstoneHasNode(projectName, target.locator)) continue
      const node = this.options.chatGraph.addNode(projectName, target.node)
      // empty 状态随真实内容刷新（profile 由空转实）。
      if (target.node.empty !== undefined && node.empty !== target.node.empty) {
        this.options.chatGraph.updateNode(projectName, node.id, { empty: target.node.empty, updatedAt: Date.now() })
      }
      const edge: Omit<GraphEdge, 'id'> = { from: chatNode.id, to: node.id, toPort: 'memory', behavior: 'write', system: true }
      if (!this.options.chatGraph.tombstoneHasEdge(projectName, edgeKeyOf(edge))) {
        this.options.chatGraph.upsertWriteEdge(projectName, chatNode.id, node.id, true)
      }
    }
  }

  /** 每轮对话结束 → chat → 台账写线 bump + 会话节点活跃时间刷新（§6.1）。 */
  private handleTurnEnd(session: unknown, sessionId: string): void {
    // TODO(Phase4): "自动沉淀开关"在此裁决——开关关闭时跳过台账写线 bump（仅刷新活跃时间）。
    const workspaceDir = this.workspaceOf(session)
    const projectName = projectNameFromWorkspace(this.options.dataRoot, workspaceDir)
    if (projectName === undefined) return
    const graph = this.options.chatGraph.get(projectName)
    const chatNode = graph.nodes.find((n) => n.type === 'chat' && n.sessionId === sessionId)
    if (chatNode === undefined) return
    if (this.ensurePersistentNode(projectName, workspaceDir, 'turns') === 'tombstoned') return
    const turns = this.options.chatGraph.get(projectName).nodes.find((n) => graphNodeLocator(n) === PERSISTENT_NODE_LOCATORS.turns)
    if (turns === undefined) return
    const edge: Omit<GraphEdge, 'id'> = { from: chatNode.id, to: turns.id, toPort: 'memory', behavior: 'write', system: true }
    if (!this.options.chatGraph.tombstoneHasEdge(projectName, edgeKeyOf(edge))) {
      this.options.chatGraph.upsertWriteEdge(projectName, chatNode.id, turns.id, true)
    }
    const now = Date.now()
    this.options.chatGraph.updateNode(projectName, chatNode.id, { updatedAt: now, lastActiveAt: now })
  }

  /**
   * 压缩完成 → 对应会话 chat 节点 compactionCount+1 并落盘（§6.1"压缩"徽标）。
   * 由 guard 的 compactionLog.onAppend（compactions.jsonl 落账同一挂点）在
   * status === 'completed' 时调用；同一次压缩可能经 guard 直接登记与 DSH 事件
   * 折叠两条路径到达，这里按 compactionId 去重保证只计一次。
   */
  bumpCompaction(sessionId: string, compactionId?: string): void {
    if (typeof sessionId !== 'string' || sessionId === '') return
    if (compactionId !== undefined && compactionId !== '') {
      if (this.bumpedCompactions.has(compactionId)) return
      if (this.bumpedCompactions.size >= 2000) this.bumpedCompactions.clear()
      this.bumpedCompactions.add(compactionId)
    }
    try {
      const found = this.options.chatGraph.projectOfSession(sessionId)
      if (found === undefined) return
      this.options.chatGraph.updateNode(found.project, found.node.id, { compactionCount: (found.node.compactionCount ?? 0) + 1 })
    } catch {
      // 压缩徽标失败不影响会话与压缩本身
    }
  }

  // ── 对外挂点：会话删除 / AutoSkills 审批 / 文献入库 ─────────────────────

  /**
   * 会话删除 → 摘除节点（由 api.sessionDeleteCascade 调用）。有写线的会话返回
   * hadWrites 供确认框警告；节点进入墓碑（graph-sync 不再补种）。
   */
  sessionRemoved(sessionId: string): { removed: boolean; hadWrites: number; project?: string } {
    const found = this.options.chatGraph.projectOfSession(sessionId)
    if (found === undefined) return { removed: false, hadWrites: 0 }
    const { project, node } = found
    const graph = this.options.chatGraph.get(project)
    const writeEdges = graph.edges.filter((edge) => edge.from === node.id && edgeBehavior(edge) === 'write')
    // 老 chat 节点可能没有 locator：先补齐稳定定位键，墓碑 diff 才能拦住补种。
    if (node.locator === undefined) {
      this.options.chatGraph.updateNode(project, node.id, { locator: chatNodeLocator(sessionId) })
    }
    const saved = this.options.chatGraph.save(project, {
      ...graph,
      nodes: graph.nodes.filter((n) => n.id !== node.id),
      edges: graph.edges.filter((edge) => edge.from !== node.id && edge.to !== node.id),
    })
    this.seenSessions.delete(sessionId)
    this.pendingToolCalls.delete(sessionId)
    if (!saved.ok) return { removed: false, hadWrites: writeEdges.length, project }
    return { removed: true, hadWrites: writeEdges.filter((edge) => (edge.writeCount ?? 0) > 0).length, project }
  }

  /**
   * AutoSkills 提案批准 → ensure skill 节点（唯一）+ 来源观察的溯源连线。
   * 提案本身没有来源会话，无法建 Chat→Memory 写线——用来源观察 → 技能的
   * reference 连线（system: true）表达溯源（见交付报告偏差说明）。
   */
  skillApproved(input: { name: string; workspaceDir?: string; sourceObservationIds?: readonly string[] }): { ok: boolean; nodeId?: string; skipped?: boolean; error?: string } {
    const workspaceDir = input.workspaceDir && input.workspaceDir !== '' ? input.workspaceDir : this.options.dataRoot
    const projectName = projectNameFromWorkspace(this.options.dataRoot, workspaceDir)
    if (projectName === undefined) return { ok: false, error: '提案没有可落图的项目工作区' }
    const name = input.name.trim()
    if (name === '') return { ok: false, error: '技能名为空' }
    const locator = `project:skill:${name}`
    if (this.options.chatGraph.tombstoneHasNode(projectName, locator)) return { ok: false, skipped: true, error: '技能节点已被删除（墓碑生效）' }
    const skillPath = path.join(this.options.dataRoot, 'skills', name, 'SKILL.md')
    const node = this.options.chatGraph.addNode(projectName, {
      type: 'memory',
      displayKind: 'skill',
      title: name,
      x: 80,
      y: 590,
      system: true,
      scope: 'project',
      origin: 'agent',
      ...(fs.existsSync(skillPath) ? { ref: { kind: 'file', path: this.workspaceRel(workspaceDir, skillPath) } as GraphNodeRef } : {}),
      locator,
      status: 'available',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    // 来源观察 → 技能 的溯源连线（判重 + 墓碑）。
    const graph = this.options.chatGraph.get(projectName)
    for (const observationId of input.sourceObservationIds ?? []) {
      const source = graph.nodes.find((n) => graphNodeLocator(n) === `project:note:${observationId}`)
      if (source === undefined) continue
      const edge: Omit<GraphEdge, 'id'> = { from: source.id, to: node.id, toPort: 'memory', behavior: 'reference', system: true, enabled: true, label: 'AutoSkills 来源观察' }
      if (this.options.chatGraph.tombstoneHasEdge(projectName, edgeKeyOf(edge))) continue
      try { this.options.chatGraph.addEdge(projectName, edge) } catch { /* 连线失败不阻塞技能节点 */ }
    }
    return { ok: true, nodeId: node.id }
  }

  /** 文献入库 → ensure library 节点（唯一；按 paperId 判重，先一次读图过滤已存在项）。 */
  papersAdded(input: { project: string; papers: ReadonlyArray<{ paperId: string; filePath: string; title: string }> }): { added: number; skippedTombstones: number } {
    let added = 0
    let skippedTombstones = 0
    // 一次读图：已存在（locator 命中）或墓碑中的论文不再逐个走 addNode 的读改写。
    const graph = this.options.chatGraph.get(input.project)
    const known = new Set(graph.nodes.map((node) => graphNodeLocator(node) ?? node.id))
    for (const paper of input.papers) {
      if (typeof paper?.paperId !== 'string' || paper.paperId === '') continue
      const locator = `project:library:${paper.paperId}`
      if (known.has(locator)) continue
      if (this.options.chatGraph.tombstoneHasNode(input.project, locator)) {
        skippedTombstones += 1
        continue
      }
      try {
        this.options.chatGraph.addNode(input.project, {
          type: 'memory',
          displayKind: 'library',
          title: paper.title || paper.paperId,
          x: 80,
          y: 760,
          system: true,
          scope: 'project',
          origin: 'imported',
          ref: { kind: 'pdf', path: paper.filePath },
          locator,
          status: 'available',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        added += 1
      } catch { /* 单篇失败不阻塞其余 */ }
    }
    return { added, skippedTombstones }
  }

  // ── 常驻节点 / 默认连线 / chat 节点（骨架补种，graph-sync 复用）──────────

  /**
   * 项目骨架补种（幂等）：常驻节点（画像/指引/台账，empty 实时计算）+ 每个
   * chat 节点的默认连线（system: true）。graph-sync 与新会话入图共用。
   */
  ensureProjectSkeleton(projectName: string, workspaceDir: string): SkeletonEnsureResult {
    const result: SkeletonEnsureResult = { addedNodes: 0, addedEdges: 0, skippedTombstones: 0, emptyPatched: 0 }
    for (const kind of ['profile', 'guidance', 'turns'] as const) {
      const ensured = this.ensurePersistentNode(projectName, workspaceDir, kind)
      if (ensured === 'tombstoned') result.skippedTombstones += 1
      else if (ensured === 'created') result.addedNodes += 1
      else if (ensured === 'patched') result.emptyPatched += 1
    }
    // 默认连线：常驻节点 → 每个 chat 节点一条 reference 边（system: true）。
    const graph = this.options.chatGraph.get(projectName)
    const persistentLocators = new Set<string>(Object.values(PERSISTENT_NODE_LOCATORS))
    const persistentIds = graph.nodes
      .filter((n) => n.type !== 'chat' && persistentLocators.has(graphNodeLocator(n) ?? ''))
      .map((n) => n.id)
    for (const chatNode of graph.nodes.filter((n) => n.type === 'chat')) {
      for (const persistentId of persistentIds) {
        const edge: Omit<GraphEdge, 'id'> = { from: persistentId, to: chatNode.id, toPort: 'memory', behavior: 'reference', system: true, enabled: true }
        const key = edgeKeyOf(edge)
        if (graph.edges.some((existing) => edgeKeyOf(existing) === key)) continue
        if (this.options.chatGraph.tombstoneHasEdge(projectName, key)) {
          result.skippedTombstones += 1
          continue
        }
        try {
          this.options.chatGraph.addEdge(projectName, edge)
          result.addedEdges += 1
        } catch { /* 单条失败不阻塞骨架 */ }
      }
    }
    return result
  }

  /**
   * ensure 单个常驻节点：墓碑 → 跳过；缺失 → 创建（empty 实时计算）；
   * 已存在 → 仅在 empty 标记变化时补丁。
   */
  private ensurePersistentNode(
    projectName: string,
    workspaceDir: string,
    kind: 'profile' | 'guidance' | 'turns',
  ): 'created' | 'existing' | 'patched' | 'tombstoned' {
    const spec = this.persistentNodeSpec(kind, workspaceDir)
    if (this.options.chatGraph.tombstoneHasNode(projectName, spec.locator)) return 'tombstoned'
    const graph = this.options.chatGraph.get(projectName)
    const existing = graph.nodes.find((n) => graphNodeLocator(n) === spec.locator)
    if (existing === undefined) {
      this.options.chatGraph.addNode(projectName, spec.node)
      return 'created'
    }
    if ((existing.empty ?? false) !== (spec.node.empty ?? false)) {
      this.options.chatGraph.updateNode(projectName, existing.id, { empty: spec.node.empty })
      return 'patched'
    }
    return 'existing'
  }

  /** ensure 会话的 chat 节点（判重键 = locator `session:<id>`；兼容老节点按 sessionId 查找）。 */
  ensureChatNode(projectName: string, sessionId: string, workspaceDir: string, title?: string): { added: boolean; nodeId?: string; skippedTombstone?: boolean } {
    const key = chatNodeLocator(sessionId)
    if (this.options.chatGraph.tombstoneHasNode(projectName, key)) return { added: false, skippedTombstone: true }
    const graph = this.options.chatGraph.get(projectName)
    const existing = graph.nodes.find((n) => n.type === 'chat' && (n.sessionId === sessionId || graphNodeLocator(n) === key))
    if (existing !== undefined) {
      const patch: Partial<GraphNode> = {}
      if (title !== undefined && title !== '' && existing.title !== title) patch.title = title
      if (existing.locator === undefined) patch.locator = key
      if (Object.keys(patch).length > 0) this.options.chatGraph.updateNode(projectName, existing.id, patch)
      return { added: false, nodeId: existing.id }
    }
    // 新节点放置：现有内容最右侧起一列（与 graphSync 的补种位规则一致）；260px 间距避免卡片贴边。
    const baseX = graph.nodes.length > 0 ? Math.max(...graph.nodes.map((n) => n.x ?? 0)) + 260 : 80
    const created = this.options.chatGraph.addNode(projectName, {
      type: 'chat',
      displayKind: 'chat',
      title: title && title !== '' ? title : `会话 ${sessionId.startsWith('session-') ? sessionId.slice(8, 16) : sessionId.slice(0, 8)}`,
      x: baseX,
      y: 60,
      sessionId,
      workspaceDir,
      origin: 'imported',
      locator: key,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    return { added: true, nodeId: created.id }
  }

  /** 常驻节点规格（locator 固定；empty 由真实资料存在性计算）。 */
  private persistentNodeSpec(kind: 'profile' | 'guidance' | 'turns', workspaceDir: string): { locator: string; node: Omit<GraphNode, 'id'> } {
    const base = {
      type: 'memory' as const,
      system: true,
      scope: 'project' as const,
      origin: 'imported' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    if (kind === 'profile') {
      const profileDir = path.join(workspaceDataDir(this.options.dataRoot, workspaceDir), 'memories', 'profile')
      const hasFiles = (() => {
        try { return fs.readdirSync(profileDir).some((name) => name.endsWith('.md')) } catch { return false }
      })()
      return {
        locator: PERSISTENT_NODE_LOCATORS.profile,
        node: {
          ...base,
          displayKind: 'profile',
          title: '身份画像',
          x: 80,
          y: 80,
          empty: !hasFiles,
          ref: { kind: 'dir', path: this.workspaceRel(workspaceDir, profileDir) },
          locator: PERSISTENT_NODE_LOCATORS.profile,
        },
      }
    }
    if (kind === 'guidance') {
      const candidates = this.options.guidanceCandidates?.(workspaceDir)
        ?? [path.join(workspaceDir, 'AGENTS.md'), path.join(workspaceDir, '.evoresearch-data', 'AGENTS.md'), path.join(this.options.dataRoot, 'AGENTS.md')]
      const existing = [...new Set(candidates)].find((file) => {
        try {
          const stat = fs.statSync(file)
          return stat.isFile() && stat.size > 0
        } catch { return false }
      })
      return {
        locator: PERSISTENT_NODE_LOCATORS.guidance,
        node: {
          ...base,
          displayKind: 'guidance',
          title: '项目指引',
          x: 80,
          y: 250,
          empty: existing === undefined,
          ref: { kind: 'file', path: existing !== undefined ? this.workspaceRel(workspaceDir, existing) : 'AGENTS.md' },
          locator: PERSISTENT_NODE_LOCATORS.guidance,
        },
      }
    }
    const dbPath = path.join(workspaceDataDir(this.options.dataRoot, workspaceDir), 'memories', 'research_memory.db')
    return {
      locator: PERSISTENT_NODE_LOCATORS.turns,
      node: {
        ...base,
        displayKind: 'turns',
        title: '对话台账',
        x: 80,
        y: 420,
        empty: !fs.existsSync(dbPath),
        ref: { kind: 'file', path: this.workspaceRel(workspaceDir, dbPath) },
        locator: PERSISTENT_NODE_LOCATORS.turns,
      },
    }
  }

  /** 写工具 → 目标记忆节点规格（判重 locator 与 graphSync 笔记导入保持一致）。 */
  private resolveWriteTargets(
    workspaceDir: string,
    pending: { name: string; args: Record<string, unknown> },
    result: Record<string, unknown> | undefined,
  ): Array<{ locator: string; node: Omit<GraphNode, 'id'> }> {
    const now = Date.now()
    const argString = (key: string): string => (typeof pending.args[key] === 'string' ? pending.args[key] as string : '')
    const resultString = (key: string): string => (typeof result?.[key] === 'string' ? result[key] as string : '')
    if (pending.name === 'update_profile') {
      const spec = this.persistentNodeSpec('profile', workspaceDir)
      // update_profile 刚写入真实内容：empty 恒为 false（覆盖现有空态）。
      spec.node.empty = false
      spec.node.updatedAt = now
      return [{ locator: spec.locator, node: spec.node }]
    }
    const targets: Array<{ locator: string; node: Omit<GraphNode, 'id'> }> = []
    // 节点标题优先级（§6.1）：观察文件自身标题（frontmatter，经 lookup 反查）
    // → 工具参数标题 → observation id 兜底；绝不拿文件名/裸 id 当首选标题。
    const pushObservation = (observationId: string, titleHint = ''): void => {
      if (observationId === '') return
      const lookup = this.options.observationLookup?.(workspaceDir, observationId)
      const title = lookup?.title || titleHint || observationId
      targets.push({
        locator: `project:note:${observationId}`,
        node: {
          type: 'memory',
          displayKind: 'observation',
          title,
          x: 320,
          y: 80 + targets.length * 130,
          scope: 'project',
          origin: 'agent',
          ...(lookup !== undefined ? { ref: { kind: 'file', path: this.workspaceRel(workspaceDir, lookup.absolutePath) } as GraphNodeRef } : {}),
          locator: `project:note:${observationId}`,
          status: 'available',
          createdAt: now,
          updatedAt: now,
        },
      })
    }
    const pushNote = (noteId: string, fileName: string, title: string): void => {
      if (noteId === '') return
      targets.push({
        locator: `project:note:${noteId}`,
        node: {
          type: 'memory',
          displayKind: 'note',
          title: title !== '' ? title : fileName !== '' ? fileName : noteId,
          x: 320,
          y: 80 + targets.length * 130,
          scope: 'project',
          origin: 'agent',
          ...(fileName !== '' ? { ref: { kind: 'note', path: fileName } as GraphNodeRef } : {}),
          locator: `project:note:${noteId}`,
          status: 'available',
          createdAt: now,
          updatedAt: now,
        },
      })
    }
    switch (pending.name) {
      case 'create_research_note': {
        // 新笔记服务返回 { note_id, file_name }；解析失败则没有可落图目标（跳过）。
        const noteId = resultString('note_id')
        const fileName = resultString('file_name')
        if (noteId !== '') pushNote(noteId, fileName, argString('title'))
        break
      }
      case 'create_observation': {
        // markdown-note 路径返回 { note_id, file_name }；旧 Observation 路径返回 { observation_id }。
        const noteId = resultString('note_id')
        if (noteId !== '') {
          pushNote(noteId, resultString('file_name'), argString('title'))
          break
        }
        const observationId = resultString('observation_id')
        if (observationId !== '') pushObservation(observationId, argString('title'))
        break
      }
      case 'update_observation':
      case 'supersede_observation':
        pushObservation(argString('observation_id'))
        break
      case 'link_observations': {
        pushObservation(argString('observation_id'))
        const related = Array.isArray(pending.args['related_ids']) ? pending.args['related_ids'] as unknown[] : []
        for (const id of related) if (typeof id === 'string') pushObservation(id)
        break
      }
      default:
        break
    }
    return targets
  }

  /** 会话工作区（cwd 缺省回退 dataRoot）。 */
  private workspaceOf(session: unknown): string {
    const cwd = (session as { header?: { cwd?: unknown } } | undefined)?.header?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : this.options.dataRoot
  }

  /** 绝对路径 → 工作区相对 POSIX 路径（越出工作区时保留绝对路径）。 */
  private workspaceRel(workspaceDir: string, absPath: string): string {
    const rel = path.relative(workspaceDir, absPath).split(path.sep).join('/')
    return rel === '' || rel.startsWith('..') ? absPath.replace(/\\/g, '/') : rel
  }
}
