/**
 * CTX-01/02/09/10/11 ContextAssembler 运行时。
 *
 * 以 (sessionId, userQuestion, options) 为唯一入口（CTX-01），输出
 * 自然语言 Markdown 阅读材料；所有查找都按 sessionId 作用域进行，
 * 不依赖任何"最近活跃会话"全局状态（CTX-02：并行会话互不串包）。
 *
 * 组装流程：
 * 1. 收集来源事实：当前聊天最近消息、Graph 直接连接、FTS5 原文、
 *    研究近况页相关段落（快速路径，同步，CTX-03）；
 * 2. 可选深入路径（异步，CTX-04）：查询改写（CTX-05，失败降级原文）、
 *    embedding（缺失降级）、Graph 邻域扩展、原文前后文；
 * 3. CTX-07 Graph 连接加权 → CTX-11 预算内选择 → CTX-08 渲染；
 * 4. CTX-09 预览结构与 include/exclude 选项；CTX-10 效果信号记录。
 *
 * 纯计算在 search.ts / render.ts；本文件只做服务适配与编排。
 * 所有动态注册返回 disposer；不修改 memory/*、api.ts、host/index.ts。
 */
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { projectNameFromWorkspace } from '../core/paths.js'
import { isRuntimeEdge, isMemoryNode } from '../chat-graph.js'
import type { ChatGraph, GraphNode } from '../chat-graph.js'
import { sessionHistoryText } from '../chat-graph.js'
import type { SimpleCallOptions } from '../core/llm.js'
import {
  searchFast,
  searchDeep,
  selectWithinBudget,
  chatNodeOf,
  makeCandidate,
  type CandidateLocation,
  type EmbeddingProviderLike,
  type FastSearchInput,
  type MemoryStoreLike,
  type NotesServiceLike,
  type QueryRewriterLike,
  type SearchCandidate,
} from './search.js'
import {
  renderReadingMaterial,
  type ContinueReadEntry,
  type RenderSnippet,
  type RenderedSection,
} from './render.js'
import { LinkResolver, sidecarLinksFor, type LinkTraceEntry } from './link-resolver.js'

/** 依赖（真实服务满足结构接口；测试用 fake）。 */
export interface ContextAssemblerDeps {
  /** 兼容单库注入；生产路径优先使用 storeFor，避免并发工作区串库。 */
  readonly store?: MemoryStoreLike
  /** 每次组装按 workspaceDir 解析对应项目记忆库。 */
  readonly storeFor?: (workspaceDir: string) => MemoryStoreLike
  readonly notes: NotesServiceLike
  /** 可选的工作区级笔记服务路由。 */
  readonly notesFor?: (workspaceDir: string) => NotesServiceLike
  readonly chatGraph: { get(projectName: string): ChatGraph }
  /** 可选：查询改写（CTX-05）用的辅助模型；缺失则快速/深入路径都不改写。 */
  readonly llm?: { callText(options: SimpleCallOptions): Promise<string> }
  /** 可选：embedding 提供者（深入路径；缺失静默降级）。 */
  readonly embeddings?: EmbeddingProviderLike
  /** 可选：改写模型路由（缺省 deepseek-official/deepseek-v4-flash）。 */
  readonly rewriteModel?: { readonly provider: string; readonly model: string }
  /** 可选：会话最近消息读取（缺省用 chat-graph 的 sessionHistoryText）。 */
  readonly recentChatText?: (sessionId: string, maxChars?: number) => string
  /** 可选：Graph 节点引用预览（缺省用 chat-graph 的 previewOf 语义的简化读取）。 */
  readonly previewOf?: (node: GraphNode, workspaceDir: string | undefined, maxChars?: number) => { ok: boolean; text?: string }
  /** 效果信号持久化根目录（缺省 process.cwd()）。 */
  readonly dataRoot?: string
  /** 可选链接解析器；未注入时使用当前数据根创建默认实例。 */
  readonly linkResolver?: LinkResolver
  /** 论文/PDF 等专用原文读取器；失败时仍保留可打开定位。 */
  readonly resourceReader?: (input: {
    readonly node: GraphNode
    readonly workspaceDir?: string
    readonly question: string
    readonly maxChars: number
  }) => { ok: boolean; text?: string; path?: string; page?: number; offset?: number; error?: string }
}

