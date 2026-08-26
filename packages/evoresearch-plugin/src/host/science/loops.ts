/**
 * 科学自演化循环：Idea 分支探索与实验尝试探索（SCI-07/08/09）。
 *
 * SCI-07：Idea tree / experiment tree 视图数据接口——从 Chat Graph（context 边
 * = fork 父子关系）与实验目录派生，不要求用户维护树节点 JSON。
 * SCI-08：用户授权的自动循环：预算（maxSteps）/ 暂停 / 取消 / 结果回报 /
 * 失败保留 / 分支回滚；状态机为纯函数（loopTransition），执行壳 executeLoop
 * 接受注入的 runner（子代理/LLM 由上层提供）。
 * SCI-09：循环产出追加到对应 Graph 节点或实验目录（只追加，不覆盖原始资料）；
 * 实验追加对接 ExperimentWorkspaceService.appendNote（t12），Graph 追加由上层
 * 通过 Appender 接口接线（memory 节点写文件 / 会话投递等）。
 */
import { isMemoryNode, type ChatGraph, type GraphNode } from '../chat-graph.js'
import type { ScienceMemoryLink } from './memory.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

/* ------------------------------------------------------------------ */
/* SCI-07：tree 视图（派生，不要求用户维护树 JSON）                      */
/* ------------------------------------------------------------------ */

/** 树节点（视图数据，纯 JSON）。 */
export interface ScienceTreeNode {
  readonly id: string
  readonly kind: 'idea' | 'experiment' | 'chat'
  readonly title: string
  /** 来源定位（graph 节点 id / 实验 slug / 记忆文件）。 */
  readonly source: { type: 'graph-node' | 'experiment-dir' | 'memory'; ref: string }
  readonly children: readonly ScienceTreeNode[]
}

/** 实验目录最小形态（对接 ExperimentWorkspaceService.listWorkspaces 的摘要字段）。 */
export interface ExperimentDirLike {
  readonly slug: string
  readonly dir: string
  readonly createdAt: number
}

/**
 * 从 Chat Graph 派生 Idea tree（SCI-07）：
 * context 边（from → to 的 toPort === 'context'）＝ 分支父子关系（to 继承自 from）；
 * 无 context 边来源的 chat 节点为根；memory 节点作为其被连线父节点的叶子挂载。
 */
export function ideaTreeFromGraph(graph: ChatGraph, rootNodeId?: string): ScienceTreeNode[] {
  const nodes = new Map<string, GraphNode>()
  for (const node of graph.nodes) nodes.set(node.id, node)
  const childrenOf = new Map<string, string[]>()
  const roots: string[] = []
  const hasParent = new Set<string>()
  for (const edge of graph.edges) {
    if (edge.toPort !== 'context') continue
    const list = childrenOf.get(edge.from) ?? []
    list.push(edge.to)
    childrenOf.set(edge.from, list)
    hasParent.add(edge.to)
  }
  if (rootNodeId !== undefined && nodes.has(rootNodeId)) {
    // 指定根：从该节点向下展开
    const build = (id: string, visiting = new Set<string>()): ScienceTreeNode | undefined => {
      const node = nodes.get(id)
      if (!node) return undefined
      if (visiting.has(id)) return undefined
      const nextVisiting = new Set(visiting)
      nextVisiting.add(id)
      return {
        id: node.id,
        kind: node.type === 'chat' ? 'chat' : 'idea',
        title: node.title,
        source: { type: 'graph-node', ref: node.id },
        children: (childrenOf.get(id) ?? []).map((child) => build(child, nextVisiting)).filter((n): n is ScienceTreeNode => n !== undefined),
      }
    }
    const root = build(rootNodeId)
    return root ? [root] : []
  }
  for (const node of graph.nodes) {
    if (node.type === 'chat' && !hasParent.has(node.id)) roots.push(node.id)
  }
  if (roots.length === 0 && graph.nodes.length > 0) {
    // 环/孤立：取第一个 chat 节点为根（视图尽力而为，不阻断）。
    roots.push(graph.nodes[0]!.id)
  }
  const build = (id: string, visiting = new Set<string>()): ScienceTreeNode | undefined => {
    const node = nodes.get(id)
    if (!node) return undefined
    if (visiting.has(id)) return undefined
    const nextVisiting = new Set(visiting)
    nextVisiting.add(id)
    const children: ScienceTreeNode[] = []
    for (const childId of childrenOf.get(id) ?? []) {
      const child = build(childId, nextVisiting)
      if (child) children.push(child)
    }
    // Current graphs use memory → chat. Older graph snapshots used chat →
    // memory, so the derived tree accepts both directions while runtime
    // context semantics remain owned by ChatGraphService.
    for (const edge of graph.edges) {
      if (edge.toPort !== 'memory') continue
      const targetId = edge.to === id ? edge.from : edge.from === id ? edge.to : undefined
      if (targetId === undefined) continue
      const target = nodes.get(targetId)
      if (target && isMemoryNode(target)) {
        children.push({
          id: target.id,
          kind: 'idea',
          title: target.title,
          source: { type: 'graph-node', ref: target.id },
          children: [],
        })
      }
    }
    return {
      id: node.id,
      kind: node.type === 'chat' ? 'chat' : 'idea',
      title: node.title,
      source: { type: 'graph-node', ref: node.id },
      children,
    }
  }
  return roots.map((id) => build(id)).filter((n): n is ScienceTreeNode => n !== undefined)
}

