/**
 * 自进化信号收集与弱点聚合（EVO-01 / EVO-02）。
 *
 * EVO-01：从自然交互中收集信号，不要求用户填写失败报告。信号类型对应
 * Evolution signals: 用户指出遗忘、主动打开旧原文、移除无关上下文、工具重复
 * 失败、同一种搜索换多个说法、反复相似操作。
 *
 * EVO-02：把同类信号聚合为可读 Markdown（`aggregateWeaknesses` /
 * `weaknessMarkdown`），描述为自然语言，不引入结构化失败分类。
 *
 * 存储：追加式 JSONL（`<dataRoot>/plugins/evolution/signals.jsonl`），
 * 每行一个信号对象；追加不改写历史，天然满足"留在后台、可重建、不删除原文"。
 *
 * 收集点接线：本模块只提供 `recordSignal` 接口；由队长/其他模块在
 * 事件订阅处调用：
 * - session/event 中识别用户指出遗忘（如消息含"忘了/之前说过"）→ user_reported_forgetting；
 * - 用户打开旧原文（read_more / 历史读取工具被调用）→ user_opened_old_history；
 * - 上下文预览移除材料（CTX 层 remove 动作）→ context_material_removed；
 * - 工具执行失败（tools 执行结果 isError 或异常）→ tool_repeated_failure（同类累加）；
 * - 检索重试/改写（RET 层）→ search_rewrite_needed；
 * - EVO-07 的重复做法发现 → habit_repetition。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

/** 信号类型。 */
export type EvolutionSignalType =
  | 'user_reported_forgetting' // 用户指出"你忘了之前的细节"
  | 'user_opened_old_history' // 用户主动打开某段旧聊天后才解决问题
  | 'context_material_removed' // 用户从上下文预览中移除了无关材料
  | 'tool_repeated_failure' // 某个工具反复失败
  | 'search_rewrite_needed' // 同一种搜索总要换几个说法才能找到
  | 'habit_repetition' // 用户反复进行相似操作（EVO-07 发现回填）

/** 信号公共字段。 */
export interface EvolutionSignalBase {
  readonly signalId: string
  readonly type: EvolutionSignalType
  /** 毫秒时间戳。 */
  readonly createdAt: number
  readonly sessionId?: string
  readonly workspaceDir?: string
  /** 自然语言描述（可读；不要求用户填写结构化报告）。 */
  readonly note: string
}

export interface UserReportedForgettingSignal extends EvolutionSignalBase {
  readonly type: 'user_reported_forgetting'
  /** 用户指出的遗漏内容（引述/关键词，可选）。 */
  readonly missed?: string
  /** 随后是否打开了旧原文（可后续补记）。 */
  readonly resolvedByHistoryOpen?: boolean
}

export interface UserOpenedOldHistorySignal extends EvolutionSignalBase {
  readonly type: 'user_opened_old_history'
  readonly targetSessionId?: string
  readonly turnId?: string
  /** 打开后是否解决了问题。 */
  readonly resolved?: boolean
}

export interface ContextMaterialRemovedSignal extends EvolutionSignalBase {
  readonly type: 'context_material_removed'
  /** 被移除材料的引用（如笔记 id / 片段范围）。 */
  readonly materialRef?: string
  readonly reason?: string
}

export interface ToolRepeatedFailureSignal extends EvolutionSignalBase {
  readonly type: 'tool_repeated_failure'
  readonly toolName: string
  readonly error?: string
  /** 失败次数（同一会话/窗口内）。 */
  readonly attempts: number
  readonly windowMs?: number
}

export interface SearchRewriteNeededSignal extends EvolutionSignalBase {
  readonly type: 'search_rewrite_needed'
  readonly query: string
  readonly alternates?: readonly string[]
}

export interface HabitRepetitionSignal extends EvolutionSignalBase {
  readonly type: 'habit_repetition'
  readonly habit?: string
  readonly count: number
}

export type EvolutionSignal =
  | UserReportedForgettingSignal
  | UserOpenedOldHistorySignal
  | ContextMaterialRemovedSignal
  | ToolRepeatedFailureSignal
  | SearchRewriteNeededSignal
  | HabitRepetitionSignal

