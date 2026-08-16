/**
 * Chat Graph 服务（§ChatGraph）：聊天图——节点（chat / memory）+ 连线。
 *
 * 语义：
 * - chat node：一个真实聊天会话（sessionId 关联）；input 端口分 context（唯一，
 *   继承源会话上下文）与 memory（多条，注入记忆检索）；output 供下游继承。
 * - memory node：一段记忆（project 级内容文本 / global 级如 SOUL.md 等）；
 *   output 连到 chat node 的 memory input = 该会话使用此记忆。
 * - 图按项目隔离存储：<dataRoot>/.evoresearch-data/chat-graphs/<projectName>.json
 *   （与 experiments 同级目录，随项目迁移）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readSessionEvents, isSystemText } from './rewind.js'

export interface GraphNode {
  id: string
  type: 'chat' | 'memory'
  title: string
  /** 画布坐标（px，画布内部坐标系） */
  x: number
  y: number
  /** chat node：关联的真实会话 id */
  sessionId?: string
  /** chat node：所属工作区（会话 cwd 的项目目录） */
  workspaceDir?: string
  /** memory node：记忆内容（Markdown 文本） */
  content?: string
  /** memory node：层级（project 项目级 / global 全局级，如 SOUL.md/User.md/Taste.md） */
  scope?: 'project' | 'global'
}

export interface GraphEdge {
  id: string
  from: string
  to: string
  /** chat node 的输入端口：context（唯一）/ memory（多条） */
  toPort: 'context' | 'memory'
}

export interface ChatGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** 空图。 */
export function emptyGraph(): ChatGraph {
  return { nodes: [], edges: [] }
}

/**
 * 提取会话历史文本（user/assistant 消息，跳过系统注入的"伪用户消息"），
 * 最近消息优先，最多 maxChars 字符。
 * 兼容多种事件形状：data.text / data.content[].text（结构化）/ assistant/chunk 的
 * data.chunk.text / data.blocks[].text。
 */
export function sessionHistoryText(sessionId: string, maxChars = 8000): string {
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
      const chunk = d.chunk as { text?: unknown } | undefined
      if (typeof chunk?.text === 'string' && chunk.text !== '') return chunk.text
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
  const parts: string[] = []
  for (const ev of events) {
    if (ev.type !== 'user/message' && ev.type !== 'assistant/message' && ev.type !== 'assistant/chunk') continue
    const text = textOf(ev)
    if (text === '' || isSystemText(text)) continue
    parts.push(text)
  }
  let total = 0
  const recent: string[] = []
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!
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
  const memIds = graph.edges.filter((e) => e.to === node.id && e.toPort === 'memory').map((e) => e.from)
  const contents = graph.nodes
    .filter((n) => memIds.includes(n.id) && n.type === 'memory')
    .map((n) => (n.content ?? '').trim())
    .filter((c) => c !== '')
  if (contents.length === 0) return ''
  let total = 0
  const parts: string[] = []
  for (const content of contents) {
    const slice = content.slice(0, 1500)
    total += slice.length + 2
    if (total > maxChars) break
    parts.push(slice)
  }
  return parts.join('\n\n---\n\n')
}

/** 提取 chat 节点的上下文来源（context 边 → 源 chat 会话最近消息历史）。 */
export function graphContextText(graph: ChatGraph, sessionId: string, maxChars = 8000): { fromTitle: string; text: string } | null {
  const node = graph.nodes.find((n) => n.type === 'chat' && n.sessionId === sessionId)
  if (node === undefined) return null
  const ctxEdge = graph.edges.find((e) => e.to === node.id && e.toPort === 'context')
  if (ctxEdge === undefined) return null
  const src = graph.nodes.find((n) => n.id === ctxEdge.from && n.type === 'chat')
  if (src === undefined || src.sessionId === undefined) return null
  const text = sessionHistoryText(src.sessionId, maxChars)
  if (text === '') return null
  return { fromTitle: src.title, text }
}

/**
 * Chat Graph 服务。dataRoot 与项目列表由 WorkspaceService 提供。
 */
export class ChatGraphService {
  private readonly dataRoot: string

  constructor(dataRoot: string) {
    this.dataRoot = dataRoot
  }

  /** 图存储目录（.evoresearch-data/chat-graphs/）。 */
  private graphsDir(): string {
    return path.join(this.dataRoot, '.evoresearch-data', 'chat-graphs')
  }

  /** 全局图文件（global scope 的记忆节点跨项目共享，如 SOUL.md/User.md/Taste.md 归类）。 */
  private globalFile(): string {
    return path.join(this.graphsDir(), '_global_.json')
  }

  private fileOf(projectName: string): string {
    // 项目名是 workspace 校验过的安全 slug
    return path.join(this.graphsDir(), `${projectName}.json`)
  }

  /** 读取全局图（仅 global 节点；无则空）。 */
  private readGlobal(): ChatGraph {
    try {
      const raw = fs.readFileSync(this.globalFile(), 'utf8')
      const parsed = JSON.parse(raw) as Partial<ChatGraph>
      return {
        nodes: Array.isArray(parsed.nodes) ? parsed.nodes.filter((n) => n.scope === 'global') : [],
        edges: [],
      }
    } catch {
      return emptyGraph()
    }
  }