/**
 * 从实验目录列表派生 experiment tree（SCI-07）：默认扁平（每个实验一个根），
 * 上层可注入 parentOf 按命名约定/目录关系分组。
 */
export function experimentTreeFromDirs(
  dirs: readonly ExperimentDirLike[],
  parentOf?: (slug: string) => string | undefined,
): ScienceTreeNode[] {
  const bySlug = new Map(dirs.map((dir) => [dir.slug, dir]))
  const childrenOf = new Map<string, string[]>()
  const roots: string[] = []
  for (const dir of dirs) {
    const parent = parentOf?.(dir.slug)
    if (parent !== undefined && bySlug.has(parent)) {
      const list = childrenOf.get(parent) ?? []
      list.push(dir.slug)
      childrenOf.set(parent, list)
    } else {
      roots.push(dir.slug)
    }
  }
  const build = (slug: string): ScienceTreeNode => {
    const dir = bySlug.get(slug)!
    return {
      id: `exp:${slug}`,
      kind: 'experiment',
      title: slug,
      source: { type: 'experiment-dir', ref: dir.dir },
      children: (childrenOf.get(slug) ?? []).map(build),
    }
  }
  return roots.map(build)
}

/* ------------------------------------------------------------------ */
/* SCI-08：自动循环（状态机纯函数 + 执行壳）                             */
/* ------------------------------------------------------------------ */

/** 循环类型。 */
export type ScienceLoopKind = 'idea-explore' | 'experiment-try'

/** 循环状态（终态：completed / cancelled / failed）。 */
export type ScienceLoopStatus = 'idle' | 'running' | 'paused' | 'cancelled' | 'completed' | 'failed'

/** 步骤状态（rolled-back = 分支回滚已释放）。 */
export type ScienceLoopStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'rolled-back'

/** 循环步骤。 */
export interface ScienceLoopStep {
  readonly stepId: string
  readonly label: string
  status: ScienceLoopStepStatus
  /** 结果回报文本（回主聊天）。 */
  readonly output?: string
  readonly error?: string
  /** 产出追加位置（SCI-09）。 */
  readonly appendTo?: AppendTarget
  /** 追加收据；用于只撤销本循环本步骤产生的内容。 */
  readonly appendReceipt?: LoopAppendReceipt
  /** 最近一次物理回滚结果；失败时保留失败原因而不伪称资料已撤回。 */
  readonly rollback?: { readonly ok: boolean; readonly at: number; readonly error?: string }
}

/** 追加目标（SCI-09）。 */
export interface AppendTarget {
  /** graph-node：Chat Graph 节点 id；experiment：实验 slug。 */
  readonly kind: 'graph-node' | 'experiment'
  readonly ref: string
}

