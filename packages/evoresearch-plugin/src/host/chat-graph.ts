/**
 * Chat Graph 服务（§ChatGraph v4）：聊天图——节点（chat / memory）+ 连线。
 *
 * 节点两大类（§4）：chat node = 一个真实会话；memory node = 一份可被取出、
 * 检索进上下文的内容资产。displayKind 只是品种标签（profile/guidance/turns/
 * observation/note/science/library/skill/file…），不增加节点大类；旧 'resource'
 * 类型在 v3→v4 迁移中并入 'memory'。节点唯一复用（§4.3）：所有入图途径按
 * locator 判重，存在即复用；chat 节点 locator 固定 `session:<sessionId>`。
 *
 * 常驻节点（§5.4，每项目最多一个，locator 固定）：`evoresearch:profile` /
 * `evoresearch:guidance` / `evoresearch:turns`；内容缺失时由 sync 写入
 * `empty: true` 空态标记。默认连线 = 常驻节点 → 每个 chat 节点一条
 * reference 边（system: true）。
 *
 * 语义（§5 三种有向线；创建后运行时不再做递归上下文注入）：
 * - context 连线 = 创建时一次性 fork：graphInherit（api.ts）把源会话截至当前
 *   的历史 fork 为独立新会话并换绑目标节点；此后源会话后续消息不会偷偷流入
 *   新会话。运行时不再注入上游链（旧递归 graphContextText 已删除）。
 * - memory 连线 = 运行时持续参考：graphMemoryText() 注入所连 memory 节点内容；
 *   neighborChatText() 读取所连 chat 节点（持续参考）的最近消息——多个方向
 *   可以自由汇合，但不 fork、不进入新会话 seed。
 * - write 写线（v4）= Chat → Memory 的真实写入记录：事实线（system: true，
 *   模型写工具/每轮台账自动 upsert 累加 writeCount/lastWriteAt）与通道线
 *   （system: false，用户手拖声明的沉淀通道）。
 * - relation 存量结构线在 v3→v4 迁移中转为 reference 读线（保留 label）。
 * - memory node：内嵌文本（content，旧节点继续可用，可 convertToNote 转笔记）
 *   或引用真实资料（ref：note 笔记 / file 文本 / pdf / dir 目录，GRAPH-04）；
 *   节点只保存显示名与位置，预览由 previewOf() 实时读取目标文件
 *   （GRAPH-08：文件更新后预览随之更新）。
 * - 非 context 连线可附自然语言说明 label（GRAPH-07，不建立强制关系枚举）。
 * - 删除节点/连线只删除视图引用，不删除目标聊天/笔记/文件（GRAPH-09）；
 *   删除项进入墓碑（tombstones），自动同步永不复活（§6.3）。
 * - 图按项目隔离存储：<dataRoot>/plugins/chat-graphs/<projectName>.json
 *   （与 experiments 同级目录，随项目迁移）；墓碑随项目文件持久化。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readSessionEvents, isSystemText } from './rewind.js'
import { resolveDshHomePath, workspaceDataDir } from './core/paths.js'
import type { ScienceMemoryLink } from './science/memory.js'

/** memory node 引用真实资料（GRAPH-04：节点只保存显示名与位置，不复制资料）。 */
export interface GraphNodeRef {
  /** note=Markdown 笔记（相对项目 .evoresearch-data/memories/notes/）；
   *  file=文本文件 / pdf=PDF（二进制）/ dir=目录（相对项目工作区或绝对路径）。 */
  kind: 'note' | 'file' | 'pdf' | 'dir' | 'memory' | 'session' | 'paper' | 'experiment' | 'run' | 'log' | 'result' | 'code' | 'latex' | 'manuscript'
  /** 目标资料路径（kind=note 时相对笔记目录；其余相对项目工作区或绝对路径）。 */
  path: string
}

export interface GraphNode {
  id: string
  /**
   * Legacy nodes use chat/memory; resource is a legacy persisted kind that the
   * v3→v4 migration folds into 'memory'（displayKind 保留为品种标签）。
   */
  type: 'chat' | 'memory' | 'resource'
  /**
   * User-facing subtype label. chat 节点固定 'chat'；memory 节点在存量品种之外
   * 新增 profile/guidance/observation/turns/science/library/skill/file（v4）。
   */
  displayKind?: 'chat' | 'memory' | 'memory-collection' | 'idea' | 'candidate' | 'note' | 'paper' | 'experiment' | 'run' | 'log' | 'file' | 'latex' | 'manuscript' | 'result' | 'code'
    | 'profile' | 'guidance' | 'observation' | 'turns' | 'science' | 'library' | 'skill'
  title: string
  /** 画布坐标（px，画布内部坐标系） */
  x: number
  y: number
  /** chat node：关联的真实会话 id */
  sessionId?: string
  /** chat node：所属工作区（会话 cwd 的项目目录） */
  workspaceDir?: string
  /** memory node：内嵌记忆内容（Markdown 文本；旧节点继续可用，GRAPH-06） */
  content?: string
  /** memory node：引用真实资料（优先于内嵌 content 展示，GRAPH-04） */
  ref?: GraphNodeRef
  /** memory node：层级（project 项目级 / global 全局级，如 SOUL.md/User.md/Taste.md） */
  scope?: 'project' | 'global'
  /** Stable resource locator metadata; legacy ref/content remain supported. */
  locator?: string
  /** 常驻/系统生成节点（画像/指引/台账与默认连线等）为 true（v4）。 */
  system?: boolean
  /** 常驻节点内容缺失时的空态标记（由 ensure/sync 计算并写入，v4）。 */
  empty?: boolean
  /** chat 节点：该会话累计完成（status=completed）的上下文压缩次数（§6.1 压缩徽标，v4；缺省=从未压缩）。 */
  compactionCount?: number
  /** chat 节点：最近一次 turn/end 的活跃时间戳 ms（前端徽标优先于 updatedAt 展示，v4；缺省=尚未结束过回合）。 */
  lastActiveAt?: number
  origin?: 'user' | 'agent' | 'imported'
  /** 用户拖拽缩放后的节点尺寸（缺失 = 前端默认设计尺寸；上限 3×默认由前端裁剪，v4）。 */
  width?: number
  height?: number
  groupId?: string
  pinned?: boolean
  createdAt?: number
  updatedAt?: number
  status?: 'available' | 'missing' | 'running' | 'failed' | 'indexing'
}

/**
 * 连线行为（v4）：
 * - fork：存量分叉线（context 继承，一次性）；
 * - reference：读线——记忆喂给聊天（存量值不变，仅 UI 叫读线）；
 * - write：写线——聊天把内容写进记忆（事实线 system:true / 通道线 system:false）；
 * - relation：存量结构关系线，v3→v4 迁移中转为 reference（保留 label、enabled 置 true）。
 */
export type GraphEdgeBehavior = 'fork' | 'reference' | 'write' | 'relation'

export interface ForkAnchor {
  sourceSessionId: string
  /** Source event sequence or message identifier when available. */
  sourceEventSeq?: number
  sourceMessageId?: string
  targetSessionId?: string
}

export interface GraphEdge {
  id: string
  from: string
  to: string
  /** Legacy port remains the wire compatibility field. */
  toPort: 'context' | 'memory'
  /** New semantic behavior; omitted legacy edges are inferred from toPort. */
  behavior?: GraphEdgeBehavior
  forkAnchor?: ForkAnchor
  enabled?: boolean
  createdAt?: number
  updatedAt?: number
  /** Natural language relation explanation. */
  label?: string
  /** 默认连线/系统生成边为 true（边判重键 = from|to|behavior|system，v4）。 */
  system?: boolean
  /** 写线累计写入次数（事实线/沉淀动作自动累加，v4）。 */
  writeCount?: number
  /** 写线最近一次写入时间（ms，v4）。 */
  lastWriteAt?: number
  /** Legacy context edges without a recorded message anchor are explicitly unknown. */
  anchorStatus?: 'known' | 'unknown'
  /** ELK/XYFlow absolute route points, persisted only after an accepted layout. */
  routePoints?: Array<{ x: number; y: number }>
  /** v5 布局选定的贝塞尔端口朝向（'left'|'right'|'top'|'bottom'；normalize 透传）。 */
  bendSource?: string
  bendTarget?: string
  /** 首尾近水平对齐时的平行弓形偏移 px（v5）。 */
  bendBow?: number
  /** Collision-free label anchor in the same canvas coordinate system. */
  labelPosition?: { x: number; y: number }
  /** Estimated label box used by layout collision checks. */
  labelWidth?: number
  labelHeight?: number
  /** True when the accepted layout could not place the label without overlap. */
  labelHidden?: boolean
  /** Incremented whenever a layout recalculates the route. */
  routingVersion?: number
}

export interface GraphGroup {
  id: string
  title: string
  kind: 'exploration' | 'experiment' | 'freeform'
  collapsed?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
  /** Optional visual nesting; groups never become execution edges. */
  parentId?: string
  pinned?: boolean
  createdAt?: number
}

/**
 * 墓碑（v4，§6.3 尊重用户编辑）：graph-save 时由服务端 diff 计算——对比已存图
 * 与入参图，消失的节点/边写入墓碑；graph-sync 与一切自动同步跳过墓碑项，
 * 永不复活用户显式删除的节点/连线。节点键 = locator（缺失时节点 id）；
 * 边键 = from|to|behavior|system。
 */
export interface GraphTombstones {
  nodes: string[]
  edges: string[]
  /** 消失节点的原样快照（键仍记录在 nodes 中；restore 时逐字补回，用户自建嵌入式内容不丢）。 */
  nodeSnapshots?: GraphNode[]
  /** 消失边的原样快照。 */
  edgeSnapshots?: GraphEdge[]
  updatedAt: number
}

export interface ChatGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  groups?: GraphGroup[]
  schemaVersion?: number
  /** 人工策展标志：用户手工拖拽过位置/缩放/确认过一次布局后为 true。
   *  true = 持久化坐标即真相源（同步新节点只按网格入库、不再自动重排）；
   *  false/缺省 = 前端打开图谱时静默跑自动布局（「默认就是自动布局的结果」）。 */
  layoutCurated?: boolean
  tombstones?: GraphTombstones
}

/** Current persisted graph schema. Migrations only add/normalize fields. */
export const CHAT_GRAPH_SCHEMA_VERSION = 4