  /** 读取项目图（不含 global 节点）。 */
  private readProject(projectName: string): ChatGraph {
    try {
      const raw = fs.readFileSync(this.fileOf(projectName), 'utf8')
      const parsed = JSON.parse(raw) as Partial<ChatGraph>
      return {
        nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
        edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      }
    } catch {
      return emptyGraph()
    }
  }

  /** 读取项目图（global 节点合并可见：全局记忆跨项目共享；旧数据自动迁移到全局文件）。 */
  get(projectName: string): ChatGraph {
    const project = this.readProject(projectName)
    const global = this.readGlobal()
    const legacyGlobals = project.nodes.filter((n) => n.scope === 'global')
    if (legacyGlobals.length > 0) {
      // 迁移旧数据：项目文件里遗留的 global 节点 → 全局文件，并从项目文件剥离
      const byId = new Map(global.nodes.map((n) => [n.id, n]))
      for (const n of legacyGlobals) byId.set(n.id, n)
      try {
        const dir = this.graphsDir()
        fs.mkdirSync(dir, { recursive: true })
        const gfile = this.globalFile()
        const gtmp = `${gfile}.tmp-${process.pid}`
        fs.writeFileSync(gtmp, JSON.stringify({ nodes: [...byId.values()], edges: [] }, null, 2), 'utf8')
        fs.renameSync(gtmp, gfile)
      } catch { /* 迁移失败不影响读取 */ }
      const projectOnly = { nodes: project.nodes.filter((n) => n.scope !== 'global'), edges: project.edges }
      try { this.save(projectName, projectOnly) } catch { /* 剥离失败不影响读取 */ }
      return { nodes: [...projectOnly.nodes, ...byId.values()], edges: projectOnly.edges }
    }
    return { nodes: [...project.nodes, ...global.nodes], edges: project.edges }
  }

  /**
   * 保存项目图（整体覆盖）。校验：
   * - 边引用的节点必须存在（含全局节点）；
   * - chat node 的 context 输入最多一条（后写覆盖先写，前端也做约束）；
   * - global scope 节点剥离到全局文件（跨项目共享），项目文件只存项目节点与边。
   */
  save(projectName: string, graph: ChatGraph): { ok: boolean; error?: string } {
    if (typeof projectName !== 'string' || projectName.trim() === '') return { ok: false, error: '项目名为空' }
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
    const edges = Array.isArray(graph?.edges) ? graph.edges : []
    const ids = new Set(nodes.map((n) => n.id))
    for (const edge of edges) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) return { ok: false, error: `连线引用不存在的节点（${edge.from} → ${edge.to}）` }
      if (edge.toPort !== 'context' && edge.toPort !== 'memory') return { ok: false, error: '无效的输入端口类型' }
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
    try {
      const dir = this.graphsDir()
      fs.mkdirSync(dir, { recursive: true })
      // 全局节点合并写入全局文件（按 id 去重：保留最新位置/标题/内容）
      if (globalNodes.length > 0) {
        const current = this.readGlobal()
        const byId = new Map(current.nodes.map((n) => [n.id, n]))
        for (const n of globalNodes) byId.set(n.id, n)
        const gfile = this.globalFile()
        const gtmp = `${gfile}.tmp-${process.pid}`
        fs.writeFileSync(gtmp, JSON.stringify({ nodes: [...byId.values()], edges: [] }, null, 2), 'utf8')
        fs.renameSync(gtmp, gfile)
      }
      // 项目节点与边写入项目文件
      const file = this.fileOf(projectName)
      const tmp = `${file}.tmp-${process.pid}`
      fs.writeFileSync(tmp, JSON.stringify({ nodes: projectNodes, edges: deduped }, null, 2), 'utf8')
      fs.renameSync(tmp, file)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 追加节点（id 冲突自动重生成）。 */
  addNode(projectName: string, node: Omit<GraphNode, 'id'>): GraphNode {
    const graph = this.get(projectName)
    let id = randomUUID().slice(0, 8)
    while (graph.nodes.some((n) => n.id === id)) id = randomUUID().slice(0, 8)
    const created: GraphNode = { ...node, id }
    graph.nodes.push(created)
    this.save(projectName, graph)
    return created
  }

  /** 追加连线（context 目标已有连接时替换旧边）。 */
  addEdge(projectName: string, edge: Omit<GraphEdge, 'id'>): GraphEdge {
    const graph = this.get(projectName)
    if (!graph.nodes.some((n) => n.id === edge.from) || !graph.nodes.some((n) => n.id === edge.to)) {
      throw new Error('连线引用的节点不存在')
    }
    if (edge.toPort === 'context') {
      graph.edges = graph.edges.filter((e) => !(e.to === edge.to && e.toPort === 'context'))
    }
    const created: GraphEdge = { ...edge, id: randomUUID().slice(0, 8) }
    graph.edges.push(created)
    this.save(projectName, graph)
    return created
  }
}