/** recordSignal 入参（signalId/createdAt 可省略，自动生成）。 */
export type EvolutionSignalInput = Omit<EvolutionSignal, 'signalId' | 'createdAt'> & {
  readonly signalId?: string
  readonly createdAt?: number
}

/** 信号查询选项。 */
export interface SignalQueryOptions {
  readonly types?: readonly EvolutionSignalType[]
  /** 只返回 createdAt >= since 的信号。 */
  readonly since?: number
  readonly limit?: number
}

/** 信号存储（追加式 JSONL；读取全量过滤，文件小可接受）。 */
export class SignalStore {
  private readonly file: string

  constructor(readonly dataRoot: string) {
    this.file = path.join(dataRoot, 'plugins', 'evolution', 'signals.jsonl')
  }

  /** JSONL 文件路径（公开：诊断/备份复用）。 */
  fileOf(): string {
    return this.file
  }

  /** 追加一条信号（EVO-01）。返回落盘后的信号对象。 */
  recordSignal(input: EvolutionSignalInput): EvolutionSignal {
    const signal: EvolutionSignal = {
      ...input,
      signalId: input.signalId ?? `sig-${randomUUID().slice(0, 8)}`,
      createdAt: input.createdAt ?? Date.now(),
    } as EvolutionSignal
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.appendFileSync(this.file, `${JSON.stringify(signal)}\n`, 'utf8')
    return signal
  }

  /** 批量追加（一次落盘多条）。 */
  recordSignals(inputs: readonly EvolutionSignalInput[]): EvolutionSignal[] {
    return inputs.map((input) => this.recordSignal(input))
  }

  /** 读取信号（默认全部，可过滤类型/时间窗/数量；最新在前）。 */
  listSignals(options: SignalQueryOptions = {}): EvolutionSignal[] {
    let lines: string[] = []
    try {
      lines = fs.readFileSync(this.file, 'utf8').split('\n').filter((line) => line.trim() !== '')
    } catch {
      return []
    }
    const signals: EvolutionSignal[] = []
    for (const line of lines) {
      try {
        const signal = JSON.parse(line) as EvolutionSignal
        if (typeof signal?.type !== 'string' || typeof signal?.note !== 'string') continue
        if (options.types && !options.types.includes(signal.type)) continue
        if (options.since !== undefined && signal.createdAt < options.since) continue
        signals.push(signal)
      } catch {
        // 坏行跳过（追加式日志允许个别损坏行不阻塞读取）。
      }
    }
    signals.sort((a, b) => b.createdAt - a.createdAt)
    return options.limit !== undefined ? signals.slice(0, options.limit) : signals
  }

  /** 信号总数。 */
  count(): number {
    return this.listSignals().length
  }
}

/* ------------------------------------------------------------------ */
/* EVO-02：弱点聚合为可读 Markdown                                      */
/* ------------------------------------------------------------------ */

/** 弱点聚类（同类信号聚合，键为自然语言可读的归一化键）。 */
export interface WeaknessCluster {
  /** 聚类键（如 tool:bash / search:xxx / forgetting）。 */
  readonly key: string
  readonly type: EvolutionSignalType
  /** 簇内信号数。 */
  readonly count: number
  /** 首末信号时间跨度（毫秒）。 */
  readonly spanMs: number
  /** 自然语言描述（EVO-02：不要求用户填写失败分类）。 */
  readonly description: string
  readonly samples: readonly EvolutionSignal[]
}

/** 同类信号的聚类键（不引入结构化失败分类，键即自然语言聚合单位）。 */
function clusterKeyOf(signal: EvolutionSignal): string {
  switch (signal.type) {
    case 'tool_repeated_failure':
      return `tool:${signal.toolName}`
    case 'search_rewrite_needed':
      return `search:${signal.query}`
    case 'context_material_removed':
      return `context:${signal.materialRef ?? 'unrelated-material'}`
    case 'habit_repetition':
      return `habit:${signal.habit ?? 'repeated-operation'}`
    case 'user_reported_forgetting':
      return 'forgetting'
    case 'user_opened_old_history':
      return 'history-open'
  }
}