/** 组装选项。 */
export interface AssembleOptions {
  /** token 预算（默认 6000；对齐记忆包预算）。 */
  readonly tokenBudget?: number
  /** CTX-09：用户显式保留的材料 id（白名单；空数组 = 不限制）。 */
  readonly includedIds?: readonly string[]
  /** CTX-09：用户移除的材料 id（黑名单，优先于白名单）。 */
  readonly excludedIds?: readonly string[]
  /** 最近消息读取字符数（默认 4000）。 */
  readonly recentChatChars?: number
  /** 快速路径是否做查询改写（默认 false——快速路径不等待 LLM）。 */
  readonly rewrite?: boolean
  /** 是否执行深入路径（异步 step；默认 false）。 */
  readonly deep?: boolean
  /** 每来源候选上限（默认 8）。 */
  readonly perSourceLimit?: number
  /** Memory 链接最多展开几跳（默认 2；0 = 只保留 Memory 正文）。 */
  readonly linkMaxDepth?: number
  /** Memory 链接本轮最多读取多少个目标。 */
  readonly linkMaxReads?: number
  /** Memory 链接本轮最多注入多少字符的局部原文。 */
  readonly linkMaxChars?: number
}

/** 组装输入（CTX-01 唯一入口的参数）。 */
export interface AssembleInput {
  readonly sessionId: string
  readonly userQuestion: string
  readonly projectName?: string
  readonly workspaceDir?: string
  readonly options?: AssembleOptions
}

/** 组装结果。 */
export interface AssemblyResult {
  readonly sessionId: string
  /** 稳定问题 id（sessionId + question 哈希；供效果信号关联）。 */
  readonly questionId: string
  /** 注入模型的 Markdown 阅读材料（CTX-08）。 */
  readonly text: string
  readonly estimatedTokens: number
  readonly sections: readonly RenderedSection[]
  /** 全部候选（含未注入，供预览/审计）。 */
  readonly candidates: readonly SearchCandidate[]
  /** 实际注入的候选。 */
  readonly included: readonly SearchCandidate[]
  /** 预算/用户排除的候选。 */
  readonly excluded: readonly SearchCandidate[]
  /** CTX-10 效果信号（本次组装自动登记）。 */
  readonly effects: EffectSignalRecord
  readonly deep: boolean
  /** 降级说明（rewrite/embedding/FTS 失败等；空 = 无降级）。 */
  readonly degraded: readonly string[]
  /** Memory 段落到真实资料的有界跳转记录。 */
  readonly linkTrace: readonly LinkTraceEntry[]
}

/** CTX-10 效果信号记录（只定义结构与存储；接线点见 api-integration-ctx2.md）。 */
export interface EffectSignalRecord {
  readonly signalId: string
  readonly sessionId: string
  readonly questionId: string
  readonly createdAt: number
  /** 本轮是否继续读了原文（后续 read 动作由集成方置 true）。 */
  readonly readMore: boolean
  /** 用户移除的材料 id。 */
  readonly removedIds: readonly string[]
  /** 预算裁剪掉的高分材料 id。 */
  readonly prunedIds: readonly string[]
  /** 实际注入数。 */
  readonly injected: number
  readonly totalCandidates: number
  readonly graphConnectedInjected: number
}

/** CTX-09 预览条目。 */
export interface ReferencePreviewItem {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly snippet: string
  readonly connected: boolean
  /** 是否会被注入本轮（含 include/exclude 与预算判断）。 */
  readonly included: boolean
  readonly reason: string
}

/** CTX-09 预览结构。 */
export interface ReferencePreview {
  readonly sessionId: string
  readonly question: string
  readonly items: readonly ReferencePreviewItem[]
}

/** 效果信号查询条件。 */
export interface EffectQuery {
  readonly sessionId?: string
  readonly questionId?: string
  readonly since?: number
  readonly limit?: number
}

/** 默认 token 预算（对齐记忆包）。 */
export const DEFAULT_ASSEMBLE_TOKEN_BUDGET = 6000

/** 重写系统提示（CTX-05：自然语言"本轮需要找什么"，不用固定科研阶段分类）。 */
export const REWRITE_SYSTEM_PROMPT =
  '你是科研助手的查询理解器。把用户的问题改写为自然语言的检索描述：' +
  '说明用户正在做什么、本轮需要找回什么信息。' +
  '不要使用固定的科研阶段分类，不要输出列表以外的解释，只输出改写文本。'