/** 墓碑条目上限（防止长期使用无限增长；超出丢弃最旧条目）。 */
export const GRAPH_TOMBSTONE_MAX = 500

/** 常驻节点 locator（每项目最多一个；contract 固定值）。 */
export const PERSISTENT_NODE_LOCATORS = {
  profile: 'evoresearch:profile',
  guidance: 'evoresearch:guidance',
  turns: 'evoresearch:turns',
} as const

/** chat 节点的稳定定位键（sessionId 派生；用于判重与墓碑）。 */
export function chatNodeLocator(sessionId: string): string {
  return `session:${sessionId}`
}

/**
 * 边判重键（contract：from|to|behavior|system）。所有调用方都传显式 behavior
 * （normalizeGraph 后的边恒有 behavior）；缺省按 reference 兜底。
 */
export function edgeKeyOf(edge: { from: string; to: string; behavior?: GraphEdgeBehavior; system?: boolean }): string {
  return `${edge.from}|${edge.to}|${edge.behavior ?? 'reference'}|${edge.system === true ? 1 : 0}`
}

/** 节点判重/墓碑键：locator 优先（规范化），缺失回退节点 id。 */
export function nodeKeyOf(node: Pick<GraphNode, 'locator' | 'ref' | 'content' | 'scope' | 'id'>): string {
  return graphNodeLocator(node) ?? node.id
}

/** 常驻 memory 品种（画像/指引/台账；内容缺失时显示空态）。 */
export function isPersistentDisplayKind(kind: string | undefined): boolean {
  return kind === 'profile' || kind === 'guidance' || kind === 'turns'
}

export interface GraphMigrationReport {
  readonly changed: boolean
  readonly migratedNodes: number
  readonly migratedEdges: number
  readonly mergedMemoryNodes: number
  readonly mergedEdges: number
  readonly backupRequired: boolean
}

export function edgeBehavior(edge: Pick<GraphEdge, 'toPort' | 'behavior'>): GraphEdgeBehavior {
  return edge.behavior ?? (edge.toPort === 'context' ? 'fork' : 'reference')
}

/** Only enabled reference/fork edges participate in runtime context semantics. */
export function isRuntimeEdge(edge: Pick<GraphEdge, 'toPort' | 'behavior' | 'enabled'>): boolean {
  return edge.enabled !== false && edgeBehavior(edge) !== 'relation'
}

/** 墓碑清洗：仅保留字符串键、去重、限量（最旧的排在数组前面被丢弃）；快照仅保留对象形态。 */
function sanitizeTombstones(input: unknown): GraphTombstones | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const raw = input as { nodes?: unknown; edges?: unknown; nodeSnapshots?: unknown; edgeSnapshots?: unknown; updatedAt?: unknown }
  const nodes = Array.isArray(raw.nodes) ? [...new Set(raw.nodes.filter((k): k is string => typeof k === 'string' && k !== ''))].slice(-GRAPH_TOMBSTONE_MAX) : []
  const edges = Array.isArray(raw.edges) ? [...new Set(raw.edges.filter((k): k is string => typeof k === 'string' && k !== ''))].slice(-GRAPH_TOMBSTONE_MAX) : []
  if (nodes.length === 0 && edges.length === 0) return undefined
  const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
  const nodeSnapshots = Array.isArray(raw.nodeSnapshots)
    ? (raw.nodeSnapshots.filter(isRecord) as unknown as GraphNode[]).slice(-GRAPH_TOMBSTONE_MAX)
    : undefined
  const edgeSnapshots = Array.isArray(raw.edgeSnapshots)
    ? (raw.edgeSnapshots.filter(isRecord) as unknown as GraphEdge[]).slice(-GRAPH_TOMBSTONE_MAX)
    : undefined
  return {
    nodes,
    edges,
    ...(nodeSnapshots !== undefined && nodeSnapshots.length > 0 ? { nodeSnapshots } : {}),
    ...(edgeSnapshots !== undefined && edgeSnapshots.length > 0 ? { edgeSnapshots } : {}),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  }
}