/** 簇的自然语言描述（EVO-02：可读、可解释、不强制分类）。 */
function describeCluster(key: string, type: EvolutionSignalType, count: number, samples: readonly EvolutionSignal[]): string {
  const first = samples[0]
  switch (type) {
    case 'tool_repeated_failure': {
      const tool = first?.type === 'tool_repeated_failure' ? first.toolName : key
      const error = first?.type === 'tool_repeated_failure' && first.error ? `（示例错误：${first.error.slice(0, 120)}）` : ''
      return `工具 ${tool} 重复失败 ${count} 次${error}。建议检查该工具的调用参数、可用性或在技能中固化正确用法。`
    }
    case 'search_rewrite_needed': {
      const query = first?.type === 'search_rewrite_needed' ? first.query : key
      const alternates = first?.type === 'search_rewrite_needed' && first.alternates?.length
        ? `；已尝试的说法：${first.alternates.join('、')}`
        : ''
      return `同一检索「${query}」需要换 ${count} 次说法才能命中${alternates}。建议改进查询改写或片段排序。`
    }
    case 'context_material_removed': {
      return `用户移除了 ${count} 次上下文材料${first?.type === 'context_material_removed' && first.materialRef ? `（如 ${first.materialRef}）` : ''}。建议调整上下文长度分配或材料相关性排序。`
    }
    case 'user_reported_forgetting': {
      const missed = first?.type === 'user_reported_forgetting' && first.missed ? `（例如「${first.missed.slice(0, 80)}」）` : ''
      return `用户指出遗忘 ${count} 次${missed}。建议改进记忆检索召回或上下文注入。`
    }
    case 'user_opened_old_history': {
      return `用户主动打开旧原文 ${count} 次。建议在回答时更早地提供原文回读入口。`
    }
    case 'habit_repetition': {
      const habit = first?.type === 'habit_repetition' && first.habit ? `「${first.habit}」` : ''
      return `发现重复做法 ${habit} 共 ${count} 次。可考虑沉淀为 Skill 草稿。`
    }
  }
}

/** 把信号聚合为弱点簇（EVO-02 聚合函数；按类型+归一化键分组）。 */
export function aggregateWeaknesses(signals: readonly EvolutionSignal[]): WeaknessCluster[] {
  const groups = new Map<string, EvolutionSignal[]>()
  for (const signal of signals) {
    const key = clusterKeyOf(signal)
    const list = groups.get(key) ?? []
    list.push(signal)
    groups.set(key, list)
  }
  const clusters: WeaknessCluster[] = []
  for (const [key, samples] of groups) {
    const sorted = [...samples].sort((a, b) => a.createdAt - b.createdAt)
    const type = sorted[0]?.type ?? 'habit_repetition'
    clusters.push({
      key,
      type,
      count: sorted.length,
      spanMs: sorted.length > 1 ? (sorted[sorted.length - 1]?.createdAt ?? 0) - (sorted[0]?.createdAt ?? 0) : 0,
      description: describeCluster(key, type, sorted.length, sorted),
      samples: sorted,
    })
  }
  clusters.sort((a, b) => b.count - a.count)
  return clusters
}

/** 弱点聚合 Markdown（EVO-02 输出；标题/条目全部自然语言可读）。 */
export function weaknessMarkdown(clusters: readonly WeaknessCluster[], generatedAt = Date.now()): string {
  if (clusters.length === 0) {
    return `# 弱点聚合\n\n（生成于 ${new Date(generatedAt).toISOString()}）\n\n当前没有收集到明显弱点信号。`
  }
  const lines: string[] = [
    '# 弱点聚合',
    '',
    `（生成于 ${new Date(generatedAt).toISOString()}，共 ${clusters.length} 类弱点）`,
    '',
  ]
  for (const cluster of clusters) {
    lines.push(`## ${cluster.description}`)
    lines.push('')
    lines.push(`- 信号数：${cluster.count}；时间跨度：${formatSpan(cluster.spanMs)}`)
    const samples = cluster.samples.slice(0, 3)
    for (const sample of samples) {
      lines.push(`- 示例：${sample.note}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** 毫秒跨度 → 可读时长。 */
function formatSpan(ms: number): string {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时`
  return `${Math.round(hours / 24)} 天`
}