/** 由问题生成稳定 questionId。 */
export function questionIdOf(sessionId: string, question: string): string {
  let hash = 0
  const text = `${sessionId}:${question}`
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

/**
 * ContextAssembler 运行时。用法：
 * const assembler = new ContextAssembler(deps, { dataRoot })
 * const result = await assembler.assemble({ sessionId, userQuestion, projectName, workspaceDir })
 */
export class ContextAssembler {
  private readonly deps: ContextAssemblerDeps
  private readonly dataRoot: string
  private readonly effects: EffectSignalRecord[] = []
  /** 用户消息事件到首次模型调用之间的同步快速投影。 */
  private readonly prepared = new Map<string, { text: string; question: string; questionId: string; createdAt: number }>()

  constructor(deps: ContextAssemblerDeps, options: { readonly dataRoot?: string } = {}) {
    this.deps = deps
    this.dataRoot = options.dataRoot ?? deps.dataRoot ?? process.cwd()
  }

  /**
   * 在 user/message 事件处理阶段同步建立快速投影，保证第一次模型调用前就有
   * 当前问题、Graph 直连和原文 FTS 结果；深入路径随后仍可异步替换它。
   */
  prepareFast(input: AssembleInput): void {
    try {
      const options = input.options ?? {}
      const graph = this.graphOf(input)
      const recentChat = this.recentChatOf(input, options)
      const graphCandidates = this.graphCandidatesOf(graph, input, options).candidates
      const resourceCandidates = this.resourceCandidatesOf(input)
      const store = this.storeOf(input.workspaceDir)
      const notes = this.notesOf(input.workspaceDir)
      const candidates = searchFast(store, notes, {
        sessionId: input.sessionId,
        query: input.userQuestion,
        projectName: input.projectName,
        workspaceDir: input.workspaceDir,
        recentChatText: recentChat,
        graphCandidates,
        resourceCandidates,
      }, options.perSourceLimit ?? 8)
      const filtered = this.applyUserFilters(candidates, options)
      const selection = selectWithinBudget(filtered, options.tokenBudget ?? DEFAULT_ASSEMBLE_TOKEN_BUDGET)
      const rendered = renderReadingMaterial({
        sessionId: input.sessionId,
        question: input.userQuestion,
        branchBackground: recentChat,
        graphBackground: this.memoryTextOf(graph, input, options).text,
        snippets: this.toRenderSnippets(selection.included),
        continueRead: this.continueReadEntries(selection.included, selection.excluded),
        tokenBudget: options.tokenBudget ?? DEFAULT_ASSEMBLE_TOKEN_BUDGET,
      })
      this.prepared.set(input.sessionId, {
        text: rendered.text,
        question: input.userQuestion,
        questionId: questionIdOf(input.sessionId, input.userQuestion),
        createdAt: Date.now(),
      })
    } catch {
      // 快速投影失败不能阻塞模型调用；MemoryRuntime/普通检索仍可用。
    }
  }

  /** 当前会话的首次调用投影（systemPrompt contributor 使用）。 */
  preparedText(sessionId: string): string {
    return this.prepared.get(sessionId)?.text ?? ''
  }

  /** 当前会话快速投影对应的问题（PLAT-14 真实 prompt 接线使用）。 */
  preparedQuestion(sessionId: string): string {
    return this.prepared.get(sessionId)?.question ?? ''
  }

  /** turn 结束后清理临时投影，避免下一轮复用旧问题。 */
  clearPrepared(sessionId: string): void {
    this.prepared.delete(sessionId)
  }

  /** 快速路径组装（CTX-03；同步收集，异步仅存于可选的 rewrite）。 */
  async assemble(input: AssembleInput): Promise<AssemblyResult> {
    return this.doAssemble(input, { ...(input.options ?? {}), deep: false })
  }

  /** 深入路径组装（CTX-04；查询改写 + embedding + 邻域 + 前后文）。 */
  async assembleDeep(input: AssembleInput): Promise<AssemblyResult> {
    return this.doAssemble(input, { ...(input.options ?? {}), deep: true })
  }

  /** CTX-09 预览：列出本轮参考内容与包含/排除状态（不渲染、不持久化）。 */
  async preview(input: AssembleInput): Promise<ReferencePreview> {
    const options = input.options ?? {}
    const graph = this.graphOf(input)
    const { candidates } = await this.collect(input, options, graph)
    const selection = this.applyUserFilters(candidates, options)
    const items = candidates.map((candidate) => {
      const included = selection.some((selected) => selected.id === candidate.id && selected.kind === candidate.kind)
      return {
        id: candidate.id,
        kind: candidate.kind,
        title: candidate.title,
        snippet: candidate.snippet.slice(0, 120),
        connected: candidate.connected,
        included,
        reason: candidate.connected ? 'Graph 明确连接' : '检索命中',
      } satisfies ReferencePreviewItem
    })
    return { sessionId: input.sessionId, question: input.userQuestion, items }
  }

  // ── CTX-10 效果信号 ───────────────────────────────────────────────────────

  /** 追加一条效果信号（持久化到 <dataRoot>/.evoresearch-data/context/effects.jsonl）。 */
  recordEffect(signal: EffectSignalRecord): void {
    this.effects.push(signal)
    try {
      const file = path.join(this.dataRoot, '.evoresearch-data', 'context', 'effects.jsonl')
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.appendFileSync(file, `${JSON.stringify(signal)}\n`, 'utf8')
    } catch {
      // 持久化失败不影响内存
    }
  }

  /** 把某问题的最新信号标记为"继续读了原文"。 */
  markReadMore(questionId: string): void {
    const latest = this.latestEffect(questionId)
    if (latest === undefined) return
    const updated: EffectSignalRecord = { ...latest, readMore: true }
    const index = this.effects.findIndex((signal) => signal.signalId === latest.signalId)
    if (index >= 0) this.effects[index] = updated
    this.recordEffect(updated)
  }

  queryEffects(query: EffectQuery = {}): readonly EffectSignalRecord[] {
    return this.effects
      .filter((signal) => {
        if (query.sessionId !== undefined && signal.sessionId !== query.sessionId) return false
        if (query.questionId !== undefined && signal.questionId !== query.questionId) return false
        if (query.since !== undefined && signal.createdAt < query.since) return false
        return true
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, query.limit ?? 100)
  }

  private latestEffect(questionId: string): EffectSignalRecord | undefined {
    return this.queryEffects({ questionId, limit: 1 })[0]
  }

  // ── 内部实现 ──────────────────────────────────────────────────────────────

  private async doAssemble(input: AssembleInput, options: AssembleOptions): Promise<AssemblyResult> {
    const tokenBudget = options.tokenBudget ?? DEFAULT_ASSEMBLE_TOKEN_BUDGET
    const degraded: string[] = []
    const graph = this.graphOf(input)
    const { candidates: collected, memoryText } = await this.collect(input, options, graph, degraded)

    // CTX-09 include/exclude
    const filtered = this.applyUserFilters(collected, options)

    // CTX-11 预算内选择
    const selection = selectWithinBudget(filtered, tokenBudget)

    // CTX-08 渲染
    const questionId = questionIdOf(input.sessionId, input.userQuestion)
    const rendered = renderReadingMaterial({
      sessionId: input.sessionId,
      question: input.userQuestion,
      branchBackground: this.recentChatOf(input, options),
      graphBackground: memoryText.text,
      snippets: this.toRenderSnippets(selection.included),
      continueRead: this.continueReadEntries(selection.included, selection.excluded),
      tokenBudget,
    })

    const effects: EffectSignalRecord = {
      signalId: randomUUID(),
      sessionId: input.sessionId,
      questionId,
      createdAt: Date.now(),
      readMore: false,
      removedIds: options.excludedIds ?? [],
      prunedIds: [...rendered.truncatedIds, ...selection.prunedIds],
      injected: selection.included.length,
      totalCandidates: collected.length,
      graphConnectedInjected: selection.included.filter((candidate) => candidate.connected).length,
    }
    this.recordEffect(effects)

    return {
      sessionId: input.sessionId,
      questionId,
      text: rendered.text,
      estimatedTokens: rendered.estimatedTokens,
      sections: rendered.sections,
      candidates: collected,
      included: selection.included,
      excluded: selection.excluded,
      effects,
      deep: options.deep === true,
      degraded,
      linkTrace: memoryText.trace,
    }
  }

  /** 收集全部候选（快速路径；深入路径叠加异步来源）。 */
  private async collect(
    input: AssembleInput,
    options: AssembleOptions,
    graph: ChatGraph,
    degraded?: string[],
  ): Promise<{ candidates: readonly SearchCandidate[]; memoryText: { text: string; trace: readonly LinkTraceEntry[] } }> {
    const recentChat = this.recentChatOf(input, options)
    const graphCandidates = this.graphCandidatesOf(graph, input, options)
    const memoryText = this.memoryTextOf(graph, input, options)
    const perSource = options.perSourceLimit ?? 8
    const store = this.storeOf(input.workspaceDir)
    const notes = this.notesOf(input.workspaceDir)

    const fastInput: FastSearchInput = {
      sessionId: input.sessionId,
      query: input.userQuestion,
      projectName: input.projectName,
      workspaceDir: input.workspaceDir,
      recentChatText: recentChat,
      graphCandidates: graphCandidates.candidates,
      resourceCandidates: this.resourceCandidatesOf(input),
    }

    if (options.deep !== true) {
      // 快速路径（CTX-03）：可选改写（默认不做，避免等待 LLM）
      let rewrittenQuery: string | undefined
      if (options.rewrite === true) {
        const rewriter = this.rewriterOf()
        if (rewriter !== undefined) {
          rewrittenQuery = await rewriteQuerySafe(rewriter, input.userQuestion)
          if (rewrittenQuery === undefined) degraded?.push('查询改写失败，使用原文')
        }
      }
      return {
        candidates: searchFast(store, notes, { ...fastInput, rewrittenQuery }, perSource),
        memoryText,
      }
    }

    // 深入路径（CTX-04）
    const rewriter = this.rewriterOf()
    const neighborhood = this.neighborhoodCandidatesOf(graph, input)
    const deepCandidates = await searchDeep(store, notes, {
      ...fastInput,
      rewrite: rewriter ?? undefined,
      embeddings: this.deps.embeddings,
      neighborhoodCandidates: neighborhood,
    }, perSource, (message) => degraded?.push(message))
    if (rewriter === undefined) degraded?.push('查询改写不可用（未配置辅助模型），使用原文')
    if (this.deps.embeddings === undefined || !this.deps.embeddings.ready) degraded?.push('embedding 不可用，跳过语义召回')
    return { candidates: deepCandidates, memoryText }
  }

  private storeOf(workspaceDir: string | undefined): MemoryStoreLike {
    const resolved = workspaceDir ?? this.dataRoot
    const store = this.deps.storeFor?.(resolved) ?? this.deps.store
    if (store === undefined) throw new Error(`记忆库服务不可用: ${resolved}`)
    return store
  }

  private notesOf(workspaceDir: string | undefined): NotesServiceLike {
    return this.deps.notesFor?.(workspaceDir ?? this.dataRoot) ?? this.deps.notes
  }

  private graphOf(input: AssembleInput): ChatGraph {
    const projectName = input.projectName ?? (input.workspaceDir === undefined ? undefined : projectNameFromWorkspace(this.dataRoot, input.workspaceDir))
    if (projectName === undefined || projectName === '') return { nodes: [], edges: [] }
    try {
      return this.deps.chatGraph.get(projectName)
    } catch {
      return { nodes: [], edges: [] }
    }
  }

  private recentChatOf(input: AssembleInput, options: AssembleOptions): string {
    const maxChars = options.recentChatChars ?? 4000
    const reader = this.deps.recentChatText ?? sessionHistoryText
    try {
      return reader(input.sessionId, maxChars)
    } catch {
      return ''
    }
  }

  /**
   * Graph 记忆背景文本（尊重 CTX-09 include/exclude：被用户移除或不在白名单
   * 的节点不进入背景注入）。
   */
  private memoryTextOf(graph: ChatGraph, input: AssembleInput, options: AssembleOptions = input.options ?? {}): { text: string; trace: readonly LinkTraceEntry[] } {
    const node = chatNodeOf(graph, input.sessionId)
    if (node === undefined) return { text: '', trace: [] }
    const excluded = new Set(input.options?.excludedIds ?? [])
    const whitelist = input.options?.includedIds
    const memoryIds = [...new Set(graph.edges.filter((edge) => edge.to === node.id && edge.toPort === 'memory' && isRuntimeEdge(edge)).map((edge) => edge.from))]
    const parts: string[] = []
    const trace: LinkTraceEntry[] = []
    const resolver = this.deps.linkResolver ?? new LinkResolver(this.dataRoot)
    let total = 0
    for (const memoryId of memoryIds) {
      if (excluded.has(memoryId)) continue
      if (whitelist !== undefined && whitelist.length > 0 && !whitelist.includes(memoryId)) continue
      const memoryNode = graph.nodes.find((n) => n.id === memoryId && (isMemoryNode(n) || n.type === 'resource'))
      if (memoryNode === undefined) continue
      const text = this.nodeTextOf(memoryNode, input.workspaceDir, input.userQuestion).trim()
      if (text === '') continue
      const slice = text.slice(0, 1500)
      total += slice.length + 2
      if (total > 6000) break
      parts.push(slice)
      // A Memory document is a navigation surface: follow only a few links
      // whose label/path matches the current question. Other links remain
      // visible through the trace and can be opened explicitly by the user.
      const memoryBase = memoryNode.scope === 'global' ? this.dataRoot : (input.workspaceDir ?? this.dataRoot)
      const absoluteRef = memoryNode.ref?.path !== undefined
        && (path.isAbsolute(memoryNode.ref.path) || /^[A-Za-z]:[\\/]/.test(memoryNode.ref.path))
      const sourceFile = memoryNode.ref?.path !== undefined
        ? absoluteRef
          ? memoryNode.ref.path
          : memoryNode.ref.kind === 'note'
          ? path.resolve(memoryBase, '.evoresearch-data', 'memories', 'notes', memoryNode.ref.path)
          : path.resolve(memoryBase, memoryNode.ref.path)
        : undefined
      const sidecar = sourceFile !== undefined ? sidecarLinksFor(sourceFile) : []
      // follow() handles inline links; merge sidecar links explicitly by using
      // a second bounded traversal over a synthetic link list. This keeps the
      // sidecar an index, never the sole copy of the Memory正文.
      const sidecarText = sidecar.length === 0 ? '' : sidecar
        .filter((link) => typeof link.target === 'string' && link.target.trim() !== '')
        .map((link) => {
          const rawTarget = String(link.target)
          const typed = typeof link.kind === 'string'
            && /^(?:chat|session|note|paper|experiment|run|log|file|code|latex|result|manuscript)$/i.test(link.kind)
            && !/^(?:https?:\/\/|evoresearch:\/\/|[a-z-]+:)/i.test(rawTarget)
            ? `${link.kind}:${rawTarget}`
            : rawTarget
          return `[${typeof link.label === 'string' ? link.label : rawTarget}](${typed})`
        })
        .join('\n')
      const traversal = resolver.follow(`${text}\n${sidecarText}`, `graph:${memoryNode.id}`, {
        workspaceDir: memoryBase,
        sourceFile,
        maxTargets: 8,
        maxDepth: options.linkMaxDepth ?? 2,
        maxReads: options.linkMaxReads ?? 6,
        maxChars: Math.min(options.linkMaxChars ?? 4_000, Math.max(1, 6_000 - total)),
      })
      if (traversal.text !== '') parts.push(traversal.text)
      trace.push(...traversal.traces)
      total += traversal.text.length
    }
    return { text: parts.join('\n\n---\n\n'), trace }
  }

  /** Graph 直接连接内容 → 候选（CTX-03/07：connected）。 */
  private graphCandidatesOf(
    graph: ChatGraph,
    input: AssembleInput,
    options: AssembleOptions,
  ): { candidates: SearchCandidate[] } {
    const node = chatNodeOf(graph, input.sessionId)
    if (node === undefined) return { candidates: [] }
    const memoryIds = [...new Set(graph.edges.filter((edge) => edge.to === node.id && edge.toPort === 'memory' && isRuntimeEdge(edge)).map((edge) => edge.from))]
    const candidates: SearchCandidate[] = []
    for (const memoryId of memoryIds) {
      const memoryNode = graph.nodes.find((n) => n.id === memoryId && n.type !== 'chat')
      if (memoryNode === undefined) continue
      const text = this.nodeTextOf(memoryNode, input.workspaceDir, input.userQuestion)
      if (text.trim() === '') continue
      const kind = candidateKindOf(memoryNode)
      candidates.push(makeCandidate({
        kind,
        id: memoryNode.id,
        title: memoryNode.title || (kind === 'paper' ? 'Graph 论文节点' : 'Graph 资料节点'),
        snippet: text.slice(0, 800),
        score: kind === 'graph' ? 20 : 24,
        connected: true,
        location: { kind: 'graph', nodeId: memoryNode.id },
        sourceLabel: kind === 'graph' ? 'Graph 明确连接的记忆' : `Graph 明确连接的${kindLabel(kind)}`,
      }))
      // 持续参考聊天（memory 边连入的其他 chat 节点）
      const siblingChats = graph.edges
        .filter((edge) => edge.from === memoryNode.id && edge.to !== node.id && edge.toPort === 'memory' && isRuntimeEdge(edge))
        .map((edge) => graph.nodes.find((n) => n.id === edge.to && n.type === 'chat'))
      for (const chat of siblingChats) {
        if (chat?.sessionId === undefined || chat.sessionId === input.sessionId) continue
        const reader = this.deps.recentChatText ?? sessionHistoryText
        let text = ''
        try { text = reader(chat.sessionId, 1500) } catch { text = '' }
        if (text.trim() === '') continue
        candidates.push(makeCandidate({
          kind: 'chat',
          id: chat.id,
          title: chat.title || '持续参考聊天',
          snippet: text.slice(0, 1200),
          score: 15,
          connected: true,
          location: { kind: 'chat', sessionId: chat.sessionId },
          sourceLabel: 'Graph 持续参考',
        }))
      }
    }
    return { candidates }
  }

  /** 深入路径：Graph 邻域扩展（CTX-04；connected=false 但 neighborhood=true）。 */
  private neighborhoodCandidatesOf(graph: ChatGraph, input: AssembleInput): SearchCandidate[] {
    const node = chatNodeOf(graph, input.sessionId)
    if (node === undefined) return []
    const memoryIds = new Set(graph.edges.filter((edge) => edge.to === node.id && edge.toPort === 'memory' && isRuntimeEdge(edge)).map((edge) => edge.from))
    const candidates: SearchCandidate[] = []
    for (const memoryNode of graph.nodes) {
      if (!isMemoryNode(memoryNode) || !memoryIds.has(memoryNode.id)) continue
      // 与该记忆节点相连的其他 chat（兄弟分支/汇合聊天）
      for (const edge of graph.edges) {
        if (edge.from !== memoryNode.id && edge.to !== memoryNode.id) continue
        if (edge.toPort !== 'memory' || !isRuntimeEdge(edge)) continue
        const otherId = edge.from === memoryNode.id ? edge.to : edge.from
        const other = graph.nodes.find((n) => n.id === otherId && n.type === 'chat')
        if (other === undefined || other.id === node.id) continue
        candidates.push(makeCandidate({
          kind: 'chat',
          id: `neighbor:${other.id}`,
          title: `邻域聊天 ${other.title}`,
          snippet: `与记忆节点「${memoryNode.title}」相连的另一个聊天分支`,
          score: 3,
          connected: false,
          neighborhood: true,
          location: other.sessionId !== undefined ? { kind: 'chat', sessionId: other.sessionId } : { kind: 'graph', nodeId: other.id },
          sourceLabel: 'Graph 邻域扩展',
        }))
      }
    }
    // 深入路径只回读一跳 fork 祖先；祖先正文仍按当前问题进入低权重候选，
    // 不把整条历史链默认拼进每一轮上下文。
    const parentIds = graph.edges
      .filter((edge) => edge.to === node.id && edge.toPort === 'context' && isRuntimeEdge(edge))
      .map((edge) => edge.from)
    const reader = this.deps.recentChatText ?? sessionHistoryText
    for (const parentId of parentIds) {
      const parent = graph.nodes.find((candidate) => candidate.id === parentId && candidate.type === 'chat')
      if (parent?.sessionId === undefined) continue
      let text = ''
      try { text = reader(parent.sessionId, 1200) } catch { text = '' }
      if (text.trim() === '') continue
      candidates.push(makeCandidate({
        kind: 'chat',
        id: `ancestor:${parent.id}`,
        title: `分支祖先 ${parent.title}`,
        snippet: text.slice(0, 1200),
        score: 4,
        connected: false,
        neighborhood: true,
        location: { kind: 'chat', sessionId: parent.sessionId },
        sourceLabel: '分支祖先（深入检索）',
      }))
    }
    return candidates
  }

  private nodeTextOf(node: GraphNode, workspaceDir: string | undefined, question = ''): string {
    if (node.content !== undefined && node.content.trim() !== '') return node.content
    if (node.ref !== undefined) {
      if (this.deps.resourceReader !== undefined) {
        try {
          const resource = this.deps.resourceReader({ node, workspaceDir, question, maxChars: 1600 })
          if (resource.ok && resource.text !== undefined) return resource.text
        } catch {
          // 专用读取失败时回退到通用 preview
        }
      }
      const preview = this.deps.previewOf
      if (preview !== undefined) {
        try {
          const result = preview(node, workspaceDir, 800)
          if (result.ok && result.text !== undefined) return result.text
        } catch {
          // 预览失败：跳过该节点
        }
      }
    }
    return ''
  }

  /** 未先固定到 Graph 的项目资料候选（代码/日志/LaTeX/PDF/结果）。 */
  private resourceCandidatesOf(input: AssembleInput): SearchCandidate[] {
    const root = input.workspaceDir
    if (root === undefined || root === '') return []
    const query = input.userQuestion.trim().toLowerCase()
    if (query === '') return []
    const terms = query.split(/[\s,，。！？!?;；:：/\\]+/).filter((term) => term.length >= 2).slice(0, 12)
    const candidates: SearchCandidate[] = []
    const seen = new Set<string>()
    const skip = new Set(['.git', '.venv', 'node_modules', 'dist', 'build', '.next', '.evoresearch-data', '__pycache__'])
    const allowed = new Set(['.md', '.txt', '.log', '.out', '.err', '.json', '.jsonl', '.csv', '.tex', '.bib', '.py', '.ts', '.tsx', '.js', '.jsx', '.rs', '.java', '.c', '.cpp', '.h', '.yaml', '.yml', '.toml', '.pdf'])
    const readPdf = (file: string): string => {
      try {
        return execFileSync('pdftotext', ['-f', '1', '-l', '4', '-layout', file, '-'], { encoding: 'utf8', timeout: 2500, maxBuffer: 2 * 1024 * 1024 }).slice(0, 1800)
      } catch {
        return ''
      }
    }
    const walk = (dir: string, depth: number): void => {
      if (depth > 8 || candidates.length >= 40) return
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        if (skip.has(entry.name)) continue
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(file, depth + 1); continue }
        if (!entry.isFile()) continue
        const ext = path.extname(entry.name).toLowerCase()
        if (!allowed.has(ext)) continue
        const relative = path.relative(root, file).split(path.sep).join('/')
        if (seen.has(relative)) continue
        let text = ''
        try {
          const stat = fs.statSync(file)
          if (stat.size > 8 * 1024 * 1024) continue
          text = ext === '.pdf' ? readPdf(file) : fs.readFileSync(file, 'utf8').slice(0, 1800)
          if (text.includes('\u0000')) text = ''
        } catch { continue }
        const haystack = `${entry.name}\n${text}`.toLowerCase()
        const matched = terms.filter((term) => haystack.includes(term))
        if (matched.length === 0) continue
        seen.add(relative)
        const kind = ext === '.pdf' ? 'paper' as const : 'resource' as const
        candidates.push(makeCandidate({
          kind,
          id: `file:${relative}`,
          title: entry.name,
          snippet: text.replace(/\s+/g, ' ').trim().slice(0, 900) || `资料文件：${relative}`,
          score: matched.length * 2 + (ext === '.pdf' ? 1 : 0),
          connected: false,
          location: { kind: 'resource', path: file },
          sourceLabel: ext === '.pdf' ? '项目论文（自动发现）' : '项目资料（自动发现）',
        }))
        if (candidates.length >= 40) return
      }
    }
    walk(root, 0)
    return candidates
  }

  private rewriterOf(): QueryRewriterLike | undefined {
    const llm = this.deps.llm
    if (llm === undefined) return undefined
    const route = this.deps.rewriteModel ?? { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    return {
      async rewrite(question: string): Promise<string | undefined> {
        try {
          return await llm.callText({
            provider: route.provider,
            model: route.model,
            system: REWRITE_SYSTEM_PROMPT,
            messages: [question],
            maxTokens: 300,
          })
        } catch {
          return undefined
        }
      },
    }
  }

  private applyUserFilters(
    candidates: readonly SearchCandidate[],
    options: AssembleOptions,
  ): SearchCandidate[] {
    const excluded = new Set(options.excludedIds ?? [])
    let filtered = candidates.filter((candidate) => !excluded.has(candidate.id) && !excluded.has(`${candidate.kind}:${candidate.id}`))
    const included = options.includedIds
    if (included !== undefined && included.length > 0) {
      const whitelist = new Set(included)
      filtered = filtered.filter((candidate) =>
        whitelist.has(candidate.id) || whitelist.has(`${candidate.kind}:${candidate.id}`))
    }
    return filtered
  }

  private toRenderSnippets(candidates: readonly SearchCandidate[]): RenderSnippet[] {
    return candidates.map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind,
      title: candidate.title,
      text: candidate.snippet,
      location: locationString(candidate.location),
      connected: candidate.connected,
    }))
  }

  /**
   * 继续深入读取入口：先列已注入候选，再补预算裁掉的候选（长材料只放
   * 片段与入口——即使片段未注入，模型也有继续读取的钥匙）。
   */
  private continueReadEntries(included: readonly SearchCandidate[], pruned: readonly SearchCandidate[]): ContinueReadEntry[] {
    const entries: ContinueReadEntry[] = []
    const seen = new Set<string>()
    const pushEntry = (candidate: SearchCandidate): void => {
      const location = candidate.location
      let entry: ContinueReadEntry | undefined
      if (location.kind === 'turn') {
        entry = { label: `阅读轮次 ${candidate.title}`, hint: `read_research_turn(turnId=${location.turnId})`, location: locationString(location) }
      } else if (location.kind === 'segment') {
        entry = { label: `阅读片段（${candidate.title}）`, hint: `read_research_turn(turnId=${location.turnId}, segmentId=${location.segmentId})`, location: locationString(location) }
      } else if (location.kind === 'note') {
        entry = { label: `阅读笔记 ${candidate.title}`, hint: `read_note(noteId=${location.noteId})`, location: locationString(location) }
      } else if (location.kind === 'observation') {
        entry = { label: `阅读观察 ${candidate.title}`, hint: `read_memory(observationId=${location.observationId})`, location: locationString(location) }
      } else if (location.kind === 'graph') {
        entry = { label: `打开 Graph 节点 ${candidate.title}`, hint: `graph_preview(nodeId=${location.nodeId})`, location: locationString(location) }
      } else if (location.kind === 'resource') {
        const suffix = location.page === undefined ? '' : `, page=${location.page}`
        entry = { label: `继续读取资料 ${candidate.title}`, hint: `read_file(path=${location.path}, offset=${location.offset ?? 0}${suffix})`, location: locationString(location) }
      }
      if (entry === undefined || seen.has(entry.location)) return
      seen.add(entry.location)
      entries.push(entry)
    }
    for (const candidate of included) pushEntry(candidate)
    for (const candidate of pruned) pushEntry(candidate)
    return entries.slice(0, 8)
  }
}

