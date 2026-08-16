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

  private fileOf(projectName: string): string {
    // 项目名是 workspace 校验过的安全 slug
    return path.join(this.graphsDir(), `${projectName}.json`)
  }

  /** 读取项目图（不存在返回空图）。 */
  get(projectName: string): ChatGraph {
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

  /**
   * 保存项目图（整体覆盖）。校验：
   * - 边引用的节点必须存在；
   * - chat node 的 context 输入最多一条（后写覆盖先写，前端也做约束）。
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
    try {
      const dir = this.graphsDir()
      fs.mkdirSync(dir, { recursive: true })
      const file = this.fileOf(projectName)
      const tmp = `${file}.tmp-${process.pid}`
      fs.writeFileSync(tmp, JSON.stringify({ nodes, edges: deduped }, null, 2), 'utf8')
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