/** Normalize legacy graph records without guessing missing fork positions. */
export function normalizeGraph(graph: ChatGraph): ChatGraph {
  // v4：resource 并入 memory（displayKind 保留为品种标签，缺失默认 'file'）。
  const rawNodes = (Array.isArray(graph.nodes) ? graph.nodes : []).map((node) => {
    if (node.type === 'chat' || node.type === 'memory') return { ...node }
    return { ...node, type: 'memory' as const, displayKind: node.displayKind ?? 'file' }
  })
  // 旧版本允许同一份 Memory locator 出现多个视觉节点。迁移时保留第一个
  // 稳定节点、合并可用显示字段，并把所有边重定向过去；原始 Markdown/索引
  // 文件不受影响。不同 label 的边不能被静默合并，因为它们各自表达用户说明。
  const canonicalByLocator = new Map<string, string>()
  const nodeIdMap = new Map<string, string>()
  const nodes: GraphNode[] = []
  let mergedMemoryNodes = 0
  for (const node of rawNodes) {
    const locator = graphNodeLocator(node)
    if (locator !== undefined && isMemoryNode(node)) {
      const existingId = canonicalByLocator.get(locator)
      if (existingId !== undefined) {
        const index = nodes.findIndex((candidate) => candidate.id === existingId)
        const existing = index >= 0 ? nodes[index] : undefined
        if (existing !== undefined) {
          nodes[index] = {
            ...existing,
            // Preserve the first stable identity/title, but do not lose a
            // usable ref/content/status from a duplicate legacy record.
            ref: existing.ref ?? node.ref,
            content: existing.content ?? node.content,
            locator: existing.locator ?? node.locator,
            status: existing.status ?? node.status,
          }
        }
        nodeIdMap.set(node.id, existingId)
        mergedMemoryNodes += 1
        continue
      }
      canonicalByLocator.set(locator, node.id)
    }
    nodeIdMap.set(node.id, node.id)
    nodes.push(node)
  }
  const edgeMap = new Map<string, GraphEdge>()
  let mergedEdges = 0
  for (const rawEdge of (Array.isArray(graph.edges) ? graph.edges : [])) {
    // v4 迁移：relation 结构线 → reference 读线（保留 label、enabled 置 true）。
    const legacyBehavior = edgeBehavior(rawEdge)
    const behavior: GraphEdgeBehavior = legacyBehavior === 'relation' ? 'reference' : legacyBehavior
    const edge: GraphEdge = {
      ...rawEdge,
      behavior,
      from: nodeIdMap.get(rawEdge.from) ?? rawEdge.from,
      to: nodeIdMap.get(rawEdge.to) ?? rawEdge.to,
      ...(behavior === 'fork' && rawEdge.forkAnchor === undefined && rawEdge.anchorStatus === undefined
        ? { anchorStatus: 'unknown' as const }
        : {}),
      ...(behavior === 'fork' && rawEdge.forkAnchor !== undefined && rawEdge.forkAnchor.sourceEventSeq === undefined && rawEdge.forkAnchor.sourceMessageId === undefined
        ? { anchorStatus: 'unknown' as const }
        : {}),
      ...(legacyBehavior === 'relation' ? { enabled: true } : {}),
    }
    // 判重键在 from|to|behavior 之外纳入 toPort/label/system：label 各自表达用户
    // 说明（不静默合并）；system 区分默认连线与用户连线（contract 键的细化）。
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.toPort}\u0000${behavior}\u0000${edge.label ?? ''}\u0000${edge.system === true ? 1 : 0}`
    const existing = edgeMap.get(key)
    if (existing === undefined) {
      edgeMap.set(key, edge)
      continue
    }
    mergedEdges += 1
    edgeMap.set(key, {
      ...existing,
      // A migrated duplicate may have the missing anchor while another copy
      // still has it. Prefer the known anchor and keep any usable route data.
      forkAnchor: existing.forkAnchor ?? edge.forkAnchor,
      anchorStatus: existing.anchorStatus === 'known' || edge.anchorStatus === 'known'
        ? 'known'
        : existing.anchorStatus ?? edge.anchorStatus,
      routePoints: existing.routePoints ?? edge.routePoints,
      labelPosition: existing.labelPosition ?? edge.labelPosition,
      labelHidden: existing.labelHidden ?? edge.labelHidden,
    })
  }
  const normalized: ChatGraph = {
    nodes,
    edges: [...edgeMap.values()],
    schemaVersion: CHAT_GRAPH_SCHEMA_VERSION,
  }
  if (graph.groups !== undefined) normalized.groups = normalizeGroups(graph.groups)
  if (graph.layoutCurated === true) normalized.layoutCurated = true
  const tombstones = sanitizeTombstones(graph.tombstones)
  if (tombstones !== undefined) normalized.tombstones = tombstones
  return normalized
}

/** Detailed migration result used by diagnostics and the explicit migration API. */
export function migrateGraph(graph: ChatGraph): { graph: ChatGraph; report: GraphMigrationReport } {
  const normalized = normalizeGraph(graph)
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : []
  const report: GraphMigrationReport = {
    changed: graph.schemaVersion !== CHAT_GRAPH_SCHEMA_VERSION
      || normalized.nodes.length !== rawNodes.length
      || normalized.edges.length !== rawEdges.length
      || (graph.schemaVersion !== CHAT_GRAPH_SCHEMA_VERSION && rawNodes.some((node) => node.type === 'memory' || node.type === 'resource' || (node.displayKind === undefined && node.type !== 'chat')))
      || rawEdges.some((edge) => edge.behavior === undefined || edge.behavior === 'relation' || (edge.toPort === 'context' && edge.forkAnchor === undefined && edge.anchorStatus === undefined)),
    migratedNodes: normalized.nodes.filter((node) => {
      const raw = rawNodes.find((item) => item.id === node.id)
      return raw !== undefined && (raw.type !== node.type || (raw.type !== 'chat' && raw.displayKind !== node.displayKind))
    }).length,
    migratedEdges: normalized.edges.filter((edge) => {
      const raw = rawEdges.find((item) => item.id === edge.id)
      return raw !== undefined && (raw.behavior === undefined || raw.behavior !== edge.behavior)
    }).length,
    mergedMemoryNodes: Math.max(0, rawNodes.length - normalized.nodes.length),
    mergedEdges: Math.max(0, rawEdges.length - normalized.edges.length),
    backupRequired: graph.schemaVersion !== CHAT_GRAPH_SCHEMA_VERSION || rawNodes.length !== normalized.nodes.length || rawEdges.length !== normalized.edges.length,
  }
  return { graph: normalized, report }
}

function normalizeGroups(groups: readonly GraphGroup[]): GraphGroup[] {
  const byId = new Map<string, GraphGroup>()
  for (const group of groups) {
    if (typeof group?.id !== 'string' || group.id.trim() === '' || typeof group.title !== 'string') continue
    byId.set(group.id, { ...group })
  }
  // Parent references are visual only. Break self/cyclic references instead of
  // allowing a malformed old graph to make the compound layout recurse forever.
  for (const group of byId.values()) {
    const seen = new Set<string>([group.id])
    let parent = group.parentId
    while (parent !== undefined) {
      if (seen.has(parent) || !byId.has(parent)) {
        group.parentId = undefined
        break
      }
      seen.add(parent)
      parent = byId.get(parent)?.parentId
    }
  }
  return [...byId.values()]
}

/** 稳定的资料定位键（CG-MEM-13/CG-MIG-07）。 */
function normalizeLocatorPath(value: string): string {
  const slash = value.trim().replace(/\\/g, '/')
  if (slash === '') return ''
  const drive = /^([A-Za-z]):\/(.*)$/.exec(slash)
  if (drive) return `${drive[1]!.toLowerCase()}:/${path.posix.normalize(`/${drive[2]!}`).replace(/^\/+/, '')}`
  return path.posix.normalize(slash).replace(/^\.\//, '')
}

/**
 * Canonical locator used for graph identity.  Old clients have written both
 * Windows and POSIX separators, and some have persisted the locator prefix in
 * different cases.  Identity is a storage concern, so normalize it here while
 * leaving the user-facing ref path untouched.
 */
export function graphNodeLocator(node: Pick<GraphNode, 'locator' | 'ref' | 'content' | 'scope'>): string | undefined {
  if (typeof node.locator === 'string' && node.locator.trim() !== '') {
    const raw = node.locator.trim().replace(/\\/g, '/')
    const typed = /^([^:]+):(.*)$/.exec(raw)
    if (typed) return `${typed[1]!.toLowerCase()}:${normalizeLocatorPath(typed[2]!)}`
    return normalizeLocatorPath(raw)
  }
  if (node.ref !== undefined) return `${(node.scope ?? 'project').toLowerCase()}:${node.ref.kind.toLowerCase()}:${normalizeLocatorPath(node.ref.path)}`
  return undefined
}

export function isMemoryNode(node: GraphNode): boolean {
  return node.type === 'memory' || (node.type === 'resource' && (node.displayKind === 'memory' || node.displayKind === 'memory-collection'))
}

/** 空图。 */
export function emptyGraph(): ChatGraph {
  return { nodes: [], edges: [] }
}

/**
 * 显式历史读取工具：提取会话历史文本（user/assistant 消息，跳过系统注入的
 * "伪用户消息"），最近消息优先，最多 maxChars 字符。
 * 兼容多种事件形状：data.text / data.content[].text（结构化）/ assistant/chunk
 * （按 turn+step 合并为完整回复）/ data.blocks[].text。
 *
 * 注意：context 继承在创建时一次性完成（graphInherit），运行时不再向新会话
 * 注入上游链——本函数只是显式按需读取源会话消息的通用工具（供测试/外部
 * 读取），不是上下文注入路径。
 */
const historyCache = new Map<string, { mtimeMs: number; size: number; text: string }>()
/** 缓存上限（会话多时防止无限增长；超出清空重建，简单近似）。 */
const HISTORY_CACHE_MAX = 100
export function sessionHistoryText(sessionId: string, maxChars = 8000): string {
  let events: Array<{ type: string; data?: Record<string, unknown> }>
  try {
    // 按文件 mtime+size 缓存提取结果（会话大时避免每次 prompt 全量解压）
    const dir = findSessionDirCached(sessionId)
    const file = dir === null ? null : fs.existsSync(path.join(dir, 'session.jsonl.zstd')) ? path.join(dir, 'session.jsonl.zstd') : fs.existsSync(path.join(dir, 'session.jsonl')) ? path.join(dir, 'session.jsonl') : null
    if (file !== null) {
      const stat = fs.statSync(file)
      const cached = historyCache.get(sessionId)
      if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        const t = cached.text
        return t.length > maxChars ? t.slice(-maxChars) : t
      }
      const text = extractHistory(sessionId, maxChars)
      if (historyCache.size >= HISTORY_CACHE_MAX) historyCache.clear()
      historyCache.set(sessionId, { mtimeMs: stat.mtimeMs, size: stat.size, text })
      return text.length > maxChars ? text.slice(-maxChars) : text
    }
    return extractHistory(sessionId, maxChars)
  } catch {
    return ''
  }
}

/** 会话目录查找（复用 rewind 的扫描；不做缓存）。 */
function findSessionDirCached(sessionId: string): string | null {
  try {
    // 轻量扫描（会话目录按 cwd 编码组织，数量有限）
    const root = path.join(resolveDshHomePath(), 'sessions')
    let entries: string[] = []
    try { entries = fs.readdirSync(root) } catch { return null }
    for (const name of entries) {
      const candidate = path.join(root, name, sessionId)
      if (fs.statSync(candidate, { throwIfNoEntry: false })?.isDirectory()) return candidate
    }
  } catch { /* 忽略 */ }
  return null
}

/** 从事件流提取消息文本（chunk 按 turn+step 合并）。 */
function extractHistory(sessionId: string, maxChars = 8000): string {
  let events: Array<{ type: string; data?: Record<string, unknown> }>
  try {
    events = readSessionEvents(sessionId)
  } catch {
    return ''
  }
  const textOf = (ev: { type: string; data?: Record<string, unknown> }): string => {
    const d = ev.data ?? {}
    if (typeof d.text === 'string' && d.text !== '') return d.text
    if (Array.isArray(d.content)) {
      const joined = d.content
        .map((b) => (typeof (b as { text?: unknown })?.text === 'string' ? (b as { text: string }).text : ''))
        .join('')
        .trim()
      if (joined !== '') return joined
    }
    if (ev.type === 'assistant/chunk') {
      // 只提取正文增量（text-delta）；reasoning-delta（思考过程）不进入上下文
      const chunk = d.chunk as { type?: unknown; text?: unknown } | undefined
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text !== '') return chunk.text
      return ''
    }
    if (Array.isArray(d.blocks)) {
      const joined = d.blocks
        .map((b) => (typeof (b as { text?: unknown })?.text === 'string' ? (b as { text: string }).text : ''))
        .join('')
        .trim()
      if (joined !== '') return joined
    }
    return ''
  }
  // 按消息分组：user/message、assistant/message 各成一条；assistant/chunk 按 turn+step 合并
  const messages: string[] = []
  let pending: { turn: number; step: number; text: string } | null = null
  const flush = () => { if (pending !== null) { messages.push(pending.text); pending = null } }
  for (const ev of events) {
    const turn = typeof ev.data?.turn === 'number' ? ev.data.turn : -1
    const step = typeof ev.data?.step === 'number' ? ev.data.step : -1
    if (ev.type === 'user/message' || ev.type === 'assistant/message') {
      flush()
      const text = textOf(ev)
      if (text !== '' && !isSystemText(text)) messages.push(text)
    } else if (ev.type === 'assistant/chunk') {
      const text = textOf(ev)
      if (text === '') continue
      if (pending !== null && pending.turn === turn && pending.step === step) pending.text += text
      else { flush(); pending = { turn, step, text } }
    } else {
      flush()
    }
  }
  flush()
  let total = 0
  const recent: string[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const part = messages[i]!
    total += part.length + 1
    if (total > maxChars) break
    recent.unshift(part)
  }
  return recent.join('\n')
}

/** 提取 chat 节点经 memory 边连接的记忆节点内容（每节点 1500 字符、总 maxChars 上限）。 */
export function graphMemoryText(graph: ChatGraph, sessionId: string, maxChars = 6000): string {
  const node = graph.nodes.find((n) => n.type === 'chat' && n.sessionId === sessionId)
  if (node === undefined) return ''
  // 去重：同一记忆节点被多条边连接时不重复注入
  const memIds = [...new Set(graph.edges
    .filter((e) => e.to === node.id && e.toPort === 'memory' && isRuntimeEdge(e))
    .map((e) => e.from))]
  const contents = graph.nodes
    .filter((n) => memIds.includes(n.id) && isMemoryNode(n))
    .map((n) => (n.content ?? '').trim())
    .filter((c) => c !== '')
  if (contents.length === 0) return ''
  let total = 0
  const parts: string[] = []
  for (const content of contents) {
    // 防止用户内容里的闭合标签提前终止注入块（XML/提示注入混淆防护）
    const cleaned = content
      .replace(/<\/graph_memory>/gi, '＜/graph_memory＞')
      .replace(/<graph_memory>/gi, '＜graph_memory＞')
    const slice = cleaned.slice(0, 1500)
    total += slice.length + 2
    if (total > maxChars) break
    parts.push(slice)
  }
  return parts.join('\n\n---\n\n')
}

/**
 * 持续参考聊天文本（GRAPH-05）：经 memory 边连入本会话的其他 chat 节点，
 * 读取其最近消息（最近优先、按节点标注来源）。语义=持续参考（运行时按需
 * 检索/注入），与 context 继承不同：不 fork、不进入新会话 seed，多个方向
 * 可以自由汇合。返回 '' 表示没有 chat 来源或全部无文本。
 */
export function neighborChatText(graph: ChatGraph, sessionId: string, maxChars = 4000): string {
  const node = graph.nodes.find((n) => n.type === 'chat' && n.sessionId === sessionId)
  if (node === undefined) return ''
  // 去重：同一 chat 源节点被多条边连接时不重复读取
  const chatSrcIds = [...new Set(graph.edges
    .filter((e) => e.to === node.id && e.toPort === 'memory' && isRuntimeEdge(e))
    .map((e) => e.from))]
  const parts: string[] = []
  let total = 0
  for (const srcId of chatSrcIds) {
    const src = graph.nodes.find((n) => n.id === srcId && n.type === 'chat')
    if (src === undefined || src.sessionId === undefined) continue
    const text = sessionHistoryText(src.sessionId, Math.max(200, maxChars - total))
    if (text === '') continue
    const block = `【持续参考：${src.title}】\n${text}`
    total += block.length + 1
    if (total > maxChars) break
    parts.push(block)
  }
  return parts.join('\n\n')
}

/**
 * Chat Graph 服务。dataRoot 与项目列表由 WorkspaceService 提供。
 */
/** 剥离 Markdown frontmatter（--- ... ---）用于预览显示。 */
function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text
  const end = text.indexOf('\n---', 3)
  if (end < 0) return text
  return text.slice(end + 4).replace(/^\r?\n+/, '')
}

export class ChatGraphService {
  private readonly dataRoot: string
  /** 进程内幂等缓存：避免网络重试重复应用同一个增量操作。 */
  private readonly appliedOperations = new Map<string, unknown>()

  constructor(dataRoot: string) {
    this.dataRoot = dataRoot
  }

  /** 图存储目录（<dataRoot>/plugins/chat-graphs/）。 */
  private graphsDir(): string {
    return path.join(this.dataRoot, 'plugins', 'chat-graphs')
  }

  /** 全局图文件（global scope 的记忆节点跨项目共享，如 SOUL.md/User.md/Taste.md 归类）。 */
  private globalFile(): string {
    return path.join(this.graphsDir(), '_global_.json')
  }

  private fileOf(projectName: string): string {
    // 项目名是 workspace 校验过的安全 slug
    return path.join(this.graphsDir(), `${projectName}.json`)
  }

  /**
   * 当前修订号：优先读项目图 JSON 内持久化的自增 rev（save 时 +1，无 mtime
   * 碰撞盲区）；旧文件无 rev 字段时回退「项目+全局文件 mtimeMs 之和」。
   * 前端每次整图保存携带该值，服务端比对不一致则拒绝（乐观并发，防陈旧窗口覆盖）。
   */
  rev(projectName: string): number {
    const stored = this.readStoredRev(this.fileOf(projectName))
    if (stored !== undefined) return stored
    let v = 0
    for (const file of [this.fileOf(projectName), this.globalFile()]) {
      try { v += fs.statSync(file).mtimeMs } catch { /* 尚未落盘 = 0 */ }
    }
    return v
  }

  /** 读图 JSON 内持久化的自增 rev（缺失/旧文件返回 undefined）。 */
  private readStoredRev(file: string): number | undefined {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { rev?: unknown }
      return typeof parsed.rev === 'number' && Number.isFinite(parsed.rev) ? parsed.rev : undefined
    } catch {
      return undefined
    }
  }

  /** 读取全局图（仅 global 节点；无则空）。 */
  private readGlobal(): ChatGraph {
    try {
      const raw = fs.readFileSync(this.globalFile(), 'utf8')
      const parsed = JSON.parse(raw) as Partial<ChatGraph>
      return {
        nodes: Array.isArray(parsed.nodes) ? parsed.nodes.filter((n) => n.scope === 'global') : [],
        edges: [],
        schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : undefined,
      }
    } catch {
      return emptyGraph()
    }
  }

  /** 读取项目图（不含 global 节点；墓碑随项目文件走）。 */
  private readProject(projectName: string): ChatGraph {
    try {
      const raw = fs.readFileSync(this.fileOf(projectName), 'utf8')
      const parsed = JSON.parse(raw) as Partial<ChatGraph>
      const project: ChatGraph = {
        nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
        edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      }
      if (Array.isArray(parsed.groups)) project.groups = parsed.groups
      if (typeof parsed.schemaVersion === 'number') project.schemaVersion = parsed.schemaVersion
      if (parsed.layoutCurated === true) project.layoutCurated = true
      const tombstones = sanitizeTombstones(parsed.tombstones)
      if (tombstones !== undefined) project.tombstones = tombstones
      return project
    } catch {
      return emptyGraph()
    }
  }

  /** 读取项目图（global 节点合并可见：全局记忆跨项目共享；旧数据自动迁移到全局文件）。 */
  get(projectName: string): ChatGraph {
    const project = this.readProject(projectName)
    const global = this.readGlobal()
    const legacyGlobals = project.nodes.filter((n) => n.scope === 'global')
    const normalized = normalizeGraph({
      nodes: [...project.nodes, ...global.nodes],
      edges: project.edges,
      groups: project.groups,
      schemaVersion: Math.max(project.schemaVersion ?? 0, global.schemaVersion ?? 0),
      layoutCurated: project.layoutCurated,
      ...(project.tombstones !== undefined ? { tombstones: project.tombstones } : {}),
    })
    const projectMigration = migrateGraph(project).report
    const globalMigration = migrateGraph(global).report
    const hasStoredGraph = fs.existsSync(this.fileOf(projectName)) || fs.existsSync(this.globalFile())
    const needsPersist = hasStoredGraph && (legacyGlobals.length > 0 || projectMigration.changed || globalMigration.changed)
    if (needsPersist) {
      // Migration is lazy but durable: the first read writes the normalized v3
      // graph, rotates the old files, and uses the same atomic save path as a
      // normal edit. A failed migration never makes the read path unusable.
      const saved = this.save(projectName, normalized)
      if (saved.ok) return this.readNormalized(projectName)
    }
    return normalized
  }

  private readNormalized(projectName: string): ChatGraph {
    const project = this.readProject(projectName)
    const global = this.readGlobal()
    return normalizeGraph({
      nodes: [...project.nodes, ...global.nodes],
      edges: project.edges,
      groups: project.groups,
      schemaVersion: CHAT_GRAPH_SCHEMA_VERSION,
      layoutCurated: project.layoutCurated,
      ...(project.tombstones !== undefined ? { tombstones: project.tombstones } : {}),
    })
  }

  /**
   * 保存项目图（整体覆盖）。校验：
   * - 边引用的节点必须存在（含全局节点）；
   * - chat node 的 context 输入最多一条（后写覆盖先写，前端也做约束）；
   * - global scope 节点剥离到全局文件（跨项目共享），项目文件只存项目节点与边。
   */
  save(projectName: string, graph: ChatGraph, expectedRev?: number): { ok: boolean; error?: string; conflict?: boolean } {
    if (typeof projectName !== 'string' || projectName.trim() === '') return { ok: false, error: '项目名为空' }
    if (expectedRev !== undefined && this.rev(projectName) !== expectedRev) {
      return { ok: false, conflict: true, error: '图谱已在其他窗口修改，请重新基于最新图谱追加操作' }
    }
    const normalized = normalizeGraph({
      nodes: Array.isArray(graph?.nodes) ? graph.nodes : [],
      edges: Array.isArray(graph?.edges) ? graph.edges : [],
      groups: graph?.groups,
      schemaVersion: graph?.schemaVersion,
      layoutCurated: graph?.layoutCurated,
      ...(graph?.tombstones !== undefined ? { tombstones: graph.tombstones } : {}),
    })
    const nodes = normalized.nodes
    const edges = normalized.edges
    const ids = new Set(nodes.map((n) => n.id))
    for (const edge of edges) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) return { ok: false, error: `连线引用不存在的节点（${edge.from} → ${edge.to}）` }
      if (edge.toPort !== 'context' && edge.toPort !== 'memory') return { ok: false, error: '无效的输入端口类型' }
      if (edge.toPort === 'context' && edgeBehavior(edge) !== 'fork') return { ok: false, error: 'context 连线必须使用分支行为' }
      if (edge.toPort === 'memory' && edgeBehavior(edge) === 'fork') return { ok: false, error: '参考端口不能使用分支行为' }
      // GRAPH-07：自然语言说明只允许附加在非 context 边（context 是系统一次性 fork 语义，保持纯净）
      if (edge.toPort === 'context' && typeof edge.label === 'string' && edge.label.trim() !== '') {
        return { ok: false, error: 'context 连线不允许附加说明' }
      }
    }
    // context 唯一性：同一目标节点只保留一条 context 边
    const seen = new Set<string>()
    const deduped = edges.filter((e) => {
      if (e.toPort !== 'context') return true
      const key = e.to
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const globalNodes = nodes.filter((n) => n.scope === 'global')
    const projectNodes = nodes.filter((n) => n.scope !== 'global')
    // ── 墓碑 diff（v4 §6.3 尊重用户编辑）：graph-save 时服务端对比已存图与入参图，
    // 消失的节点/边写入墓碑；graph-sync 与一切自动同步跳过墓碑项，绝不复活。
    const tombstones = this.computeTombstones(projectName, projectNodes, deduped, ids, normalized.tombstones)
    const dir = this.graphsDir()
    const gfile = this.globalFile()
    const file = this.fileOf(projectName)
    const gtmp = `${gfile}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
    const tmp = `${file}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
    const oldGlobal = this.readBytes(gfile)
    const oldProject = this.readBytes(file)
    let globalReplaced = false
    let projectReplaced = false
    try {
      fs.mkdirSync(dir, { recursive: true })
      // Prepare both files before replacing either one.  This matters because
      // global nodes are shared by every project: a project write failure must
      // not leave the two graph scopes observing different revisions.
      fs.writeFileSync(gtmp, JSON.stringify({ nodes: globalNodes, edges: [], schemaVersion: normalized.schemaVersion }, null, 2), 'utf8')
      // 自增 rev：旧文件回退 mtime 之和作基线，向后兼容（存进项目图文件）
      const nextRev = (this.readStoredRev(file) ?? this.rev(projectName)) + 1
      fs.writeFileSync(tmp, JSON.stringify({
        nodes: projectNodes, edges: deduped, groups: normalized.groups, schemaVersion: normalized.schemaVersion,
        rev: nextRev,
        ...(normalized.layoutCurated === true ? { layoutCurated: true } : {}),
        ...(tombstones !== undefined ? { tombstones } : {}),
      }, null, 2), 'utf8')
      this.backupIfPresent(gfile)
      this.backupIfPresent(file)
      fs.renameSync(gtmp, gfile)
      globalReplaced = true
      fs.renameSync(tmp, file)
      projectReplaced = true
      return { ok: true }
    } catch (error) {
      // Restore any half-completed swap from the exact bytes observed before
      // the operation.  Recovery itself is best-effort, but every failure is
      // reported to the caller and the rotating .bak files remain available.
      try {
        if (globalReplaced) this.restoreBytes(gfile, oldGlobal)
        if (projectReplaced) this.restoreBytes(file, oldProject)
        else if (globalReplaced && !projectReplaced) this.restoreBytes(gfile, oldGlobal)
      } catch (restoreError) {
        return { ok: false, error: `${error instanceof Error ? error.message : String(error)}（恢复失败：${restoreError instanceof Error ? restoreError.message : String(restoreError)}）` }
      } finally {
        try { fs.rmSync(gtmp, { force: true }) } catch { /* ignore cleanup failure */ }
        try { fs.rmSync(tmp, { force: true }) } catch { /* ignore cleanup failure */ }
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      try { fs.rmSync(gtmp, { force: true }) } catch { /* ignore cleanup failure */ }
      try { fs.rmSync(tmp, { force: true }) } catch { /* ignore cleanup failure */ }
    }
  }

  /**
   * 墓碑 diff（v4）：对比已存项目图（先经 normalize，避免迁移本身制造假墓碑）
   * 与入参图。消失的节点/边记入墓碑；已在入参图中重新出现的键清除墓碑
   * （用户手动重建 = 意图变更）。两端节点同时消失的边不单独记墓碑（随节点走）。
   */
  private computeTombstones(
    projectName: string,
    incomingNodes: readonly GraphNode[],
    incomingEdges: readonly GraphEdge[],
    incomingIds: ReadonlySet<string>,
    carried: GraphTombstones | undefined,
  ): GraphTombstones | undefined {
    const file = this.fileOf(projectName)
    if (!fs.existsSync(file)) return carried
    let stored: ChatGraph
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ChatGraph>
      stored = normalizeGraph({
        nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
        edges: Array.isArray(parsed.edges) ? parsed.edges : [],
        groups: parsed.groups,
        schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : undefined,
        ...(parsed.tombstones !== undefined ? { tombstones: parsed.tombstones } : {}),
      })
    } catch {
      return carried
    }
    const nodeKeys = new Set<string>()
    for (const node of incomingNodes) nodeKeys.add(nodeKeyOf(node))
    const edgeKeys = new Set<string>()
    for (const edge of incomingEdges) edgeKeys.add(edgeKeyOf(edge))
    const prev = stored.tombstones ?? { nodes: [], edges: [], updatedAt: 0 }
    const prevNodeSnapshots = new Map<string, GraphNode>()
    for (const snap of prev.nodeSnapshots ?? []) prevNodeSnapshots.set(nodeKeyOf(snap), snap)
    const prevEdgeSnapshots = new Map<string, GraphEdge>()
    for (const snap of prev.edgeSnapshots ?? []) prevEdgeSnapshots.set(edgeKeyOf(snap), snap)
    const disappearedNodes: string[] = []
    const nodeSnapshots = new Map<string, GraphNode>()
    for (const node of stored.nodes) {
      if (node.scope === 'global') continue
      const key = nodeKeyOf(node)
      if (!nodeKeys.has(key)) {
        disappearedNodes.push(key)
        nodeSnapshots.set(key, node)
      }
    }
    const disappearedEdges: string[] = []
    const edgeSnapshots = new Map<string, GraphEdge>()
    for (const edge of stored.edges) {
      const key = edgeKeyOf(edge)
      if (edgeKeys.has(key)) continue
      if (!incomingIds.has(edge.from) || !incomingIds.has(edge.to)) continue
      disappearedEdges.push(key)
      edgeSnapshots.set(key, edge)
    }
    const nextNodes = [...new Set([...prev.nodes, ...disappearedNodes])].filter((key) => !nodeKeys.has(key)).slice(-GRAPH_TOMBSTONE_MAX)
    const nextEdges = [...new Set([...prev.edges, ...disappearedEdges])].filter((key) => !edgeKeys.has(key)).slice(-GRAPH_TOMBSTONE_MAX)
    // 快照与键列表同集合同生命周期：键被清除（用户重建/已补回）时快照一并丢弃。
    const nextNodeSnapshots = nextNodes.map((key) => nodeSnapshots.get(key) ?? prevNodeSnapshots.get(key)).filter((n): n is GraphNode => n !== undefined)
    const nextEdgeSnapshots = nextEdges.map((key) => edgeSnapshots.get(key) ?? prevEdgeSnapshots.get(key)).filter((e): e is GraphEdge => e !== undefined)
    if (nextNodes.length === 0 && nextEdges.length === 0) return undefined
    return {
      nodes: nextNodes,
      edges: nextEdges,
      ...(nextNodeSnapshots.length > 0 ? { nodeSnapshots: nextNodeSnapshots } : {}),
      ...(nextEdgeSnapshots.length > 0 ? { edgeSnapshots: nextEdgeSnapshots } : {}),
      updatedAt: Date.now(),
    }
  }

  /** 项目墓碑快照（无文件/无墓碑返回空集合）。 */
  tombstonesOf(projectName: string): { nodes: string[]; edges: string[] } {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.fileOf(projectName), 'utf8')) as Partial<ChatGraph>
      const tombstones = sanitizeTombstones(parsed.tombstones)
      return { nodes: tombstones?.nodes ?? [], edges: tombstones?.edges ?? [] }
    } catch {
      return { nodes: [], edges: [] }
    }
  }

  /** 自动同步前置检查：locator/节点键是否在墓碑中。 */
  tombstoneHasNode(projectName: string, key: string): boolean {
    return this.tombstonesOf(projectName).nodes.includes(key)
  }

  /** 自动同步前置检查：边键（from|to|behavior|system）是否在墓碑中。 */
  tombstoneHasEdge(projectName: string, key: string): boolean {
    return this.tombstonesOf(projectName).edges.includes(key)
  }

  /**
   * 清空墓碑（graph-restore-tombstones）：先按快照原样补回（用户自建的嵌入式
   * 节点没有其他再播种来源，只能从墓碑快照逐字恢复），最后原子清空 tombstones
   * 字段（不走 save 的 diff，否则清空会被下一次 diff 原样写回）。
   */
  restoreTombstones(projectName: string): { restoredNodes: number; restoredEdges: number } {
    const file = this.fileOf(projectName)
    try {
      const before = sanitizeTombstones((JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ChatGraph>).tombstones)
      if ((before?.nodes.length ?? 0) === 0 && (before?.edges.length ?? 0) === 0) return { restoredNodes: 0, restoredEdges: 0 }
      // 1) 逐个补回节点快照（addNode 自带 locator 判重与原子保存；已重建过的键自动跳过）
      let restoredNodes = 0
      for (const snap of before?.nodeSnapshots ?? []) {
        const graph = this.get(projectName)
        if (graph.nodes.some((n) => nodeKeyOf(n) === nodeKeyOf(snap))) continue
        this.addNode(projectName, snap)
        restoredNodes += 1
      }
      // 2) 补回边快照（两端节点尚存且键未被占用才补）
      let restoredEdges = 0
      for (const snap of before?.edgeSnapshots ?? []) {
        const graph = this.get(projectName)
        const ids = new Set(graph.nodes.map((n) => n.id))
        if (!ids.has(snap.from) || !ids.has(snap.to)) continue
        if (graph.edges.some((e) => edgeKeyOf(e) === edgeKeyOf(snap))) continue
        const saved = this.save(projectName, { ...graph, edges: [...graph.edges, snap] }, this.rev(projectName))
        if (saved.ok) restoredEdges += 1
      }
      // 3) 最后清空墓碑（重新读盘：上面 addNode/save 已改写过文件）
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ChatGraph> & Record<string, unknown>
      parsed.tombstones = { nodes: [], edges: [], updatedAt: Date.now() }
      const tmp = `${file}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
      fs.mkdirSync(path.dirname(file), { recursive: true })
      try {
        fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2), 'utf8')
        this.backupIfPresent(file)
        fs.renameSync(tmp, file)
      } finally {
        try { fs.rmSync(tmp, { force: true }) } catch { /* ignore */ }
      }
      return { restoredNodes, restoredEdges }
    } catch {
      return { restoredNodes: 0, restoredEdges: 0 }
    }
  }

  private readBytes(file: string): Buffer | undefined {
    try { return fs.readFileSync(file) } catch { return undefined }
  }

  private restoreBytes(file: string, bytes: Buffer | undefined): void {
    if (bytes === undefined) {
      fs.rmSync(file, { force: true })
      return
    }
    const restore = `${file}.restore-${process.pid}-${randomUUID().slice(0, 8)}`
    try {
      fs.writeFileSync(restore, bytes)
      fs.renameSync(restore, file)
    } finally {
      try { fs.rmSync(restore, { force: true }) } catch { /* keep backup */ }
    }
  }

  /**
   * 追加节点（id 冲突自动重生成；多窗口只重试这个追加操作）。
   * 判重（§4.3 节点唯一复用）：凡带稳定 locator 的节点（memory / chat /
   * resource 均）先按 locator 查找，存在即复用并返回现有节点。
   */
  addNode(projectName: string, node: Omit<GraphNode, 'id'>): GraphNode {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const graph = this.get(projectName)
      const locator = graphNodeLocator(node)
      if (locator !== undefined) {
        const existing = graph.nodes.find((candidate) => graphNodeLocator(candidate) === locator)
        if (existing !== undefined) return existing
      }
      let id = randomUUID().slice(0, 8)
      while (graph.nodes.some((n) => n.id === id)) id = randomUUID().slice(0, 8)
      const created: GraphNode = { ...node, id, ...this.overlapFreePosition(graph, node) }
      const saved = this.save(projectName, { ...graph, nodes: [...graph.nodes, created] }, this.rev(projectName))
      if (saved.ok) return created
      if (!saved.conflict) throw new Error(saved.error ?? '图谱保存失败')
    }
    throw new Error('图谱并发修改过多，追加节点失败；请重试')
  }

  /**
   * 自动落图防重叠兜底：新建节点坐标与现有节点包围盒相撞时向右逐格挪，
   * 直到空位（估算卡片 240×130；调用方已给坐标时仅在有碰撞时微调）。
   */
  private overlapFreePosition(graph: ChatGraph, node: Omit<GraphNode, 'id'>): Partial<Pick<GraphNode, 'x' | 'y'>> {
    if (typeof node.x !== 'number' || typeof node.y !== 'number') return {}
    const W = 240
    const H = 130
    const hits = (x: number, y: number): boolean =>
      graph.nodes.some((n) => {
        const nx = typeof n.x === 'number' ? n.x : 0
        const ny = typeof n.y === 'number' ? n.y : 0
        return Math.abs(nx - x) < W && Math.abs(ny - y) < H
      })
    if (!hits(node.x, node.y)) return {}
    let x = node.x
    let y = node.y
    for (let step = 0; step < 40 && hits(x, y); step += 1) {
      x += W
      if (step % 6 === 5) {
        x = node.x
        y += H + 30
      }
    }
    return { x, y }
  }

  /** 保存前轮换少量备份，迁移/并发恢复时不覆盖唯一图文件。 */
  private backupIfPresent(file: string): void {
    try {
      if (!fs.existsSync(file)) return
      const backup = `${file}.bak-${Date.now()}`
      fs.copyFileSync(file, backup)
      const backups = fs.readdirSync(path.dirname(file))
        .filter((name) => name.startsWith(path.basename(file) + '.bak-'))
        .sort()
      for (const old of backups.slice(0, Math.max(0, backups.length - 3))) {
        try { fs.rmSync(path.join(path.dirname(file), old), { force: true }) } catch { /* 保留可恢复副本即可 */ }
      }
    } catch {
      // 备份失败不让内存图操作直接失败；原子临时文件仍保护当前写入。
    }
  }

  /**
   * 追加连线（context 目标已有连接时替换旧边）。
   * 判重（v4 contract）：按 from|to|behavior|system 查找，已存在即复用返回
   * 现有边（同一对节点的重复连线不再增生；label 各自表达说明，不参与判重）。
   * 支持 behavior 'write'（写线：事实线 system:true / 通道线 system:false）。
   */
  addEdge(projectName: string, edge: Omit<GraphEdge, 'id'>): GraphEdge {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const graph = this.get(projectName)
      if (!graph.nodes.some((n) => n.id === edge.from) || !graph.nodes.some((n) => n.id === edge.to)) {
        throw new Error('连线引用的节点不存在')
      }
      const wantedKey = edgeKeyOf(edge)
      const existing = graph.edges.find((candidate) => edgeKeyOf(candidate) === wantedKey)
      if (existing !== undefined && edge.toPort !== 'context') return existing
      const edges = edge.toPort === 'context'
        ? graph.edges.filter((e) => !(e.to === edge.to && e.toPort === 'context'))
        : [...graph.edges]
      const created: GraphEdge = { ...edge, id: randomUUID().slice(0, 8) }
      const saved = this.save(projectName, { ...graph, edges: [...edges, created] }, this.rev(projectName))
      if (saved.ok) return created
      if (!saved.conflict) throw new Error(saved.error ?? '图谱保存失败')
    }
    throw new Error('图谱并发修改过多，追加连线失败；请重试')
  }

  /**
   * 写线 upsert（v4）：同一 (from,to,system) 的写线累加 writeCount/lastWriteAt；
   * 不存在则创建。事实线（system:true）由模型写工具/每轮台账自动调用；
   * 通道线（system:false）由用户手拖声明、沉淀动作成功后累加。
   * TODO(Phase4): 节点/边级"禁写开关"挂在这里——开关打开时自动 upsert 直接跳过；
   * "自动沉淀开关"（turn/end 是否自动 bump 台账写线）由调用方（chat-graph-sync）裁决。
   */
  upsertWriteEdge(projectName: string, from: string, to: string, system: boolean, step = 1): { ok: boolean; edge?: GraphEdge; error?: string } {
    if (from === to) return { ok: false, error: '写线两端不能是同一节点' }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const graph = this.get(projectName)
      if (!graph.nodes.some((n) => n.id === from) || !graph.nodes.some((n) => n.id === to)) {
        return { ok: false, error: '写线引用的节点不存在' }
      }
      const index = graph.edges.findIndex((candidate) =>
        candidate.from === from && candidate.to === to
        && edgeBehavior(candidate) === 'write' && candidate.system === system)
      let nextEdges: GraphEdge[]
      let result: GraphEdge
      if (index >= 0) {
        const current = graph.edges[index]!
        result = { ...current, writeCount: (current.writeCount ?? 0) + step, lastWriteAt: Date.now(), updatedAt: Date.now() }
        nextEdges = graph.edges.map((edge, i) => (i === index ? result : edge))
      } else {
        result = {
          id: randomUUID().slice(0, 8),
          from,
          to,
          toPort: 'memory',
          behavior: 'write',
          system,
          writeCount: Math.max(1, step),
          lastWriteAt: Date.now(),
          createdAt: Date.now(),
          enabled: true,
        }
        nextEdges = [...graph.edges, result]
      }
      const saved = this.save(projectName, { ...graph, edges: nextEdges }, this.rev(projectName))
      if (saved.ok) return { ok: true, edge: result }
      if (!saved.conflict) return { ok: false, error: saved.error ?? '图谱保存失败' }
    }
    return { ok: false, error: '图谱并发修改过多，写线更新失败；请重试' }
  }

  /** 轻量版本信息（graph-version 轮询用；读原文件计数，不触发迁移落盘）。 */
  versionOf(projectName: string): { rev: number; nodeCount: number; edgeCount: number; serverTime: number } {
    let nodeCount = 0
    let edgeCount = 0
    try {
      const parsed = JSON.parse(fs.readFileSync(this.fileOf(projectName), 'utf8')) as Partial<ChatGraph>
      nodeCount = Array.isArray(parsed.nodes) ? parsed.nodes.length : 0
      edgeCount = Array.isArray(parsed.edges) ? parsed.edges.length : 0
    } catch { /* 无文件 = 0 */ }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.globalFile(), 'utf8')) as Partial<ChatGraph>
      if (Array.isArray(parsed.nodes)) nodeCount += parsed.nodes.filter((n) => n?.scope === 'global').length
    } catch { /* 无全局文件 = 0 */ }
    return { rev: this.rev(projectName), nodeCount, edgeCount, serverTime: Date.now() }
  }

  /** 按会话 id 反查所在项目与 chat 节点（扫描全部项目图；graph-distill 等无 workspaceDir 入口用）。 */
  projectOfSession(sessionId: string): { project: string; node: GraphNode } | undefined {
    let names: string[] = []
    try {
      names = fs.readdirSync(this.graphsDir())
        .filter((name) => name.endsWith('.json') && name !== '_global_.json')
        .map((name) => name.slice(0, -'.json'.length))
    } catch {
      return undefined
    }
    for (const project of names) {
      const node = this.get(project).nodes.find((n) => n.type === 'chat' && n.sessionId === sessionId)
      if (node !== undefined) return { project, node }
    }
    return undefined
  }

  private memoryBase(workspaceDir: string | undefined, scope: 'project' | 'global'): string {
    return scope === 'global' || workspaceDir === undefined || workspaceDir === '' || workspaceDir === this.dataRoot
      ? this.dataRoot
      : workspaceDir
  }

  private memoryFileName(title: string, suffix: 'note' | 'collection'): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'memory'
    return `${slug}-${suffix}-${randomUUID().slice(0, 8)}.md`
  }

  private atomicTextWrite(target: string, content: string): void {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const tmp = `${target}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
    try {
      fs.writeFileSync(tmp, content, 'utf8')
      fs.renameSync(tmp, target)
    } catch (error) {
      try { fs.rmSync(tmp, { force: true }) } catch { /* 临时文件清理失败不覆盖原资料 */ }
      throw error
    }
  }

  private createMemoryDocument(
    projectName: string,
    workspaceDir: string | undefined,
    input: { title: string; scope: 'project' | 'global'; content: string; collection: boolean; x?: number; y?: number; links?: readonly ScienceMemoryLink[] },
  ): GraphNode {
    const base = this.memoryBase(workspaceDir, input.scope)
    const subdir = input.collection ? 'collections' : 'notes'
    const fileName = this.memoryFileName(input.title, input.collection ? 'collection' : 'note')
    const relativePath = path.join(input.scope === 'global' ? 'plugins' : '.evoresearch-data', 'memories', subdir, fileName)
    const target = path.join(base, relativePath)
    this.atomicTextWrite(target, input.content)
    if (input.links !== undefined && input.links.length > 0) this.writeSidecarLinks(target, input.links)
    const node: Omit<GraphNode, 'id'> = {
      type: 'resource',
      displayKind: input.collection ? 'memory-collection' : 'memory',
      title: input.title.trim() || '未命名 Memory',
      x: Number.isFinite(input.x) ? Math.round(input.x!) : 80,
      y: Number.isFinite(input.y) ? Math.round(input.y!) : 80,
      scope: input.scope,
      ref: {
        kind: input.collection ? 'memory' : 'note',
        // note refs are relative to memories/notes; collection refs are
        // ordinary project-relative resources so they remain a single node.
        path: input.scope === 'global' ? target : input.collection ? relativePath : fileName,
      },
      locator: `${input.scope}:${input.collection ? 'collection' : 'memory'}:${fileName}`,
      origin: 'user',
      status: 'available',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    try {
      return this.addNode(projectName, node)
    } catch (error) {
      try { fs.rmSync(target, { force: true }) } catch { /* 只清理本次新建的孤儿文件 */ }
      throw error
    }
  }

  /** 新建空白 Markdown Memory；不复用或复制已有节点。 */
  createBlankMemory(
    projectName: string,
    workspaceDir: string | undefined,
    input: { title?: string; scope?: 'project' | 'global'; x?: number; y?: number } = {},
  ): GraphNode {
    return this.createMemoryDocument(projectName, workspaceDir, {
      title: input.title?.trim() || '新的研究记忆',
      scope: input.scope ?? 'project',
      content: '',
      collection: false,
      x: input.x,
      y: input.y,
    })
  }

  /** 复制 Memory 的 Markdown 正文和可用链接，复制后两份文件完全独立。 */
  copyMemory(
    projectName: string,
    nodeId: string,
    workspaceDir: string | undefined,
    input: { title?: string; x?: number; y?: number } = {},
  ): GraphNode {
    const source = this.get(projectName).nodes.find((node) => node.id === nodeId && isMemoryNode(node))
    if (source === undefined) throw new Error('Memory 节点不存在')
    const preview = this.previewOf(source, workspaceDir, MAX_PREVIEW_BYTES)
    if (source.ref !== undefined && !preview.ok && preview.error !== undefined) throw new Error(preview.error)
    // 空白 Memory 也是合法的独立 Markdown：复制操作必须仍生成新的
    // locator，而不能因为当前正文暂时为空而退回复用旧节点。
    const content = source.ref === undefined ? (source.content ?? '') : preview.text ?? ''
    return this.createMemoryDocument(projectName, workspaceDir, {
      title: input.title?.trim() || `${source.title}（独立副本）`,
      scope: source.scope ?? 'project',
      content,
      collection: false,
      x: input.x,
      y: input.y,
      links: source.ref === undefined ? [] : this.readSidecarLinks(preview.path),
    })
  }

  /** Read the optional science/memory sidecar without making it authoritative. */
  private readSidecarLinks(sourcePath: string | undefined): ScienceMemoryLink[] {
    if (sourcePath === undefined || sourcePath === '') return []
    try {
      const sidecar = path.join(path.dirname(sourcePath), '.index.json')
      const parsed = JSON.parse(fs.readFileSync(sidecar, 'utf8')) as { entries?: Record<string, { links?: unknown }> }
      const links = parsed.entries?.[path.basename(sourcePath)]?.links
      if (!Array.isArray(links)) return []
      return links.filter((item): item is ScienceMemoryLink => {
        const value = item as Record<string, unknown>
        return typeof value.label === 'string' && typeof value.target === 'string'
          && ['chat', 'code', 'log', 'result', 'note', 'experiment'].includes(String(value.kind))
      })
    } catch {
      return []
    }
  }

  /** Copy sidecar links next to the copied Markdown; the Markdown remains the source of truth. */
  private writeSidecarLinks(target: string, links: readonly ScienceMemoryLink[]): void {
    const file = path.join(path.dirname(target), '.index.json')
    let parsed: { entries?: Record<string, { links?: readonly ScienceMemoryLink[]; createdAt?: number }> } = {}
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof parsed } catch { /* create a new sidecar */ }
    parsed.entries = parsed.entries ?? {}
    parsed.entries[path.basename(target)] = { links: [...links], createdAt: Date.now() }
    this.atomicTextWrite(file, JSON.stringify(parsed, null, 2))
  }

  /** 新建逻辑 Memory Collection；图中只有一个节点，正文仍落在可编辑 Markdown 文件。 */
  createMemoryCollection(
    projectName: string,
    workspaceDir: string | undefined,
    input: { title?: string; scope?: 'project' | 'global'; x?: number; y?: number } = {},
  ): GraphNode {
    return this.createMemoryDocument(projectName, workspaceDir, {
      title: input.title?.trim() || '新的 Memory Collection',
      scope: input.scope ?? 'project',
      content: '',
      collection: true,
      x: input.x,
      y: input.y,
    })
  }

  /** 更新单个节点的可变字段；不会改变稳定 id，也不会删除真实资料。 */
  updateNode(projectName: string, nodeId: string, patch: Partial<Omit<GraphNode, 'id'>>): { ok: boolean; node?: GraphNode; error?: string } {
    const graph = this.get(projectName)
    const index = graph.nodes.findIndex((node) => node.id === nodeId)
    if (index < 0) return { ok: false, error: '节点不存在' }
    const current = graph.nodes[index]!
    const { type: _ignoredType, ...mutablePatch } = patch
    const nextNode: GraphNode = { ...current, ...mutablePatch, id: current.id, type: current.type }
    const next = { ...graph, nodes: graph.nodes.map((node, i) => i === index ? nextNode : node) }
    const saved = this.save(projectName, next)
    return saved.ok ? { ok: true, node: nextNode } : { ok: false, error: saved.error }
  }

  /**
   * Write a Memory document through its reference and keep the graph as a
   * locator-only view. Legacy embedded nodes continue to store their content
   * in the graph. This is the explicit edit path used by the Memory editor;
   * ordinary graph saves never silently overwrite a referenced Markdown file.
   */
  writeMemory(projectName: string, nodeId: string, workspaceDir: string | undefined, content: string): { ok: boolean; node?: GraphNode; error?: string } {
    const graph = this.get(projectName)
    const current = graph.nodes.find((node) => node.id === nodeId && isMemoryNode(node))
    if (current === undefined) return { ok: false, error: 'Memory 节点不存在' }
    const nextContent = String(content)
    if (current.ref !== undefined) {
      const preview = this.previewOf(current, workspaceDir, 1)
      if (preview.path === undefined || preview.path === '') return { ok: false, error: preview.error ?? 'Memory 原文不可写入' }
      try { this.atomicTextWrite(preview.path, nextContent) }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
      const nextNode: GraphNode = { ...current, content: undefined, updatedAt: Date.now() }
      const saved = this.save(projectName, { ...graph, nodes: graph.nodes.map((node) => node.id === nodeId ? nextNode : node) })
      return saved.ok ? { ok: true, node: nextNode } : { ok: false, error: saved.error }
    }
    const nextNode: GraphNode = { ...current, content: nextContent, updatedAt: Date.now() }
    const saved = this.save(projectName, { ...graph, nodes: graph.nodes.map((node) => node.id === nodeId ? nextNode : node) })
    return saved.ok ? { ok: true, node: nextNode } : { ok: false, error: saved.error }
  }

  /**
   * 沉淀写入（v4 §5.2 追加不覆盖）：把带时间戳的小节追加到目标记忆节点末尾。
   * - ref 节点：读原文件原文（保留 frontmatter），追加后经原子写回写；
   * - 内嵌 content 节点：直接在 content 末尾追加（旧节点继续可用）。
   * 返回追加的字节数；目标不是 memory 节点时报错。
   */
  appendMemorySection(projectName: string, nodeId: string, workspaceDir: string | undefined, section: string): { ok: boolean; bytesWritten?: number; node?: GraphNode; error?: string } {
    const graph = this.get(projectName)
    const current = graph.nodes.find((node) => node.id === nodeId && isMemoryNode(node))
    if (current === undefined) return { ok: false, error: 'Memory 节点不存在' }
    const appended = section.trim() === '' ? '' : section
    if (appended === '') return { ok: false, error: '没有可沉淀的内容' }
    if (current.ref !== undefined) {
      if (current.ref.kind === 'dir' || current.ref.kind === 'pdf') return { ok: false, error: '该节点引用目录/PDF，不支持追加沉淀文本' }
      const target = this.refPathOf(current, workspaceDir)
      if (target === undefined) return { ok: false, error: 'Memory 原文位置不可解析' }
      let raw = ''
      try {
        raw = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
      } catch (error) {
        return { ok: false, error: `记忆原文读取失败: ${error instanceof Error ? error.message : String(error)}` }
      }
      const next = raw === '' ? appended : `${raw.replace(/\s*$/, '')}\n${appended}`
      try {
        this.atomicTextWrite(target, next)
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      const nextNode: GraphNode = { ...current, content: undefined, updatedAt: Date.now() }
      const saved = this.save(projectName, { ...graph, nodes: graph.nodes.map((node) => (node.id === nodeId ? nextNode : node)) })
      return saved.ok ? { ok: true, bytesWritten: appended.length, node: nextNode } : { ok: false, error: saved.error }
    }
    const nextNode: GraphNode = { ...current, content: `${(current.content ?? '').replace(/\s*$/, '')}\n${appended}`, updatedAt: Date.now() }
    const saved = this.save(projectName, { ...graph, nodes: graph.nodes.map((node) => (node.id === nodeId ? nextNode : node)) })
    return saved.ok ? { ok: true, bytesWritten: appended.length, node: nextNode } : { ok: false, error: saved.error }
  }

  /**
   * 解析 ref 节点的目标文件绝对路径（与 previewOf 的解析规则一致；不读内容、
   * 不要求文件存在——沉淀是追加写入，文件缺失时从空内容开始）。
   */
  private refPathOf(node: GraphNode, workspaceDir: string | undefined): string | undefined {
    const ref = node.ref
    if (ref === undefined) return undefined
    if (ref.kind === 'note') {
      const base = node.scope === 'global' || workspaceDir === undefined || workspaceDir === this.dataRoot ? this.dataRoot : workspaceDir
      return path.isAbsolute(ref.path) ? ref.path : path.join(workspaceDataDir(this.dataRoot, base), 'memories', 'notes', ref.path)
    }
    if (path.isAbsolute(ref.path)) return ref.path
    const base = workspaceDir !== undefined && workspaceDir !== this.dataRoot ? workspaceDir : this.dataRoot
    return path.join(base, ref.path)
  }

  /** 从图中移除节点及其连线；只删除视图引用。 */
  removeNode(projectName: string, nodeId: string): { ok: boolean; error?: string } {
    const graph = this.get(projectName)
    if (!graph.nodes.some((node) => node.id === nodeId)) return { ok: false, error: '节点不存在' }
    return this.save(projectName, {
      ...graph,
      nodes: graph.nodes.filter((node) => node.id !== nodeId),
      edges: graph.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
    })
  }

  /** 更新连线行为、启用状态或说明；端口和两端节点保持不变。 */
  updateEdge(projectName: string, edgeId: string, patch: Partial<Omit<GraphEdge, 'id' | 'from' | 'to'>>): { ok: boolean; edge?: GraphEdge; error?: string } {
    const graph = this.get(projectName)
    const index = graph.edges.findIndex((edge) => edge.id === edgeId)
    if (index < 0) return { ok: false, error: '连线不存在' }
    const current = graph.edges[index]!
    const { toPort: _ignoredPort, ...mutablePatch } = patch
    const nextEdge: GraphEdge = { ...current, ...mutablePatch, id: current.id, from: current.from, to: current.to, toPort: current.toPort }
    const next = { ...graph, edges: graph.edges.map((edge, i) => i === index ? nextEdge : edge) }
    const saved = this.save(projectName, next)
    return saved.ok ? { ok: true, edge: nextEdge } : { ok: false, error: saved.error }
  }

  removeEdge(projectName: string, edgeId: string): { ok: boolean; error?: string } {
    const graph = this.get(projectName)
    if (!graph.edges.some((edge) => edge.id === edgeId)) return { ok: false, error: '连线不存在' }
    return this.save(projectName, { ...graph, edges: graph.edges.filter((edge) => edge.id !== edgeId) })
  }

  /** 一次提交多个位置，拖动过程不写盘，只在 pointer-up 时调用。 */
  moveNodes(projectName: string, positions: readonly { id: string; x: number; y: number; pinned?: boolean }[]): { ok: boolean; error?: string } {
    const graph = this.get(projectName)
    const byId = new Map(positions.map((position) => [position.id, position]))
    const nextNodes = graph.nodes.map((node) => {
      const position = byId.get(node.id)
      if (position === undefined) return node
      return { ...node, x: Number.isFinite(position.x) ? Math.round(position.x) : node.x, y: Number.isFinite(position.y) ? Math.round(position.y) : node.y, ...(typeof position.pinned === 'boolean' ? { pinned: position.pinned } : {}) }
    })
    // 人工移动节点 = 人工策展：此后前端不再对该图静默自动布局
    return this.save(projectName, { ...graph, nodes: nextNodes, layoutCurated: true })
  }

  addGroup(projectName: string, group: GraphGroup): { ok: boolean; group?: GraphGroup; error?: string } {
    const graph = this.get(projectName)
    if (typeof group?.id !== 'string' || group.id.trim() === '' || typeof group.title !== 'string' || group.title.trim() === '') return { ok: false, error: '分组数据无效' }
    if ((graph.groups ?? []).some((item) => item.id === group.id)) return { ok: true, group: graph.groups!.find((item) => item.id === group.id) }
    const nextGroup = { ...group, createdAt: group.createdAt ?? Date.now() }
    const saved = this.save(projectName, { ...graph, groups: [...(graph.groups ?? []), nextGroup] })
    return saved.ok ? { ok: true, group: nextGroup } : { ok: false, error: saved.error }
  }

  updateGroup(projectName: string, groupId: string, patch: Partial<Omit<GraphGroup, 'id'>>): { ok: boolean; group?: GraphGroup; error?: string } {
    const graph = this.get(projectName)
    const current = (graph.groups ?? []).find((group) => group.id === groupId)
    if (current === undefined) return { ok: false, error: '分组不存在' }
    const group = { ...current, ...patch, id: groupId }
    const saved = this.save(projectName, { ...graph, groups: (graph.groups ?? []).map((item) => item.id === groupId ? group : item) })
    return saved.ok ? { ok: true, group } : { ok: false, error: saved.error }
  }

  removeGroup(projectName: string, groupId: string): { ok: boolean; error?: string } {
    const graph = this.get(projectName)
    if (!(graph.groups ?? []).some((group) => group.id === groupId)) return { ok: false, error: '分组不存在' }
    const saved = this.save(projectName, {
      ...graph,
      nodes: graph.nodes.map((node) => node.groupId === groupId ? { ...node, groupId: undefined } : node),
      // Removing a visual parent must not leave an invalid nested-group link.
      // Child groups remain visible and become top-level groups.
      groups: (graph.groups ?? [])
        .filter((group) => group.id !== groupId)
        .map((group) => group.parentId === groupId ? { ...group, parentId: undefined } : group),
    })
    return saved
  }

  /** 增量操作幂等封装；operationId 只用于请求去重，不写入用户图数据。 */
  applyOperation<T>(operationId: string | undefined, apply: () => T): T {
    if (operationId === undefined || operationId.trim() === '') return apply()
    const previous = this.appliedOperations.get(operationId)
    if (previous !== undefined) return previous as T
    const result = apply()
    this.appliedOperations.set(operationId, result)
    if (this.appliedOperations.size > 500) this.appliedOperations.delete(this.appliedOperations.keys().next().value as string)
    return result
  }

  /**
   * 实时读取引用资料预览（GRAPH-04/08）：打开节点时读真实文件，文件更新后
   * 预览随之更新（每次调用实时 stat+read，不做内容缓存）。
   * - 无 ref 的节点返回内嵌 content 文本（旧节点继续可用，GRAPH-06）；
   * - note：相对 workspace 数据目录的 memories/notes/ 解析；
   * - file/pdf/dir：绝对路径直接用，相对路径以 workspaceDir 为根；
   * - 文本类文件读取内容（大文件截断）；PDF/图片等二进制返回 binary 提示；
   * - 目录返回前 MAX_DIR_ENTRIES 项清单；目标缺失返回错误。
   */
  previewOf(node: GraphNode, workspaceDir: string | undefined, maxChars = 2000): GraphPreview {
    if (node.ref === undefined) {
      // 旧内嵌文本节点：直接返回内容
      const text = (node.content ?? '').trim()
      if (text === '') return { ok: true, text: '' }
      const truncated = text.length > maxChars
      return { ok: true, text: truncated ? text.slice(0, maxChars) + PREVIEW_TRUNC_SUFFIX : text, truncated }
    }
    const ref = node.ref
    let target = ref.path
    if (ref.kind === 'note') {
      // 笔记引用：相对笔记目录（与 NotesService.notesDirOf 一致）
      const base = node.scope === 'global' || workspaceDir === undefined || workspaceDir === this.dataRoot ? this.dataRoot : workspaceDir
      target = path.isAbsolute(ref.path) ? ref.path : path.join(workspaceDataDir(this.dataRoot, base), 'memories', 'notes', ref.path)
    } else if (!path.isAbsolute(target)) {
      const base = workspaceDir && workspaceDir !== this.dataRoot ? workspaceDir : this.dataRoot
      target = path.join(base, target)
    }
    let stat: fs.Stats
    try {
      stat = fs.statSync(target)
    } catch {
      return { ok: false, error: `引用资料不存在: ${ref.path}` }
    }
    if (stat.isDirectory()) {
      if (ref.kind !== 'dir') return { ok: false, error: '引用指向目录，但节点类型不是目录引用' }
      let names: string[]
      try {
        names = fs.readdirSync(target).sort((a, b) => a.localeCompare(b)).slice(0, MAX_DIR_ENTRIES)
      } catch (error) {
        return { ok: false, error: `目录读取失败: ${error instanceof Error ? error.message : String(error)}` }
      }
      const text = names.map((n) => {
        let isDir = false
        try { isDir = fs.statSync(path.join(target, n)).isDirectory() } catch { /* 条目消失忽略 */ }
        return isDir ? `${n}/` : n
      }).join('\n')
      return { ok: true, text, path: target, mtimeMs: stat.mtimeMs, truncated: false }
    }
    // 文件
    if (!stat.isFile()) return { ok: false, error: `引用目标不是文件: ${ref.path}` }
    if (ref.kind === 'dir') return { ok: false, error: '引用目标是文件，但节点类型是目录引用' }
    const isBinary = ref.kind === 'pdf' || !TEXT_PREVIEW_EXTS.has(path.extname(target).toLowerCase())
    if (isBinary) {
      // 二进制（PDF/图片等）：不读内容，提示在标签页/新窗口打开
      return { ok: false, error: `二进制文件（${(stat.size / 1024).toFixed(1)} KB），请双击在标签页打开`, path: target, mtimeMs: stat.mtimeMs }
    }
    if (stat.size > MAX_PREVIEW_BYTES) {
      return { ok: false, error: `文件过大（${(stat.size / 1024 / 1024).toFixed(1)} MiB），请双击在标签页打开`, path: target, mtimeMs: stat.mtimeMs }
    }
    try {
      let text = fs.readFileSync(target, 'utf8')
      // Markdown 预览剥离 frontmatter：节点预览不把 YAML 头当正文显示（笔记首屏是标题/摘要而非 ---）
      if (path.extname(target).toLowerCase() === '.md') text = stripFrontmatter(text)
      const truncated = text.length > maxChars
      if (truncated) text = text.slice(0, maxChars) + PREVIEW_TRUNC_SUFFIX
      return { ok: true, text, path: target, mtimeMs: stat.mtimeMs, truncated }
    } catch (error) {
      return { ok: false, error: `文件读取失败: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * 内嵌文本 memory node → Markdown 笔记（GRAPH-06）：调用注入的笔记写入器
   * 创建笔记文件，并把节点改为引用该笔记（content 保留为快照，前端优先
   * 显示引用预览）。接线点：api.ts 传入 NotesService（结构兼容 NoteWriter）。
   */
  convertToNote(
    projectName: string,
    nodeId: string,
    workspaceDir: string | undefined,
    notes: NoteWriter,
  ): { ok: true; noteId: string; fileName: string; node: GraphNode } | { ok: false; error: string } {
    const graph = this.get(projectName)
    const node = graph.nodes.find((n) => n.id === nodeId && isMemoryNode(n))
    if (node === undefined) return { ok: false, error: '记忆节点不存在' }
    if ((node.content ?? '').trim() === '') return { ok: false, error: '该节点没有内嵌文本可转换' }
    if (node.ref !== undefined) return { ok: false, error: '该节点已是资料引用，无需转换' }
    const created = notes.createNote({ workspaceDir, title: node.title, body: node.content ?? '' })
    const next: ChatGraph = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, ref: { kind: 'note', path: created.fileName } } : n)),
    }
    const saved = this.save(projectName, next)
    if (!saved.ok) return { ok: false, error: saved.error ?? '图谱保存失败' }
    const updated = next.nodes.find((n) => n.id === nodeId)
    if (updated === undefined) return { ok: false, error: '图谱保存后节点丢失' }
    return { ok: true, noteId: created.noteId, fileName: created.fileName, node: updated }
  }
}