/** 自动循环（用户授权；预算/停止/取消/结果回报/失败保留/分支回滚）。 */
export interface ScienceLoop {
  readonly loopId: string
  readonly kind: ScienceLoopKind
  readonly title: string
  /** 授权者（用户授权记录）。 */
  readonly authorizedBy: string
  /** 预算：最多步骤数（超出自动完成）。 */
  readonly budget: { maxSteps: number }
  readonly createdAt: number
  status: ScienceLoopStatus
  steps: readonly ScienceLoopStep[]
  /** 结果回报目标（如主会话 id / 通道标识）。 */
  readonly reportTo?: string
  /** 项目工作区（实验追加与重启恢复的作用域）。 */
  readonly workspaceDir?: string
  /** 完成/取消后的汇总回报文本。 */
  readonly finalReport?: string
}

/** 创建循环（SCI-08）。 */
export function createScienceLoop(input: {
  kind: ScienceLoopKind
  title: string
  authorizedBy: string
  budget?: { maxSteps?: number }
  steps?: readonly { label: string; appendTo?: AppendTarget }[]
  reportTo?: string
  workspaceDir?: string
}): ScienceLoop {
  const maxSteps = Math.max(1, input.budget?.maxSteps ?? 5)
  const steps: ScienceLoopStep[] = (input.steps ?? []).slice(0, maxSteps).map((step, index) => ({
    stepId: `step-${index + 1}`,
    label: step.label,
    status: 'pending',
    appendTo: step.appendTo,
  }))
  return {
    loopId: `loop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind,
    title: input.title,
    authorizedBy: input.authorizedBy,
    budget: { maxSteps },
    createdAt: Date.now(),
    status: 'idle',
    steps,
    reportTo: input.reportTo,
    workspaceDir: input.workspaceDir,
  }
}

/** 循环动作（SCI-08 状态机）。 */
export type ScienceLoopAction =
  | 'start' // idle → running
  | 'pause' // running → paused
  | 'resume' // paused → running
  | 'cancel' // 任意非终态 → cancelled（当前 running 步骤回滚）
  | 'step-done' // 当前 running 步骤完成；无后续步骤 → completed
  | 'step-failed' // 当前步骤失败（失败保留，继续下一轮或完成）
  | 'rollback-step' // 回滚指定步骤（分支回滚）
  | 'complete' // 显式完成（含预算耗尽）

/** 状态机纯函数（SCI-08；返回新 loop 对象，不修改入参）。 */
export function loopTransition(loop: ScienceLoop, action: ScienceLoopAction, stepId?: string, detail?: { output?: string; error?: string }): ScienceLoop {
  if (loop.status === 'cancelled' || loop.status === 'completed' || loop.status === 'failed') {
    // 终态不可迁移（complete 对已完成幂等）。
    if (action === 'complete' && loop.status === 'completed') return loop
    return loop
  }
  const steps = [...loop.steps]
  const currentIndex = steps.findIndex((step) => step.status === 'running')

  switch (action) {
    case 'start':
      if (loop.status !== 'idle') return loop
      if (steps.length === 0) return { ...loop, status: 'completed', finalReport: '循环没有步骤，直接完成' }
      steps[0] = { ...steps[0]!, status: 'running' }
      return { ...loop, status: 'running', steps }
    case 'pause':
      if (loop.status !== 'running') return loop
      return { ...loop, status: 'paused' }
    case 'resume':
      if (loop.status !== 'paused') return loop
      return { ...loop, status: 'running' }
    case 'cancel': {
      // 取消：当前 running 步骤标记 rolled-back（分支回滚），循环进入 cancelled。
      if (currentIndex >= 0) {
        steps[currentIndex] = { ...steps[currentIndex]!, status: 'rolled-back' }
      }
      const doneCount = steps.filter((s) => s.status === 'done').length
      return {
        ...loop,
        status: 'cancelled',
        steps,
        finalReport: `循环已取消（完成 ${doneCount}/${steps.length} 步；当前步骤已回滚）`,
      }
    }
    case 'step-done': {
      if (currentIndex < 0) return loop
      steps[currentIndex] = { ...steps[currentIndex]!, status: 'done', output: detail?.output, error: undefined }
      const next = steps.findIndex((s) => s.status === 'pending')
      if (next < 0) {
        // 全部完成（或预算耗尽：steps 已按 maxSteps 截断）；失败保留始终汇报。
        const done = steps.filter((s) => s.status === 'done').length
        const failed = steps.filter((s) => s.status === 'failed').length
        const report = failed > 0
          ? `循环完成（${done} 成功 / ${failed} 失败保留）`
          : `循环完成（${done}/${steps.length} 步成功）`
        return { ...loop, status: 'completed', steps, finalReport: report }
      }
      steps[next] = { ...steps[next]!, status: 'running' }
      return { ...loop, steps }
    }
    case 'step-failed': {
      if (currentIndex < 0) return loop
      steps[currentIndex] = { ...steps[currentIndex]!, status: 'failed', error: detail?.error }
      const next = steps.findIndex((s) => s.status === 'pending')
      if (next < 0) {
        // 失败保留：步骤保留 failed 记录，循环 completed（含失败）而非失败终止。
        const done = steps.filter((s) => s.status === 'done').length
        const failed = steps.filter((s) => s.status === 'failed').length
        return {
          ...loop,
          status: 'completed',
          steps,
          finalReport: `循环完成（${done} 成功 / ${failed} 失败保留）`,
        }
      }
      steps[next] = { ...steps[next]!, status: 'running' }
      return { ...loop, steps }
    }
    case 'rollback-step': {
      if (!stepId) return loop
      const index = steps.findIndex((s) => s.stepId === stepId)
      if (index < 0) return loop
      if (steps[index]!.status !== 'done') return loop
      steps[index] = { ...steps[index]!, status: 'rolled-back' }
      return { ...loop, steps }
    }
    case 'complete': {
      return { ...loop, status: 'completed', finalReport: detail?.output ?? '循环完成' }
    }
  }
}

/* ------------------------------------------------------------------ */
/* SCI-09：追加接口（只追加，不覆盖原始资料）                            */
/* ------------------------------------------------------------------ */

/** 追加器（由上层接线：实验 → ExperimentWorkspaceService.appendNote；Graph → 自定义）。 */
export interface LoopAppender {
  append(target: AppendTarget, text: string, opts?: { heading?: string; marker?: string }): LoopAppendResult
  /** 可选但对有真实资料的 appender 必须实现；不支持时服务会返回明确失败。 */
  rollback?(target: AppendTarget, receipt: LoopAppendReceipt): { ok: boolean; bytes?: number; error?: string }
}

/** 科学循环追加的可验证收据。 */
export interface LoopAppendReceipt {
  readonly marker: string
  readonly target: AppendTarget
}

export interface LoopAppendResult {
  readonly ok: boolean
  readonly bytes?: number
  readonly receipt?: LoopAppendReceipt
  readonly error?: string
}

/** 可恢复循环持久化（SCI-08/09）：每个状态迁移写一个原子 JSON 快照。 */
export interface ScienceLoopPersistence {
  save(loop: ScienceLoop): void
}

export class ScienceLoopStore implements ScienceLoopPersistence {
  private readonly dir: string

  constructor(dataRoot: string) {
    this.dir = path.join(dataRoot, 'plugins', 'science-loops')
  }

  save(loop: ScienceLoop): void {
    fs.mkdirSync(this.dir, { recursive: true })
    const safe = loop.loopId.replace(/[^A-Za-z0-9_.-]/g, '_')
    const target = path.join(this.dir, `${safe}.json`)
    const tmp = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`
    fs.writeFileSync(tmp, JSON.stringify(loop, null, 2), 'utf8')
    fs.renameSync(tmp, target)
  }

  load(loopId: string): ScienceLoop | undefined {
    const safe = loopId.replace(/[^A-Za-z0-9_.-]/g, '_')
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, `${safe}.json`), 'utf8')) as ScienceLoop } catch { return undefined }
  }

  list(): ScienceLoop[] {
    try {
      return fs.readdirSync(this.dir).filter((name) => name.endsWith('.json')).flatMap((name) => {
        try { return [JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8')) as ScienceLoop] } catch { return [] }
      }).sort((a, b) => b.createdAt - a.createdAt)
    } catch { return [] }
  }
}

const NOOP_APPENDER: LoopAppender = { append: () => ({ ok: true }) }

/**
 * 默认实验追加器：对接 t12 ExperimentWorkspaceService.appendNote
 * （<workspace>/experiments/<slug>/LAB_NOTE.md 只追加，绝不覆盖）。
 */
export function experimentAppender(workspace: {
  appendNote(workspaceDir: string, slug: string, text: string, opts?: { heading?: string }): { ok: true; bytes: number }
  rollbackNoteAppend?(workspaceDir: string, slug: string, marker: string): { ok: boolean; bytes?: number; error?: string }
}, workspaceDir: string): LoopAppender {
  return {
    append(target, text, opts) {
      if (target.kind !== 'experiment') return { ok: false }
      try {
        const marker = opts?.marker?.trim()
        const markedText = marker === undefined || marker === ''
          ? text
          : `\n${marker}\n${text}\n${marker.replace(/\s*-->$/, ' /-->')}\n`
        const result = workspace.appendNote(workspaceDir, target.ref, markedText, opts?.heading === undefined ? undefined : { heading: opts.heading })
        return {
          ok: true,
          bytes: result.bytes,
          ...(marker === undefined || marker === '' ? {} : { receipt: { marker, target } }),
        }
      } catch {
        // 保持旧 appender 的简洁失败契约；详细错误由循环状态/日志保留。
        return { ok: false }
      }
    },
    rollback(target, receipt) {
      if (target.kind !== 'experiment' || workspace.rollbackNoteAppend === undefined) return { ok: false, error: '实验追加器不支持物理回滚' }
      try { return workspace.rollbackNoteAppend(workspaceDir, target.ref, receipt.marker) }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
    },
  }
}

/** 执行壳：顺序跑步骤，注入 runner；处理预算/取消/失败保留/追加（SCI-08/09）。 */
export interface LoopRunner {
  runStep(loop: ScienceLoop, step: ScienceLoopStep): Promise<{ ok: boolean; output?: string; error?: string }>
}

export async function executeLoop(
  loop: ScienceLoop,
  runner: LoopRunner,
  appender: LoopAppender = NOOP_APPENDER,
  options: { shouldCancel?: () => boolean; shouldPause?: () => boolean; signal?: AbortSignal; persistence?: ScienceLoopPersistence } = {},
): Promise<ScienceLoop> {
  let current = loop.status === 'idle'
    ? loopTransition(loop, 'start')
    : loop.status === 'paused'
      ? loopTransition(loop, 'resume')
      : loop
  options.persistence?.save(current)
  if (current.status !== 'running') return current
  for (const step of [...current.steps]) {
    if (step.status === 'done' || step.status === 'failed' || step.status === 'rolled-back') continue
    if (current.status !== 'running') break
    if (options.shouldPause?.()) {
      current = loopTransition(current, 'pause')
      options.persistence?.save(current)
      break
    }
    if (options.signal?.aborted || options.shouldCancel?.()) {
      current = loopTransition(current, 'cancel')
      options.persistence?.save(current)
      break
    }
    let result: { ok: boolean; output?: string; error?: string }
    try {
      result = await runner.runStep(current, step)
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    if (result.ok) {
      // 产出追加（SCI-09：只追加不覆盖；追加失败不阻断循环）。
      let appendResult: LoopAppendResult | undefined
      if (step.appendTo && result.output) {
        const marker = `<!-- evoresearch-loop:${current.loopId}:${step.stepId} -->`
        try { appendResult = appender.append(step.appendTo, result.output, { marker }) } catch (error) {
          appendResult = { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      }
      current = loopTransition(current, 'step-done', step.stepId, { output: result.output })
      if (appendResult?.receipt !== undefined) {
        current = {
          ...current,
          steps: current.steps.map((candidate) => candidate.stepId === step.stepId
            ? { ...candidate, appendReceipt: appendResult!.receipt }
            : candidate),
        }
      }
    } else {
      current = loopTransition(current, 'step-failed', step.stepId, { error: result.error })
    }
    options.persistence?.save(current)
  }
  if (current.status === 'running') current = loopTransition(current, 'complete', undefined, { output: '循环已达到预算并完成' })
  options.persistence?.save(current)
  return current
}

/**
 * 宿主级科学循环服务（SCI-08/09）：把纯状态机接到持久化、取消、暂停/恢复
 * 和追加器。每个循环独立保存 JSON 快照，应用重启后仍可 list/load；未知的
 * 运行态不会伪装成完成，调用 resume/run 时会从最后一个 pending 步骤继续。
 */
export interface ScienceLoopServiceOptions {
  readonly appenderFor?: (loop: ScienceLoop) => LoopAppender
  readonly runner?: LoopRunner
}

export class ScienceLoopService {
  readonly store: ScienceLoopStore
  private readonly appenderFor: (loop: ScienceLoop) => LoopAppender
  private readonly defaultRunner: LoopRunner
  private readonly active = new Map<string, Promise<ScienceLoop>>()
  private readonly cancelFlags = new Set<string>()
  private readonly pauseFlags = new Set<string>()

  constructor(readonly dataRoot: string, options: ScienceLoopServiceOptions = {}) {
    this.store = new ScienceLoopStore(dataRoot)
    this.appenderFor = options.appenderFor ?? (() => NOOP_APPENDER)
    this.defaultRunner = options.runner ?? {
      async runStep(_loop, step) {
        // 没有注入模型/子代理时仍提供可验证的生命周期执行器；不会伪造科研结论。
        return { ok: true, output: `已执行授权步骤：${step.label}` }
      },
    }
  }

  create(input: Parameters<typeof createScienceLoop>[0]): ScienceLoop {
    const loop = createScienceLoop(input)
    this.store.save(loop)
    return loop
  }

  get(loopId: string): ScienceLoop | undefined { return this.store.load(loopId) }

  list(): ScienceLoop[] { return this.store.list() }

  transition(loopId: string, action: ScienceLoopAction, stepId?: string, detail?: { output?: string; error?: string }): ScienceLoop | undefined {
    const current = this.store.load(loopId)
    if (!current) return undefined
    let next = loopTransition(current, action, stepId, detail)
    if (action === 'rollback-step' && stepId !== undefined) {
      const before = current.steps.find((step) => step.stepId === stepId)
      const afterIndex = next.steps.findIndex((step) => step.stepId === stepId)
      if (before?.appendReceipt !== undefined && afterIndex >= 0 && next.steps[afterIndex]!.status === 'rolled-back') {
        const appender = this.appenderFor(current)
        const result = appender.rollback?.(before.appendReceipt.target, before.appendReceipt)
          ?? { ok: false, error: '当前追加目标没有提供物理回滚能力' }
        next = {
          ...next,
          steps: next.steps.map((step, index) => index === afterIndex
            ? { ...step, rollback: { ok: result.ok, at: Date.now(), ...(result.error ? { error: result.error } : {}) } }
            : step),
        }
      }
    }
    this.store.save(next)
    return next
  }

  run(loopId: string, runner: LoopRunner = this.defaultRunner): Promise<ScienceLoop> {
    const existing = this.active.get(loopId)
    if (existing) return existing
    const loop = this.store.load(loopId)
    if (!loop) return Promise.reject(new Error(`科学循环不存在: ${loopId}`))
    const promise = executeLoop(loop, runner, this.appenderFor(loop), {
      shouldCancel: () => this.cancelFlags.has(loopId),
      shouldPause: () => this.pauseFlags.has(loopId),
      persistence: this.store,
    }).finally(() => {
      this.active.delete(loopId)
      this.cancelFlags.delete(loopId)
      this.pauseFlags.delete(loopId)
    })
    this.active.set(loopId, promise)
    return promise
  }

  pause(loopId: string): ScienceLoop | undefined {
    const loop = this.store.load(loopId)
    if (!loop) return undefined
    if (loop.status === 'running' && this.active.has(loopId)) {
      this.pauseFlags.add(loopId)
      return loop
    }
    return this.transition(loopId, 'pause')
  }

  resume(loopId: string): Promise<ScienceLoop> {
    const loop = this.store.load(loopId)
    if (!loop) return Promise.reject(new Error(`科学循环不存在: ${loopId}`))
    this.pauseFlags.delete(loopId)
    if (loop.status === 'paused') this.store.save(loopTransition(loop, 'resume'))
    return this.run(loopId)
  }

  async cancel(loopId: string): Promise<ScienceLoop | undefined> {
    const loop = this.store.load(loopId)
    if (!loop) return undefined
    if (this.active.has(loopId)) {
      this.cancelFlags.add(loopId)
      const running = this.active.get(loopId)
      return running ? running : loop
    }
    return this.transition(loopId, 'cancel')
  }

  isRunning(loopId: string): boolean { return this.active.has(loopId) }
}