/** 定位序列化（机器可读内部定位）。 */
export function locationString(location: CandidateLocation): string {
  switch (location.kind) {
    case 'turn': return `turn:${location.turnId}`
    case 'segment': return `segment:${location.turnId}:${location.segmentId}`
    case 'note': return `note:${location.noteId}@${location.offset}`
    case 'observation': return `observation:${location.observationId}`
    case 'graph': return `graph:${location.nodeId}`
    case 'chat': return `chat:${location.sessionId}`
    case 'background': return `background:${location.docKind}`
    case 'resource': return `resource:${location.path}${location.page === undefined ? '' : `#page=${location.page}`}${location.offset === undefined ? '' : `@${location.offset}`}`
  }
}

function candidateKindOf(node: GraphNode): SearchCandidate['kind'] {
  if (isMemoryNode(node)) return 'graph'
  switch (node.displayKind ?? node.ref?.kind) {
    case 'paper':
    case 'pdf': return 'paper'
    default: return 'resource'
  }
}

function kindLabel(kind: SearchCandidate['kind']): string {
  if (kind === 'paper') return '论文'
  if (kind === 'resource') return '资料'
  return '记忆'
}

/** 安全改写：任何异常 → undefined（由调用方降级原文）。 */
async function rewriteQuerySafe(rewriter: QueryRewriterLike, question: string): Promise<string | undefined> {
  try {
    return await rewriter.rewrite(question)
  } catch {
    return undefined
  }
}