/** 引用预览结果（GRAPH-04/08）。 */
export interface GraphPreview {
  ok: boolean
  /** 预览文本（截断后） */
  text?: string
  /** 目标路径（ref 节点；内嵌 content 无） */
  path?: string
  /** 目标文件 mtimeMs（文件更新后预览同步的依据） */
  mtimeMs?: number
  /** 是否因超出 maxChars 截断 */
  truncated?: boolean
  error?: string
}

/** 文本类可预览扩展名（其余按二进制处理，如 PDF/图片）。 */
const TEXT_PREVIEW_EXTS = new Set([
  '.md', '.txt', '.json', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.yml', '.yaml',
  '.rs', '.py', '.toml', '.html', '.htm', '.svg', '.xml', '.sql', '.csv', '.ini', '.log', '.tex', '.bib',
])
/** 预览截断后缀。 */
const PREVIEW_TRUNC_SUFFIX = '\n…（预览截断，完整内容请在标签页打开）'
/** 单文件预览大小上限（4 MiB，超出提示打开标签页）。 */
const MAX_PREVIEW_BYTES = 4 << 20
/** 目录预览条目上限。 */
const MAX_DIR_ENTRIES = 20

/**
 * 笔记写入器最小结构（GRAPH-06 接线点）。
 * 已与 NotesService.createNote（notes.ts:444）实际签名逐字段核对：
 * 参数 { workspaceDir?: string; title?: string; body: string } 完全一致；
 * 返回 NoteMeta（noteId/fileName/title/body/source/hasFrontmatter/updatedAt/byteSize）
 * 结构包含 { noteId: string; fileName: string }，可直接赋值——结构兼容，无需适配。
 * 存储布局核对：createNote 写 <base>/memories/notes/<fileName>
 * （base = workspaceDir 或 dataRoot 回退），与 previewOf 的 note 解析同规则。
 */
export interface NoteWriter {
  createNote(input: { workspaceDir?: string; title?: string; body: string }): { noteId: string; fileName: string }
}
